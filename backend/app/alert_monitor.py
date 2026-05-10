"""
v24.1 #2 — 异常预警 触发源.

智慧住建文档 §4.1 触发源 5:业务指标超预警阈值,**全自动**生成 Task.
后台 lifespan loop,默认每 1h 扫一次所有 workspace,3 条内置规则:

  A. overdue_rate         本月任务逾期率 > 30%        → 全 workspace 严重(red)
  B. assignee_overload    单 assignee 工作量 > 平均 2x → 该 user 一般(yellow)
  C. agent_low_completion 单 Agent 30d 完成率 < 40%   → 该 agent 严重(red)

每个 alert 触发 = 创建 Task(source_type='alert', assignee=null, status='open'),
等 leader/admin 在「待派发」队列里派发给具体责任人.

24h dedup:同 (workspace, kind, resource_key) 在 24h 内已建过 → skip,防刷.

后续(v25)把规则可配置化:
  - 后台 admin 页编辑 indicator + threshold + 通道
  - 客户上线后再加针对住建场景的规则(燃气压力 / 房屋鉴定积压等)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import system_audit_log
from .db import SessionLocal
from .models import Agent, Task, User, Workspace, WorkspaceMembership
from .notify import emit_notification

logger = logging.getLogger(__name__)

# Tick:1 小时.客户上线后可调更短(15 min)或加 webhook 立即触发.
_TICK_SECONDS = 60 * 60

# Dedup window
_DEDUP_HOURS = 24

# 内置 3 条规则的阈值(per D2 默认值)
_THRESHOLD_OVERDUE_RATE = 0.30  # 月度逾期率 > 30% 报警
_THRESHOLD_OVERLOAD_RATIO = 2.0  # 工作量 > 平均 2 倍报警
_THRESHOLD_AGENT_COMPLETION = 0.40  # 30d 完成率 < 40% 报警

# 「样本太小不报警」阈值,避免 1 个任务也报「100% 逾期」噪音
_MIN_SAMPLE_OVERDUE = 5
_MIN_SAMPLE_AGENT = 5
_MIN_ASSIGNEES_OVERLOAD = 3


async def _check_overdue_rate(
    session: AsyncSession, workspace_id
) -> Optional[dict[str, Any]]:
    """A. 本月任务逾期率 > 30% → workspace-level alert."""
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    total = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == workspace_id,
                Task.created_at >= month_start,
                Task.status.notin_(("cancelled", "archived")),
            )
        )
    ).scalar() or 0

    if total < _MIN_SAMPLE_OVERDUE:
        return None

    overdue = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == workspace_id,
                Task.created_at >= month_start,
                Task.due_at.is_not(None),
                Task.due_at < now,
                Task.status.notin_(("done", "archived", "cancelled")),
            )
        )
    ).scalar() or 0

    rate = overdue / total
    if rate <= _THRESHOLD_OVERDUE_RATE:
        return None

    return {
        "kind": "overdue_rate",
        "resource_key": None,
        "severity": "red",
        "title": f"⚠️ 本月任务逾期率 {rate*100:.0f}% (超阈值 {_THRESHOLD_OVERDUE_RATE*100:.0f}%)",
        "content": (
            f"本月共 {total} 个活跃任务,其中 {overdue} 个已逾期未办结(逾期率 "
            f"{rate*100:.0f}%).请关注产能 / 优先级 / 是否需要追加资源."
        ),
        "observed": round(rate, 3),
        "threshold": _THRESHOLD_OVERDUE_RATE,
        "scope": {"total": total, "overdue": overdue},
    }


async def _check_assignee_overload(
    session: AsyncSession, workspace_id
) -> Optional[dict[str, Any]]:
    """B. 单 assignee 工作量 > 平均 2 倍 → assignee-level alert."""
    rows = (
        await session.execute(
            select(Task.assignee_user_id, func.count(Task.id))
            .where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id.is_not(None),
                Task.status.in_(("dispatched", "accepted", "in_progress", "submitted")),
            )
            .group_by(Task.assignee_user_id)
        )
    ).all()
    if len(rows) < _MIN_ASSIGNEES_OVERLOAD:
        return None
    counts = {uid: c for uid, c in rows}
    avg = sum(counts.values()) / len(counts)
    if avg < 1:
        return None

    max_uid, max_count = max(counts.items(), key=lambda x: x[1])
    if max_count < avg * _THRESHOLD_OVERLOAD_RATIO:
        return None

    u = (
        await session.execute(select(User).where(User.id == max_uid))
    ).scalar_one_or_none()
    name = u.name if u else "(未知用户)"
    return {
        "kind": "assignee_overload",
        "resource_key": str(max_uid),
        "severity": "yellow",
        "title": f"⚠️ {name} 工作量异常 ({max_count} 个 vs 平均 {avg:.1f})",
        "content": (
            f"{name} 当前持有 {max_count} 个活跃任务,是工作空间平均水平 "
            f"{avg:.1f} 的 {max_count/avg:.1f} 倍.建议复核优先级或重新分配部分任务."
        ),
        "observed": round(max_count / avg, 2),
        "threshold": _THRESHOLD_OVERLOAD_RATIO,
        "scope": {
            "assignee_user_id": str(max_uid),
            "assignee_name": name,
            "task_count": max_count,
            "workspace_avg": round(avg, 2),
        },
    }


async def _check_agent_completion(
    session: AsyncSession, workspace_id
) -> Optional[dict[str, Any]]:
    """C. 单 Agent 30d 完成率 < 40% → agent-level alert.

    AI 专家 = Agent;通过 workspace_membership.bound_agent_id 关联 user.
    某 Agent 关联的 expert 用户们 30d 内创建的 task 完成率低于阈值 → 报警.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    agents = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == workspace_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all()

    for agent in agents:
        bound_uids_rows = (
            await session.execute(
                select(WorkspaceMembership.user_id).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.bound_agent_id == agent.id,
                )
            )
        ).all()
        bound_uids = [r[0] for r in bound_uids_rows]
        if not bound_uids:
            continue

        total = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == workspace_id,
                    Task.assignee_user_id.in_(bound_uids),
                    Task.created_at >= cutoff,
                )
            )
        ).scalar() or 0
        if total < _MIN_SAMPLE_AGENT:
            continue

        done = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == workspace_id,
                    Task.assignee_user_id.in_(bound_uids),
                    Task.created_at >= cutoff,
                    Task.status.in_(("done", "archived")),
                )
            )
        ).scalar() or 0
        rate = done / total
        if rate >= _THRESHOLD_AGENT_COMPLETION:
            continue

        # 一次 tick 只触发第一个命中的 Agent(防刷;下一 tick 看下一个)
        return {
            "kind": "agent_low_completion",
            "resource_key": str(agent.id),
            "severity": "red",
            "title": (
                f"⚠️ {agent.name} 30 天完成率仅 {rate*100:.0f}% "
                f"(低于阈值 {_THRESHOLD_AGENT_COMPLETION*100:.0f}%)"
            ),
            "content": (
                f"{agent.name} 关联 {len(bound_uids)} 个专家用户,过去 30 天创建 "
                f"{total} 个任务,只完成 {done} 个.请关注资源分配 / 能力瓶颈 / 是否被卡."
            ),
            "observed": round(rate, 3),
            "threshold": _THRESHOLD_AGENT_COMPLETION,
            "scope": {
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "bound_user_count": len(bound_uids),
                "total": total,
                "done": done,
            },
        }
    return None


_ALL_CHECKS = [
    _check_overdue_rate,
    _check_assignee_overload,
    _check_agent_completion,
]


async def _was_recently_alerted(
    session: AsyncSession, workspace_id, kind: str, resource_key: Optional[str]
) -> bool:
    """24h dedup:同 (workspace, kind, resource_key) 在窗口内已报过 → True."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_DEDUP_HOURS)
    rows = (
        await session.execute(
            select(Task.source_ref).where(
                Task.workspace_id == workspace_id,
                Task.source_type == "alert",
                Task.created_at >= cutoff,
            )
        )
    ).all()
    for (sref,) in rows:
        if not isinstance(sref, dict):
            continue
        if sref.get("kind") == kind and sref.get("resource_key") == resource_key:
            return True
    return False


async def _create_alert_task_and_notify(
    session: AsyncSession, workspace_id, signal: dict[str, Any]
) -> Task:
    """新建 source_type='alert' Task + 通知所有 leader/admin/owner."""
    new_task = Task(
        workspace_id=workspace_id,
        title=signal["title"][:255],
        content=signal["content"][:2000],
        assignee_user_id=None,
        created_by_user_id=None,  # 系统触发,无人类 author
        status="open",
        source_type="alert",
        source_ref={
            "kind": signal["kind"],
            "resource_key": signal["resource_key"],
            "observed": signal["observed"],
            "threshold": signal["threshold"],
            "scope": signal["scope"],
            "fired_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    session.add(new_task)
    await session.flush()

    leader_rows = (
        await session.execute(
            select(WorkspaceMembership.user_id).where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.role.in_(("owner", "admin", "leader")),
            )
        )
    ).all()
    for (lid,) in leader_rows:
        await emit_notification(
            session,
            workspace_id=workspace_id,
            user_id=lid,
            kind="alert_fired",
            severity=signal["severity"],
            payload={
                "task_id": str(new_task.id),
                "alert_kind": signal["kind"],
                "title": signal["title"],
                "observed": signal["observed"],
                "threshold": signal["threshold"],
            },
        )

    await system_audit_log(
        session,
        workspace_id=workspace_id,
        action="alert.fire",
        target_type="task",
        target_id=str(new_task.id),
        payload={
            "kind": signal["kind"],
            "resource_key": signal["resource_key"],
            "observed": signal["observed"],
            "threshold": signal["threshold"],
        },
        autocommit=False,
    )
    return new_task


async def _tick_once(session: AsyncSession) -> int:
    """单 tick:扫所有 workspace,跑 3 条规则,触发 + 通知.返回新 task 数."""
    workspaces = (await session.execute(select(Workspace))).scalars().all()
    fired = 0
    for ws in workspaces:
        for check_fn in _ALL_CHECKS:
            try:
                signal = await check_fn(session, ws.id)
                if signal is None:
                    continue
                if await _was_recently_alerted(
                    session, ws.id, signal["kind"], signal["resource_key"]
                ):
                    continue
                await _create_alert_task_and_notify(session, ws.id, signal)
                await session.commit()
                fired += 1
                logger.info(
                    "alert fired ws=%s kind=%s observed=%.3f threshold=%.3f",
                    ws.id, signal["kind"], signal["observed"], signal["threshold"],
                )
            except Exception:
                logger.exception(
                    "alert_monitor: check %s failed for ws=%s",
                    check_fn.__name__, ws.id,
                )
                await session.rollback()
    return fired


async def alert_monitor_loop(stop_event: asyncio.Event) -> None:
    """
    Long-running loop. 由 main.py lifespan 启动,与 cron_runner / due_reminder
    并列.shutdown 时一齐退.
    """
    logger.info("alert_monitor_loop starting; tick=%ds", _TICK_SECONDS)
    # warm-up 30s,跟 cron_runner 错开
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=30)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            async with SessionLocal() as session:
                n = await _tick_once(session)
                if n:
                    logger.info("alert_monitor tick: fired %d alert(s)", n)
        except Exception:
            logger.exception("alert_monitor tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            continue
    logger.info("alert_monitor_loop exiting")


# ---- Manual trigger endpoint(testing) -------------------------------------
# 不在 router 注册;暴露给 dashboard router 用,leader/admin 可手工 fire
# 一次以验证规则触发逻辑(类似 cron-rule force-fire).

async def force_check_now(session: AsyncSession, workspace_id) -> dict[str, Any]:
    """手工跑一次所有规则,跳过 dedup 窗口.返回每条规则的判定 + 是否真触发."""
    out = {}
    for check_fn in _ALL_CHECKS:
        try:
            signal = await check_fn(session, workspace_id)
            kind = check_fn.__name__.replace("_check_", "")
            if signal is None:
                out[kind] = {"would_fire": False, "reason": "未达阈值或样本不足"}
            else:
                # 跳过 dedup 强制建
                task = await _create_alert_task_and_notify(session, workspace_id, signal)
                await session.commit()
                out[kind] = {
                    "would_fire": True,
                    "task_id": str(task.id),
                    "observed": signal["observed"],
                    "threshold": signal["threshold"],
                }
        except Exception as e:
            out[check_fn.__name__] = {"would_fire": False, "error": str(e)}
            await session.rollback()
    return out
