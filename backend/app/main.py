from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update

from .config import get_settings
from .db import SessionLocal
from .identify_pipeline import identify_worker
from .init_db import init_db
from .models import Meeting, MeetingTranscript
from .agent_router import invoke_agent_directly, maybe_invoke_agents
from .routers import agents as agents_router
from .routers import meetings as meetings_router
from .routers import model_providers as model_providers_router
from .routers import users as users_router
from .routers import voiceprints as voiceprints_router
from . import session_state
from .stt_client import FunASRClient

logger = logging.getLogger(__name__)
settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Aimeeting Backend", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router.router)
app.include_router(voiceprints_router.router)
app.include_router(meetings_router.router)
app.include_router(agents_router.router)
app.include_router(model_providers_router.router)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "env": settings.app_env}


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket):
    """
    Realtime STT pipe. Now also:
    - persists each finalized ASR sentence to meeting_transcript
    - buffers raw PCM into the per-meeting in-memory session for post-meeting
      voiceprint identification

    Query: meeting_id=<uuid>  (required to persist; if absent we run in
    legacy "demo" mode without DB writes — handy for /meeting/demo).
    """
    await ws.accept()

    meeting_id_raw = ws.query_params.get("meeting_id")
    meeting_uuid: uuid.UUID | None = None
    if meeting_id_raw and meeting_id_raw not in {"demo", "test"}:
        try:
            meeting_uuid = uuid.UUID(meeting_id_raw)
        except ValueError:
            await ws.send_text(json.dumps({"type": "system", "msg": "invalid meeting_id"}))
            await ws.close()
            return

    sess = session_state.get_or_create(meeting_uuid) if meeting_uuid else None
    # Reset stop_event in case this session was reused after a previous WS run.
    if sess is not None:
        sess.stop_event.clear()

    if meeting_uuid is not None:
        async with SessionLocal() as db:
            m = (
                await db.execute(select(Meeting).where(Meeting.id == meeting_uuid))
            ).scalar_one_or_none()
            if not m:
                await ws.send_text(json.dumps({"type": "system", "msg": "meeting not found"}))
                await ws.close()
                return
            if m.status in {"scheduled"}:
                await db.execute(
                    update(Meeting)
                    .where(Meeting.id == meeting_uuid)
                    .values(status="ongoing", started_at=datetime.now(timezone.utc))
                )
                await db.commit()

    async def push_agent_event(payload: dict) -> None:
        try:
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception:
            logger.exception("ws agent event send failed")

    async def emit(text: str, is_final: bool, start_ts, end_ts) -> None:
        try:
            await ws.send_text(
                json.dumps(
                    {"type": "transcript", "text": text, "is_final": is_final,
                     "start_ts": start_ts, "end_ts": end_ts},
                    ensure_ascii=False,
                )
            )
        except Exception:
            logger.exception("ws send failed")
        if is_final and meeting_uuid is not None:
            try:
                async with SessionLocal() as db:
                    db.add(
                        MeetingTranscript(
                            meeting_id=meeting_uuid,
                            text=text,
                            start_ms=int(start_ts) if start_ts is not None else None,
                            end_ms=int(end_ts) if end_ts is not None else None,
                            is_final=True,
                        )
                    )
                    await db.commit()
            except Exception:
                logger.exception("persist transcript failed")
            # Fire-and-forget agent invocation. Errors inside are already
            # logged + relayed as a chunk message; we don't want to block
            # the next ASR sentence on Dify latency.
            asyncio.create_task(
                maybe_invoke_agents(meeting_uuid, text, on_message=push_agent_event)
            )

    async def notify_speakers_updated() -> None:
        try:
            await ws.send_text(json.dumps({"type": "speakers_updated"}))
        except Exception:
            pass

    worker_task: asyncio.Task | None = None
    if meeting_uuid is not None:
        worker_task = asyncio.create_task(
            identify_worker(meeting_uuid, on_change=notify_speakers_updated)
        )

    client = FunASRClient(emit)
    try:
        await client.start()
        await ws.send_text(json.dumps({"type": "system", "msg": "ready"}))

        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                pcm = msg["bytes"]
                await client.feed(pcm)
                if sess is not None:
                    sess.pcm_buffer.extend(pcm)
            elif "text" in msg and msg["text"] is not None:
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                action = payload.get("action")
                if action == "stop":
                    break
                if action == "invoke_agent" and meeting_uuid is not None:
                    aid_raw = payload.get("agent_id")
                    try:
                        aid = uuid.UUID(aid_raw) if aid_raw else None
                    except ValueError:
                        aid = None
                    if aid is not None:
                        # Fire-and-forget; streamed events come back over WS.
                        asyncio.create_task(
                            invoke_agent_directly(
                                meeting_uuid,
                                aid,
                                on_message=push_agent_event,
                                query=payload.get("query"),
                            )
                        )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws_stt error")
        try:
            await ws.send_text(json.dumps({"type": "system", "msg": "internal_error"}))
        except Exception:
            pass
    finally:
        await client.stop()
        # Tell the periodic identify worker to do one final pass and exit.
        # This also marks the meeting as `processed` and frees the buffer.
        if sess is not None:
            sess.stop_event.set()
            if worker_task is not None:
                # Mark meeting finished while the worker wraps up.
                try:
                    async with SessionLocal() as db:
                        await db.execute(
                            update(Meeting)
                            .where(Meeting.id == meeting_uuid)
                            .values(status="finished", ended_at=datetime.now(timezone.utc))
                        )
                        await db.commit()
                except Exception:
                    logger.exception("failed to mark meeting finished")
        try:
            await ws.close()
        except Exception:
            pass
