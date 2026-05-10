"""
v24.3 #4 — 月结评价自动 cron.

智慧住建文档 §4.5:月度评价应当月底自动汇总,不能漏跑.

策略:
- 现状:approve_task 后实时 recompute_for_task_participants,只覆盖**当月有
  approve 动作**的 user.若某 user 当月没 task 被 approve,他没有 row.
- 月初(每月 1 号) lifespan loop 触发一次「全员 recompute 上月」,确保:
  · 即使月内没新 approve,user 仍有完整月度评价(用 0 分兜底)
  · 历史月份永久存档(rolled over 后不再变)

实现:
- lifespan loop 1h tick
- 每 tick 检查:
  · 现在是否在月初窗口(day == 1 AND hour 0-2)
  · 上次 monthly_eval.run_all audit row 是否在本月
- 满足 → 跑 recompute_user_evaluation 给所有 workspace 的 active assignees,
  period = 上月.

也支持手工触发(POST /api/dashboard/monthly-eval/force-run admin only).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import system_audit_log
from .db import SessionLocal
from .evaluation import recompute_user_evaluation
from .models import AuditLog, Task, Workspace

logger = logging.getLogger(__name__)


_TICK_SECONDS = 60 * 60   # 1h
_TRIGGER_HOUR_WINDOW = (0, 2)  # 月初 0-2 点 触发


def _last_month_period() -> str:
    """返回上月 'YYYY-MM' 字符串."""
    now = datetime.now(timezone.utc)
    if now.month == 1:
        return f"{now.year - 1}-12"
    return f"{now.year}-{now.month - 1:02d}"


def _current_month_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def _has_run_for_period(session: AsyncSession, period: str) -> bool:
    """看 audit_log 里有没有本月已跑的 monthly_eval.run_all 行."""
    rows = (
        await session.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "monthly_eval.run_all",
                AuditLog.payload.contains({"period": period}),
            )
        )
    ).scalar() or 0
    return rows > 0


async def run_monthly_eval_for_all(
    session: AsyncSession, period: Optional[str] = None
) -> dict:
    """
    给所有 workspace 的所有 active assignees 跑 recompute_user_evaluation.
    Returns {workspaces: N, users: M, period: 'YYYY-MM'}.
    """
    p = period or _last_month_period()
    workspaces = (await session.execute(select(Workspace))).scalars().all()
    user_count = 0
    for ws in workspaces:
        # active assignee = ever 派过 task 的 user(简化:扫 task 表 distinct)
        rows = (
            await session.execute(
                select(Task.assignee_user_id)
                .where(
                    Task.workspace_id == ws.id,
                    Task.assignee_user_id.is_not(None),
                )
                .group_by(Task.assignee_user_id)
            )
        ).all()
        for (uid,) in rows:
            try:
                await recompute_user_evaluation(
                    session, workspace_id=ws.id, user_id=uid, period=p
                )
                user_count += 1
            except Exception:
                logger.exception(
                    "monthly_eval: recompute failed ws=%s user=%s", ws.id, uid
                )
        # 每个 workspace 单独写一行 audit + commit
        await system_audit_log(
            session,
            workspace_id=ws.id,
            action="monthly_eval.run_workspace",
            target_type="workspace",
            target_id=str(ws.id),
            payload={"period": p, "user_count": len(rows)},
            autocommit=False,
        )
        await session.commit()

    # 全局 marker(用于 _has_run_for_period 判幂等)— workspace_id=None 表示
    # system-wide 触发完成
    await system_audit_log(
        session,
        workspace_id=None,
        action="monthly_eval.run_all",
        target_type="system",
        target_id=None,
        payload={"period": p, "workspaces": len(workspaces), "users": user_count},
        autocommit=False,
    )
    await session.commit()
    logger.info(
        "monthly_eval: run_all period=%s workspaces=%d users=%d",
        p, len(workspaces), user_count,
    )
    return {"period": p, "workspaces": len(workspaces), "users": user_count}


async def monthly_eval_loop(stop_event: asyncio.Event) -> None:
    """
    月结自动 cron:1h tick.每 tick 检查:
      - 现在 day == 1 + hour 在 0-2 之间
      - 上月的 monthly_eval.run_all 还没跑过
    满足则跑 recompute 全员.
    """
    logger.info("monthly_eval_loop starting; tick=%ds", _TICK_SECONDS)
    # 等 60s 防止热重载触发
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=60)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            now = datetime.now(timezone.utc)
            if now.day == 1 and _TRIGGER_HOUR_WINDOW[0] <= now.hour <= _TRIGGER_HOUR_WINDOW[1]:
                p = _last_month_period()
                async with SessionLocal() as session:
                    if not await _has_run_for_period(session, p):
                        logger.info("monthly_eval_loop: triggering for period %s", p)
                        await run_monthly_eval_for_all(session, period=p)
                    else:
                        logger.debug("monthly_eval_loop: %s already done, skip", p)
        except Exception:
            logger.exception("monthly_eval_loop tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            continue
    logger.info("monthly_eval_loop exiting")
