"""
v25.8-#3 — 自动收集 hot words(给 ASR / cleaner 用).

来源:
  1. 参会人姓名(避免 ASR 把"邓西"听成"灯西")
  2. 邀请的 AI 专家 keywords(业务术语 hot words)
  3. (可选) workspace 内 KB 文档 filename 关键词

DashScope ASR vocabulary_id 路径:
  - 用户在 DashScope 控制台创建 vocabulary,填入业务词,拿到 vocab id
  - env 设 DASHSCOPE_STT_VOCABULARY_ID=vocab-xxx
  - stt_client 自动传给 SDK
  - 本模块只负责 收集 + 日志(让用户知道 哪些词应该进 vocab)

未来可扩展:auto-create DashScope vocabulary 通过 API,无需手动 console.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models import Agent, KnowledgeDocument, KnowledgeBase, Meeting, MeetingAttendee, User

logger = logging.getLogger(__name__)


async def collect_hot_words(
    meeting_id: uuid.UUID,
    *,
    include_kb_filenames: bool = False,
    max_per_source: int = 50,
) -> dict[str, list[str]]:
    """
    返回 {"attendee_names": [...], "agent_keywords": [...], "kb_titles": [...]}.

    全部去重保留顺序.可直接传给 LLM 作为 hint,或拼成 vocabulary 的词条.
    """
    out: dict[str, list[str]] = {
        "attendee_names": [],
        "agent_keywords": [],
        "kb_titles": [],
    }
    async with SessionLocal() as db:
        attendees = (
            await db.execute(
                select(MeetingAttendee).where(MeetingAttendee.meeting_id == meeting_id)
            )
        ).scalars().all()
        user_ids = [a.user_id for a in attendees if a.user_id]
        agent_ids = [a.agent_id for a in attendees if a.agent_id]

        if user_ids:
            users = (
                await db.execute(select(User).where(User.id.in_(user_ids)))
            ).scalars().all()
            seen: set[str] = set()
            for u in users:
                if u.name and u.name not in seen:
                    seen.add(u.name)
                    out["attendee_names"].append(u.name)
                    if len(out["attendee_names"]) >= max_per_source:
                        break

        if agent_ids:
            agents = (
                await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            ).scalars().all()
            seen2: set[str] = set()
            for ag in agents:
                if ag.keywords:
                    for kw in ag.keywords:
                        if kw and kw not in seen2:
                            seen2.add(kw)
                            out["agent_keywords"].append(kw)
                            if len(out["agent_keywords"]) >= max_per_source:
                                break
                if len(out["agent_keywords"]) >= max_per_source:
                    break

        if include_kb_filenames and agent_ids:
            agents = agents if agent_ids else []
            kb_ids: list[uuid.UUID] = []
            for ag in agents:
                if ag.knowledge_base_ids:
                    kb_ids.extend(ag.knowledge_base_ids)
            if kb_ids:
                docs = (
                    await db.execute(
                        select(KnowledgeDocument.filename).where(
                            KnowledgeDocument.kb_id.in_(set(kb_ids)),
                            KnowledgeDocument.status == "ready",
                        )
                    )
                ).all()
                seen3: set[str] = set()
                for r in docs:
                    fname = r[0]
                    if not fname:
                        continue
                    # 截掉扩展名,只取标题部分
                    base = fname.rsplit(".", 1)[0]
                    if base and base not in seen3:
                        seen3.add(base)
                        out["kb_titles"].append(base)
                        if len(out["kb_titles"]) >= max_per_source:
                            break
    return out


def log_hot_words(meeting_id: uuid.UUID, hot_words: dict[str, list[str]]) -> None:
    """打日志,让用户看哪些词应该进 DashScope vocabulary."""
    flat = (
        hot_words.get("attendee_names", [])
        + hot_words.get("agent_keywords", [])
        + hot_words.get("kb_titles", [])
    )
    logger.info(
        "[hot-words] meeting=%s words=%d (attendees=%d agent_kw=%d kb=%d) "
        "list=%s",
        meeting_id, len(flat),
        len(hot_words.get("attendee_names", [])),
        len(hot_words.get("agent_keywords", [])),
        len(hot_words.get("kb_titles", [])),
        flat[:30],  # 截 30 个避免日志爆
    )
