"""
In-process per-meeting state.

Phase 1.5 simplification: we run a single backend process, so an in-memory
dict is enough. When we go multi-replica we'll move the PCM buffer to Redis
streams or directly multipart-upload to OSS.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field


@dataclass
class MeetingSession:
    meeting_id: uuid.UUID
    pcm_buffer: bytearray = field(default_factory=bytearray)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_sessions: dict[uuid.UUID, MeetingSession] = {}


def get_or_create(meeting_id: uuid.UUID) -> MeetingSession:
    sess = _sessions.get(meeting_id)
    if sess is None:
        sess = MeetingSession(meeting_id=meeting_id)
        _sessions[meeting_id] = sess
    return sess


def get(meeting_id: uuid.UUID) -> MeetingSession | None:
    return _sessions.get(meeting_id)


def discard(meeting_id: uuid.UUID) -> None:
    _sessions.pop(meeting_id, None)
