"""Long-term memory admin: list, manual add, edit, delete."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth, require_leader_or_admin
from ..db import get_session
from ..embeddings import EmbeddingError, compute_embedding
from ..models import LongTermMemory

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryIn(BaseModel):
    scope: str  # 'user' | 'project' | 'org'
    scope_ref: Optional[str] = None
    content: str
    importance: float = 0.5


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    scope: str
    scope_ref: Optional[str] = None
    content: str
    importance: float
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    created_at: datetime


def _to_out(m: LongTermMemory) -> MemoryOut:
    return MemoryOut.model_validate(m)


@router.get("", response_model=list[MemoryOut])
async def list_memories(
    scope: Optional[str] = None,
    scope_ref: Optional[str] = None,
    limit: int = 200,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    stmt = (
        select(LongTermMemory)
        .where(LongTermMemory.workspace_id == auth.workspace.id)
        .order_by(LongTermMemory.created_at.desc())
        .limit(limit)
    )
    if scope:
        stmt = stmt.where(LongTermMemory.scope == scope)
    if scope_ref:
        stmt = stmt.where(LongTermMemory.scope_ref == scope_ref)
    rows = (await session.execute(stmt)).scalars().all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=MemoryOut)
async def create_memory(
    payload: MemoryIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-01e P0: 写长期记忆 仅 owner/admin/leader.
    # P1 后启用 LongTermMemory.agent_id 字段, 让 manager 写自己管的 AI 的记忆.
    await require_leader_or_admin(session, auth)
    if payload.scope not in ("user", "project", "org"):
        raise HTTPException(400, "scope must be user|project|org")
    try:
        vec = await compute_embedding(payload.content)
    except EmbeddingError as e:
        raise HTTPException(503, f"embedding service unavailable: {e}")

    m = LongTermMemory(
        scope=payload.scope,
        scope_ref=payload.scope_ref,
        content=payload.content.strip(),
        importance=payload.importance,
        embedding=vec,
        source_type="manual",
        workspace_id=auth.workspace.id,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return _to_out(m)


@router.delete("/{memory_id}", status_code=204)
async def delete_memory(
    memory_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-01e P0: 删长期记忆 仅 owner/admin/leader.
    await require_leader_or_admin(session, auth)
    m = (
        await session.execute(
            select(LongTermMemory).where(
                LongTermMemory.id == memory_id,
                LongTermMemory.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "memory not found")
    await session.delete(m)
    await session.commit()
