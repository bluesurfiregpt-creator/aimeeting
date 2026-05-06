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


# --- People & identity --------------------------------------------------------

class User(Base):
    __tablename__ = "user"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(String(128))
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
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
    name: Mapped[str] = mapped_column(String(128))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    domain: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    persona: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    boundary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    dify_workflow_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    keywords: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)

    version: Mapped[int] = mapped_column(Integer, default=1)
    stage: Mapped[str] = mapped_column(String(16), default="prod")  # test|prod
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- Meetings -----------------------------------------------------------------

class Meeting(Base):
    __tablename__ = "meeting"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
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


# --- Long-term memory (Phase 2) ----------------------------------------------

class LongTermMemory(Base):
    """
    Phase 2 surface. Already declared so migrations stay forward-compatible.
    Embedding dim 1536 fits OpenAI text-embedding-3-small / Qwen text-embedding-v2.
    """
    __tablename__ = "long_term_memory"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=_new_uuid)
    scope: Mapped[str] = mapped_column(String(16))  # user|project|org
    scope_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    source_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
