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
    # v27.0-mobile P19: 会议 brief — 用户的诉求 / 背景 / 目标 / 期望产出.
    # auto 模式时强烈建议填 (LLM moderator 用这段引导讨论, 否则只看 title 容易抽象)
    description: Optional[str] = None
    # v27.0-mobile P19-B: 会议参考资料 — 前端 在 创建前 已经 通过 /api/meetings/attachments
    # 上传, 拿到 一个 client_draft_id; 创建会议 时 把 这个 id 传上来, 后端 用它
    # 把 draft 下 所有 attachment UPDATE meeting_id=<new>. 创建后 client_draft_id 清空.
    client_draft_id: Optional[str] = None


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
    # v26.14-P5.2: 会议 创建人 — 前端 据此 决定 议程 推进 按钮 是否 可见
    # (跟 backend ABAC 一致: leader+ OR 创建人 可 推进).
    created_by_user_id: Optional[uuid.UUID] = None
    # v27.0-mobile P19: 会议 brief — 前端 详情页 显示给参会者(让 大家 知道 老板 召这个会 想干嘛).
    description: Optional[str] = None


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
