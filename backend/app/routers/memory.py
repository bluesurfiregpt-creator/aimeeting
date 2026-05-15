"""Long-term memory admin: list, manual add, edit, delete.

v26.5-Lineage: Memory 改 多对多 (memory_agent_link).
  - POST/PATCH 接受 agent_ids: list (而不是单 agent_id)
  - 至少 1 个 agent_id 必填 (workspace 通用记忆 仅 leader+ 可写)
  - 第一个 agent_id 视为 primary (写 is_primary=TRUE 到 link 表),
    其他 视为 subscriber (is_primary=FALSE)
  - ABAC 走 is_agent_manager(任一 primary agent)
  - 老 long_term_memory.agent_id 字段 同步写 第一个 agent (兼容查询)
"""

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
    can_write_memory,
    get_current_auth,
    is_agent_manager,
    is_leader_or_admin,
    require_leader_or_admin,
    require_memory_writer,
)
from ..db import get_session
from ..embeddings import EmbeddingError, compute_embedding
from ..models import Agent, LongTermMemory, MemoryAgentLink

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryAgentBrief(BaseModel):
    """Memory 关联的 agent 摘要 (给前端血缘图 + 列表用)."""
    id: uuid.UUID
    name: str
    is_primary: bool


class MemoryIn(BaseModel):
    """v26.5-Lineage: 写 memory 接受 agent_ids 列表 (而不是 单 agent_id).

    - agent_ids 第一个 = primary (写权限主人).
    - agent_ids 后面的 = subscriber (只读引用).
    - agent_ids 为空 = workspace 通用记忆 (仅 leader+ 可写).
    - 老字段 agent_id 兼容: 如果 client 只传 agent_id, 视为 agent_ids=[agent_id].
    """
    scope: str  # 'user' | 'project' | 'org'
    scope_ref: Optional[str] = None
    content: str
    importance: float = 0.5
    agent_ids: Optional[list[uuid.UUID]] = None
    # 老字段, deprecated by agent_ids
    agent_id: Optional[uuid.UUID] = None

    def resolved_agent_ids(self) -> list[uuid.UUID]:
        if self.agent_ids:
            return list(self.agent_ids)
        if self.agent_id:
            return [self.agent_id]
        return []


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    scope: str
    scope_ref: Optional[str] = None
    content: str
    importance: float
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    # v26.5-Lineage: 多对多 agents
    agents: list[MemoryAgentBrief] = []
    # 溯源
    source_meeting_id: Optional[uuid.UUID] = None
    source_action_item_id: Optional[uuid.UUID] = None
    # v26.14-P7.3: 实录 出处 链回 — 行号 = meeting_transcript.id, 跳 focus 看 上下文
    source_line_ids: Optional[list[int]] = None
    curated_by_user_id: Optional[uuid.UUID] = None
    curated_at: Optional[datetime] = None
    created_at: datetime


async def _resolve_agents_for_memories(
    session: AsyncSession, memories: list[LongTermMemory]
) -> dict[uuid.UUID, list[MemoryAgentBrief]]:
    """批量 拿 memory_id → agents[] (合并 link 表 + 老 agent_id 字段)."""
    if not memories:
        return {}
    mids = [m.id for m in memories]
    # 链接表数据
    links = (
        await session.execute(
            select(MemoryAgentLink.memory_id, MemoryAgentLink.agent_id, MemoryAgentLink.is_primary)
            .where(MemoryAgentLink.memory_id.in_(mids))
        )
    ).all()
    # 收集所有 agent_id
    agent_ids: set[uuid.UUID] = set()
    for r in links:
        agent_ids.add(r[1])
    # 老 agent_id 字段 (兜底, 如果 link 表 还没有这条 memory 的 link, 用老字段)
    for m in memories:
        if m.agent_id:
            agent_ids.add(m.agent_id)
    # 拉 agent.name
    name_by_id: dict[uuid.UUID, str] = {}
    if agent_ids:
        rows = (
            await session.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
            )
        ).all()
        name_by_id = {r[0]: r[1] for r in rows}
    # 组装 memory → briefs
    out: dict[uuid.UUID, list[MemoryAgentBrief]] = {m.id: [] for m in memories}
    seen: dict[uuid.UUID, set[uuid.UUID]] = {m.id: set() for m in memories}
    for r in links:
        mid, aid, is_p = r[0], r[1], r[2]
        name = name_by_id.get(aid)
        if name is None:
            continue
        if aid not in seen[mid]:
            out[mid].append(MemoryAgentBrief(id=aid, name=name, is_primary=is_p))
            seen[mid].add(aid)
    # 兜底: 老 agent_id 没在 link 表里 (老数据 migration 应该处理过, 但 idempotent 防御)
    for m in memories:
        if m.agent_id and m.agent_id not in seen[m.id]:
            name = name_by_id.get(m.agent_id)
            if name:
                out[m.id].append(
                    MemoryAgentBrief(id=m.agent_id, name=name, is_primary=True)
                )
    return out


def _to_out(m: LongTermMemory, agents: list[MemoryAgentBrief]) -> MemoryOut:
    return MemoryOut.model_validate({**m.__dict__, "agents": agents})


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
        # 走 link 表 (多对多), 兼容 老 agent_id 字段
        link_q = select(MemoryAgentLink.memory_id).where(
            MemoryAgentLink.agent_id == agent_id
        )
        stmt = stmt.where(
            (LongTermMemory.agent_id == agent_id)
            | (LongTermMemory.id.in_(link_q))
        )
    rows = list((await session.execute(stmt)).scalars().all())
    agents_by_mid = await _resolve_agents_for_memories(session, rows)
    return [_to_out(r, agents_by_mid.get(r.id, [])) for r in rows]


@router.post("", response_model=MemoryOut)
async def create_memory(
    payload: MemoryIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.5-Lineage P1: 手工写 memory — 不走 gate, 直接入库.

    ABAC:
      - agent_ids 非空 → 至少 1 个 agent 满足 is_agent_manager
      - agent_ids 为空 → workspace 通用, 仅 leader+
    """
    aids = payload.resolved_agent_ids()
    if aids:
        # 校验 都在 同 workspace
        rows = (
            await session.execute(
                select(Agent).where(
                    Agent.id.in_(aids),
                    Agent.workspace_id == auth.workspace.id,
                )
            )
        ).scalars().all()
        if len(rows) != len(set(aids)):
            raise HTTPException(400, "agent_ids 包含 不在本 workspace 的 agent")
        # ABAC: 至少 第一个 agent 满足 is_agent_manager (primary 的)
        if not await is_agent_manager(session, auth, aids[0]):
            raise HTTPException(
                403,
                "[权限不足] 写此 memory 需要 owner/admin/leader,"
                "或第一个 agent (primary) 的 primary_user (manager)"
            )
    else:
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
        # 老兼容: agent_id 字段 = 第一个 (主) agent
        agent_id=aids[0] if aids else None,
        curated_by_user_id=auth.user.id,
        curated_at=datetime.utcnow(),
    )
    session.add(m)
    await session.flush()
    # v26.5-Lineage: 写 memory_agent_link (第一个 is_primary=TRUE, 其他 FALSE)
    for idx, aid in enumerate(aids):
        session.add(
            MemoryAgentLink(
                memory_id=m.id,
                agent_id=aid,
                is_primary=(idx == 0),
            )
        )
    await session.commit()
    await session.refresh(m)
    agents_by_mid = await _resolve_agents_for_memories(session, [m])
    return _to_out(m, agents_by_mid.get(m.id, []))


@router.delete("/{memory_id}", status_code=204)
async def delete_memory(
    memory_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-Lineage: 删 memory — 走 can_write_memory ABAC
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
    await require_memory_writer(session, auth, m.id)
    # CASCADE 自动清 memory_agent_link
    await session.delete(m)
    await session.commit()
