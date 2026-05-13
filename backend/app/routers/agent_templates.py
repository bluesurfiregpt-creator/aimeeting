"""v26.6-01 · AI 模板生成器 — LLM 批量生成 AI 专家配置.

两个 endpoint:
  POST /api/agent-templates/preview  — 调 LLM 生成 N 个 agent draft (不持久化)
  POST /api/agent-templates/commit   — 真正批量创建 (+ 可选 KB / Memory 种子)

LLM 用 workspace 默认 provider (model_provider_config.is_active=TRUE).
prompt 严格 要求 JSON 输出, 后端解析 + 校验.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth, require_leader_or_admin
from ..db import get_session
from ..embeddings import EmbeddingError, compute_embedding
from ..llm_direct import LlmError, get_active_provider, stream_chat
from ..models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    LongTermMemory,
    MemoryAgentLink,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent-templates", tags=["agent-templates"])


# ----- schemas ----------------------------------------------------------------

class PreviewIn(BaseModel):
    """v26.6-01: prompt-based preview 输入."""
    scenario_description: str = Field(..., min_length=10, max_length=4000)
    count: int = Field(5, ge=1, le=10)
    with_kb_seed: bool = False     # 生成时 一并 出种子 KB 知识点
    with_memory_seed: bool = False # 生成时 一并 出种子 Memory 条目


class AgentDraft(BaseModel):
    """单个 agent 配置 draft (preview/commit 共用)."""
    name: str
    domain: Optional[str] = None
    persona: Optional[str] = None
    keywords: list[str] = []
    color: Optional[str] = "violet"
    # 种子 KB 文本 (1 段 Markdown, 约 200-500 字)
    suggested_kb_seed: Optional[str] = None
    # 种子 Memory (3-8 条, 每条 < 200 字)
    suggested_memory_seeds: list[str] = []


class PreviewOut(BaseModel):
    agents: list[AgentDraft]
    scenario_description: str
    raw_llm_text: str  # debug 用 — 前端可不显示


class CommitIn(BaseModel):
    """v26.6-01: 批量创建 — 前端可能编辑 preview 后的 agents 数组."""
    agents: list[AgentDraft]
    # 如果 commit 时 想让 primary_user 自动分配, 这里给个 manager id 列表;
    # 后端按 domain 匹配 (简单: 不匹配就 leave NULL,owner 后续手动 指派).
    candidate_manager_ids: list[uuid.UUID] = []


class CommittedAgent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    kb_id: Optional[uuid.UUID] = None
    kb_doc_id: Optional[uuid.UUID] = None
    memory_count: int = 0


class CommitOut(BaseModel):
    created: list[CommittedAgent]


# ----- LLM prompt -------------------------------------------------------------

_COLORS = ["violet", "sky", "emerald", "amber", "rose", "teal"]

_PREVIEW_SYS_PROMPT = """你是 AI 专家团队 配置生成器.

给定一段场景描述, 输出 一组 AI 专家配置 (N 个).
每个 AI 专家代表 该场景下 一个垂直专业领域.

严格按 JSON 数组 格式输出, 不要任何解释或 markdown 围栏:

[
  {
    "name": "AI 专家显示名 (≤ 12 字, 含领域)",
    "domain": "领域简称 (≤ 8 字)",
    "persona": "AI 专家人格设定 (100-250 字, 含: 专长 / 语气 / 边界 / 思维方式)",
    "keywords": ["3-6 个 关键词, 用于 会议中 自动触发 该 AI"],
    "color": "从 violet/sky/emerald/amber/rose/teal 选一个 颜色 tag",
    "suggested_kb_seed": "(可选, with_kb_seed=true 时给) 200-500 字 Markdown 种子知识点, 该 AI 上线时应有的核心知识",
    "suggested_memory_seeds": ["(可选, with_memory_seed=true 时给) 3-8 条 关键 事实 / 决策 / 经验, 每条 1 句话"]
  },
  ...
]

约束:
- 名字必须不同
- color 6 个 一对一 分配, 不要重复
- persona 中要 体现 该 AI 的 思考边界 (例: "只回答 XX 范围内 的问题")
- 不要生成 招生/财务/纪检 这类敏感领域 (除非 用户明确要)
- 不要 出格 — 不要 编造 政策文件 / 不要 引用 不存在的 法规"""


def _build_user_prompt(payload: PreviewIn) -> str:
    parts = [
        f"场景描述: {payload.scenario_description.strip()}",
        f"数量: 生成 {payload.count} 个 AI 专家",
    ]
    if payload.with_kb_seed:
        parts.append("with_kb_seed=true (请给 suggested_kb_seed)")
    if payload.with_memory_seed:
        parts.append("with_memory_seed=true (请给 suggested_memory_seeds 3-8 条)")
    return "\n".join(parts)


# ----- LLM 调用 + 解析 ---------------------------------------------------------

async def _call_llm(
    db: AsyncSession,
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.6,
) -> str:
    """调 active provider, 拼出完整文本. 不 stream (这里要等完整 JSON)."""
    provider = await get_active_provider(db)
    if provider is None:
        raise HTTPException(503, "没有 active 的 LLM provider — 请先在 系统配置 / LLM 模型 设置")
    parts: list[str] = []
    try:
        async for chunk in stream_chat(
            provider=provider,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
        ):
            if chunk:
                parts.append(chunk)
    except LlmError as e:
        raise HTTPException(502, f"LLM 调用失败: {e}")
    return "".join(parts)


def _parse_agent_draft_array(text: str) -> list[AgentDraft]:
    """从 LLM 输出 抽 JSON 数组."""
    # 兼容: LLM 可能给 markdown 围栏, 剥掉
    t = text.strip()
    if t.startswith("```"):
        # 找到第一个换行后到 倒数第二个 ``` 之间
        m = re.search(r"```(?:json)?\s*\n([\s\S]*?)\n```", t)
        if m:
            t = m.group(1).strip()
    # 找第一个 [ 到最后一个 ]
    start = t.find("[")
    end = t.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise HTTPException(500, f"LLM 输出 不含 JSON 数组: {t[:200]}")
    json_str = t[start: end + 1]
    try:
        rows = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"LLM 输出 JSON 解析失败: {e} / preview: {json_str[:300]}")
    if not isinstance(rows, list):
        raise HTTPException(500, "LLM 输出 不是 JSON 数组")
    out: list[AgentDraft] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            out.append(AgentDraft(
                name=str(r.get("name") or "").strip()[:64],
                domain=str(r.get("domain") or "").strip()[:32] or None,
                persona=str(r.get("persona") or "").strip()[:2000] or None,
                keywords=[
                    str(k).strip()[:32]
                    for k in (r.get("keywords") or [])
                    if k
                ][:8],
                color=(str(r.get("color") or "violet").strip().lower()
                       if str(r.get("color") or "").strip().lower() in _COLORS
                       else "violet"),
                suggested_kb_seed=str(r.get("suggested_kb_seed") or "").strip() or None,
                suggested_memory_seeds=[
                    str(m).strip()[:500]
                    for m in (r.get("suggested_memory_seeds") or [])
                    if m
                ][:10],
            ))
        except Exception:
            logger.warning("skip invalid draft row: %s", r)
            continue
    if not out:
        raise HTTPException(500, "LLM 没生成任何有效配置")
    return out


# ----- endpoints --------------------------------------------------------------

@router.post("/preview", response_model=PreviewOut)
async def preview_template(
    payload: PreviewIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.6-01: 调 LLM 出 N 个 agent 配置 draft (不持久化)."""
    await require_leader_or_admin(session, auth)
    user_prompt = _build_user_prompt(payload)
    raw = await _call_llm(
        session, _PREVIEW_SYS_PROMPT, user_prompt, temperature=0.65
    )
    drafts = _parse_agent_draft_array(raw)
    # 校验数量 (LLM 可能少给或多给)
    if len(drafts) > payload.count:
        drafts = drafts[: payload.count]
    return PreviewOut(
        agents=drafts,
        scenario_description=payload.scenario_description,
        raw_llm_text=raw,
    )


@router.post("/commit", response_model=CommitOut)
async def commit_template(
    payload: CommitIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.6-01: 真正批量创建 — 可能含 KB + Memory 种子."""
    await require_leader_or_admin(session, auth)
    if not payload.agents:
        raise HTTPException(400, "agents 不能为空")
    if len(payload.agents) > 10:
        raise HTTPException(400, "一次最多创建 10 个 AI")

    # primary_user_id 自动分配 (按 domain 字符串匹配 candidate_manager_ids 对应的 user.department)
    # 简单实现: 取 candidate_manager_ids 第一个 not-used 的 (round-robin)
    # 用户也可以 leave 空 (后续手动指派)
    from ..models import User as _User
    candidate_users: list[_User] = []
    if payload.candidate_manager_ids:
        rows = (
            await session.execute(
                select(_User).where(
                    _User.id.in_(payload.candidate_manager_ids),
                    _User.workspace_id == auth.workspace.id,
                )
            )
        ).scalars().all()
        candidate_users = list(rows)
    candidate_idx = 0

    created: list[CommittedAgent] = []
    for draft in payload.agents:
        if not draft.name.strip():
            continue
        # 选 primary_user (round-robin, 简单匹配)
        primary_uid: Optional[uuid.UUID] = None
        if candidate_idx < len(candidate_users):
            primary_uid = candidate_users[candidate_idx].id
            candidate_idx += 1
        # 创建 agent
        a = Agent(
            workspace_id=auth.workspace.id,
            name=draft.name.strip()[:64],
            domain=draft.domain,
            persona=draft.persona,
            keywords=draft.keywords or None,
            color=draft.color or "violet",
            is_active=True,
            primary_user_id=primary_uid,
            dify_app_type="chatflow",
            dify_base_url="https://api.dify.ai",
        )
        session.add(a)
        await session.flush()  # 拿 a.id

        kb_id: Optional[uuid.UUID] = None
        kb_doc_id: Optional[uuid.UUID] = None
        memory_count = 0

        # 种子 KB
        if draft.suggested_kb_seed and draft.suggested_kb_seed.strip():
            kb = KnowledgeBase(
                workspace_id=auth.workspace.id,
                name=f"{a.name} · 种子知识库",
                description=f"由 AI 模板生成器 自动创建,管理人: {primary_uid or '待指派'}",
                owner_agent_id=a.id,
            )
            session.add(kb)
            await session.flush()
            kb_id = kb.id
            # 绑定 KB 到 agent.knowledge_base_ids
            a.knowledge_base_ids = [kb.id]
            # 写 1 个 document (内嵌种子文本)
            seed_text = draft.suggested_kb_seed.strip()
            doc = KnowledgeDocument(
                kb_id=kb.id,
                filename=f"{a.name}_种子.md",
                mime_type="text/markdown",
                oss_key=None,
                byte_size=len(seed_text.encode("utf-8")),
                status="embedding",
                char_count=len(seed_text),
                source_type="manual",
                source_agent_id=a.id,
                curated_by_user_id=auth.user.id,
                curated_at=datetime.now(timezone.utc),
            )
            session.add(doc)
            await session.flush()
            kb_doc_id = doc.id
            # chunk + embedding (单段, 不切)
            try:
                vec = await compute_embedding(seed_text)
            except EmbeddingError:
                vec = [0.0] * 1536
            session.add(KnowledgeChunk(
                document_id=doc.id,
                kb_id=kb.id,
                chunk_index=0,
                content=seed_text,
                embedding=vec,
            ))
            doc.status = "ready"
            doc.chunk_count = 1

        # 种子 Memory
        for mem_text in (draft.suggested_memory_seeds or []):
            if not mem_text.strip():
                continue
            try:
                mvec = await compute_embedding(mem_text)
            except EmbeddingError:
                mvec = [0.0] * 1536
            m = LongTermMemory(
                workspace_id=auth.workspace.id,
                scope="project",
                scope_ref=f"agent:{a.id}",
                content=mem_text.strip()[:2000],
                importance=0.6,
                embedding=mvec,
                source_type="manual",
                agent_id=a.id,
                curated_by_user_id=auth.user.id,
                curated_at=datetime.now(timezone.utc),
            )
            session.add(m)
            await session.flush()
            # 写 memory_agent_link (primary)
            session.add(MemoryAgentLink(
                memory_id=m.id,
                agent_id=a.id,
                is_primary=True,
            ))
            memory_count += 1

        created.append(CommittedAgent(
            id=a.id,
            name=a.name,
            kb_id=kb_id,
            kb_doc_id=kb_doc_id,
            memory_count=memory_count,
        ))

    await session.commit()

    await audit_log(
        session, auth, "agent_template.commit",
        target_type="agent_template", target_id="batch",
        payload={
            "count": len(created),
            "agent_ids": [str(c.id) for c in created],
        },
    )
    return CommitOut(created=created)
