"""Auth endpoints: register, login, me, logout."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
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
from ..models import User, Workspace, WorkspaceMembership

router = APIRouter(prefix="/api/auth", tags=["auth"])


SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _slugify(name: str) -> str:
    base = SLUG_RE.sub("-", name.lower()).strip("-") or "ws"
    return base[:48]


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    workspace_name: Optional[str] = None  # if omitted, use "<name> 的工作空间"


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

    existing = (
        await session.execute(
            select(User).where(func.lower(User.email) == payload.email.lower())
        )
    ).scalar_one_or_none()
    if existing and existing.password_hash:
        raise HTTPException(409, "email already registered")

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

    session.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner"))
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
        role="owner",
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
    return MeOut(
        user_id=auth.user.id,
        name=auth.user.name,
        email=auth.user.email,
        workspace_id=auth.workspace.id,
        workspace_name=auth.workspace.name,
        workspace_slug=auth.workspace.slug,
        role=membership.role if membership else "member",
    )


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}
