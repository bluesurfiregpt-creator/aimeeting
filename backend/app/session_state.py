"""
In-process per-meeting state.

Phase 1.5 simplification: we run a single backend process, so an in-memory
dict is enough. When we go multi-replica we'll move the PCM buffer to Redis
streams or directly multipart-upload to OSS.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)


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
    # v26.11-fix2: Connected client WebSockets for broadcasting room-level
    # events (eg "agents_invited" — when someone adds a new AI to the meeting,
    # everyone else's room re-renders the avatar gallery).
    # NOTE: we store the raw WebSocket; the per-WS write lock from FastAPI's
    # WebSocket class is enough for our simple broadcast (no concurrent
    # send_text on the same socket).
    clients: set[Any] = field(default_factory=set)


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


# v26.11-fix2: WebSocket 注册 / 注销 / 广播 ——
# 提供 给 ws_stt endpoint (注册 + 注销) 和 invite_agents REST endpoint (广播).
def register_client(meeting_id: uuid.UUID, ws: "WebSocket") -> None:
    """Add a WebSocket to the room broadcast list. Idempotent."""
    sess = get_or_create(meeting_id)
    sess.clients.add(ws)


def unregister_client(meeting_id: uuid.UUID, ws: "WebSocket") -> None:
    """Remove a WebSocket from the broadcast list. Safe if not registered."""
    sess = get(meeting_id)
    if sess is None:
        return
    sess.clients.discard(ws)


async def broadcast(meeting_id: uuid.UUID, payload: dict) -> None:
    """Send a JSON payload to every connected WS in this meeting.

    Failures are swallowed per-client (the client may have already
    disconnected without our finally-block running yet); we just remove
    the dead socket so the next broadcast skips it.
    """
    sess = get(meeting_id)
    if sess is None or not sess.clients:
        return
    msg = json.dumps(payload, ensure_ascii=False)
    dead: list[Any] = []
    # snapshot — set may be mutated by unregister_client during the iteration
    for ws in list(sess.clients):
        try:
            await ws.send_text(msg)
        except Exception as exc:
            logger.warning(
                "broadcast send failed; dropping client (meeting=%s err=%s)",
                meeting_id,
                exc,
            )
            dead.append(ws)
    for ws in dead:
        sess.clients.discard(ws)
