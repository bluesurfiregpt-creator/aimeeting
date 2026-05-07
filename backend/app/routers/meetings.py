from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import session_state
from ..audit import audit_log
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..identify_pipeline import run_identify
from ..models import Meeting, MeetingAttendee, MeetingTranscript, User
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
