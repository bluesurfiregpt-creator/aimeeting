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


# ----- v21: role + scope helpers ---------------------------------------------
#
# v17-v20 把权限模型保持在 owner/admin/member 三档.v21 引入「领导/专家」
# 二分(智慧住建文档「二.1」),实现方式不破坏 legacy:
#   - 旧的 owner/admin/member 全部继续工作(member ≈ general user)
#   - 新增 'expert' role(必填 bound_agent_id,只能看 bound 的 Agent 范围)
#   - 'leader' 暂作为 admin 别名(权限同 admin),以后语义分化时再独立
#
# 这些 helper 都是同步查询 workspace_membership 表,只触一行,可以放心
# 在 hot path 调.

_LEADER_ROLES: frozenset[str] = frozenset({"owner", "admin", "leader"})


async def get_membership_role(
    session: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> Optional[str]:
    """Returns the user's role in the workspace, or None if no membership."""
    return (
        await session.execute(
            select(WorkspaceMembership.role).where(
                WorkspaceMembership.user_id == user_id,
                WorkspaceMembership.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()


async def is_leader_or_admin(
    session: AsyncSession, auth: AuthContext
) -> bool:
    """True if caller has a 「领导/管理员」 role (owner/admin/leader)."""
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role in _LEADER_ROLES


async def is_expert(session: AsyncSession, auth: AuthContext) -> bool:
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role == "expert"


async def expert_bound_agent_id(
    session: AsyncSession, auth: AuthContext
) -> Optional[uuid.UUID]:
    """
    For expert-role caller, returns their bound agent id (or None if not
    expert / not bound). Other roles return None — caller decides what
    that means (typically: full access).
    """
    row = (
        await session.execute(
            select(
                WorkspaceMembership.role, WorkspaceMembership.bound_agent_id
            ).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).first()
    if row is None:
        return None
    role, bound = row
    if role != "expert":
        return None
    return bound


async def require_leader_or_admin(
    session: AsyncSession, auth: AuthContext
) -> None:
    """Raise 403 if caller is not a leader/owner/admin. Use as the first
    line in any router that does workspace-level destructive / global ops
    (cron rules, agent CRUD, team management, dispatch, approve, etc)."""
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "需要领导/管理员权限")


# ============================================================================
# v26.4 · Platform Admin (跨 workspace 的 SaaS 平台层超管)
# ============================================================================
# Q1=C 决策:超管身份 由 env var PLATFORM_ADMIN_EMAILS 硬配,不入库.
# 理由:
#   - 最小 schema 改动 (零 migration)
#   - 不让业务后台 SQL 误改超管列表 (env var 改完必重启容器,运维 trace 清晰)
#   - 后续要加 UI 管理超管时再升级到 platform_admin 表
#
# 安全:
#   - 后端任何 /api/super/* 端点 必须 先调 require_platform_admin
#   - 前端 /super 路由 + middleware 二次校验 me.email 在白名单
#   - 所有 superadmin 操作 audit 时 payload 加 {"platform_admin": true}
#     方便客户日后查 "今天 platform admin 在我空间做了什么"


def is_platform_admin_email(email: Optional[str]) -> bool:
    """email 是否在 env PLATFORM_ADMIN_EMAILS 白名单 (case-insensitive)."""
    if not email:
        return False
    from .config import get_settings
    return email.lower().strip() in get_settings().platform_admin_emails_set


def is_platform_admin(auth: AuthContext) -> bool:
    """当前 user 是否是平台超管.基于 user.email 跟 env 白名单 比对."""
    return is_platform_admin_email(auth.user.email)


async def require_platform_admin(auth: AuthContext) -> None:
    """Raise 403 if caller 不是 平台超管.每个 /api/super/* 端点 必填第一行.
    不需要 session 因为校验只看 env + auth.user.email,无 DB query."""
    if not is_platform_admin(auth):
        raise HTTPException(403, "需要平台超管权限 (PLATFORM_ADMIN_EMAILS env)")
