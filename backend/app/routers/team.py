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
from ..models import User, WorkspaceInvitation, WorkspaceMembership

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
    role: str
    joined_at: datetime


class InviteIn(BaseModel):
    email: Optional[EmailStr] = None  # optional hint; invite is token-based
    role: str = "member"


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
    return [
        MemberOut(
            user_id=u.id,
            name=u.name,
            email=u.email,
            role=m.role,
            joined_at=m.created_at,
        )
        for (m, u) in rows
    ]


@router.delete("/members/{user_id}", status_code=204)
async def remove_member(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _require_admin(session, auth)
    if str(auth.user.id) == user_id:
        raise HTTPException(400, "cannot remove yourself; transfer ownership first")
    target = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.user_id == user_id,
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
        target_type="user", target_id=user_id,
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
