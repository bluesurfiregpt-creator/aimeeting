"""
Post-meeting identification pipeline.

End-to-end:
  1. snapshot the in-memory PCM buffer for the meeting
  2. wrap as WAV, upload to OSS, sign a URL
  3. POST /v1/identify with attendees' voiceprints
  4. wait for the job to finish
  5. align segments to ASR transcript lines (max time overlap + threshold)
  6. write speaker_user_id / status / confidence back to meeting_transcript

We deliberately mark each transcript line individually, because Phase 2 will
want to revisit only the low-confidence ones for human correction.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Awaitable, Callable

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .audio_utils import pcm_to_wav
from .db import SessionLocal
from .models import (
    Meeting,
    MeetingAttendee,
    MeetingSpeakerSegment,
    MeetingTranscript,
    User,
    Voiceprint,
)
from .oss_client import OSSClient
from .pyannote_client import IdentifySegment, PyannoteClient
from . import session_state

logger = logging.getLogger(__name__)

# v25.10 客户反馈:有人 80% 漏识 同时 别人的话被误识为他.
# 漏识 vs 误识 取舍:**误识比漏识更糟**(看到错信息比看到"未识别"更愤怒).
# 策略:
#  - pyannote 阈值 0.55 → 0.65(只接受高 confidence segment,宁可漏不要错)
#  - 加 neighborhood smoothing:某句 conf 低且邻居 都是同一人 → 顺延为同一人
#  - 加 批量纠正 UI:用户一键标"此后 N 句都改为此人"
CONF_THRESHOLD = 0.45  # was 0.4
PERIODIC_INTERVAL_S = 45
MIN_BUFFER_SECONDS = 20
PYANNOTE_MATCH_THRESHOLD = 0.65  # was 0.55 — 防误识为高优先,宁可漏不要错
# 对齐 ASR 句到 pyannote segment 的最小重叠率
MIN_LINE_OVERLAP_RATIO = 0.5
MIN_SEGMENT_DURATION_MS = 800
# v25.10: smoothing — 某句若 confidence 在 [0.40, 0.65) (拒识区) 但前后 N 句
# 都同一用户 → 顺延.防 pyannote 偶发 false positive 抖动.
SMOOTHING_WINDOW = 2   # 前 N 句 + 后 N 句 都同一人 → 平滑
SMOOTHING_NEED_AGREE = 3  # 至少 3 个邻居 同一用户 才平滑


async def identify_worker(
    meeting_id: uuid.UUID,
    *,
    on_change: Callable[[], Awaitable[None]] | None = None,
) -> None:
    """
    Long-running per-meeting task. Runs an identify pass every
    PERIODIC_INTERVAL_S seconds; on stop_event, runs one final pass and exits.
    """
    sess = session_state.get_or_create(meeting_id)
    while True:
        try:
            await asyncio.wait_for(sess.stop_event.wait(), timeout=PERIODIC_INTERVAL_S)
            stopping = True
        except asyncio.TimeoutError:
            stopping = False

        # Don't bother on small buffers (avoids cheap mistakes + saves cost).
        from .audio_utils import pcm_seconds  # local import to avoid cycle
        if pcm_seconds(bytes(sess.pcm_buffer)) < MIN_BUFFER_SECONDS:
            if stopping:
                # nothing useful to identify; mark the meeting skipped on exit
                await _mark_meeting_status(meeting_id, "skipped", "audio too short")
                session_state.discard(meeting_id)
                return
            continue

        try:
            async with sess.identify_lock:
                changed = await run_identify(meeting_id, final=stopping)
        except Exception:
            logger.exception("identify pass failed for meeting %s", meeting_id)
            changed = False

        if changed and on_change is not None:
            try:
                await on_change()
            except Exception:
                logger.exception("on_change callback failed")

        if stopping:
            return


async def run_identify(meeting_id: uuid.UUID, *, final: bool = True) -> bool:
    """
    Run /identify on the current PCM buffer for this meeting and propagate
    the speaker labels back into meeting_transcript rows.

    Idempotent: each call re-snapshots the buffer, replaces stale speaker
    segments, and re-aligns transcript lines. Safe to invoke periodically
    during a meeting; the LAST call should pass final=True to mark the
    meeting as `processed` and free the in-memory PCM buffer.

    Returns True if names were updated for at least one transcript line,
    so callers can decide whether to push a `speakers_updated` event.
    """
    sess = session_state.get(meeting_id)
    if sess is None or len(sess.pcm_buffer) == 0:
        if final:
            await _mark_meeting_status(meeting_id, "skipped", "no audio captured")
        return False

    pcm = bytes(sess.pcm_buffer)

    oss = OSSClient()
    pyannote = PyannoteClient()
    if not oss.configured or not pyannote.configured:
        if final:
            await _mark_meeting_status(meeting_id, "skipped", "OSS or pyannoteAI not configured")
        return False

    # 1) upload recording
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    key = f"meetings/{meeting_id}/{ts}.wav"
    oss.put_bytes(key, pcm_to_wav(pcm), content_type="audio/wav")
    signed = oss.signed_url(key, expires_seconds=3600)

    async with SessionLocal() as db:
        await db.execute(
            update(Meeting).where(Meeting.id == meeting_id).values(recording_oss_key=key)
        )
        await db.commit()

        # 2) gather attendees' voiceprints
        attendees = (
            await db.execute(
                select(MeetingAttendee).where(MeetingAttendee.meeting_id == meeting_id)
            )
        ).scalars().all()
        user_ids = [a.user_id for a in attendees if a.user_id]
        if not user_ids:
            if final:
                await _mark_meeting_status(meeting_id, "skipped", "no human attendees", db=db)
            return False

        vp_rows = (
            await db.execute(
                select(Voiceprint).where(
                    Voiceprint.user_id.in_(user_ids), Voiceprint.is_active.is_(True)
                )
            )
        ).scalars().all()
        if not vp_rows:
            if final:
                await _mark_meeting_status(meeting_id, "skipped", "no voiceprints for attendees", db=db)
            return False

        # Resolve user names so we can build readable, stable labels.
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_user: dict[uuid.UUID, str] = {u.id: u.name for u in users}

        voiceprints_payload: list[dict] = []
        label_to_user: dict[str, uuid.UUID] = {}
        for vp in vp_rows:
            payload = vp.pyannote_payload or {}
            embedding = payload.get("voiceprint")
            if not embedding:
                logger.warning("voiceprint %s missing embedding payload", vp.id)
                continue
            # pyannote rules: label must be string, non-empty, ≤100 chars,
            # must NOT start with "SPEAKER_". We use uXXXXXXXX-Name (slug).
            base = name_by_user.get(vp.user_id, "user")
            label = f"u{str(vp.user_id)[:8]}-{base}"[:100]
            label_to_user[label] = vp.user_id
            voiceprints_payload.append({"label": label, "voiceprint": embedding})

        if not voiceprints_payload:
            if final:
                await _mark_meeting_status(meeting_id, "skipped", "no usable voiceprints", db=db)
            return False

    # 3) submit + wait
    try:
        # precision-2 gives a marked accuracy uplift. We pass min/max speakers
        # rather than a hard numSpeakers because real meetings often have
        # silent attendees — pinning to attendee count would force pyannote
        # to invent a phantom speaker for any non-speaking participant.
        attendee_count = len(voiceprints_payload)
        job_id = await pyannote.submit_identify(
            signed,
            voiceprints_payload,
            min_speakers=1,
            max_speakers=attendee_count,
            threshold=PYANNOTE_MATCH_THRESHOLD,
            exclusive=True,
            model="precision-2",
        )
    except Exception as e:
        logger.exception("submit_identify failed")
        if final:
            await _mark_meeting_status(meeting_id, "failed", f"submit: {e}")
        return False

    async with SessionLocal() as db:
        await db.execute(
            update(Meeting).where(Meeting.id == meeting_id).values(pyannote_job_id=job_id)
        )
        await db.commit()

    try:
        result = await pyannote.wait_for_job(job_id, max_wait_s=600, poll_every_s=4.0)
    except Exception as e:
        logger.exception("wait_for_job failed")
        if final:
            await _mark_meeting_status(meeting_id, "failed", f"wait: {e}")
        return False

    segments = pyannote.parse_identify_segments(result)
    raw_count = len(segments)
    # Drop micro-segments (usually noise that randomly correlates with a
    # voiceprint) before persisting / aligning.
    segments = [
        s for s in segments
        if (s.end_ms - s.start_ms) >= MIN_SEGMENT_DURATION_MS
    ]
    logger.info(
        "meeting %s: %d raw segments (%d after MIN_SEGMENT_DURATION filter)",
        meeting_id, raw_count, len(segments),
    )

    changed = False
    async with SessionLocal() as db:
        # Replace stale segments — each call is the new authoritative view.
        await db.execute(
            delete(MeetingSpeakerSegment).where(
                MeetingSpeakerSegment.meeting_id == meeting_id
            )
        )
        for s in segments:
            uid = label_to_user.get(s.label)
            db.add(
                MeetingSpeakerSegment(
                    meeting_id=meeting_id,
                    start_ms=s.start_ms,
                    end_ms=s.end_ms,
                    label=s.label,
                    user_id=uid if s.confidence >= CONF_THRESHOLD else None,
                    confidence=s.confidence,
                    status="auto_recognized",
                )
            )

        # 4) align ASR sentences to segments
        lines = (
            await db.execute(
                select(MeetingTranscript)
                .where(MeetingTranscript.meeting_id == meeting_id)
                .order_by(MeetingTranscript.id)
            )
        ).scalars().all()

        # v25.10: 第一遍 — 普通 align,allow_low 让 align 把 low-conf 也算上(用 None 标但记 conf)
        # 第二遍 — neighborhood smoothing:孤立的"未识别"/"低置信" 若邻居一致 → 跟随邻居
        # manually_corrected / manually_unset 跳过两遍
        # 先计算所有 line 的 (uid, conf, segment_user_candidate)
        # 然后 smoothing pass

        # Pass 1: align
        line_results: list[tuple[MeetingTranscript, uuid.UUID | None, float | None, uuid.UUID | None]] = []
        for line in lines:
            if line.speaker_status in ("manually_corrected", "manually_unset"):
                line_results.append((line, line.speaker_user_id, line.confidence, None))
                continue
            uid, conf = _align_line_to_segments(line, segments, label_to_user)
            # candidate_uid — 即使 conf 低 / 重叠不足,也记下 best segment 对应的 user(供 smoothing 参考)
            candidate = _candidate_user_for_line(line, segments, label_to_user)
            line_results.append((line, uid, conf, candidate))

        # Pass 2: smoothing
        for i, (line, uid, conf, candidate) in enumerate(line_results):
            if line.speaker_status in ("manually_corrected", "manually_unset"):
                continue
            if uid is not None:
                # 已识别,但还要检查 是不是邻居都不是同一人(可能误识)
                # 如果 self=X 但邻居 N 个都是 Y 而非 X → 信邻居(覆盖)
                neighbor_uid = _neighborhood_majority(line_results, i)
                if neighbor_uid is not None and neighbor_uid != uid:
                    logger.info(
                        "smoothing: line %d was %s but neighbors say %s; trusting neighbors",
                        line.id, uid, neighbor_uid,
                    )
                    uid = neighbor_uid
            else:
                # 未识别;若 candidate 与邻居一致 → 升级为已识别
                neighbor_uid = _neighborhood_majority(line_results, i)
                if neighbor_uid is not None and (candidate is None or candidate == neighbor_uid):
                    logger.info(
                        "smoothing: line %d unknown but neighbors all %s; promote",
                        line.id, neighbor_uid,
                    )
                    uid = neighbor_uid

            new_label = "auto_recognized" if uid else "UNKNOWN"
            new_status = (
                "auto_smoothed" if uid and conf is None else
                "auto_recognized" if uid else
                "low_confidence"
            )
            if (
                line.speaker_user_id != uid
                or line.speaker_label != new_label
                or line.confidence != conf
            ):
                changed = True
            line.speaker_user_id = uid
            line.speaker_label = new_label
            line.speaker_status = new_status
            line.confidence = conf

        if final:
            await db.execute(
                update(Meeting)
                .where(Meeting.id == meeting_id)
                .values(status="processed")
            )
        await db.commit()

    if final:
        session_state.discard(meeting_id)
        # v25.8-#2: 先 LLM 修字(post-ASR cleaner),再 generate summary.
        # 串行而非并行 — summary 必须看到修后的实录.
        from .summary_generator import generate_summary  # local import to avoid cycle
        from .transcript_cleaner import clean_meeting_transcripts

        async def _post_meeting_pipeline() -> None:
            try:
                n = await clean_meeting_transcripts(meeting_id)
                logger.info("post-meeting: cleaned %d transcript lines", n)
            except Exception:
                logger.exception("transcript_cleaner failed; proceeding with raw text")
            await generate_summary(meeting_id)

        asyncio.create_task(_post_meeting_pipeline())
    logger.info(
        "identify pass for meeting %s: %d segments, %d lines, changed=%s, final=%s",
        meeting_id, len(segments), len(lines), changed, final,
    )
    return changed


def _candidate_user_for_line(
    line: MeetingTranscript,
    segments: list[IdentifySegment],
    label_to_user: dict[str, uuid.UUID],
) -> uuid.UUID | None:
    """与 _align 类似 但不卡 confidence / overlap 阈值,只返回 best-overlap segment 的 user.

    用于 smoothing — 即使主流程拒识也保留一个 "猜测",看是否能被邻居印证.
    """
    if line.start_ms is None or line.end_ms is None:
        return None
    best_overlap = 0
    best_seg: IdentifySegment | None = None
    for seg in segments:
        overlap = max(0, min(line.end_ms, seg.end_ms) - max(line.start_ms, seg.start_ms))
        if overlap > best_overlap:
            best_overlap = overlap
            best_seg = seg
    if best_seg is None:
        return None
    return label_to_user.get(best_seg.label)


def _neighborhood_majority(
    line_results: list,  # list[(line, uid, conf, candidate)]
    i: int,
) -> uuid.UUID | None:
    """检查 第 i 句 的前 N 后 N 邻居.若 ≥ SMOOTHING_NEED_AGREE 个一致,返回该 uid;否则 None.

    跳过 未识别 / manually_unset 邻居.
    """
    counts: dict[uuid.UUID, int] = {}
    for j in range(max(0, i - SMOOTHING_WINDOW), min(len(line_results), i + SMOOTHING_WINDOW + 1)):
        if j == i:
            continue
        ln, uid, _, _ = line_results[j]
        if uid is None:
            continue
        if ln.speaker_status == "manually_unset":
            continue
        counts[uid] = counts.get(uid, 0) + 1
    if not counts:
        return None
    top_uid, top_n = max(counts.items(), key=lambda x: x[1])
    if top_n >= SMOOTHING_NEED_AGREE:
        return top_uid
    return None


def _align_line_to_segments(
    line: MeetingTranscript,
    segments: list[IdentifySegment],
    label_to_user: dict[str, uuid.UUID],
) -> tuple[uuid.UUID | None, float | None]:
    """
    Pick the segment with the largest overlap with the ASR sentence's time
    window, AND require the overlap to cover at least MIN_LINE_OVERLAP_RATIO
    of the sentence's duration. The ratio guard blocks the false-positive
    where a short sentence is attributed to a nearby segment that mostly
    contains different audio (e.g. a TV character voice or environment
    noise). Below CONF_THRESHOLD or below ratio → UNKNOWN.
    """
    if line.start_ms is None or line.end_ms is None:
        return None, None
    line_duration = max(1, line.end_ms - line.start_ms)
    best_overlap = 0
    best_seg: IdentifySegment | None = None
    for seg in segments:
        overlap = max(0, min(line.end_ms, seg.end_ms) - max(line.start_ms, seg.start_ms))
        if overlap > best_overlap:
            best_overlap = overlap
            best_seg = seg
    if best_seg is None or best_seg.confidence < CONF_THRESHOLD:
        return None, best_seg.confidence if best_seg else None
    # New: require the matched segment to actually cover most of this line.
    if best_overlap / line_duration < MIN_LINE_OVERLAP_RATIO:
        return None, best_seg.confidence
    return label_to_user.get(best_seg.label), best_seg.confidence


async def _mark_meeting_status(
    meeting_id: uuid.UUID,
    status_word: str,
    note: str,
    *,
    db: AsyncSession | None = None,
) -> None:
    """
    Status word goes in summary_md as a one-liner — for Phase 1.5 we don't have
    a dedicated identification_status column. The /result endpoint reads this
    out.
    """
    payload = f"<!-- identify:{status_word}: {note} -->"
    if db is not None:
        await db.execute(update(Meeting).where(Meeting.id == meeting_id).values(summary_md=payload))
        await db.commit()
        return
    async with SessionLocal() as s:
        await s.execute(update(Meeting).where(Meeting.id == meeting_id).values(summary_md=payload))
        await s.commit()
