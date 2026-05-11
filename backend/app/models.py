"""
Core ORM models per blueprint §6.

Key design choices:
- meeting_attendee unifies humans (user_id) and AI agents (agent_id) — downstream
  code never branches on "is this a human?".
- meeting_transcript (ASR sentences) and meeting_speaker_segment (voiceprint
  segments) are deliberately separated — alignment happens at read time so
  upgrading one side never pollutes the other.
- voiceprint is versioned per user; we keep history rather than overwrite.
- long_term_memory carries scope (user/project/org) plus a pgvector embedding
  for RAG retrieval.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _new_uuid() -> uuid.UUID:
    return uuid.uuid4()


# --- Workspace (multi-tenant root) -------------------------------------------

class Workspace(Base):
    """
    One workspace = one organization / tenant. Every business row carries
    workspace_id, and queries are filtered by the requesting user's
    membership. The "默认工作空间" row is auto-created on first migration
    so pre-Sprint-F data has a home.
    """
    __tablename__ = "workspace"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(String(128))
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    # v17: workspace preset — selects which subsystems are enabled and how they
    # behave. NULL = "general" (default Aimeeting form: meeting-centric, simple
    # notifications, flat roles). Reserved values:
    #   - "general"            (= NULL, default; current Aimeeting behavior)
    #   - "smart_construction" (智慧住建: 16-AI 集群 + 三级催办 + 5 级数据分级
    #                          + 专家/领导角色二分 + 6 种触发源)
    # Each subsystem reads `workspace.preset` at request time to decide its
    # behavior, so the same code path serves all presets — no fork.
    preset: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceMembership(Base):
    """A user's role in a workspace. Sprint F.1 makes this truly N:M —
    multiple users can join the same workspace via invitations."""
    __tablename__ = "workspace_membership"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # v21: role 枚举扩展.
    #   owner / admin — 「领导权限」(全局俯瞰 + 调度,继承 v17 语义)
    #   leader        — owner/admin 的别名,智慧住建偏好这个词;权限同 admin
    #   expert        — 「专家权限」:操作范围限制在所绑定的单一 AI 专家
    #                   (智慧住建 16 AI 集群里,一个科员对应一个 AI 专家);
    #                   必须填 bound_agent_id
    #   member        — legacy,默认值,保留向后兼容(v17-v20 用户都是这个)
    role: Mapped[str] = mapped_column(String(16), default="member")
    # v21: expert 角色的「绑定 AI 专家」.其他 role 应为 NULL.
    # ondelete=SET NULL — agent 被删时不连带踢人,但 expert 会失去 scope,
    # API 入口处会拦下并提示「请联系管理员重新绑定专家」.
    bound_agent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("agent.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceInvitation(Base):
    """
    A pending invite for someone to join a workspace. The opaque `token` is
    handed to the invitee out-of-band (email link, shared via IM, etc.) and
    they redeem it via /register?invite=<token>. Single-use: `accepted_at`
    is set on first redemption.
    """
    __tablename__ = "workspace_invitation"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(16), default="member")
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    """
    Single-use password reset token. Issued via /api/auth/forgot-password,
    redeemed via /api/auth/reset-password. We don't have SMTP wired yet
    so the link is logged server-side; ops copies it manually until then.
    """
    __tablename__ = "password_reset_token"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- People & identity --------------------------------------------------------

class User(Base):
    __tablename__ = "user"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(String(128))
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Auth (Sprint F): password_hash null means this is a "speaker-only"
    # user — created during voiceprint enrollment, can't log in. Real
    # accounts get a hash.
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # v24.3 #3 — 暂停派单截止时间(智慧住建文档 §4.4 重大超时治理 — 连续 2 次
    # 重大超时 → suspended_until = now + 7d).派发时检查;过期自动恢复.
    # NULL = 未暂停;过去时间 = 已自动恢复.
    suspended_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # v24.3 #5 — ABAC 雏形(智慧住建文档 §5):用户属性,供未来基于属性的访问控制使用.
    # department:科室名(房屋安全管理与整治科 / 物业监管科 ...),目前只是显示 + 入
    # audit_log 上下文,未来 access_control.can_access 可据此判定(如核心数据
    # 只允许同科室访问).level / location 等可后续加进 attributes JSON.
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    attributes: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # Convenience pointer to the user's primary workspace (the one they see
    # by default after login). Real authorization is via workspace_membership.
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    voiceprints: Mapped[list["Voiceprint"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Voiceprint(Base):
    """
    Each user can hold multiple versioned voiceprints; the active one is the
    most-recently-active row per user. We keep history so we can A/B identify
    after re-enrollment without throwing away prior data.
    """
    __tablename__ = "voiceprint"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"))

    pyannote_id: Mapped[str] = mapped_column(String(128))  # the voiceprint id from pyannoteAI
    pyannote_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    sample_oss_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    sample_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="voiceprints")


# --- Agents (Phase 1.5) -------------------------------------------------------

class Agent(Base):
    """
    Per blueprint §4.1: an Agent is persona + tools + memory + KB + version.
    We persist persona-as-fields here; the Dify Workflow ID is what we hand off
    to at runtime.
    """
    __tablename__ = "agent"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(128))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    domain: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    persona: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    boundary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Dify integration: each agent in our DB maps to a Dify app or workflow.
    # We store the full base url + the app api-key so a single backend can
    # talk to several Dify workspaces / cloud + self-hosted in parallel.
    dify_app_type: Mapped[str] = mapped_column(String(16), default="chatflow")  # chatflow|workflow|agent
    dify_base_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    dify_api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    dify_workflow_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    keywords: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)  # accent for UI bubbles
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Sprint I: knowledge bases this agent is allowed to cite. Stored as a
    # native pg UUID[] so we can do ANY/contains queries without a join
    # table (multiplicity is small — typically 0-5 KBs per agent).
    knowledge_base_ids: Mapped[Optional[list[uuid.UUID]]] = mapped_column(
        ARRAY(PgUUID(as_uuid=True)), nullable=True
    )
    # M3.0 (Multi-Agent V2): "expert" is the default — user-configurable domain
    # specialist. "moderator" is the auto-created built-in per workspace, used
    # by agenda_monitor for off-topic / time-warning / stuck banners. UI hides
    # the delete button + Dify fields for moderators.
    role: Mapped[str] = mapped_column(String(16), default="expert")  # expert | moderator

    version: Mapped[int] = mapped_column(Integer, default=1)
    stage: Mapped[str] = mapped_column(String(16), default="prod")  # test|prod
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- Meetings -----------------------------------------------------------------

class Meeting(Base):
    __tablename__ = "meeting"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="未命名会议")
    status: Mapped[str] = mapped_column(String(16), default="scheduled")  # scheduled|ongoing|finished|processed
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    recording_oss_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    pyannote_job_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    summary_md: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # M3.0: agenda is a list of {title: str, time_budget_min?: int, note?: str}.
    # When present, agenda_monitor LLM-watches transcript drift + time pacing
    # and pushes "off topic" / "time warning" banners via the moderator agent.
    # When absent (None), no monitoring runs (legacy meetings stay untouched).
    agenda: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    attendees: Mapped[list["MeetingAttendee"]] = relationship(back_populates="meeting", cascade="all, delete-orphan")
    transcripts: Mapped[list["MeetingTranscript"]] = relationship(back_populates="meeting", cascade="all, delete-orphan")
    speaker_segments: Mapped[list["MeetingSpeakerSegment"]] = relationship(back_populates="meeting", cascade="all, delete-orphan")


class MeetingAttendee(Base):
    """
    Either user_id or agent_id is set, never both. The CHECK is enforced in the
    migration via a CHECK constraint on the column pair.
    """
    __tablename__ = "meeting_attendee"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id", name="uq_meeting_user"),)

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    meeting_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("meeting.id", ondelete="CASCADE"))
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(PgUUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    agent_id: Mapped[Optional[uuid.UUID]] = mapped_column(PgUUID(as_uuid=True), ForeignKey("agent.id"), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    meeting: Mapped[Meeting] = relationship(back_populates="attendees")


class MeetingTranscript(Base):
    """One ASR sentence (字句级时间戳)."""
    __tablename__ = "meeting_transcript"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    meeting_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("meeting.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    start_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=True)

    # Resolved at align-time, not on insert. Speaker label is "auto_recognized"
    # or "manually_corrected"; UNKNOWN before resolution.
    speaker_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(PgUUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    speaker_label: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    speaker_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meeting: Mapped[Meeting] = relationship(back_populates="transcripts")


class MeetingAgentMessage(Base):
    """An AI-expert utterance inside a meeting (in response to @ or keyword)."""
    __tablename__ = "meeting_agent_message"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("meeting.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("agent.id"))
    text: Mapped[str] = mapped_column(Text)
    trigger: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # at_mention|keyword|manual
    trigger_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # v24.3 #1: 引用溯源 — RAG 检索命中的 KB chunks(智慧住建文档 §3.1).
    # 格式: [{chunk_id, document_id, document_filename, chunk_index,
    #        snippet (<= 240 chars), distance}, ...]
    # 长期记忆引用(LongTermMemory)留 v25 也并入此处.
    citations: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskPenalty(Base):
    """
    v24.3 #3 — 任务超时扣分事件(智慧住建文档 §4.4 超时治理).

    每条 task × user × severity 最多一行(UNIQUE),避免重复扣分.
    score_delta:
      - severe (3-7d 超时):  -3
      - major  (>7d 超时):   -5
    连续 2 次 major 触发 user.suspended_until = now + 7d(暂停派单).
    """
    __tablename__ = "task_penalty"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "user_id", "severity",
            name="uq_penalty_task_user_severity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("task.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    severity: Mapped[str] = mapped_column(String(16))  # 'severe' | 'major'
    score_delta: Mapped[int] = mapped_column(Integer)  # 负数:-3 / -5
    days_overdue: Mapped[int] = mapped_column(Integer)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class MeetingActionItem(Base):
    """
    M3.0 Multi-Agent V2: a single tracked TODO from a meeting.

    Auto-extracted by `action_extractor` after summary generation, optionally
    edited / added manually via the UI. Carries forward into the next meeting's
    会前简报 (briefing_generator pulls open items into the briefing markdown so
    the opener sees "上次会议有 N 个未完成").
    """
    __tablename__ = "meeting_action_item"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("meeting.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(Text)
    # Set when extractor matched the assignee text to a known workspace user;
    # otherwise we keep the raw name in `assignee_name_hint` so the human can
    # rebind via the UI later. Either may be None for un-assigned tasks.
    assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    assignee_name_hint: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | done | cancelled
    source_type: Mapped[str] = mapped_column(String(16), default="summary")  # summary | manual | agent
    # v17: every meeting-origin action item is also a Task (1:1). On insert we
    # write both rows; on update we mirror status/content/assignee/due to Task.
    # Old rows backfilled in init_db.py. Nullable for safety during the
    # transition window (post-backfill should be NOT NULL — enforce in v18).
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("task.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # v25.15: 实录依据 — action_extractor 抽出待办时,记下纪要/实录中的支撑句.
    # 让用户/leader 看 "为什么生成这条待办" — 闭环里的关键透明度.
    # 也写到 dual-write 的 Task.source_ref.evidence_quote 让任务详情页能取到.
    evidence_quote: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MeetingActionItemComment(Base):
    """
    Theme 1 (P0) progress note on an action item. Append-only — entries
    are deletable by their author but not editable (per product decision:
    "comment history not tampered" beats "fix typo" for accountability).

    Triggers an `action_comment` notification for everyone touching this
    action besides the comment author (assignee + prior commenters).
    """
    __tablename__ = "meeting_action_item_comment"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    action_item_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("meeting_action_item.id", ondelete="CASCADE"),
        index=True,
    )
    # Author is set on insert; if the author user is later deleted we keep
    # the comment but null the FK so we don't dangle. UI shows "(已删除用户)".
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Task(Base):
    """
    v17 (Theme 1 → 智慧住建 翻译层): the workspace-level task / 工单 /
    work order — a unit of work that:

      - has a clear owner (assignee), a deadline (due_at), and a state,
      - can come from many places (会议决议 / 领导指令 / 上级文件 / 定期巡检 /
        异常预警 / 问题上报 / manual),
      - has an audit trail of comments, status changes, and notifications.

    v17 scope: parallel to MeetingActionItem. Every meeting-extracted /
    manual ActionItem creates a Task row 1:1 (mirroring status / content /
    assignee / due_at). New read paths (e.g. GET /api/me/tasks, future
    cross-source dashboards) should query this table; legacy paths still
    use ActionItem until v18 cuts them over.

    State machine (v19 · 8 states, full lifecycle):

        open ──dispatch──▶ dispatched ──accept──▶ accepted ──start──▶ in_progress
                                │                                          │
                                │ return                                   │ submit
                                ▼                                          ▼
                              open                                    submitted
                                                                          │
                                                                ┌─────────┴────────┐
                                                              approve            reject
                                                                │                  │
                                                                ▼                  ▼
                                                              done            in_progress
                                                                │
                                                                │ archive
                                                                ▼
                                                             archived

      Plus universal `cancelled` from any active state.

    The legacy ActionItem mirror collapses Task states down to
    {open, done, cancelled} — when Task moves through dispatched /
    accepted / in_progress / submitted, the paired ActionItem stays
    at 'open' (its UI doesn't know these states); archived collapses
    to 'done'. Mirror logic lives in task_state.py.

    `source_type`:
      meeting           — extracted from a meeting (action_extractor) or
                          added in the meeting page UI; source_ref carries
                          {meeting_id, action_item_id}
      manual            — manually created outside any meeting (v18+ UX)
      leader_directive  — natural-language instruction from a leader
                          (v19); source_ref carries {directive_id}
      upper_doc         — extracted from an uploaded 上级文件 (v20);
                          source_ref carries {upper_doc_id, filename}
      cron              — periodic 巡检 (v20); source_ref carries
                          {rule_id, fired_at}
      alert             — triggered by an indicator threshold (v21+)
      report            — user-submitted issue report (v21+)
    """
    __tablename__ = "task"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    # Optional short title; for ActionItem-mirrored tasks we leave NULL and
    # the UI uses the first ~40 chars of `content`.
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    # v21: 数据 5 级分级.决定谁能看 / 跨 AI 共享是否需审批.默认 'general'.
    #   core      — 危害国家安全/公共利益;领导 + 核心管理员查看,一事一议审批
    #   important — 影响公众权益;admin 以上查看,leader 审批
    #   sensitive — 较敏感业务;本 AI 专家权限用户查看,跨 AI 需授权
    #   general   — 中度敏感;局内人员可查看(默认)
    #   public    — 内部/公开;无条件共享
    data_classification: Mapped[str] = mapped_column(String(16), default="general", index=True)
    # v18 state-machine timestamps. Each is set when the corresponding
    # transition fires and never cleared (audit trail). NULL means
    # "transition hasn't happened yet". `dispatched_by_user_id` carries
    # the dispatcher (typically a leader / admin); accepted_at /
    # started_at are stamped when the assignee acts.
    dispatched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # v22.5: 多 AI 协作 — 协办用户 id 列表(最多 5 个,validated in routers).
    # assignee_user_id 仍是「主责」语义.协办收到 task_co_assigned 通知,可调
    # /co-submit 提交进度;主责 submit 时若有协办未交,默认 422 警告(可
    # force=true 硬过).Empty list / None 时退化为 v22 单 assignee 流程.
    # 用 JSON 而不是关联表换简洁性(协办最多 5 个,N+1 查询不是问题).
    co_assignees: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="manual", index=True)
    # JSON pointer back to the originating object — schema varies by
    # source_type (see class docstring). Always set, never NULL: even
    # source_type='manual' has source_ref={"created_via": "..."} so we
    # can audit how a Task got created.
    source_ref: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LeaderDirective(Base):
    """
    v19 — 领导指令(自然语言指令).

    Workflow:
      1. POST /api/me/directives {content}
         → directive_parser.py LLM-parses → returns draft Tasks (cached)
         → row written with status='draft', parsed_drafts=[...]

      2. User reviews / edits / deletes drafts in the UI.

      3. POST /api/me/directives/{did}/commit {tasks: [...]}
         → for each Task, write a Task row (source_type='leader_directive',
           source_ref={directive_id})
         → optionally dispatch immediately if `dispatch=true`
         → directive.status='committed', committed_task_ids=[...]

      4. POST /api/me/directives/{did}/discard
         → directive.status='discarded'; no Tasks created.

    Why a separate table (vs just creating Tasks directly):
      - We want a **traceable audit** of "this Task came from this指令";
        the user can later ask "show me everything from 王科长 last week"
      - The LLM parse is non-trivial (5-15s) and worth caching to skip
        if the user navigates away and comes back to the draft modal
      - Drafts let the user edit/discard without polluting Task table
        with rows they later regret
    """
    __tablename__ = "leader_directive"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    # The raw natural-language directive the user typed.
    content: Mapped[str] = mapped_column(Text)
    # LLM-parsed Task drafts, cached to avoid re-parsing on revisit. Each
    # element: {content, title?, assignee_name?, assignee_user_id?, due_at?}.
    # ISO date strings, not datetime objects (JSON-serializable).
    parsed_drafts: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    # draft (LLM parsed, awaiting user) | committed (Tasks written) | discarded (user dropped)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    # After commit, the Task ids that were created (for traceability and "show
    # me what this directive produced" queries).
    committed_task_ids: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    # If the LLM parse fails we still write the row so the UI can show an
    # error state — store the message here.
    parse_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UpperDoc(Base):
    """
    v20 — 上级文件触发源.

    Workflow:
      1. POST /api/me/upper-docs (multipart, file upload)
         → doc_parser.extract_text() → save extracted_text
         → directive_parser.parse_directive(extracted_text) → drafts
         → row status='draft', parsed_drafts=[...]
      2. User reviews / edits drafts in DirectivePanel(共用)
      3. POST /api/me/upper-docs/{id}/commit {tasks: [...]}
         → write Task rows (source_type='upper_doc', source_ref={upper_doc_id, filename})
      4. POST /api/me/upper-docs/{id}/discard

    NOTE — UpperDoc 不入知识库:本表只为「文件触发了哪些 Task」做溯源.
    若用户想把同一份文件加入知识库供 AI 召回,走独立的 KB 上传路径
    (KnowledgeDocument).解耦的好处:
      - 一份文件可能只是「下个临时通知」,不该污染长期知识库
      - 知识库需要 chunking + embedding + 向量索引,这里不需要
    """
    __tablename__ = "upper_doc"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    byte_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # 截取的纯文本(LLM 拆解的输入)。大文件会截断到合理上限,见 routers 端实现。
    extracted_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parsed_drafts: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    # draft | committed | discarded | failed
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    committed_task_ids: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    parse_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CronRule(Base):
    """
    v20 — 定期巡检触发源.

    一条规则定义「每隔多久 / 在什么时间点 / 自动建一个 Task」.
    例:
      - name='每周一安全巡检',cron_expr='0 9 * * 1'(每周一上午9点)
      - task_template_content='提交本周小散工程现场巡查报告'
      - task_template_assignee_user_id=<王科长 uuid>
      - auto_dispatch=true(直接 dispatched 状态,跳过 open)

    后台 cron_runner.py 每分钟 tick,匹配的就 instantiate 一个 Task
    (source_type='cron', source_ref={rule_id, fired_at}).

    cron_expr 简化版(不引入 croniter 依赖):支持 `分 时 日 月 周` 五段
    标准格式,每段可以是数字、`*`、或逗号分隔的多个数字。详见
    cron_runner.py 的 _matches() 实现.
    """
    __tablename__ = "cron_rule"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128))
    cron_expr: Mapped[str] = mapped_column(String(64))
    task_template_content: Mapped[str] = mapped_column(Text)
    task_template_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    task_template_assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    # 触发时直接派发(open → dispatched)还是只入库为 open
    auto_dispatch: Mapped[bool] = mapped_column(Boolean, default=False)
    # 给 Task 加多少天截止日?NULL = 不设 due_at
    due_days_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fire_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskEvaluation(Base):
    """
    v22 — 月度任务评价归档.

    智慧住建文档「四.5 考核评价」要求的 4 维评价:
      - completion_rate (30%)  完成率:已 done / 总分配
      - on_time_rate    (30%)  及时率:done 时 ≤ due_at / 总 done
      - quality_score   (20%)  质量评分:领导对 done Task 的打分(1-5)平均
      - collaboration_score (20%) 协作评分:协办方对主责打分(1-5)平均(v22.5 多 AI 协作上线后才有真数据)

    每月一行 per (workspace, assignee_user_id, period='YYYY-MM').
    定时任务(v23+ 加 cron)月底自动算并 insert/update;v22 提供
    `seed-eval-data` admin endpoint 让运营生成测试数据.

    四个分数都是 0.0-1.0 浮点,总分 = 0.3*c + 0.3*o + 0.2*q + 0.2*col.
    """
    __tablename__ = "task_evaluation"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "assignee_user_id", "period",
            name="uq_eval_ws_user_period",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    assignee_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # 'YYYY-MM' 形式的周期 key,便于 ORDER BY 时间排序 + UNIQUE 约束.
    period: Mapped[str] = mapped_column(String(7), index=True)
    completion_rate: Mapped[float] = mapped_column(Float, default=0.0)
    on_time_rate: Mapped[float] = mapped_column(Float, default=0.0)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)
    collaboration_score: Mapped[float] = mapped_column(Float, default=0.0)
    # 累计指标,跑评价时一起算 + 缓存,避免每次看板请求都重算
    total_assigned: Mapped[int] = mapped_column(Integer, default=0)
    total_done: Mapped[int] = mapped_column(Integer, default=0)
    total_overdue: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskCoProgress(Base):
    """
    v22.5 — 协办方提交的进度 / 最终交付.

    简化:每个协办对每个 Task 最多一行(最新的覆盖之前的 — 通过 UPSERT
    on UNIQUE).不区分「中间进度」和「最终交付」,统一作为「我交了」标记.
    主责 submit 检查时只看是否有这一行就行.

    生命周期:
      - 协办 POST /tasks/{tid}/co-submit { content }
        → INSERT or UPDATE 一行(content 是简短交付说明)
        → 通知主责 task_co_submitted
      - 协办 POST /tasks/{tid}/co-withdraw
        → DELETE 该行(若存在)+ Task.co_assignees 数组里移除该 user_id
        → 通知主责 task_co_withdrawn
    """
    __tablename__ = "task_co_progress"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "co_assignee_user_id",
            name="uq_co_progress_task_user",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    task_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("task.id", ondelete="CASCADE"), index=True
    )
    co_assignee_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TaskCollaborationRating(Base):
    """
    v22.5 — 协作评分(原子事件).

    场景:approve_task 后,主责 / 领导 弹出评分对话框,对 Task 上每个
    相关人(主责自己 + 协办们 + dispatcher)打分.分数维度:
      - quality       质量分(1-5,通常领导→主责)
      - collaboration 协作分(1-5,主责↔协办 双向)

    对每个 (task, rater, ratee, dimension) 组合最多一条 — UPSERT.

    每次写入触发 task_evaluation 月度重算(见 services/evaluation.py).
    Q4 决策:双向评分 — 主责 / 协办都能给对方打协作分,看板雷达数据
    更立体.
    """
    __tablename__ = "task_collaboration_rating"
    __table_args__ = (
        UniqueConstraint(
            "task_id", "rater_user_id", "ratee_user_id", "dimension",
            name="uq_rating_task_rater_ratee_dim",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    task_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("task.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    rater_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    ratee_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # 'quality' | 'collaboration'
    dimension: Mapped[str] = mapped_column(String(16), index=True)
    score: Mapped[int] = mapped_column(Integer)  # 1-5
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class DataAccessRequest(Base):
    """
    v21 — 跨 AI 数据访问申请.

    场景:智慧住建里,「房屋安全 AI 专家」想看「物业监管 AI 专家」的某条
    敏感数据(data_classification ∈ {sensitive, important, core}).系统
    不直接放行,而是包一个审批流:

      1. expert A 发起 POST /api/me/access-requests
         { target_resource_type, target_resource_id, justification }
         → 写一行 DataAccessRequest(status='pending')
         → 通知目标资源的 owner / workspace admin

      2. 审批人(owner / admin / leader) POST /api/me/access-requests/{id}/approve
         { approval_window_hours? }(默认 24h)
         → status='approved', decided_at + decided_by 填上, expires_at 填上
         → 通知申请人 access_approved

      3. 申请人在 expires_at 之前再访问目标资源:
         系统读 DataAccessRequest 找到这条 approved + 未过期记录, 放行
         否则 403

      4. 审批人也可 reject(必须填 reason),通知申请人 access_rejected

    数据分级查询时的检查链(v21 简化版):
      - expert 看自己 bound_agent 范围内的资源 → 全放行(只受分级垂直限制)
      - expert 看 NOT 自己 bound 的资源:
          public/general → 放行
          sensitive/important/core → 必须有有效 access_request

    访问决策点(中央化):services/access_control.py 的 `can_access()`
    helper, 各 router 在拉资源后立刻调.
    """
    __tablename__ = "data_access_request"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    requester_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # 目标资源类型 + id.目前支持 'task' | 'kb_document' | 'memory' | 'agent'.
    # 'agent' 用于「我想跨入 X AI 专家的整片数据范围」类粗粒度授权(v22+).
    target_resource_type: Mapped[str] = mapped_column(String(32), index=True)
    target_resource_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), index=True)
    # 资源所属人 / 该 Agent 的 owner.审批通知发给他.
    target_owner_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    justification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # pending | approved | rejected | expired
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    decision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Notification(Base):
    """
    Theme 1 (P0) in-app notification. Bell badge / drawer reads this table.

    `kind` controls how the UI formats the message:
      - 'action_assigned'  payload: {meeting_id, meeting_title, action_id, content}
      - 'action_due_soon'  payload: {meeting_id, action_id, content, due_at}
      - 'action_overdue'   payload: {meeting_id, action_id, content, due_at, days_overdue}
      - 'action_comment'   payload: {meeting_id, action_id, action_content,
                                     comment_preview, author_name}

    Cron-generated kinds (due_soon / overdue) dedup per (user, action, kind)
    within 24h via a SELECT-then-INSERT in code, so the bell doesn't fill
    with duplicates over multiple cron ticks.
    """
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32), index=True)
    # v18: severity escalates the visual treatment + (future) channel
    # routing of the notification. Cron-generated reminders set this:
    #   normal — default, all event-driven kinds (assigned / comment)
    #   yellow — due_soon (within 3 days) — bell + (later) WeChat work
    #   red    — overdue, days_overdue < 3 — bell + WeChat + SMS
    #   purple — overdue, days_overdue >= 3 — also notifies workspace
    #            admins/owners; bell + WeChat + SMS + email
    severity: Mapped[str] = mapped_column(String(16), default="normal", index=True)
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class MeetingSpeakerSegment(Base):
    """One pyannoteAI speaker segment (0.5–N s)."""
    __tablename__ = "meeting_speaker_segment"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    meeting_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("meeting.id", ondelete="CASCADE"), index=True)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(64))  # pyannote returns this; matches a voiceprint
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(PgUUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="auto_recognized")  # auto_recognized|manually_corrected

    meeting: Mapped[Meeting] = relationship(back_populates="speaker_segments")


# --- Model provider configuration --------------------------------------------

class ModelProviderConfig(Base):
    """
    User-editable LLM provider config. Holds API keys, base URLs, and the
    chosen default model id per provider. Exactly zero or one row should have
    `is_active=True` — that's the provider direct LLM calls (summary, briefing,
    memory extraction) use until Dify is in front of everything.
    """
    __tablename__ = "model_provider_config"
    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="uq_workspace_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(32))  # 'qwen' | 'openai' | ...
    api_key: Mapped[str] = mapped_column(Text)
    base_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    model_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# --- Audit log (Sprint F) -----------------------------------------------------

class AuditLog(Base):
    """Append-only log of state-changing actions. Populated by route helpers
    (Sprint F adds the table + a helper; deeper integration comes later)."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64))  # 'meeting.create' | 'agent.update' | ...
    target_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# --- Knowledge base (Sprint I) -----------------------------------------------

class KnowledgeBase(Base):
    """
    A workspace-scoped collection of uploaded documents that AI experts can
    cite. Each KB belongs to exactly one workspace; an Agent can be bound
    to N KBs via Agent.knowledge_base_ids.
    """
    __tablename__ = "knowledge_base"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KnowledgeDocument(Base):
    """
    One uploaded file (PDF/DOCX/TXT/MD). The raw bytes live in OSS;
    extracted plain text + chunks live here.

    status lifecycle: uploading → parsing → embedding → ready (or failed)
    """
    __tablename__ = "knowledge_document"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    kb_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("knowledge_base.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    # v23.5+: 128 才放得下 .docx/.xlsx/.pptx 的 Office Open XML mime
    # (e.g. 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = 70 chars).
    # 原 64 太紧,Word/PPT/Excel 上传统一 500.init_db ALTER 迁移现有表.
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    oss_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    byte_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="uploading")
    char_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # v21: 数据 5 级分级.同 Task.data_classification 的语义.
    data_classification: Mapped[str] = mapped_column(String(16), default="general", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class KnowledgeChunk(Base):
    """
    One chunk of text extracted from a KnowledgeDocument, with its 1536-d
    embedding. We denormalize kb_id so the cosine-distance query can filter
    cheaply by which KBs the calling Agent is bound to without a join.
    """
    __tablename__ = "knowledge_chunk"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    document_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("knowledge_document.id", ondelete="CASCADE"), index=True
    )
    kb_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("knowledge_base.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)


# --- Long-term memory (Phase 2) ----------------------------------------------

class LongTermMemory(Base):
    """
    Phase 2 surface. Already declared so migrations stay forward-compatible.
    Embedding dim 1536 fits OpenAI text-embedding-3-small / Qwen text-embedding-v2.
    """
    __tablename__ = "long_term_memory"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workspace.id", ondelete="CASCADE"), nullable=True, index=True
    )
    scope: Mapped[str] = mapped_column(String(16))  # user|project|org
    scope_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    source_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)
    # v21: 数据 5 级分级.同 Task.data_classification 的语义.
    data_classification: Mapped[str] = mapped_column(String(16), default="general", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
