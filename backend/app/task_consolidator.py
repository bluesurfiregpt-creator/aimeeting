"""
v26.2 — 任务办结沉淀到 AI 专家知识库.

目标:status → done 或 leader 手动按钮触发时,把任务全过程
(content + evidence + 评论 + 协办交付) 经 LLM 摘要 + 原始文本拼装 写入
主责 AI 专家的知识库.让 AI 专家越用越聪明.

数据流:
  Task(done)
    ├─ generate_closure_summary() 用 qwen-max 生成 4 段结构化摘要
    ├─ 拼装 doc content: 元信息 + LLM 摘要 + 原始 comments/evidence
    ├─ 选目标 KB:
    │    优先 agent.knowledge_base_ids[0]
    │    否则自动创建 "<agent.name> · 任务沉淀" KB + 加入 agent.kb_ids
    ├─ 创建 KnowledgeDocument(source_type='task', source_task_id, ...)
    ├─ chunking + embedding (复用 chunker.split_text + embeddings.compute_embeddings)
    ├─ 写入 KnowledgeChunk
    └─ task.source_ref 标 consolidated_at / consolidated_kb_id / consolidated_document_id

幂等:
  task.source_ref.consolidated_at 已存在 → 默认 skip,除非 force=True
  force=True → 先删旧 KnowledgeDocument + chunks → 重新沉淀(干净覆盖)

数据分级(per 用户决策 v26.2 Q2):
  core / important / sensitive / general / public 都沉淀.
  KB document 继承 task.data_classification, 后续 ABAC 在检索层过滤.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .chunker import split_text
from .db import SessionLocal
from .embeddings import EmbeddingError, compute_embeddings
from .llm_direct import LlmError, get_active_provider, resolve_model_id, stream_chat
from .models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    Task,
    TaskCoProgress,
    User,
)

logger = logging.getLogger(__name__)


# ---- 输出 ------------------------------------------------------------------


@dataclass
class ConsolidationResult:
    document_id: uuid.UUID
    kb_id: uuid.UUID
    kb_name: str
    kb_created: bool          # True = 这次新建的 KB
    agent_id: uuid.UUID
    agent_name: str
    chunk_count: int
    char_count: int
    summary_markdown: str     # 真正写入的摘要(可能是 LLM 出的,也可能是 override)
    used_override: bool       # 是否用了 leader 编辑过的 summary


class ConsolidationError(Exception):
    """沉淀过程不可恢复错误."""


# ---- LLM 办结摘要生成 ------------------------------------------------------


_SUMMARY_SYSTEM_PROMPT = """你是知识沉淀助手.把一条已办结的工作任务,
浓缩成结构化的【办结档案】,以备同主题 AI 专家在未来类似任务中检索引用.

**严格 Markdown 输出**,4 段,严禁加额外标题 / 解释:

## 背景
1-2 句话:这条任务是从哪场会议 / 哪条指令来的,核心要做什么.

## 处理过程
2-4 条 bullet:实际做了哪些动作 / 走了哪些流程.
- 每条 bullet 必须有出处(任务正文 / 评论 / 协办交付).
- 不要扩写,不要补全你不知道的细节.

## 结果 / 产出
1-2 句话:产出物 / 决议结论是什么.

## 关键洞察(供未来同主题任务借鉴)
1-3 条 bullet,每条 10-30 字,提炼为何这次能成 / 踩过的坑 / 可复用的方法.

【严禁规则】
A. **每段内容必须有原始出处可对应**.找不到 → 该段写 "(暂无)".
B. 不准编日期 / 编人名 / 编决议.
C. 不准引述 LLM 你自己的常识 — 只用我提供的原始材料.
D. 全文 < 600 字.太短没事,太长重写.
E. 严禁加 "我们认为 / 综上 / 综合分析" 之类的引申词."""


async def generate_closure_summary(task_id: uuid.UUID) -> str:
    """
    LLM 生成结构化办结摘要.失败 raise ConsolidationError.

    输入聚合:
      - task.title / content
      - task.due_at
      - source_meeting (若 source_type='meeting')
      - evidence_quote / evidence_anchor_line_ids
      - 行动项评论 (MeetingActionItemComment via action_item)
      - 协办交付 (TaskCoProgress.content)
      - 数据分级
    """
    async with SessionLocal() as db:
        t = (
            await db.execute(select(Task).where(Task.id == task_id))
        ).scalar_one_or_none()
        if not t:
            raise ConsolidationError(f"task {task_id} not found")

        provider = await get_active_provider(db)
        if provider is None:
            raise ConsolidationError("no active LLM provider")

        # 拼输入
        parts: list[str] = []
        parts.append(f"# 任务: {t.title or t.content[:60]}")
        parts.append(f"内容: {t.content}")
        if t.due_at:
            parts.append(f"截止: {t.due_at.isoformat()}")
        parts.append(f"数据分级: {t.data_classification or 'general'}")
        sref = t.source_ref if isinstance(t.source_ref, dict) else {}
        if sref.get("meeting_id"):
            parts.append(f"来源会议: {sref.get('meeting_id')}")
        if sref.get("evidence_quote"):
            parts.append(f"\n## 会议实录依据\n{sref['evidence_quote']}")
        if sref.get("topic_keywords"):
            kws = sref["topic_keywords"]
            if isinstance(kws, list):
                parts.append(f"\n主题关键词: {', '.join(map(str, kws))}")

        # 协办交付
        co_rows = (
            await db.execute(
                select(TaskCoProgress, User.name)
                .join(User, User.id == TaskCoProgress.co_assignee_user_id)
                .where(TaskCoProgress.task_id == task_id)
            )
        ).all()
        if co_rows:
            parts.append("\n## 协办交付")
            for cp, uname in co_rows:
                parts.append(f"- {uname}: {(cp.content or '(无说明)')[:200]}")

        # v26.2.1 TODO: 行动项评论 (MeetingActionItemComment) 也喂给 LLM.
        # 当前版本先跳 — 通过 action_item.task_id 反查 + outer join Comment + User
        # 需要两段 SQL,留 v26.2.1 加.
        # (注:之前这里有个 broken .join() 残留导致 V26.2-1 GET preview 500,已删.)

        user_prompt = "\n".join(parts)

        chunks: list[str] = []
        # v1.4.0 Saga R preflight: 走 active provider.model_id (避免 prod
        # deepseek active 时 硬发 qwen-max-latest → 400).
        model_id = resolve_model_id(provider, purpose="task_consolidator")
        try:
            async for c in stream_chat(
                provider=provider,
                system_prompt=_SUMMARY_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                model_override=model_id,
                temperature=0.0,
                top_p=0.1,
            ):
                chunks.append(c)
        except LlmError as e:
            raise ConsolidationError(f"LLM closure summary failed: {e}") from e

        out = "".join(chunks).strip()
        if not out:
            raise ConsolidationError("LLM returned empty summary")
        if len(out) > 3000:
            out = out[:3000] + "\n\n(已截断)"
        return out


# ---- 核心沉淀函数 ---------------------------------------------------------


async def _resolve_or_create_kb(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    agent: Agent,
) -> tuple[KnowledgeBase, bool]:
    """
    选目标 KB (v26.7-02 三级 fallback, 优先用 KB.owner_agent_id 反查):
      1. KB.owner_agent_id == agent.id 的 KB (最准 — owner_agent_id 是权威归属)
      2. agent.knowledge_base_ids 第一个 (老兼容)
      3. 都没 → 创建 "<agent.name> · 任务沉淀" KB, 同时:
         - 设 owner_agent_id = agent.id
         - 加到 agent.knowledge_base_ids[]

    Returns (kb, created_new)
    """
    # v26.7-02: 优先 KB.owner_agent_id 反查
    kb = (
        await db.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.workspace_id == workspace_id,
                KnowledgeBase.owner_agent_id == agent.id,
            ).order_by(KnowledgeBase.created_at.asc())  # 最老的 (主仓库)
        )
    ).scalars().first()
    if kb:
        # 确保 agent.knowledge_base_ids 也包含它 (兼容 RAG 检索路径)
        kb_ids = list(agent.knowledge_base_ids or [])
        if kb.id not in kb_ids:
            kb_ids.append(kb.id)
            agent.knowledge_base_ids = kb_ids
        return kb, False

    # fallback: agent.knowledge_base_ids 第一个 (老逻辑)
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
            # 老 KB 没设 owner_agent_id 的话 顺手补
            if kb.owner_agent_id is None:
                kb.owner_agent_id = agent.id
            return kb, False
        # 绑定的 KB 不存在(已删?)→ 走 创建分支

    # 自动新建 KB (v26.7-02 同时设 owner_agent_id)
    kb_name = f"{agent.name} · 任务沉淀"
    kb = KnowledgeBase(
        workspace_id=workspace_id,
        name=kb_name,
        description=f"由系统自动创建,用于沉淀 AI 专家「{agent.name}」处理过的任务",
        owner_agent_id=agent.id,  # v26.7-02 ★ 关键
    )
    db.add(kb)
    await db.flush()  # 拿 id
    # 把新 KB 加到 agent.knowledge_base_ids(SQLAlchemy ARRAY mutation 需要新建 list)
    new_kb_ids = list(agent.knowledge_base_ids or [])
    new_kb_ids.append(kb.id)
    agent.knowledge_base_ids = new_kb_ids
    return kb, True


async def consolidate_task_to_agent_kb(
    task_id: uuid.UUID,
    *,
    target_agent_id: Optional[uuid.UUID] = None,
    override_summary: Optional[str] = None,
    curator_user_id: Optional[uuid.UUID] = None,
    force: bool = False,
) -> ConsolidationResult:
    """
    把 task 办结档案沉淀到 主责 AI 专家(或指定 agent)的 KB.

    参数:
      target_agent_id  None → 用 task.assignee_agent_id;否则覆盖
      override_summary leader 编辑过的摘要;None → 跑 LLM 生成
      curator_user_id  审批 / 触发沉淀的人;auto trigger 时是审批人,
                       手动按钮时 是 leader
      force            True → 即使已沉淀过,删旧重建

    返回 ConsolidationResult.失败 raise ConsolidationError.
    """
    async with SessionLocal() as db:
        # ---- 1. Load + validate ----
        t = (
            await db.execute(select(Task).where(Task.id == task_id))
        ).scalar_one_or_none()
        if not t:
            raise ConsolidationError(f"task {task_id} not found")

        sref = dict(t.source_ref) if isinstance(t.source_ref, dict) else {}

        # 幂等:已沉淀过且 非 force → skip
        if sref.get("consolidated_at") and not force:
            raise ConsolidationError(
                "already consolidated (use force=True to re-consolidate)"
            )

        # ---- 2. 解析目标 agent ----
        ag_id = target_agent_id or t.assignee_agent_id
        if not ag_id:
            raise ConsolidationError(
                "task has no assignee_agent_id; pass target_agent_id explicitly"
            )
        agent = (
            await db.execute(select(Agent).where(Agent.id == ag_id))
        ).scalar_one_or_none()
        if not agent:
            raise ConsolidationError(f"agent {ag_id} not found")

        # ---- 3. force 路径:先删旧 doc + chunks ----
        old_doc_id: Optional[uuid.UUID] = None
        if force and sref.get("consolidated_document_id"):
            try:
                old_doc_id = uuid.UUID(str(sref["consolidated_document_id"]))
            except (TypeError, ValueError):
                old_doc_id = None
        if old_doc_id:
            # CASCADE 会带走 chunks
            await db.execute(
                delete(KnowledgeDocument).where(KnowledgeDocument.id == old_doc_id)
            )
            logger.info("force consolidate: removed old doc %s", old_doc_id)

        # ---- 4. 生成 / 取用 LLM 摘要 ----
        used_override = bool(override_summary and override_summary.strip())
        if used_override:
            summary_md = override_summary.strip()  # type: ignore[union-attr]
        else:
            # commit current write-up state(避免 LLM 长跑期间持锁)
            await db.commit()
            summary_md = await generate_closure_summary(task_id)
            # 重 open session (commit 后 t 已 detach;重新 load)
            t = (
                await db.execute(select(Task).where(Task.id == task_id))
            ).scalar_one_or_none()
            if not t:
                raise ConsolidationError("task vanished mid-consolidation")
            agent = (
                await db.execute(select(Agent).where(Agent.id == ag_id))
            ).scalar_one_or_none()
            if not agent:
                raise ConsolidationError("agent vanished mid-consolidation")
            sref = dict(t.source_ref) if isinstance(t.source_ref, dict) else {}

        # ---- 5. 拼装 KB document 全文 ----
        full_lines: list[str] = []
        full_lines.append(f"# {t.title or t.content[:60]}")
        full_lines.append("")
        full_lines.append(f"- 主责 AI 专家: {agent.name}")
        if t.due_at:
            full_lines.append(f"- 截止: {t.due_at.isoformat()}")
        full_lines.append(f"- 数据分级: {t.data_classification or 'general'}")
        if sref.get("meeting_id"):
            full_lines.append(f"- 源会议: {sref['meeting_id']}")
        full_lines.append("")
        full_lines.append(summary_md)
        full_lines.append("")
        full_lines.append("---")
        full_lines.append("## 原始任务正文")
        full_lines.append(t.content)
        if sref.get("evidence_quote"):
            full_lines.append("")
            full_lines.append("## 实录依据(节选)")
            full_lines.append(f"> {sref['evidence_quote']}")

        full_text = "\n".join(full_lines)
        char_count = len(full_text)

        # ---- 6. 选目标 KB(用 / 新建) ----
        kb, kb_created = await _resolve_or_create_kb(db, t.workspace_id, agent)

        # ---- 7. 创建 KnowledgeDocument ----
        # v26.7-03: 如果 task 来自会议 → snapshot meeting_id 到 source_meeting_id
        # (sref 在 step 5 之前已 reload, 含 meeting_id)
        src_meeting_id: Optional[uuid.UUID] = None
        mid_str = sref.get("meeting_id")
        if mid_str:
            try:
                src_meeting_id = uuid.UUID(str(mid_str))
            except (ValueError, TypeError):
                pass
        doc = KnowledgeDocument(
            kb_id=kb.id,
            filename=f"{(t.title or t.content[:40])[:120]}.md",
            mime_type="text/markdown",
            oss_key=None,                # 无原文件,纯 内嵌文本
            byte_size=len(full_text.encode("utf-8")),
            status="embedding",
            char_count=char_count,
            data_classification=t.data_classification or "general",
            source_type="task",
            source_task_id=t.id,
            source_agent_id=agent.id,
            source_meeting_id=src_meeting_id,  # v26.7-03
            curated_by_user_id=curator_user_id,
            curated_at=datetime.now(timezone.utc),
        )
        db.add(doc)
        await db.flush()

        # ---- 8. Chunking ----
        chunks = split_text(full_text)
        if not chunks:
            # 退化:整段当一个 chunk
            chunks = [full_text]

        # ---- 9. Embedding(commit 前先持久化 doc,免得 embedding 失败 全丢)----
        await db.commit()

        try:
            all_vectors: list[list[float]] = []
            EMBED_BATCH = 25
            for i in range(0, len(chunks), EMBED_BATCH):
                batch = chunks[i : i + EMBED_BATCH]
                vecs = await compute_embeddings(batch)
                all_vectors.extend(vecs)
        except EmbeddingError as e:
            # 标 doc failed,task 不 mark consolidated
            async with SessionLocal() as db2:
                await db2.execute(
                    update(KnowledgeDocument)
                    .where(KnowledgeDocument.id == doc.id)
                    .values(status="failed", error_message=f"embed: {e}")
                )
                await db2.commit()
            raise ConsolidationError(f"embedding failed: {e}") from e

        # ---- 10. 写 chunks + 标 task consolidated ----
        async with SessionLocal() as db2:
            for idx, (chunk_text, vec) in enumerate(zip(chunks, all_vectors)):
                db2.add(
                    KnowledgeChunk(
                        document_id=doc.id,
                        kb_id=kb.id,
                        chunk_index=idx,
                        content=chunk_text,
                        embedding=vec,
                    )
                )
            await db2.execute(
                update(KnowledgeDocument)
                .where(KnowledgeDocument.id == doc.id)
                .values(status="ready", chunk_count=len(chunks), error_message=None)
            )
            # 更新 task.source_ref
            t_refresh = (
                await db2.execute(select(Task).where(Task.id == task_id))
            ).scalar_one()
            new_sref = dict(t_refresh.source_ref) if isinstance(t_refresh.source_ref, dict) else {}
            new_sref["consolidated_at"] = datetime.now(timezone.utc).isoformat()
            new_sref["consolidated_kb_id"] = str(kb.id)
            new_sref["consolidated_document_id"] = str(doc.id)
            new_sref["consolidated_agent_id"] = str(agent.id)
            t_refresh.source_ref = new_sref
            await db2.commit()

        logger.info(
            "consolidated task %s → agent %s kb %s doc %s (%d chunks)",
            task_id, agent.id, kb.id, doc.id, len(chunks),
        )

        return ConsolidationResult(
            document_id=doc.id,
            kb_id=kb.id,
            kb_name=kb.name,
            kb_created=kb_created,
            agent_id=agent.id,
            agent_name=agent.name,
            chunk_count=len(chunks),
            char_count=char_count,
            summary_markdown=summary_md,
            used_override=used_override,
        )


# ---- 触发器(fire-and-forget,失败不影响主流程) ----------------------------


async def maybe_auto_consolidate_on_done(task_id: uuid.UUID, curator_user_id: Optional[uuid.UUID]) -> None:
    """
    v26.2:在 task transition 进入 status='done' 时调用.
    失败 静默 log,不影响 主流程.

    v26.5-02c P1: 加 审批 gate —
      - 如果 curator_user_id == agent.primary_user_id (或 None / agent 无 primary):
        直接沉淀 (老行为)
      - 否则: 创建 KbSedimentationDraft 草稿 + 通知 primary_user 审批,
        不立即写 KB
    """
    try:
        # 提前 load agent.primary_user_id 判断是否需要 gate
        async with SessionLocal() as db:
            t = (
                await db.execute(select(Task).where(Task.id == task_id))
            ).scalar_one_or_none()
            if not t:
                logger.warning("auto-consolidate task %s: task not found", task_id)
                return
            sref = dict(t.source_ref) if isinstance(t.source_ref, dict) else {}
            if sref.get("consolidated_at"):
                logger.info("auto-consolidate task %s: already consolidated, skip", task_id)
                return
            if not t.assignee_agent_id:
                logger.info("auto-consolidate task %s: no assignee_agent_id, skip", task_id)
                return
            agent = (
                await db.execute(
                    select(Agent).where(Agent.id == t.assignee_agent_id)
                )
            ).scalar_one_or_none()
            if not agent:
                return

            # v26.5-02c gate 判断:
            #   agent 无 primary_user → 退到老行为 (直接沉淀)
            #   curator == primary_user → 自己审自己, 直接沉淀
            #   curator != primary_user → 走审批
            needs_approval = (
                agent.primary_user_id is not None
                and curator_user_id is not None
                and curator_user_id != agent.primary_user_id
            )

            if needs_approval:
                # 走审批: 生成 summary → 存 draft → 通知 primary_user
                await _create_sedimentation_draft(db, t, agent, curator_user_id)
                return

        # 直接沉淀 (老行为)
        await consolidate_task_to_agent_kb(
            task_id, curator_user_id=curator_user_id, force=False
        )
    except ConsolidationError as e:
        logger.warning("auto-consolidate task %s skipped: %s", task_id, e)
    except Exception:
        logger.exception("auto-consolidate task %s unexpected error", task_id)


async def _create_sedimentation_draft(
    db: AsyncSession,
    task: "Task",
    agent: "Agent",
    curator_user_id: uuid.UUID,
) -> None:
    """v26.5-02c: 创建审批草稿 + 通知 primary_user.
    幂等: 同 (task_id, status='pending') 已存在则 skip.
    """
    from .models import KbSedimentationDraft, Notification
    # 幂等: 已有 pending draft 跳过
    existing = (
        await db.execute(
            select(KbSedimentationDraft).where(
                KbSedimentationDraft.task_id == task.id,
                KbSedimentationDraft.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if existing:
        logger.info(
            "sedimentation draft for task %s already pending, skip",
            task.id,
        )
        return

    # 生成 summary (走 LLM)
    try:
        summary_md = await generate_closure_summary(task.id)
    except Exception:
        logger.exception("draft: generate_closure_summary failed for task %s", task.id)
        summary_md = f"(摘要生成失败 — 任务标题:{task.title or task.content[:60]})"

    # resolve 目标 KB id (用 agent 第一个 KB 或 None — 实际沉淀时 才创建)
    target_kb_id: Optional[uuid.UUID] = None
    if agent.knowledge_base_ids:
        target_kb_id = agent.knowledge_base_ids[0]

    draft = KbSedimentationDraft(
        workspace_id=task.workspace_id,
        task_id=task.id,
        target_agent_id=agent.id,
        target_kb_id=target_kb_id,
        proposed_summary=summary_md,
        curator_user_id=curator_user_id,
        primary_user_id=agent.primary_user_id,
        status="pending",
    )
    db.add(draft)
    await db.flush()

    # 通知 primary_user
    notif = Notification(
        workspace_id=task.workspace_id,
        user_id=agent.primary_user_id,
        kind="kb_sedimentation_pending",
        severity="yellow",
        payload={
            "draft_id": str(draft.id),
            "task_id": str(task.id),
            "task_title": task.title or task.content[:60],
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "summary_preview": summary_md[:200],
        },
    )
    db.add(notif)
    await db.commit()
    logger.info(
        "created sedimentation draft %s for task %s, notified primary %s",
        draft.id, task.id, agent.primary_user_id,
    )


def schedule_auto_consolidate(task_id: uuid.UUID, curator_user_id: Optional[uuid.UUID]) -> None:
    """同步入口:用 asyncio.create_task fire-and-forget."""
    try:
        asyncio.create_task(maybe_auto_consolidate_on_done(task_id, curator_user_id))
    except RuntimeError:
        # No running loop — happens in some test contexts; log and skip.
        logger.warning("schedule_auto_consolidate: no running event loop")
