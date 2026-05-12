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
    # v25.7-#1: 显式邀请的 AI 专家 — 没勾的 AI 不会被自动触发(关键词 / @mention).
    # 之前 agent_router 默认 fallback 全部 active agents → 一个会议被 16+ AI 满天乱蹦.
    attendee_agent_ids: list[uuid.UUID] = []
    agenda: Optional[list[AgendaItem]] = None
    # v26.3: 会议模式 — human / hybrid (默认) / auto
    # mode='auto' 时要求:agenda ≥ 2 项,attendee_agent_ids ≥ 3 个 expert
    mode: str = "hybrid"


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    attendee_user_ids: list[uuid.UUID] = []
    attendee_agent_ids: list[uuid.UUID] = []  # v25.7-#1
    agenda: Optional[list[AgendaItem]] = None
    # v26.3: 会议模式 + auto 调度状态
    mode: str = "hybrid"
    auto_state: Optional[dict] = None


class TranscriptLine(BaseModel):
    # `id` was the original field name (legacy SQLAlchemy column). v11 QA
    # report ISSUE-1 flagged the inconsistency vs. POST /manual-transcript's
    # `line_id` (and the URL param `lid` on /correct-speaker). We now expose
    # BOTH — `line_id` is canonical, `id` stays for one release for back-compat.
    id: int
    line_id: int
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
