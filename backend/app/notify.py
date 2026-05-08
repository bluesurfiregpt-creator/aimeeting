"""
Theme 1 (P0) — small helper for writing into the `notification` table.

Why a tiny module instead of inline DB writes?

  * Three call sites (action create / update, comment create, cron tick)
    all need the same dedup-within-24h policy for cron-style kinds. Doing
    it once here keeps that policy honest.
  * The cron and the request handlers share the same async session
    factory pattern, but each owns its own session. Helpers here take an
    `AsyncSession` so the caller controls the unit of work.

Notification kinds:

  - 'action_assigned'  — a user was just made the assignee
  - 'action_due_soon'  — within 24h of due_at (cron-generated)
  - 'action_overdue'   — past due_at (cron-generated)
  - 'action_comment'   — someone (not the author) commented on an action
                        the user is involved in (assignee or prior commenter)

For cron-generated kinds we apply 24h dedup per (user, action, kind):
this lets the cron run every few minutes idempotently without spamming
the bell. Event-driven kinds (`action_assigned`, `action_comment`) don't
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

# Dedup window. 24h matches the daily cadence the cron implies.
_DEDUP_WINDOW = timedelta(hours=24)


async def emit_notification(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    payload: Optional[dict[str, Any]] = None,
    action_id_for_dedup: Optional[uuid.UUID] = None,
) -> Optional[Notification]:
    """
    Insert a notification, applying 24h dedup for cron-style kinds.

    Returns the inserted row, or None if dedup suppressed it.

    The caller is responsible for `session.commit()` — we only stage the
    row + flush so the new id is available to the caller. This way the
    create-action / create-comment handlers commit one transaction with
    both the domain row and the notification, and the cron commits in
    its own loop.
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
        cutoff = datetime.now(timezone.utc) - _DEDUP_WINDOW
        existing_q = (
            select(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.kind == kind,
                Notification.created_at >= cutoff,
            )
            .limit(1)
        )
        # Match on payload->>'action_id' inside the JSON. We do this in
        # Python instead of a JSON path expression so the helper stays
        # portable across PG json/jsonb without needing JSONB everywhere.
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
        payload=payload,
    )
    session.add(row)
    await session.flush()  # populate `row.id` without committing the txn
    return row
