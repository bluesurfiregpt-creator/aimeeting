"""
v26.3-07 — 会议分歧裁决 → AI 专家 KB 沉淀.

# 触发点
召集人在 /meeting/{id}/orchestrate 控制台点 "裁决并归档" 后,
POST /api/meetings/{id}/consensus/{agenda_idx}/review 端点 写完
review_decision 后 schedule_consensus_consolidate(consensus_id) → 异步
跑本模块的 consolidate_dissent_to_agent_kb,逐条 dissent 跑.

# 输出
对每个 dissent.involved_agents 里的 AI 专家,各写一份 KnowledgeDocument
(source_type='consensus_dissent') + 若干 KnowledgeChunk.
下次类似议题来时,该专家通过 KB 检索能拿到这次"被裁决的经验",
让 AI 软调整行为(per v26.3 spec Q2=A 全部涉及方都要更新认知).

# 与 task_consolidator 关系
复用思路 + 部分 helper:_resolve_or_create_kb / split_text / compute_embeddings.
不直接调 consolidate_task_to_agent_kb,因为 那个 函数 强 绑 task — 我们走 dissent.

# 与 audit/review 关系
本模块只负责 "沉淀写 KB",不负责审计.审计 (audit_log 'dissent.review') 由
endpoint 同步路径写完.沉淀失败不阻塞用户裁决.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select

from .chunker import split_text
from .db import SessionLocal
from .embeddings import EmbeddingError, compute_embeddings
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    Meeting,
    MeetingConsensus,
)

logger = logging.getLogger(__name__)


# ============================================================================
# LLM Prompts (Q3=C · LLM 4 段 + 模板兜底)
# ============================================================================

DISSENT_DIGEST_SYSTEM = """你是会议档案管理员,负责把一场已裁决的政务会议分歧
压缩成 4 段 markdown,沉淀到 AI 专家的知识库.

死规矩:
1. 只用我下面给你的事实(议程标题、分歧点、双方立场、涉及专家名、召集人裁决).
2. 不许编造数据 / 政策细节 / 时间线.
3. 4 段 一段不能少,顺序固定:## 背景 / ## 双方立场对比 / ## 召集人裁决 /
   ## 给未来类似议题的提醒.
4. 每段不超过 80 字.
5. 用中文.
6. 输出纯 markdown,无 frontmatter / 无代码块包裹."""


DISSENT_DIGEST_USER = """议程标题:{agenda_title}

分歧点:{point}

双方/多方立场:
{summary}

涉及专家:{involved_agents}

召集人裁决:{action} — {rationale}

请按规定格式写 4 段 markdown."""


def _fallback_digest(
    *,
    agenda_title: str,
    point: str,
    summary: str,
    involved_agents: list[str],
    action: str,
    rationale: str,
) -> str:
    """LLM 失败兜底:模板拼接 4 段."""
    lines = [
        "## 背景",
        f"议程「{agenda_title}」中,在「{point}」一点上 {', '.join(involved_agents) or '若干专家'} 立场不一致.",
        "",
        "## 双方立场对比",
        summary or "(双方立场摘要缺失)",
        "",
        "## 召集人裁决",
        f"召集人选择 `{action}`,理由:{rationale}.",
        "",
        "## 给未来类似议题的提醒",
        f"下次遇到类似「{point}」的分歧,优先参考召集人本次裁决思路.",
    ]
    return "\n".join(lines)


async def _llm_digest_or_fallback(
    *,
    agenda_title: str,
    point: str,
    summary: str,
    involved_agents: list[str],
    action: str,
    rationale: str,
) -> tuple[str, bool]:
    """
    返回 (markdown, used_fallback).LLM 失败 / 超时 → 自动兜底,never raises.
    """
    try:
        async with SessionLocal() as db:
            provider = await get_active_provider(db)
        if not provider:
            logger.warning("no LLM provider — using fallback digest")
            return _fallback_digest(
                agenda_title=agenda_title, point=point, summary=summary,
                involved_agents=involved_agents, action=action, rationale=rationale,
            ), True

        # 用 stream_chat 跟项目其他 LLM 调用风格一致
        user_msg = DISSENT_DIGEST_USER.format(
            agenda_title=agenda_title,
            point=point,
            summary=summary or "(无摘要)",
            involved_agents=", ".join(involved_agents) or "(未指定)",
            action=action,
            rationale=rationale,
        )
        chunks: list[str] = []
        async for chunk in stream_chat(
            provider=provider,
            system_prompt=DISSENT_DIGEST_SYSTEM,
            user_prompt=user_msg,
            temperature=0.0,
        ):
            chunks.append(chunk)
        text = "".join(chunks).strip()
        if len(text) < 30:
            logger.warning("LLM digest 太短 (%d 字),fallback", len(text))
            return _fallback_digest(
                agenda_title=agenda_title, point=point, summary=summary,
                involved_agents=involved_agents, action=action, rationale=rationale,
            ), True
        return text, False
    except (LlmError, asyncio.TimeoutError, Exception) as e:
        logger.warning("LLM digest 失败 (%s),fallback", e)
        return _fallback_digest(
            agenda_title=agenda_title, point=point, summary=summary,
            involved_agents=involved_agents, action=action, rationale=rationale,
        ), True


# ============================================================================
# KB document 写入(复用 task_consolidator 的逻辑思路)
# ============================================================================


async def _resolve_or_create_dissent_kb(
    db,
    workspace_id: uuid.UUID,
    agent: Agent,
) -> tuple[KnowledgeBase, bool]:
    """v26.7-02: 选目标 KB — 三级 fallback, 优先用 KB.owner_agent_id 反查.
    跟 task_consolidator._resolve_or_create_kb 对称.
    """
    # 1. KB.owner_agent_id == agent.id 反查
    kb = (
        await db.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.workspace_id == workspace_id,
                KnowledgeBase.owner_agent_id == agent.id,
            ).order_by(KnowledgeBase.created_at.asc())
        )
    ).scalars().first()
    if kb:
        kb_ids = list(agent.knowledge_base_ids or [])
        if kb.id not in kb_ids:
            kb_ids.append(kb.id)
            agent.knowledge_base_ids = kb_ids
        return kb, False
    # 2. agent.knowledge_base_ids[0] 老兼容
    if agent.knowledge_base_ids:
        existing_id = agent.knowledge_base_ids[0]
        kb = (
            await db.execute(
                select(KnowledgeBase).where(
                    KnowledgeBase.id == existing_id,
                    KnowledgeBase.workspace_id == workspace_id,
                )
            )
        ).scalar_one_or_none()
        if kb:
            if kb.owner_agent_id is None:
                kb.owner_agent_id = agent.id
            return kb, False
    # 3. 新建 + 同时设 owner_agent_id
    kb_name = f"{agent.name} · 任务沉淀"
    kb = KnowledgeBase(
        workspace_id=workspace_id,
        name=kb_name,
        description=f"由系统自动创建,沉淀 AI 专家「{agent.name}」处理过的任务 + 会议裁决",
        owner_agent_id=agent.id,  # v26.7-02
    )
    db.add(kb)
    await db.flush()
    new_kb_ids = list(agent.knowledge_base_ids or [])
    new_kb_ids.append(kb.id)
    agent.knowledge_base_ids = new_kb_ids
    return kb, True


async def _write_doc_for_agent(
    *,
    workspace_id: uuid.UUID,
    agent: Agent,
    filename: str,
    markdown: str,
    data_classification: str,
    source_meeting_id: Optional[uuid.UUID] = None,  # v26.7-03
) -> uuid.UUID:
    """
    把 markdown 写入 agent 的 KB:1 个 KnowledgeDocument + N 个 KnowledgeChunk
    (含 embedding).返回 document_id.
    Embedding 失败 → 标 doc.status='failed',raise.
    """
    async with SessionLocal() as db:
        kb, _kb_created = await _resolve_or_create_dissent_kb(db, workspace_id, agent)
        char_count = len(markdown)
        doc = KnowledgeDocument(
            kb_id=kb.id,
            filename=filename[:255],
            mime_type="text/markdown",
            oss_key=None,
            byte_size=len(markdown.encode("utf-8")),
            status="embedding",
            char_count=char_count,
            data_classification=data_classification,
            # v26.2 schema 已支持 source_type free string;新增 'consensus_dissent' 标识
            source_type="consensus_dissent",
            source_agent_id=agent.id,
            source_meeting_id=source_meeting_id,  # v26.7-03
            curated_at=datetime.now(timezone.utc),
        )
        db.add(doc)
        await db.flush()
        doc_id = doc.id
        kb_id = kb.id
        await db.commit()

    chunks = split_text(markdown) or [markdown]
    try:
        all_vectors: list[list[float]] = []
        EMBED_BATCH = 25
        for i in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[i : i + EMBED_BATCH]
            vecs = await compute_embeddings(batch)
            all_vectors.extend(vecs)
    except EmbeddingError as e:
        async with SessionLocal() as db2:
            from sqlalchemy import update as sa_update
            await db2.execute(
                sa_update(KnowledgeDocument)
                .where(KnowledgeDocument.id == doc_id)
                .values(status="failed", error_message=f"embed: {e}")
            )
            await db2.commit()
        raise

    async with SessionLocal() as db2:
        from sqlalchemy import update as sa_update
        for idx, (text, vec) in enumerate(zip(chunks, all_vectors)):
            db2.add(
                KnowledgeChunk(
                    document_id=doc_id,
                    kb_id=kb_id,
                    chunk_index=idx,
                    content=text,
                    embedding=vec,
                )
            )
        await db2.execute(
            sa_update(KnowledgeDocument)
            .where(KnowledgeDocument.id == doc_id)
            .values(status="ready", chunk_count=len(chunks), error_message=None)
        )
        await db2.commit()

    logger.info(
        "consensus dissent → agent %s kb %s doc %s (%d chunks)",
        agent.id, kb_id, doc_id, len(chunks),
    )
    return doc_id


# ============================================================================
# 主入口
# ============================================================================


async def consolidate_dissent_to_agent_kb(consensus_id: uuid.UUID) -> dict[str, Any]:
    """
    把一议程项的所有已裁决 dissent 沉淀到 涉及 AI 专家 的 KB.

    流程:
      1. 加载 MeetingConsensus + Meeting (拿 workspace_id, 议程标题)
      2. 校验 reviewed_at 非空 (未裁决不沉淀)
      3. 解析 review_decision (JSON 数组,每元素 {dissent_idx, action, rationale})
      4. 对每个 dissent:
         a. LLM 二次 4 段摘要(失败 fallback 模板)
         b. 对 involved_agents 里的每个 expert (Q2=A 全部),写一份 KnowledgeDocument

    返回 {consensus_id, dissent_count, agents_touched, docs_created,
          llm_fallback_count, errors}.失败的 agent 写入 errors 列表,不阻塞其他.
    """
    errors: list[dict[str, str]] = []
    docs_created = 0
    agents_touched: set[str] = set()
    llm_fallback_count = 0

    async with SessionLocal() as db:
        c = (
            await db.execute(select(MeetingConsensus).where(MeetingConsensus.id == consensus_id))
        ).scalar_one_or_none()
        if not c:
            raise RuntimeError(f"consensus {consensus_id} not found")
        if c.reviewed_at is None or not c.review_decision:
            raise RuntimeError(f"consensus {consensus_id} not yet reviewed — refusing to consolidate")
        m = (
            await db.execute(select(Meeting).where(Meeting.id == c.meeting_id))
        ).scalar_one_or_none()
        if not m:
            raise RuntimeError(f"meeting {c.meeting_id} not found")
        workspace_id = m.workspace_id
        agenda_title = c.agenda_title or f"议程 {c.agenda_idx + 1}"
        dissents = c.dissents or []

    try:
        reviews = json.loads(c.review_decision)
        if not isinstance(reviews, list):
            raise ValueError("review_decision is not a JSON array")
    except (ValueError, TypeError) as e:
        raise RuntimeError(f"review_decision malformed: {e}") from e

    # 把 reviews 按 dissent_idx 索引,缺的 / 多的 都跳过
    by_idx: dict[int, dict[str, Any]] = {}
    for r in reviews:
        if isinstance(r, dict) and isinstance(r.get("dissent_idx"), int):
            by_idx[r["dissent_idx"]] = r

    for idx, d in enumerate(dissents):
        if idx not in by_idx:
            errors.append({"dissent_idx": str(idx), "reason": "missing in review_decision"})
            continue
        rv = by_idx[idx]
        action = str(rv.get("action") or "unknown")
        rationale = str(rv.get("rationale") or "").strip()
        if not isinstance(d, dict):
            errors.append({"dissent_idx": str(idx), "reason": "dissent not a dict"})
            continue
        point = str(d.get("point") or "(未标点)")
        summary = str(d.get("summary") or "")
        involved_names_raw = d.get("involved_agents") or []
        involved_names = [str(x) for x in involved_names_raw if x]

        # defer 也沉淀 — 让 AI 知道"此分歧暂时搁置,下次会议再议"
        # (不沉淀的话 AI 下次又会触发同一分歧 — 反向激励错了)

        # ---- LLM 4 段 ----
        markdown, used_fallback = await _llm_digest_or_fallback(
            agenda_title=agenda_title, point=point, summary=summary,
            involved_agents=involved_names, action=action, rationale=rationale,
        )
        if used_fallback:
            llm_fallback_count += 1

        # 头部加 metadata 横幅 + 来源链(供 KB UI 显示)
        header = (
            f"# [召集人裁决] {agenda_title} · {point}\n\n"
            f"> _裁决:`{action}` · 涉及专家:{', '.join(involved_names) or '未指定'} · "
            f"沉淀于 {datetime.now(timezone.utc).isoformat()}_\n\n"
        )
        full_markdown = header + markdown

        # ---- 解析 涉及 agent (Q2=A 全部) ----
        async with SessionLocal() as db2:
            ags = (
                await db2.execute(
                    select(Agent).where(
                        Agent.workspace_id == workspace_id,
                        Agent.name.in_(involved_names),
                    )
                )
            ).scalars().all()
        # involved_agents 用名字存的(orchestrator 写的),可能新创建 agent name 重复 — 都拿
        if not ags:
            errors.append({
                "dissent_idx": str(idx),
                "reason": f"no agents matched names {involved_names}",
            })
            continue

        filename = f"[召集人裁决] {agenda_title[:40]} · {point[:30]}.md"
        # 数据分级:从涉及 agent 的 default 取最高级;简化先用 'general'
        data_class = "general"

        for ag in ags:
            try:
                await _write_doc_for_agent(
                    workspace_id=workspace_id,
                    agent=ag,
                    filename=filename,
                    markdown=full_markdown,
                    data_classification=data_class,
                    source_meeting_id=c.meeting_id,  # v26.7-03
                )
                docs_created += 1
                agents_touched.add(str(ag.id))
            except Exception as e:
                logger.exception("dissent consolidate agent %s 失败", ag.id)
                errors.append({
                    "dissent_idx": str(idx),
                    "agent_id": str(ag.id),
                    "reason": str(e)[:200],
                })

    result = {
        "consensus_id": str(consensus_id),
        "dissent_count": len(dissents),
        "agents_touched": len(agents_touched),
        "docs_created": docs_created,
        "llm_fallback_count": llm_fallback_count,
        "errors": errors,
    }
    logger.info("consolidate_dissent_to_agent_kb done: %s", result)
    return result


# ============================================================================
# v26.3-07c: schedule (fire-and-forget) — endpoint 调它即返回
# ============================================================================


def schedule_consensus_consolidate(consensus_id: uuid.UUID) -> None:
    """
    Fire-and-forget 起一个 asyncio task 跑 consolidate_dissent_to_agent_kb.

    用法:endpoint 写完 review_decision 后立即调本函数 → 返回 → 后台跑沉淀.
    任何失败 都只记 logger,不抛出.

    限制:必须在 有 running event loop 的协程上下文调用(FastAPI 请求 handler 满足).
    """
    async def _runner():
        try:
            await consolidate_dissent_to_agent_kb(consensus_id)
        except Exception:
            logger.exception("schedule_consensus_consolidate consensus %s 失败", consensus_id)

    try:
        asyncio.create_task(_runner())
    except RuntimeError:
        # 无 running loop(罕见:测试环境直接调用)→ logger 占位
        logger.warning(
            "schedule_consensus_consolidate: no running event loop "
            "(consensus %s 沉淀 skip — 调用方应在 async handler 里调用)",
            consensus_id,
        )
