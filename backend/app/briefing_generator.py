"""
Pre-meeting briefing.

When a user creates a new meeting, we already know the title + attendees.
This module pulls the most relevant prior memories (project-scoped by
title, user-scoped by attendee name, plus org-wide) and asks an LLM to
write a short markdown briefing the chair can glance at before kickoff.

Per blueprint §1.1 "会前(Briefing): 自动生成上次决定、未关闭问题、需重点
关注的风险" — that's exactly what this module produces.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .memory_retrieval import retrieve_relevant
from .models import Meeting, MeetingAttendee, User

logger = logging.getLogger(__name__)


BRIEFING_SYSTEM_PROMPT = """你是会议秘书,用 1 分钟的篇幅给主持人做开场前的快速 briefing。

输入是【与本场会议相关的历史事实】(来自过去会议纪要的长期记忆),
请按下面的固定结构组织成简短 markdown(无代码块,无多余客套话):

## 上次/历史相关结论
- 一句一条,挑 1-3 条最相关的

## 仍未关闭的事
- 待办、未决问题、悬而未决的分歧, 1-3 条

## 需要重点关注
- 风险、潜在分歧、值得提前对齐的点, 1-2 条

要求:
- 内容必须忠实于输入,不要编造没出现的事
- 不要重复输入原文,用一句话清晰总结
- 如果某节没相关内容,直接写"暂无"
- 整体长度不超过 200 字
"""


async def generate_briefing(meeting_id: uuid.UUID) -> Optional[str]:
    """
    Build a short briefing markdown for an upcoming meeting based on its
    title + attendees + the long_term_memory store. Returns None when there
    are no relevant memories yet (briefing UI hides itself in that case).
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return None

        attendee_rows = (
            await db.execute(
                select(MeetingAttendee.user_id).where(
                    MeetingAttendee.meeting_id == meeting_id,
                    MeetingAttendee.user_id.is_not(None),
                )
            )
        ).all()
        user_refs: list[str] = []
        if attendee_rows:
            users = (
                await db.execute(
                    select(User).where(User.id.in_([r[0] for r in attendee_rows]))
                )
            ).scalars().all()
            user_refs = [u.name for u in users]

        # Use the title as both the query and the project filter.
        project_refs = [meeting.title] if meeting.title else []
        query = meeting.title or "项目讨论"

        memories = await retrieve_relevant(
            db,
            query_text=query,
            project_refs=project_refs or None,
            user_refs=user_refs or None,
            k=8,
            min_importance=0.4,
        )
        provider = await get_active_provider(db)

    # Filter out very-distant matches; cosine distance > 0.7 is generally noise.
    memories = [m for m in memories if m.distance < 0.7]
    if not memories:
        return None
    if provider is None:
        return None

    facts_block = "\n".join(
        f"- ({m.scope}{':' + m.scope_ref if m.scope_ref else ''}) {m.content}"
        for m in memories
    )
    user_prompt = (
        f"会议标题: {meeting.title}\n"
        f"参会人: {', '.join(user_refs) if user_refs else '未知'}\n\n"
        f"相关历史事实:\n{facts_block}"
    )

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=BRIEFING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("briefing LLM call failed")
        return None

    md = "".join(chunks).strip()
    return md or None
