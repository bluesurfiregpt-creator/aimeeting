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
        # v26.7-03: 如果 doc 有 source_meeting_id, 优先 画 会议 → doc 边
        if d.source_meeting_id:
            meeting_ids.add(d.source_meeting_id)
            add_edge(Edge(
                source=_node_id("meeting", d.source_meeting_id),
                target=_node_id("kb_doc", d.id),
                kind="source",
            ))
            # 不再走下面 manual/task 的 fallback (避免重复连边)
        # 来源边: 上传文件 (manual) 或 任务沉淀
        elif d.source_type == "manual":
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

    # --- 3.5. v26.7-04: 待审批草稿 边 (kb_sedimentation_draft + memory_draft) ---
    # 这些 draft 是 "Memory 还未入库" 的 准节点 — 画成 半透明虚线 边,
    # 帮 admin 一眼看到 "这个 AI 即将 接收 多少 待审 数据".
    pending_kb_drafts = list((await session.execute(
        select(KbSedimentationDraft).where(
            KbSedimentationDraft.workspace_id == workspace_id,
            KbSedimentationDraft.status == "pending",
        )
    )).scalars().all())
    pending_mem_drafts = list((await session.execute(
        select(MemoryDraft).where(
            MemoryDraft.workspace_id == workspace_id,
            MemoryDraft.status == "pending",
        )
    )).scalars().all())
    for d in pending_kb_drafts:
        if only_agent_id and d.target_agent_id != only_agent_id:
            continue
        if d.target_agent_id not in agent_ids:
            continue
        node_id = f"kb_draft:{d.id}"
        add_node(Node(
            id=node_id,
            type="kb_doc",  # 视觉上跟 kb_doc 同色 (半透明)
            label=f"⏳ 待审 KB: {d.proposed_summary[:30] if d.proposed_summary else ''}",
            meta={
                "draft_id": str(d.id),
                "status": "pending",
                "task_id": str(d.task_id) if d.task_id else None,
            },
        ))
        # 来源边: task → kb_draft (如果 task 来自 meeting 也连)
        if d.task_id:
            add_node(Node(
                id=_node_id("task", d.task_id),
                type="meeting",
                label=f"📋 任务",
                meta={"task_id": str(d.task_id)},
            ))
            add_edge(Edge(
                source=_node_id("task", d.task_id),
                target=node_id,
                kind="source",
            ))
        # kb_draft → agent 边 (sediment_pending kind, 半透明)
        add_edge(Edge(
            source=node_id,
            target=_node_id("agent", d.target_agent_id),
            kind="sediment_pending",
            weight=0.5,
        ))
    for d in pending_mem_drafts:
        target_aids: list[uuid.UUID] = []
        for aid in (d.target_agent_ids or []):
            try:
                target_aids.append(uuid.UUID(str(aid)))
            except (ValueError, TypeError):
                continue
        if only_agent_id and only_agent_id not in target_aids:
            continue
        in_scope = any(aid in agent_ids for aid in target_aids)
        if not in_scope:
            continue
        node_id = f"mem_draft:{d.id}"
        add_node(Node(
            id=node_id,
            type="memory",  # 视觉同色
            label=f"⏳ 待审 Memory: {d.proposed_content[:30]}",
            meta={
                "draft_id": str(d.id),
                "status": "pending",
                "source_meeting_id": str(d.source_meeting_id) if d.source_meeting_id else None,
            },
        ))
        # 来源边
        if d.source_meeting_id:
            meeting_ids.add(d.source_meeting_id)
            add_edge(Edge(
                source=_node_id("meeting", d.source_meeting_id),
                target=node_id,
                kind="source",
            ))
        elif d.source_task_id:
            add_node(Node(
                id=_node_id("task", d.source_task_id),
                type="meeting",
                label="📋 任务",
                meta={"task_id": str(d.source_task_id)},
            ))
            add_edge(Edge(
                source=_node_id("task", d.source_task_id),
                target=node_id,
                kind="source",
            ))
        # → agent 边
        for aid in target_aids:
            if aid not in agent_ids:
                continue
            add_edge(Edge(
                source=node_id,
                target=_node_id("agent", aid),
                kind="sediment_pending",
                weight=0.5,
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

    # v26.7-04: 待审批草稿 计数
    pending_drafts = len([n for n in nodes_map.values() if n.id.startswith(("kb_draft:", "mem_draft:"))])
    return LineageOut(
        nodes=list(nodes_map.values()),
        edges=edges,
        stats={
            "agents": len(agents),
            "kb_docs": kb_doc_count,
            "memories": mem_count,
            "meetings": len(meeting_ids),
            "uploads": len([n for n in nodes_map.values() if n.type == "upload"]),
            "pending_drafts": pending_drafts,  # v26.7-04
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


# ════════════════════════════════════════════
# round-6 R5.B-replace · 桑基图 (Sankey) 接口
#
# 跟旧 GET /api/lineage 的差异:
#  - 数据结构不同: nodes/links (而非 nodes/edges), links 有 value 字段 (流量宽度)
#  - 节点类型简化: kb/agent/memory/meeting (旧的 upload/kb_doc 合并/简化)
#  - 无 kind 字段 (Sankey 单一关系, 不需要边类型区分)
#  - 4 列流向: KB → AI → Memory → Meeting
#
# PM R6.5 拍板用新 path, 不复用旧 /lineage 避免歧义.
# ════════════════════════════════════════════


class SankeyNode(BaseModel):
    id: str
    label: str
    type: str  # kb | agent | memory | meeting
    meta: Optional[dict[str, Any]] = None


class SankeyLink(BaseModel):
    source: str  # node.id
    target: str  # node.id
    value: float  # 流量宽度, 引用次数 / 共享强度


class SankeyOut(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]


def _build_sankey_from_lineage(legacy: LineageOut) -> SankeyOut:
    """从 legacy /api/lineage 返回结构 (nodes+edges) 转换成 sankey (nodes+links).

    映射:
      - kb_doc → kb (列 1)
      - agent → agent (列 2)
      - memory → memory (列 3)
      - meeting → meeting (列 4)
      - upload/task → 跳过 (Sankey 4 列, 不展示来源列)

    边映射 (单向 KB → AI → Memory → Meeting):
      - kb_doc → agent (kind=primary/reference) → KB → AI 链路
      - memory → agent (kind=primary/subscriber) → 反向, Sankey 内改 AI → Memory
      - meeting → memory (kind=source) → 反向, Sankey 内改 Memory → Meeting

    value 暂用边 weight (默认 1.0), 后续可基于 引用次数 / 共享强度 调整.
    """
    keep_types = {"kb_doc", "agent", "memory", "meeting"}
    # type 重映射
    type_remap = {"kb_doc": "kb"}

    sankey_nodes: list[SankeyNode] = []
    kept_ids: set[str] = set()
    for n in legacy.nodes:
        if n.type not in keep_types:
            continue
        sankey_nodes.append(SankeyNode(
            id=n.id,
            label=n.label,
            type=type_remap.get(n.type, n.type),
            meta=n.meta,
        ))
        kept_ids.add(n.id)

    sankey_links: list[SankeyLink] = []
    for e in legacy.edges:
        if e.source not in kept_ids or e.target not in kept_ids:
            continue
        s_type = next((n.type for n in sankey_nodes if n.id == e.source), None)
        t_type = next((n.type for n in sankey_nodes if n.id == e.target), None)
        # Sankey 4 列流向: kb → agent → memory → meeting
        # legacy 边方向跟这个不一致, 这里 normalize:
        if s_type == "kb" and t_type == "agent":
            sankey_links.append(SankeyLink(source=e.source, target=e.target, value=e.weight))
        elif s_type == "memory" and t_type == "agent":
            # 反向: agent → memory
            sankey_links.append(SankeyLink(source=e.target, target=e.source, value=e.weight))
        elif s_type == "meeting" and t_type == "memory":
            # 反向: memory → meeting
            sankey_links.append(SankeyLink(source=e.target, target=e.source, value=e.weight))
        # 其他边类型 (来源 upload → kb_doc 等) 跳过

    return SankeyOut(nodes=sankey_nodes, links=sankey_links)


@router.get("/sankey", response_model=SankeyOut)
async def get_sankey_lineage_get(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> SankeyOut:
    """全景血缘图 · 桑基视图 (round-6 R5.B-replace).

    Returns: { nodes: [{ id, label, type, meta? }], links: [{ source, target, value }] }
    4 列流向: KB → AI → Memory → Meeting.
    """
    legacy = await _build_lineage(session, auth.workspace.id, only_agent_id=None)
    return _build_sankey_from_lineage(legacy)


@router.post("/sankey", response_model=SankeyOut)
async def get_sankey_lineage_post(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> SankeyOut:
    """同 GET, 接受 POST 调用 (用于前端 fetch 时统一 method, 兼容 CORS preflight).

    PM R6.5: 跟旧 /api/lineage 区分新 path, 避免数据结构歧义.
    """
    legacy = await _build_lineage(session, auth.workspace.id, only_agent_id=None)
    return _build_sankey_from_lineage(legacy)
