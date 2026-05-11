"""
v25.9 — workspace 级 ASR 词表管理 + DashScope vocabulary 同步.

为啥:
  客户测试反馈 "业务术语 / 人名 ASR 经常听错".v25.8-#3 自动收集 hot words
  但只是 log,没真正传给 ASR.这一版让 admin 在后台 录入业务词表,后端 自动
  同步到 DashScope custom vocabulary,拿到 vocab_id 缓存到 workspace.preset.
  会议 WS 启动 ASR 时 优先用 workspace 的 vocab_id,显著提高识别准确率.

Workspace.preset.asr_vocabulary 结构:
  {
    "dashscope_vocab_id": "vocab-aimeeting-xxx",
    "entries": [{"text": "前海合作区", "weight": 4, "lang": "zh"}, ...],
    "last_synced_at": "2026-05-11T...",
    "sync_status": "ok" | "failed",
    "sync_error": "...",
    "target_model": "paraformer-realtime-v2"
  }

DashScope vocab API(custom speech biasing):
  POST  /api/v1/services/audio/asr/customization
        body { model, input { action: 'create_vocabulary', target_model, prefix, vocabulary } }
        → { output.vocabulary_id }
  POST  /api/v1/services/audio/asr/customization
        body { input { action: 'update_vocabulary', vocabulary_id, vocabulary } }
  POST  /api/v1/services/audio/asr/customization
        body { input { action: 'delete_vocabulary', vocabulary_id } }
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import SessionLocal
from .models import Workspace

logger = logging.getLogger(__name__)


DASHSCOPE_BIASING_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/customization"
)
DEFAULT_TARGET_MODEL = "paraformer-realtime-v2"
DEFAULT_PREFIX = "aimeeting"
MAX_ENTRIES = 500


class VocabularyError(RuntimeError):
    pass


def normalize_entries(raw: list[Any]) -> list[dict]:
    """规范化用户输入:支持 str / dict 混合,统一成 {text, weight, lang}."""
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, str):
            text = item.strip()
            weight = 4
            lang = "zh"
        elif isinstance(item, dict):
            text = (item.get("text") or "").strip()
            weight = int(item.get("weight") or 4)
            lang = (item.get("lang") or "zh").strip() or "zh"
        else:
            continue
        if not text or text in seen:
            continue
        seen.add(text)
        # weight 1-5 限制
        weight = max(1, min(5, weight))
        # lang 限 zh / en
        if lang not in ("zh", "en"):
            lang = "zh"
        out.append({"text": text, "weight": weight, "lang": lang})
        if len(out) >= MAX_ENTRIES:
            break
    return out


def get_vocabulary_state(workspace: Workspace) -> dict[str, Any]:
    """读 workspace.preset.asr_vocabulary;不存在返回空 state."""
    preset = workspace.preset or {}
    if not isinstance(preset, dict):
        return _empty_state()
    state = preset.get("asr_vocabulary")
    if not isinstance(state, dict):
        return _empty_state()
    return {
        "dashscope_vocab_id": state.get("dashscope_vocab_id"),
        "entries": state.get("entries") or [],
        "last_synced_at": state.get("last_synced_at"),
        "sync_status": state.get("sync_status") or "never",
        "sync_error": state.get("sync_error"),
        "target_model": state.get("target_model") or DEFAULT_TARGET_MODEL,
    }


def _empty_state() -> dict[str, Any]:
    return {
        "dashscope_vocab_id": None,
        "entries": [],
        "last_synced_at": None,
        "sync_status": "never",
        "sync_error": None,
        "target_model": DEFAULT_TARGET_MODEL,
    }


def get_active_vocab_id(workspace: Workspace) -> Optional[str]:
    """供 stt_client 用 — 拿当前 workspace 的 active vocab_id.

    优先 workspace.preset.asr_vocabulary.dashscope_vocab_id;否则 env fallback.
    """
    state = get_vocabulary_state(workspace)
    if state["sync_status"] == "ok" and state["dashscope_vocab_id"]:
        return str(state["dashscope_vocab_id"])
    # env fallback(v25.8-#1 加的)
    env_id = (get_settings().dashscope_stt_vocabulary_id or "").strip()
    return env_id or None


async def update_workspace_vocabulary(
    db: AsyncSession,
    workspace: Workspace,
    entries_input: list[Any],
) -> dict[str, Any]:
    """
    主入口:用户 提交新词表 → 规范化 → DashScope 同步 → 更新 workspace.preset.

    返回最新 state(包括 sync_status / vocab_id / error).
    失败时 entries 仍保存,sync_status='failed' + 错误信息,前端可重试.
    """
    entries = normalize_entries(entries_input)
    existing = get_vocabulary_state(workspace)
    existing_vocab_id = existing.get("dashscope_vocab_id")

    # 调 DashScope(空列表 → 删 vocab)
    new_vocab_id: Optional[str] = None
    sync_status = "ok"
    sync_error: Optional[str] = None
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        if not entries:
            # 用户清空 → 删 vocab(若有)
            if existing_vocab_id:
                await _dashscope_delete_vocab(existing_vocab_id)
            new_vocab_id = None
        else:
            if existing_vocab_id:
                # 更新
                try:
                    await _dashscope_update_vocab(existing_vocab_id, entries)
                    new_vocab_id = existing_vocab_id
                except VocabularyError as e:
                    # vocab 可能在 DashScope 端已删,重新创建
                    logger.warning("update vocab failed, will recreate: %s", e)
                    new_vocab_id = await _dashscope_create_vocab(entries)
            else:
                new_vocab_id = await _dashscope_create_vocab(entries)
    except VocabularyError as e:
        sync_status = "failed"
        sync_error = str(e)[:500]
        logger.exception("vocab sync failed")
        new_vocab_id = existing_vocab_id  # 保留旧 id 不丢

    # 更新 workspace.preset.asr_vocabulary(dirty-detection 必须 dict copy)
    preset = dict(workspace.preset or {})
    preset["asr_vocabulary"] = {
        "dashscope_vocab_id": new_vocab_id,
        "entries": entries,
        "last_synced_at": now_iso,
        "sync_status": sync_status,
        "sync_error": sync_error,
        "target_model": DEFAULT_TARGET_MODEL,
    }
    workspace.preset = preset
    await db.commit()
    await db.refresh(workspace)

    return get_vocabulary_state(workspace)


# ----- DashScope HTTP wrappers -----

async def _dashscope_create_vocab(entries: list[dict]) -> str:
    body = {
        "model": "speech-biasing",
        "input": {
            "action": "create_vocabulary",
            "target_model": DEFAULT_TARGET_MODEL,
            "prefix": DEFAULT_PREFIX,
            "vocabulary": entries,
        },
    }
    data = await _dashscope_request(body)
    vocab_id = (data.get("output") or {}).get("vocabulary_id")
    if not vocab_id:
        raise VocabularyError(f"创建 vocab 响应无 vocabulary_id: {data}")
    logger.info("[asr-vocab] created %s with %d entries", vocab_id, len(entries))
    return str(vocab_id)


async def _dashscope_update_vocab(vocab_id: str, entries: list[dict]) -> None:
    body = {
        "model": "speech-biasing",
        "input": {
            "action": "update_vocabulary",
            "vocabulary_id": vocab_id,
            "vocabulary": entries,
        },
    }
    await _dashscope_request(body)
    logger.info("[asr-vocab] updated %s with %d entries", vocab_id, len(entries))


async def _dashscope_delete_vocab(vocab_id: str) -> None:
    body = {
        "model": "speech-biasing",
        "input": {
            "action": "delete_vocabulary",
            "vocabulary_id": vocab_id,
        },
    }
    try:
        await _dashscope_request(body)
        logger.info("[asr-vocab] deleted %s", vocab_id)
    except VocabularyError as e:
        # 已删除 / 不存在 都视为成功
        logger.warning("delete vocab %s ignored: %s", vocab_id, e)


async def _dashscope_request(body: dict) -> dict:
    settings = get_settings()
    if not settings.dashscope_api_key:
        raise VocabularyError("DASHSCOPE_API_KEY 未配置")
    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key.strip()}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            r = await c.post(DASHSCOPE_BIASING_URL, headers=headers, json=body)
    except httpx.HTTPError as e:
        raise VocabularyError(f"网络错误: {e}") from e
    if r.status_code >= 400:
        raise VocabularyError(f"HTTP {r.status_code}: {r.text[:300]}")
    try:
        return r.json()
    except Exception as e:
        raise VocabularyError(f"响应解析失败: {e}") from e


async def import_from_meeting_hot_words(
    db: AsyncSession, workspace: Workspace, meeting_id: uuid.UUID
) -> list[dict]:
    """从某个 meeting 自动收集 hot words → 合并进现有词表(去重).

    返回新 entries 列表(供前端 review 后再点保存).不直接 sync DashScope.
    """
    from .hot_words import collect_hot_words
    hw = await collect_hot_words(meeting_id, include_kb_filenames=True)
    new_words = (
        hw.get("attendee_names", [])
        + hw.get("agent_keywords", [])
        + hw.get("kb_titles", [])
    )
    existing = get_vocabulary_state(workspace)
    existing_entries = existing.get("entries") or []
    existing_texts = {e.get("text") for e in existing_entries if isinstance(e, dict)}

    out = list(existing_entries)
    added = 0
    for w in new_words:
        if w and w not in existing_texts:
            out.append({"text": w, "weight": 4, "lang": "zh"})
            existing_texts.add(w)
            added += 1
            if len(out) >= MAX_ENTRIES:
                break
    logger.info(
        "[asr-vocab] import from meeting %s: added %d new (total %d)",
        meeting_id, added, len(out),
    )
    return out
