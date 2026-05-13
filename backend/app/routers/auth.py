"""Auth endpoints: register, login, me, logout."""

from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    AuthContext,
    clear_session_cookie,
    get_current_auth,
    hash_password,
    issue_token,
    set_session_cookie,
    verify_password,
)
from ..db import get_session
from ..models import (
    PasswordResetToken,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

PASSWORD_RESET_TTL_HOURS = 1


SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _slugify(name: str) -> str:
    base = SLUG_RE.sub("-", name.lower()).strip("-") or "ws"
    return base[:48]


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    workspace_name: Optional[str] = None  # if omitted, use "<name> 的工作空间"
    invite_token: Optional[str] = None    # if set, join the workspace from the invite


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: uuid.UUID
    name: str
    email: Optional[str] = None
    workspace_id: uuid.UUID
    workspace_name: str
    workspace_slug: str
    role: str


@router.post("/register", response_model=MeOut)
async def register(
    payload: RegisterIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    if len(payload.password) < 6:
        raise HTTPException(400, "password too short (min 6)")

    # If an invite token is provided, the new user joins the inviter's
    # workspace as the invited role instead of creating a fresh one.
    invite: Optional[WorkspaceInvitation] = None
    if payload.invite_token:
        invite = (
            await session.execute(
                select(WorkspaceInvitation).where(
                    WorkspaceInvitation.token == payload.invite_token
                )
            )
        ).scalar_one_or_none()
        if not invite:
            raise HTTPException(404, "invite not found")
        if invite.accepted_at is not None:
            raise HTTPException(409, "invite already used")
        if invite.expires_at < datetime.now(timezone.utc):
            raise HTTPException(410, "invite expired")

    existing = (
        await session.execute(
            select(User).where(func.lower(User.email) == payload.email.lower())
        )
    ).scalar_one_or_none()
    if existing and existing.password_hash:
        raise HTTPException(409, "email already registered")

    if invite is not None:
        # Join the inviting workspace
        ws = (
            await session.execute(
                select(Workspace).where(Workspace.id == invite.workspace_id)
            )
        ).scalar_one()
        role = invite.role
    else:
        # Workspace creation — slug must be unique
        name_for_ws = payload.workspace_name or f"{payload.name} 的工作空间"
        base_slug = _slugify(payload.workspace_name or payload.name or "ws")
        slug = base_slug
        suffix = 1
        while (
            await session.execute(select(Workspace).where(Workspace.slug == slug))
        ).scalar_one_or_none() is not None:
            suffix += 1
            slug = f"{base_slug}-{suffix}"
            if suffix > 50:
                slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"
                break
        ws = Workspace(name=name_for_ws, slug=slug)
        session.add(ws)
        await session.flush()
        role = "owner"

    if existing:
        # Speaker-only stub (e.g. enrolled via /enroll without password); upgrade it
        existing.email = payload.email
        existing.password_hash = hash_password(payload.password)
        existing.workspace_id = ws.id
        existing.last_login_at = datetime.now(timezone.utc)
        existing.name = payload.name or existing.name
        user = existing
    else:
        user = User(
            name=payload.name,
            email=payload.email,
            password_hash=hash_password(payload.password),
            workspace_id=ws.id,
            last_login_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()

    session.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role=role))

    if invite is not None:
        invite.accepted_at = datetime.now(timezone.utc)
        invite.accepted_by_user_id = user.id

    await session.commit()

    token = issue_token(user.id, ws.id)
    set_session_cookie(response, token)
    return MeOut(
        user_id=user.id,
        name=user.name,
        email=user.email,
        workspace_id=ws.id,
        workspace_name=ws.name,
        workspace_slug=ws.slug,
        role=role,
    )


# ----- public invite preview (so /register page can show workspace name) -----

class InvitePreviewOut(BaseModel):
    workspace_name: str
    role: str
    email: Optional[str] = None
    expires_at: datetime


@router.get("/invite/{token}", response_model=InvitePreviewOut)
async def invite_preview(
    token: str, session: AsyncSession = Depends(get_session)
):
    inv = (
        await session.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.token == token)
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "invite not found")
    if inv.accepted_at is not None:
        raise HTTPException(409, "invite already used")
    if inv.expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "invite expired")
    ws = (
        await session.execute(select(Workspace).where(Workspace.id == inv.workspace_id))
    ).scalar_one()
    return InvitePreviewOut(
        workspace_name=ws.name,
        role=inv.role,
        email=inv.email,
        expires_at=inv.expires_at,
    )


# ----- forgot / reset password -----------------------------------------------

class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ForgotPasswordOut(BaseModel):
    """Always returns ok=True regardless of whether the email exists, to
    avoid leaking which addresses are registered. The reset link is logged
    server-side until SMTP is wired."""
    ok: bool = True


@router.post("/forgot-password", response_model=ForgotPasswordOut)
async def forgot_password(
    payload: ForgotPasswordIn, session: AsyncSession = Depends(get_session)
):
    user = (
        await session.execute(
            select(User).where(func.lower(User.email) == payload.email.lower())
        )
    ).scalar_one_or_none()
    if user and user.password_hash:
        token = secrets.token_urlsafe(24)
        prt = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_TTL_HOURS),
        )
        session.add(prt)
        await session.commit()
        # SMTP not wired yet — surface in logs so ops can copy/paste
        # the link to the user. Frontend also shows it in dev mode.
        link = f"https://aimeeting.zhzjpt.cn/reset-password?token={token}"
        logger.warning(
            "password reset requested for %s; link (valid %dh): %s",
            user.email, PASSWORD_RESET_TTL_HOURS, link,
        )
    else:
        # Constant-time-ish: do nothing, return same shape so client
        # can't distinguish 'unknown email' from 'sent'.
        logger.info("forgot-password requested for unknown email: %s", payload.email)
    return ForgotPasswordOut(ok=True)


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", response_model=MeOut)
async def reset_password(
    payload: ResetPasswordIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    if len(payload.new_password) < 6:
        raise HTTPException(400, "password too short (min 6)")

    prt = (
        await session.execute(
            select(PasswordResetToken).where(PasswordResetToken.token == payload.token)
        )
    ).scalar_one_or_none()
    if not prt:
        raise HTTPException(404, "token not found")
    if prt.used_at is not None:
        raise HTTPException(409, "token already used")
    if prt.expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "token expired")

    user = (
        await session.execute(select(User).where(User.id == prt.user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "user not found")

    user.password_hash = hash_password(payload.new_password)
    user.last_login_at = datetime.now(timezone.utc)
    prt.used_at = datetime.now(timezone.utc)
    await session.commit()

    # Auto-login after successful reset for snappy UX
    target_ws_id = user.workspace_id
    ws = (
        await session.execute(select(Workspace).where(Workspace.id == target_ws_id))
    ).scalar_one() if target_ws_id else None
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == user.id,
                WorkspaceMembership.workspace_id == target_ws_id,
            )
        )
    ).scalar_one_or_none() if target_ws_id else None
    if not ws:
        raise HTTPException(403, "user has no workspace; contact admin")

    token = issue_token(user.id, ws.id)
    set_session_cookie(response, token)
    return MeOut(
        user_id=user.id,
        name=user.name,
        email=user.email,
        workspace_id=ws.id,
        workspace_name=ws.name,
        workspace_slug=ws.slug,
        role=membership.role if membership else "member",
    )


@router.post("/login", response_model=MeOut)
async def login(
    payload: LoginIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    user = (
        await session.execute(
            select(User).where(func.lower(User.email) == payload.email.lower())
        )
    ).scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(401, "incorrect email or password")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "account disabled")

    ws_id = user.workspace_id
    if not ws_id:
        # auto-self-heal: if somehow the user has no workspace, give them one
        ws = Workspace(name=f"{user.name} 的工作空间", slug=f"u-{user.id.hex[:8]}")
        session.add(ws)
        await session.flush()
        user.workspace_id = ws.id
        session.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner"))
        ws_id = ws.id

    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()

    ws = (
        await session.execute(select(Workspace).where(Workspace.id == ws_id))
    ).scalar_one()
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == user.id,
                WorkspaceMembership.workspace_id == ws.id,
            )
        )
    ).scalar_one_or_none()

    token = issue_token(user.id, ws.id)
    set_session_cookie(response, token)
    return MeOut(
        user_id=user.id,
        name=user.name,
        email=user.email,
        workspace_id=ws.id,
        workspace_name=ws.name,
        workspace_slug=ws.slug,
        role=membership.role if membership else "member",
    )


@router.get("/me", response_model=MeOut)
async def me(
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    # v26.4-fix1: 如果 caller 是 platform admin 但当前 workspace 内 没 membership
    # (因为切换过来的 — 跨租户视角),自动 fallback 到 owner.前端凭这个 role 决定
    # ⚙️ 后台 / 📊 看板 入口可见性.
    from ..auth import is_platform_admin as _is_pa
    effective_role: str
    if membership:
        effective_role = membership.role
    elif _is_pa(auth):
        effective_role = "owner"  # platform admin 跨 ws 视角的 ABAC 兜底
    else:
        effective_role = "member"
    return MeOut(
        user_id=auth.user.id,
        name=auth.user.name,
        email=auth.user.email,
        workspace_id=auth.workspace.id,
        workspace_name=auth.workspace.name,
        workspace_slug=auth.workspace.slug,
        role=effective_role,
    )


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}
