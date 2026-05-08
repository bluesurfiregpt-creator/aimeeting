from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import User, Voiceprint
from ..schemas import UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    name: str
    email: str | None = None


@router.post("", response_model=UserOut)
async def create_user(
    payload: UserCreate,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Creates a *speaker-only* user (no password) within the current
    workspace. Used by /enroll. Real account creation is via /api/auth/register.
    """
    if payload.email:
        existing = (
            await session.execute(
                select(User).where(
                    User.email == payload.email,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return UserOut.model_validate(
                {**existing.__dict__, "has_voiceprint": False}
            )
    u = User(
        name=payload.name.strip(),
        email=payload.email,
        workspace_id=auth.workspace.id,
    )
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return UserOut.model_validate({**u.__dict__, "has_voiceprint": False})


@router.get("", response_model=list[UserOut])
async def list_users(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(User)
            .where(User.workspace_id == auth.workspace.id)
            .order_by(User.created_at.desc())
        )
    ).scalars().all()
    if not rows:
        return []
    user_ids = [u.id for u in rows]
    vp_rows = (
        await session.execute(
            select(Voiceprint.user_id).where(
                Voiceprint.user_id.in_(user_ids), Voiceprint.is_active.is_(True)
            )
        )
    ).all()
    have_vp = {row[0] for row in vp_rows}
    return [
        UserOut.model_validate({**u.__dict__, "has_voiceprint": (u.id in have_vp)})
        for u in rows
    ]


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    u = (
        await session.execute(
            select(User).where(
                User.id == user_id, User.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "user not found")
    has_vp = (
        await session.execute(
            select(Voiceprint).where(Voiceprint.user_id == u.id, Voiceprint.is_active.is_(True))
        )
    ).first()
    return UserOut.model_validate({**u.__dict__, "has_voiceprint": bool(has_vp)})
