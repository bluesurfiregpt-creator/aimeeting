"""Agent CRUD: persona + Dify connection per agent. Workspace-scoped."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import (
    AuthContext,
    expert_bound_agent_id,
    get_current_auth,
    is_agent_owner,
    is_leader_or_admin,
    is_workspace_admin_or_above,
    require_workspace_manager,
)
# v1.3.1 兼容: 老 helper 名仍可调
from ..auth import is_agent_manager  # noqa: F401  alias for is_agent_owner
from ..db import get_session
from ..models import Agent
from ..oss_client import OSSClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])


class AgentIn(BaseModel):
    """创建 agent 用 — name 必填."""
    name: str
    nickname: Optional[str] = None  # v26.12-Home: 拟人外号
    avatar_url: Optional[str] = None
    full_body_url: Optional[str] = None  # v26.9-Avatar
    full_body_animated_url: Optional[str] = None  # v26.9-Avatar
    domain: Optional[str] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    boundary: Optional[str] = None
    keywords: Optional[list[str]] = None
    color: Optional[str] = None
    dify_app_type: str = "chatflow"
    dify_base_url: Optional[str] = "https://api.dify.ai"
    dify_api_key: Optional[str] = None
    dify_workflow_id: Optional[str] = None
    knowledge_base_ids: Optional[list[uuid.UUID]] = None
    is_active: bool = True
    # v26.0: 该 AI 专家绑定的科室账号 (任务派给该 agent 时,实际操作的 user)
    primary_user_id: Optional[uuid.UUID] = None


class AgentPatchIn(BaseModel):
    """v26.5-P0-fix1: PATCH 部分字段更新 — 所有字段都可选,不传 = 不改.
    解决之前 PATCH 必须传 name 否则 422 的问题.
    """
    name: Optional[str] = None
    nickname: Optional[str] = None  # v26.12-Home: 拟人外号; 传 "" 视为清空
    avatar_url: Optional[str] = None
    full_body_url: Optional[str] = None  # v26.9-Avatar
    full_body_animated_url: Optional[str] = None  # v26.9-Avatar
    domain: Optional[str] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    boundary: Optional[str] = None
    keywords: Optional[list[str]] = None
    color: Optional[str] = None
    dify_app_type: Optional[str] = None
    dify_base_url: Optional[str] = None
    dify_api_key: Optional[str] = None
    dify_workflow_id: Optional[str] = None
    knowledge_base_ids: Optional[list[uuid.UUID]] = None
    is_active: Optional[bool] = None
    primary_user_id: Optional[uuid.UUID] = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    nickname: Optional[str] = None  # v26.12-Home: 拟人外号 (NULL → 前端 fallback name)
    avatar_url: Optional[str] = None
    full_body_url: Optional[str] = None  # v26.9-Avatar
    full_body_animated_url: Optional[str] = None  # v26.9-Avatar
    domain: Optional[str] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    boundary: Optional[str] = None
    keywords: Optional[list[str]] = None
    color: Optional[str] = None
    dify_app_type: str
    dify_base_url: Optional[str] = None
    dify_workflow_id: Optional[str] = None
    knowledge_base_ids: Optional[list[uuid.UUID]] = None
    is_active: bool
    role: str = "expert"  # M3.0: 'moderator' for the workspace's built-in
    has_dify_key: bool = False  # don't echo the key itself
    # v26.0: 科室账号 信息 — 派发时 task 实际 assignee_user_id 由此 derive
    primary_user_id: Optional[uuid.UUID] = None
    primary_user_name: Optional[str] = None
    # v26.12-Home: 调用统计 — 首页 卡片 露 "1247 次使用" + "最热" 排序基准
    invoke_count: int = 0
    created_at: datetime


def _to_out(a: Agent, primary_user_name: Optional[str] = None) -> AgentOut:
    d = {
        **a.__dict__,
        "has_dify_key": bool(a.dify_api_key),
        "primary_user_name": primary_user_name,
    }
    return AgentOut.model_validate(d)


async def _resolve_primary_user_names(
    session: AsyncSession,
    agents: list[Agent],
) -> dict[uuid.UUID, str]:
    """v26.0: 批量拿 agent.primary_user_id → user.name 映射."""
    uids = {a.primary_user_id for a in agents if a.primary_user_id}
    if not uids:
        return {}
    from ..models import User as _User
    rows = (
        await session.execute(
            select(_User.id, _User.name).where(_User.id.in_(uids))
        )
    ).all()
    return {r[0]: r[1] for r in rows}


@router.get("", response_model=list[AgentOut])
async def list_agents(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
    # v26.12-Home: 首页 卡片浏览 用 — 默认 不传 跟 老行为 一致
    q: Optional[str] = Query(None, description="搜索 name/nickname/persona/domain"),
    sort: str = Query("new", description="new = 最新 / hot = 最热 (invoke_count desc)"),
    domain: Optional[str] = Query(None, description="按 domain 字段 精确筛选"),
    active_only: bool = Query(
        False,
        description="True 只返回 is_active=true 的 (首页 卡片 用)",
    ),
):
    # v1.3.1 ABAC:
    #   - workspace_creator / leader / admin: 看 全部 AI (科室长 admin 也能看 — 只是不能改)
    #   - agent_owner: 看 全部 (它有 自己 primary 的 AI)
    #   - member: 看 全部 (基础信息,不含 dify key — _to_out 已脱敏)
    # 老 v21 expert 限制 已废 (expert_bound_agent_id 现在 永远 返 None).
    is_admin = await is_workspace_admin_or_above(session, auth)  # noqa: F841
    bound = await expert_bound_agent_id(session, auth)  # v1.3.1: 永远 None

    stmt = select(Agent).where(Agent.workspace_id == auth.workspace.id)
    if not is_admin and bound is not None:
        # 老 expert 路径 — v1.3.1 后 bound 恒为 None, 这条 dead code 但保留以防回退.
        stmt = stmt.where(Agent.id == bound)
    # v26.12-Home: 关键词 全文 (ILIKE), 首页 搜索框 用
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Agent.name.ilike(like),
                Agent.nickname.ilike(like),
                Agent.persona.ilike(like),
                Agent.domain.ilike(like),
            )
        )
    if domain:
        stmt = stmt.where(Agent.domain == domain)
    if active_only:
        stmt = stmt.where(Agent.is_active.is_(True))
    # v26.12-Home: 排序
    #   hot = invoke_count desc (老 agent 都 0, 同分 时 fallback created_at desc)
    #   new = created_at desc (默认, 跟 老行为 一致)
    if sort == "hot":
        stmt = stmt.order_by(Agent.invoke_count.desc(), Agent.created_at.desc())
    else:
        stmt = stmt.order_by(Agent.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    name_by_uid = await _resolve_primary_user_names(session, rows)
    return [_to_out(a, name_by_uid.get(a.primary_user_id)) for a in rows]


@router.post("", response_model=AgentOut)
async def create_agent(
    payload: AgentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v1.3.1 (PM Q7.4): 创建 AI 专家 仅 workspace_creator / leader
    # (admin 不再 可创建 — admin 只管 科室人员 / 发起会议).
    # 建好后 通过 primary_user_id 指定给 某个 agent_owner 维护.
    await require_workspace_manager(session, auth)
    data = payload.model_dump()
    # v26.0: 验证 primary_user_id 在同 workspace
    if data.get("primary_user_id"):
        from ..models import User as _User
        u_check = (
            await session.execute(
                select(_User.id).where(
                    _User.id == data["primary_user_id"],
                    _User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if u_check is None:
            raise HTTPException(
                400, "primary_user_id 必须是 同 workspace 的用户"
            )
    a = Agent(**data, workspace_id=auth.workspace.id)
    session.add(a)
    await session.commit()
    await session.refresh(a)
    await audit_log(
        session, auth, "agent.create",
        target_type="agent", target_id=str(a.id),
        payload={"name": a.name, "domain": a.domain},
    )
    name_by_uid = await _resolve_primary_user_names(session, [a])
    return _to_out(a, name_by_uid.get(a.primary_user_id))


async def _load_owned_agent(
    agent_id: str, session: AsyncSession, auth: AuthContext
) -> Agent:
    a = (
        await session.execute(
            select(Agent).where(
                Agent.id == agent_id, Agent.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    return a


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    a = await _load_owned_agent(agent_id, session, auth)
    name_by_uid = await _resolve_primary_user_names(session, [a])
    return _to_out(a, name_by_uid.get(a.primary_user_id))


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: str,
    payload: AgentPatchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    a = await _load_owned_agent(agent_id, session, auth)
    # v1.3.1 (PM Q7.4): 改 agent 配置 仅 workspace_creator / leader, 或 该 agent
    # 的 primary_user (agent_owner). admin 不再 可改 — 看 AI 不能改.
    if not await is_agent_owner(session, auth, a.id):
        raise HTTPException(
            403,
            "[权限不足] 仅 workspace_creator / leader,或该 AI 的 agent_owner "
            "(primary_user) 可修改配置"
        )
    data = payload.model_dump(exclude_unset=True)
    # v1.3.1: 只有 workspace_creator / leader 可改 primary_user_id
    # (agent_owner 不能 把 agent 转给别人).
    # 加 "值没变 不算改" 容错 — 前端 PATCH 可能 总是把 primary_user_id raw 传上来.
    if "primary_user_id" in data and data["primary_user_id"] != a.primary_user_id:
        from ..auth import is_workspace_manager
        if not await is_workspace_manager(session, auth):
            raise HTTPException(
                403,
                "[权限不足] 仅 workspace_creator / leader 可指派 / 转移 agent 的 primary_user"
            )
    # v26.0: 验证 primary_user_id 在同一 workspace 内
    if "primary_user_id" in data and data["primary_user_id"] is not None:
        from ..models import User as _User
        u_check = (
            await session.execute(
                select(_User.id).where(
                    _User.id == data["primary_user_id"],
                    _User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if u_check is None:
            raise HTTPException(
                400, "primary_user_id 必须是 同 workspace 的用户"
            )
    changed = list(data.keys())
    for k, v in data.items():
        setattr(a, k, v)
    await session.commit()
    await session.refresh(a)
    await audit_log(
        session, auth, "agent.update",
        target_type="agent", target_id=str(a.id),
        payload={"name": a.name, "fields_changed": changed},
    )
    name_by_uid = await _resolve_primary_user_names(session, [a])
    return _to_out(a, name_by_uid.get(a.primary_user_id))


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v1.3.1 (PM Q7.4): 删 agent 仅 workspace_creator / leader.
    # agent_owner 不能 自删 自己 管的 AI; admin 也不能.
    await require_workspace_manager(session, auth)
    a = await _load_owned_agent(agent_id, session, auth)
    if a.role == "moderator":
        # The built-in moderator drives agenda_monitor; deleting it would
        # silently disable that whole feature. If a user really wants to
        # change behavior they can edit the persona instead.
        raise HTTPException(400, "cannot delete the built-in moderator agent")
    name = a.name
    await session.delete(a)
    await session.commit()
    await audit_log(
        session, auth, "agent.delete",
        target_type="agent", target_id=str(agent_id),
        payload={"name": name},
    )


# ============================================================================
# v26.9-Avatar · AI 专家形象上传 (3 种尺寸)
# ============================================================================
# 设计 (跟用户对齐):
#   avatar              200x200    PNG/JPG     头像 (列表 / 气泡 / sidebar)
#   full_body           200x388    PNG (透明)   静态全身 (详情页 hero)
#   full_body_animated  200x388    GIF/APNG    动图全身 (详情页 alive 态)
# 实现:
#   - 用 Pillow 校验 mime + 尺寸 (允许 ±10% 容差) + 文件大小
#   - 上传到 OSS, key = agents/{ws_id}/{agent_id}/{kind}.{ext}
#   - 用 signed_url (7 天) 写入 agent.{kind}_url 字段
#   - ABAC: 走 is_agent_manager (跟 PATCH 同等级)

_AVATAR_SIZE_LIMIT = 500 * 1024     # 500 KB
_FULLBODY_SIZE_LIMIT = 800 * 1024   # 800 KB
_FULLBODY_ANIMATED_SIZE_LIMIT = 2 * 1024 * 1024  # 2 MB (GIF 较大)
_SIZE_TOLERANCE = 0.15  # ±15% 尺寸容差

_ALLOWED_IMG_MIME = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
_ALLOWED_ANIMATED_MIME = {"image/gif", "image/webp", "image/apng", "image/png"}


def _check_image_size(
    data: bytes,
    expected_w: int,
    expected_h: int,
    file_kind: str,
) -> tuple[str, str]:
    """v26.9-Avatar: 用 Pillow 校验图片尺寸 + 提取 mime + 后缀.

    返回 (mime, ext). 不合规 raise HTTPException.
    """
    try:
        from PIL import Image
    except ImportError:
        raise HTTPException(503, "Pillow 未安装 — 联系运维")
    import io
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
    except Exception as e:
        raise HTTPException(400, f"不是有效图片: {e}")
    # verify 后 img 不能 再用, 重新打开取 尺寸 + format
    img = Image.open(io.BytesIO(data))
    w, h = img.size
    fmt = (img.format or "").lower()  # 'png' 'jpeg' 'gif' 'webp'
    # 尺寸容差检查
    if abs(w - expected_w) / expected_w > _SIZE_TOLERANCE:
        raise HTTPException(
            400,
            f"{file_kind} 宽度 {w}px 不在 {expected_w}±{int(_SIZE_TOLERANCE*100)}% 范围"
        )
    if abs(h - expected_h) / expected_h > _SIZE_TOLERANCE:
        raise HTTPException(
            400,
            f"{file_kind} 高度 {h}px 不在 {expected_h}±{int(_SIZE_TOLERANCE*100)}% 范围"
        )
    ext_map = {"png": "png", "jpeg": "jpg", "gif": "gif", "webp": "webp", "apng": "apng"}
    ext = ext_map.get(fmt, "bin")
    mime = f"image/{fmt}" if fmt != "jpeg" else "image/jpeg"
    return mime, ext


async def _upload_agent_image(
    *,
    agent_id: str,
    file: UploadFile,
    session: AsyncSession,
    auth: AuthContext,
    kind: str,  # 'avatar' / 'full_body' / 'full_body_animated'
    expected_w: int,
    expected_h: int,
    max_bytes: int,
    allowed_mime: set[str],
) -> AgentOut:
    """统一的 agent 图片上传逻辑."""
    a = await _load_owned_agent(agent_id, session, auth)
    # v1.3.1: 上传 AI 形象 = 改 AI 配置, 走 agent_owner ABAC (= ws_manager OR primary_user).
    if not await is_agent_owner(session, auth, a.id):
        raise HTTPException(
            403,
            "[权限不足] 仅 workspace_creator / leader,或该 AI 的 agent_owner (primary_user) "
            "可上传形象"
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空文件")
    if len(raw) > max_bytes:
        raise HTTPException(
            413, f"文件太大 ({len(raw)} bytes), 上限 {max_bytes // 1024}KB"
        )
    mime, ext = _check_image_size(raw, expected_w, expected_h, kind)
    if mime not in allowed_mime:
        raise HTTPException(
            400, f"不支持的图片格式 {mime}, 允许: {', '.join(sorted(allowed_mime))}"
        )

    # 上传 OSS
    oss = OSSClient()
    if not oss.configured:
        raise HTTPException(503, "OSS 未配置")
    oss_key = f"agents/{auth.workspace.id}/{a.id}/{kind}.{ext}"
    oss.put_bytes(oss_key, raw, content_type=mime)
    # 用 长 expire 签名 URL (7 天). 前端 next.js 默认不 cache cross-origin,
    # 浏览器会自己 cache 直到 url 变. 7 天后 重新上传 / 重新 fetch 即可.
    signed = oss.signed_url(oss_key, expires_seconds=7 * 24 * 3600)

    # 更新字段
    if kind == "avatar":
        a.avatar_url = signed
    elif kind == "full_body":
        a.full_body_url = signed
    elif kind == "full_body_animated":
        a.full_body_animated_url = signed
    await session.commit()
    await session.refresh(a)

    await audit_log(
        session, auth, f"agent.upload_{kind}",
        target_type="agent", target_id=str(a.id),
        payload={"name": a.name, "byte_size": len(raw), "oss_key": oss_key},
    )
    name_by_uid = await _resolve_primary_user_names(session, [a])
    return _to_out(a, name_by_uid.get(a.primary_user_id))


@router.post("/{agent_id}/avatar", response_model=AgentOut)
async def upload_avatar(
    agent_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.9-Avatar: 上传 头像 200x200 (PNG/JPG/WebP, max 500KB)."""
    return await _upload_agent_image(
        agent_id=agent_id, file=file, session=session, auth=auth,
        kind="avatar",
        expected_w=200, expected_h=200,
        max_bytes=_AVATAR_SIZE_LIMIT,
        allowed_mime=_ALLOWED_IMG_MIME,
    )


@router.post("/{agent_id}/full-body", response_model=AgentOut)
async def upload_full_body(
    agent_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.9-Avatar: 上传 静态全身 200x388 (PNG/JPG/WebP, max 800KB)."""
    return await _upload_agent_image(
        agent_id=agent_id, file=file, session=session, auth=auth,
        kind="full_body",
        expected_w=200, expected_h=388,
        max_bytes=_FULLBODY_SIZE_LIMIT,
        allowed_mime=_ALLOWED_IMG_MIME,
    )


@router.post("/{agent_id}/full-body-animated", response_model=AgentOut)
async def upload_full_body_animated(
    agent_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.9-Avatar: 上传 动图全身 200x388 (GIF/APNG/WebP, max 2MB)."""
    return await _upload_agent_image(
        agent_id=agent_id, file=file, session=session, auth=auth,
        kind="full_body_animated",
        expected_w=200, expected_h=388,
        max_bytes=_FULLBODY_ANIMATED_SIZE_LIMIT,
        allowed_mime=_ALLOWED_ANIMATED_MIME,
    )


# ---------------------------------------------------------------------------
# v26.14-P3: AI 履历 — /api/agents/{id}/activity
# ---------------------------------------------------------------------------
# 用户 在 详情页 看 一个 AI 时 想 知道 "它 干 过 啥" — 老 页面 只 显 静态 配置.
# 此 endpoint 把 该 AI 在 meeting_transcript 里 的 发言 聚合 出 履历:
#   - total_lines       该 AI 历史 总 发言 行数
#   - total_meetings    distinct 参与 会议 数
#   - recent_meetings   最近 8 场 (该 AI 说过 话 的) — 含 会议 题目 / 状态 / 用 时
#
# ABAC: 跟 GET /api/agents/{id} 同 — workspace 内 任何 成员 可看.


class RecentMeetingItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    meeting_id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime]
    lines_by_agent: int  # 该 AI 在 这场 说 了 几行


class AgentActivityOut(BaseModel):
    total_lines: int
    total_meetings: int
    recent_meetings: list[RecentMeetingItem]


@router.get("/{agent_id}/activity", response_model=AgentActivityOut)
async def get_agent_activity(
    agent_id: str,
    limit: int = Query(8, ge=1, le=30),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P3: 返 该 AI 的 履历 — 老 详情页 仅 静态 配置, 此 endpoint 给 出 真实 工作记录."""
    from sqlalchemy import func
    from ..models import Meeting, MeetingTranscript

    # 先 校验 agent 在 当前 workspace (复用 _load_owned_agent — 它 已做 workspace 隔离)
    await _load_owned_agent(agent_id, session, auth)

    # 聚合 1: 总 行数 + distinct 会议 数
    aggregates = (
        await session.execute(
            select(
                func.count(MeetingTranscript.id).label("total_lines"),
                func.count(func.distinct(MeetingTranscript.meeting_id)).label("total_meetings"),
            ).where(MeetingTranscript.agent_id == uuid.UUID(agent_id))
        )
    ).one()

    # 聚合 2: 最近 N 场 (按 该 AI 最后 一次 发言 时间 倒序)
    rows = (
        await session.execute(
            select(
                Meeting.id,
                Meeting.title,
                Meeting.status,
                Meeting.started_at,
                func.count(MeetingTranscript.id).label("lines_by_agent"),
            )
            .join(MeetingTranscript, MeetingTranscript.meeting_id == Meeting.id)
            .where(MeetingTranscript.agent_id == uuid.UUID(agent_id))
            .group_by(Meeting.id)
            .order_by(func.max(MeetingTranscript.id).desc())
            .limit(limit)
        )
    ).all()

    recent = [
        RecentMeetingItem(
            meeting_id=r[0],
            title=r[1] or "(未命名)",
            status=r[2],
            started_at=r[3],
            lines_by_agent=int(r[4]),
        )
        for r in rows
    ]

    return AgentActivityOut(
        total_lines=int(aggregates.total_lines or 0),
        total_meetings=int(aggregates.total_meetings or 0),
        recent_meetings=recent,
    )
