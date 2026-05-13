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
        raise HTTPException(403, "[需重新登录] 账号没有关联工作空间,请联系管理员")

    ws = (
        await session.execute(select(Workspace).where(Workspace.id == target_ws_id))
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(403, "[操作受限] 工作空间不存在(可能已被删除),请刷新或退出重登")

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
        # v26.4-fix2: platform admin 切换到 客户 workspace 时,在该 ws 里没
        # membership 行 是 设计意图("上帝视角" + 不污染客户 user 列表 — 见
        # routers/super.py 的 /switch 注释).这里 开后门:caller email 在
        # PLATFORM_ADMIN_EMAILS env 白名单 → 放行.
        # 普通用户的 not-a-member 防御仍然 生效 (email 不在白名单 → 仍 raise).
        # 后续 is_leader_or_admin / /api/auth/me 都已 platform admin 兼容
        # (v26.4-fix1),所以放行后 一切 UI 端正常工作.
        if not is_platform_admin_email(user.email):
            raise HTTPException(403, "[权限不足] 您不是该工作空间的成员")

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
    """True if caller has a 「领导/管理员」 role (owner/admin/leader).

    v26.4-fix1: platform admin 切到任何 workspace 都视为 leader (即使该 ws 内
    没 membership 行).这是设计 — 平台超管的"上帝视角"语义.audit_log 里已经
    打 platform_admin=true 让客户能追溯,不需要 insert membership 污染客户 user
    列表.
    """
    if is_platform_admin(auth):
        return True
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role in _LEADER_ROLES


async def is_expert(session: AsyncSession, auth: AuthContext) -> bool:
    """DEPRECATED v26.5 — kept for backward compat. 真实场景应该用 is_manager."""
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role == "expert"


async def is_manager(session: AsyncSession, auth: AuthContext) -> bool:
    """v26.5: caller 在当前 workspace 是 manager 角色?
    (manager = 部门 AI 维护人, 取代 v21 expert 概念)"""
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role == "manager"


async def manager_owned_agent_ids(
    session: AsyncSession, auth: AuthContext
) -> list[uuid.UUID]:
    """v26.5: 返回 caller 作为 Agent.primary_user_id 管理的所有 agent id (本 ws 内).

    用法: dashboard scope filter / 邀请 AI 时显示 "我管的 AI" 分组 / 等.

    返回空列表 = caller 不管任何 AI.
    """
    from .models import Agent
    rows = (
        await session.execute(
            select(Agent.id).where(
                Agent.workspace_id == auth.workspace.id,
                Agent.primary_user_id == auth.user.id,
            )
        )
    ).scalars().all()
    return list(rows)


async def is_agent_manager(
    session: AsyncSession, auth: AuthContext, agent_id: uuid.UUID
) -> bool:
    """v26.5 核心 ABAC: caller 是否有权管理 这个 agent
    (改 agent 配置 / KB / 长期记忆 / 审批任务沉淀).

    True 条件 (任一即可):
      1. caller 是 workspace owner/admin/leader (跨部门管 — 局长有权干预)
      2. caller 是 该 agent 的 primary_user_id (部门级 manager)

    platform admin 跨 ws 自动 通过 (经 is_leader_or_admin 已 fallback,v26.4-fix1).
    """
    if await is_leader_or_admin(session, auth):
        return True
    from .models import Agent
    agent = (
        await session.execute(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if agent is None:
        return False
    return agent.primary_user_id == auth.user.id


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
        raise HTTPException(403, "[权限不足] 此功能需要 owner / admin / leader 角色")


# ============================================================================
# v26.5-02 P1 · KB-scoped helpers (基于 KnowledgeBase.owner_agent_id)
# ============================================================================

async def can_write_kb(
    session: AsyncSession, auth: AuthContext, kb_id: uuid.UUID
) -> bool:
    """v26.5-02a: 这个 caller 是否有权改 这个 KB 的内容
    (上传文档 / 删文档 / reprocess).

    True 条件 (任一即可):
      1. caller 是 workspace owner/admin/leader → 全权
      2. KB.owner_agent_id 指向某 agent A, 且 caller 是 A.primary_user_id
         → 该 manager 负责 A, 可以管理 A 的 KB
      3. KB.owner_agent_id 为 NULL → 退到 admin-only (1)

    workspace 隔离: KB 必须属于 caller 的 workspace.
    """
    if await is_leader_or_admin(session, auth):
        return True
    from .models import KnowledgeBase, Agent
    kb = (
        await session.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.id == kb_id,
                KnowledgeBase.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if kb is None:
        return False
    if kb.owner_agent_id is None:
        return False  # 无 owner agent 的 KB 仅 admin/leader 可写
    # KB 归属某 agent → 该 agent 的 primary_user 可写
    return await is_agent_manager(session, auth, kb.owner_agent_id)


async def require_kb_writer(
    session: AsyncSession, auth: AuthContext, kb_id: uuid.UUID
) -> None:
    """v26.5-02a: 写 KB 内容 (上传/删/reprocess 文档) 的 ABAC 守卫."""
    if not await can_write_kb(session, auth, kb_id):
        raise HTTPException(
            403,
            "[权限不足] 写此 KB 需要 owner/admin/leader,"
            "或该 KB 归属 AI 的 primary_user (manager)"
        )


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
        raise HTTPException(403, "[权限不足] 此功能仅平台超管可见 (您的 email 不在 PLATFORM_ADMIN_EMAILS 白名单)")
