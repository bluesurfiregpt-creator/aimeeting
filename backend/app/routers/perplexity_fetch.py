"""
v26.13.2: Perplexity 自生成知识 触发 endpoint.

  POST /api/knowledge/perplexity-fetch
    body: { kb_id, agent_id, query, recency? }
    → 配额 check → 调 Perplexity → 去重 → 创建 KbSedimentationDraft
    返回 created/skipped 数 + 草稿 list

流程:
  1. ABAC: caller 必须 是 KB writer 或 agent manager
  2. workspace 月配额 check (perplexity_used_this_month < quota)
  3. Workspace 拿 SearchProviderConfig (provider='perplexity', is_active=True)
  4. 调 perplexity_client.search()
  5. 把 returned answer + citations 拼 成 markdown
  6. embed → 跟 KB 现有 chunks 比 cosine — > 0.85 → 跳过 (去重)
  7. 没跳过 → 写 KbSedimentationDraft (kind='perplexity_auto')
  8. workspace.perplexity_used_this_month += 1, 月初 cron sweep 重置
  9. 通知 manager (audit_log + 可选 notification)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, can_write_kb, get_current_auth, is_agent_manager
from ..db import get_session
from ..embeddings import compute_embedding
from ..models import (
    Agent,
    KbSedimentationDraft,
    KnowledgeBase,
    KnowledgeChunk,
    SearchProviderConfig,
    Workspace,
)
from ..perplexity_client import PerplexityError, search as perplexity_search

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class PerplexityFetchIn(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    kb_id: uuid.UUID
    agent_id: uuid.UUID
    query: str = Field(..., min_length=3, max_length=500)
    recency: Optional[str] = None  # 'day' | 'week' | 'month' | 'year' | None
    # 实际 现在 一次 调用 一次 Perplexity, 不分批 — 这字段 给 未来 多 query 扩展 用.


class DraftBrief(BaseModel):
    id: uuid.UUID
    proposed_filename: Optional[str]
    citations_count: int


class PerplexityFetchOut(BaseModel):
    drafts_created: int
    drafts_skipped_dedup: int  # 跟 KB 现有 chunk 太相似, 没意义 再 入
    quota_used: int             # 本次 调用 消耗 几次 (= 1 个 Perplexity API call)
    quota_remaining: int        # 月剩余
    drafts: list[DraftBrief]
    primary_url: Optional[str]  # Perplexity 给的 第一个 citation, 让 前端 直接 显 "已 抓 自 ..."
    answer_preview: str         # 前 300 字 给 前端 提示


# ---------------------------------------------------------------------------
# 月配额 — 月初 自动 reset
# ---------------------------------------------------------------------------
def _is_new_month(reset_at: Optional[datetime]) -> bool:
    """判断 last reset 在 上个 月 之前 — 需要 reset."""
    if reset_at is None:
        return True
    now = datetime.now(timezone.utc)
    return (reset_at.year, reset_at.month) != (now.year, now.month)


async def _check_and_increment_quota(
    session: AsyncSession, workspace_id: uuid.UUID,
) -> tuple[bool, int, int]:
    """
    Return (allowed, used_after_this_call, quota).

    如果 新 月 → reset used_this_month=0 + reset_at=now. 然后 check.
    """
    ws = (
        await session.execute(
            select(Workspace).where(Workspace.id == workspace_id)
        )
    ).scalar_one()

    if _is_new_month(ws.perplexity_used_reset_at):
        ws.perplexity_used_this_month = 0
        ws.perplexity_used_reset_at = datetime.now(timezone.utc)

    if ws.perplexity_used_this_month >= ws.perplexity_monthly_quota:
        return (False, ws.perplexity_used_this_month, ws.perplexity_monthly_quota)

    ws.perplexity_used_this_month += 1
    await session.flush()  # 持久 但 不 commit (出错 会 rollback)
    return (True, ws.perplexity_used_this_month, ws.perplexity_monthly_quota)


# ---------------------------------------------------------------------------
# 去重 — 跟 KB 现有 chunk 的 余弦距离
# ---------------------------------------------------------------------------
async def _is_duplicate(
    session: AsyncSession, kb_id: uuid.UUID, text: str, threshold: float = 0.15,
) -> tuple[bool, float]:
    """
    Embed 新文档, 跟 该 KB 现有 chunks 比 余弦距离 (pgvector "<=>" 是 cosine distance, 0=同).
    如果 最近的 chunk distance < threshold (= 余弦相似度 > 1-threshold), 视为 重复.
    threshold 0.15 → 相似度 > 0.85.
    Return (is_dup, min_distance_found).
    """
    try:
        vec = await compute_embedding(text)
    except Exception as e:
        logger.warning("perplexity dedup: embed failed, skip dedup: %s", e)
        return (False, 1.0)  # 失败 当 不重复 (宁可入库)

    # 拿 该 KB 距离 最近 的 1 个 chunk
    row = (
        await session.execute(
            select(
                KnowledgeChunk.id,
                KnowledgeChunk.embedding.cosine_distance(vec).label("distance"),
            )
            .where(KnowledgeChunk.kb_id == kb_id)
            .where(KnowledgeChunk.embedding.is_not(None))
            .order_by("distance")
            .limit(1)
        )
    ).first()

    if row is None:
        return (False, 1.0)  # KB 还没 chunk, 必然 不重复

    dist = float(row.distance or 1.0)
    return (dist < threshold, dist)


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
@router.post("/perplexity-fetch", response_model=PerplexityFetchOut)
async def perplexity_fetch(
    payload: PerplexityFetchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    用 Perplexity 抓取 互联网 资料 → 沉淀草稿. manager 审批 后 入 KB.

    ABAC: 必须 是 KB writer (能 改这 KB) 或者 是 该 agent 的 primary_user.
    """
    # ABAC
    is_kb_writer = await can_write_kb(session, auth, payload.kb_id)
    is_mgr = await is_agent_manager(session, auth, payload.agent_id)
    if not (is_kb_writer or is_mgr):
        raise HTTPException(
            403,
            "[权限不足] 仅 KB writer 或 该 AI 专家的 primary_user 可 触发 Perplexity 抓取",
        )

    # KB 存在 + 跨 workspace 隔离
    kb = (
        await session.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.id == payload.kb_id,
                KnowledgeBase.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if kb is None:
        raise HTTPException(404, "kb not found")

    agent = (
        await session.execute(
            select(Agent).where(
                Agent.id == payload.agent_id,
                Agent.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if agent is None:
        raise HTTPException(404, "agent not found")
    if not agent.primary_user_id:
        raise HTTPException(400, "该 AI 专家未绑定 primary_user, 草稿 无人审批")

    # 拿 active Perplexity 配置
    cfg = (
        await session.execute(
            select(SearchProviderConfig).where(
                SearchProviderConfig.workspace_id == auth.workspace.id,
                SearchProviderConfig.provider == "perplexity",
                SearchProviderConfig.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            400,
            "未配置 Perplexity API: 请 leader/admin 去 /me/profile/models → "
            "🔍 检索 API 添加 Perplexity API Key 并 设为默认.",
        )

    # 配额 check + 预扣 (会话内 已 flush, 失败 后 commit 不会 持久)
    allowed, used, quota = await _check_and_increment_quota(session, auth.workspace.id)
    if not allowed:
        raise HTTPException(
            429,
            detail=f"本月 Perplexity 配额 已用完 ({used}/{quota}). "
                   f"等 下月 1 号 重置, 或 联系 admin 调高 配额.",
        )

    # 调 Perplexity (出错 → rollback 配额)
    try:
        result = await perplexity_search(
            query=payload.query.strip(),
            api_key=cfg.api_key,
            base_url=cfg.base_url,
            recency_filter=payload.recency,
        )
    except PerplexityError as e:
        await session.rollback()  # 退还 配额
        logger.warning("perplexity_fetch: API error: %s", e)
        raise HTTPException(502, f"Perplexity 调用失败: {e}")
    except Exception as e:
        await session.rollback()
        logger.exception("perplexity_fetch: unexpected error")
        raise HTTPException(500, f"内部错误: {e}")

    # 拼 入 KB 的 markdown — synth + 来源 URL footer
    md_parts: list[str] = [result.answer.strip()]
    if result.citations:
        md_parts.append("\n\n---\n")
        md_parts.append("## 📚 来源\n")
        for i, c in enumerate(result.citations, 1):
            title = c.title or "(无标题)"
            md_parts.append(f"{i}. [{title}]({c.url})")
    full_md = "\n".join(md_parts)

    # 去重
    is_dup, dist = await _is_duplicate(session, kb.id, full_md)
    primary_url = result.citations[0].url if result.citations else None

    if is_dup:
        logger.info(
            "perplexity_fetch: dedup skip (dist=%.3f) query=%r kb=%s",
            dist, payload.query[:80], kb.id,
        )
        # 配额 已 +1 (Perplexity 确实 调了, 钱花了), 不退还.
        await session.commit()
        return PerplexityFetchOut(
            drafts_created=0,
            drafts_skipped_dedup=1,
            quota_used=1,
            quota_remaining=quota - used,
            drafts=[],
            primary_url=primary_url,
            answer_preview=result.answer[:300],
        )

    # 写 草稿
    short_query = payload.query.strip()[:60]
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    proposed_filename = f"Perplexity · {short_query} · {today}.md"

    draft = KbSedimentationDraft(
        workspace_id=auth.workspace.id,
        kind="perplexity_auto",
        task_id=None,
        target_agent_id=agent.id,
        target_kb_id=kb.id,
        proposed_summary=full_md,
        proposed_filename=proposed_filename,
        meta={
            "source_query": payload.query.strip(),
            "primary_url": primary_url,
            "citations": [
                {"url": c.url, "title": c.title} for c in result.citations
            ],
            "fetched_at": result.fetched_at.isoformat(),
            "model": result.model,
        },
        curator_user_id=auth.user.id,
        primary_user_id=agent.primary_user_id,
        status="pending",
    )
    session.add(draft)
    await session.commit()
    await session.refresh(draft)

    await audit_log(
        session, auth, "kb.perplexity_fetch",
        target_type="kb_sedimentation_draft", target_id=str(draft.id),
        payload={
            "kb_id": str(kb.id),
            "agent_id": str(agent.id),
            "query": payload.query[:200],
            "citations_count": len(result.citations),
            "primary_url": primary_url,
        },
    )

    logger.info(
        "perplexity_fetch: draft=%s kb=%s agent=%s query=%r citations=%d quota_used=%d/%d",
        draft.id, kb.id, agent.id, payload.query[:60],
        len(result.citations), used, quota,
    )

    return PerplexityFetchOut(
        drafts_created=1,
        drafts_skipped_dedup=0,
        quota_used=1,
        quota_remaining=quota - used,
        drafts=[
            DraftBrief(
                id=draft.id,
                proposed_filename=draft.proposed_filename,
                citations_count=len(result.citations),
            )
        ],
        primary_url=primary_url,
        answer_preview=result.answer[:300],
    )
