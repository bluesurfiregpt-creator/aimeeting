"""
Long-term memory extraction.

Triggered after a summary is generated. Reads the summary's structured
sections, asks the active LLM to atomise the durable facts, embeds each,
and writes them to long_term_memory keyed by scope (user|project|org).

Per blueprint §4.1, long-term memories are organised "按用户/项目/组织
三个维度". We pick the dimension per-fact:
  - facts about a specific person  → scope='user', scope_ref=user.name
  - facts about the project under discussion → scope='project',
    scope_ref=meeting.title
  - generic process/policy/learning → scope='org', scope_ref=null
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .embeddings import EmbeddingError, compute_embeddings
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import LongTermMemory, Meeting, MeetingAttendee, User

logger = logging.getLogger(__name__)


EXTRACT_SYSTEM_PROMPT = """你是一名信息抽取助手。给你一份会议纪要(markdown,8 节),
请抽出可作为长期记忆的原子事实(atomic facts), 用于跨会议引用。

抽取规则:
1. 重点关注:「已形成决策」「分歧事项」「风险提醒」「待办事项」4 节; 「关键要点」可选地抽。
2. 每条原子化: 一个事实只表达一件事,一个名字。
3. 每条标 scope:
   - "user"    : 关于某位特定参会人的偏好/承诺/责任/历史观点
   - "project" : 关于本场会议讨论的项目/产品的事实(决策/约束/技术选择)
   - "org"     : 跨项目跨人的组织级事实(流程/政策/学到的教训)
4. 每条标 scope_ref(string|null):
   - user 时填那个人的姓名(原文出现的)
   - project 时填项目/产品名(若纪要里没明确,填会议标题)
   - org 时留 null
5. 每条标 importance(0.0-1.0):
   - 重大决策/重大风险 = 0.9
   - 待办事项 = 0.7
   - 关键观点 = 0.6
   - 一般要点 = 0.4
6. 不要重复纪要原文; 用一句话清晰地写事实,前面**不带 bullet 符号**。

只输出一个 JSON 数组,不要包代码块,不要任何解释文字:
[
  {"scope":"project","scope_ref":"AI 会议系统","content":"决定先做 AI 专家功能,声纹识别暂缓","importance":0.9},
  {"scope":"user","scope_ref":"邓西","content":"承担专家详情页改为四个证标签页的 UI 改造","importance":0.7},
  ...
]

如果纪要太短或没有可抽取事实,返回 []
"""


async def extract_and_store_memories(
    meeting_id: uuid.UUID,
    *,
    summary_md: Optional[str] = None,
) -> int:
    """
    Extract memories from this meeting's summary, embed them, persist them.
    Returns the number of memories saved. Idempotent only by accident — the
    caller should avoid re-extracting on the same summary if duplicates
    matter. (Sprint E doesn't dedupe yet; that's a future cleanup.)
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return 0
        if summary_md is None:
            summary_md = meeting.summary_md
        if not summary_md or summary_md.startswith("<!--"):
            logger.info("memory_extractor: no usable summary for %s", meeting_id)
            return 0

        provider = await get_active_provider(db)

    if provider is None:
        logger.warning("memory_extractor: no active LLM provider")
        return 0

    user_prompt = (
        f"会议标题: {meeting.title}\n"
        f"会议日期: {meeting.started_at or meeting.created_at}\n\n"
        f"以下是这场会议的纪要:\n\n{summary_md}"
    )

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=EXTRACT_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("memory extract LLM call failed")
        return 0

    raw = "".join(chunks).strip()
    facts = _safe_parse_json_array(raw)
    if not facts:
        logger.info("memory_extractor: no facts extracted for %s", meeting_id)
        return 0

    # Filter & normalize
    cleaned: list[dict[str, Any]] = []
    for f in facts:
        if not isinstance(f, dict):
            continue
        scope = (f.get("scope") or "").lower()
        if scope not in {"user", "project", "org"}:
            continue
        content = (f.get("content") or "").strip()
        if not content:
            continue
        cleaned.append(
            {
                "scope": scope,
                "scope_ref": (f.get("scope_ref") or None),
                "content": content,
                "importance": float(f.get("importance", 0.5)),
            }
        )
    if not cleaned:
        return 0

    # Compute embeddings in one batch
    try:
        vectors = await compute_embeddings([f["content"] for f in cleaned])
    except EmbeddingError:
        logger.exception("memory_extractor: embedding failed; saving without vectors")
        vectors = [[0.0] * 1536 for _ in cleaned]  # fallback so memory still stores text

    async with SessionLocal() as db:
        for f, vec in zip(cleaned, vectors):
            db.add(
                LongTermMemory(
                    scope=f["scope"],
                    scope_ref=f["scope_ref"],
                    content=f["content"],
                    importance=f["importance"],
                    embedding=vec,
                    source_type="meeting_summary",
                    source_id=str(meeting_id),
                )
            )
        await db.commit()

    logger.info("extracted %d memories from meeting %s", len(cleaned), meeting_id)
    return len(cleaned)


def _safe_parse_json_array(raw: str) -> list[Any]:
    """LLM may wrap in code fences or add chatter — strip aggressively."""
    if not raw:
        return []
    # Remove ```json ... ``` fences
    if raw.startswith("```"):
        m = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
        if m:
            raw = m.group(1)
    # Find first [ and last ]
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        parsed = json.loads(raw[start : end + 1])
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        logger.warning("memory_extractor: JSON parse failed for: %s", raw[:200])
        return []
