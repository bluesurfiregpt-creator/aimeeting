"""v26.5-Lineage: Memory 审批草稿 endpoints (跟 kb_sedimentation 对称).

会议结束 / 任务办结 抽出的 候选 memory 不立即入 long_term_memory, 而是
进 MemoryDraft 等 primary_user 审批. 这里提供 list / approve / reject.

Endpoints:
  GET    /api/memory-drafts                — 列我的待审批
  GET    /api/memory-drafts/{id}           — 详情
  POST   /api/memory-drafts/{id}/approve   — 批准 → 写 long_term_memory
  POST   /api/memory-drafts/{id}/reject    — 驳回
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth, is_leader_or_admin
from ..db import get_session
from ..embeddings import EmbeddingError, compute_embedding
from ..models import (
    Agent,
    LongTermMemory,
    Meeting,
    MemoryAgentLink,
    MemoryDraft,
    Notification,
    Task,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/memory-drafts", tags=["memory-drafts"])


class DraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    source_type: str
    source_meeting_id: Optional[uuid.UUID] = None
    source_meeting_title: Optional[str] = None
    source_task_id: Optional[uuid.UUID] = None
    source_task_title: Optional[str] = None
    target_agent_ids: list[str] = []
    target_agent_names: list[str] = []  # resolved
    primary_user_id: uuid.UUID
    proposed_content: str
    proposed_scope: str
    proposed_scope_ref: Optional[str] = None
    proposed_importance: float
    proposed_data_classification: str
    status: str
    decision_reason: Optional[str] = None
    decided_at: Optional[datetime] = None
    committed_memory_id: Optional[uuid.UUID] = None
    # v26.14-P7.3: 出处 链回 — 行号 = meeting_transcript.id, 前端 渲 chip + 跳 focus
    source_line_ids: Optional[list[int]] = None
    # v26.14-P7.4: 拒绝 子类型 + 给 LLM 的 反馈
    rejection_kind: Optional[str] = None  # "discard" | "feedback"
    rejection_feedback: Optional[str] = None
    created_at: datetime


class RejectIn(BaseModel):
    reason: Optional[str] = None
    # v26.14-P7.4: 拒绝 子 类型 — 默认 discard (没意义, 弃用); feedback 时 必填 feedback_text
    kind: Optional[str] = None  # "discard" | "feedback"; None 视为 discard
    feedback_text: Optional[str] = None  # 当 kind=feedback 必填 ≥ 5 字


async def _resolve(
    db: AsyncSession, drafts: list[MemoryDraft]
) -> list[DraftOut]:
    if not drafts:
        return []
    # resolve agent names
    agent_ids: set[uuid.UUID] = set()
    for d in drafts:
        for aid in d.target_agent_ids or []:
            try:
                agent_ids.add(uuid.UUID(aid))
            except (ValueError, TypeError):
                pass
    name_by_aid: dict[uuid.UUID, str] = {}
    if agent_ids:
        rows = (
            await db.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
            )
        ).all()
        name_by_aid = {r[0]: r[1] for r in rows}
    # resolve meeting + task titles
    mids = {d.source_meeting_id for d in drafts if d.source_meeting_id}
    tids = {d.source_task_id for d in drafts if d.source_task_id}
    meeting_titles: dict[uuid.UUID, str] = {}
    if mids:
        rows = (
            await db.execute(
                select(Meeting.id, Meeting.title).where(Meeting.id.in_(mids))
            )
        ).all()
        meeting_titles = {r[0]: r[1] for r in rows}
    task_titles: dict[uuid.UUID, str] = {}
    if tids:
        rows = (
            await db.execute(
                select(Task.id, Task.title, Task.content).where(Task.id.in_(tids))
            )
        ).all()
        task_titles = {r[0]: (r[1] or (r[2][:60] if r[2] else "")) for r in rows}
    out: list[DraftOut] = []
    for d in drafts:
        agent_names: list[str] = []
        for aid in d.target_agent_ids or []:
            try:
                u = uuid.UUID(aid)
                if u in name_by_aid:
                    agent_names.append(name_by_aid[u])
            except (ValueError, TypeError):
                continue
        out.append(DraftOut.model_validate({
            **d.__dict__,
            "target_agent_names": agent_names,
            "source_meeting_title": meeting_titles.get(d.source_meeting_id) if d.source_meeting_id else None,
            "source_task_title": task_titles.get(d.source_task_id) if d.source_task_id else None,
        }))
    return out


async def _load_with_abac(
    draft_id: str, session: AsyncSession, auth: AuthContext
) -> MemoryDraft:
    d = (
        await session.execute(
            select(MemoryDraft).where(
                MemoryDraft.id == draft_id,
                MemoryDraft.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "draft not found")
    is_admin = await is_leader_or_admin(session, auth)
    if d.primary_user_id != auth.user.id and not is_admin:
        raise HTTPException(
            403,
            "[权限不足] 仅 该 memory 沉淀的 审批人 (primary_user) 或 owner/admin/leader 可操作"
        )
    return d


@router.get("", response_model=list[DraftOut])
async def list_drafts(
    status: Optional[str] = None,  # pending|approved|rejected|expired|all
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    is_admin = await is_leader_or_admin(session, auth)
    stmt = (
        select(MemoryDraft)
        .where(MemoryDraft.workspace_id == auth.workspace.id)
        .order_by(MemoryDraft.created_at.desc())
        .limit(limit)
    )
    if not is_admin:
        stmt = stmt.where(MemoryDraft.primary_user_id == auth.user.id)
    if status and status != "all":
        if status not in ("pending", "approved", "rejected", "expired"):
            raise HTTPException(400, "invalid status filter")
        stmt = stmt.where(MemoryDraft.status == status)
    rows = list((await session.execute(stmt)).scalars().all())
    return await _resolve(session, rows)


@router.get("/{draft_id}", response_model=DraftOut)
async def get_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    d = await _load_with_abac(draft_id, session, auth)
    return (await _resolve(session, [d]))[0]


# v26.14-P7.1: 草稿 inline 编辑 — 仅 pending 状态 + 仅 primary_user (审批人) 可改.
# LLM 抽 的 表达 经常 不准, 老 流程 只 通过/驳回 → 烂草稿 多被 弃, 浪费. 加 编辑 让
# 用户 改 一下 后 通过, 大幅 提通过率 + 降 弃稿率.
class DraftPatchIn(BaseModel):
    proposed_content: Optional[str] = None
    proposed_importance: Optional[float] = None
    proposed_scope: Optional[str] = None  # user|project|org
    proposed_scope_ref: Optional[str] = None


@router.patch("/{draft_id}", response_model=DraftOut)
async def patch_draft(
    draft_id: str,
    payload: DraftPatchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P7.1: 草稿 inline 编辑. 仅 pending + 仅 审批人 (primary_user) 可改."""
    d = await _load_with_abac(draft_id, session, auth)
    if d.status != "pending":
        raise HTTPException(409, f"draft 状态={d.status}, 仅 pending 可改")

    data = payload.model_dump(exclude_unset=True)
    changed: list[str] = []

    if "proposed_content" in data:
        new_content = (data["proposed_content"] or "").strip()
        if not new_content:
            raise HTTPException(400, "proposed_content 不能 为空")
        if len(new_content) > 2000:
            new_content = new_content[:2000]
        if new_content != d.proposed_content:
            d.proposed_content = new_content
            changed.append("content")

    if "proposed_importance" in data and data["proposed_importance"] is not None:
        imp = float(data["proposed_importance"])
        imp = max(0.0, min(1.0, imp))
        if abs(imp - d.proposed_importance) > 1e-6:
            d.proposed_importance = imp
            changed.append("importance")

    if "proposed_scope" in data and data["proposed_scope"]:
        if data["proposed_scope"] not in ("user", "project", "org"):
            raise HTTPException(400, "proposed_scope 必须 是 user|project|org")
        if data["proposed_scope"] != d.proposed_scope:
            d.proposed_scope = data["proposed_scope"]
            changed.append("scope")

    if "proposed_scope_ref" in data:
        if data["proposed_scope_ref"] != d.proposed_scope_ref:
            d.proposed_scope_ref = data["proposed_scope_ref"]
            changed.append("scope_ref")

    if not changed:
        return (await _resolve(session, [d]))[0]

    await session.commit()
    await session.refresh(d)
    await audit_log(
        session, auth, "memory_draft.edit",
        target_type="memory_draft", target_id=str(d.id),
        payload={"changed_fields": changed},
    )
    await session.commit()
    return (await _resolve(session, [d]))[0]


@router.post("/{draft_id}/approve", response_model=DraftOut)
async def approve_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """批准 → 真正写 long_term_memory + 给 target_agent_ids 建 link."""
    d = await _load_with_abac(draft_id, session, auth)
    if d.status != "pending":
        raise HTTPException(409, f"draft status={d.status}, 不能再批")

    # 实际写入 long_term_memory
    try:
        vec = await compute_embedding(d.proposed_content)
    except EmbeddingError:
        vec = [0.0] * 1536
    target_aids: list[uuid.UUID] = []
    for aid in d.target_agent_ids or []:
        try:
            target_aids.append(uuid.UUID(aid))
        except (ValueError, TypeError):
            continue
    m = LongTermMemory(
        workspace_id=d.workspace_id,
        scope=d.proposed_scope,
        scope_ref=d.proposed_scope_ref,
        content=d.proposed_content,
        importance=d.proposed_importance,
        embedding=vec,
        source_type=d.source_type,
        source_id=str(d.source_task_id or d.source_meeting_id or ""),
        source_meeting_id=d.source_meeting_id,
        # v26.14-P7.3: 出处 链回 — 持久化 source_line_ids, 半年 后 仍 可溯源
        source_line_ids=d.source_line_ids,
        data_classification=d.proposed_data_classification,
        agent_id=target_aids[0] if target_aids else None,  # 老兼容
        curated_by_user_id=auth.user.id,
        curated_at=datetime.now(timezone.utc),
    )
    session.add(m)
    await session.flush()
    # 写 memory_agent_link
    for idx, aid in enumerate(target_aids):
        session.add(
            MemoryAgentLink(
                memory_id=m.id,
                agent_id=aid,
                is_primary=(idx == 0),
            )
        )
    # 标 draft
    d.status = "approved"
    d.decided_at = datetime.now(timezone.utc)
    d.committed_memory_id = m.id
    await session.commit()
    await session.refresh(d)
    await audit_log(
        session, auth, "memory_draft.approve",
        target_type="memory_draft", target_id=str(d.id),
        payload={"committed_memory_id": str(m.id)},
    )
    return (await _resolve(session, [d]))[0]


@router.post("/{draft_id}/reject", response_model=DraftOut)
async def reject_draft(
    draft_id: str,
    payload: RejectIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    d = await _load_with_abac(draft_id, session, auth)
    if d.status != "pending":
        raise HTTPException(409, f"draft status={d.status}, 不能再驳")
    # v26.14-P7.4: 区分 弃用 vs 退回 LLM (feedback). feedback 必 须 ≥ 5 字.
    kind = (payload.kind or "discard").strip()
    if kind not in ("discard", "feedback"):
        raise HTTPException(400, "kind 必须 是 discard 或 feedback")
    feedback_text = (payload.feedback_text or "").strip() or None
    if kind == "feedback":
        if not feedback_text or len(feedback_text) < 5:
            raise HTTPException(
                400, "退回 LLM 时 feedback_text 必填 且 ≥ 5 字 (写 为什么 不准)"
            )
    d.status = "rejected"
    d.decision_reason = (payload.reason or "").strip() or None
    d.decided_at = datetime.now(timezone.utc)
    d.rejection_kind = kind
    d.rejection_feedback = feedback_text if kind == "feedback" else None
    await session.commit()
    await session.refresh(d)
    await audit_log(
        session, auth, "memory_draft.reject",
        target_type="memory_draft", target_id=str(d.id),
        payload={
            "reason": d.decision_reason,
            "kind": kind,
            "feedback": feedback_text if kind == "feedback" else None,
        },
    )
    return (await _resolve(session, [d]))[0]


# ---------------------------------------------------------------------------
# v26.14-P7.2: 批量 操作
# ---------------------------------------------------------------------------
# 老 流程: 5+ 条 草稿 一条 一条 审 → 顶部 待审 N badge 数字 一直 高 → 用户 视觉 疲劳
# 干脆 不审. 加 batch 让 5 条 1 次 通过 / 驳回.


class BatchActionIn(BaseModel):
    draft_ids: list[uuid.UUID]
    action: str  # "approve" | "reject"
    reason: Optional[str] = None  # 仅 reject 用


class BatchItemResult(BaseModel):
    draft_id: uuid.UUID
    ok: bool
    error: Optional[str] = None


class BatchActionOut(BaseModel):
    succeeded: int
    failed: int
    results: list[BatchItemResult]


async def _approve_one(
    d: MemoryDraft, session: AsyncSession, auth: AuthContext
) -> None:
    """v26.14-P7.2: 单 条 approve 内部 实现, 复用 给 batch."""
    try:
        vec = await compute_embedding(d.proposed_content)
    except EmbeddingError:
        vec = [0.0] * 1536
    target_aids: list[uuid.UUID] = []
    for aid in d.target_agent_ids or []:
        try:
            target_aids.append(uuid.UUID(aid))
        except (ValueError, TypeError):
            continue
    m = LongTermMemory(
        workspace_id=d.workspace_id,
        scope=d.proposed_scope,
        scope_ref=d.proposed_scope_ref,
        content=d.proposed_content,
        importance=d.proposed_importance,
        embedding=vec,
        source_type=d.source_type,
        source_id=str(d.source_task_id or d.source_meeting_id or ""),
        source_meeting_id=d.source_meeting_id,
        source_line_ids=d.source_line_ids,
        data_classification=d.proposed_data_classification,
        agent_id=target_aids[0] if target_aids else None,
        curated_by_user_id=auth.user.id,
        curated_at=datetime.now(timezone.utc),
    )
    session.add(m)
    await session.flush()
    for idx, aid in enumerate(target_aids):
        session.add(
            MemoryAgentLink(
                memory_id=m.id,
                agent_id=aid,
                is_primary=(idx == 0),
            )
        )
    d.status = "approved"
    d.decided_at = datetime.now(timezone.utc)
    d.committed_memory_id = m.id


@router.post("/batch-action", response_model=BatchActionOut)
async def batch_action_drafts(
    payload: BatchActionIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P7.2: 批量 通过 / 驳回 草稿. 单条 失败 不阻塞 其他.

    ABAC: 跟 单条 一致 — _load_with_abac 仍 检 primary_user.
    返 partial 结果 让 前端 显 toast "通过 N 条, 失败 M 条".
    """
    if payload.action not in ("approve", "reject"):
        raise HTTPException(400, "action 必须 是 approve 或 reject")
    if not payload.draft_ids:
        raise HTTPException(400, "draft_ids 不能 为空")
    if len(payload.draft_ids) > 50:
        raise HTTPException(400, "一次 最多 50 条")

    results: list[BatchItemResult] = []
    succeeded = 0
    failed = 0
    reason = (payload.reason or "").strip() or None

    for did in payload.draft_ids:
        try:
            # 单条 复用 _load_with_abac 的 校验 (workspace + primary_user)
            d = await _load_with_abac(str(did), session, auth)
            if d.status != "pending":
                raise ValueError(f"状态={d.status}, 跳过")
            if payload.action == "approve":
                await _approve_one(d, session, auth)
                action_name = "memory_draft.approve"
                audit_payload: dict = {"committed_memory_id": str(d.committed_memory_id)}
            else:
                d.status = "rejected"
                d.decision_reason = reason
                d.decided_at = datetime.now(timezone.utc)
                action_name = "memory_draft.reject"
                audit_payload = {"reason": reason, "via": "batch"}
            await session.commit()
            await session.refresh(d)
            try:
                await audit_log(
                    session, auth, action_name,
                    target_type="memory_draft", target_id=str(d.id),
                    payload=audit_payload,
                )
                await session.commit()
            except Exception:
                logger.exception("audit_log fail (non-fatal) for draft %s", did)
            results.append(BatchItemResult(draft_id=did, ok=True))
            succeeded += 1
        except HTTPException as e:
            await session.rollback()
            results.append(BatchItemResult(draft_id=did, ok=False, error=str(e.detail)))
            failed += 1
        except Exception as e:
            await session.rollback()
            logger.exception("batch action draft %s failed", did)
            results.append(BatchItemResult(draft_id=did, ok=False, error=str(e)))
            failed += 1

    return BatchActionOut(
        succeeded=succeeded, failed=failed, results=results,
    )
