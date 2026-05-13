"""v26.5-02c: KB 沉淀草稿审批

当 task done 时, 如果 操作者 (curator) 不是 目标 agent.primary_user,
不立即写 KB, 而是 创建一个 KbSedimentationDraft, 等 primary_user 审批.

Endpoints (workspace-scoped + ABAC):
  GET    /api/sedimentation-drafts                — 列我的待审批 (primary_user_id = me)
  GET    /api/sedimentation-drafts/{id}           — 详情
  POST   /api/sedimentation-drafts/{id}/approve   — 批准 → 实际写 KB
  POST   /api/sedimentation-drafts/{id}/reject    — 驳回 → 标 rejected, KB 不动

ABAC: primary_user_id == auth.user.id (或 leader+ 跨人审).
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
from ..models import Agent, KbSedimentationDraft, Notification, Task

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sedimentation-drafts", tags=["kb-sedimentation"])


# ----- schemas ----------------------------------------------------------------

class DraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    task_id: uuid.UUID
    task_title: Optional[str] = None
    target_agent_id: uuid.UUID
    target_agent_name: Optional[str] = None
    target_kb_id: Optional[uuid.UUID] = None
    proposed_summary: str
    curator_user_id: Optional[uuid.UUID] = None
    curator_user_name: Optional[str] = None
    primary_user_id: uuid.UUID
    status: str
    decision_reason: Optional[str] = None
    decided_at: Optional[datetime] = None
    consolidated_at: Optional[datetime] = None
    created_at: datetime


class RejectIn(BaseModel):
    reason: Optional[str] = None


# ----- helpers ----------------------------------------------------------------

async def _resolve_draft_out(
    db: AsyncSession, drafts: list[KbSedimentationDraft]
) -> list[DraftOut]:
    """批量 resolve task.title / agent.name / curator.name 给 DraftOut."""
    if not drafts:
        return []
    task_ids = {d.task_id for d in drafts}
    agent_ids = {d.target_agent_id for d in drafts}
    user_ids = {d.curator_user_id for d in drafts if d.curator_user_id}

    task_titles: dict[uuid.UUID, str] = {}
    if task_ids:
        rows = (
            await db.execute(
                select(Task.id, Task.title, Task.content).where(Task.id.in_(task_ids))
            )
        ).all()
        task_titles = {r[0]: (r[1] or (r[2][:60] if r[2] else "")) for r in rows}

    agent_names: dict[uuid.UUID, str] = {}
    if agent_ids:
        rows = (
            await db.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
            )
        ).all()
        agent_names = {r[0]: r[1] for r in rows}

    user_names: dict[uuid.UUID, str] = {}
    if user_ids:
        from ..models import User as _User
        rows = (
            await db.execute(
                select(_User.id, _User.name).where(_User.id.in_(user_ids))
            )
        ).all()
        user_names = {r[0]: r[1] for r in rows}

    out: list[DraftOut] = []
    for d in drafts:
        out.append(DraftOut.model_validate({
            **d.__dict__,
            "task_title": task_titles.get(d.task_id),
            "target_agent_name": agent_names.get(d.target_agent_id),
            "curator_user_name": (
                user_names.get(d.curator_user_id) if d.curator_user_id else None
            ),
        }))
    return out


async def _load_draft_with_abac(
    draft_id: str, session: AsyncSession, auth: AuthContext
) -> KbSedimentationDraft:
    """Load draft + ABAC: caller 必须是 primary_user 或 leader+."""
    d = (
        await session.execute(
            select(KbSedimentationDraft).where(
                KbSedimentationDraft.id == draft_id,
                KbSedimentationDraft.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "draft not found")
    is_admin = await is_leader_or_admin(session, auth)
    if d.primary_user_id != auth.user.id and not is_admin:
        raise HTTPException(
            403,
            "[权限不足] 仅 该 KB 沉淀的 审批人 (primary_user) 或 owner/admin/leader 可操作"
        )
    return d


# ----- endpoints --------------------------------------------------------------

@router.get("", response_model=list[DraftOut])
async def list_drafts(
    status: Optional[str] = None,  # pending|approved|rejected|expired|all
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """列 我作为 primary_user 的 待审批草稿. leader+ 可查全 workspace."""
    is_admin = await is_leader_or_admin(session, auth)
    stmt = (
        select(KbSedimentationDraft)
        .where(KbSedimentationDraft.workspace_id == auth.workspace.id)
        .order_by(KbSedimentationDraft.created_at.desc())
        .limit(limit)
    )
    if not is_admin:
        # 仅 我作为 primary_user 的
        stmt = stmt.where(KbSedimentationDraft.primary_user_id == auth.user.id)
    if status and status != "all":
        if status not in ("pending", "approved", "rejected", "expired"):
            raise HTTPException(400, "invalid status filter")
        stmt = stmt.where(KbSedimentationDraft.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return await _resolve_draft_out(session, list(rows))


@router.get("/{draft_id}", response_model=DraftOut)
async def get_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    d = await _load_draft_with_abac(draft_id, session, auth)
    out = await _resolve_draft_out(session, [d])
    return out[0]


@router.post("/{draft_id}/approve", response_model=DraftOut)
async def approve_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """批准 → 实际沉淀 KB. 复用 consolidate_task_to_agent_kb (走 override_summary)."""
    d = await _load_draft_with_abac(draft_id, session, auth)
    if d.status != "pending":
        raise HTTPException(409, f"draft status={d.status}, 不能再批")

    # 触发实际沉淀
    # 把 draft.proposed_summary 作为 override_summary 传给 consolidator
    from ..task_consolidator import (
        ConsolidationError,
        consolidate_task_to_agent_kb,
    )
    try:
        await consolidate_task_to_agent_kb(
            d.task_id,
            target_agent_id=d.target_agent_id,
            override_summary=d.proposed_summary,
            curator_user_id=auth.user.id,
            force=False,
        )
    except ConsolidationError as e:
        raise HTTPException(500, f"consolidate failed: {e}")

    # 标 draft approved
    d.status = "approved"
    d.decided_at = datetime.now(timezone.utc)
    d.consolidated_at = d.decided_at
    await session.commit()
    await session.refresh(d)

    # 通知 curator (原触发者) — 你提的沉淀 已被批准
    if d.curator_user_id and d.curator_user_id != auth.user.id:
        notif = Notification(
            workspace_id=auth.workspace.id,
            user_id=d.curator_user_id,
            kind="kb_sedimentation_approved",
            severity="normal",
            payload={
                "draft_id": str(d.id),
                "task_id": str(d.task_id),
                "approver_name": auth.user.name,
            },
        )
        session.add(notif)
        await session.commit()

    await audit_log(
        session, auth, "kb_sedimentation.approve",
        target_type="kb_sedimentation_draft", target_id=str(d.id),
        payload={"task_id": str(d.task_id), "agent_id": str(d.target_agent_id)},
    )
    out = await _resolve_draft_out(session, [d])
    return out[0]


@router.post("/{draft_id}/reject", response_model=DraftOut)
async def reject_draft(
    draft_id: str,
    payload: RejectIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """驳回 → 草稿丢弃, KB 不动."""
    d = await _load_draft_with_abac(draft_id, session, auth)
    if d.status != "pending":
        raise HTTPException(409, f"draft status={d.status}, 不能再驳")
    d.status = "rejected"
    d.decision_reason = (payload.reason or "").strip() or None
    d.decided_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(d)

    # 通知 curator (原触发者) — 你提的沉淀 被驳回
    if d.curator_user_id and d.curator_user_id != auth.user.id:
        notif = Notification(
            workspace_id=auth.workspace.id,
            user_id=d.curator_user_id,
            kind="kb_sedimentation_rejected",
            severity="yellow",
            payload={
                "draft_id": str(d.id),
                "task_id": str(d.task_id),
                "reviewer_name": auth.user.name,
                "reason": d.decision_reason,
            },
        )
        session.add(notif)
        await session.commit()

    await audit_log(
        session, auth, "kb_sedimentation.reject",
        target_type="kb_sedimentation_draft", target_id=str(d.id),
        payload={
            "task_id": str(d.task_id),
            "agent_id": str(d.target_agent_id),
            "reason": d.decision_reason,
        },
    )
    out = await _resolve_draft_out(session, [d])
    return out[0]
