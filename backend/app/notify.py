"""
Theme 1 (P0) → v18 — small helper for writing into the `notification` table.

Why a tiny module instead of inline DB writes?

  * Multiple call sites (action create / update, task lifecycle, comment
    create, cron tick) all need consistent dedup policy for cron-style
    kinds. Doing it once here keeps that policy honest.
  * The cron and the request handlers share the same async session
    factory pattern, but each owns its own session. Helpers here take an
    `AsyncSession` so the caller controls the unit of work.

Notification kinds:

  v16 (Theme 1 P0):
  - 'action_assigned'  — a user was just made the assignee
  - 'action_due_soon'  — within 3d of due_at (cron-generated, severity=yellow)
  - 'action_overdue'   — past due_at (cron-generated, severity=red/purple)
  - 'action_comment'   — someone (not the author) commented on an action
                        the user is involved in (assignee or prior commenter)

  v18 (Task lifecycle):
  - 'task_dispatched'  — a task was dispatched to you
  - 'task_accepted'    — your dispatched task was accepted (notify dispatcher)
  - 'task_returned'    — your dispatched task was returned (notify dispatcher)
  - 'task_completed'   — your dispatched task was completed (notify dispatcher)

  v19 (上报办结申请审核):
  - 'task_submitted'   — assignee submitted for review (notify dispatcher/creator)
  - 'task_approved'    — reviewer approved the submission (notify assignee)
  - 'task_rejected'    — reviewer rejected the submission (notify assignee with reason)

  v21 (跨 AI 数据访问申请):
  - 'access_requested' — someone wants to read your data (notify owner)
  - 'access_approved'  — your request was approved (notify requester, with expires_at)
  - 'access_rejected'  — your request was rejected (notify requester, with reason)

Severity (v18):
  normal — default, all event-driven kinds
  yellow — due_soon (≤3d to due) — bell + (later) WeChat work
  red    — overdue, days_overdue < 3 — bell + WeChat + SMS
  purple — overdue, days_overdue ≥ 3 — also notify workspace admins/owners

Cron-style dedup:
  yellow   → 48h window  (黄灯每 2 天一次)
  red      → 24h window  (红灯每天一次)
  purple   → 24h window  (紫灯每天一次)
  legacy   → 24h window  (no severity / 'normal' — back-compat)

Event-driven kinds (`action_assigned` / `action_comment` / `task_*`) don't
dedup — each event is a real new thing the user should see.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Notification

logger = logging.getLogger(__name__)

# Kinds that are emitted by the cron tick and therefore must dedup so we
# don't fill the bell with duplicates each time the worker wakes up.
_DEDUP_KINDS: frozenset[str] = frozenset({"action_due_soon", "action_overdue"})

# v18: severity-aware dedup windows (smart_construction 三级催办).
_DEDUP_WINDOWS: dict[str, timedelta] = {
    "yellow": timedelta(hours=48),
    "red": timedelta(hours=24),
    "purple": timedelta(hours=24),
    "normal": timedelta(hours=24),  # legacy fallback
}


async def emit_notification(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    severity: str = "normal",
    payload: Optional[dict[str, Any]] = None,
    action_id_for_dedup: Optional[uuid.UUID] = None,
) -> Optional[Notification]:
    """
    Insert a notification, applying severity-aware dedup for cron-style kinds.

    Returns the inserted row, or None if dedup suppressed it.

    The caller is responsible for `session.commit()` — we only stage the
    row + flush so the new id is available to the caller.
    """
    if kind in _DEDUP_KINDS:
        if action_id_for_dedup is None:
            # Cron-style kind without an action_id key would silently
            # spam — log loudly and skip.
            logger.warning(
                "emit_notification(kind=%s) missing action_id_for_dedup; skipping",
                kind,
            )
            return None
        window = _DEDUP_WINDOWS.get(severity, _DEDUP_WINDOWS["normal"])
        cutoff = datetime.now(timezone.utc) - window
        existing_q = (
            select(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.kind == kind,
                Notification.severity == severity,
                Notification.created_at >= cutoff,
            )
            .limit(5)
        )
        rows = (await session.execute(existing_q)).scalars().all()
        for r in rows:
            if (
                isinstance(r.payload, dict)
                and r.payload.get("action_id") == str(action_id_for_dedup)
            ):
                return None  # dedup hit — skip insert

    row = Notification(
        workspace_id=workspace_id,
        user_id=user_id,
        kind=kind,
        severity=severity,
        payload=payload,
    )
    session.add(row)
    await session.flush()  # populate `row.id` without committing the txn
    return row
