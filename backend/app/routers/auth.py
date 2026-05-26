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


# v27.2 手机号 / 邮箱 都可作为登录账号. 中国手机号: 11 位, 1 开头.
# 允许 "+86" / "86" / 空格 / 横线 等等 用户随手输入, normalize 之后只留数字 11 位.
_PHONE_RE = re.compile(r"^1\d{10}$")
_PHONE_CLEAN_RE = re.compile(r"[\s\-]")  # 抽掉 空白 + 横线


def _normalize_phone(raw: str) -> Optional[str]:
    """把用户输入归一到 11 位 CN 手机号. 不是 CN 手机号 → 返 None.

    接受 形式: "13812345678" / "+86 138-1234-5678" / "86 13812345678"
    """
    s = _PHONE_CLEAN_RE.sub("", raw or "").strip()
    if s.startswith("+86"):
        s = s[3:]
    elif s.startswith("86") and len(s) == 13:
        s = s[2:]
    return s if _PHONE_RE.match(s) else None


def _looks_like_email(s: str) -> bool:
    """粗判 — 真正合法 由 EmailStr / 上游 EmailValidator 决定."""
    return "@" in (s or "")


class RegisterIn(BaseModel):
    # v27.2: email 或 phone 必须 至少 给 一个 (现在 phone 也算 注册账号).
    # 老 client 只 传 email — 仍然 work.
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    password: str
    name: str
    workspace_name: Optional[str] = None  # if omitted, use "<name> 的工作空间"
    invite_token: Optional[str] = None    # if set, join the workspace from the invite


class LoginIn(BaseModel):
    # v27.2 三种入参 任 一 即可 (优先级 account > email > phone):
    #   account — 通用入口, 服务端 自动 识别 email / phone (推荐 新 client 用)
    #   email   — 老 client 兼容
    #   phone   — 显式 手机号 (老 client 不会用, 但 留 hook)
    account: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
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

    # v27.2: email 或 phone 至少 一个; 都没 就 没法 后续 找回 / 二次登录.
    if not payload.email and not payload.phone:
        raise HTTPException(400, "请提供邮箱或手机号")

    # phone 格式 check + normalize (存 11 位 无 +86)
    normalized_phone: Optional[str] = None
    if payload.phone:
        normalized_phone = _normalize_phone(payload.phone)
        if not normalized_phone:
            raise HTTPException(400, "手机号格式不正确 (需 11 位 CN 手机号)")

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

    # 同 email / phone 唯一性 校验 — 任 一 已 注册 (含 password) 就 拒.
    existing: Optional[User] = None
    if payload.email:
        existing = (
            await session.execute(
                select(User).where(func.lower(User.email) == payload.email.lower())
            )
        ).scalar_one_or_none()
        if existing and existing.password_hash:
            raise HTTPException(409, "邮箱已被注册")
    if normalized_phone and not existing:
        existing = (
            await session.execute(
                select(User).where(User.phone == normalized_phone)
            )
        ).scalar_one_or_none()
        if existing and existing.password_hash:
            raise HTTPException(409, "手机号已被注册")

    if invite is not None:
        # Join the inviting workspace
        ws = (
            await session.execute(
                select(Workspace).where(Workspace.id == invite.workspace_id)
            )
        ).scalar_one()
        role = invite.role
    else:
        # v1.3.1 决策 4 (PM 拍板): 只 system_owner 可建新 workspace.
        #
        # 旧行为: 任何 register 不带 invite → 自动建新 ws + 当 owner. 这破坏了
        # PM 心智 ("owner = 系统拥有者最高权限, 跨 ws"). 改成:
        #   - email 在 PLATFORM_ADMIN_EMAILS 白名单 (system_owner) → 建新 ws + 当 workspace_creator
        #   - 否则 → 加入 demo workspace ('default' slug, init_db 自动 seed) 当 member.
        #     如果 demo ws 也没有 (异常情况) → 400.
        from ..auth import is_platform_admin_email
        if payload.email and is_platform_admin_email(payload.email):
            # system_owner 注册 — 允许 建新 ws + 当 workspace_creator
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
            role = "workspace_creator"
        else:
            # 普通用户注册 — 必须有 invite. 没 invite 退到 demo workspace.
            demo_ws = (
                await session.execute(
                    select(Workspace).where(Workspace.slug == "default")
                )
            ).scalar_one_or_none()
            if demo_ws is None:
                raise HTTPException(
                    403,
                    "[注册受限] 您需要受邀加入现有工作空间. 请联系工作空间管理员"
                    "获取邀请链接, 或联系平台运营."
                )
            ws = demo_ws
            role = "member"

    if existing:
        # Speaker-only stub (e.g. enrolled via /enroll without password); upgrade it.
        # v27.2: 任 一 字段 没值 时 自动 补 (existing 可能 只 有 phone, 注册 时 给 email).
        if payload.email and not existing.email:
            existing.email = payload.email
        if normalized_phone and not existing.phone:
            existing.phone = normalized_phone
        existing.password_hash = hash_password(payload.password)
        existing.workspace_id = ws.id
        existing.last_login_at = datetime.now(timezone.utc)
        existing.name = payload.name or existing.name
        user = existing
    else:
        user = User(
            name=payload.name,
            email=payload.email,
            phone=normalized_phone,
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
    """v27.2 接受 email 或 phone (字段名: account / email / phone 任一) + 密码.

    老 client 只 传 email — 走 兼容 路径; 新 client 推荐 用 account 字段 让 server
    自动 识别.
    """
    account = _extract_login_account(payload)
    user, ws, membership = await _authenticate_user(session, account, payload.password)
    # _authenticate_user 已 commit (last_login_at 更新). 这里 只 set cookie + 返 MeOut.
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


def _extract_login_account(payload: "LoginIn") -> str:
    """v27.2 从 LoginIn 抽出 用户输入的 "账号" — 优先 account, 退 email, 再 phone.

    全空 → 401 (跟 错密码 同 等级, 不泄露 哪个字段 错).
    """
    raw: Optional[str] = None
    if payload.account:
        raw = payload.account
    elif payload.email:
        raw = str(payload.email)
    elif payload.phone:
        raw = payload.phone
    if not raw:
        raise HTTPException(401, "incorrect account or password")
    return raw.strip()


async def _authenticate_user(
    session: AsyncSession, account: str, password: str
) -> tuple[User, Workspace, Optional[WorkspaceMembership]]:
    """复用 鉴权 helper — 账号 (邮箱或手机号) + 密码 → user / workspace / membership.

    v27.2 起 同一 helper 处理 email + phone:
      - account 含 '@' → 按 email 查 (case-insensitive)
      - account 是 11 位 CN 手机号 (经 _normalize_phone) → 按 phone 查
      - 都不像 → 401 (不泄露 是 格式 错 还是 查无此人)

    抽出来让 /login (cookie 路径) 和 /token (Bearer 路径) 共用. raise 401/403 同 /login.
    """
    user: Optional[User] = None
    if _looks_like_email(account):
        user = (
            await session.execute(
                select(User).where(func.lower(User.email) == account.lower())
            )
        ).scalar_one_or_none()
    else:
        phone = _normalize_phone(account)
        if phone:
            user = (
                await session.execute(
                    select(User).where(User.phone == phone)
                )
            ).scalar_one_or_none()
        # 既 不像 email 也 不像 phone → user 留 None → 走 下面 401

    if not user or not user.password_hash:
        raise HTTPException(401, "incorrect account or password")
    if not verify_password(password, user.password_hash):
        raise HTTPException(401, "incorrect account or password")
    if not user.is_active:
        raise HTTPException(403, "[需重新登录] 账号已被禁用,请联系管理员")

    ws_id = user.workspace_id
    if not ws_id:
        # v1.3.1 决策 4: auto-self-heal 不再 自动建新 ws.
        #   - system_owner (env 白名单) → 仍然 建新 ws + workspace_creator
        #   - 普通用户 → 加入 demo workspace 当 member
        ws_id = await _attach_user_to_default_ws(session, user)

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


async def _attach_user_to_default_ws(
    session: AsyncSession, user: User
) -> uuid.UUID:
    """v1.3.1 自助 attach 没 workspace 的 user 到一个 ws.

    - email 在 PLATFORM_ADMIN_EMAILS → 建新 ws + workspace_creator
    - 否则 → 加入 demo workspace (slug='default') 当 member
    - demo ws 不存在时, 兜底建一个个人 ws (保留 老 行为, 避免 用户卡死)

    返回 attach 上的 ws.id. 调用方需要 自己 commit.
    """
    from ..auth import is_platform_admin_email
    if user.email and is_platform_admin_email(user.email):
        ws = Workspace(name=f"{user.name} 的工作空间", slug=f"u-{user.id.hex[:8]}")
        session.add(ws)
        await session.flush()
        user.workspace_id = ws.id
        session.add(
            WorkspaceMembership(
                workspace_id=ws.id, user_id=user.id, role="workspace_creator"
            )
        )
        return ws.id
    # 普通用户 — 加入 demo ws
    demo_ws = (
        await session.execute(
            select(Workspace).where(Workspace.slug == "default")
        )
    ).scalar_one_or_none()
    if demo_ws is None:
        # 异常兜底: 老代码兼容路径 — 建个人 ws 当 workspace_creator.
        # 这条只在 prod demo ws 被误删 时触发, 不破坏 用户登录.
        ws = Workspace(name=f"{user.name} 的工作空间", slug=f"u-{user.id.hex[:8]}")
        session.add(ws)
        await session.flush()
        user.workspace_id = ws.id
        session.add(
            WorkspaceMembership(
                workspace_id=ws.id, user_id=user.id, role="workspace_creator"
            )
        )
        return ws.id
    user.workspace_id = demo_ws.id
    # 没 membership 才加 (重入 防 unique violation)
    existing = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == demo_ws.id,
                WorkspaceMembership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            WorkspaceMembership(
                workspace_id=demo_ws.id, user_id=user.id, role="member"
            )
        )
    return demo_ws.id


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

    v27.2: account / email / phone 任 一 + password.
    """
    account = _extract_login_account(payload)
    user, ws, membership = await _authenticate_user(
        session, account, payload.password
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


# ============================================================================
# v27.1 微信 OAuth (原生小程序一键登录)
# ============================================================================
#
# 流程:
#   - wx-login: 小程序 wx.login() → code → POST /api/auth/wx-login
#     * openid 命中 User → 发 30 天 token (跟 /api/auth/token 等价)
#     * 未命中  → 200 + {bound: false} 让 客户端 提示 用户 邮密 绑定一次
#   - wx-bind:  已 Bearer 登录 状态 下, 再 wx.login() 一次 拿 code → POST,
#     把 openid 写到 当前 User. 之后 wx-login 就能一键过.
#
# 安全:
#   - openid 不从 server → client 透出. 全程 code (5 min, 一次性) 由 wx 框架
#     生成 + 走 https + server 端 code2Session.
#   - openid unique partial index (init_db) — 同一 openid 不能 绑 两个 User.
#   - 缺 WX_APPID / WX_SECRET 时 endpoint 返 503, 不静默 fail.

class WxLoginIn(BaseModel):
    code: str  # wx.login() 拿到的 5-min 一次性 code


class WxBindIn(BaseModel):
    code: str


class WxPhoneLoginIn(BaseModel):
    """手机号一键登录 入参.

    code: getPhoneNumber 按钮 bindgetphonenumber 拿到的 5-min 一次性 code
    wx_login_code: (可选) 同时 fire 的 wx.login() code. 若 提供, 后端 顺手把
                   openid 也绑到 该 User, 之后 wx-login 可秒进.
    """
    code: str
    wx_login_code: Optional[str] = None


class WxLoginOut(BaseModel):
    """两种返回形态合并:
       - bound=true   → 跟 TokenIssueOut 一致, token / expires_at 等填齐
       - bound=false  → token 等都 None, 客户端切到 邮密 绑定 UI
    """
    bound: bool
    # 仅 bound=true 时 有值
    token: Optional[str] = None
    token_type: str = "Bearer"
    expires_at: Optional[datetime] = None
    user_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    role: Optional[str] = None


# v27.2 微信 access_token 缓存 (cgi-bin/token).
#
# 跟 code2Session 不同, access_token 是 平台级 凭证, 每 2h 过期, 全 mp 共享 (一天
# 2000 次 quota). 调 getuserphonenumber / 发 模板消息 / 等 需要它.
#
# 简单 in-process 缓存; 多 worker 部署 时 各 worker 各自缓存 — 每天 ~24 × worker
# 次刷新, 离 2000 quota 远着, 不上 redis.
import asyncio as _asyncio
import time as _time

_WX_ACCESS_TOKEN_LOCK = _asyncio.Lock()
_WX_ACCESS_TOKEN_CACHE = {"token": None, "expires_at": 0.0}


async def _wx_access_token() -> str:
    """拿 platform-level access_token. 缓存 ~2h, 过期前 60s 自动 refresh."""
    now = _time.time()
    cached = _WX_ACCESS_TOKEN_CACHE
    if cached["token"] and cached["expires_at"] > now + 60:
        return cached["token"]
    async with _WX_ACCESS_TOKEN_LOCK:
        # double-check after acquiring lock
        now = _time.time()
        cached = _WX_ACCESS_TOKEN_CACHE
        if cached["token"] and cached["expires_at"] > now + 60:
            return cached["token"]

        import httpx
        from ..config import get_settings
        s = get_settings()
        if not s.wx_appid or not s.wx_secret:
            raise HTTPException(503, "微信 OAuth 未配置 (服务端缺 WX_APPID / WX_SECRET)")
        params = {
            "grant_type": "client_credential",
            "appid": s.wx_appid,
            "secret": s.wx_secret,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as c:
                r = await c.get("https://api.weixin.qq.com/cgi-bin/token", params=params)
                data = r.json()
        except Exception as e:
            logger.exception("wx access_token network failure")
            raise HTTPException(502, f"获取微信 access_token 失败: {e}")
        if data.get("errcode"):
            logger.warning(
                "wx access_token errcode=%s errmsg=%s",
                data.get("errcode"), data.get("errmsg"),
            )
            raise HTTPException(
                502,
                f"获取微信 access_token 失败: {data.get('errmsg')} (errcode {data.get('errcode')})",
            )
        token = data.get("access_token")
        expires_in = int(data.get("expires_in") or 7200)
        if not token:
            raise HTTPException(502, "微信 API 响应缺 access_token")
        _WX_ACCESS_TOKEN_CACHE["token"] = token
        _WX_ACCESS_TOKEN_CACHE["expires_at"] = now + expires_in
        return token


async def _phone_code_to_phone(code: str) -> str:
    """调微信 getuserphonenumber 拿 用户的 微信注册手机号. 返 11 位 (无 +86).

    raise:
      - 503 WX OAuth 未配置
      - 400 phone code 无效 / 已过期
      - 502 微信 API 异常 / 解析失败
    """
    import httpx
    access_token = await _wx_access_token()
    url = (
        "https://api.weixin.qq.com/wxa/business/getuserphonenumber"
        f"?access_token={access_token}"
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as c:
            r = await c.post(url, json={"code": code})
            data = r.json()
    except Exception as e:
        logger.exception("wx getuserphonenumber network failure")
        raise HTTPException(502, f"微信 API 调用失败: {e}")

    if data.get("errcode"):
        # 常见 errcode:
        #   40029 code 过期 / 已用
        #   40159 quota exceed (免费 1000/月)
        #   45011 频率限制
        logger.warning(
            "wx getuserphonenumber errcode=%s errmsg=%s",
            data.get("errcode"), data.get("errmsg"),
        )
        raise HTTPException(
            400,
            f"微信手机号验证失败: {data.get('errmsg') or 'getuserphonenumber error'} "
            f"(errcode {data.get('errcode')})",
        )
    phone_info = data.get("phone_info") or {}
    pure = phone_info.get("purePhoneNumber") or ""
    # 微信返的 purePhoneNumber 已经 不含 +86. 但 防御性 再 normalize 一次.
    normalized = _normalize_phone(pure)
    if not normalized:
        raise HTTPException(502, f"微信返回的手机号格式异常: {pure!r}")
    return normalized


async def _code_to_openid(code: str) -> tuple[str, Optional[str]]:
    """调微信 code2Session 拿 openid (+ optional unionid).

    raise HTTPException:
      - 503 WX OAuth 未配置 (env 缺 WX_APPID / WX_SECRET)
      - 400 code 无效 / 已过期 (微信返 errcode != 0)
      - 502 微信 API 网络 / 解析 异常
    """
    import httpx
    from ..config import get_settings
    s = get_settings()
    if not s.wx_appid or not s.wx_secret:
        raise HTTPException(
            503,
            "微信 OAuth 未配置 (服务端缺 WX_APPID / WX_SECRET)",
        )
    params = {
        "appid": s.wx_appid,
        "secret": s.wx_secret,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as c:
            r = await c.get(s.wx_code2session_url, params=params)
            data = r.json()
    except Exception as e:
        logger.exception("wx code2Session network failure")
        raise HTTPException(502, f"微信 API 调用失败: {e}")

    if data.get("errcode"):
        # 常见 errcode:
        #   40029 invalid code (已过期 / 已用过)
        #   45011 频率限制 (100 次/min)
        #   40226 高风险用户 — 拒登
        logger.warning(
            "wx code2Session errcode=%s errmsg=%s",
            data.get("errcode"),
            data.get("errmsg"),
        )
        raise HTTPException(
            400,
            f"微信登录失败: {data.get('errmsg') or 'code2Session error'} "
            f"(errcode {data.get('errcode')})",
        )
    openid = data.get("openid")
    if not openid:
        raise HTTPException(502, "微信 API 响应缺 openid")
    return openid, data.get("unionid")


@router.post("/wx-login", response_model=WxLoginOut)
async def wx_login(
    payload: WxLoginIn,
    session: AsyncSession = Depends(get_session),
):
    """微信一键登录入口. 完全不需要 Bearer.

    成功: bound=true + token + 各字段填齐.
    未绑: bound=false (其他字段 None) — 客户端弹邮密绑定页, 再走 /wx-bind.
    """
    openid, unionid = await _code_to_openid(payload.code)
    user = (
        await session.execute(select(User).where(User.wx_openid == openid))
    ).scalar_one_or_none()
    if not user:
        return WxLoginOut(bound=False)
    if not user.is_active:
        raise HTTPException(403, "[需重新登录] 账号已被禁用,请联系管理员")

    # 顺手把 unionid 补上 (老数据 可能 只 有 openid, 现在 拿到 unionid 就 持久化)
    if unionid and not user.wx_unionid:
        user.wx_unionid = unionid

    ws_id = user.workspace_id
    if not ws_id:
        # v1.3.1: 跟 _authenticate_user 一致 — system_owner 建新 ws, 否则加入 demo.
        ws_id = await _attach_user_to_default_ws(session, user)

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

    token = issue_token(user.id, ws.id, ttl_days=NATIVE_TOKEN_TTL_DAYS)
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return WxLoginOut(
        bound=True,
        token=token,
        token_type="Bearer",
        expires_at=expires_at,
        user_id=user.id,
        workspace_id=ws.id,
        role=membership.role if membership else "member",
    )


@router.post("/wx-phone-login", response_model=WxLoginOut)
async def wx_phone_login(
    payload: WxPhoneLoginIn,
    session: AsyncSession = Depends(get_session),
):
    """v27.2 微信手机号 一键登录.

    流程:
      1. 客户端 <button open-type="getPhoneNumber"> 拿到 phone code
      2. (同时) 客户端 wx.login() 拿到 openid code — 可选 一起 传
      3. 后端: code → getuserphonenumber → purePhoneNumber (11 位 无 +86)
      4. 后端: 按 phone 查 User.phone (跟 邮密登录 同 lookup 一致)
         - 命中: 顺手 把 openid 也绑了 (若 wx_login_code 提供且 user 还没 openid)
                 → 发 30 天 token (bound=True, 体验同 /api/auth/token)
         - 不命中: 返 bound=False, 让 客户端 提示 "该手机号 还没账号, 请联系管理员"
                  或 fallback 到 邮密表单
      5. 之后 用户开 小程序 → wx.login → openid 命中 → 0 操作 进 home

    安全:
      - phone code 一次性, 5min 过期 (微信 enforce)
      - 不用 SMS, 也不需要 access_token cache 暴露给前端 — server 端 cache
      - 没有 phone 字段 / 没绑微信手机号 的 user 永远走不到这条路
    """
    phone = await _phone_code_to_phone(payload.code)

    user = (
        await session.execute(select(User).where(User.phone == phone))
    ).scalar_one_or_none()
    if not user:
        return WxLoginOut(bound=False)
    if not user.is_active:
        raise HTTPException(403, "[需重新登录] 账号已被禁用,请联系管理员")

    # 顺手 绑 openid (如果 客户端 一起 传了 wx.login code, 且 user 还没 openid)
    if payload.wx_login_code:
        try:
            openid, unionid = await _code_to_openid(payload.wx_login_code)
            if not user.wx_openid:
                user.wx_openid = openid
            if unionid and not user.wx_unionid:
                user.wx_unionid = unionid
        except HTTPException:
            # wx_login_code 失败 不阻塞 phone 登录 — 只是 没法 顺手绑 openid
            logger.warning("wx_login_code 失败, 跳过 openid 绑定 (phone 登录仍走)")

    ws_id = user.workspace_id
    if not ws_id:
        # v1.3.1: 跟 _authenticate_user 一致 — system_owner 建新 ws, 否则加入 demo.
        ws_id = await _attach_user_to_default_ws(session, user)

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

    token = issue_token(user.id, ws.id, ttl_days=NATIVE_TOKEN_TTL_DAYS)
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return WxLoginOut(
        bound=True,
        token=token,
        token_type="Bearer",
        expires_at=expires_at,
        user_id=user.id,
        workspace_id=ws.id,
        role=membership.role if membership else "member",
    )


@router.post("/wx-bind", response_model=TokenIssueOut)
async def wx_bind(
    payload: WxBindIn,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """已 Bearer 登录 的 用户 把 当前 微信 openid 绑到 自己 账号.

    场景: wx-login 返 bound=false → 客户端 弹邮密表单 → POST /api/auth/token
    拿 token → 再 wx.login() 拿 新 code → 调本 endpoint.

    错误:
      - 409 openid 已绑到 别的 User (防 抢绑)
      - 400 当前 User 已绑别的 openid (要换微信号? 应先 unbind, mvp 不做)
    """
    openid, unionid = await _code_to_openid(payload.code)

    # 已被别人绑 → 409
    other = (
        await session.execute(
            select(User).where(User.wx_openid == openid, User.id != auth.user.id)
        )
    ).scalar_one_or_none()
    if other:
        raise HTTPException(409, "该微信号已绑定其他账号")

    # 当前 User 已绑过别的 openid → 拒绝 (不允许 转绑, mvp)
    if auth.user.wx_openid and auth.user.wx_openid != openid:
        raise HTTPException(
            400,
            "本账号已绑定过其他微信号,如需换绑请先在桌面端解除",
        )

    # 没问题 → 写入
    auth.user.wx_openid = openid
    if unionid:
        auth.user.wx_unionid = unionid
    auth.user.last_login_at = datetime.now(timezone.utc)
    await session.commit()

    # 顺手发一个新 token (避免 客户端 再调 /api/auth/token/refresh 这一步)
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    token = issue_token(
        auth.user.id, auth.workspace.id, ttl_days=NATIVE_TOKEN_TTL_DAYS
    )
    expires_at = datetime.now(timezone.utc) + timedelta(days=NATIVE_TOKEN_TTL_DAYS)
    return TokenIssueOut(
        token=token,
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
    # v1.3.1 (旧 v26.4-fix1): 如果 caller 是 system_owner 但当前 workspace 内 没 membership
    # (因为切换过来的 — 跨租户视角),自动 fallback 到 workspace_creator.前端凭这个 role
    # 决定 ⚙️ 后台 / 📊 看板 入口可见性.
    from ..auth import is_system_owner as _is_so
    effective_role: str
    if membership:
        effective_role = membership.role
    elif _is_so(auth):
        effective_role = "workspace_creator"  # system_owner 跨 ws 视角的 ABAC 兜底
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
