"""
Lightweight audit logging.

We keep instrumentation deliberately minimal in this sprint: any caller can
`await audit_log(db, auth, action, target_type, target_id, payload)` from
within an existing request to record an event. A separate /api/audit
endpoint reads back, scoped by workspace.

Why not a middleware? FastAPI middlewares fire before route resolution and
don't easily see the parsed user/workspace context. A helper called from
inside routes has clear typing and lets us record the *outcome* (e.g.
'created with id=...') instead of just the request shape.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .auth import AuthContext
from .models import AuditLog

logger = logging.getLogger(__name__)


async def audit_log(
    db: AsyncSession,
    auth: AuthContext,
    action: str,
    *,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    autocommit: bool = True,
) -> None:
    """
    Record one audit event. Errors are logged but never raised — auditing
    must not break the user-facing operation.
    """
    try:
        db.add(
            AuditLog(
                workspace_id=auth.workspace.id,
                user_id=auth.user.id,
                action=action,
                target_type=target_type,
                target_id=str(target_id) if target_id is not None else None,
                payload=payload,
            )
        )
        if autocommit:
            await db.commit()
    except Exception:
        logger.exception("audit_log write failed (action=%s)", action)
