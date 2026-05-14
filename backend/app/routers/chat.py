"""
v26.13.1: AI 私聊 (调试模式) router.

  POST /api/agents/{agent_id}/chat       — SSE 流式 调试聊天
  POST /api/chat/parse-file              — 上传 文件 in-memory 解析 (不存盘)

特点:
  - 调试模式: 不写 任何表 (transcript / agent_message / memory / KB)
  - 但 AI 仍 read KB + memory (展示 完整 能力, 给 manager 验证 配置)
  - per-user 日配额 50 次 (in-memory 简单 限速; 多进程 不准 也 OK, 兜底 防滥用)
  - 文件 解析 完全 in-memory, 单文件 ≤ 20MB
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from ..agent_router import invoke_agent_for_chat
from ..auth import AuthContext, get_current_auth
from ..doc_parser import extract_text_async, SUPPORTED_EXTENSIONS

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

# ---------------------------------------------------------------------------
# Per-user daily quota — simple in-memory counter.
# 重启 重置. 单进程 准 (现在 Phase 1.5 就 一个 backend). 多 replica 后 移 Redis.
# ---------------------------------------------------------------------------
_DAILY_CHAT_LIMIT = 50
_daily_counter: dict[str, dict[str, int]] = defaultdict(dict)  # {date: {user_id: count}}


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _check_and_increment_daily(user_id: uuid.UUID) -> tuple[bool, int]:
    """Return (allowed, remaining)."""
    today = _today_key()
    # 清掉 不是今天 的 key (省内存)
    for k in list(_daily_counter.keys()):
        if k != today:
            del _daily_counter[k]
    counts = _daily_counter[today]
    uid_str = str(user_id)
    current = counts.get(uid_str, 0)
    if current >= _DAILY_CHAT_LIMIT:
        return (False, 0)
    counts[uid_str] = current + 1
    return (True, _DAILY_CHAT_LIMIT - counts[uid_str])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str = Field(..., max_length=20000)


class ChatAttachment(BaseModel):
    filename: str = Field(..., max_length=255)
    text: str = Field(..., max_length=50000)  # 解析后 文本, 截 50k 字 兜底


class ChatRequest(BaseModel):
    # 防 Pydantic v2 model_ 命名冲突
    model_config = ConfigDict(protected_namespaces=())
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=50)
    attachments: list[ChatAttachment] = Field(default_factory=list, max_length=10)


class ParseFileOut(BaseModel):
    text: str
    filename: str
    char_count: int


# ---------------------------------------------------------------------------
# POST /api/agents/{agent_id}/chat — SSE 流式 调试聊天
# ---------------------------------------------------------------------------
@router.post("/api/agents/{agent_id}/chat")
async def chat_with_agent(
    agent_id: str,
    payload: ChatRequest,
    auth: AuthContext = Depends(get_current_auth),
):
    """
    AI 私聊 调试模式 — 接收 浏览器 维护的 messages 历史 + 本次 attachments,
    走 SSE 流回 chunks.

    服务端 完全 无状态:
      - 不写 任何表
      - history 由 前端 sessionStorage 持有, 每次 全量 上传
      - 跨 tab / 刷新 → history 丢 (这就是 "调试模式 临时" 语义)
    """
    # ABAC 边界 + 配额 检查 在 进流 之前 做, 进流 之后 错误 也 用 SSE 帧 推
    try:
        aid = uuid.UUID(agent_id)
    except ValueError:
        raise HTTPException(400, "invalid agent_id")

    user_id = auth.user.id
    workspace_id = auth.workspace.id

    allowed, remaining = _check_and_increment_daily(user_id)
    if not allowed:
        raise HTTPException(
            429,
            detail=f"调试模式 日配额 已 用完 ({_DAILY_CHAT_LIMIT} 次/天), 请 明天 再 试.",
            headers={"Retry-After": "86400"},
        )

    # SSE 框架 — 一个 asyncio.Queue 串 invoke_agent_for_chat 的 on_message 跟 生成器
    queue: asyncio.Queue[Optional[dict]] = asyncio.Queue()

    async def on_message(payload: dict) -> None:
        await queue.put(payload)

    async def run_chat():
        try:
            await invoke_agent_for_chat(
                aid,
                on_message=on_message,
                messages=[m.model_dump() for m in payload.messages],
                attachments=[a.model_dump() for a in payload.attachments],
                user_id=user_id,
                workspace_id=workspace_id,
            )
        except Exception:
            logger.exception("chat run failed")
            await queue.put({
                "type": "system",
                "msg": "internal_error",
            })
        finally:
            await queue.put(None)  # sentinel

    asyncio.create_task(run_chat())

    async def event_stream():
        # 第一帧: 通知 前端 当前 quota 剩余
        yield _sse_frame({
            "type": "chat_quota",
            "remaining_today": remaining,
            "daily_limit": _DAILY_CHAT_LIMIT,
        })
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _sse_frame(item)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
            "Connection": "keep-alive",
        },
    )


def _sse_frame(payload: dict) -> str:
    """Encode a dict as a single SSE frame."""
    data = json.dumps(payload, ensure_ascii=False)
    return f"data: {data}\n\n"


# ---------------------------------------------------------------------------
# POST /api/chat/parse-file — 上传 文件 in-memory 解析
# ---------------------------------------------------------------------------
_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB


@router.post("/api/chat/parse-file", response_model=ParseFileOut)
async def parse_chat_file(
    file: UploadFile = File(...),
    auth: AuthContext = Depends(get_current_auth),  # 仅 登录 用户 可调
):
    """
    把 上传 文件 解析 成 纯文本, 返回 前端 在 sessionStorage 持有.
    服务端 **不存** 文件 也 **不存** 文本 (调试模式 语义).

    支持: PDF / docx / xlsx / 图片 (OCR) / 纯文本 — 复用 v25-2 doc_parser.
    """
    # size 检查 — UploadFile.size 在 Starlette 0.36+ 直接可用
    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(
            413,
            f"文件 太大 ({len(raw) / 1024 / 1024:.1f} MB), 限 {_MAX_FILE_BYTES // 1024 // 1024} MB",
        )

    filename = file.filename or "untitled"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext and f".{ext}" not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            400,
            f"不支持的文件格式 .{ext}. 支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    try:
        text = await extract_text_async(filename, raw)
    except Exception as e:
        logger.exception("parse_chat_file failed filename=%s", filename)
        raise HTTPException(400, f"文件解析 失败: {e}")

    # 截 长 防 LLM context 撑爆 (前端 schema 也 截 50k 兜底, 这里 再 截 一次)
    text = (text or "").strip()
    truncated = text[:50000]

    logger.info(
        "parse_chat_file user=%s filename=%s size_kb=%.1f chars=%d",
        auth.user.id, filename, len(raw) / 1024, len(truncated),
    )

    return ParseFileOut(
        text=truncated,
        filename=filename,
        char_count=len(truncated),
    )
