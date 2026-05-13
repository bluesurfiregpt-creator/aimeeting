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

from .alert_monitor import alert_monitor_loop
from .config import get_settings
from .cron_runner import cron_runner_loop
from .sentry_init import init_sentry
from .db import SessionLocal
from .due_reminder import due_reminder_loop
from .monthly_eval_runner import monthly_eval_loop
from .identify_pipeline import identify_worker
from .init_db import init_db
from .models import Meeting, MeetingTranscript
from .agent_router import invoke_agent_directly, maybe_invoke_agents
from .agenda_monitor import maybe_check_agenda
from .dissent_detector import maybe_detect_dissent
from .auth import COOKIE_NAME, decode_token
from .routers import access_requests as access_requests_router
from .routers import agents as agents_router
from .routers import asr_vocabulary as asr_vocabulary_router  # v25.9
from .routers import audit as audit_router
from .routers import auth as auth_router
from .routers import cron_rules as cron_rules_router
from .routers import dashboard as dashboard_router
from .routers import kb_sedimentation as kb_sedimentation_router  # v26.5-02c
from .routers import knowledge as knowledge_router
from .routers import me as me_router
from .routers import reports as reports_router
from .routers import meetings as meetings_router
from .routers import memory as memory_router
from .routers import model_providers as model_providers_router
from .routers import super as super_router  # v26.4 Platform Admin
from .routers import team as team_router
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

# v24.4 #2 Sentry — DSN 没配 → no-op,完全不影响开发 / 测试
_SENTRY_ACTIVE = init_sentry()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    # 后台 loop 们都共用一个 stop_event,shutdown 时一齐退.
    #   due_reminder_loop  — Theme 1 (P0): 黄/红/紫 催办通知
    #   cron_runner_loop   — v20: 定期巡检触发源,每分钟 tick scan cron_rule
    #   alert_monitor_loop — v24.1 #2: 异常预警触发源,每小时 tick scan 3 条规则
    stop_event = asyncio.Event()
    reminder_task = asyncio.create_task(due_reminder_loop(stop_event))
    cron_task = asyncio.create_task(cron_runner_loop(stop_event))
    alert_task = asyncio.create_task(alert_monitor_loop(stop_event))
    monthly_eval_task = asyncio.create_task(monthly_eval_loop(stop_event))

    # v26.3-03: 启动时扫所有 mode=auto 且 phase∈(running, paused, idle) 的 meeting,
    # 把 orchestrator 重新起来.worker 重启 / web 进程重启时关键 — 否则 跑中的
    # auto 会议会"挂"在那里.
    try:
        from .auto_meeting_orchestrator import resume_running_meetings
        resumed = await resume_running_meetings()
        if resumed > 0:
            logger.info("lifespan: resumed %d auto meetings", resumed)
    except Exception:
        logger.exception("auto meeting resume failed (non-fatal)")

    try:
        yield
    finally:
        stop_event.set()
        for name, t in (
            ("due_reminder", reminder_task),
            ("cron_runner", cron_task),
            ("alert_monitor", alert_task),
            ("monthly_eval", monthly_eval_task),
        ):
            try:
                await asyncio.wait_for(t, timeout=5)
            except asyncio.TimeoutError:
                t.cancel()
            except Exception:
                logger.exception("%s shutdown error", name)


app = FastAPI(title="Aimeeting Backend", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(voiceprints_router.router)
app.include_router(meetings_router.router)
app.include_router(agents_router.router)
app.include_router(model_providers_router.router)
app.include_router(memory_router.router)
app.include_router(audit_router.router)
app.include_router(team_router.router)
app.include_router(knowledge_router.router)
app.include_router(me_router.router)
app.include_router(cron_rules_router.router)
app.include_router(access_requests_router.router)
app.include_router(dashboard_router.router)
app.include_router(reports_router.router)
app.include_router(asr_vocabulary_router.router)  # v25.9
app.include_router(super_router.router)  # v26.4 Platform Admin
app.include_router(kb_sedimentation_router.router)  # v26.5-02c


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "env": settings.app_env,
        "sentry_active": _SENTRY_ACTIVE,  # v24.4 #2: 1 眼能看到 Sentry 是否激活
    }


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
    # Auth check: require a valid cookie. We accept the connection first so
    # we can send a JSON error before closing (browsers don't expose 4xx
    # codes during the handshake to JS reliably).
    await ws.accept()

    auth_workspace_id: uuid.UUID | None = None
    token = ws.cookies.get(COOKIE_NAME)
    if token:
        try:
            payload = decode_token(token)
            wsid = payload.get("wsid")
            if wsid:
                auth_workspace_id = uuid.UUID(wsid)
        except Exception:
            auth_workspace_id = None
    if auth_workspace_id is None:
        await ws.send_text(json.dumps({"type": "system", "msg": "auth required"}))
        await ws.close()
        return

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
                await db.execute(
                    select(Meeting).where(
                        Meeting.id == meeting_uuid,
                        Meeting.workspace_id == auth_workspace_id,
                    )
                )
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

    async def emit(
        text: str,
        is_final: bool,
        start_ts,
        end_ts,
        *,
        speaker_user_id: uuid.UUID | None = None,
        speaker_status: str | None = None,
    ) -> None:
        """
        Push a transcript line to the FE and (when final) persist it.

        Default callers (FunASRClient) pass `speaker_user_id=None`; the
        speaker is filled in later by the post-meeting voiceprint pipeline.
        Manual text-message callers pass an explicit speaker_user_id and
        `speaker_status='manual'` so the identify_worker won't overwrite it
        (same lock used by the in-meeting "✏️ correct speaker" flow).
        """
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
            line_id: int | None = None
            try:
                async with SessionLocal() as db:
                    line = MeetingTranscript(
                        meeting_id=meeting_uuid,
                        text=text,
                        start_ms=int(start_ts) if start_ts is not None else None,
                        end_ms=int(end_ts) if end_ts is not None else None,
                        is_final=True,
                        speaker_user_id=speaker_user_id,
                        speaker_status=speaker_status,
                    )
                    db.add(line)
                    await db.commit()
                    await db.refresh(line)
                    line_id = line.id
            except Exception:
                logger.exception("persist transcript failed")
            # Tell the frontend which DB row this finalized sentence ended up
            # at, so the meeting page can attach the correction UI to it
            # without having to wait for /result polling at meeting end.
            if line_id is not None:
                try:
                    await ws.send_text(
                        json.dumps(
                            {
                                "type": "transcript_persisted",
                                "line_id": line_id,
                                "start_ms": int(start_ts) if start_ts is not None else None,
                                "end_ms": int(end_ts) if end_ts is not None else None,
                            }
                        )
                    )
                except Exception:
                    logger.exception("ws transcript_persisted send failed")
            # Fire-and-forget agent invocation. Errors inside are already
            # logged + relayed as a chunk message; we don't want to block
            # the next ASR sentence on Dify latency.
            asyncio.create_task(
                maybe_invoke_agents(meeting_uuid, text, on_message=push_agent_event)
            )
            # Sprint M2.3: also run dissent detection (rate-limited inside).
            asyncio.create_task(
                maybe_detect_dissent(meeting_uuid, on_message=push_agent_event)
            )
            # M3.0: agenda monitor — only does anything when meeting.agenda
            # is set; otherwise no-ops on the first DB peek.
            asyncio.create_task(
                maybe_check_agenda(meeting_uuid, on_message=push_agent_event)
            )

    async def emit_manual(text: str, speaker_user_id: uuid.UUID | None) -> None:
        """
        Surface a typed (non-ASR) message into the same pipeline. Used by the
        WS `text_message` action — UI's typing affordance + Cowork tests.

        Typed lines have no audio timestamp. We pass start_ms=None — sort
        order within a meeting still works because /result orders by row id.
        """
        await emit(
            text=text,
            is_final=True,
            start_ts=None,
            end_ts=None,
            speaker_user_id=speaker_user_id,
            speaker_status="manual",
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
        # v25.8-#3: 记录 hot words(给 ASR vocabulary 配置 + cleaner 用)
        try:
            from .hot_words import collect_hot_words, log_hot_words
            hw = await collect_hot_words(meeting_uuid)
            log_hot_words(meeting_uuid, hw)
        except Exception:
            logger.exception("hot_words collect failed (non-fatal)")

    client = FunASRClient(emit, workspace_id=auth_workspace_id)  # v25.9
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
                if action == "text_message" and meeting_uuid is not None:
                    # Typed message from the chat box (alternative to mic).
                    # Routes through emit_manual → same persistence + agent
                    # trigger pipeline as a finalized ASR sentence, but with
                    # an explicit speaker so identify_worker won't override.
                    typed = (payload.get("text") or "").strip()
                    if not typed:
                        continue
                    spk_raw = payload.get("speaker_user_id")
                    try:
                        spk_uuid = uuid.UUID(spk_raw) if spk_raw else None
                    except ValueError:
                        spk_uuid = None
                    asyncio.create_task(emit_manual(typed, spk_uuid))
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
