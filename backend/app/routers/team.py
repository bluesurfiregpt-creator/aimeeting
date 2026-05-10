"""
Workspace team management — list members, create/list/revoke invitations,
remove members. All scoped to the caller's workspace; mutating actions
require owner|admin role.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import Agent, User, WorkspaceInvitation, WorkspaceMembership

router = APIRouter(prefix="/api/team", tags=["team"])

INVITE_TTL_DAYS = 7


# ----- helpers ----------------------------------------------------------------

async def _require_admin(
    session: AsyncSession, auth: AuthContext
) -> WorkspaceMembership:
    m = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if not m or m.role not in ("owner", "admin"):
        raise HTTPException(403, "owner or admin required")
    return m


def _generate_token() -> str:
    return secrets.token_urlsafe(24)


# ----- schemas ----------------------------------------------------------------

class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: Optional[str] = None
    # v17-v20: owner | admin | member
    # v21+: 加入 'leader' (admin 别名,智慧住建偏好)和 'expert' (绑定单一 Agent)
    role: str
    bound_agent_id: Optional[uuid.UUID] = None
    bound_agent_name: Optional[str] = None
    # v24.3 #3: 暂停派单截止时间(NULL = 未暂停;过去时间 = 已自动恢复)
    suspended_until: Optional[datetime] = None
    # v24.3 #5: ABAC 雏形 — 科室名 + 自定义属性
    department: Optional[str] = None
    attributes: Optional[dict] = None
    joined_at: datetime


class MemberPatchIn(BaseModel):
    role: Optional[str] = None  # owner | admin | leader | expert | member
    bound_agent_id: Optional[uuid.UUID] = None  # required when role='expert'
    # v24.3 #5: ABAC 雏形 — 可改科室
    department: Optional[str] = None
    # 显式 None vs 不传:用 sentinel 区分清空;Pydantic 不传 = 字段缺失,
    # 传 None = 显式清空.我们简化:None 视为「不改」.


class InviteIn(BaseModel):
    email: Optional[EmailStr] = None  # optional hint; invite is token-based
    role: str = "member"


# v21: workspace_membership.role 枚举(权限模型)
_ALL_ROLES: frozenset[str] = frozenset(
    {"owner", "admin", "leader", "expert", "member"}
)
# 谁能被 admin 改派 — 不能改 owner role
_PATCHABLE_ROLES: frozenset[str] = frozenset(
    {"admin", "leader", "expert", "member"}
)


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: Optional[str] = None
    role: str
    token: str
    invite_url: str
    created_by_user_id: Optional[uuid.UUID] = None
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    created_at: datetime


# ----- members ----------------------------------------------------------------

@router.get("/members", response_model=list[MemberOut])
async def list_members(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(WorkspaceMembership, User)
            .join(User, User.id == WorkspaceMembership.user_id)
            .where(WorkspaceMembership.workspace_id == auth.workspace.id)
            .order_by(WorkspaceMembership.created_at)
        )
    ).all()
    # v21: 批量取 expert 们 bound 的 Agent name(避免 N+1)
    bound_ids = {m.bound_agent_id for (m, _) in rows if m.bound_agent_id}
    name_by_agent: dict[uuid.UUID, str] = {}
    if bound_ids:
        agents = (
            await session.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_(bound_ids))
            )
        ).all()
        name_by_agent = {a[0]: a[1] for a in agents}
    return [
        MemberOut(
            user_id=u.id,
            name=u.name,
            email=u.email,
            role=m.role,
            bound_agent_id=m.bound_agent_id,
            bound_agent_name=name_by_agent.get(m.bound_agent_id) if m.bound_agent_id else None,
            suspended_until=u.suspended_until,
            department=u.department,
            attributes=u.attributes,
            joined_at=m.created_at,
        )
        for (m, u) in rows
    ]


@router.patch("/members/{user_id}", response_model=MemberOut)
async def update_member(
    user_id: str,
    payload: MemberPatchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v21: admin 改某个成员的 role 和 / 或 bound_agent_id.

    规则:
      - 不能改自己(避免误降权);转移所有权走另外的端点(目前没做)
      - 不能把别人改成 owner(owner 转让是单独动作)
      - role='expert' 时必填 bound_agent_id;切其他 role 时清空 bound
    """
    try:
        target_uuid = uuid.UUID(user_id.strip())
    except (ValueError, AttributeError):
        raise HTTPException(400, "invalid user id")
    if auth.user.id == target_uuid:
        raise HTTPException(400, "cannot change your own role")
    await _require_admin(session, auth)

    target = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.user_id == target_uuid,
            )
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "member not found")
    if target.role == "owner":
        raise HTTPException(403, "cannot modify the workspace owner; use transfer-ownership")

    new_role = payload.role
    new_bound = payload.bound_agent_id

    # 没传 role 时,只改 bound;反之亦然.
    final_role = new_role if new_role is not None else target.role
    if new_role is not None and new_role not in _PATCHABLE_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(_PATCHABLE_ROLES)}")

    # role='expert' 必须给 bound_agent_id (传入或已有).
    if final_role == "expert":
        bound_to_use = new_bound if new_bound is not None else target.bound_agent_id
        if bound_to_use is None:
            raise HTTPException(400, "expert role requires bound_agent_id")
        # 验证 agent 在本 workspace
        a = (
            await session.execute(
                select(Agent).where(
                    Agent.id == bound_to_use,
                    Agent.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not a:
            raise HTTPException(400, "bound_agent_id not in this workspace")
        target.bound_agent_id = bound_to_use
    else:
        # 切到非 expert role 时,清掉 bound(留着没意义,徒增混淆)
        target.bound_agent_id = None

    if new_role is not None:
        target.role = new_role

    # v24.3 #5: ABAC 雏形 — 同步改 user.department(若非 None / 空字符串)
    u_for_dept = (
        await session.execute(select(User).where(User.id == target_uuid))
    ).scalar_one()
    if payload.department is not None:
        d = payload.department.strip()
        u_for_dept.department = d[:128] if d else None

    await session.commit()
    await session.refresh(target)
    await audit_log(
        session, auth, "team.update_member",
        target_type="user", target_id=str(target_uuid),
        payload={
            "role": target.role,
            "bound_agent_id": str(target.bound_agent_id) if target.bound_agent_id else None,
            "department": u_for_dept.department,
        },
    )

    # 取 user + agent name 拼回 MemberOut
    u = (
        await session.execute(select(User).where(User.id == target_uuid))
    ).scalar_one()
    bound_name: Optional[str] = None
    if target.bound_agent_id:
        bound_name = (
            await session.execute(select(Agent.name).where(Agent.id == target.bound_agent_id))
        ).scalar_one_or_none()
    return MemberOut(
        user_id=u.id,
        name=u.name,
        email=u.email,
        role=target.role,
        bound_agent_id=target.bound_agent_id,
        bound_agent_name=bound_name,
        suspended_until=u.suspended_until,
        department=u.department,
        attributes=u.attributes,
        joined_at=target.created_at,
    )


@router.delete("/members/{user_id}", status_code=204)
async def remove_member(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # Validate + self-check FIRST so an invalid UUID or "remove self" attempt
    # surfaces as a 4xx with a clear message, not a 500 from a downstream
    # query (per v8 test report P4 — DELETE /team/members/<my_id> was
    # returning 500 + empty body instead of the 400 that's already coded).
    try:
        target_uuid = uuid.UUID(user_id.strip())
    except (ValueError, AttributeError):
        raise HTTPException(400, "invalid user id")
    if auth.user.id == target_uuid:
        raise HTTPException(400, "cannot remove yourself; transfer ownership first")

    await _require_admin(session, auth)
    target = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.user_id == target_uuid,
            )
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "member not found")
    if target.role == "owner":
        raise HTTPException(403, "cannot remove the workspace owner")
    await session.delete(target)
    await session.commit()
    await audit_log(
        session, auth, "team.remove_member",
        target_type="user", target_id=str(target_uuid),
    )


# ----- invitations ------------------------------------------------------------

def _to_invite_out(inv: WorkspaceInvitation, base_url: str) -> InviteOut:
    return InviteOut(
        id=inv.id,
        email=inv.email,
        role=inv.role,
        token=inv.token,
        invite_url=f"{base_url}/register?invite={inv.token}",
        created_by_user_id=inv.created_by_user_id,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
        created_at=inv.created_at,
    )


@router.get("/invitations", response_model=list[InviteOut])
async def list_invitations(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _require_admin(session, auth)
    rows = (
        await session.execute(
            select(WorkspaceInvitation)
            .where(WorkspaceInvitation.workspace_id == auth.workspace.id)
            .order_by(WorkspaceInvitation.created_at.desc())
        )
    ).scalars().all()
    base = "https://aimeeting.zhzjpt.cn"
    return [_to_invite_out(r, base) for r in rows]


@router.post("/invitations", response_model=InviteOut)
async def create_invitation(
    payload: InviteIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _require_admin(session, auth)
    if payload.role not in ("admin", "member"):
        raise HTTPException(400, "role must be admin or member")
    inv = WorkspaceInvitation(
        workspace_id=auth.workspace.id,
        email=payload.email,
        role=payload.role,
        token=_generate_token(),
        created_by_user_id=auth.user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
    )
    session.add(inv)
    await session.commit()
    await session.refresh(inv)
    await audit_log(
        session, auth, "team.create_invite",
        target_type="invitation", target_id=str(inv.id),
        payload={"email": payload.email, "role": payload.role},
    )
    return _to_invite_out(inv, "https://aimeeting.zhzjpt.cn")


@router.delete("/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _require_admin(session, auth)
    inv = (
        await session.execute(
            select(WorkspaceInvitation).where(
                WorkspaceInvitation.id == invitation_id,
                WorkspaceInvitation.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "invitation not found")
    await session.delete(inv)
    await session.commit()
    await audit_log(
        session, auth, "team.revoke_invite",
        target_type="invitation", target_id=invitation_id,
    )
