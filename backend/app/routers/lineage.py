"""v26.5-Lineage P2 · 数据血缘 API.

给前端桑基图 / 单 AI 视图 提供 3 层节点 + 边:
  来源 (会议 / 上传文件)  →  数据 (KB Document / Memory)  →  AI 专家

Endpoints:
  GET /api/lineage              — 全景 (整个 workspace)
  GET /api/lineage/agent/{id}   — 单 AI 视角 (只看挂到这个 agent 的数据 +
                                  这些数据的来源)

返回结构 (统一):
  {
    "nodes": [{id, type, label, meta}],
    "edges": [{source, target, kind, weight}]
  }
  type ∈ {meeting, upload, kb_doc, memory, agent}
  kind ∈ {source, primary, subscriber, reference, sediment_pending}
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import (
    Agent,
    KbSedimentationDraft,
    KnowledgeBase,
    KnowledgeDocument,
    LongTermMemory,
    Meeting,
    MemoryAgentLink,
    MemoryDraft,
    User,
)

router = APIRouter(prefix="/api/lineage", tags=["lineage"])


class Node(BaseModel):
    id: str
    type: str  # meeting | upload | kb_doc | memory | agent
    label: str
    meta: Optional[dict[str, Any]] = None  # type-specific extras


class Edge(BaseModel):
    source: str
    target: str
    kind: str  # source | primary | subscriber | reference | sediment_pending
    weight: float = 1.0


class LineageOut(BaseModel):
    nodes: list[Node]
    edges: list[Edge]
    stats: dict[str, int]


def _node_id(prefix: str, raw: Any) -> str:
    return f"{prefix}:{raw}"


async def _build_lineage(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    only_agent_id: Optional[uuid.UUID] = None,
) -> LineageOut:
    """核心:扫 workspace 内 agent / KB document / memory / 会议, 拼血缘图.

    only_agent_id 非空 → 仅 看 挂到该 agent 的数据 + 数据的来源 (单 AI 视角).
    """
    nodes_map: dict[str, Node] = {}
    edges: list[Edge] = []

    def add_node(n: Node) -> None:
        if n.id not in nodes_map:
            nodes_map[n.id] = n

    def add_edge(e: Edge) -> None:
        edges.append(e)

    # --- 1. agents 节点 ---
    ag_q = select(Agent).where(Agent.workspace_id == workspace_id)
    if only_agent_id:
        ag_q = ag_q.where(Agent.id == only_agent_id)
    agents = list((await session.execute(ag_q)).scalars().all())
    if not agents:
        return LineageOut(nodes=[], edges=[], stats={
            "agents": 0, "kb_docs": 0, "memories": 0, "meetings": 0, "uploads": 0,
        })
    for a in agents:
        add_node(Node(
            id=_node_id("agent", a.id),
            type="agent",
            label=a.name,
            meta={
                "color": a.color,
                "domain": a.domain,
                "primary_user_id": str(a.primary_user_id) if a.primary_user_id else None,
                "is_active": a.is_active,
            },
        ))

    # 限定 agent 范围 (set 用于 filter 边)
    agent_ids = {a.id for a in agents}
    # 该 workspace 所有 agent (即使 single-AI 视角也要拿来 join, 单 AI 边只画到本 agent)
    all_agents_q = select(Agent).where(Agent.workspace_id == workspace_id)
    all_agents = list((await session.execute(all_agents_q)).scalars().all())
    all_agent_by_id = {a.id: a for a in all_agents}

    # --- 2. KB documents → agent 边 ---
    # 拉 workspace 所有 KB (need owner_agent_id + name)
    kbs = list((await session.execute(
        select(KnowledgeBase).where(KnowledgeBase.workspace_id == workspace_id)
    )).scalars().all())
    kb_by_id = {kb.id: kb for kb in kbs}
    # 拉 documents
    if kbs:
        kb_ids = [kb.id for kb in kbs]
        docs = list((await session.execute(
            select(KnowledgeDocument).where(KnowledgeDocument.kb_id.in_(kb_ids))
        )).scalars().all())
    else:
        docs = []

    # 反向: Agent.knowledge_base_ids 数组 — 每个 agent 引用哪些 KB
    # 然后 KB 包含的 docs 都成为 agent 的 referenced docs
    agent_kb_refs: dict[uuid.UUID, set[uuid.UUID]] = {}
    for a in all_agents:
        for kid in a.knowledge_base_ids or []:
            agent_kb_refs.setdefault(a.id, set()).add(kid)

    kb_doc_count = 0
    for d in docs:
        kb = kb_by_id.get(d.kb_id)
        if not kb:
            continue
        # 决定哪些 agent 看到这个 doc:
        #  - KB.owner_agent_id (primary, 写入权)
        #  - 任何 agent.knowledge_base_ids 含 kb.id (subscriber, 引用)
        related_agent_ids: set[uuid.UUID] = set()
        if kb.owner_agent_id:
            related_agent_ids.add(kb.owner_agent_id)
        for aid, kids in agent_kb_refs.items():
            if kb.id in kids:
                related_agent_ids.add(aid)
        if only_agent_id and only_agent_id not in related_agent_ids:
            continue  # 这个 doc 跟 only_agent 无关
        # 节点
        add_node(Node(
            id=_node_id("kb_doc", d.id),
            type="kb_doc",
            label=d.filename[:60],
            meta={
                "kb_id": str(kb.id),
                "kb_name": kb.name,
                "owner_agent_id": str(kb.owner_agent_id) if kb.owner_agent_id else None,
                "source_type": d.source_type,
                "char_count": d.char_count,
                "chunk_count": d.chunk_count,
                "data_classification": d.data_classification,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            },
        ))
        kb_doc_count += 1
        # 来源边: 上传文件 (manual) 或 任务沉淀
        if d.source_type == "manual":
            # 用户上传 — curated_by_user_id
            if d.curated_by_user_id:
                u_node_id = _node_id("upload", d.curated_by_user_id)
                # 拉 user name (lazy, 用 sub-query 太麻烦, 先 用 id 后面再 batch 补)
                add_node(Node(
                    id=u_node_id,
                    type="upload",
                    label="📁 用户上传",
                    meta={"user_id": str(d.curated_by_user_id)},
                ))
                add_edge(Edge(source=u_node_id, target=_node_id("kb_doc", d.id), kind="source"))
            else:
                # 没 curated_by — 显示为 系统上传 (老数据)
                add_node(Node(
                    id="upload:system",
                    type="upload",
                    label="📁 系统/老数据",
                ))
                add_edge(Edge(source="upload:system", target=_node_id("kb_doc", d.id), kind="source"))
        elif d.source_type == "task" and d.source_task_id:
            # 任务沉淀来 — 暂用 task id 作为来源 (可改成 meeting if task.source_ref.meeting_id)
            add_node(Node(
                id=_node_id("task", d.source_task_id),
                type="meeting",  # 把 task 也归类成 "会议/任务" 这一列
                label=f"📋 任务",
                meta={"task_id": str(d.source_task_id)},
            ))
            add_edge(Edge(
                source=_node_id("task", d.source_task_id),
                target=_node_id("kb_doc", d.id),
                kind="source",
            ))
        # doc → agent 边
        for aid in related_agent_ids:
            if aid not in agent_ids:
                continue  # 单 AI 视角时跳过
            kind = "primary" if (kb.owner_agent_id == aid) else "reference"
            add_edge(Edge(
                source=_node_id("kb_doc", d.id),
                target=_node_id("agent", aid),
                kind=kind,
            ))

    # --- 3. Memory → agent 边 (多对多通过 memory_agent_link) ---
    mem_q = select(LongTermMemory).where(LongTermMemory.workspace_id == workspace_id)
    memories = list((await session.execute(mem_q)).scalars().all())
    if memories:
        mids = [m.id for m in memories]
        links = list((await session.execute(
            select(MemoryAgentLink).where(MemoryAgentLink.memory_id.in_(mids))
        )).scalars().all())
    else:
        links = []
    # memory_id → [(agent_id, is_primary)]
    mem_agents: dict[uuid.UUID, list[tuple[uuid.UUID, bool]]] = {}
    for lk in links:
        mem_agents.setdefault(lk.memory_id, []).append((lk.agent_id, lk.is_primary))

    mem_count = 0
    meeting_ids: set[uuid.UUID] = set()
    for m in memories:
        agents_for_m = mem_agents.get(m.id, [])
        # 老兼容: 如果 link 表没记录但 agent_id 字段有值, 视为 primary
        if not agents_for_m and m.agent_id:
            agents_for_m = [(m.agent_id, True)]
        related_aids = {aid for aid, _ in agents_for_m}
        if only_agent_id and only_agent_id not in related_aids:
            continue
        # 节点
        add_node(Node(
            id=_node_id("memory", m.id),
            type="memory",
            label=m.content[:60],
            meta={
                "scope": m.scope,
                "scope_ref": m.scope_ref,
                "importance": m.importance,
                "data_classification": m.data_classification,
                "source_type": m.source_type,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            },
        ))
        mem_count += 1
        # 来源边: 会议
        if m.source_meeting_id:
            meeting_ids.add(m.source_meeting_id)
            add_edge(Edge(
                source=_node_id("meeting", m.source_meeting_id),
                target=_node_id("memory", m.id),
                kind="source",
            ))
        elif m.source_type == "manual" and m.curated_by_user_id:
            u_node_id = _node_id("upload", m.curated_by_user_id)
            add_node(Node(
                id=u_node_id,
                type="upload",
                label="📁 手工录入",
                meta={"user_id": str(m.curated_by_user_id)},
            ))
            add_edge(Edge(source=u_node_id, target=_node_id("memory", m.id), kind="source"))
        # → agent 边
        for aid, is_primary in agents_for_m:
            if aid not in agent_ids:
                continue
            add_edge(Edge(
                source=_node_id("memory", m.id),
                target=_node_id("agent", aid),
                kind="primary" if is_primary else "subscriber",
            ))

    # --- 4. 会议节点 (从 meeting_ids 解析 title) ---
    if meeting_ids:
        meetings = list((await session.execute(
            select(Meeting).where(Meeting.id.in_(meeting_ids))
        )).scalars().all())
        for mtg in meetings:
            add_node(Node(
                id=_node_id("meeting", mtg.id),
                type="meeting",
                label=f"🎙️ {mtg.title or '未命名会议'}",
                meta={
                    "meeting_id": str(mtg.id),
                    "status": mtg.status,
                    "started_at": mtg.started_at.isoformat() if mtg.started_at else None,
                },
            ))

    # --- 5. upload 节点补 user name ---
    upload_user_ids: set[uuid.UUID] = set()
    for n in nodes_map.values():
        if n.type == "upload" and n.meta and n.meta.get("user_id"):
            try:
                upload_user_ids.add(uuid.UUID(n.meta["user_id"]))
            except (ValueError, TypeError):
                pass
    if upload_user_ids:
        users = list((await session.execute(
            select(User).where(User.id.in_(upload_user_ids))
        )).scalars().all())
        for u in users:
            nid = _node_id("upload", u.id)
            if nid in nodes_map:
                nodes_map[nid].label = f"📁 {u.name}"

    return LineageOut(
        nodes=list(nodes_map.values()),
        edges=edges,
        stats={
            "agents": len(agents),
            "kb_docs": kb_doc_count,
            "memories": mem_count,
            "meetings": len(meeting_ids),
            "uploads": len([n for n in nodes_map.values() if n.type == "upload"]),
        },
    )


@router.get("", response_model=LineageOut)
async def get_full_lineage(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """全景血缘图 — 整个 workspace 的 AI/KB/Memory/来源 关系."""
    return await _build_lineage(session, auth.workspace.id, only_agent_id=None)


@router.get("/agent/{agent_id}", response_model=LineageOut)
async def get_agent_lineage(
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """单 AI 视角 — 看 挂到这个 agent 的 KB Doc + Memory + 它们的来源."""
    try:
        aid = uuid.UUID(agent_id)
    except (ValueError, TypeError):
        raise HTTPException(400, "invalid agent_id")
    # 校验同 ws
    a = (
        await session.execute(
            select(Agent).where(Agent.id == aid, Agent.workspace_id == auth.workspace.id)
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    return await _build_lineage(session, auth.workspace.id, only_agent_id=aid)
