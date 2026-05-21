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
from sqlalchemy import case, func, select
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
    Agent,
    KbSedimentationDraft,
    KnowledgeBase,
    MemoryDraft,
    PasswordResetToken,
    Task,
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


# v27.0-mobile P21 原生 C-1: 小程序原生 / 移动 App token-based 鉴权出参.
# 跟 /login 走 cookie 不一样, /token 把 JWT 在 body 直接返, 客户端持有 + 调用时
# 自带 Authorization: Bearer <token> header.
class TokenIssueOut(BaseModel):
    token: str
    token_type: str = "Bearer"
    expires_at: datetime  # token 到期时间 (UTC), 客户端用来判断要不要 refresh
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    role: str  # 基本角色, 详细 me 信息调 /api/auth/me


class MyAgentBrief(BaseModel):
    """v26.5-Profile: 简版 agent 信息, 供 /me 接口 返回我维护的 AI 列表."""
    id: uuid.UUID
    name: str
    color: Optional[str] = None
    domain: Optional[str] = None
    kb_count: int = 0
    is_active: bool = True


class MyTaskCounts(BaseModel):
    """v26.5-Profile: 任务速览 — 我的任务在各状态的数量."""
    pending: int = 0    # 待签收 (dispatched)
    working: int = 0    # 办理中 (accepted + in_progress)
    review: int = 0     # 待审核 (submitted)
    # v26.5-02c: 我作为 primary_user 待审批 的 KB 沉淀数 (个人中心徽章用)
    kb_sedimentation_pending: int = 0
    # v26.5-Lineage: 待我审批的 Memory 草稿数
    memory_draft_pending: int = 0


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: uuid.UUID
    name: str
    email: Optional[str] = None
    workspace_id: uuid.UUID
    workspace_name: str
    workspace_slug: str
    role: str
    # v26.5-Profile: 扩展身份信息 (个人中心 / 顶栏 用)
    # 老 client 兼容 — 这些字段都 Optional, 不传也能用
    department: Optional[str] = None
    primary_agents: list[MyAgentBrief] = []  # 我作为 primary_user 的 AI 列表
    bound_agent_id: Optional[uuid.UUID] = None  # v21 expert 兼容
    task_counts: Optional[MyTaskCounts] = None


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
        raise HTTPException(403, "[需重新登录] 账号没有关联工作空间,请联系管理员")

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
        raise HTTPException(403, "[需重新登录] 账号已被禁用,请联系管理员")

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


# ============================================================================
# v27.0-mobile P21 原生 C-1: token-based 鉴权 (Bearer header)
# ============================================================================
# 给小程序原生 / 移动 App 用. 跟 /login 走 cookie 的区别:
#   /login    → set-cookie httpOnly + body 返 MeOut         (H5 浏览器, 14 天)
#   /token    → 不 set cookie, body 直接返 JWT + 元数据      (原生客户端, 30 天)
#   /token/refresh → 已认证用户延期, 客户端定期主动刷         (距过期 < 7 天时)
#
# get_current_auth 同时支持 cookie 和 Authorization: Bearer header (auth.py L109-112),
# 所以新增 token endpoint 后, 所有 protected endpoint 自动兼容, 不必逐个改.

NATIVE_TOKEN_TTL_DAYS = 30


async def _authenticate_user(
    session: AsyncSession, email: str, password: str
) -> tuple[User, Workspace, Optional[WorkspaceMembership]]:
    """复用的鉴权 helper — 从邮箱 + 密码 拉 user / workspace / membership.

    抽出来让 /login (cookie 路径) 和 /token (Bearer 路径) 共用. raise 401/403 同 /login.
    """
    user = (
        await session.execute(
            select(User).where(func.lower(User.email) == email.lower())
        )
    ).scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(401, "incorrect email or password")
    if not verify_password(password, user.password_hash):
        raise HTTPException(401, "incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "[需重新登录] 账号已被禁用,请联系管理员")

    ws_id = user.workspace_id
    if not ws_id:
        # auto-self-heal: 跟 /login 一致, 没 workspace 的用户自动建一个
        ws = Workspace(name=f"{user.name} 的工作空间", slug=f"u-{user.id.hex[:8]}")
        session.add(ws)
        await session.flush()
        user.workspace_id = ws.id
        session.add(
            WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner")
        )
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
    return user, ws, membership


@router.post("/token", response_model=TokenIssueOut)
async def issue_native_token(
    payload: LoginIn,
    session: AsyncSession = Depends(get_session),
):
    """v27.0-mobile P21 原生 C-1: 邮箱 + 密码换 30 天 JWT, 给原生客户端用.

    客户端拿到 token 后:
    - 持久化到 wx.setStorage / iOS Keychain / Android EncryptedSharedPreferences
    - 后续所有 HTTP 调用加 Authorization: Bearer <token> header
    - WebSocket 走 wx.connectSocket({ url, header: { Authorization: 'Bearer xxx' } })
    - 距 expires_at < 7 天 时调 POST /api/auth/token/refresh 续期

    跟 /login 不设 cookie, 互不影响.
    """
    user, ws, membership = await _authenticate_user(
        session, payload.email, payload.password
    )
    token = issue_token(user.id, ws.id, ttl_days=NATIVE_TOKEN_TTL_DAYS)
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return TokenIssueOut(
        token=token,
        token_type="Bearer",
        expires_at=expires_at,
        user_id=user.id,
        workspace_id=ws.id,
        role=membership.role if membership else "member",
    )


@router.post("/exchange-token", response_model=TokenIssueOut)
async def exchange_cookie_for_token(
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """v27.0-mobile P21 原生 C-1 / N-1 第 6 刀: 用 cookie 换 token.

    场景: 用户在 H5 webview (小程序内) 已经 cookie 登录, 想跳到小程序原生页,
    但原生页不能读 webview cookie. 此 endpoint 接受 cookie 鉴权 (不验密码),
    签发一个 30 天 token, H5 端拿到后通过 wx.miniProgram.navigateTo 把 token
    放 query 传给原生页, 原生页 onLoad 写 storage.

    跟 /api/auth/token (邮密换) + /api/auth/token/refresh (Bearer 延期) 的区别:
      - /token         需邮密, 给原生客户端首次登录用
      - /token/refresh 需 Bearer, 给已有 token 客户端续期用
      - /exchange-token 需 cookie, 给 H5 → 原生 桥接 用 (本 endpoint)

    实际三个 endpoint 共用 issue_token, 只是触发条件不同.
    """
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()

    new_token = issue_token(
        auth.user.id, auth.workspace.id, ttl_days=NATIVE_TOKEN_TTL_DAYS
    )
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return TokenIssueOut(
        token=new_token,
        token_type="Bearer",
        expires_at=expires_at,
        user_id=auth.user.id,
        workspace_id=auth.workspace.id,
        role=membership.role if membership else "member",
    )


@router.post("/token/refresh", response_model=TokenIssueOut)
async def refresh_native_token(
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """v27.0-mobile P21 原生 C-1: 当前 token 还有效时, 换新的 30 天 token.

    走 get_current_auth — 现有 token 必须能验签 (没过期 + 合法). 不验密码, 复用 session.
    客户端拿到新 token 后丢掉旧的, 不必再走 /token 邮箱密码.

    安全:
    - 旧 token 不显式作废 (JWT 是 stateless, 作废要建 revocation list, mvp 不做)
    - 但旧 token 自然 expire (≤ 14 天剩余生命周期), 风险可控
    """
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()

    new_token = issue_token(
        auth.user.id, auth.workspace.id, ttl_days=NATIVE_TOKEN_TTL_DAYS
    )
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return TokenIssueOut(
        token=new_token,
        token_type="Bearer",
        expires_at=expires_at,
        user_id=auth.user.id,
        workspace_id=auth.workspace.id,
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

    # v26.5-Profile: 拉 我维护的 AI 列表 (primary_agents) + 任务速览.
    # 这两块给 个人中心 + 顶栏 用. 没有 N+1 — 单次查 (Agent + KB-count subquery).
    from sqlalchemy import and_
    agents_rows = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == auth.workspace.id,
                Agent.primary_user_id == auth.user.id,
            ).order_by(Agent.created_at.desc())
        )
    ).scalars().all()
    primary_agents: list[MyAgentBrief] = []
    for a in agents_rows:
        kb_ids = a.knowledge_base_ids or []
        primary_agents.append(MyAgentBrief(
            id=a.id,
            name=a.name,
            color=a.color,
            domain=a.domain,
            kb_count=len(kb_ids),
            is_active=a.is_active,
        ))

    # 任务速览 — 我作为 assignee 的 task 数 (各状态)
    # v26.13.2-perf: 3 个 count 合 1 个 SQL (CASE WHEN aggregation), 减 2 个 roundtrip
    task_row = (
        await session.execute(
            select(
                func.sum(case((Task.status == "dispatched", 1), else_=0)).label("pending"),
                func.sum(
                    case((Task.status.in_(["accepted", "in_progress"]), 1), else_=0)
                ).label("working"),
                func.sum(case((Task.status == "submitted", 1), else_=0)).label("review"),
            ).where(
                Task.workspace_id == auth.workspace.id,
                Task.assignee_user_id == auth.user.id,
            )
        )
    ).one()
    pending_cnt = int(task_row.pending or 0)
    working_cnt = int(task_row.working or 0)
    review_cnt = int(task_row.review or 0)
    # v26.5-02c: 我作为 primary_user 的待审批 KB 沉淀数
    kb_sed_pending = (
        await session.execute(
            select(func.count(KbSedimentationDraft.id)).where(
                KbSedimentationDraft.workspace_id == auth.workspace.id,
                KbSedimentationDraft.primary_user_id == auth.user.id,
                KbSedimentationDraft.status == "pending",
            )
        )
    ).scalar_one() or 0
    # v26.5-Lineage: 待我审批的 Memory 草稿数
    mem_draft_pending = (
        await session.execute(
            select(func.count(MemoryDraft.id)).where(
                MemoryDraft.workspace_id == auth.workspace.id,
                MemoryDraft.primary_user_id == auth.user.id,
                MemoryDraft.status == "pending",
            )
        )
    ).scalar_one() or 0
    task_counts = MyTaskCounts(
        pending=int(pending_cnt),
        working=int(working_cnt),
        review=int(review_cnt),
        kb_sedimentation_pending=int(kb_sed_pending),
        memory_draft_pending=int(mem_draft_pending),
    )

    # v26.5-Profile: department fallback —
    # 1. user.department 显式填了 → 用它
    # 2. 否则 拼 primary_agents 的 domain (例: "房屋安全 / 物业")
    # 3. 都没有 → None
    department = auth.user.department
    if not department and primary_agents:
        domains = [a.domain for a in primary_agents if a.domain]
        if domains:
            department = " / ".join(domains)

    # v21 兼容: bound_agent_id (老 expert 角色的绑定 agent)
    bound_agent_id = membership.bound_agent_id if membership else None

    return MeOut(
        user_id=auth.user.id,
        name=auth.user.name,
        email=auth.user.email,
        workspace_id=auth.workspace.id,
        workspace_name=auth.workspace.name,
        workspace_slug=auth.workspace.slug,
        role=effective_role,
        department=department,
        primary_agents=primary_agents,
        bound_agent_id=bound_agent_id,
        task_counts=task_counts,
    )


class UpdateMeIn(BaseModel):
    """v26.5-Profile: PATCH /api/auth/me — 个人中心 自助 改名."""
    name: Optional[str] = None


@router.patch("/me", response_model=MeOut)
async def update_me(
    payload: UpdateMeIn,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """v26.5-Profile: 自助 改名 (不改邮箱/角色/科室 — 那些 owner 才能改)."""
    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(400, "name 不能为空")
        if len(new_name) > 128:
            raise HTTPException(400, "name 太长 (max 128)")
        auth.user.name = new_name
        await session.commit()
        await session.refresh(auth.user)
    # 复用 me() 逻辑 重新查 + 返回 (保证字段一致)
    return await me(auth=auth, session=session)


class ChangePasswordIn(BaseModel):
    """v26.5-Profile: 自助改密码 — 需要旧密码验证."""
    old_password: str
    new_password: str


@router.post("/me/change-password")
async def change_password(
    payload: ChangePasswordIn,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """v26.5-Profile: 自助改密码 — 需要旧密码验证, 防止 cookie 被偷后改密."""
    if not auth.user.password_hash:
        raise HTTPException(400, "账号没有密码 (可能是声纹注册用户), 请联系管理员")
    if not verify_password(payload.old_password, auth.user.password_hash):
        raise HTTPException(403, "[权限不足] 旧密码错误")
    if len(payload.new_password) < 6:
        raise HTTPException(400, "新密码太短 (min 6)")
    if payload.new_password == payload.old_password:
        raise HTTPException(400, "新密码与旧密码相同")
    auth.user.password_hash = hash_password(payload.new_password)
    await session.commit()
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}
