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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceMembership(Base):
    """A user's role in a workspace. For Sprint F we keep it 1:1 in practice
    (one workspace per user) but the schema is N:M-ready for future invites."""
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
    role: Mapped[str] = mapped_column(String(16), default="member")  # owner|admin|member
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
