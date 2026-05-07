"""Audit log browser (workspace-scoped)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import AuditLog, User

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[uuid.UUID] = None
    user_name: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    ts: datetime


@router.get("", response_model=list[AuditOut])
async def list_audit(
    limit: int = 200,
    action: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    stmt = (
        select(AuditLog)
        .where(AuditLog.workspace_id == auth.workspace.id)
        .order_by(AuditLog.ts.desc())
        .limit(min(limit, 1000))
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []
    user_ids = {r.user_id for r in rows if r.user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    return [
        AuditOut.model_validate(
            {**r.__dict__, "user_name": name_by_id.get(r.user_id) if r.user_id else None}
        )
        for r in rows
    ]
