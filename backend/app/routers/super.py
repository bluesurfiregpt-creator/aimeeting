"""
v26.4 · Platform Admin (跨 workspace 的 SaaS 平台层超管) 路由.

# 设计 (per v26.4 spec Q1-Q5)
- Q1=C: 超管身份 由 env PLATFORM_ADMIN_EMAILS 配,不入库
- Q2: 所有端点 require_platform_admin guard + audit_log 自动标 platform_admin=true
- Q3=C: 切换 workspace = 重发 JWT 把 wsid 指到新空间 + set cookie + audit "via superadmin"
- Q4: 列表 含 user/agent/meeting 计数 + last_active_at + status
- Q5: 本期做 read + write-light (创建 workspace + 邀请 owner);write-heavy (suspend/delete) 留 v26.5

# 路由
GET  /api/super/workspaces          列出所有 workspace (跨租户)
POST /api/super/workspaces          创建新 workspace + owner user + 一次性邀请
POST /api/super/switch/{ws_id}      切换 session 到目标 workspace (重发 JWT)

# 安全
- 三个端点 第一行 都是 await require_platform_admin(auth)
- 所有 写操作 都过 audit_log,因 payload 自动 加 platform_admin=true (audit.py)
- 创建 workspace 时 audit 写到 新 workspace (workspace_id = 新建的 id),客户日后查
  自己 workspace 的 audit 时 能看到 "今天 platform admin 创建了这个空间"
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import (
    AuthContext,
    get_current_auth,
    hash_password,
    issue_token,
    require_platform_admin,
    set_session_cookie,
)
from ..db import get_session
from ..models import (
    Agent,
    Meeting,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)
from .auth import _slugify  # 复用 register endpoint 同款 slug 算法


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/super", tags=["platform-admin"])


# ============================================================================
# v26.4-03 · GET /api/super/workspaces  (跨租户 workspace 列表)
# ============================================================================


class SuperWorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str
    preset_name: Optional[str] = None  # smart_construction / general / null
    created_at: datetime
    last_active_at: Optional[datetime] = None
    user_count: int = 0
    agent_count: int = 0
    meeting_count: int = 0


@router.get("/workspaces", response_model=list[SuperWorkspaceOut])
async def list_all_workspaces(
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """列出 所有 workspace (跨租户) 含 关键统计字段.

    include_archived=False 默认隐藏 status='archived' 的(软删后清单乱).
    """
    await require_platform_admin(auth)

    # 主查询:每个 workspace + 三个 count subquery
    user_count_sq = (
        select(WorkspaceMembership.workspace_id, func.count().label("c"))
        .group_by(WorkspaceMembership.workspace_id)
        .subquery()
    )
    agent_count_sq = (
        select(Agent.workspace_id, func.count().label("c"))
        .group_by(Agent.workspace_id)
        .subquery()
    )
    meeting_count_sq = (
        select(Meeting.workspace_id, func.count().label("c"))
        .group_by(Meeting.workspace_id)
        .subquery()
    )

    stmt = (
        select(
            Workspace,
            func.coalesce(user_count_sq.c.c, 0).label("user_count"),
            func.coalesce(agent_count_sq.c.c, 0).label("agent_count"),
            func.coalesce(meeting_count_sq.c.c, 0).label("meeting_count"),
        )
        .outerjoin(user_count_sq, Workspace.id == user_count_sq.c.workspace_id)
        .outerjoin(agent_count_sq, Workspace.id == agent_count_sq.c.workspace_id)
        .outerjoin(meeting_count_sq, Workspace.id == meeting_count_sq.c.workspace_id)
    )
    if not include_archived:
        stmt = stmt.where(Workspace.status != "archived")
    stmt = stmt.order_by(Workspace.created_at.desc())

    rows = (await session.execute(stmt)).all()

    out: list[SuperWorkspaceOut] = []
    for ws, uc, ac, mc in rows:
        preset_name = None
        if isinstance(ws.preset, dict):
            preset_name = ws.preset.get("name") or ws.preset.get("type")
        out.append(
            SuperWorkspaceOut(
                id=ws.id,
                name=ws.name,
                slug=ws.slug,
                status=ws.status or "active",
                preset_name=preset_name,
                created_at=ws.created_at,
                last_active_at=ws.last_active_at,
                user_count=int(uc),
                agent_count=int(ac),
                meeting_count=int(mc),
            )
        )
    return out


# ============================================================================
# v26.4-04 · POST /api/super/workspaces  (创建 workspace + owner + 邀请)
# ============================================================================


class CreateWorkspaceIn(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    owner_email: EmailStr
    owner_name: str = Field(min_length=1, max_length=64)
    # 临时密码:如果填,直接创建账号 + 设这个密码;留空则生成 32 字符随机密码并返回
    temp_password: Optional[str] = None
    # 是否要 seed demo 数据 (跑 demo_seed.seed_demo_scenario)
    seed_demo: bool = False
    # 是否 创建 一次性 邀请链接(改密码用)
    create_invite: bool = True


class CreateWorkspaceOut(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    workspace_slug: str
    owner_user_id: uuid.UUID
    owner_email: str
    temp_password: Optional[str] = None  # 若 caller 没填,这里返回生成的随机密码
    invite_url: Optional[str] = None  # 一次性邀请链接 (7 天有效)


@router.post("/workspaces", response_model=CreateWorkspaceOut)
async def create_workspace(
    payload: CreateWorkspaceIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """创建一个 新 workspace + 新 owner user + 可选 一次性邀请链接.

    用法 (你 给新客户开 workspace):
      1. /super/workspaces ➕ 新建 表单 填 name + owner_email + owner_name
      2. backend 创建 Workspace + User (role=owner) + (可选) WorkspaceInvitation
      3. 返回 一次性 invite_url,你 复制 微信发给客户 → 客户用该链接走 /register 改密码
    """
    await require_platform_admin(auth)

    # 1) email 唯一性 — 这里是 全局唯一(同 register endpoint)
    existing = (
        await session.execute(
            select(User).where(func.lower(User.email) == payload.owner_email.lower())
        )
    ).scalar_one_or_none()
    if existing and existing.password_hash:
        raise HTTPException(409, f"email {payload.owner_email} 已被注册 (在其他 workspace)")

    # 2) slug 唯一(同 register endpoint 逻辑)
    base_slug = _slugify(payload.name)
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

    ws = Workspace(name=payload.name, slug=slug, status="active")
    session.add(ws)
    await session.flush()

    # 3) 临时密码
    temp_password = payload.temp_password or secrets.token_urlsafe(24)

    # 4) 创建 / 升级 User
    if existing:
        # speaker-stub 升级 (邮箱存在但没密码 — eg 声纹注册过)
        existing.email = payload.owner_email
        existing.password_hash = hash_password(temp_password)
        existing.workspace_id = ws.id
        existing.name = payload.owner_name
        user = existing
    else:
        user = User(
            name=payload.owner_name,
            email=payload.owner_email,
            password_hash=hash_password(temp_password),
            workspace_id=ws.id,
            last_login_at=None,
        )
        session.add(user)
        await session.flush()

    # 5) Membership: v1.3.1 workspace_creator role (旧 'owner', system_owner 建 ws 给指定 user)
    membership = WorkspaceMembership(
        workspace_id=ws.id, user_id=user.id, role="workspace_creator",
    )
    session.add(membership)

    # 6) 可选 邀请链接 (7 天有效) — 邀请角色 workspace_creator (老 'owner')
    invite_url: Optional[str] = None
    if payload.create_invite:
        invite_token = secrets.token_urlsafe(32)
        invite = WorkspaceInvitation(
            workspace_id=ws.id,
            email=payload.owner_email,
            role="workspace_creator",
            token=invite_token,
            created_by_user_id=auth.user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        session.add(invite)
        # 生成前端可点的链接 (前端 /register?invite=<token> 走 join 流程)
        invite_url = f"/register?invite={invite_token}"

    await session.commit()
    await session.refresh(ws)
    await session.refresh(user)

    # 7) audit (会自动标 platform_admin=true · payload 走 audit_log helper)
    # 注:这里 audit 写到 新建的 workspace,所以客户 日后 进自己空间 看 audit 能看到
    # 自己空间是怎么被开出来的.但 audit_log 用 auth.workspace.id — 它仍是 caller
    # 的原 workspace.绕个弯:直接 system_audit_log 写到 ws.id.
    from ..audit import system_audit_log
    await system_audit_log(
        session, ws.id, "workspace.create",
        target_type="workspace", target_id=str(ws.id),
        payload={
            "platform_admin": True,
            "platform_admin_email": auth.user.email,
            "name": ws.name,
            "owner_email": payload.owner_email,
            "seed_demo": payload.seed_demo,
        },
    )

    # 8) (可选) seed demo
    if payload.seed_demo:
        try:
            from ..demo_seed import seed_demo_scenario
            await seed_demo_scenario(
                session, workspace_id=ws.id, caller_user_id=user.id,
            )
        except Exception as e:
            logger.exception("seed_demo on new workspace %s failed", ws.id)
            # 不阻塞创建 — workspace 已经能用,demo 数据失败 算可选
            raise HTTPException(
                500,
                f"workspace 创建成功 (id={ws.id}),但 demo seed 失败:{e}. "
                "你 可以 切换进 该 workspace 后 手动点 /admin/demo-data 重新 seed.",
            )

    return CreateWorkspaceOut(
        workspace_id=ws.id,
        workspace_name=ws.name,
        workspace_slug=ws.slug,
        owner_user_id=user.id,
        owner_email=payload.owner_email,
        # 只有 caller 没填 temp_password 时,才把生成的随机密码返回给 caller
        # (避免 把 caller 主动填的密码 echo 回去多余 — 但也无害)
        temp_password=None if payload.temp_password else temp_password,
        invite_url=invite_url,
    )


# ============================================================================
# v26.4-05 · POST /api/super/switch/{ws_id}  (切换 session 到目标 workspace)
# ============================================================================


class SwitchWorkspaceOut(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    workspace_slug: str
    note: str = "session 已切换 — 后续 所有 /api/* 调用 自动用 新 workspace"


@router.post("/switch/{ws_id}", response_model=SwitchWorkspaceOut)
async def switch_workspace(
    ws_id: str,
    response: Response,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """切换当前 session 的 workspace 到目标 ws_id.

    实现:重新签 JWT 把 wsid 改成 ws_id + set-cookie 覆盖.客户端浏览器后续 任何
    /api/* 调用,都会带新 cookie → 走新 workspace 隔离.

    切回原来的 workspace:再调一次 /switch/<original_ws_id>.

    注:platform admin 切到客户 workspace 时,在客户视角 audit 里看到的是 super
    admin 的 user_id (跨 workspace 共享 user 表).audit_log 会自动给 payload
    打 platform_admin=true 标签让客户日后能追溯.
    """
    await require_platform_admin(auth)

    try:
        target_ws_uuid = uuid.UUID(ws_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "invalid ws_id format")

    target_ws = (
        await session.execute(select(Workspace).where(Workspace.id == target_ws_uuid))
    ).scalar_one_or_none()
    if target_ws is None:
        raise HTTPException(404, "workspace not found")

    # 重发 JWT (auth.user 不变,wsid 改成新 workspace)
    new_token = issue_token(auth.user.id, target_ws.id)
    set_session_cookie(response, new_token)

    # audit — 写到目标 workspace (让客户能看到 super admin 来访问过).
    from ..audit import system_audit_log
    await system_audit_log(
        session, target_ws.id, "workspace.switch_in",
        target_type="workspace", target_id=str(target_ws.id),
        payload={
            "platform_admin": True,
            "platform_admin_email": auth.user.email,
            "from_workspace_id": str(auth.workspace.id),
        },
    )

    return SwitchWorkspaceOut(
        workspace_id=target_ws.id,
        workspace_name=target_ws.name,
        workspace_slug=target_ws.slug,
    )


# ============================================================================
# 辅助:GET /api/super/me  快速判断当前 user 是否平台超管 (前端 /super 页加载用)
# ============================================================================


class SuperMeOut(BaseModel):
    is_platform_admin: bool
    email: Optional[str] = None
    platform_admin_emails_count: int = 0  # 配置里有几个超管邮箱 (debug 用)


@router.get("/me", response_model=SuperMeOut)
async def super_me(
    auth: AuthContext = Depends(get_current_auth),
):
    """前端 /super 页加载时调一下 — 不是超管就 200 + is_platform_admin=false,
    超管就 true.比起调 list_workspaces 抛 403 更友好."""
    from ..auth import is_platform_admin
    from ..config import get_settings
    return SuperMeOut(
        is_platform_admin=is_platform_admin(auth),
        email=auth.user.email,
        platform_admin_emails_count=len(get_settings().platform_admin_emails_set),
    )
