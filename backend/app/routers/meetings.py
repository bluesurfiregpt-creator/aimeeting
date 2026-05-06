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
from ..db import get_session
from ..identify_pipeline import run_identify
from ..models import Meeting, MeetingAttendee, MeetingTranscript, User
from ..schemas import MeetingCreate, MeetingOut, MeetingResultOut, TranscriptLine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meetings", tags=["meetings"])


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
async def create_meeting(payload: MeetingCreate, session: AsyncSession = Depends(get_session)):
    m = Meeting(title=payload.title or "未命名会议", status="scheduled")
    session.add(m)
    await session.flush()
    for uid in payload.attendee_user_ids:
        session.add(MeetingAttendee(meeting_id=m.id, user_id=uid))
    await session.commit()
    await session.refresh(m)
    return _to_meeting_out(m, list(payload.attendee_user_ids))


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(meeting_id: str, session: AsyncSession = Depends(get_session)):
    m = (await session.execute(select(Meeting).where(Meeting.id == meeting_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")
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
):
    m = (await session.execute(select(Meeting).where(Meeting.id == meeting_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")
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
):
    """
    Manually re-attribute a transcript line to a specific user (or unset).

    Per blueprint §5.3: corrections are kept distinct from auto-recognized
    rows via the `speaker_status` column ('manually_corrected') so we can
    later regress identification quality on the corrected vs. auto split.
    """
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
            await session.execute(select(User).where(User.id == payload.speaker_user_id))
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
async def get_result(meeting_id: str, session: AsyncSession = Depends(get_session)):
    m = (await session.execute(select(Meeting).where(Meeting.id == meeting_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")

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
