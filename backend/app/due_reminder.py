"""
Theme 1 (P0) — background loop that emits `action_due_soon` and
`action_overdue` notifications.

Cadence: wakes every `_TICK_SECONDS` (1h by default). Each tick scans
open action items with a non-null `due_at`, classifies them into
DUE_SOON (within 24h) or OVERDUE (past due_at), and emits one
notification per (assignee, action) — deduplicated within 24h by the
helper in `notify.py`.

We deliberately avoid a heavy scheduler. One asyncio.create_task in the
FastAPI lifespan is enough for the foreseeable workload (P0 scale).
When we outgrow it we'll move to APScheduler / Celery beat — same
emit_notification call, different driver.
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
from .models import Meeting, MeetingActionItem
from .notify import emit_notification

logger = logging.getLogger(__name__)

# Tick cadence. 1h is plenty: dedup is 24h, due-soon window is 24h.
_TICK_SECONDS = int(os.getenv("DUE_REMINDER_TICK_SECONDS", "3600"))
# How far ahead to consider "due soon".
_DUE_SOON_WINDOW = timedelta(hours=24)


async def _tick_once(session: AsyncSession) -> tuple[int, int]:
    """
    One pass over open, dated action items. Returns (due_soon, overdue)
    counts of *attempted* emits (some may dedup-skip inside emit_notification).
    """
    now = datetime.now(timezone.utc)
    soon_cutoff = now + _DUE_SOON_WINDOW

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

    soon_n = overdue_n = 0
    for action, meeting_title in rows:
        if action.due_at is None or action.assignee_user_id is None:
            continue
        if action.due_at < now:
            kind = "action_overdue"
            days_overdue = max(0, (now - action.due_at).days)
            payload = {
                "meeting_id": str(action.meeting_id),
                "meeting_title": meeting_title,
                "action_id": str(action.id),
                "content": action.content,
                "due_at": action.due_at.isoformat(),
                "days_overdue": days_overdue,
            }
            overdue_n += 1
        else:
            kind = "action_due_soon"
            payload = {
                "meeting_id": str(action.meeting_id),
                "meeting_title": meeting_title,
                "action_id": str(action.id),
                "content": action.content,
                "due_at": action.due_at.isoformat(),
            }
            soon_n += 1
        await emit_notification(
            session,
            workspace_id=action.workspace_id,
            user_id=action.assignee_user_id,
            kind=kind,
            payload=payload,
            action_id_for_dedup=action.id,
        )
    await session.commit()
    return soon_n, overdue_n


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
                soon_n, overdue_n = await _tick_once(session)
                if soon_n or overdue_n:
                    logger.info(
                        "due_reminder tick: due_soon=%d overdue=%d",
                        soon_n,
                        overdue_n,
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
