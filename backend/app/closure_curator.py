"""
v24.2 #1 — 办结 → KB 沉淀联动.

智慧住建文档 §5.2:
> 办结 → 知识沉淀联动:工单审核通过归档后,办理经验自动流向知识库,
> 经审核后入库,更新 AI 专家的记忆画像与考核档案.

触发点:approve_task() 通过审核后(status='done').
fire-and-forget 跑(不阻塞 approve API 5-15s LLM 调用).

输出 3 种产物:
  1. KnowledgeDocument(filename=「[自动沉淀] <title>」, mime='text/markdown',
     oss_key=NULL → 内容直接在 KnowledgeChunk 里;status='ready', auto_curated=True)
  2. KnowledgeChunk(1 个 chunk,content=LLM 摘要 + 标签,带 embedding)
  3. LongTermMemory(scope='project', source_type='task_closure', importance=0.7
     根据 task 的复杂度,有协办的更高)

KB 选择:
  优先 task.assignee → workspace_membership.bound_agent → Agent →
       Agent.knowledge_base_ids[0]
  fallback:任一智慧住建 KB(name 以「KB · 」开头) → 否则跳过 KB 写入,
       只 LongTermMemory(workspace 共用)

幂等:Task.source_ref 加 curated=True 标记后跳过重入(approve 多次幂等);
  审核驳回再 approve 也只 curate 一次.

LLM 失败兜底:不阻塞,只记 warning + 写 LongTermMemory(原文截断).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .embeddings import EmbeddingError, compute_embedding
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    LongTermMemory,
    MeetingActionItem,
    MeetingActionItemComment,
    Task,
    TaskCoProgress,
    User,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """你是「政务任务办结经验提取助手」.给定一个已办结的政务任务,
提取**未来可复用的经验**(不是流程播报),用于沉淀进 AI 专家的知识库.

# 输出严格 JSON(不要 markdown 围栏):
{
  "summary": "Markdown 格式 1-2 段(每段 80-200 字).标题用 ## .可分两段:经验/教训.",
  "tags": ["5-10 个分类标签", "如 房屋安全, 老旧小区, 验收流程, 跨部门协调"]
}

# 风格要求:
- 不复述任务原文 — 提炼**做对了什么 / 哪里被卡 / 下次改进**
- 客观、可量化(数字 / 时间 / 责任部门)
- 标签贴近智慧住建业务领域(房地产 / 建筑业 / 房屋安全 / 物业 / 消防人防 / 城市更新 / 等)

# 错误示范:
- "本任务由王科长完成,审核通过"  ← 流水账,无经验
- "完成了任务"                       ← 空话

# 正确示范:
- "## 经验\\n沙头街道老旧小区幕墙整治采用「一户一档 + 物业承诺书」双轨,
   30 天内完成 12 户排查,效率比上月单纯入户高 40%.\\n\\n## 教训\\n业委会
   配合度低时整治周期翻倍,后续应优先在街道层面取得社区支持."
- tags: ["幕墙安全", "老旧小区", "沙头街道", "物业承诺", "业委会协调"]
"""


def _safe_parse_json_obj(s: str) -> Optional[dict[str, Any]]:
    if not s:
        return None
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


async def _build_llm_input(session: AsyncSession, task: Task) -> str:
    """收集 LLM 上下文:任务正文 + 阶段汇报 + 协办交付 + 评论."""
    parts: list[str] = []
    if task.title:
        parts.append(f"# 任务标题\n{task.title}")
    parts.append(f"# 任务正文\n{task.content[:1500]}")

    sp = (
        task.source_ref.get("submission_payload")
        if isinstance(task.source_ref, dict)
        else None
    )
    if sp:
        parts.append("# 提交人最终阶段汇报")
        if sp.get("completed"):
            parts.append(f"已完成:{sp['completed'][:600]}")
        if sp.get("problems"):
            parts.append(f"问题:{sp['problems'][:600]}")
        if sp.get("next_steps"):
            parts.append(f"下一步:{sp['next_steps'][:600]}")
        if sp.get("evidence_urls"):
            parts.append(f"佐证:{', '.join(sp['evidence_urls'][:5])}")

    co_rows = (
        await session.execute(
            select(TaskCoProgress, User.name)
            .join(User, User.id == TaskCoProgress.co_assignee_user_id)
            .where(TaskCoProgress.task_id == task.id)
            .order_by(TaskCoProgress.submitted_at)
            .limit(10)
        )
    ).all()
    if co_rows:
        parts.append("# 协办交付历史")
        for cp, name in co_rows:
            parts.append(f"- {name}: {(cp.content or '').strip()[:300]}")

    if task.source_type == "meeting":
        ai_id = (
            await session.execute(
                select(MeetingActionItem.id).where(MeetingActionItem.task_id == task.id).limit(1)
            )
        ).scalar_one_or_none()
        if ai_id:
            comment_rows = (
                await session.execute(
                    select(MeetingActionItemComment, User.name)
                    .join(User, User.id == MeetingActionItemComment.author_user_id, isouter=True)
                    .where(MeetingActionItemComment.action_item_id == ai_id)
                    .order_by(MeetingActionItemComment.created_at)
                    .limit(15)
                )
            ).all()
            if comment_rows:
                parts.append("# 协作评论")
                for c, name in comment_rows:
                    parts.append(f"- {name or '(已删用户)'}: {c.content[:300]}")

    return "\n\n".join(parts)


async def _llm_curate(
    session: AsyncSession, task: Task
) -> Optional[dict[str, Any]]:
    """LLM 提取摘要 + 标签.失败返回 None,caller 兜底."""
    provider = await get_active_provider(session)
    if provider is None:
        logger.warning("closure_curator: no LLM provider configured")
        return None
    user_prompt = await _build_llm_input(session, task)
    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError as exc:
        logger.warning("closure_curator: LLM call failed: %s", exc)
        return None
    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if parsed is None:
        logger.warning("closure_curator: bad LLM output: %r", raw[:300])
        return None
    summary = (parsed.get("summary") or "").strip()
    if not summary:
        return None
    tags = parsed.get("tags")
    if not isinstance(tags, list):
        tags = []
    tags = [str(t).strip()[:32] for t in tags if t][:10]
    return {"summary": summary[:3000], "tags": tags}


async def _pick_target_kb(
    session: AsyncSession, workspace_id: UUID, assignee_user_id: Optional[UUID]
) -> Optional[KnowledgeBase]:
    """选要写入的 KB:assignee 的 bound_agent 优先,fallback 任一智慧住建 KB."""
    if assignee_user_id:
        bound_agent_id = (
            await session.execute(
                select(WorkspaceMembership.bound_agent_id).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == assignee_user_id,
                )
            )
        ).scalar_one_or_none()
        if bound_agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == bound_agent_id)
                )
            ).scalar_one_or_none()
            if agent and agent.knowledge_base_ids:
                kb = (
                    await session.execute(
                        select(KnowledgeBase).where(
                            KnowledgeBase.id == agent.knowledge_base_ids[0],
                            KnowledgeBase.workspace_id == workspace_id,
                        )
                    )
                ).scalar_one_or_none()
                if kb:
                    return kb
    # fallback:任一智慧住建 KB(name 以「KB · 」开头)
    fb = (
        await session.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.workspace_id == workspace_id,
                KnowledgeBase.name.startswith("KB · "),
            ).limit(1)
        )
    ).scalar_one_or_none()
    return fb


async def curate_closed_task(task_id: UUID) -> dict[str, Any]:
    """
    fire-and-forget 入口:approve_task 后调用(asyncio.create_task).
    会自己开 SessionLocal,跟 approve 那个事务无关.

    Returns:
      {"status": "done", "doc_id": ..., "memory_id": ..., "summary_chars": N}
      {"status": "skip", "reason": "already_curated"}
      {"status": "fail", "reason": "..."}
    """
    async with SessionLocal() as session:
        task = (
            await session.execute(select(Task).where(Task.id == task_id))
        ).scalar_one_or_none()
        if task is None:
            return {"status": "fail", "reason": "task_not_found"}

        # 幂等:已 curate 过跳过
        existing_ref = task.source_ref if isinstance(task.source_ref, dict) else {}
        if existing_ref.get("curated") is True:
            return {"status": "skip", "reason": "already_curated"}

        # LLM 摘要(失败兜底:用 task content 截断)
        curated = await _llm_curate(session, task)
        fallback_used = False
        if curated is None:
            fallback_used = True
            curated = {
                "summary": f"## 任务办结\n{task.title or ''}\n\n{task.content[:600]}",
                "tags": [],
            }

        # 选 KB(可能 None:没绑 agent + 没智慧住建 KB)
        kb = await _pick_target_kb(session, task.workspace_id, task.assignee_user_id)
        doc_id: Optional[UUID] = None
        chunk_id: Optional[UUID] = None
        if kb is not None:
            # 1) KnowledgeDocument(synthetic;无 OSS,内容在 chunk 里)
            ts_str = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
            title_part = (task.title or task.content[:40]).strip().replace("\n", " ")[:80]
            filename = f"[自动沉淀 {ts_str}] {title_part}.md"
            md_full = curated["summary"]
            if curated["tags"]:
                md_full += "\n\n**标签**: " + ", ".join(f"#{t}" for t in curated["tags"])
            doc = KnowledgeDocument(
                kb_id=kb.id,
                filename=filename[:255],
                mime_type="text/markdown",
                oss_key=None,  # 不入 OSS,内容已在 chunk
                byte_size=len(md_full.encode("utf-8")),
                status="ready",
                char_count=len(md_full),
                chunk_count=1,
                data_classification=task.data_classification or "general",
            )
            session.add(doc)
            await session.flush()
            doc_id = doc.id

            # 2) KnowledgeChunk + embedding(失败用 0 向量兜底,不阻断)
            try:
                vec = await compute_embedding(md_full)
            except EmbeddingError as e:
                logger.warning("closure_curator: embedding failed: %s", e)
                vec = [0.0] * 1536
            chunk = KnowledgeChunk(
                document_id=doc.id,
                kb_id=kb.id,
                chunk_index=0,
                content=md_full,
                embedding=vec,
            )
            session.add(chunk)
            await session.flush()
            chunk_id = chunk.id

        # 3) LongTermMemory(无论 KB 有没有都写,scope='project',workspace 共用)
        try:
            mem_vec = await compute_embedding(curated["summary"])
        except EmbeddingError:
            mem_vec = [0.0] * 1536
        # importance:有协办 / 跨多 user 的更重要
        importance = 0.6
        if task.co_assignees:
            importance = 0.75
        mem = LongTermMemory(
            workspace_id=task.workspace_id,
            scope="project",
            scope_ref=str(task.id),
            content=curated["summary"][:2000],
            importance=importance,
            embedding=mem_vec,
            source_type="task_closure",
            source_id=str(task.id),
        )
        session.add(mem)
        await session.flush()

        # 4) Mark task as curated(防重入)
        new_ref = dict(existing_ref)
        new_ref["curated"] = True
        new_ref["curated_at"] = datetime.now(timezone.utc).isoformat()
        new_ref["curated_kb_id"] = str(kb.id) if kb else None
        new_ref["curated_doc_id"] = str(doc_id) if doc_id else None
        new_ref["curated_chunk_id"] = str(chunk_id) if chunk_id else None
        new_ref["curated_memory_id"] = str(mem.id)
        new_ref["curated_tags"] = curated["tags"]
        new_ref["curated_fallback_used"] = fallback_used
        task.source_ref = new_ref

        await session.commit()
        logger.info(
            "closure_curator: task %s → kb=%s doc=%s mem=%s tags=%d (fallback=%s)",
            task.id, kb.id if kb else None, doc_id, mem.id,
            len(curated["tags"]), fallback_used,
        )
        return {
            "status": "done",
            "kb_id": str(kb.id) if kb else None,
            "doc_id": str(doc_id) if doc_id else None,
            "chunk_id": str(chunk_id) if chunk_id else None,
            "memory_id": str(mem.id),
            "summary_chars": len(curated["summary"]),
            "tag_count": len(curated["tags"]),
            "fallback_used": fallback_used,
        }
