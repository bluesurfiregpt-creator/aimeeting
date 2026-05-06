"""
Authentication primitives for Sprint F.

- bcrypt password hashing (via the `bcrypt` library directly, not passlib —
  passlib has been wrestling with bcrypt 4.x for a while and we want to
  avoid that fragility)
- HS256 JWT issued in an httpOnly cookie. SameSite=Lax + Secure (when
  COOKIE_SECURE=true) is the right default behind our nginx + HTTPS.
- FastAPI dependency `get_current_user` reads the cookie, returns the user
  + their workspace; raises 401 if missing/invalid. Use this on every
  protected route.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_session
from .models import User, Workspace, WorkspaceMembership

logger = logging.getLogger(__name__)

COOKIE_NAME = "aimeeting_session"
JWT_ALGO = "HS256"


# ----- password ---------------------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ----- JWT --------------------------------------------------------------------

def issue_token(user_id: uuid.UUID, workspace_id: Optional[uuid.UUID]) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "wsid": str(workspace_id) if workspace_id else None,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=s.jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[JWT_ALGO])


def set_session_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=s.jwt_ttl_days * 24 * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


# ----- current-user dependency ------------------------------------------------

class AuthContext:
    __slots__ = ("user", "workspace")

    def __init__(self, user: User, workspace: Workspace):
        self.user = user
        self.workspace = workspace


async def get_current_auth(
    request: Request,
    aimeeting_session: Optional[str] = Cookie(default=None, alias=COOKIE_NAME),
    session: AsyncSession = Depends(get_session),
) -> AuthContext:
    """
    Resolves the current authenticated user + their active workspace, or
    raises 401. Use as: `auth: AuthContext = Depends(get_current_auth)`.
    """
    token = aimeeting_session
    if not token:
        # Fallback: also accept Authorization: Bearer <token> for tooling.
        h = request.headers.get("Authorization", "")
        if h.lower().startswith("bearer "):
            token = h[7:].strip()
    if not token:
        raise HTTPException(401, "not authenticated")

    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "invalid token")

    user_id = payload.get("sub")
    ws_id = payload.get("wsid")
    if not user_id:
        raise HTTPException(401, "malformed token")

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(401, "user inactive")
    if not user.password_hash:
        # speaker-only profile somehow got a token; deny
        raise HTTPException(401, "account cannot log in")

    target_ws_id = ws_id or user.workspace_id
    if not target_ws_id:
        raise HTTPException(403, "no workspace")

    ws = (
        await session.execute(select(Workspace).where(Workspace.id == target_ws_id))
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(403, "workspace not found")

    # Verify membership (defence-in-depth even though we issued the token)
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == user.id,
                WorkspaceMembership.workspace_id == ws.id,
            )
        )
    ).scalar_one_or_none()
    if not membership and user.workspace_id != ws.id:
        raise HTTPException(403, "not a member of this workspace")

    return AuthContext(user=user, workspace=ws)
