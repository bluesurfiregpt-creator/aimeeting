"""
Theme 1 (P0) → v18 — background loop that emits severity-tiered due
reminders (黄/红/紫) per the 智慧住建 三级催办 spec.

Cadence: wakes every `_TICK_SECONDS` (1h by default). Each tick scans
open action items with a non-null `due_at`, classifies into one of three
severity tiers, and emits one notification per (assignee, action, severity)
— deduplicated by `notify.emit_notification` per its severity-aware window.

  yellow (黄灯): now ≤ due_at ≤ now + 3d   — 距截止 ≤ 3 天未完成,2 天一次
  red    (红灯): now > due_at, days_overdue < 3 — 已超时不到 3 天,每天一次
  purple (紫灯): days_overdue ≥ 3            — 超时 ≥ 3 天,每天一次,
                                              **额外** 通知 workspace owner/admin

We deliberately avoid a heavy scheduler. One asyncio.create_task in the
FastAPI lifespan is enough for the foreseeable workload. When we outgrow
it we'll move to APScheduler / Celery beat — same emit_notification call,
different driver.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.exc import IntegrityError

from .db import SessionLocal
from .models import Meeting, MeetingActionItem, Task, TaskPenalty, User, WorkspaceMembership
from .notify import emit_notification

logger = logging.getLogger(__name__)

# Tick cadence. 1h fits all three severity windows comfortably.
_TICK_SECONDS = int(os.getenv("DUE_REMINDER_TICK_SECONDS", "3600"))
# Yellow horizon: how far ahead is "due soon".
_DUE_SOON_WINDOW = timedelta(days=3)
# Boundary between red and purple, in days.
_PURPLE_THRESHOLD_DAYS = 3
# v24.1 #4: 24h 签收超时催办 — dispatched 后 24h 内必须签收,否则催.
_DISPATCH_TIMEOUT = timedelta(hours=24)


def _classify(now: datetime, due_at: datetime) -> tuple[str, str, int]:
    """
    Return (kind, severity, days_overdue) for an action with `due_at`.

    `days_overdue` is 0 for non-overdue items.
    """
    if due_at < now:
        days_overdue = max(0, (now - due_at).days)
        if days_overdue >= _PURPLE_THRESHOLD_DAYS:
            return ("action_overdue", "purple", days_overdue)
        return ("action_overdue", "red", days_overdue)
    return ("action_due_soon", "yellow", 0)


async def _tick_once(session: AsyncSession) -> dict[str, int]:
    """
    One pass over open, dated action items. Returns a counter dict keyed
    by severity ('yellow' / 'red' / 'purple') of *attempted* emits;
    actual writes may be fewer due to dedup.
    """
    now = datetime.now(timezone.utc)
    soon_cutoff = now + _DUE_SOON_WINDOW
    counts = {"yellow": 0, "red": 0, "purple": 0, "purple_admins": 0}

    rows = (
        await session.execute(
            select(MeetingActionItem, Meeting.title)
            .join(Meeting, Meeting.id == MeetingActionItem.meeting_id)
            .where(
                MeetingActionItem.status == "open",
                MeetingActionItem.assignee_user_id.isnot(None),
                MeetingActionItem.due_at.isnot(None),
                MeetingActionItem.due_at <= soon_cutoff,
            )
        )
    ).all()

    # Cache (workspace_id) → list[admin_user_id] so purple emails to admins
    # don't query workspace_membership N times in the same tick.
    admin_cache: dict = {}

    for action, meeting_title in rows:
        if action.due_at is None or action.assignee_user_id is None:
            continue
        kind, severity, days_overdue = _classify(now, action.due_at)
        task_id_str = str(action.task_id) if action.task_id else None
        payload = {
            "meeting_id": str(action.meeting_id),
            "meeting_title": meeting_title,
            "action_id": str(action.id),
            "task_id": task_id_str,
            "content": action.content,
            "due_at": action.due_at.isoformat(),
        }
        if days_overdue > 0:
            payload["days_overdue"] = days_overdue
        await emit_notification(
            session,
            workspace_id=action.workspace_id,
            user_id=action.assignee_user_id,
            kind=kind,
            severity=severity,
            payload=payload,
            action_id_for_dedup=action.id,
        )
        counts[severity] = counts.get(severity, 0) + 1

        # Purple escalation: also notify workspace owner/admin so leadership
        # has visibility on chronically-stuck tasks. assignee already got
        # their own purple, so this is in addition (deduped per-user).
        if severity == "purple":
            if action.workspace_id not in admin_cache:
                admin_rows = (
                    await session.execute(
                        select(WorkspaceMembership.user_id).where(
                            WorkspaceMembership.workspace_id == action.workspace_id,
                            WorkspaceMembership.role.in_([
                                # v1.3.1: ws_admin_or_above 等同老 owner/admin/leader
                                "workspace_creator", "leader", "admin",
                                # 老兼容 (init_db 已 migrate, 但 防御性 保留)
                                "owner",
                            ]),
                        )
                    )
                ).all()
                admin_cache[action.workspace_id] = [r[0] for r in admin_rows]
            for admin_uid in admin_cache[action.workspace_id]:
                if admin_uid == action.assignee_user_id:
                    continue  # they already got the assignee notification
                admin_payload = dict(payload)
                admin_payload["assignee_user_id"] = str(action.assignee_user_id)
                admin_payload["escalated_to_admin"] = True
                await emit_notification(
                    session,
                    workspace_id=action.workspace_id,
                    user_id=admin_uid,
                    kind=kind,
                    severity="purple",
                    payload=admin_payload,
                    action_id_for_dedup=action.id,
                )
                counts["purple_admins"] += 1

    await session.commit()
    return counts


async def _tick_dispatch_overdue(session: AsyncSession) -> int:
    """
    v24.1 #4 — 24h 签收超时催办(智慧住建文档 §4.2).

    扫所有 Task.status='dispatched' 且 dispatched_at < now - 24h 的行,
    给 assignee 发 'task_dispatch_overdue'(red)+ dispatcher 发同 kind(yellow).
    24h dedup(同 task 同 kind 内最多一次/24h),通过 task_id 作为 dedup key.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - _DISPATCH_TIMEOUT

    rows = (
        await session.execute(
            select(Task).where(
                Task.status == "dispatched",
                Task.dispatched_at.is_not(None),
                Task.dispatched_at < cutoff,
                Task.assignee_user_id.is_not(None),
            )
        )
    ).scalars().all()

    fired = 0
    for t in rows:
        hours_overdue = int((now - t.dispatched_at).total_seconds() / 3600)
        payload = {
            "task_id": str(t.id),
            "title": t.title or t.content[:40],
            "content": t.content,
            "dispatched_at": t.dispatched_at.isoformat(),
            "hours_overdue": hours_overdue,
        }
        # 通知 assignee(必须签收的人)— red,催得重一点
        emitted = await emit_notification(
            session,
            workspace_id=t.workspace_id,
            user_id=t.assignee_user_id,
            kind="task_dispatch_overdue",
            severity="red",
            payload={**payload, "to_role": "assignee"},
            action_id_for_dedup=t.id,
            dedup_key_field="task_id",
        )
        if emitted is not None:
            fired += 1
        # 通知 dispatcher(知道下属没签收)— yellow,提醒级
        if t.dispatched_by_user_id and t.dispatched_by_user_id != t.assignee_user_id:
            emitted2 = await emit_notification(
                session,
                workspace_id=t.workspace_id,
                user_id=t.dispatched_by_user_id,
                kind="task_dispatch_overdue",
                severity="yellow",
                payload={**payload, "to_role": "dispatcher", "assignee_user_id": str(t.assignee_user_id)},
                action_id_for_dedup=t.id,
                dedup_key_field="task_id",
            )
            if emitted2 is not None:
                fired += 1

    await session.commit()
    return fired


async def _tick_penalties(session: AsyncSession) -> int:
    """
    v24.3 #3 — 超时扣分 + 连续 2 次重大暂停派单(智慧住建文档 §4.4).

    扫所有 active task with due_at past:
      - 3-7d 超时 → severe (-3)
      - >7d 超时 → major (-5)
    UNIQUE on (task, user, severity) 防重复扣.major 时检查近 30d 内
    是否已有 ≥1 条 major(算上本次就 ≥2),触发 user.suspended_until = now + 7d.

    Returns:fired count(本 tick 新插入的 penalty 数).
    """
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(
            select(Task).where(
                Task.assignee_user_id.is_not(None),
                Task.due_at.is_not(None),
                Task.due_at < now,
                Task.status.notin_(("done", "archived", "cancelled")),
            )
        )
    ).scalars().all()
    fired = 0
    for t in rows:
        days_overdue = (now - t.due_at).days
        if days_overdue < 3:
            continue
        severity = "major" if days_overdue >= 7 else "severe"
        score_delta = -5 if severity == "major" else -3

        # UPSERT-style:UNIQUE 拦,IntegrityError 跳过
        try:
            session.add(
                TaskPenalty(
                    workspace_id=t.workspace_id,
                    task_id=t.id,
                    user_id=t.assignee_user_id,
                    severity=severity,
                    score_delta=score_delta,
                    days_overdue=days_overdue,
                    reason=f"超时 {days_overdue} 天 (due_at={t.due_at.isoformat()})",
                )
            )
            await session.flush()
        except IntegrityError:
            await session.rollback()
            continue  # 已扣过这条 severity,不重扣

        fired += 1

        # 通知本人(red)+ 派发人(yellow)
        notify_payload = {
            "task_id": str(t.id),
            "title": (t.title or t.content[:40]),
            "severity": severity,
            "score_delta": score_delta,
            "days_overdue": days_overdue,
        }
        await emit_notification(
            session,
            workspace_id=t.workspace_id,
            user_id=t.assignee_user_id,
            kind="task_penalty",
            severity="red" if severity == "major" else "yellow",
            payload={**notify_payload, "to_role": "assignee"},
        )
        if t.dispatched_by_user_id and t.dispatched_by_user_id != t.assignee_user_id:
            await emit_notification(
                session,
                workspace_id=t.workspace_id,
                user_id=t.dispatched_by_user_id,
                kind="task_penalty",
                severity="yellow",
                payload={
                    **notify_payload,
                    "to_role": "dispatcher",
                    "assignee_user_id": str(t.assignee_user_id),
                },
            )

        # 重大 (major):看近 30d 是否已有另一条 major → 暂停派单 7d
        if severity == "major":
            cutoff_30d = now - timedelta(days=30)
            major_count = (
                await session.execute(
                    select(func.count(TaskPenalty.id)).where(
                        TaskPenalty.workspace_id == t.workspace_id,
                        TaskPenalty.user_id == t.assignee_user_id,
                        TaskPenalty.severity == "major",
                        TaskPenalty.created_at >= cutoff_30d,
                    )
                )
            ).scalar() or 0
            if major_count >= 2:
                # 暂停 7 天(若已暂停则取较远的)
                user = (
                    await session.execute(
                        select(User).where(User.id == t.assignee_user_id)
                    )
                ).scalar_one_or_none()
                if user is not None:
                    target_until = now + timedelta(days=7)
                    if user.suspended_until is None or user.suspended_until < target_until:
                        user.suspended_until = target_until
                    # 通知 user 自己 + workspace owners/admins
                    suspend_payload = {
                        "user_id": str(user.id),
                        "user_name": user.name,
                        "suspended_until": target_until.isoformat(),
                        "trigger_task_id": str(t.id),
                        "major_count_30d": int(major_count),
                    }
                    await emit_notification(
                        session,
                        workspace_id=t.workspace_id,
                        user_id=user.id,
                        kind="user_suspended",
                        severity="purple",
                        payload={**suspend_payload, "to_role": "self"},
                    )
                    leader_rows = (
                        await session.execute(
                            select(WorkspaceMembership.user_id).where(
                                WorkspaceMembership.workspace_id == t.workspace_id,
                                WorkspaceMembership.role.in_((
                                    # v1.3.1: ws_admin_or_above
                                    "workspace_creator", "leader", "admin",
                                    # 老兼容
                                    "owner",
                                )),
                            )
                        )
                    ).all()
                    for (lid,) in leader_rows:
                        if lid == user.id:
                            continue
                        await emit_notification(
                            session,
                            workspace_id=t.workspace_id,
                            user_id=lid,
                            kind="user_suspended",
                            severity="purple",
                            payload={**suspend_payload, "to_role": "leader"},
                        )

    if fired:
        await session.commit()
    return fired


async def due_reminder_loop(stop_event: asyncio.Event) -> None:
    """
    Long-running loop wired into the FastAPI lifespan. Sleeps between
    ticks but wakes promptly on shutdown via `stop_event`.
    """
    logger.info("due_reminder_loop starting; tick=%ds", _TICK_SECONDS)
    # First tick after a short warm-up so we don't spam during a hot reload.
    await asyncio.wait([asyncio.create_task(stop_event.wait())], timeout=15)
    while not stop_event.is_set():
        try:
            async with SessionLocal() as session:
                counts = await _tick_once(session)
                if any(counts.values()):
                    logger.info(
                        "due_reminder tick: yellow=%d red=%d purple=%d purple_admins=%d",
                        counts.get("yellow", 0),
                        counts.get("red", 0),
                        counts.get("purple", 0),
                        counts.get("purple_admins", 0),
                    )
                # v24.1 #4: 24h 签收超时催办 — 跟 due_at 维度的催办同 tick 跑
                dispatch_overdue_n = await _tick_dispatch_overdue(session)
                if dispatch_overdue_n:
                    logger.info(
                        "due_reminder dispatch-overdue tick: emitted %d notifications",
                        dispatch_overdue_n,
                    )
                # v24.3 #3: 超时扣分 + 暂停派单 — 同 tick 跑(智慧住建文档 §4.4)
                penalties = await _tick_penalties(session)
                if penalties:
                    logger.info(
                        "due_reminder penalty tick: %d new penalties applied",
                        penalties,
                    )
        except Exception:  # belt + suspenders: never let a bad row kill the loop
            logger.exception("due_reminder tick failed")
        # Sleep with cancellation: if the lifespan sets stop_event we exit
        # promptly instead of finishing the full sleep.
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            continue
    logger.info("due_reminder_loop exiting")
