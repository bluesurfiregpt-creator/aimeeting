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

from datetime import datetime, timedelta, timezone

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .memory_retrieval import retrieve_relevant
from .models import Meeting, MeetingActionItem, MeetingAttendee, User

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


_BRIEFING_LIST_LIMIT = 8


async def _open_actions_block(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    current_meeting_id: uuid.UUID,
) -> Optional[str]:
    """
    M3.0.7: pull open action items from PRIOR meetings in this workspace
    so the briefing's first section is always "what we still owe each
    other from last time".

    Filters:
      - status='open' (not done, not cancelled)
      - workspace_id matches
      - excludes the current meeting (it has no past actions yet)
      - keeps items with no due_at OR due_at within ±30d (avoids ancient
        zombies from years ago dominating the briefing)

    Returns markdown or None if there's nothing to surface.

    v14 NEW-ISSUE-B/C fix: header total + overdue count come from a
    SEPARATE COUNT(*) query (no LIMIT), so the numbers always reflect the
    real workspace state. The `LIMIT _BRIEFING_LIST_LIMIT` only caps the
    rendered LIST. When total > limit, the header shows `显示前 N` to
    make the truncation explicit (NEW-ISSUE-C).
    """
    from sqlalchemy import func

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    now = datetime.now(timezone.utc)

    base_filter = (
        MeetingActionItem.workspace_id == workspace_id,
        MeetingActionItem.status == "open",
        MeetingActionItem.meeting_id != current_meeting_id,
        (MeetingActionItem.due_at.is_(None))
        | (MeetingActionItem.due_at >= cutoff),
    )

    # 1. Total + overdue counts — separate from the rendered list, so
    #    truncation never makes the header lie.
    total_open = (
        await db.execute(
            select(func.count(MeetingActionItem.id)).where(*base_filter)
        )
    ).scalar() or 0
    if total_open == 0:
        return None
    total_overdue = (
        await db.execute(
            select(func.count(MeetingActionItem.id)).where(
                *base_filter, MeetingActionItem.due_at < now
            )
        )
    ).scalar() or 0

    # 2. Rendered list (capped). Sort: overdue first (due_at asc), then
    #    no-due items (NULLS LAST), then created_at desc.
    rows = (
        await db.execute(
            select(MeetingActionItem)
            .where(*base_filter)
            .order_by(
                MeetingActionItem.due_at.asc().nullslast(),
                MeetingActionItem.created_at.desc(),
            )
            .limit(_BRIEFING_LIST_LIMIT)
        )
    ).scalars().all()

    # Resolve assignee names
    user_ids = {r.assignee_user_id for r in rows if r.assignee_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users_loaded = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users_loaded}

    lines = []
    for r in rows:
        assignee = (
            name_by_id.get(r.assignee_user_id)
            if r.assignee_user_id
            else r.assignee_name_hint
        ) or "未指定"
        suffix = ""
        if r.due_at:
            if r.due_at < now:
                suffix = f"  ⚠️ **逾期 {(now - r.due_at).days}d**"
            else:
                days_left = max(0, (r.due_at - now).days)
                suffix = f"  · 截止 {r.due_at.strftime('%m-%d')}({days_left}d 内)"
        lines.append(f"- **{assignee}** · {r.content}{suffix}")

    header = f"## 📌 上次会议未完待办 ({total_open} 项"
    if total_overdue:
        header += f", **{total_overdue} 项逾期**"
    if total_open > _BRIEFING_LIST_LIMIT:
        header += f" · 显示前 {_BRIEFING_LIST_LIMIT}"
    header += ")"

    return f"{header}\n" + "\n".join(lines)


async def generate_briefing(meeting_id: uuid.UUID) -> Optional[str]:
    """
    Build a short briefing markdown for an upcoming meeting based on its
    title + attendees + the long_term_memory store + (M3.0.7) any open
    action items from prior meetings in this workspace.

    Returns None when there's no relevant content at all (the UI then
    hides the briefing card entirely).
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

        if meeting.workspace_id:
            memories = await retrieve_relevant(
                db,
                workspace_id=meeting.workspace_id,
                query_text=query,
                project_refs=project_refs or None,
                user_refs=user_refs or None,
                k=8,
                min_importance=0.4,
            )
        else:
            memories = []
        provider = await get_active_provider(db)

        # M3.0.7: open action items from PRIOR meetings — rendered at the
        # TOP of the briefing markdown so the user sees "what we still
        # owe each other" before the LLM summary section.
        open_actions_md: Optional[str] = None
        if meeting.workspace_id:
            open_actions_md = await _open_actions_block(
                db, meeting.workspace_id, meeting_id
            )

    # Filter out very-distant matches; cosine distance > 0.7 is generally noise.
    memories = [m for m in memories if m.distance < 0.7]

    # If we have open actions but no memories, we can still produce a
    # briefing of just the actions block (the LLM section becomes empty,
    # but the user still sees value).
    if not memories and not open_actions_md:
        return None
    if not memories:
        # No memories → just return the actions block on its own.
        return open_actions_md
    if provider is None:
        # No LLM but we have actions — surface those alone.
        return open_actions_md

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
    if not md:
        return open_actions_md  # fall back to actions-only if LLM returned empty
    if open_actions_md:
        # Prepend at top — user request: "open loops" first, summary after
        return f"{open_actions_md}\n\n---\n\n{md}"
    return md
