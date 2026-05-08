from __future__ import annotations
from datetime import datetime
from typing import Optional
import uuid

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    email: Optional[str] = None
    has_voiceprint: bool = False
    created_at: datetime


class VoiceprintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID
    pyannote_id: str
    sample_seconds: Optional[float] = None
    version: int
    is_active: bool
    created_at: datetime


class AgendaItem(BaseModel):
    """One row in Meeting.agenda — drives the M3.0 agenda monitor."""
    title: str
    time_budget_min: Optional[int] = None
    note: Optional[str] = None


class MeetingCreate(BaseModel):
    title: Optional[str] = "未命名会议"
    attendee_user_ids: list[uuid.UUID] = []
    agenda: Optional[list[AgendaItem]] = None


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    attendee_user_ids: list[uuid.UUID] = []
    agenda: Optional[list[AgendaItem]] = None


class TranscriptLine(BaseModel):
    id: int
    text: str
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None
    speaker_user_id: Optional[uuid.UUID] = None
    speaker_label: Optional[str] = None
    speaker_name: Optional[str] = None
    speaker_status: Optional[str] = None
    confidence: Optional[float] = None


class MeetingResultOut(BaseModel):
    meeting: MeetingOut
    lines: list[TranscriptLine]
    identification_status: str  # "pending" | "running" | "ready" | "skipped" | "failed"
    identification_message: Optional[str] = None
