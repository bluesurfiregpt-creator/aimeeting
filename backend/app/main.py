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
from .auth import COOKIE_NAME, decode_token, extract_ws_token
from .routers import access_requests as access_requests_router
from .routers import agent_templates as agent_templates_router  # v26.6-01
from .routers import agents as agents_router
from .routers import chat as chat_router  # v26.13.1 AI 私聊 调试模式
from .routers import perplexity_fetch as perplexity_fetch_router  # v26.13.2
from .routers import search_providers as search_providers_router  # v26.13.2
from .routers import asr_vocabulary as asr_vocabulary_router  # v25.9
from .routers import audit as audit_router
from .routers import auth as auth_router
from .routers import cron_rules as cron_rules_router
from .routers import dashboard as dashboard_router
from .routers import kb_sedimentation as kb_sedimentation_router  # v26.5-02c
from .routers import knowledge as knowledge_router
from .routers import lineage as lineage_router  # v26.5-Lineage P2
from .routers import me as me_router
from .routers import memory_drafts as memory_drafts_router  # v26.5-Lineage
from .routers import mobile as mobile_router  # v27.0-mobile
from .routers import v2_meetings as v2_meetings_router  # v1.4.0 Saga M · mobile v2 mock
from .routers import v2_today as v2_today_router  # v1.4.0 Saga N · mobile v2 today mock
from .routers import v2_tasks_memory as v2_tasks_memory_router  # v1.4.0 Saga O · mobile v2 tasks + memory mock
from .routers import reports as reports_router
from .routers import meetings as meetings_router
from .routers import meeting_attachments as meeting_attachments_router  # v27.0-mobile P19-B
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
    # v26.6-05: 沉淀草稿 7 天过期 sweep
    from .draft_expire_sweeper import draft_expire_loop
    draft_expire_task = asyncio.create_task(draft_expire_loop(stop_event))

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
            ("draft_expire", draft_expire_task),  # v26.6-05
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
    expose_headers=["Server-Timing", "X-Backend-Time"],
)


# v27.0-mobile P15: 加 timing middleware 写 Server-Timing 响应头.
# 让 curl + 浏览器 devtools 能直接看 backend 处理时间, 不用 ssh 进 log.
import time as _time
import logging as _logging

_perf_logger = _logging.getLogger("aimeeting.perf")

@app.middleware("http")
async def perf_timing_middleware(request, call_next):
    start = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (_time.perf_counter() - start) * 1000
    # 写头, 客户端可见
    response.headers["X-Backend-Time"] = f"{elapsed_ms:.1f}"
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    # 慢 request log 警告 (>500ms 写 warning)
    if elapsed_ms > 500:
        _perf_logger.warning(
            "slow request: %s %s took %.0fms",
            request.method,
            request.url.path,
            elapsed_ms,
        )
    return response

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(voiceprints_router.router)
app.include_router(meetings_router.router)
app.include_router(meeting_attachments_router.router)  # v27.0-mobile P19-B 会议参考资料
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
app.include_router(memory_drafts_router.router)  # v26.5-Lineage
app.include_router(mobile_router.router)  # v27.0-mobile
app.include_router(v2_meetings_router.router)  # v1.4.0 Saga M · /api/v2/meetings mock
app.include_router(v2_today_router.router)  # v1.4.0 Saga N · /api/v2/today/* mock
app.include_router(v2_tasks_memory_router.router)  # v1.4.0 Saga O · /api/v2/tasks + /api/v2/memory mock
app.include_router(lineage_router.router)  # v26.5-Lineage P2
app.include_router(agent_templates_router.router)  # v26.6-01 AI 模板生成器
app.include_router(chat_router.router)  # v26.13.1 AI 私聊 调试模式
app.include_router(search_providers_router.router)  # v26.13.2 检索 API CRUD
app.include_router(perplexity_fetch_router.router)  # v26.13.2 Perplexity 抓取触发


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

    # v27.0-mobile P21 原生 C-1: 用 extract_ws_token 抽 token, 兼容
    # Bearer header (小程序原生) / query param / cookie (H5).
    auth_workspace_id: uuid.UUID | None = None
    token = extract_ws_token(ws)
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
        # v26.11-fix2: 注册 到 房间 广播 列表 — 后端 给 这 meeting 广播
        # ("agents_invited" 等) 都会 经过 ws.send_text 推到这个 socket.
        session_state.register_client(meeting_uuid, ws)

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
        # v27.0-mobile P5B: 从 ws.send_text 升级为 broadcast 让 viewer (mobile)
        # 也能收到 AI 发言流 + 议程监控事件 (off_topic / time_warning / stuck 等).
        # 老的 recorder 仍在 client 列表里, 行为不变.
        if meeting_uuid is None:
            return
        try:
            await session_state.broadcast(meeting_uuid, payload)
        except Exception:
            logger.exception("ws agent event broadcast failed")

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
            #
            # v27.0-mobile P5B: 改成 broadcast (从 ws.send_text 升级), 让 mobile
            # 等只读 viewer 也能实时拿到; 同时 payload 加 text + speaker_name —
            # mobile 没 interim 上下文, 必须 server 直接给全.
            if line_id is not None and meeting_uuid is not None:
                # 解析 speaker_name — 若 speaker_user_id 已绑直接查; 否则 label fallback.
                speaker_name: str | None = None
                if speaker_user_id is not None:
                    try:
                        async with SessionLocal() as db:
                            from .models import User as _UserModel
                            speaker_name = (
                                await db.execute(
                                    select(_UserModel.name).where(_UserModel.id == speaker_user_id)
                                )
                            ).scalar()
                    except Exception:
                        logger.exception("resolve speaker_name failed")
                try:
                    await session_state.broadcast(
                        meeting_uuid,
                        {
                            "type": "transcript_persisted",
                            "line_id": line_id,
                            "start_ms": int(start_ts) if start_ts is not None else None,
                            "end_ms": int(end_ts) if end_ts is not None else None,
                            "text": text,
                            "speaker_name": speaker_name,
                            "speaker_status": speaker_status,
                        },
                    )
                except Exception:
                    logger.exception("ws transcript_persisted broadcast failed")
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
        # v26.11-fix1: WS close 不再 自动设 finished — 这导致 用户切页/网络断
        # 都被误判为 结束会议. 现在 仅 用户显式 call /api/meetings/{id}/finalize
        # 时 才 设 finished. WS close 仅 触发 background final-identify pass.
        if sess is not None:
            sess.stop_event.set()
            # worker_task 会跑 final-identify 然后 自己退出 (sess.stop_event 已 set).
            # 不再 改 meeting.status — 留给前端的 finalize endpoint 控制.
        # v26.11-fix2: 从 房间 广播 列表 摘掉 — 不然 下一次 broadcast 会 send_text
        # 到 死 socket 导致 异常 (虽然 broadcast 自己 会 drop, 但 显式 摘 干净 一些).
        if meeting_uuid is not None:
            session_state.unregister_client(meeting_uuid, ws)
        try:
            await ws.close()
        except Exception:
            pass


# ============================================================================
# v26.13.1: AI 私聊 STT WebSocket — 调试模式 语音输入
# ============================================================================
# 跟 ws_stt 平行, 但:
#   - 不写 meeting_transcript (调试模式 不存)
#   - 不挂 session_state (没有 房间概念)
#   - 不触发 agent (前端 拿到 transcript text 后 自己 决定 何时 提交 LLM)
#   - 仅 走 FunASR ASR + 把 transcript 帧 回推 给 前端
# 前端 用法: 录音 → WS 二进制 PCM 流 → 收 {type:"transcript", text, is_final}
#         → 用户 按 "确认" 把 final 文本 当 chat message 提交 给 /api/agents/{id}/chat
# ============================================================================
@app.websocket("/ws/chat-stt")
async def ws_chat_stt(ws: WebSocket):
    """STT pipe for chat 调试模式. 仅 ASR, 不 持久化, 不 关联 任何 meeting."""
    await ws.accept()

    # 鉴权 — 跟 ws_stt 同一套, 用 extract_ws_token (兼容 Bearer header / query / cookie)
    token = extract_ws_token(ws)
    auth_workspace_id: uuid.UUID | None = None
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

    async def emit(
        text: str,
        is_final: bool,
        start_ts,
        end_ts,
        **kwargs,  # speaker_user_id 等 不用 (调试模式), 接 接口签名 用
    ) -> None:
        try:
            await ws.send_text(json.dumps(
                {"type": "transcript", "text": text, "is_final": is_final,
                 "start_ts": start_ts, "end_ts": end_ts},
                ensure_ascii=False,
            ))
        except Exception:
            logger.exception("ws_chat_stt send failed")

    client = FunASRClient(emit, workspace_id=auth_workspace_id)
    try:
        await client.start()
        await ws.send_text(json.dumps({"type": "system", "msg": "ready"}))
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                await client.feed(msg["bytes"])
            elif "text" in msg and msg["text"] is not None:
                # 仅 接 "stop" 控制信号; 不处理 其他消息
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if payload.get("action") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws_chat_stt error")
    finally:
        await client.stop()
        try:
            await ws.close()
        except Exception:
            pass
