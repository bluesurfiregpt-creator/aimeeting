"""
v21 — 跨 AI 数据访问申请 endpoints.

挂在 /api/me/access-requests 下,因为「申请」本质上是个人动作.
审批人视角通过 ?role=reviewer 切换,类似 /api/me/tasks?role=reviewer.

通知 kind:
  access_requested — 资源所属人(target_owner_user_id)收到「有人想看你的数据」
  access_approved  — 申请人收到「批了,有效期到 X」
  access_rejected  — 申请人收到「驳回:<原因>」
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth, is_leader_or_admin
from ..db import get_session
from ..models import DataAccessRequest, KnowledgeDocument, LongTermMemory, Task
from ..notify import emit_notification

router = APIRouter(prefix="/api/me/access-requests", tags=["access-requests"])


# 默认授权窗口(approve 时未填则用此).
_DEFAULT_APPROVAL_WINDOW_HOURS = 24
# 上限,防止用户填 365×24 一类极端值
_MAX_APPROVAL_WINDOW_HOURS = 30 * 24


class AccessRequestOut(BaseModel):
    id: uuid.UUID
    requester_user_id: uuid.UUID
    target_resource_type: str
    target_resource_id: uuid.UUID
    target_owner_user_id: Optional[uuid.UUID] = None
    justification: Optional[str] = None
    status: str
    expires_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decided_by_user_id: Optional[uuid.UUID] = None
    decision_reason: Optional[str] = None
    created_at: datetime


class CreateIn(BaseModel):
    target_resource_type: str  # 'task' | 'kb_document' | 'memory' | 'agent'
    target_resource_id: uuid.UUID
    justification: Optional[str] = None


class ApproveIn(BaseModel):
    approval_window_hours: Optional[int] = None  # 默认 24,1-720 之间


class RejectIn(BaseModel):
    reason: Optional[str] = None


_VALID_TARGET_TYPES: frozenset[str] = frozenset(
    {"task", "kb_document", "memory", "agent"}
)


def _to_out(r: DataAccessRequest) -> AccessRequestOut:
    return AccessRequestOut(
        id=r.id,
        requester_user_id=r.requester_user_id,
        target_resource_type=r.target_resource_type,
        target_resource_id=r.target_resource_id,
        target_owner_user_id=r.target_owner_user_id,
        justification=r.justification,
        status=r.status,
        expires_at=r.expires_at,
        decided_at=r.decided_at,
        decided_by_user_id=r.decided_by_user_id,
        decision_reason=r.decision_reason,
        created_at=r.created_at,
    )


async def _resolve_target_owner(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    target_resource_type: str,
    target_resource_id: uuid.UUID,
) -> tuple[Optional[uuid.UUID], Optional[str]]:
    """
    Look up the (owner_user_id, current_classification) for the target.
    Returns (None, None) if the resource doesn't exist in this workspace.
    """
    if target_resource_type == "task":
        row = (
            await session.execute(
                select(Task.created_by_user_id, Task.data_classification).where(
                    Task.id == target_resource_id,
                    Task.workspace_id == workspace_id,
                )
            )
        ).first()
    elif target_resource_type == "kb_document":
        # KB doc 没有直接的 created_by;owner 视为 None,审批走 admin
        row = (
            await session.execute(
                select(
                    KnowledgeDocument.id,
                    KnowledgeDocument.data_classification,
                ).where(KnowledgeDocument.id == target_resource_id)
            )
        ).first()
        return (None, row[1] if row else None)
    elif target_resource_type == "memory":
        row = (
            await session.execute(
                select(LongTermMemory.id, LongTermMemory.data_classification).where(
                    LongTermMemory.id == target_resource_id,
                    LongTermMemory.workspace_id == workspace_id,
                )
            )
        ).first()
        return (None, row[1] if row else None)
    else:  # 'agent' — coarse-grained, no inherent classification
        return (None, None)
    if row is None:
        return (None, None)
    return (row[0], row[1])


@router.post("", response_model=AccessRequestOut)
async def create_request(
    payload: CreateIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v21: 申请跨 AI / 跨人访问某条受保护资源."""
    if payload.target_resource_type not in _VALID_TARGET_TYPES:
        raise HTTPException(
            400,
            f"target_resource_type must be one of {sorted(_VALID_TARGET_TYPES)}",
        )

    owner_id, classification = await _resolve_target_owner(
        session,
        auth.workspace.id,
        payload.target_resource_type,
        payload.target_resource_id,
    )
    if classification is None and payload.target_resource_type != "agent":
        raise HTTPException(404, "目标资源不存在或不在本工作空间")

    # 自己请求自己的资源没意义 — 直接拒,提示 caller 没必要走这个流程
    if owner_id is not None and owner_id == auth.user.id:
        raise HTTPException(400, "您是该资源的拥有者,无需申请访问")

    row = DataAccessRequest(
        workspace_id=auth.workspace.id,
        requester_user_id=auth.user.id,
        target_resource_type=payload.target_resource_type,
        target_resource_id=payload.target_resource_id,
        target_owner_user_id=owner_id,
        justification=(payload.justification or "").strip()[:1000] or None,
        status="pending",
    )
    session.add(row)
    await session.flush()

    # 通知审批人:owner 优先,owner 缺席时 fallback 给 workspace owner/admin
    # (v21 简化:owner 缺席场景下不主动找 admin,UI 把这种 access request
    #  渲染在「待我审核(管理员视角)」section 里给所有 leader 看)
    if owner_id is not None and owner_id != auth.user.id:
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=owner_id,
            kind="access_requested",
            payload={
                "request_id": str(row.id),
                "requester_name": auth.user.name,
                "target_resource_type": payload.target_resource_type,
                "target_resource_id": str(payload.target_resource_id),
                "data_classification": classification,
                "justification": row.justification,
            },
        )

    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.get("", response_model=list[AccessRequestOut])
async def list_requests(
    role: str = Query("requester", regex="^(requester|reviewer)$"),
    status: str = Query("all", regex="^(all|pending|approved|rejected|expired)$"),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v21: 列举我的访问申请(role=requester,默认)或我需审批的(role=reviewer).

    reviewer 视角的范围:
      - target_owner_user_id == 我 (我是资源所有人)
      - OR 我是 workspace owner/admin/leader (兜底审批)
    """
    q = select(DataAccessRequest).where(
        DataAccessRequest.workspace_id == auth.workspace.id
    )
    if role == "requester":
        q = q.where(DataAccessRequest.requester_user_id == auth.user.id)
    else:  # reviewer
        if await is_leader_or_admin(session, auth):
            # leader/admin 看 workspace 所有 request(除自己发起的)
            q = q.where(DataAccessRequest.requester_user_id != auth.user.id)
        else:
            # 普通用户只能看明确派给自己的
            q = q.where(DataAccessRequest.target_owner_user_id == auth.user.id)
    if status != "all":
        q = q.where(DataAccessRequest.status == status)
    q = q.order_by(DataAccessRequest.created_at.desc()).limit(limit)
    rows = (await session.execute(q)).scalars().all()
    return [_to_out(r) for r in rows]


async def _load_request_for_review(
    session: AsyncSession, req_id: str, auth: AuthContext
) -> DataAccessRequest:
    """Load an access request and verify caller can decide on it."""
    try:
        rid = uuid.UUID(req_id)
    except ValueError:
        raise HTTPException(400, "invalid request id")
    r = (
        await session.execute(
            select(DataAccessRequest).where(
                DataAccessRequest.id == rid,
                DataAccessRequest.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "access request not found")
    is_owner_target = r.target_owner_user_id == auth.user.id
    is_admin = await is_leader_or_admin(session, auth)
    if not (is_owner_target or is_admin):
        raise HTTPException(403, "您没有权限决定该申请")
    return r


@router.post("/{request_id}/approve", response_model=AccessRequestOut)
async def approve_request(
    request_id: str,
    payload: ApproveIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    r = await _load_request_for_review(session, request_id, auth)
    if r.status != "pending":
        raise HTTPException(409, f"该申请已 {r.status},不能再审批")
    hours = payload.approval_window_hours or _DEFAULT_APPROVAL_WINDOW_HOURS
    if not (1 <= hours <= _MAX_APPROVAL_WINDOW_HOURS):
        raise HTTPException(400, f"approval_window_hours 必须在 1-{_MAX_APPROVAL_WINDOW_HOURS} 之间")
    now = datetime.now(timezone.utc)
    r.status = "approved"
    r.decided_at = now
    r.decided_by_user_id = auth.user.id
    r.expires_at = now + timedelta(hours=hours)

    if r.requester_user_id != auth.user.id:
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=r.requester_user_id,
            kind="access_approved",
            payload={
                "request_id": str(r.id),
                "approved_by_name": auth.user.name,
                "expires_at": r.expires_at.isoformat(),
                "target_resource_type": r.target_resource_type,
                "target_resource_id": str(r.target_resource_id),
            },
        )
    await session.commit()
    await session.refresh(r)
    return _to_out(r)


@router.post("/{request_id}/reject", response_model=AccessRequestOut)
async def reject_request(
    request_id: str,
    payload: RejectIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    r = await _load_request_for_review(session, request_id, auth)
    if r.status != "pending":
        raise HTTPException(409, f"该申请已 {r.status},不能再审批")
    r.status = "rejected"
    r.decided_at = datetime.now(timezone.utc)
    r.decided_by_user_id = auth.user.id
    r.decision_reason = (payload.reason or "").strip()[:500] or None

    if r.requester_user_id != auth.user.id:
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=r.requester_user_id,
            kind="access_rejected",
            payload={
                "request_id": str(r.id),
                "rejected_by_name": auth.user.name,
                "reason": r.decision_reason,
                "target_resource_type": r.target_resource_type,
                "target_resource_id": str(r.target_resource_id),
            },
        )
    await session.commit()
    await session.refresh(r)
    return _to_out(r)
