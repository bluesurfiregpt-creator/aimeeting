"""
v22.5 — 月度 task_evaluation 真实数据汇总.

跟 v22 的 seed 数据互补:
  - v22 seed-eval-data 用 deterministic 随机生成假数据,演示用
  - v22.5 这个模块在 approve / co-submit / rate 等真实事件后调用,
    重算并 UPSERT 该用户当月的 task_evaluation 行,真实数据**覆盖**
    同月 seed(per Q6 决策).

公式(per 智慧住建文档 四.5):
  completion_rate    = 本月 done / 本月 active+done(不计 cancelled)
  on_time_rate       = 本月 done 时 ≤ due_at / 本月所有 done(无 due 视为 ok)
  quality_score      = 该 user 收到的 dimension='quality' 评分平均/5
  collaboration_score = 该 user 收到的 dimension='collaboration' 评分平均/5
  composite          = 0.3c + 0.3o + 0.2q + 0.2col

调用时机(由各 endpoint 触发):
  approve_task          → recompute(主责 + 所有协办)
  co-submit             → recompute(协办)
  rate-collaboration    → recompute(被评的 ratee)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Task, TaskCollaborationRating, TaskEvaluation

logger = logging.getLogger(__name__)


def _period_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _start_of_month_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


async def recompute_user_evaluation(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    period: Optional[str] = None,
) -> Optional[TaskEvaluation]:
    """
    Recompute the (workspace, user, period) evaluation row from real data
    in `task` + `task_collaboration_rating`. UPSERT the result row.

    `period` defaults to the current month. v22.5 always recomputes the
    current month — historical month evaluations are immutable once the
    month has rolled over (handled by a v23+ end-of-month cron job).

    Returns the (refreshed) row, or None if there's no data for this user.
    """
    p = period or _period_now()
    month_start = _start_of_month_utc()
    now = datetime.now(timezone.utc)

    # 1) 完成率:本月 done / 本月所有非 cancelled
    month_done = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id == user_id,
                Task.status == "done",
                Task.updated_at >= month_start,
            )
        )
    ).scalar_one() or 0
    month_total = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id == user_id,
                Task.status.notin_(("cancelled",)),
                Task.created_at >= month_start,
            )
        )
    ).scalar_one() or 0
    completion_rate = (
        round(month_done / month_total, 3) if month_total > 0 else 0.0
    )

    # 2) 及时率:done 时 updated_at ≤ due_at / 所有 done
    done_rows = (
        await session.execute(
            select(Task.due_at, Task.updated_at).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id == user_id,
                Task.status == "done",
                Task.updated_at >= month_start,
            )
        )
    ).all()
    if done_rows:
        on_time = sum(
            1 for due, upd in done_rows if due is None or upd <= due
        )
        on_time_rate = round(on_time / len(done_rows), 3)
    else:
        on_time_rate = 0.0

    # 3+4) 评分平均(归一到 0-1):quality + collaboration
    rating_rows = (
        await session.execute(
            select(
                TaskCollaborationRating.dimension,
                func.avg(TaskCollaborationRating.score),
                func.count(TaskCollaborationRating.id),
            )
            .where(
                TaskCollaborationRating.workspace_id == workspace_id,
                TaskCollaborationRating.ratee_user_id == user_id,
                TaskCollaborationRating.created_at >= month_start,
            )
            .group_by(TaskCollaborationRating.dimension)
        )
    ).all()
    quality_score = 0.0
    collaboration_score = 0.0
    for dim, avg, _cnt in rating_rows:
        normalized = round(float(avg or 0) / 5.0, 3)
        if dim == "quality":
            quality_score = normalized
        elif dim == "collaboration":
            collaboration_score = normalized

    # 没有任何数据:跳过(不写空行,避免 evaluation 列表里都是 0)
    if month_total == 0 and not rating_rows:
        return None

    # UPSERT
    existing = (
        await session.execute(
            select(TaskEvaluation).where(
                TaskEvaluation.workspace_id == workspace_id,
                TaskEvaluation.assignee_user_id == user_id,
                TaskEvaluation.period == p,
            )
        )
    ).scalar_one_or_none()

    overdue_count = sum(
        1
        for due, upd in done_rows
        if due is not None and upd > due
    )

    if existing is None:
        row = TaskEvaluation(
            workspace_id=workspace_id,
            assignee_user_id=user_id,
            period=p,
            completion_rate=completion_rate,
            on_time_rate=on_time_rate,
            quality_score=quality_score,
            collaboration_score=collaboration_score,
            total_assigned=month_total,
            total_done=month_done,
            total_overdue=overdue_count,
        )
        session.add(row)
        await session.flush()
        return row
    else:
        existing.completion_rate = completion_rate
        existing.on_time_rate = on_time_rate
        # Q6:真数据「覆盖」同月 seed.如果 quality / collaboration 是 0
        # 而 seed 不是 0,我们仍覆盖(为 0)— 这是设计:有评分就用真,
        # 没评分就归零.这能让看板「没真协作 = 雷达瘪」如实反映.
        existing.quality_score = quality_score
        existing.collaboration_score = collaboration_score
        existing.total_assigned = month_total
        existing.total_done = month_done
        existing.total_overdue = overdue_count
        await session.flush()
        return existing


async def recompute_for_task_participants(
    session: AsyncSession,
    task: Task,
) -> None:
    """
    便捷 helper:对 Task 上所有相关人(主责 + 协办)重算月度 evaluation.
    各 endpoint 触发后调一次.
    """
    user_ids: set[uuid.UUID] = set()
    if task.assignee_user_id:
        user_ids.add(task.assignee_user_id)
    if task.co_assignees:
        for s in task.co_assignees:
            try:
                user_ids.add(uuid.UUID(s))
            except (TypeError, ValueError):
                continue
    for uid in user_ids:
        try:
            await recompute_user_evaluation(
                session,
                workspace_id=task.workspace_id,
                user_id=uid,
            )
        except Exception:
            logger.exception(
                "recompute_user_evaluation failed for user %s task %s",
                uid,
                task.id,
            )
