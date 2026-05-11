from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio

from .. import session_state
from ..agenda_monitor import maybe_check_agenda
from ..agent_router import maybe_invoke_agents
from ..audit import audit_log
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..dissent_detector import maybe_detect_dissent
from ..identify_pipeline import run_identify
from ..models import (
    Meeting,
    MeetingActionItem,
    MeetingActionItemComment,
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingTranscript,
    Task,
    User,
)
from ..notify import emit_notification
from ..task_sync import (
    add_action_with_task,
    delete_task_for_action,
    mirror_patch_to_task,
)
from ..schemas import MeetingCreate, MeetingOut, MeetingResultOut, TranscriptLine
from ..briefing_generator import generate_briefing
from ..meeting_export import export_docx, export_markdown
from ..summary_generator import generate_summary

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meetings", tags=["meetings"])


async def _load_owned_meeting(
    meeting_id: str, session: AsyncSession, auth: AuthContext
) -> Meeting:
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id, Meeting.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")
    return m


def _to_meeting_out(
    m: Meeting,
    attendee_user_ids: list[uuid.UUID],
    attendee_agent_ids: list[uuid.UUID] | None = None,
) -> MeetingOut:
    return MeetingOut.model_validate(
        {
            "id": m.id,
            "title": m.title,
            "status": m.status,
            "started_at": m.started_at,
            "ended_at": m.ended_at,
            "attendee_user_ids": attendee_user_ids,
            "attendee_agent_ids": attendee_agent_ids or [],
            "agenda": m.agenda,
        }
    )


@router.post("", response_model=MeetingOut)
async def create_meeting(
    payload: MeetingCreate,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = Meeting(
        title=payload.title or "未命名会议",
        status="scheduled",
        workspace_id=auth.workspace.id,
        agenda=(
            [a.model_dump(exclude_none=True) for a in payload.agenda]
            if payload.agenda
            else None
        ),
    )
    session.add(m)
    await session.flush()
    for uid in payload.attendee_user_ids:
        # Verify each user belongs to the same workspace before binding
        u = (
            await session.execute(
                select(User).where(
                    User.id == uid, User.workspace_id == auth.workspace.id
                )
            )
        ).scalar_one_or_none()
        if u is not None:
            session.add(MeetingAttendee(meeting_id=m.id, user_id=uid))

    # v25.7-#1: 邀请 AI 专家(workspace 校验)
    bound_agent_ids: list[uuid.UUID] = []
    if payload.attendee_agent_ids:
        from ..models import Agent
        valid_agents = (
            await session.execute(
                select(Agent.id).where(
                    Agent.id.in_(payload.attendee_agent_ids),
                    Agent.workspace_id == auth.workspace.id,
                    Agent.is_active.is_(True),
                )
            )
        ).all()
        bound_agent_ids = [r[0] for r in valid_agents]
        for aid in bound_agent_ids:
            session.add(MeetingAttendee(meeting_id=m.id, agent_id=aid))

    await session.commit()
    await session.refresh(m)
    await audit_log(
        session, auth, "meeting.create",
        target_type="meeting", target_id=str(m.id),
        payload={
            "title": m.title,
            "attendee_count": len(payload.attendee_user_ids),
            "agent_count": len(bound_agent_ids),
        },
    )
    return _to_meeting_out(m, list(payload.attendee_user_ids), bound_agent_ids)


@router.get("", response_model=list[MeetingOut])
async def list_meetings(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(Meeting)
            .where(Meeting.workspace_id == auth.workspace.id)
            .order_by(Meeting.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    if not rows:
        return []
    # Pull attendee user_ids + agent_ids for each meeting in one shot
    ids = [m.id for m in rows]
    rels = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id.in_(ids))
        )
    ).scalars().all()
    by_meeting_user: dict[uuid.UUID, list[uuid.UUID]] = {}
    by_meeting_agent: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in rels:
        if r.user_id is not None:
            by_meeting_user.setdefault(r.meeting_id, []).append(r.user_id)
        elif r.agent_id is not None:
            by_meeting_agent.setdefault(r.meeting_id, []).append(r.agent_id)
    return [
        _to_meeting_out(m, by_meeting_user.get(m.id, []), by_meeting_agent.get(m.id, []))
        for m in rows
    ]


@router.get("/{meeting_id}/export")
async def export_meeting(
    meeting_id: str,
    format: str = "md",
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Export the meeting (summary + named transcript + agent messages) as a
    downloadable file. Supports `md` and `docx`. Streamed as attachment with
    a Chinese-safe filename.
    """
    from urllib.parse import quote
    from fastapi.responses import Response

    m = await _load_owned_meeting(meeting_id, session, auth)
    safe_title = (m.title or "meeting").replace("/", "_")[:80]

    if format == "md":
        content = await export_markdown(m.id, session)
        if not content:
            raise HTTPException(404, "nothing to export")
        body = content.encode("utf-8")
        media = "text/markdown; charset=utf-8"
        ext = "md"
    elif format == "docx":
        body = await export_docx(m.id, session)
        if not body:
            raise HTTPException(404, "nothing to export")
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ext = "docx"
    else:
        raise HTTPException(400, "format must be md or docx")

    filename = f"{safe_title}.{ext}"
    # Quote for cross-browser Chinese filename support per RFC 5987
    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"meeting.{ext}\"; "
            f"filename*=UTF-8''{quote(filename)}"
        )
    }
    return Response(content=body, media_type=media, headers=headers)


@router.get("/{meeting_id}/minutes")
async def export_meeting_minutes(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25-5 — 单场会议纪要 docx 完整版(政务公文格式).

    比 /export?format=docx 更全:
      - 议程(若有)
      - 摘要 + 转写 + AI 专家发言 + 待办事项
      - RGB 颜色 + 标题层级 + RFC 5987 中文 filename
      - 页脚带导出时间

    任何登录用户(只要在该 workspace)都可导出.
    """
    from urllib.parse import quote
    from fastapi.responses import Response

    from ..meeting_minutes import build_minutes_docx

    m = await _load_owned_meeting(meeting_id, session, auth)
    body, filename = await build_minutes_docx(session, m.id)
    ascii_fallback = filename.encode("ascii", errors="replace").decode("ascii").replace("?", "_")
    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"{ascii_fallback}\"; "
            f"filename*=UTF-8''{quote(filename)}"
        ),
    }
    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Delete a meeting and ALL its dependent rows. Cascade is configured on
    the FK columns (ondelete='CASCADE') for transcripts, attendees, agent
    messages and speaker segments, so we just remove the parent.

    Long-term memories that were extracted from this meeting are LEFT in
    place — testers explicitly want to clean up trash meetings without
    losing the knowledge harvested from them. Memories are referenced by
    source_id so they remain queryable from /admin/memory.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    # Discard any in-memory session state still buffering audio
    session_state.discard(m.id)
    title = m.title
    await session.delete(m)
    await session.commit()
    await audit_log(
        session, auth, "meeting.delete",
        target_type="meeting", target_id=meeting_id, payload={"title": title},
    )


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id)
        )
    ).scalars().all()
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    agent_ids = [r.agent_id for r in rows if r.agent_id is not None]
    return _to_meeting_out(m, user_ids, agent_ids)


@router.post("/{meeting_id}/finalize", response_model=MeetingOut)
async def finalize_meeting(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.status != "finished":
        await session.execute(
            update(Meeting)
            .where(Meeting.id == m.id)
            .values(status="finished", ended_at=datetime.now(timezone.utc))
        )
        await session.commit()
        await session.refresh(m)

    # kick off identify in background
    bg.add_task(run_identify, m.id)
    rows = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id)
        )
    ).scalars().all()
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    agent_ids = [r.agent_id for r in rows if r.agent_id is not None]
    return _to_meeting_out(m, user_ids, agent_ids)


_STATUS_RE = re.compile(r"<!-- identify:(\w+): (.*?) -->")


class BriefingOut(BaseModel):
    briefing_md: str | None
    status: str  # 'ready' | 'empty'


@router.get("/{meeting_id}/briefing", response_model=BriefingOut)
async def get_meeting_briefing(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    md = await generate_briefing(m.id)
    return BriefingOut(briefing_md=md, status="ready" if md else "empty")


class SummaryOut(BaseModel):
    """summary_md is None when not yet generated; status tells the front-end
    whether to keep polling."""
    summary_md: str | None
    status: str  # 'pending' | 'ready' | 'failed' | 'unconfigured' | 'skipped'
    message: str | None = None  # human-readable note for skipped/failed


@router.get("/{meeting_id}/summary", response_model=SummaryOut)
async def get_meeting_summary(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.summary_md and not m.summary_md.startswith("<!--"):
        return SummaryOut(summary_md=m.summary_md, status="ready")
    # The summary_generator may write a <!-- summary:skipped: ... --> marker
    # when the transcript is too thin; surface it as a terminal 'skipped'
    # state so the front-end stops polling and shows a friendly message.
    if m.summary_md and m.summary_md.startswith("<!-- summary:skipped:"):
        msg_match = re.search(r"<!-- summary:skipped: (.*?) -->", m.summary_md, re.S)
        return SummaryOut(
            summary_md=None,
            status="skipped",
            message=msg_match.group(1) if msg_match else "纪要已跳过",
        )
    # Status markers from identify pipeline (e.g. <!-- identify:skipped: ... -->)
    # are written to summary_md before a real summary exists. Treat them as
    # pending so the front-end keeps polling for the actual summary content.
    return SummaryOut(summary_md=None, status="pending")


@router.post("/{meeting_id}/summary/regenerate", response_model=SummaryOut)
async def regenerate_meeting_summary(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    # Clear any prior content so the front-end's polling sees the regen state.
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(summary_md=None)
    )
    await session.commit()
    bg.add_task(generate_summary, m.id, force=True)
    return SummaryOut(summary_md=None, status="pending")


class CorrectSpeakerIn(BaseModel):
    speaker_user_id: uuid.UUID | None  # null = 标记为未识别


class CorrectSpeakerOut(BaseModel):
    line_id: int
    speaker_user_id: uuid.UUID | None
    speaker_name: str | None
    status: str


class ManualTranscriptIn(BaseModel):
    text: str
    speaker_user_id: uuid.UUID | None = None


class ManualTranscriptOut(BaseModel):
    line_id: int
    speaker_user_id: uuid.UUID | None
    speaker_name: str | None
    text: str


@router.post("/{meeting_id}/manual-transcript", response_model=ManualTranscriptOut)
async def post_manual_transcript(
    meeting_id: str,
    payload: ManualTranscriptIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Type-a-message endpoint. Same pipeline as a finalized ASR sentence:
    persists a transcript row + fires Agent triggers + dissent detection.

    Used by:
      - The frontend's "💬 文字录入" box when there's no live WebSocket
        attached (the live UX prefers the WS `text_message` action so the
        user sees their own message echoed instantly).
      - Claude Cowork / automation that wants to drive a meeting end-to-end
        without going through the mic / WebSocket stack.

    Speaker:
      - speaker_user_id is optional. When given, must belong to the same
        workspace as the caller; this is locked in with speaker_status
        'manual' so the post-meeting voiceprint identify pass won't
        overwrite it (same lock used by ✏️ in-meeting correction).
      - When omitted, the line is recorded as 未识别 (the caller can fix it
        later via /correct-speaker).

    Note on streaming visibility: Agent / dissent events fired by this
    endpoint go to a no-op sink (we have no WS attached). The Agent's
    persistent reply is still saved to `meeting_agent_message`, so it
    shows up in /result and the summary. Live page users on the same
    meeting WS DO see ALL events normally — but this endpoint is
    designed to be usable without one.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "text required")

    speaker_uuid = payload.speaker_user_id
    speaker_name: str | None = None
    if speaker_uuid is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == speaker_uuid,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "speaker_user_id not in this workspace")
        speaker_name = u.name

    line = MeetingTranscript(
        meeting_id=m.id,
        text=text,
        is_final=True,
        speaker_user_id=speaker_uuid,
        speaker_status="manual",
    )
    session.add(line)

    # v11 ISSUE-2: a meeting that's receiving transcripts is, by definition,
    # happening — flip 'scheduled' → 'ongoing' on first injection so
    # agenda_monitor's elapsed-time math has a sane baseline. ASR path does
    # the equivalent in main.py when the WS opens; this mirrors it for
    # mic-less / Cowork driven meetings.
    if m.status == "scheduled":
        m.status = "ongoing"
        m.started_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(line)

    # Fire-and-forget agent + dissent. on_message has nowhere to deliver
    # streaming chunks (this is a REST call, no socket), so use a no-op
    # sink. Agent message persistence still works inside the agent_router.
    async def _noop(_payload: dict) -> None:
        return None

    asyncio.create_task(maybe_invoke_agents(m.id, text, on_message=_noop))
    asyncio.create_task(maybe_detect_dissent(m.id, on_message=_noop))
    asyncio.create_task(maybe_check_agenda(m.id, on_message=_noop))

    return ManualTranscriptOut(
        line_id=line.id,
        speaker_user_id=speaker_uuid,
        speaker_name=speaker_name,
        text=text,
    )


@router.post(
    "/{meeting_id}/transcripts/{line_id}/correct-speaker",
    response_model=CorrectSpeakerOut,
)
async def correct_speaker(
    meeting_id: str,
    line_id: int,
    payload: CorrectSpeakerIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Manually re-attribute a transcript line to a specific user (or unset).

    Per blueprint §5.3: corrections are kept distinct from auto-recognized
    rows via the `speaker_status` column ('manually_corrected') so we can
    later regress identification quality on the corrected vs. auto split.
    """
    await _load_owned_meeting(meeting_id, session, auth)  # access check
    line = (
        await session.execute(
            select(MeetingTranscript).where(
                MeetingTranscript.meeting_id == meeting_id,
                MeetingTranscript.id == line_id,
            )
        )
    ).scalar_one_or_none()
    if not line:
        raise HTTPException(404, "transcript line not found")

    name: str | None = None
    if payload.speaker_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.speaker_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(404, "user not found")
        name = u.name

    line.speaker_user_id = payload.speaker_user_id
    line.speaker_label = "manually_corrected" if payload.speaker_user_id else "UNKNOWN"
    line.speaker_status = "manually_corrected" if payload.speaker_user_id else "manually_unset"
    line.confidence = 1.0 if payload.speaker_user_id else None
    await session.commit()

    return CorrectSpeakerOut(
        line_id=line.id,
        speaker_user_id=line.speaker_user_id,
        speaker_name=name,
        status=line.speaker_status or "",
    )


@router.get("/{meeting_id}/result", response_model=MeetingResultOut)
async def get_result(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)

    lines_raw = (
        await session.execute(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == m.id)
            .order_by(MeetingTranscript.id)
        )
    ).scalars().all()

    user_ids = {l.speaker_user_id for l in lines_raw if l.speaker_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}

    out_lines = [
        TranscriptLine(
            id=l.id,
            line_id=l.id,  # v11 QA ISSUE-1: canonical field, matches POST shape
            text=l.text,
            start_ms=l.start_ms,
            end_ms=l.end_ms,
            speaker_user_id=l.speaker_user_id,
            speaker_label=l.speaker_label,
            speaker_name=name_by_id.get(l.speaker_user_id) if l.speaker_user_id else None,
            speaker_status=l.speaker_status,
            confidence=l.confidence,
        )
        for l in lines_raw
    ]

    # decode identification status
    status = "pending"
    msg: str | None = None
    if m.status == "processed":
        status = "ready"
    elif m.status == "finished":
        status = "running"
    if m.summary_md and (mt := _STATUS_RE.search(m.summary_md)):
        status = mt.group(1)
        msg = mt.group(2)

    rows = (
        await session.execute(
            select(MeetingAttendee.user_id).where(
                MeetingAttendee.meeting_id == m.id, MeetingAttendee.user_id.is_not(None)
            )
        )
    ).all()

    return MeetingResultOut(
        meeting=_to_meeting_out(m, [r[0] for r in rows]),
        lines=out_lines,
        identification_status=status,
        identification_message=msg,
    )


# --------- M3.0: dev-only synchronous agenda-monitor trigger -----------------


class AgendaMonitorRunOut(BaseModel):
    fired: bool
    payload: Optional[dict] = None
    note: Optional[str] = None


@router.post("/{meeting_id}/agenda-monitor/run-now", response_model=AgendaMonitorRunOut)
async def run_agenda_monitor(
    meeting_id: str,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """
    Run the agenda monitor synchronously for this meeting, bypassing the
    60s throttle and 90s post-fire cooldown. Returns whatever banner the
    LLM produced (or note='no_signal' if it judged everything is fine).

    Per v11 QA report ISSUE-4: production runs the monitor on a 60s
    schedule which is impractical for CI / Cowork to verify. This
    endpoint provides deterministic on-demand triggering.

    Auth-gated like every other route (workspace ownership check on the
    meeting). Not gated on env — the monitor is read-only from the user's
    perspective, just an extra LLM call.
    """
    await _load_owned_meeting(meeting_id, session, auth)

    captured: list[dict] = []

    async def _capture(payload: dict) -> None:
        captured.append(payload)

    from ..agenda_monitor import maybe_check_agenda
    fired = await maybe_check_agenda(uuid.UUID(meeting_id), on_message=_capture, force=True)

    if fired is None:
        return AgendaMonitorRunOut(fired=False, note="no_signal_or_no_agenda")
    return AgendaMonitorRunOut(fired=True, payload=fired)


class DissentRunNowOut(BaseModel):
    fired: bool
    payload: Optional[dict] = None
    note: Optional[str] = None


@router.post("/{meeting_id}/dissent-detector/run-now", response_model=DissentRunNowOut)
async def run_dissent_detector(
    meeting_id: str,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """
    Synchronous trigger for the dissent detector — analogous to
    `/agenda-monitor/run-now`. Bypasses the 25s throttle and 60s post-
    fire cooldown. Returns either the banner payload or a no-signal note.

    Useful for Cowork: inject a few opposing-view lines via
    /manual-transcript, then call this endpoint to deterministically
    drive the LLM check (production runs on a wall-clock cadence that's
    too slow for CI).
    """
    await _load_owned_meeting(meeting_id, session, auth)

    async def _noop(_payload: dict) -> None:
        return None

    fired = await maybe_detect_dissent(uuid.UUID(meeting_id), on_message=_noop, force=True)

    if fired is None:
        return DissentRunNowOut(fired=False, note="no_signal_or_no_named_speakers")
    return DissentRunNowOut(fired=True, payload=fired)


# --------- M3.0: action items CRUD --------------------------------------------


class ActionItemOut(BaseModel):
    id: uuid.UUID
    meeting_id: uuid.UUID
    content: str
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_name: Optional[str] = None
    assignee_name_hint: Optional[str] = None
    due_at: Optional[datetime] = None
    status: str
    source_type: str
    created_at: datetime
    updated_at: datetime


class ActionItemIn(BaseModel):
    content: str
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None


class ActionItemPatch(BaseModel):
    content: Optional[str] = None
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None
    status: Optional[str] = None  # open | done | cancelled


def _action_to_out(row: MeetingActionItem, name_by_id: dict[uuid.UUID, str]) -> ActionItemOut:
    return ActionItemOut(
        id=row.id,
        meeting_id=row.meeting_id,
        content=row.content,
        assignee_user_id=row.assignee_user_id,
        assignee_name=name_by_id.get(row.assignee_user_id) if row.assignee_user_id else None,
        assignee_name_hint=row.assignee_name_hint,
        due_at=row.due_at,
        status=row.status,
        source_type=row.source_type,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/{meeting_id}/actions", response_model=list[ActionItemOut])
async def list_action_items(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """List all action items for this meeting (auto-extracted + manual)."""
    await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingActionItem)
            .where(MeetingActionItem.meeting_id == meeting_id)
            .order_by(MeetingActionItem.created_at)
        )
    ).scalars().all()
    user_ids = {r.assignee_user_id for r in rows if r.assignee_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    return [_action_to_out(r, name_by_id) for r in rows]


# v23.5: 会议追溯链 ----------------------------------------------------------


class MeetingTraceTaskOut(BaseModel):
    """A Task that originated from this meeting."""
    task_id: uuid.UUID
    action_item_id: uuid.UUID  # 原会议 action item id(供老页面 deeplink)
    title: Optional[str] = None
    content: str
    status: str
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_name: Optional[str] = None
    due_at: Optional[datetime] = None
    co_assignees: list[uuid.UUID] = []
    data_classification: str = "general"
    created_at: datetime
    updated_at: datetime


class MeetingTraceOut(BaseModel):
    """
    v23.5 — 会议追溯链:这次会议产生了哪些任务、它们现在的状态.

    只展示「meeting → task」一层(被引用关系如「该 task 又被 X 任务引用」
    留 v24+).
    """
    meeting_id: uuid.UUID
    meeting_title: str
    tasks: list[MeetingTraceTaskOut] = []
    total: int = 0
    by_status: dict[str, int] = {}  # 'open': 3, 'done': 5, ...


@router.get("/{meeting_id}/trace", response_model=MeetingTraceOut)
async def get_meeting_trace(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v23.5: 这次会议沉淀了哪些 Task + 它们现在的状态.

    workspace 内任何成员可看(沿用 _load_owned_meeting 的 workspace 隔离).
    Task 自身分级在 /api/me/tasks/{tid}/detail 时再细查 — trace 列表是
    元数据,不展示敏感正文.

    流程:Meeting → MeetingActionItem(meeting_id) → Task(via action_item.task_id)
    """
    m = await _load_owned_meeting(meeting_id, session, auth)

    # MeetingActionItem.task_id 在 v17 后是必填(虽然字段还是 nullable),
    # 一对一映射到 Task.
    action_rows = (
        await session.execute(
            select(MeetingActionItem)
            .where(
                MeetingActionItem.meeting_id == m.id,
                MeetingActionItem.task_id.is_not(None),
            )
            .order_by(MeetingActionItem.created_at)
        )
    ).scalars().all()

    if not action_rows:
        return MeetingTraceOut(
            meeting_id=m.id, meeting_title=m.title or "未命名会议", tasks=[], total=0, by_status={}
        )

    task_ids = [a.task_id for a in action_rows if a.task_id]
    task_by_id: dict[uuid.UUID, Task] = {}
    if task_ids:
        trows = (
            await session.execute(
                select(Task).where(Task.id.in_(task_ids), Task.workspace_id == m.workspace_id)
            )
        ).scalars().all()
        task_by_id = {t.id: t for t in trows}

    # 收集所有 assignee user_id 一次解析名字
    user_ids: set[uuid.UUID] = set()
    for t in task_by_id.values():
        if t.assignee_user_id:
            user_ids.add(t.assignee_user_id)
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        urows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {uid: nm for uid, nm in urows}

    out_tasks: list[MeetingTraceTaskOut] = []
    by_status: dict[str, int] = {}
    for ai in action_rows:
        t = task_by_id.get(ai.task_id) if ai.task_id else None
        if t is None:
            continue
        co_uuids: list[uuid.UUID] = []
        for s in (t.co_assignees or []):
            try:
                co_uuids.append(uuid.UUID(s))
            except (TypeError, ValueError):
                continue
        out_tasks.append(
            MeetingTraceTaskOut(
                task_id=t.id,
                action_item_id=ai.id,
                title=t.title,
                content=t.content,
                status=t.status,
                assignee_user_id=t.assignee_user_id,
                assignee_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
                due_at=t.due_at,
                co_assignees=co_uuids,
                data_classification=t.data_classification or "general",
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
        by_status[t.status] = by_status.get(t.status, 0) + 1

    return MeetingTraceOut(
        meeting_id=m.id,
        meeting_title=m.title or "未命名会议",
        tasks=out_tasks,
        total=len(out_tasks),
        by_status=by_status,
    )


@router.post("/{meeting_id}/actions", response_model=ActionItemOut)
async def create_action_item(
    meeting_id: str,
    payload: ActionItemIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Manually add a new action item (source_type='manual')."""
    m = await _load_owned_meeting(meeting_id, session, auth)
    if not payload.content.strip():
        raise HTTPException(400, "content required")
    if payload.assignee_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.assignee_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "assignee_user_id not in this workspace")
    row, _task = add_action_with_task(
        session,
        workspace_id=m.workspace_id,
        meeting_id=m.id,
        content=payload.content.strip()[:1000],
        assignee_user_id=payload.assignee_user_id,
        assignee_name_hint=None,
        due_at=payload.due_at,
        status="open",
        action_source_type="manual",
        created_by_user_id=auth.user.id,
    )
    await session.flush()
    # Theme 1: notify the assignee unless they're the caller themselves
    # (no self-notify — you know what you just did).
    if (
        row.assignee_user_id is not None
        and row.assignee_user_id != auth.user.id
    ):
        await emit_notification(
            session,
            workspace_id=m.workspace_id,
            user_id=row.assignee_user_id,
            kind="action_assigned",
            payload={
                "meeting_id": str(m.id),
                "meeting_title": m.title,
                "action_id": str(row.id),
                "task_id": str(row.task_id) if row.task_id else None,
                "content": row.content,
                "due_at": row.due_at.isoformat() if row.due_at else None,
                "assigned_by": auth.user.name,
            },
        )
    await session.commit()
    await session.refresh(row)
    name_by_id = {}
    if row.assignee_user_id:
        u = (
            await session.execute(select(User).where(User.id == row.assignee_user_id))
        ).scalar_one_or_none()
        if u:
            name_by_id[u.id] = u.name
    return _action_to_out(row, name_by_id)


@router.patch("/{meeting_id}/actions/{action_id}", response_model=ActionItemOut)
async def update_action_item(
    meeting_id: str,
    action_id: str,
    payload: ActionItemPatch,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Toggle done / edit content / change assignee or due date."""
    m = await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "action item not found")
    new_status: Optional[str] = None
    new_content: Optional[str] = None
    new_due_at_set = False
    new_due_at: Optional[datetime] = None
    new_assignee_set = False
    new_assignee: Optional[uuid.UUID] = None
    if payload.status is not None:
        if payload.status not in ("open", "done", "cancelled"):
            raise HTTPException(400, "status must be open|done|cancelled")
        row.status = payload.status
        new_status = payload.status
    if payload.content is not None:
        row.content = payload.content.strip()[:1000]
        new_content = row.content
    if payload.due_at is not None:
        row.due_at = payload.due_at
        new_due_at_set = True
        new_due_at = payload.due_at
    new_assignee_to_notify: Optional[uuid.UUID] = None
    if payload.assignee_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.assignee_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "assignee_user_id not in this workspace")
        # Notify only if it's actually a *change* and the new assignee
        # isn't the caller themselves (don't self-notify).
        if (
            row.assignee_user_id != payload.assignee_user_id
            and payload.assignee_user_id != auth.user.id
        ):
            new_assignee_to_notify = payload.assignee_user_id
        row.assignee_user_id = payload.assignee_user_id
        row.assignee_name_hint = None  # rebound — drop the freeform hint
        new_assignee_set = True
        new_assignee = payload.assignee_user_id
    # v17: mirror this patch onto the paired Task so /api/me/tasks and
    # other Task-side readers see the same state as ActionItem.
    await mirror_patch_to_task(
        session,
        row,
        content=new_content,
        assignee_user_id_set=new_assignee_set,
        assignee_user_id=new_assignee,
        due_at_set=new_due_at_set,
        due_at=new_due_at,
        status=new_status,
    )
    if new_assignee_to_notify is not None:
        await emit_notification(
            session,
            workspace_id=m.workspace_id,
            user_id=new_assignee_to_notify,
            kind="action_assigned",
            payload={
                "meeting_id": str(m.id),
                "meeting_title": m.title,
                "action_id": str(row.id),
                "task_id": str(row.task_id) if row.task_id else None,
                "content": row.content,
                "due_at": row.due_at.isoformat() if row.due_at else None,
                "assigned_by": auth.user.name,
            },
        )
    await session.commit()
    await session.refresh(row)
    name_by_id = {}
    if row.assignee_user_id:
        u = (
            await session.execute(select(User).where(User.id == row.assignee_user_id))
        ).scalar_one_or_none()
        if u:
            name_by_id[u.id] = u.name
    return _action_to_out(row, name_by_id)


@router.delete("/{meeting_id}/actions/{action_id}", status_code=204)
async def delete_action_item(
    meeting_id: str,
    action_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "action item not found")
    # v17: cascade-delete the paired Task. We delete the Task FIRST while the
    # FK from action_item.task_id → task.id is still set; the FK has
    # ondelete=SET NULL so it doesn't block. Then we delete the action.
    await delete_task_for_action(session, row)
    await session.delete(row)
    await session.commit()


# --------- Theme 1 (P0): action item comments + notify hooks ------------------


class ActionCommentOut(BaseModel):
    id: uuid.UUID
    action_item_id: uuid.UUID
    author_user_id: Optional[uuid.UUID] = None
    author_name: Optional[str] = None
    content: str
    created_at: datetime
    can_delete: bool = False  # True iff the caller authored this comment


class ActionCommentIn(BaseModel):
    content: str


@router.get(
    "/{meeting_id}/actions/{action_id}/comments",
    response_model=list[ActionCommentOut],
)
async def list_action_comments(
    meeting_id: str,
    action_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _load_owned_meeting(meeting_id, session, auth)
    # Verify the action belongs to this meeting (and therefore workspace).
    parent = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not parent:
        raise HTTPException(404, "action item not found")
    rows = (
        await session.execute(
            select(MeetingActionItemComment)
            .where(MeetingActionItemComment.action_item_id == action_id)
            .order_by(MeetingActionItemComment.created_at)
        )
    ).scalars().all()
    author_ids = {r.author_user_id for r in rows if r.author_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if author_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(author_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    return [
        ActionCommentOut(
            id=r.id,
            action_item_id=r.action_item_id,
            author_user_id=r.author_user_id,
            author_name=name_by_id.get(r.author_user_id) if r.author_user_id else None,
            content=r.content,
            created_at=r.created_at,
            can_delete=(r.author_user_id == auth.user.id),
        )
        for r in rows
    ]


@router.post(
    "/{meeting_id}/actions/{action_id}/comments",
    response_model=ActionCommentOut,
)
async def create_action_comment(
    meeting_id: str,
    action_id: str,
    payload: ActionCommentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Append a progress note to an action item.

    Side effect: notify the assignee + every prior commenter (besides the
    caller themselves) with kind=`action_comment` so a comment thread keeps
    everyone who has touched it informed without manual @ mentions.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    parent = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not parent:
        raise HTTPException(404, "action item not found")
    body = (payload.content or "").strip()
    if not body:
        raise HTTPException(400, "content required")
    body = body[:2000]  # hard cap; comments are notes, not essays

    row = MeetingActionItemComment(
        action_item_id=parent.id,
        author_user_id=auth.user.id,
        content=body,
    )
    session.add(row)
    await session.flush()

    # Build the audience: assignee + all prior commenters, minus the
    # current author (who knows what they just typed).
    audience: set[uuid.UUID] = set()
    if parent.assignee_user_id:
        audience.add(parent.assignee_user_id)
    prior_commenters = (
        await session.execute(
            select(MeetingActionItemComment.author_user_id)
            .where(
                MeetingActionItemComment.action_item_id == parent.id,
                MeetingActionItemComment.id != row.id,
                MeetingActionItemComment.author_user_id.isnot(None),
            )
            .distinct()
        )
    ).all()
    for (uid,) in prior_commenters:
        if uid is not None:
            audience.add(uid)
    audience.discard(auth.user.id)

    if audience:
        preview = body if len(body) <= 80 else body[:80] + "…"
        for uid in audience:
            await emit_notification(
                session,
                workspace_id=m.workspace_id,
                user_id=uid,
                kind="action_comment",
                payload={
                    "meeting_id": str(m.id),
                    "meeting_title": m.title,
                    "action_id": str(parent.id),
                    "task_id": str(parent.task_id) if parent.task_id else None,
                    "action_content": parent.content,
                    "comment_id": str(row.id),
                    "comment_preview": preview,
                    "author_name": auth.user.name,
                },
            )

    await session.commit()
    await session.refresh(row)
    return ActionCommentOut(
        id=row.id,
        action_item_id=row.action_item_id,
        author_user_id=row.author_user_id,
        author_name=auth.user.name,
        content=row.content,
        created_at=row.created_at,
        can_delete=True,
    )


@router.delete(
    "/{meeting_id}/actions/{action_id}/comments/{comment_id}",
    status_code=204,
)
async def delete_action_comment(
    meeting_id: str,
    action_id: str,
    comment_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Author-only delete. Per product decision: comments are deletable but
    not editable, so the audit trail isn't quietly rewritten.
    """
    await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItemComment)
            .join(
                MeetingActionItem,
                MeetingActionItem.id == MeetingActionItemComment.action_item_id,
            )
            .where(
                MeetingActionItemComment.id == comment_id,
                MeetingActionItem.id == action_id,
                MeetingActionItem.meeting_id == meeting_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "comment not found")
    if row.author_user_id != auth.user.id:
        raise HTTPException(403, "only the author can delete this comment")
    await session.delete(row)
    await session.commit()


# --------- M3.0: Cowork-friendly Agent message reader -------------------------


class AgentCitationOut(BaseModel):
    """v24.3 #1: 单条 RAG 引用(KB chunk)."""
    chunk_id: str
    document_id: str
    document_filename: str
    chunk_index: int
    snippet: str
    distance: float


class AgentMessageOut(BaseModel):
    id: int
    agent_id: uuid.UUID
    text: str
    trigger: Optional[str] = None
    citations: list[AgentCitationOut] = []  # v24.3 #1
    created_at: datetime


@router.get("/{meeting_id}/agent-messages", response_model=list[AgentMessageOut])
async def list_agent_messages(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Persistent record of every Agent reply produced in this meeting.

    Streaming chunks during a live WS session can be assembled by listening
    for `agent_message_*` events; this endpoint is the post-hoc transcript
    of those replies, useful when:
      - The meeting has ended and you want to audit who said what
      - You're driving via REST only (Cowork) and want to verify the
        keyword/@-mention/manual triggers actually fired the right Agent
    """
    await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingAgentMessage)
            .where(MeetingAgentMessage.meeting_id == meeting_id)
            .order_by(MeetingAgentMessage.id)
        )
    ).scalars().all()
    out: list[AgentMessageOut] = []
    for r in rows:
        cits: list[AgentCitationOut] = []
        if isinstance(r.citations, list):
            for c in r.citations:
                if not isinstance(c, dict):
                    continue
                try:
                    cits.append(AgentCitationOut(**c))
                except Exception:
                    pass  # legacy / malformed shapes — skip
        out.append(
            AgentMessageOut(
                id=r.id,
                agent_id=r.agent_id,
                text=r.text,
                trigger=r.trigger,
                citations=cits,
                created_at=r.created_at,
            )
        )
    return out
