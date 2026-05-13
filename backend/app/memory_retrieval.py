"""
Long-term memory retrieval via pgvector cosine similarity.

Used by:
- agent_router: inject top-k relevant memories into the agent's system prompt
- briefing_generator: pull recent memories for upcoming meetings
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .embeddings import EmbeddingError, compute_embedding
from .models import LongTermMemory

logger = logging.getLogger(__name__)


@dataclass
class RetrievedMemory:
    id: str
    scope: str
    scope_ref: Optional[str]
    content: str
    importance: float
    distance: float  # 0.0 = identical, 2.0 = opposite (cosine distance)


async def retrieve_relevant(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    query_text: str,
    project_refs: Optional[list[str]] = None,
    user_refs: Optional[list[str]] = None,
    agent_id: Optional[uuid.UUID] = None,
    k: int = 5,
    min_importance: float = 0.0,
) -> list[RetrievedMemory]:
    """
    Find up to `k` memories closest to `query_text` in embedding space.

    Always filters by workspace_id — without this, agents in workspace A
    would see memories from workspace B (cross-tenant leak).

    Scope filters (合取):
      - project_refs: when set, only include scope=='project' rows whose
        scope_ref ∈ project_refs (typically the meeting title)
      - user_refs: when set, only include scope=='user' rows whose
        scope_ref ∈ user_refs (attendee names)
      - org-scoped rows are always eligible (organisation-wide knowledge)

    v26.7-01: agent_id 过滤 (核心 — 减少 跨 AI 噪音):
      传入 agent_id 时, 仅 返回
        (a) 挂在 该 agent 的 memory (走 memory_agent_link 关系表
            OR 老 long_term_memory.agent_id 字段兼容)
        (b) 或 workspace 通用记忆 (agent_id IS NULL 且 link 表里 也没 link)
      → 房屋安全 AI 回答时, 不会拿到 物业 AI 的 memory 作 RAG 上下文.

    不传 agent_id (None) → 老行为 (全 workspace, 无 agent 过滤).

    Empty result is normal — early on, the long_term_memory table is empty
    and we just return [].
    """
    if not query_text.strip():
        return []
    try:
        qvec = await compute_embedding(query_text)
    except EmbeddingError:
        logger.exception("retrieve_relevant: embedding failed; returning []")
        return []

    distance_expr = LongTermMemory.embedding.cosine_distance(qvec).label("distance")
    stmt = (
        select(LongTermMemory, distance_expr)
        .where(LongTermMemory.workspace_id == workspace_id)
    )

    scope_filters = [LongTermMemory.scope == "org"]
    if project_refs:
        scope_filters.append(
            (LongTermMemory.scope == "project")
            & LongTermMemory.scope_ref.in_(project_refs)
        )
    if user_refs:
        scope_filters.append(
            (LongTermMemory.scope == "user")
            & LongTermMemory.scope_ref.in_(user_refs)
        )
    if scope_filters:
        stmt = stmt.where(or_(*scope_filters))

    # v26.7-01: agent_id 过滤 (核心新逻辑)
    if agent_id is not None:
        from .models import MemoryAgentLink
        # 子查询: 挂到本 agent 的 memory ids
        linked_ids_subq = select(MemoryAgentLink.memory_id).where(
            MemoryAgentLink.agent_id == agent_id
        )
        # 子查询: 任何 agent 挂过的 memory ids (用于判断 "workspace 通用")
        any_linked_ids_subq = select(MemoryAgentLink.memory_id)
        stmt = stmt.where(
            or_(
                # 走 link 表 (新)
                LongTermMemory.id.in_(linked_ids_subq),
                # 老 agent_id 字段 兼容
                LongTermMemory.agent_id == agent_id,
                # workspace 通用: agent_id 为空 且 也没在 link 表里
                (LongTermMemory.agent_id.is_(None))
                & (LongTermMemory.id.notin_(any_linked_ids_subq)),
            )
        )

    if min_importance > 0:
        stmt = stmt.where(LongTermMemory.importance >= min_importance)

    stmt = stmt.order_by(distance_expr).limit(k)

    rows = (await db.execute(stmt)).all()
    return [
        RetrievedMemory(
            id=str(m.id),
            scope=m.scope,
            scope_ref=m.scope_ref,
            content=m.content,
            importance=m.importance,
            distance=float(d),
        )
        for (m, d) in rows
    ]
