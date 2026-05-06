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
    # Held while an identify pass is in flight, so periodic + final calls
    # don't stack up on top of each other.
    identify_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Set when the WebSocket has closed and we want the worker to do one
    # last pass and exit.
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)


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
