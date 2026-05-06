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

CONF_THRESHOLD = 0.5  # below this we mark UNKNOWN (manual fixup later)
PERIODIC_INTERVAL_S = 45  # how often the live worker triggers an identify pass
MIN_BUFFER_SECONDS = 20   # don't bother identifying buffers shorter than this


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
            threshold=0.5,
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
    logger.info("meeting %s: %d speaker segments", meeting_id, len(segments))

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

        for line in lines:
            uid, conf = _align_line_to_segments(line, segments, label_to_user)
            new_label = "auto_recognized" if uid else "UNKNOWN"
            new_status = "auto_recognized" if uid else "low_confidence"
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
    logger.info(
        "identify pass for meeting %s: %d segments, %d lines, changed=%s, final=%s",
        meeting_id, len(segments), len(lines), changed, final,
    )
    return changed


def _align_line_to_segments(
    line: MeetingTranscript,
    segments: list[IdentifySegment],
    label_to_user: dict[str, uuid.UUID],
) -> tuple[uuid.UUID | None, float | None]:
    """
    Pick the segment with the largest overlap with the ASR sentence's time
    window. Below CONF_THRESHOLD → leave unassigned.
    """
    if line.start_ms is None or line.end_ms is None:
        return None, None
    best_overlap = 0
    best_seg: IdentifySegment | None = None
    for seg in segments:
        overlap = max(0, min(line.end_ms, seg.end_ms) - max(line.start_ms, seg.start_ms))
        if overlap > best_overlap:
            best_overlap = overlap
            best_seg = seg
    if best_seg is None or best_seg.confidence < CONF_THRESHOLD:
        return None, best_seg.confidence if best_seg else None
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
