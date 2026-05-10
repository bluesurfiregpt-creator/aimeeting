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

from .db import SessionLocal
from .models import Meeting, MeetingActionItem, Task, WorkspaceMembership
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
                            WorkspaceMembership.role.in_(["owner", "admin"]),
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
        except Exception:  # belt + suspenders: never let a bad row kill the loop
            logger.exception("due_reminder tick failed")
        # Sleep with cancellation: if the lifespan sets stop_event we exit
        # promptly instead of finishing the full sleep.
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            continue
    logger.info("due_reminder_loop exiting")
