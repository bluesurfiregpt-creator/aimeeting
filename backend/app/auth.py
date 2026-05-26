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

def issue_token(
    user_id: uuid.UUID,
    workspace_id: Optional[uuid.UUID],
    ttl_days: Optional[int] = None,
) -> str:
    """签发 JWT.

    ttl_days:
      - None (默认) → 用 config.jwt_ttl_days (默认 14 天, 给 H5 cookie 用)
      - 30 之类的显式值 → 给小程序原生 / iOS App token 用,
        客户端持有 + 主动 refresh

    v27.0-mobile P21 原生 C-1: 加 ttl_days 参数, 不改默认值, 不影响 H5 cookie 行为.
    """
    s = get_settings()
    now = datetime.now(timezone.utc)
    effective_ttl = ttl_days if ttl_days is not None else s.jwt_ttl_days
    payload = {
        "sub": str(user_id),
        "wsid": str(workspace_id) if workspace_id else None,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=effective_ttl)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[JWT_ALGO])


def extract_ws_token(ws) -> Optional[str]:
    """v27.0-mobile P21 原生 C-1: 从 WebSocket 抽 JWT token, 兼容三种来源.

    优先级:
      1. Authorization: Bearer header (小程序 wx.connectSocket header 参数传, 最干净)
      2. query param ?token=xxx (fallback, 兼容老小程序 SDK / 某些场景 header 不通)
      3. cookie aimeeting_session (H5 浏览器场景, 自动随 fetch 一起发)

    返回 token str 或 None.

    注意 query param 模式安全考量:
      - 完整 URL 可能 出现在 反向代理 access log (token 暴露)
      - 大部分客户端用 header 即可, query 仅作 fallback
    """
    # 1. Authorization header
    auth_header = (
        ws.headers.get("authorization") or ws.headers.get("Authorization") or ""
    )
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    # 2. query param
    qp_token = ws.query_params.get("token")
    if qp_token:
        return qp_token.strip()
    # 3. cookie
    return ws.cookies.get(COOKIE_NAME)


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
        # v26.4-fix2 → v1.3.1: system_owner 切换到 客户 workspace 时,在该 ws 里没
        # membership 行 是 设计意图("上帝视角" + 不污染客户 user 列表 — 见
        # routers/super.py 的 /switch 注释).这里 开后门:caller email 在
        # PLATFORM_ADMIN_EMAILS env 白名单 (= system_owner) → 放行.
        # 普通用户的 not-a-member 防御仍然 生效 (email 不在白名单 → 仍 raise).
        if not is_platform_admin_email(user.email):
            raise HTTPException(403, "[权限不足] 您不是该工作空间的成员")

    return AuthContext(user=user, workspace=ws)


# ----- v1.3.1 角色对齐: 4 层 + 1 system 模型 ---------------------------------
#
# v1.3.1 PM 拍板 后 的 5 层 权限 模型 (旧 6 role + env 白名单 → 新 4 ws-role + 1 system):
#
#   system_owner       — env 白名单, 跨 workspace 最高权 (旧 platform_admin)
#   workspace_creator  — workspace 注册者, ws 内最高权 (旧 owner). 跟 leader 同权
#   leader             — workspace 管理员, ws 内最高权 (跟 workspace_creator 同权)
#   admin              — workspace 内 科室级 (只 看科室 + 改科室人员 + 发起会议; 不改 AI/KB/memory)
#   agent_owner        — 某 AI 的 primary user (旧 manager). 改 自己 AI 的 KB / memory.
#   member             — 仅查看 + 发起会议
#
# 三层 helper 对应 三种 ABAC 决策粒度:
#   is_system_owner             — 跨 ws 上帝视角
#   is_workspace_manager        — ws 管理员 (workspace_creator + leader). 编辑 AI/KB/memory 的最低门槛
#   is_workspace_admin_or_above — ws 管理员 + admin (科室级). 邀请成员 / 看团队 / 发起 auto 会议
#   is_agent_owner              — 某 AI 的 primary user. ABAC: 可改 自己 AI 的 KB / memory
#
# 旧 helper 保留兼容 alias (是 leader/workspace_creator + admin 的并集):
#   is_leader_or_admin → is_workspace_admin_or_above
#   require_leader_or_admin → require_workspace_admin_or_above
#
# 这些 helper 都是同步查询 workspace_membership 表,只触一行,可以放心在 hot path 调.

# v1.3.1: ws 管理员集合 — 编辑 AI / KB / memory 必须达到 (PM Q7.4 web 独占编辑).
_WORKSPACE_MANAGER_ROLES: frozenset[str] = frozenset(
    {"workspace_creator", "leader"}
)
# v1.3.1: workspace_creator + leader + admin 等. 邀请 / 看团队 / 发起 auto 会议 等
# 工作空间级 但允许 科室长 admin 操作 的端点 用这个.
_WORKSPACE_ADMIN_OR_ABOVE_ROLES: frozenset[str] = frozenset(
    {"workspace_creator", "leader", "admin"}
)


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


async def is_workspace_manager(
    session: AsyncSession, auth: AuthContext
) -> bool:
    """v1.3.1: caller 是否 workspace_creator / leader (workspace 管理员).

    这是 编辑 AI / KB / memory 的 最低 门槛. admin 不算 (只能看 + 发起会议 + 管科室人员).

    v26.4-fix1: system_owner (platform admin) 视为 workspace_manager (上帝视角).
    """
    if is_platform_admin(auth):
        return True
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role in _WORKSPACE_MANAGER_ROLES


async def is_workspace_admin_or_above(
    session: AsyncSession, auth: AuthContext
) -> bool:
    """v1.3.1: caller 是否 workspace_creator / leader / admin.

    用于 邀请成员 / 看团队 / 发起 auto 会议 等 ws 级 但 admin 也能做 的操作.
    跟 PM Q7.4 区分 — "编辑 AI/KB/memory" 必须 workspace_manager (更严),
    "管科室人员 / 发起 auto 会议" 用 这个.

    v26.4-fix1: system_owner 视为通过.
    """
    if is_platform_admin(auth):
        return True
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role in _WORKSPACE_ADMIN_OR_ABOVE_ROLES


# v1.3.1 兼容 alias — 老代码 全 走 is_leader_or_admin, 语义上 就是 ws_admin_or_above.
is_leader_or_admin = is_workspace_admin_or_above


async def require_workspace_manager(
    session: AsyncSession, auth: AuthContext
) -> None:
    """v1.3.1: 要求 caller 是 workspace_creator / leader (或 system_owner).

    编辑 AI / KB / memory 等 PM Q7.4 web 独占编辑端点 用此 guard.
    admin / agent_owner / member 触此 guard 都 403."""
    if not await is_workspace_manager(session, auth):
        raise HTTPException(
            403,
            "[权限不足] 此操作需要 workspace_creator / leader 角色"
            " (admin / agent_owner / member 无权)"
        )


async def require_workspace_admin_or_above(
    session: AsyncSession, auth: AuthContext
) -> None:
    """v1.3.1: 要求 caller 是 workspace_creator / leader / admin (或 system_owner).

    邀请成员 / 看团队 / cron / search providers / asr vocab / dispatch / 发起 auto
    会议 等 ws 级 但 科室长 admin 也能做 的操作 用此 guard.

    agent_owner / member 触此 guard 都 403."""
    if not await is_workspace_admin_or_above(session, auth):
        raise HTTPException(
            403,
            "[权限不足] 此操作需要 workspace_creator / leader / admin 角色"
        )


# v1.3.1 兼容 alias — 老代码 全 走 require_leader_or_admin, 语义 = admin_or_above.
require_leader_or_admin = require_workspace_admin_or_above


async def is_agent_owner_user(
    session: AsyncSession, auth: AuthContext
) -> bool:
    """v1.3.1: caller 在当前 workspace 是 agent_owner 角色 (= 老 manager).

    通过 Agent.primary_user_id 反向查 caller 管的 AI 列表; 也校验 membership.role."""
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role == "agent_owner"


# v1.3.1 兼容: is_manager / is_expert 老 helper. 改名后 alias 保留, 避免大爆破.
async def is_manager(session: AsyncSession, auth: AuthContext) -> bool:
    """DEPRECATED v1.3.1 — 改用 is_agent_owner_user. 保留 alias 避免老代码 break."""
    return await is_agent_owner_user(session, auth)


async def is_expert(session: AsyncSession, auth: AuthContext) -> bool:
    """DEPRECATED v26.5 — kept for backward compat. v1.3.1 后 永远 返 False
    (老 expert 在 v26.5 已 migrate 成 manager, 现在又 migrate 成 agent_owner).
    """
    return False


async def manager_owned_agent_ids(
    session: AsyncSession, auth: AuthContext
) -> list[uuid.UUID]:
    """v1.3.1: 返回 caller 作为 Agent.primary_user_id 管理的所有 agent id (本 ws 内).

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


async def is_agent_owner(
    session: AsyncSession, auth: AuthContext, agent_id: uuid.UUID
) -> bool:
    """v1.3.1 核心 ABAC: caller 是否有权管理 这个 agent
    (改 agent 配置 / KB / 长期记忆 / 审批任务沉淀).

    True 条件 (任一即可):
      1. caller 是 workspace_manager (workspace_creator / leader) — 跨科室管
      2. caller 是 该 agent 的 primary_user_id (agent_owner 角色)

    注意: admin 不再 通过 这条 — admin 看 AI 不能改 (PM Q7.4 web 独占).
    system_owner 跨 ws 自动 通过 (经 is_workspace_manager fallback).

    旧 名 is_agent_manager 保留为 alias 避免老代码 break.
    """
    if await is_workspace_manager(session, auth):
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


# v1.3.1 兼容 alias — 老代码 全 走 is_agent_manager.
is_agent_manager = is_agent_owner


async def expert_bound_agent_id(
    session: AsyncSession, auth: AuthContext
) -> Optional[uuid.UUID]:
    """v1.3.1: DEPRECATED — 永远 返 None (老 expert 已 migrate, bound_agent_id 字段
    保留但不再使用). 老 caller 调用 不影响 — return None 让 caller 走 "no scope limit"
    分支 (跟 普通用户 一样).

    Agent.primary_user_id 反向查 才是 v1.3.1 的 推荐路径.
    """
    return None


# ============================================================================
# v26.5-02 P1 · KB-scoped helpers (基于 KnowledgeBase.owner_agent_id)
# ============================================================================

async def can_write_kb(
    session: AsyncSession, auth: AuthContext, kb_id: uuid.UUID
) -> bool:
    """v1.3.1: 这个 caller 是否有权改 这个 KB 的内容
    (上传文档 / 删文档 / reprocess).

    True 条件 (任一即可):
      1. caller 是 workspace_manager (workspace_creator / leader / system_owner) → 全权
      2. KB.owner_agent_id 指向某 agent A, 且 caller 是 A.primary_user_id
         → 该 agent_owner 负责 A, 可以管理 A 的 KB
      3. KB.owner_agent_id 为 NULL → 退到 ws_manager-only (1)

    workspace 隔离: KB 必须属于 caller 的 workspace.
    注意 v1.3.1: admin 不再 通过 — admin 不改 AI / KB / memory (PM Q7.4).
    """
    if await is_workspace_manager(session, auth):
        return True
    from .models import KnowledgeBase
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
        return False  # 无 owner agent 的 KB 仅 workspace_manager 可写
    # KB 归属某 agent → 该 agent 的 primary_user (agent_owner) 可写
    return await is_agent_owner(session, auth, kb.owner_agent_id)


async def require_kb_writer(
    session: AsyncSession, auth: AuthContext, kb_id: uuid.UUID
) -> None:
    """v1.3.1: 写 KB 内容 (上传/删/reprocess 文档) 的 ABAC 守卫."""
    if not await can_write_kb(session, auth, kb_id):
        raise HTTPException(
            403,
            "[权限不足] 写此 KB 需要 workspace_creator / leader,"
            "或该 KB 归属 AI 的 agent_owner (primary_user)"
        )


# ============================================================================
# v26.5-Lineage · Memory ABAC (多对多 — 任一 primary AI 的 primary_user 可写)
# ============================================================================

async def can_write_memory(
    session: AsyncSession, auth: AuthContext, memory_id: uuid.UUID
) -> bool:
    """v1.3.1: 这个 caller 是否有权改/删 这条 memory.

    True 条件 (任一即可):
      1. caller 是 workspace_manager (workspace_creator / leader / system_owner) → 全权
      2. memory 通过 memory_agent_link is_primary=TRUE 挂在 agent A,
         且 caller 是 A.primary_user_id (agent_owner) → 该 agent_owner 是 memory 的 "主人"
      3. 老数据 long_term_memory.agent_id (deprecated) 指向 agent A,
         且 caller 是 A.primary_user_id → 老兼容路径
      4. memory 没有任何 primary agent (agent_id=NULL 且 无 link)
         → 退到 ws_manager-only (仅 1 通过)

    workspace 隔离: memory 必须属于 caller 的 workspace.
    注意 v1.3.1: admin 不再 通过 — admin 不改 AI / KB / memory (PM Q7.4).
    """
    if await is_workspace_manager(session, auth):
        return True
    from .models import Agent, LongTermMemory, MemoryAgentLink
    m = (
        await session.execute(
            select(LongTermMemory).where(
                LongTermMemory.id == memory_id,
                LongTermMemory.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if m is None:
        return False
    # 1) 走 memory_agent_link is_primary=TRUE
    primary_agents = (
        await session.execute(
            select(MemoryAgentLink.agent_id).where(
                MemoryAgentLink.memory_id == m.id,
                MemoryAgentLink.is_primary.is_(True),
            )
        )
    ).all()
    primary_agent_ids = {r[0] for r in primary_agents}
    # 2) 老 兼容: agent_id 字段
    if m.agent_id:
        primary_agent_ids.add(m.agent_id)
    if not primary_agent_ids:
        return False
    # 任一 primary agent 的 primary_user (agent_owner) 是 caller → 可写
    rows = (
        await session.execute(
            select(Agent.primary_user_id).where(Agent.id.in_(primary_agent_ids))
        )
    ).all()
    return auth.user.id in {r[0] for r in rows if r[0]}


async def require_memory_writer(
    session: AsyncSession, auth: AuthContext, memory_id: uuid.UUID
) -> None:
    """v1.3.1: 写 memory (改/删) 的 ABAC 守卫."""
    if not await can_write_memory(session, auth, memory_id):
        raise HTTPException(
            403,
            "[权限不足] 改 / 删此 memory 需要 workspace_creator / leader,"
            "或该 memory 主 AI 的 agent_owner (primary_user)"
        )


# ============================================================================
# v1.3.1 · system_owner (跨 workspace 的 SaaS 平台层超管, 旧 platform_admin)
# ============================================================================
# v1.3.1 命名收敛: platform_admin → system_owner (PM 心智 "owner = 系统拥有者").
# 但实现 保留 env 白名单 (PLATFORM_ADMIN_EMAILS) 不动 —— 这是 PM 决策 1 的实施细节:
#   - 最小 schema 改动 (零 migration)
#   - 不让业务后台 SQL 误改超管列表 (env var 改完必重启容器,运维 trace 清晰)
#   - 后续要加 UI 管理超管时再升级到 system_owner 表
#
# 旧 helper 名 (is_platform_admin / require_platform_admin) 保留为 alias
# 避免老代码 break. 新 helper 名 is_system_owner / require_system_owner.
#
# 安全:
#   - 后端任何 /api/super/* 端点 必须 先调 require_system_owner
#   - 前端 /super 路由 + middleware 二次校验 me.email 在白名单
#   - 所有 system_owner 操作 audit 时 payload 加 {"system_owner": true}
#     方便客户日后查 "今天 system_owner 在我空间做了什么"


def is_platform_admin_email(email: Optional[str]) -> bool:
    """email 是否在 env PLATFORM_ADMIN_EMAILS 白名单 (case-insensitive).

    v1.3.1 概念上 这是 "system_owner" 的判定, env var 名保留兼容."""
    if not email:
        return False
    from .config import get_settings
    return email.lower().strip() in get_settings().platform_admin_emails_set


def is_system_owner(auth: AuthContext) -> bool:
    """v1.3.1: 当前 user 是否是 system_owner (跨 ws 最高权).

    基于 user.email 跟 env PLATFORM_ADMIN_EMAILS 白名单 比对."""
    return is_platform_admin_email(auth.user.email)


# v1.3.1 兼容 alias — 老代码 全 走 is_platform_admin.
is_platform_admin = is_system_owner


async def require_system_owner(auth: AuthContext) -> None:
    """v1.3.1: Raise 403 if caller 不是 system_owner. 每个 /api/super/* 端点 必填.
    不需要 session 因为校验只看 env + auth.user.email,无 DB query."""
    if not is_system_owner(auth):
        raise HTTPException(
            403,
            "[权限不足] 此功能仅 system_owner 可见 "
            "(您的 email 不在 PLATFORM_ADMIN_EMAILS 白名单)"
        )


# v1.3.1 兼容 alias — 老代码 全 走 require_platform_admin.
require_platform_admin = require_system_owner
