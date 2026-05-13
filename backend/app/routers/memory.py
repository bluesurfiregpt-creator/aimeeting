"""Long-term memory admin: list, manual add, edit, delete."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    AuthContext,
    get_current_auth,
    is_agent_manager,
    is_leader_or_admin,
    require_leader_or_admin,
)
from ..db import get_session
from ..embeddings import EmbeddingError, compute_embedding
from ..models import Agent, LongTermMemory

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryIn(BaseModel):
    scope: str  # 'user' | 'project' | 'org'
    scope_ref: Optional[str] = None
    content: str
    importance: float = 0.5
    # v26.5-02b: 归属 AI 专家 (nullable — None = workspace 通用记忆).
    # 写时: agent_id 非空 → 走 is_agent_manager(agent_id); None → 走 leader+
    agent_id: Optional[uuid.UUID] = None


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    scope: str
    scope_ref: Optional[str] = None
    content: str
    importance: float
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    # v26.5-02b: 归属 AI (前端展示徽章 + 决定可改)
    agent_id: Optional[uuid.UUID] = None
    agent_name: Optional[str] = None  # 展示用
    created_at: datetime


def _to_out(m: LongTermMemory, agent_name: Optional[str] = None) -> MemoryOut:
    return MemoryOut.model_validate({**m.__dict__, "agent_name": agent_name})


@router.get("", response_model=list[MemoryOut])
async def list_memories(
    scope: Optional[str] = None,
    scope_ref: Optional[str] = None,
    agent_id: Optional[uuid.UUID] = None,
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
    if agent_id:
        # v26.5-02b: 按 agent_id 过滤 (manager 查自己 AI 的记忆用)
        stmt = stmt.where(LongTermMemory.agent_id == agent_id)
    rows = (await session.execute(stmt)).scalars().all()
    # 批量 resolve agent.id → agent.name 给 UI
    aid_set = {m.agent_id for m in rows if m.agent_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if aid_set:
        ag_rows = (
            await session.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_(aid_set))
            )
        ).all()
        name_by_id = {r[0]: r[1] for r in ag_rows}
    return [_to_out(r, name_by_id.get(r.agent_id)) for r in rows]


@router.post("", response_model=MemoryOut)
async def create_memory(
    payload: MemoryIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-02b P1: 写长期记忆 — 两条路径:
    #   1) agent_id 非空 → 走 is_agent_manager(agent_id):
    #      leader+ 或 该 agent 的 primary_user 可写 (manager 给自己 AI 写)
    #   2) agent_id 为空 → workspace 通用记忆, 仍 仅 leader+ 可写
    if payload.agent_id:
        # 校验 同 workspace
        ag = (
            await session.execute(
                select(Agent).where(
                    Agent.id == payload.agent_id,
                    Agent.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if ag is None:
            raise HTTPException(400, "agent_id 必须是 同 workspace 的 agent")
        if not await is_agent_manager(session, auth, payload.agent_id):
            raise HTTPException(
                403,
                "[权限不足] 写此 AI 的记忆 需要 owner/admin/leader,"
                "或 该 AI 的 primary_user (manager)"
            )
        agent_name: Optional[str] = ag.name
    else:
        await require_leader_or_admin(session, auth)
        agent_name = None

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
        agent_id=payload.agent_id,
        workspace_id=auth.workspace.id,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return _to_out(m, agent_name)


@router.delete("/{memory_id}", status_code=204)
async def delete_memory(
    memory_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-02b P1: 删 — 同 写: 有 agent_id 则 走 is_agent_manager, 无则 leader+
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
    if m.agent_id:
        if not await is_agent_manager(session, auth, m.agent_id):
            raise HTTPException(
                403,
                "[权限不足] 删此 AI 的记忆 需要 owner/admin/leader,"
                "或 该 AI 的 primary_user (manager)"
            )
    else:
        await require_leader_or_admin(session, auth)
    await session.delete(m)
    await session.commit()
