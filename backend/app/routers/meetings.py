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
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingTranscript,
    User,
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


def _to_meeting_out(m: Meeting, attendee_user_ids: list[uuid.UUID]) -> MeetingOut:
    return MeetingOut.model_validate(
        {
            "id": m.id,
            "title": m.title,
            "status": m.status,
            "started_at": m.started_at,
            "ended_at": m.ended_at,
            "attendee_user_ids": attendee_user_ids,
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
    await session.commit()
    await session.refresh(m)
    await audit_log(
        session, auth, "meeting.create",
        target_type="meeting", target_id=str(m.id),
        payload={"title": m.title, "attendee_count": len(payload.attendee_user_ids)},
    )
    return _to_meeting_out(m, list(payload.attendee_user_ids))


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
    # Pull attendee user_ids for each meeting in one shot
    ids = [m.id for m in rows]
    rels = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id.in_(ids))
        )
    ).scalars().all()
    by_meeting: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in rels:
        if r.user_id is not None:
            by_meeting.setdefault(r.meeting_id, []).append(r.user_id)
    return [_to_meeting_out(m, by_meeting.get(m.id, [])) for m in rows]


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
            select(MeetingAttendee.user_id).where(
                MeetingAttendee.meeting_id == m.id, MeetingAttendee.user_id.is_not(None)
            )
        )
    ).all()
    return _to_meeting_out(m, [r[0] for r in rows])


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
            select(MeetingAttendee.user_id).where(
                MeetingAttendee.meeting_id == m.id, MeetingAttendee.user_id.is_not(None)
            )
        )
    ).all()
    return _to_meeting_out(m, [r[0] for r in rows])


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
    row = MeetingActionItem(
        meeting_id=m.id,
        workspace_id=m.workspace_id,
        content=payload.content.strip()[:1000],
        assignee_user_id=payload.assignee_user_id,
        due_at=payload.due_at,
        status="open",
        source_type="manual",
    )
    session.add(row)
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
    if payload.status is not None:
        if payload.status not in ("open", "done", "cancelled"):
            raise HTTPException(400, "status must be open|done|cancelled")
        row.status = payload.status
    if payload.content is not None:
        row.content = payload.content.strip()[:1000]
    if payload.due_at is not None:
        row.due_at = payload.due_at
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
        row.assignee_user_id = payload.assignee_user_id
        row.assignee_name_hint = None  # rebound — drop the freeform hint
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
    await session.delete(row)
    await session.commit()


# --------- M3.0: Cowork-friendly Agent message reader -------------------------


class AgentMessageOut(BaseModel):
    id: int
    agent_id: uuid.UUID
    text: str
    trigger: Optional[str] = None
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
    return [
        AgentMessageOut(
            id=r.id,
            agent_id=r.agent_id,
            text=r.text,
            trigger=r.trigger,
            created_at=r.created_at,
        )
        for r in rows
    ]
