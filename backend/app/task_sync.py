"""
v17 — keep MeetingActionItem and Task in lockstep.

In v17 every ActionItem has a 1:1 Task row. New writes go through these
helpers so the invariant holds across both call sites (manual creation
in routers/meetings.py, LLM extraction in action_extractor.py). v18 will
flip the relationship (Task becomes primary; ActionItem becomes a thin
view), at which point this module shrinks to a no-op shim and is finally
removed.

Transactional contract: helpers `add_*` only call `session.add(...)` —
the caller controls flush + commit. This lets the caller batch many
inserts in one transaction (action_extractor inserts 5-10 at once).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import MeetingActionItem, Task


def _new_uuid() -> uuid.UUID:
    return uuid.uuid4()


def add_action_with_task(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    meeting_id: uuid.UUID,
    content: str,
    assignee_user_id: Optional[uuid.UUID],
    assignee_name_hint: Optional[str],
    due_at: Optional[datetime],
    status: str = "open",
    action_source_type: str = "manual",
    created_by_user_id: Optional[uuid.UUID] = None,
    evidence_quote: Optional[str] = None,  # v25.15: 实录依据原句(预览用)
    evidence_anchor_line_ids: Optional[list[int]] = None,  # v25.19: 实录行号锚点
    # v26.0: agent-centric 派发
    assignee_agent_id: Optional[uuid.UUID] = None,    # 主责 AI 专家
    co_agent_ids: Optional[list[str]] = None,         # 协办 AI 专家 ids
    topic_keywords: Optional[list[str]] = None,       # LLM 抽的主题关键词
) -> tuple[MeetingActionItem, Task]:
    """
    Add both rows to the session. Their ids are generated client-side so
    we can cross-link before flush — keeps it a single round trip.

    Returns (action, task) for the caller to inspect. Neither is flushed
    yet — caller decides when to commit.
    """
    action_id = _new_uuid()
    task_id = _new_uuid()

    source_ref: dict = {
        "meeting_id": str(meeting_id),
        "action_item_id": str(action_id),
        "action_source_type": action_source_type,
    }
    if evidence_quote:
        source_ref["evidence_quote"] = evidence_quote  # v25.15
    if evidence_anchor_line_ids:
        source_ref["evidence_anchor_line_ids"] = evidence_anchor_line_ids  # v25.19
    if topic_keywords:
        source_ref["topic_keywords"] = topic_keywords  # v26.0
    if assignee_agent_id:
        source_ref["assignee_agent_id"] = str(assignee_agent_id)  # v26.0

    task = Task(
        id=task_id,
        workspace_id=workspace_id,
        content=content,
        assignee_user_id=assignee_user_id,
        assignee_agent_id=assignee_agent_id,             # v26.0
        co_agent_ids=co_agent_ids,                       # v26.0
        created_by_user_id=created_by_user_id,
        due_at=due_at,
        status=status,
        source_type="meeting",
        source_ref=source_ref,
    )
    action = MeetingActionItem(
        id=action_id,
        meeting_id=meeting_id,
        workspace_id=workspace_id,
        content=content,
        assignee_user_id=assignee_user_id,
        assignee_name_hint=assignee_name_hint,
        due_at=due_at,
        status=status,
        source_type=action_source_type,
        task_id=task_id,
        evidence_quote=evidence_quote,  # v25.15
        evidence_anchor_line_ids=evidence_anchor_line_ids,  # v25.19
    )
    session.add(task)
    session.add(action)
    return action, task


async def mirror_patch_to_task(
    session: AsyncSession,
    action: MeetingActionItem,
    *,
    content: Optional[str] = None,
    assignee_user_id_set: bool = False,
    assignee_user_id: Optional[uuid.UUID] = None,
    due_at_set: bool = False,
    due_at: Optional[datetime] = None,
    status: Optional[str] = None,
) -> None:
    """
    After patching ActionItem, mirror the same fields to its Task. Uses
    `*_set` flags to distinguish "leave unchanged" from "explicitly set
    to NULL". Idempotent — silently skipped if action.task_id is NULL
    (legacy data the backfill missed; v18 NOT-NULL constraint will catch).
    """
    if action.task_id is None:
        return
    values: dict = {}
    if content is not None:
        values["content"] = content
    if assignee_user_id_set:
        values["assignee_user_id"] = assignee_user_id
    if due_at_set:
        values["due_at"] = due_at
    if status is not None:
        values["status"] = status
    if not values:
        return
    await session.execute(
        update(Task).where(Task.id == action.task_id).values(**values)
    )


async def delete_task_for_action(
    session: AsyncSession, action: MeetingActionItem
) -> None:
    """Delete the Task paired with an ActionItem. Safe on legacy NULL task_id."""
    if action.task_id is None:
        return
    await session.execute(delete(Task).where(Task.id == action.task_id))


async def delete_tasks_for_meeting_summary_actions(
    session: AsyncSession, meeting_id: uuid.UUID
) -> None:
    """
    Bulk-delete Tasks paired with the meeting's `source_type='summary'`
    ActionItems. Used by action_extractor before its replace-all insert
    so re-extraction doesn't leave orphan Tasks.

    We collect ids first then DELETE — running the DELETE as a subquery
    on a moving target table tends to be brittle across PG versions.
    """
    rows = (
        await session.execute(
            select(MeetingActionItem.task_id).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.source_type == "summary",
                MeetingActionItem.task_id.isnot(None),
            )
        )
    ).all()
    task_ids = [r[0] for r in rows if r[0] is not None]
    if task_ids:
        await session.execute(delete(Task).where(Task.id.in_(task_ids)))
