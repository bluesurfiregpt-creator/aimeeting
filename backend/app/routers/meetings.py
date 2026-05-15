from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio

from .. import session_state
from ..agenda_monitor import maybe_check_agenda
from ..agent_router import maybe_invoke_agents
from ..audit import audit_log
from ..auth import (
    AuthContext,
    get_current_auth,
    is_leader_or_admin,
    require_leader_or_admin,
)
from ..db import get_session
from ..dissent_detector import maybe_detect_dissent
from ..identify_pipeline import run_identify
from ..models import (
    Agent,
    KbSedimentationDraft,
    Meeting,
    MeetingActionItem,
    MeetingActionItemComment,
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingSpeakerSegment,
    MeetingTranscript,
    MemoryDraft,
    Notification,
    Task,
    User,
)
from ..notify import emit_notification
from ..task_sync import (
    add_action_with_task,
    delete_task_for_action,
    mirror_patch_to_task,
)
from ..schemas import MeetingCreate, MeetingOut, MeetingResultOut, TranscriptLine
from ..briefing_generator import generate_briefing
from ..meeting_export import export_docx, export_markdown
from ..summary_generator import generate_summary

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meetings", tags=["meetings"])


async def _load_owned_meeting(
    meeting_id: str, session: AsyncSession, auth: AuthContext
) -> Meeting:
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id, Meeting.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")
    return m


def _to_meeting_out(
    m: Meeting,
    attendee_user_ids: list[uuid.UUID],
    attendee_agent_ids: list[uuid.UUID] | None = None,
) -> MeetingOut:
    return MeetingOut.model_validate(
        {
            "id": m.id,
            "title": m.title,
            "status": m.status,
            "started_at": m.started_at,
            "ended_at": m.ended_at,
            "attendee_user_ids": attendee_user_ids,
            "attendee_agent_ids": attendee_agent_ids or [],
            "agenda": m.agenda,
            # v26.3
            "mode": m.mode or "hybrid",
            "auto_state": m.auto_state,
            # v26.14-P5.2: 创建人 — 前端 据此 显/隐 议程 推进 按钮
            "created_by_user_id": m.created_by_user_id,
        }
    )


@router.post("", response_model=MeetingOut)
async def create_meeting(
    payload: MeetingCreate,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.3: mode 校验
    mode = (payload.mode or "hybrid").lower()
    if mode not in ("human", "hybrid", "auto"):
        raise HTTPException(400, f"invalid mode: {mode}")
    if mode == "auto":
        # v26.3.1 ABAC P0 #1: auto 会议是"跨科室决策",由 leader/admin/owner 召集.
        # expert 是科室代表,不应代表全局开会 — 想跟其他 AI 协作走 hybrid.
        # member 跟 v26.3 召集人模式 0 交集.
        await require_leader_or_admin(session, auth)
        # auto 模式必须 ≥2 议程项 + ≥3 邀请 AI(per v26.3-spec)
        if not payload.agenda or len(payload.agenda) < 2:
            raise HTTPException(400, "auto 模式 至少 2 个议程项")
        if len(payload.attendee_agent_ids) < 3:
            raise HTTPException(400, "auto 模式 至少邀请 3 个 AI 专家")

    auto_state = None
    if mode == "auto":
        from ..auto_meeting_state import default_auto_state
        auto_state = default_auto_state()

    m = Meeting(
        title=payload.title or "未命名会议",
        status="scheduled",
        workspace_id=auth.workspace.id,
        mode=mode,
        auto_state=auto_state,
        agenda=(
            [a.model_dump(exclude_none=True) for a in payload.agenda]
            if payload.agenda
            else None
        ),
        # v26.11-fix2: 记录 召集人 — 邀请 AI / 改 议程 走 ABAC 时 要 它.
        created_by_user_id=auth.user.id,
    )
    session.add(m)
    await session.flush()
    for uid in payload.attendee_user_ids:
        # Verify each user belongs to the same workspace before binding
        u = (
            await session.execute(
                select(User).where(
                    User.id == uid, User.workspace_id == auth.workspace.id
                )
            )
        ).scalar_one_or_none()
        if u is not None:
            session.add(MeetingAttendee(meeting_id=m.id, user_id=uid))

    # v25.7-#1: 邀请 AI 专家(workspace 校验)
    bound_agent_ids: list[uuid.UUID] = []
    if payload.attendee_agent_ids:
        from ..models import Agent
        valid_agents = (
            await session.execute(
                select(Agent.id).where(
                    Agent.id.in_(payload.attendee_agent_ids),
                    Agent.workspace_id == auth.workspace.id,
                    Agent.is_active.is_(True),
                )
            )
        ).all()
        bound_agent_ids = [r[0] for r in valid_agents]
        for aid in bound_agent_ids:
            session.add(MeetingAttendee(meeting_id=m.id, agent_id=aid))

    # v26.3 auto 模式 校验 邀请的 AI 中实际 是 expert (不能全是 moderator)
    if mode == "auto" and bound_agent_ids:
        from ..models import Agent
        expert_count = (
            await session.execute(
                select(func.count()).select_from(Agent).where(
                    Agent.id.in_(bound_agent_ids),
                    Agent.role == "expert",
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one()
        if expert_count < 3:
            raise HTTPException(
                400, f"auto 模式 至少邀请 3 个 active expert agent (现 {expert_count})"
            )

    await session.commit()
    await session.refresh(m)
    await audit_log(
        session, auth, "meeting.create",
        target_type="meeting", target_id=str(m.id),
        payload={
            "title": m.title,
            "mode": mode,
            "attendee_count": len(payload.attendee_user_ids),
            "agent_count": len(bound_agent_ids),
            "agenda_count": len(payload.agenda or []),
        },
    )
    return _to_meeting_out(m, list(payload.attendee_user_ids), bound_agent_ids)


@router.get("", response_model=list[MeetingOut])
async def list_meetings(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(Meeting)
            .where(Meeting.workspace_id == auth.workspace.id)
            .order_by(Meeting.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    if not rows:
        return []
    # Pull attendee user_ids + agent_ids for each meeting in one shot
    ids = [m.id for m in rows]
    rels = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id.in_(ids))
        )
    ).scalars().all()
    by_meeting_user: dict[uuid.UUID, list[uuid.UUID]] = {}
    by_meeting_agent: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in rels:
        if r.user_id is not None:
            by_meeting_user.setdefault(r.meeting_id, []).append(r.user_id)
        elif r.agent_id is not None:
            by_meeting_agent.setdefault(r.meeting_id, []).append(r.agent_id)
    return [
        _to_meeting_out(m, by_meeting_user.get(m.id, []), by_meeting_agent.get(m.id, []))
        for m in rows
    ]


@router.get("/{meeting_id}/export")
async def export_meeting(
    meeting_id: str,
    format: str = "md",
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Export the meeting (summary + named transcript + agent messages) as a
    downloadable file. Supports `md` and `docx`. Streamed as attachment with
    a Chinese-safe filename.
    """
    from urllib.parse import quote
    from fastapi.responses import Response

    m = await _load_owned_meeting(meeting_id, session, auth)
    safe_title = (m.title or "meeting").replace("/", "_")[:80]

    if format == "md":
        content = await export_markdown(m.id, session)
        if not content:
            raise HTTPException(404, "nothing to export")
        body = content.encode("utf-8")
        media = "text/markdown; charset=utf-8"
        ext = "md"
    elif format == "docx":
        body = await export_docx(m.id, session)
        if not body:
            raise HTTPException(404, "nothing to export")
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ext = "docx"
    else:
        raise HTTPException(400, "format must be md or docx")

    filename = f"{safe_title}.{ext}"
    # Quote for cross-browser Chinese filename support per RFC 5987
    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"meeting.{ext}\"; "
            f"filename*=UTF-8''{quote(filename)}"
        )
    }
    return Response(content=body, media_type=media, headers=headers)


@router.get("/{meeting_id}/minutes")
async def export_meeting_minutes(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25-5 — 单场会议纪要 docx 完整版(政务公文格式).

    比 /export?format=docx 更全:
      - 议程(若有)
      - 摘要 + 转写 + AI 专家发言 + 待办事项
      - RGB 颜色 + 标题层级 + RFC 5987 中文 filename
      - 页脚带导出时间

    任何登录用户(只要在该 workspace)都可导出.
    """
    from urllib.parse import quote
    from fastapi.responses import Response

    from ..meeting_minutes import build_minutes_docx

    m = await _load_owned_meeting(meeting_id, session, auth)
    body, filename = await build_minutes_docx(session, m.id)
    ascii_fallback = filename.encode("ascii", errors="replace").decode("ascii").replace("?", "_")
    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"{ascii_fallback}\"; "
            f"filename*=UTF-8''{quote(filename)}"
        ),
    }
    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Delete a meeting and ALL its dependent rows. Cascade is configured on
    the FK columns (ondelete='CASCADE') for transcripts, attendees, agent
    messages and speaker segments, so we just remove the parent.

    Long-term memories that were extracted from this meeting are LEFT in
    place — testers explicitly want to clean up trash meetings without
    losing the knowledge harvested from them. Memories are referenced by
    source_id so they remain queryable from /admin/memory.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    # Discard any in-memory session state still buffering audio
    session_state.discard(m.id)
    title = m.title
    await session.delete(m)
    await session.commit()
    await audit_log(
        session, auth, "meeting.delete",
        target_type="meeting", target_id=meeting_id, payload={"title": title},
    )


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id)
        )
    ).scalars().all()
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    agent_ids = [r.agent_id for r in rows if r.agent_id is not None]
    return _to_meeting_out(m, user_ids, agent_ids)


# v26.3-03: Auto Meeting (mode='auto') Orchestrator 控制 endpoints --------


class OrchestrateStateOut(BaseModel):
    """GET /orchestrate/state — 召集人 / 前端拉调度状态."""
    phase: str
    current_agenda_idx: int = 0
    current_speaker_agent_id: Optional[uuid.UUID] = None
    turn_count: int = 0
    dissent_count: int = 0
    started_at: Optional[str] = None
    paused_at: Optional[str] = None
    last_error: Optional[str] = None
    # 完成的议程项数(查 meeting_consensus count)
    completed_agenda_count: int = 0
    total_agenda_count: int = 0
    # v26.3-08:整场已 running 累计秒数 (paused 不算 — Q8=B).
    # 前端用它 + max_meeting_seconds 显示"已用 12:34 / 45:00" + 颜色三档.
    running_elapsed_sec: float = 0.0
    max_meeting_sec: int = 45 * 60


@router.get("/{meeting_id}/orchestrate/state", response_model=OrchestrateStateOut)
async def get_orchestrate_state(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: 前端轮询 当前 orchestrator 状态(在 v26.3-04 WS 上之前用).

    v26.3-08: 多返 running_elapsed_sec + max_meeting_sec — 前端显示"已用 X/45 min".
    """
    from ..auto_meeting_state import get_phase, running_elapsed_seconds
    from ..auto_meeting_orchestrator import MAX_MEETING_SECONDS
    from ..models import MeetingConsensus
    m = await _load_owned_meeting(meeting_id, session, auth)
    st = m.auto_state or {}
    completed = (
        await session.execute(
            select(func.count()).select_from(MeetingConsensus).where(
                MeetingConsensus.meeting_id == m.id
            )
        )
    ).scalar_one() or 0
    return OrchestrateStateOut(
        phase=get_phase(st),
        current_agenda_idx=int(st.get("current_agenda_idx", 0) or 0),
        current_speaker_agent_id=(
            uuid.UUID(st["current_speaker_agent_id"])
            if st.get("current_speaker_agent_id") else None
        ),
        turn_count=int(st.get("turn_count", 0) or 0),
        dissent_count=int(st.get("dissent_count", 0) or 0),
        started_at=st.get("started_at"),
        paused_at=st.get("paused_at"),
        last_error=st.get("last_error"),
        completed_agenda_count=int(completed),
        total_agenda_count=len(m.agenda or []),
        running_elapsed_sec=running_elapsed_seconds(st),
        max_meeting_sec=MAX_MEETING_SECONDS,
    )


@router.post("/{meeting_id}/orchestrate/start", response_model=OrchestrateStateOut)
async def orchestrate_start(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: leader 启动 auto 会议.v26.3.1 P0: 仅 owner/admin/leader."""
    from ..auto_meeting_orchestrator import start_auto_meeting
    from ..auto_meeting_state import get_phase, PHASE_IDLE
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.mode != "auto":
        raise HTTPException(400, f"meeting mode={m.mode}, 只 auto 可启动")
    await require_leader_or_admin(session, auth)
    phase = get_phase(m.auto_state)
    if phase != PHASE_IDLE:
        raise HTTPException(409, f"phase={phase} 不能 start (只 idle 可启动)")
    # fire-and-forget 启动 orchestrator
    start_auto_meeting(m.id)
    # immediate state(可能还没切到 running,但 lifespan 内会很快)
    return await get_orchestrate_state(meeting_id, session, auth)


@router.post("/{meeting_id}/orchestrate/pause", response_model=OrchestrateStateOut)
async def orchestrate_pause(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: leader 暂停(orchestrator 会在下一个 LLM 调用前 block).
    v26.3.1 P0: 仅 owner/admin/leader."""
    from ..auto_meeting_state import apply_transition, AUTO_ACTION_PAUSE, IllegalPhaseTransition
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.mode != "auto":
        raise HTTPException(400, "only mode=auto can be paused")
    await require_leader_or_admin(session, auth)
    try:
        new_state = apply_transition(
            m.auto_state, AUTO_ACTION_PAUSE,
            actor_user_id=str(auth.user.id),
        )
    except IllegalPhaseTransition as e:
        raise HTTPException(409, str(e))
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(auto_state=new_state)
    )
    await session.commit()
    return await get_orchestrate_state(meeting_id, session, auth)


@router.post("/{meeting_id}/orchestrate/resume", response_model=OrchestrateStateOut)
async def orchestrate_resume(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: leader 恢复暂停的会议.v26.3.1 P0: 仅 owner/admin/leader."""
    from ..auto_meeting_state import apply_transition, AUTO_ACTION_RESUME, IllegalPhaseTransition
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.mode != "auto":
        raise HTTPException(400, "only mode=auto can be resumed")
    await require_leader_or_admin(session, auth)
    try:
        new_state = apply_transition(m.auto_state, AUTO_ACTION_RESUME)
    except IllegalPhaseTransition as e:
        raise HTTPException(409, str(e))
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(auto_state=new_state)
    )
    await session.commit()
    return await get_orchestrate_state(meeting_id, session, auth)


@router.post("/{meeting_id}/orchestrate/cancel", response_model=OrchestrateStateOut)
async def orchestrate_cancel(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: leader 取消(终态,不可恢复).meeting.status 也切到 'cancelled'.
    v26.3.1 P0: 仅 owner/admin/leader."""
    from ..auto_meeting_state import apply_transition, AUTO_ACTION_CANCEL, IllegalPhaseTransition
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.mode != "auto":
        raise HTTPException(400, "only mode=auto can be cancelled")
    await require_leader_or_admin(session, auth)
    try:
        new_state = apply_transition(
            m.auto_state, AUTO_ACTION_CANCEL,
            actor_user_id=str(auth.user.id),
        )
    except IllegalPhaseTransition as e:
        raise HTTPException(409, str(e))
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(
            auto_state=new_state,
            status="finished",  # 视为已结束 + cancelled phase
        )
    )
    await session.commit()
    return await get_orchestrate_state(meeting_id, session, auth)


@router.post("/{meeting_id}/finalize", response_model=MeetingOut)
async def finalize_meeting(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.status != "finished":
        await session.execute(
            update(Meeting)
            .where(Meeting.id == m.id)
            .values(status="finished", ended_at=datetime.now(timezone.utc))
        )
        await session.commit()
        await session.refresh(m)

    # kick off identify in background
    bg.add_task(run_identify, m.id)
    rows = (
        await session.execute(
            select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id)
        )
    ).scalars().all()
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    agent_ids = [r.agent_id for r in rows if r.agent_id is not None]
    return _to_meeting_out(m, user_ids, agent_ids)


# v26.11-fix2: 会议进行中 邀请 新 AI 加入 ——
# 前端 会议室 AI 画廊 "+ 邀请 AI" → 调 本 endpoint → 写 MeetingAttendee +
# 广播 给 房间 所有 WS 客户端 (含 自己 — 触发 重新拉取 attendee_agent_ids).
# 加入后 立刻 生效:agent_router._agents_for_meeting() 读 MeetingAttendee
# 表, 关键词触发 / 手动 invoke / orchestrator auto-invoke 全 通.
class InviteAgentsIn(BaseModel):
    agent_ids: list[uuid.UUID]


class InviteAgentsOut(BaseModel):
    added: list[uuid.UUID]           # 本次 真正 新增 的
    already_invited: list[uuid.UUID]  # 之前 就在 (idempotent skip)
    invalid: list[uuid.UUID]          # workspace/active 校验 fail 的
    attendee_agent_ids: list[uuid.UUID]  # 当前 meeting 的 完整 邀请列表


@router.post("/{meeting_id}/agents", response_model=InviteAgentsOut)
async def invite_meeting_agents(
    meeting_id: str,
    payload: InviteAgentsIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.11-fix2: 会议进行中 邀请 新 AI 加入 会议.

    ABAC:
      - workspace owner/admin/leader → 总是 可
      - 会议 created_by_user_id == caller → 创建人 可
      - 其他 → 403 (member 没权 拉 AI 进来 — 这是 房间级别 决策)

    幂等:
      - 已在 attendee 列表 的 agent → already_invited, 不 重复 插.
      - workspace 不匹配 / is_active=false 的 agent → invalid, skip.

    成功后 → 给 房间 WS 客户端 广播 {"type":"agents_invited", "agent_ids":[...]},
    前端 收到 立刻 拉 一次 /agents (popoulate 头像 + 名字) + 更新 attendee_agent_ids.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)

    # ABAC: leader+ OR 创建人 (NULL created_by_user_id 的 老数据 退化为 仅 leader+)
    if not await is_leader_or_admin(session, auth):
        if m.created_by_user_id is None or m.created_by_user_id != auth.user.id:
            raise HTTPException(
                403, "[权限不足] 仅 会议创建人 + leader / admin / owner 可邀请 AI"
            )

    if not payload.agent_ids:
        # 当前 已邀请的 列表 — 同样 给前端 回 一份 当前态.
        existing = (
            await session.execute(
                select(MeetingAttendee.agent_id).where(
                    MeetingAttendee.meeting_id == m.id,
                    MeetingAttendee.agent_id.is_not(None),
                )
            )
        ).all()
        return InviteAgentsOut(
            added=[],
            already_invited=[],
            invalid=[],
            attendee_agent_ids=[r[0] for r in existing],
        )

    # 已邀请 (用于 幂等 跳过)
    invited_now = {
        r[0]
        for r in (
            await session.execute(
                select(MeetingAttendee.agent_id).where(
                    MeetingAttendee.meeting_id == m.id,
                    MeetingAttendee.agent_id.is_not(None),
                )
            )
        ).all()
    }

    # workspace + active 校验
    valid_ids: set[uuid.UUID] = {
        r[0]
        for r in (
            await session.execute(
                select(Agent.id).where(
                    Agent.id.in_(payload.agent_ids),
                    Agent.workspace_id == auth.workspace.id,
                    Agent.is_active.is_(True),
                )
            )
        ).all()
    }

    added: list[uuid.UUID] = []
    already: list[uuid.UUID] = []
    invalid: list[uuid.UUID] = []
    for aid in payload.agent_ids:
        if aid not in valid_ids:
            invalid.append(aid)
            continue
        if aid in invited_now:
            already.append(aid)
            continue
        session.add(MeetingAttendee(meeting_id=m.id, agent_id=aid))
        added.append(aid)
        invited_now.add(aid)

    if added:
        await session.commit()
        await audit_log(
            session, auth, "meeting.invite_agents",
            target_type="meeting", target_id=str(m.id),
            payload={
                "added": [str(x) for x in added],
                "already": [str(x) for x in already],
                "invalid": [str(x) for x in invalid],
            },
        )
        # 广播 给 房间 — 所有 WS 客户端 收到 后 重新拉 meeting + agents.
        try:
            await session_state.broadcast(
                m.id,
                {
                    "type": "agents_invited",
                    "agent_ids": [str(x) for x in added],
                    "attendee_agent_ids": [str(x) for x in invited_now],
                },
            )
        except Exception:
            logger.exception("broadcast agents_invited failed (non-fatal)")

    return InviteAgentsOut(
        added=added,
        already_invited=already,
        invalid=invalid,
        attendee_agent_ids=list(invited_now),
    )


# ============================================================================
# v26.14-P2: 会议 "本场收获" 面板 — meeting harvest endpoint
# 列出 本场 会议 产出 的 三件 东西:
#   1. Action Items (MeetingActionItem, 直接 关联 meeting_id)
#   2. Memory Drafts (MemoryDraft, source_meeting_id 关联) — 待审/已批/已拒/已过期
#   3. KB Sediment Drafts (KbSedimentationDraft via task → 间接关联) — 同上
#
# 让 用户 开完 会 看到 "这场 会 真的 让 AI 变 聪明了 几条 经验 / 几篇 资料",
# 闭环 可见 (不再 黑盒).
# ============================================================================

class HarvestActionItem(BaseModel):
    id: uuid.UUID
    content: str
    status: str  # open | done | cancelled
    assignee_user_name: Optional[str] = None
    assignee_name_hint: Optional[str] = None
    due_at: Optional[datetime] = None


class HarvestMemoryDraft(BaseModel):
    id: uuid.UUID
    proposed_content: str
    status: str  # pending | approved | rejected | expired
    created_at: datetime


class HarvestKbDraft(BaseModel):
    id: uuid.UUID
    proposed_summary_preview: str  # 截 80 字
    status: str
    created_at: datetime


class HarvestOut(BaseModel):
    # 各类计数 — 顶部 panel 用 "📌 N 个 / 🧠 待审 N / 已审 N / 📚 ..."
    action_items_total: int
    action_items_open: int
    action_items_done: int

    memory_drafts_total: int
    memory_drafts_pending: int
    memory_drafts_approved: int

    kb_drafts_total: int
    kb_drafts_pending: int
    kb_drafts_approved: int

    # 列表 — panel 展开 后 显
    action_items: list[HarvestActionItem]
    memory_drafts: list[HarvestMemoryDraft]
    kb_drafts: list[HarvestKbDraft]


@router.get("/{meeting_id}/harvest", response_model=HarvestOut)
async def meeting_harvest(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P2: 本场 会议 沉淀 收获."""
    m = await _load_owned_meeting(meeting_id, session, auth)

    # Action items (直接 meeting_id)
    actions = (
        await session.execute(
            select(MeetingActionItem)
            .where(MeetingActionItem.meeting_id == m.id)
            .order_by(MeetingActionItem.created_at.asc())
        )
    ).scalars().all()

    # Memory drafts (source_meeting_id 直接)
    mem_drafts = (
        await session.execute(
            select(MemoryDraft)
            .where(MemoryDraft.source_meeting_id == m.id)
            .order_by(MemoryDraft.created_at.desc())
        )
    ).scalars().all()

    # KB drafts (通过 task: task.id 是 本场 action item 的 task_id, 再 join)
    # 1. 找 本场 action items 的 task_id
    task_ids = [a.task_id for a in actions if a.task_id is not None]
    kb_drafts: list[KbSedimentationDraft] = []
    if task_ids:
        kb_drafts = list((
            await session.execute(
                select(KbSedimentationDraft)
                .where(
                    KbSedimentationDraft.task_id.in_(task_ids),
                    # 仅 task_sediment kind, 不要 把 perplexity_auto 错算 给 本场
                    KbSedimentationDraft.kind == "task_sediment",
                )
                .order_by(KbSedimentationDraft.created_at.desc())
            )
        ).scalars().all())

    # Resolve assignee names
    assignee_uids = {a.assignee_user_id for a in actions if a.assignee_user_id}
    name_by_uid: dict[uuid.UUID, str] = {}
    if assignee_uids:
        rows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(assignee_uids))
            )
        ).all()
        name_by_uid = {r[0]: r[1] for r in rows}

    # Counts
    actions_open = sum(1 for a in actions if a.status == "open")
    actions_done = sum(1 for a in actions if a.status == "done")
    mem_pending = sum(1 for d in mem_drafts if d.status == "pending")
    mem_approved = sum(1 for d in mem_drafts if d.status == "approved")
    kb_pending = sum(1 for d in kb_drafts if d.status == "pending")
    kb_approved = sum(1 for d in kb_drafts if d.status == "approved")

    return HarvestOut(
        action_items_total=len(actions),
        action_items_open=actions_open,
        action_items_done=actions_done,
        memory_drafts_total=len(mem_drafts),
        memory_drafts_pending=mem_pending,
        memory_drafts_approved=mem_approved,
        kb_drafts_total=len(kb_drafts),
        kb_drafts_pending=kb_pending,
        kb_drafts_approved=kb_approved,
        action_items=[
            HarvestActionItem(
                id=a.id,
                content=(a.content or "")[:200],
                status=a.status,
                assignee_user_name=(
                    name_by_uid.get(a.assignee_user_id) if a.assignee_user_id else None
                ),
                assignee_name_hint=a.assignee_name_hint,
                due_at=a.due_at,
            )
            for a in actions[:20]  # 截 20 条 防爆
        ],
        memory_drafts=[
            HarvestMemoryDraft(
                id=d.id,
                proposed_content=(d.proposed_content or "")[:200],
                status=d.status,
                created_at=d.created_at,
            )
            for d in mem_drafts[:20]
        ],
        kb_drafts=[
            HarvestKbDraft(
                id=d.id,
                proposed_summary_preview=(d.proposed_summary or "")[:80],
                status=d.status,
                created_at=d.created_at,
            )
            for d in kb_drafts[:20]
        ],
    )


_STATUS_RE = re.compile(r"<!-- identify:(\w+): (.*?) -->")


class BriefingOut(BaseModel):
    briefing_md: str | None
    status: str  # 'ready' | 'empty'


@router.get("/{meeting_id}/briefing", response_model=BriefingOut)
async def get_meeting_briefing(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    md = await generate_briefing(m.id)
    return BriefingOut(briefing_md=md, status="ready" if md else "empty")


class SummaryOut(BaseModel):
    """summary_md is None when not yet generated; status tells the front-end
    whether to keep polling."""
    summary_md: str | None
    status: str  # 'pending' | 'ready' | 'failed' | 'unconfigured' | 'skipped'
    message: str | None = None  # human-readable note for skipped/failed


@router.get("/{meeting_id}/summary", response_model=SummaryOut)
async def get_meeting_summary(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.summary_md and not m.summary_md.startswith("<!--"):
        return SummaryOut(summary_md=m.summary_md, status="ready")
    # The summary_generator may write a <!-- summary:skipped: ... --> marker
    # when the transcript is too thin; surface it as a terminal 'skipped'
    # state so the front-end stops polling and shows a friendly message.
    if m.summary_md and m.summary_md.startswith("<!-- summary:skipped:"):
        msg_match = re.search(r"<!-- summary:skipped: (.*?) -->", m.summary_md, re.S)
        return SummaryOut(
            summary_md=None,
            status="skipped",
            message=msg_match.group(1) if msg_match else "纪要已跳过",
        )
    # v25.13 fix: identify 的 skipped / failed marker 也是 terminal — 永远不会变
    # ready(没音频 / 服务异常 等),早返回让 FE 停止轮询.之前误把它当 pending,
    # FE 每次进会议页 polling 4s × 75 attempts = 5 分钟,体验巨慢.
    if m.summary_md and m.summary_md.startswith("<!-- identify:skipped:"):
        msg_match = re.search(r"<!-- identify:skipped: (.*?) -->", m.summary_md, re.S)
        return SummaryOut(
            summary_md=None,
            status="skipped",
            message=(
                f"声纹识别已跳过:{msg_match.group(1)}" if msg_match else "声纹识别已跳过"
            ) + ".(纪要依赖识别结果,请录音后再开会)",
        )
    if m.summary_md and m.summary_md.startswith("<!-- identify:failed:"):
        msg_match = re.search(r"<!-- identify:failed: (.*?) -->", m.summary_md, re.S)
        return SummaryOut(
            summary_md=None,
            status="failed",
            message=(
                f"声纹识别失败:{msg_match.group(1)}" if msg_match else "声纹识别失败"
            ) + ".点「重新识别」可重试",
        )
    # 真 pending 仅:summary_md=None(会议还没结束/没跑过)
    return SummaryOut(summary_md=None, status="pending")


@router.post("/{meeting_id}/summary/regenerate", response_model=SummaryOut)
async def regenerate_meeting_summary(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)
    # Clear any prior content so the front-end's polling sees the regen state.
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(summary_md=None)
    )
    await session.commit()
    bg.add_task(generate_summary, m.id, force=True)
    return SummaryOut(summary_md=None, status="pending")


class CorrectSpeakerIn(BaseModel):
    speaker_user_id: uuid.UUID | None  # null = 标记为未识别


class CorrectSpeakerOut(BaseModel):
    line_id: int
    speaker_user_id: uuid.UUID | None
    speaker_name: str | None
    status: str


class ManualTranscriptIn(BaseModel):
    text: str
    speaker_user_id: uuid.UUID | None = None


class ManualTranscriptOut(BaseModel):
    line_id: int
    speaker_user_id: uuid.UUID | None
    speaker_name: str | None
    text: str


@router.post("/{meeting_id}/manual-transcript", response_model=ManualTranscriptOut)
async def post_manual_transcript(
    meeting_id: str,
    payload: ManualTranscriptIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Type-a-message endpoint. Same pipeline as a finalized ASR sentence:
    persists a transcript row + fires Agent triggers + dissent detection.

    Used by:
      - The frontend's "💬 文字录入" box when there's no live WebSocket
        attached (the live UX prefers the WS `text_message` action so the
        user sees their own message echoed instantly).
      - Claude Cowork / automation that wants to drive a meeting end-to-end
        without going through the mic / WebSocket stack.

    Speaker:
      - speaker_user_id is optional. When given, must belong to the same
        workspace as the caller; this is locked in with speaker_status
        'manual' so the post-meeting voiceprint identify pass won't
        overwrite it (same lock used by ✏️ in-meeting correction).
      - When omitted, the line is recorded as 未识别 (the caller can fix it
        later via /correct-speaker).

    Note on streaming visibility: Agent / dissent events fired by this
    endpoint go to a no-op sink (we have no WS attached). The Agent's
    persistent reply is still saved to `meeting_agent_message`, so it
    shows up in /result and the summary. Live page users on the same
    meeting WS DO see ALL events normally — but this endpoint is
    designed to be usable without one.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "text required")

    speaker_uuid = payload.speaker_user_id
    speaker_name: str | None = None
    if speaker_uuid is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == speaker_uuid,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "speaker_user_id not in this workspace")
        speaker_name = u.name

    line = MeetingTranscript(
        meeting_id=m.id,
        text=text,
        is_final=True,
        speaker_user_id=speaker_uuid,
        speaker_status="manual",
    )
    session.add(line)

    # v11 ISSUE-2: a meeting that's receiving transcripts is, by definition,
    # happening — flip 'scheduled' → 'ongoing' on first injection so
    # agenda_monitor's elapsed-time math has a sane baseline. ASR path does
    # the equivalent in main.py when the WS opens; this mirrors it for
    # mic-less / Cowork driven meetings.
    if m.status == "scheduled":
        m.status = "ongoing"
        m.started_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(line)

    # Fire-and-forget agent + dissent. on_message has nowhere to deliver
    # streaming chunks (this is a REST call, no socket), so use a no-op
    # sink. Agent message persistence still works inside the agent_router.
    async def _noop(_payload: dict) -> None:
        return None

    asyncio.create_task(maybe_invoke_agents(m.id, text, on_message=_noop))
    asyncio.create_task(maybe_detect_dissent(m.id, on_message=_noop))
    asyncio.create_task(maybe_check_agenda(m.id, on_message=_noop))

    return ManualTranscriptOut(
        line_id=line.id,
        speaker_user_id=speaker_uuid,
        speaker_name=speaker_name,
        text=text,
    )


@router.post(
    "/{meeting_id}/transcripts/{line_id}/correct-speaker",
    response_model=CorrectSpeakerOut,
)
async def correct_speaker(
    meeting_id: str,
    line_id: int,
    payload: CorrectSpeakerIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Manually re-attribute a transcript line to a specific user (or unset).

    Per blueprint §5.3: corrections are kept distinct from auto-recognized
    rows via the `speaker_status` column ('manually_corrected') so we can
    later regress identification quality on the corrected vs. auto split.
    """
    await _load_owned_meeting(meeting_id, session, auth)  # access check
    line = (
        await session.execute(
            select(MeetingTranscript).where(
                MeetingTranscript.meeting_id == meeting_id,
                MeetingTranscript.id == line_id,
            )
        )
    ).scalar_one_or_none()
    if not line:
        raise HTTPException(404, "transcript line not found")

    name: str | None = None
    if payload.speaker_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.speaker_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(404, "user not found")
        name = u.name

    line.speaker_user_id = payload.speaker_user_id
    line.speaker_label = "manually_corrected" if payload.speaker_user_id else "UNKNOWN"
    line.speaker_status = "manually_corrected" if payload.speaker_user_id else "manually_unset"
    line.confidence = 1.0 if payload.speaker_user_id else None
    await session.commit()

    return CorrectSpeakerOut(
        line_id=line.id,
        speaker_user_id=line.speaker_user_id,
        speaker_name=name,
        status=line.speaker_status or "",
    )


# v25.11: 清掉 LLM 自动提取的 action items(history hallucination 用户可以一键删)
class WipeAutoActionsOut(BaseModel):
    deleted_actions: int
    deleted_tasks: int


@router.post(
    "/{meeting_id}/action-items/wipe-auto-extracted",
    response_model=WipeAutoActionsOut,
)
async def wipe_auto_extracted(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    清掉某场会议 由 LLM 自动提取的 action items(source_type='summary')+
    对应 dual-write 的 Task.手动添加的不删.

    解决场景:历史 hallucination 任务清理(例如 LLM 把 AI 专家建议
    抽成"任务"+ 编了 2024 假日期).
    """
    from sqlalchemy import delete as _delete
    m = await _load_owned_meeting(meeting_id, session, auth)

    # 先拿要删的 action items 的 task_ids
    actions = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == m.id,
                MeetingActionItem.source_type == "summary",
            )
        )
    ).scalars().all()
    task_ids = [a.task_id for a in actions if a.task_id]

    # 删 tasks
    deleted_tasks = 0
    if task_ids:
        res = await session.execute(_delete(Task).where(Task.id.in_(task_ids)))
        deleted_tasks = int(res.rowcount or 0)

    # 删 action items
    res = await session.execute(
        _delete(MeetingActionItem).where(
            MeetingActionItem.meeting_id == m.id,
            MeetingActionItem.source_type == "summary",
        )
    )
    deleted_actions = int(res.rowcount or 0)
    await session.commit()
    return WipeAutoActionsOut(
        deleted_actions=deleted_actions, deleted_tasks=deleted_tasks,
    )


# v25.18: ⚠️ 完整重置派生数据 — 比「清自动提取」更彻底
class ResetDerivedOut(BaseModel):
    deleted_actions: int
    deleted_tasks: int
    deleted_action_comments: int
    deleted_agent_messages: int
    deleted_speaker_segments: int
    deleted_notifications: int
    summary_cleared: bool
    regenerate_scheduled: bool


@router.post(
    "/{meeting_id}/derived/reset",
    response_model=ResetDerivedOut,
)
async def reset_derived_data(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.18: ⚠️ 把会议的【全部派生数据】清掉,然后从实录重跑 summary → action_extractor → tasks.

    比「🗑️ 清自动提取」更彻底:那个只清 source_type='summary' 的 action_item + task,
    但是 cron 跑过 due_reminder 产生的 notification 还在 notification 表里(没 FK
    关联,工作台 还能看到 "逾期 N 天" 的红点).

    本接口一次清干净 + 异步触发重跑.适合演示前的 reset 或 历史脏数据兜底.

    清(全部针对本场会议):
      - meeting.summary_md = NULL
      - meeting_action_item (所有 source_type) + 对应 task + 评论
      - meeting_agent_message (AI 专家发言)
      - meeting_speaker_segment (pyannote 切片)
      - notification (payload->>meeting_id 等于本场)

    保留:
      - meeting 本体 + agenda
      - meeting_attendee (参会名单)
      - meeting_transcript (实录,含已识别的 speaker_user_id)
      - voiceprint / user / workspace 等全局数据

    之后异步触发 generate_summary(force=True),它会自动链 action_extractor.
    前端在 SummaryCard 上轮询 /summary 端点即可看到新结果.
    """
    from sqlalchemy import delete as _delete
    m = await _load_owned_meeting(meeting_id, session, auth)
    mid_str = str(m.id)

    # 1) 拿要删的 action_items 的 task_ids 和 action_ids
    actions = (
        await session.execute(
            select(MeetingActionItem).where(MeetingActionItem.meeting_id == m.id)
        )
    ).scalars().all()
    action_ids = [a.id for a in actions]
    task_ids = [a.task_id for a in actions if a.task_id]

    # 2) 删 action_item_comment (action_item CASCADE 也行,但显式更稳)
    deleted_comments = 0
    if action_ids:
        res = await session.execute(
            _delete(MeetingActionItemComment).where(
                MeetingActionItemComment.action_item_id.in_(action_ids)
            )
        )
        deleted_comments = int(res.rowcount or 0)

    # 3) 删 task
    deleted_tasks = 0
    if task_ids:
        res = await session.execute(_delete(Task).where(Task.id.in_(task_ids)))
        deleted_tasks = int(res.rowcount or 0)

    # 4) 删 action_item
    res = await session.execute(
        _delete(MeetingActionItem).where(MeetingActionItem.meeting_id == m.id)
    )
    deleted_actions = int(res.rowcount or 0)

    # 5) 删 agent_message (AI 专家发言)
    res = await session.execute(
        _delete(MeetingAgentMessage).where(MeetingAgentMessage.meeting_id == m.id)
    )
    deleted_agent_messages = int(res.rowcount or 0)

    # 6) 删 speaker_segment (pyannote 输出)
    res = await session.execute(
        _delete(MeetingSpeakerSegment).where(MeetingSpeakerSegment.meeting_id == m.id)
    )
    deleted_speaker_segments = int(res.rowcount or 0)

    # 7) 删 notification (payload.meeting_id 等于本场;PG JSON ->> 操作符)
    # 注意:仅本场会议生出的通知,跨会议的通知不动.
    # 用 raw SQL 避开 SQLAlchemy JSON vs JSONB dialect 差异 — payload 列
    # 在 models.py 是 JSON (非 JSONB),只有 PG 的 ->> 运算符稳.
    from sqlalchemy import text as _sa_text
    res = await session.execute(
        _sa_text("DELETE FROM notification WHERE payload->>'meeting_id' = :mid"),
        {"mid": mid_str},
    )
    deleted_notifications = int(res.rowcount or 0)

    # 8) 清 summary_md (让 SummaryCard 显示 loading)
    await session.execute(
        update(Meeting).where(Meeting.id == m.id).values(summary_md=None)
    )

    await session.commit()

    # 9) 异步重跑 — generate_summary 内部会链式触发 action_extractor + memory_extractor
    bg.add_task(generate_summary, m.id, force=True)

    logger.info(
        "reset_derived meeting=%s actions=%d tasks=%d comments=%d agent_msgs=%d segments=%d notifs=%d",
        mid_str,
        deleted_actions,
        deleted_tasks,
        deleted_comments,
        deleted_agent_messages,
        deleted_speaker_segments,
        deleted_notifications,
    )

    return ResetDerivedOut(
        deleted_actions=deleted_actions,
        deleted_tasks=deleted_tasks,
        deleted_action_comments=deleted_comments,
        deleted_agent_messages=deleted_agent_messages,
        deleted_speaker_segments=deleted_speaker_segments,
        deleted_notifications=deleted_notifications,
        summary_cleared=True,
        regenerate_scheduled=True,
    )


# v25.10 Bug C: 批量纠正 — 「此后 N 句都改为此人」
class BatchCorrectIn(BaseModel):
    from_line_id: int          # 起始行 id(含)
    count: int                 # 改 N 句(含起始行)
    speaker_user_id: Optional[uuid.UUID] = None


class BatchCorrectOut(BaseModel):
    updated: int
    speaker_name: Optional[str] = None


@router.post(
    "/{meeting_id}/transcripts/batch-correct-speaker",
    response_model=BatchCorrectOut,
)
async def batch_correct_speaker(
    meeting_id: str,
    payload: BatchCorrectIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.10: 把 from_line_id 起 连续 N 句 transcript 都改为同一说话人(或 unset).

    解决场景:声纹引擎把幸世杰的连续 5-10 句话 误识为冯浪.用户 在第一句改对后,
    一键标记 "此后 N 句都是幸世杰" — 比逐条点 ✏️ 快 10x.
    """
    await _load_owned_meeting(meeting_id, session, auth)
    if payload.count < 1 or payload.count > 200:
        raise HTTPException(400, "count 必须在 1-200 之间")

    name: Optional[str] = None
    if payload.speaker_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.speaker_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(404, "user not found")
        name = u.name

    # 拿 起始行起 N 行
    lines = (
        await session.execute(
            select(MeetingTranscript)
            .where(
                MeetingTranscript.meeting_id == meeting_id,
                MeetingTranscript.id >= payload.from_line_id,
                MeetingTranscript.is_final.is_(True),
            )
            .order_by(MeetingTranscript.id)
            .limit(payload.count)
        )
    ).scalars().all()
    new_label = "manually_corrected" if payload.speaker_user_id else "UNKNOWN"
    new_status = "manually_corrected" if payload.speaker_user_id else "manually_unset"
    for line in lines:
        line.speaker_user_id = payload.speaker_user_id
        line.speaker_label = new_label
        line.speaker_status = new_status
        line.confidence = 1.0 if payload.speaker_user_id else None
    await session.commit()
    return BatchCorrectOut(updated=len(lines), speaker_name=name)


@router.get("/{meeting_id}/result", response_model=MeetingResultOut)
async def get_result(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    m = await _load_owned_meeting(meeting_id, session, auth)

    lines_raw = (
        await session.execute(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == m.id)
            .order_by(MeetingTranscript.id)
        )
    ).scalars().all()

    user_ids = {l.speaker_user_id for l in lines_raw if l.speaker_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}

    out_lines = [
        TranscriptLine(
            id=l.id,
            line_id=l.id,  # v11 QA ISSUE-1: canonical field, matches POST shape
            text=l.text,
            start_ms=l.start_ms,
            end_ms=l.end_ms,
            speaker_user_id=l.speaker_user_id,
            speaker_label=l.speaker_label,
            speaker_name=name_by_id.get(l.speaker_user_id) if l.speaker_user_id else None,
            speaker_status=l.speaker_status,
            confidence=l.confidence,
        )
        for l in lines_raw
    ]

    # decode identification status
    status = "pending"
    msg: str | None = None
    if m.status == "processed":
        status = "ready"
    elif m.status == "finished":
        status = "running"
    if m.summary_md and (mt := _STATUS_RE.search(m.summary_md)):
        status = mt.group(1)
        msg = mt.group(2)

    rows = (
        await session.execute(
            select(MeetingAttendee.user_id).where(
                MeetingAttendee.meeting_id == m.id, MeetingAttendee.user_id.is_not(None)
            )
        )
    ).all()

    return MeetingResultOut(
        meeting=_to_meeting_out(m, [r[0] for r in rows]),
        lines=out_lines,
        identification_status=status,
        identification_message=msg,
    )


# --------- v25.7-#4: 声纹识别 重跑 + 调试 ----------------------------------


class IdentifyRerunOut(BaseModel):
    started: bool
    note: str
    meeting_status: str


@router.post("/{meeting_id}/identify/rerun", response_model=IdentifyRerunOut)
async def rerun_identify_endpoint(
    meeting_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.7-#4: 手动重跑声纹识别(给 leader/admin 在会议详情页用).

    用途:测试时发现某个用户没识别 → 调阈值后 重跑 看新结果.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.status not in ("finished", "processed"):
        raise HTTPException(409, f"会议未结束(status={m.status}),无法重跑识别")

    # 重置为 finished + 清 summary 标记 让重新跑
    if m.status == "processed":
        await session.execute(
            update(Meeting).where(Meeting.id == m.id).values(status="finished")
        )
        await session.commit()

    bg.add_task(run_identify, m.id, final=True)
    return IdentifyRerunOut(
        started=True,
        note="已触发重新识别(后台跑,30-60s 后看 result 页)",
        meeting_status="finished",
    )


class IdentifyDebugSegment(BaseModel):
    label: str
    user_id: Optional[uuid.UUID] = None
    user_name: Optional[str] = None
    start_ms: int
    end_ms: int
    duration_ms: int
    confidence: float
    status: str  # auto_recognized / low_confidence / filtered_below_threshold


class IdentifyDebugOut(BaseModel):
    meeting_id: uuid.UUID
    pyannote_job_id: Optional[str]
    voiceprint_count: int
    voiceprints: list[dict]  # [{user_id, user_name, label}]
    segment_count_total: int
    segment_count_kept: int
    segments: list[IdentifyDebugSegment]
    transcript_lines: int
    transcript_with_speaker: int
    transcript_unknown: int
    threshold_used: float
    notes: list[str]


class OfflineAsrOut(BaseModel):
    started: bool
    task_id: Optional[str] = None
    sentences: int
    model: str
    elapsed_s: int
    next_step: str


@router.post("/{meeting_id}/offline-asr/rerun", response_model=OfflineAsrOut)
async def rerun_offline_asr_endpoint(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.8-#4: 触发离线 ASR 复跑 — 用 paraformer-v2(批量,非实时)
    重新转录会议录音,质量比 realtime 高 20-30%.

    阻塞调用(2-5 分钟,直到 DashScope 任务完成).返回后端会自动:
    1. 替换 final 实录
    2. 重跑 identify(对齐说话人)
    3. 触发 cleaner(LLM 修字)
    4. 重新生成 summary
    全流程总时长 4-8 分钟.成功响应后,前端 5 分钟后刷新看新纪要.
    """
    from ..offline_asr import OfflineASRError, rerun_offline_asr

    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.status not in ("finished", "processed"):
        raise HTTPException(409, f"会议未结束(status={m.status}),无法离线复跑")

    try:
        result = await rerun_offline_asr(m.id)
    except OfflineASRError as e:
        raise HTTPException(500, f"离线 ASR 失败: {e}")

    return OfflineAsrOut(
        started=True,
        task_id=result.get("task_id"),
        sentences=result["sentences"],
        model=result["model"],
        elapsed_s=result["elapsed_s"],
        next_step=result["next_step"],
    )


class HotWordsOut(BaseModel):
    attendee_names: list[str]
    agent_keywords: list[str]
    kb_titles: list[str]
    total: int
    suggestion: str


@router.get("/{meeting_id}/hot-words", response_model=HotWordsOut)
async def get_meeting_hot_words(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.8-#3: 列本会议自动收集的 hot words(参会人姓名 + agent.keywords + KB titles).

    用途:
      1. 用户拷贝列表 → 去 DashScope 控制台 创建 vocabulary → env 设
         DASHSCOPE_STT_VOCABULARY_ID → ASR 自动识别这些词
      2. 之后(可选)我们可以加 auto-vocab-create 端点
    """
    from ..hot_words import collect_hot_words

    m = await _load_owned_meeting(meeting_id, session, auth)
    hw = await collect_hot_words(m.id, include_kb_filenames=True)
    total = (
        len(hw["attendee_names"]) + len(hw["agent_keywords"]) + len(hw["kb_titles"])
    )
    return HotWordsOut(
        attendee_names=hw["attendee_names"],
        agent_keywords=hw["agent_keywords"],
        kb_titles=hw["kb_titles"],
        total=total,
        suggestion=(
            f"将以上 {total} 词整理到 DashScope 控制台 vocabulary 里,"
            f"然后 env 设 DASHSCOPE_STT_VOCABULARY_ID 即可让 ASR 优先识别"
        ),
    )


@router.get("/{meeting_id}/identify/debug", response_model=IdentifyDebugOut)
async def identify_debug(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25.7-#4: 声纹识别 debug 端点.

    返回:
      - 提交的 voiceprints(label / user_id / 用户名)
      - pyannote 返回的所有 segments(含 confidence / 是否被阈值过滤)
      - 实录行数 + 已贴说话人 / 未识别 数
    用途:测试时 立即看 哪个用户的 voiceprint 没命中 segment / 命中但 confidence 太低.
    """
    from ..identify_pipeline import (
        CONF_THRESHOLD, PYANNOTE_MATCH_THRESHOLD, MIN_SEGMENT_DURATION_MS,
    )

    m = await _load_owned_meeting(meeting_id, session, auth)

    # 拿 voiceprints (按 attendee user)
    attendees = (
        await session.execute(
            select(MeetingAttendee).where(
                MeetingAttendee.meeting_id == m.id,
                MeetingAttendee.user_id.is_not(None),
            )
        )
    ).scalars().all()
    user_ids = [a.user_id for a in attendees]
    users_by_id: dict[uuid.UUID, User] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        users_by_id = {u.id: u for u in users}

    from ..models import Voiceprint
    vp_rows = (
        await session.execute(
            select(Voiceprint).where(
                Voiceprint.user_id.in_(user_ids), Voiceprint.is_active.is_(True)
            )
        )
    ).scalars().all() if user_ids else []
    voiceprints_info = [
        {
            "user_id": str(vp.user_id),
            "user_name": users_by_id[vp.user_id].name if vp.user_id in users_by_id else "?",
            "label": f"u{str(vp.user_id)[:8]}-{users_by_id[vp.user_id].name if vp.user_id in users_by_id else 'user'}"[:100],
            "embedding_dim": len((vp.pyannote_payload or {}).get("voiceprint", []))
                if vp.pyannote_payload else 0,
        }
        for vp in vp_rows
    ]

    # 拿 segments(含 user_id NULL 的 — 这些是被 conf 阈值打掉的)
    seg_rows = (
        await session.execute(
            select(MeetingSpeakerSegment)
            .where(MeetingSpeakerSegment.meeting_id == m.id)
            .order_by(MeetingSpeakerSegment.start_ms)
        )
    ).scalars().all()
    segments_out: list[IdentifyDebugSegment] = []
    for s in seg_rows:
        dur = s.end_ms - s.start_ms
        if dur < MIN_SEGMENT_DURATION_MS:
            status_label = "filtered_too_short"
        elif s.user_id is None:
            status_label = "filtered_below_conf"
        else:
            status_label = "auto_recognized"
        u_name = users_by_id[s.user_id].name if s.user_id and s.user_id in users_by_id else None
        segments_out.append(IdentifyDebugSegment(
            label=s.label,
            user_id=s.user_id,
            user_name=u_name,
            start_ms=s.start_ms,
            end_ms=s.end_ms,
            duration_ms=dur,
            confidence=float(s.confidence or 0.0),
            status=status_label,
        ))

    # 实录统计
    line_rows = (
        await session.execute(
            select(MeetingTranscript).where(
                MeetingTranscript.meeting_id == m.id,
                MeetingTranscript.is_final.is_(True),
            )
        )
    ).scalars().all()
    n_lines = len(line_rows)
    n_with_speaker = sum(1 for l in line_rows if l.speaker_user_id is not None)

    # 提示信息
    notes: list[str] = []
    if not vp_rows:
        notes.append("⚠️ 没有声纹数据 — 需要参会人提前在 /enroll 录入声纹")
    if not seg_rows:
        notes.append("⚠️ pyannote 返回 0 segments — 可能音频未上传 / pyannote 服务异常")
    miss_users = set(user_ids) - {s.user_id for s in seg_rows if s.user_id}
    if miss_users:
        miss_names = [users_by_id[uid].name for uid in miss_users if uid in users_by_id]
        notes.append(
            f"⚠️ 这些用户的声纹未命中任何 segment: {', '.join(miss_names)} — "
            f"可能 confidence 全 < {PYANNOTE_MATCH_THRESHOLD},或他们没说话"
        )
    if n_lines > 0 and n_with_speaker == 0:
        notes.append("⚠️ 实录有内容但全部未识别 — 可能 align 阈值过严")

    return IdentifyDebugOut(
        meeting_id=m.id,
        pyannote_job_id=m.pyannote_job_id,
        voiceprint_count=len(vp_rows),
        voiceprints=voiceprints_info,
        segment_count_total=len(seg_rows),
        segment_count_kept=sum(1 for s in seg_rows if s.user_id is not None),
        segments=segments_out,
        transcript_lines=n_lines,
        transcript_with_speaker=n_with_speaker,
        transcript_unknown=n_lines - n_with_speaker,
        threshold_used=PYANNOTE_MATCH_THRESHOLD,
        notes=notes,
    )


# --------- M3.0: dev-only synchronous agenda-monitor trigger -----------------


class AgendaMonitorRunOut(BaseModel):
    fired: bool
    payload: Optional[dict] = None
    note: Optional[str] = None


@router.post("/{meeting_id}/agenda-monitor/run-now", response_model=AgendaMonitorRunOut)
async def run_agenda_monitor(
    meeting_id: str,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """
    Run the agenda monitor synchronously for this meeting, bypassing the
    60s throttle and 90s post-fire cooldown. Returns whatever banner the
    LLM produced (or note='no_signal' if it judged everything is fine).

    Per v11 QA report ISSUE-4: production runs the monitor on a 60s
    schedule which is impractical for CI / Cowork to verify. This
    endpoint provides deterministic on-demand triggering.

    Auth-gated like every other route (workspace ownership check on the
    meeting). Not gated on env — the monitor is read-only from the user's
    perspective, just an extra LLM call.
    """
    await _load_owned_meeting(meeting_id, session, auth)

    captured: list[dict] = []

    async def _capture(payload: dict) -> None:
        captured.append(payload)

    from ..agenda_monitor import maybe_check_agenda
    fired = await maybe_check_agenda(uuid.UUID(meeting_id), on_message=_capture, force=True)

    if fired is None:
        return AgendaMonitorRunOut(fired=False, note="no_signal_or_no_agenda")
    return AgendaMonitorRunOut(fired=True, payload=fired)


# ---------------------------------------------------------------------------
# v26.14-P5.1: 议程 进度 tracking + 主动 推进
# ---------------------------------------------------------------------------
# 老 议程 是 read-only strip 仅 显标题 + 预算分钟. 没人 知道 当前 进行 第几项,
# 没 切换 操作, 没 单项 计时. P5 把 议程 从 "看一下" 升级 到 "推进式 流程".
#
# 数据 模型 (Meeting):
#   current_agenda_idx: 当前 在 第 几项 (0-based). NULL = 未 设置 / 未开始.
#   agenda_progress: [{idx, started_at, ended_at, advanced_by_user_id, status}]
#                    顺序 跟 agenda 一致, 每 进过 一项 一条.
#
# ABAC (advance / jump):
#   - leader+ 总 可
#   - 会议 创建人 可
#   - 其他 → 403


class AgendaProgressItem(BaseModel):
    idx: int
    title: str
    time_budget_min: Optional[int] = None
    note: Optional[str] = None
    # 时间 戳 (NULL = 未 进过)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    # 计算 字段 — 实际 用时 (秒); 仍 在 进行 时 = now - started_at
    elapsed_seconds: Optional[int] = None
    # active | done | pending
    status: str
    advanced_by_user_id: Optional[uuid.UUID] = None


class AgendaProgressOut(BaseModel):
    current_idx: Optional[int] = None
    total_items: int
    is_complete: bool   # current_idx >= len(agenda) — 议程 全部 走完
    has_agenda: bool    # agenda 是否 设置 — 没设 时 前端 不 显 strip
    items: list[AgendaProgressItem]


class AgendaJumpIn(BaseModel):
    idx: int  # 跳 到 哪个 (0-based)


def _init_agenda_progress_if_needed(m: Meeting) -> bool:
    """v26.14-P5.1: 第一次 进入 一个 有 agenda 但 没 progress 的 会议 时 lazy init.

    返回 是否 mutated (caller 决定 是否 要 commit).
    """
    if not m.agenda or len(m.agenda) == 0:
        return False
    if m.current_agenda_idx is not None and m.agenda_progress:
        return False  # already initialized
    m.current_agenda_idx = 0
    m.agenda_progress = [
        {
            "idx": 0,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ended_at": None,
            "advanced_by_user_id": None,
            "status": "active",
        }
    ]
    return True


def _build_agenda_progress_out(m: Meeting) -> AgendaProgressOut:
    """v26.14-P5.1: 把 meeting 的 agenda + agenda_progress 拼成 前端 用 的 shape.

    每个 agenda 项 + 对应的 progress entry (若 有) → AgendaProgressItem.
    没 进过 的项 status='pending'. 已 done 的 计算 elapsed_seconds.
    """
    agenda = m.agenda or []
    progress_by_idx: dict[int, dict] = {}
    for p in (m.agenda_progress or []):
        try:
            progress_by_idx[int(p["idx"])] = p
        except (KeyError, ValueError, TypeError):
            continue

    now = datetime.now(timezone.utc)
    items: list[AgendaProgressItem] = []
    for i, agi in enumerate(agenda):
        prog = progress_by_idx.get(i)
        started_at = None
        ended_at = None
        status = "pending"
        advanced_by_user_id = None
        elapsed_seconds = None
        if prog:
            try:
                if prog.get("started_at"):
                    started_at = datetime.fromisoformat(prog["started_at"].replace("Z", "+00:00"))
                if prog.get("ended_at"):
                    ended_at = datetime.fromisoformat(prog["ended_at"].replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass
            status = prog.get("status") or "pending"
            uid = prog.get("advanced_by_user_id")
            if uid:
                try:
                    advanced_by_user_id = uuid.UUID(uid)
                except (ValueError, TypeError):
                    pass
            # 计算 elapsed
            if started_at:
                end = ended_at if ended_at else now
                delta = (end - started_at).total_seconds()
                elapsed_seconds = max(0, int(delta))

        items.append(
            AgendaProgressItem(
                idx=i,
                title=str(agi.get("title") or "").strip() or f"议程项 {i + 1}",
                time_budget_min=agi.get("time_budget_min"),
                note=agi.get("note"),
                started_at=started_at,
                ended_at=ended_at,
                elapsed_seconds=elapsed_seconds,
                status=status,
                advanced_by_user_id=advanced_by_user_id,
            )
        )

    return AgendaProgressOut(
        current_idx=m.current_agenda_idx,
        total_items=len(agenda),
        is_complete=(
            m.current_agenda_idx is not None and len(agenda) > 0 and m.current_agenda_idx >= len(agenda)
        ),
        has_agenda=len(agenda) > 0,
        items=items,
    )


async def _require_agenda_controller(
    session: AsyncSession, auth: AuthContext, m: Meeting,
) -> None:
    """v26.14-P5.1: ABAC 检查 — leader+ OR 会议 创建人 才可 推进/跳转 议程.

    跟 invite_meeting_agents 同套 — agenda 推进 是 房间 级别 决策.
    """
    if await is_leader_or_admin(session, auth):
        return
    if m.created_by_user_id is not None and m.created_by_user_id == auth.user.id:
        return
    raise HTTPException(
        403, "[权限不足] 仅 会议创建人 + leader / admin / owner 可推进 议程"
    )


@router.get("/{meeting_id}/agenda-progress", response_model=AgendaProgressOut)
async def get_agenda_progress(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P5.1: 拿 议程 进度 — 当前 idx + 各 项 时间 + status.

    Lazy init: status=ongoing + 有 agenda 但 没 progress 时 自动 初始化 第一项.
    任何 ws 成员 可看 (workspace 隔离 在 _load_owned_meeting).
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.status == "ongoing" and _init_agenda_progress_if_needed(m):
        await session.commit()
        await session.refresh(m)
    return _build_agenda_progress_out(m)


@router.post("/{meeting_id}/agenda-advance", response_model=AgendaProgressOut)
async def advance_agenda(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P5.1: 推进 到 下一议程项.

    行为:
      1. 当前 active 项 → ended_at = now, status = done
      2. 新 push 一项 {idx: cur+1, started_at: now, status: active}
      3. current_agenda_idx +1
      4. WS 广播 agenda_advanced
      5. audit_log 写 一条

    Rate-limit: 同 会议 30s 内 不能 重复 推进 (防 误点 / 多人 双触发).
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    await _require_agenda_controller(session, auth, m)

    if not m.agenda or len(m.agenda) == 0:
        raise HTTPException(400, "本场 会议 没 设议程, 无法 推进")
    if m.status != "ongoing":
        raise HTTPException(400, f"会议 当前 状态 是 {m.status}, 仅 ongoing 可 推进 议程")

    # lazy init 兜底 (一般 get 已经 init 了, 但 advance 也 自洽)
    _init_agenda_progress_if_needed(m)

    cur_idx = m.current_agenda_idx
    if cur_idx is None:
        cur_idx = 0
    if cur_idx >= len(m.agenda):
        raise HTTPException(400, "议程 已经 全部 走完, 无 下一项 可推进")

    progress = list(m.agenda_progress or [])

    # rate-limit: 上一次 推进 < 30s 内 → 拒
    now = datetime.now(timezone.utc)
    for p in progress:
        if p.get("idx") == cur_idx and p.get("started_at"):
            try:
                started = datetime.fromisoformat(p["started_at"].replace("Z", "+00:00"))
                if (now - started).total_seconds() < 30:
                    raise HTTPException(
                        429,
                        f"刚 进入 这项 不到 30 秒, 稍后 再推进 (剩 {int(30 - (now - started).total_seconds())} 秒)",
                    )
            except (ValueError, AttributeError):
                pass

    # 1+2: close 当前, open 下一项
    for p in progress:
        if p.get("idx") == cur_idx and p.get("status") == "active":
            p["ended_at"] = now.isoformat()
            p["status"] = "done"
            p["advanced_by_user_id"] = str(auth.user.id)
            break

    new_idx = cur_idx + 1
    # 只 在 还有 下一项 时 push 新 active 条; 走完 议程 就 只 bump idx (前端 据
    # current_idx >= total_items 显 "议程 已完成").
    if new_idx < len(m.agenda):
        progress.append(
            {
                "idx": new_idx,
                "started_at": now.isoformat(),
                "ended_at": None,
                "advanced_by_user_id": None,
                "status": "active",
            }
        )
    m.agenda_progress = progress
    m.current_agenda_idx = new_idx

    await session.commit()
    await session.refresh(m)

    # audit
    try:
        await audit_log(
            session,
            auth,
            "meeting.agenda.advance",
            target_type="meeting",
            target_id=str(m.id),
            payload={
                "from_idx": cur_idx,
                "to_idx": new_idx,
                "is_complete": new_idx >= len(m.agenda),
            },
        )
        await session.commit()
    except Exception:
        logger.exception("agenda advance audit failed (non-fatal)")

    # WS 广播
    try:
        await session_state.broadcast(
            m.id,
            {
                "type": "agenda_advanced",
                "from_idx": cur_idx,
                "to_idx": new_idx,
                "is_complete": new_idx >= len(m.agenda),
                "advanced_by_user_id": str(auth.user.id),
                "advanced_by_user_name": auth.user.name,
            },
        )
    except Exception:
        logger.exception("agenda_advanced broadcast failed (non-fatal)")

    return _build_agenda_progress_out(m)


@router.post("/{meeting_id}/agenda-jump", response_model=AgendaProgressOut)
async def jump_agenda(
    meeting_id: str,
    payload: AgendaJumpIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P5.1: 跳 到 任一 议程项 (非 顺序). 跳过的项 标 done, 目标项 active.

    跟 advance 同套 ABAC. 没 rate-limit (跳转 是 用户 明确 决策).
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    await _require_agenda_controller(session, auth, m)

    if not m.agenda or len(m.agenda) == 0:
        raise HTTPException(400, "本场 会议 没 设议程, 无法 跳转")
    if m.status != "ongoing":
        raise HTTPException(400, f"会议 当前 状态 是 {m.status}, 仅 ongoing 可 跳议程")

    target = payload.idx
    if target < 0 or target >= len(m.agenda):
        raise HTTPException(400, f"目标 idx {target} 超出 议程 范围 (0 ~ {len(m.agenda) - 1})")

    _init_agenda_progress_if_needed(m)

    cur_idx = m.current_agenda_idx
    if cur_idx is None:
        cur_idx = 0

    if target == cur_idx:
        # no-op — 已 在 这项
        return _build_agenda_progress_out(m)

    progress = list(m.agenda_progress or [])
    now = datetime.now(timezone.utc)

    # 关 当前 active
    for p in progress:
        if p.get("status") == "active":
            p["ended_at"] = now.isoformat()
            p["status"] = "done"
            p["advanced_by_user_id"] = str(auth.user.id)

    # 给 target 找 一条 (没 就 push 一条)
    matched = False
    for p in progress:
        if p.get("idx") == target:
            # 重新 激活 — 老 ended_at 清掉, 老 started_at 留 (历史 痕迹) 不动
            # 但 status 设 active, ended_at 清
            p["ended_at"] = None
            p["status"] = "active"
            p["started_at"] = now.isoformat()  # 重新 计时
            matched = True
            break
    if not matched:
        progress.append(
            {
                "idx": target,
                "started_at": now.isoformat(),
                "ended_at": None,
                "advanced_by_user_id": str(auth.user.id),
                "status": "active",
            }
        )

    m.agenda_progress = progress
    m.current_agenda_idx = target

    await session.commit()
    await session.refresh(m)

    try:
        await audit_log(
            session,
            auth,
            "meeting.agenda.jump",
            target_type="meeting",
            target_id=str(m.id),
            payload={"from_idx": cur_idx, "to_idx": target},
        )
        await session.commit()
    except Exception:
        logger.exception("agenda jump audit failed (non-fatal)")

    try:
        await session_state.broadcast(
            m.id,
            {
                "type": "agenda_advanced",
                "from_idx": cur_idx,
                "to_idx": target,
                "is_complete": False,
                "advanced_by_user_id": str(auth.user.id),
                "advanced_by_user_name": auth.user.name,
            },
        )
    except Exception:
        logger.exception("agenda_advanced(jump) broadcast failed (non-fatal)")

    return _build_agenda_progress_out(m)


# ---------------------------------------------------------------------------
# v26.14-P5.1 配套: 测试 工具 — /dev/inject-monitor-event
# ---------------------------------------------------------------------------
# Kimi 测 三档 偏题 UI 时 没 法 制造 真 离题 对话 (走 LLM 走 不通).
# 此 endpoint 直接 推 一个 合成 monitor event 到 WS, 跳过 filter + LLM.
# 让 前端 三档 banner / 抽屉 写入 / auto_summon 倒计时 都能 单测.
#
# ABAC: 仅 owner — 这是 dev 工具, 不应 给 普通 user.


class DevInjectMonitorEventIn(BaseModel):
    event_type: str  # agenda_off_topic | agenda_stuck | agenda_time_warning | agenda_advance_suggested
    # off_topic 用:
    off_topic_severity: Optional[str] = None  # suspected | confirmed | severe
    off_topic_summary: Optional[str] = None
    current_agenda_item: Optional[str] = None
    suggested_agenda_item: Optional[str] = None
    # stuck 用:
    stuck_summary: Optional[str] = None
    auto_summon_after_s: Optional[int] = None
    # time_warning 用:
    time_warning_text: Optional[str] = None
    elapsed_min: Optional[int] = None
    # v26.14-P5.3 advance_suggested 用:
    advance_reason: Optional[str] = None
    next_agenda_item: Optional[str] = None
    current_agenda_idx: Optional[int] = None
    next_agenda_idx: Optional[int] = None
    # v26.14-P6.3 decision_summary 用:
    decision_brief: Optional[str] = None
    decision_summary_query: Optional[str] = None
    # 通用:
    reason: Optional[str] = None


@router.post("/{meeting_id}/dev/inject-monitor-event")
async def dev_inject_monitor_event(
    meeting_id: str,
    payload: DevInjectMonitorEventIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P5.1: 测试 工具 — 直接 推 一个 合成 monitor event 到 WS, 跳 LLM.

    Kimi 用. 仅 leader+ (owner / admin / leader) 可调.
    """
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "[dev tool] 仅 leader / admin / owner 可调用")

    m = await _load_owned_meeting(meeting_id, session, auth)

    # 拿 workspace 的 moderator agent (合成 event 需 它的 id/name/color)
    moderator = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == m.workspace_id,
                Agent.role == "moderator",
                Agent.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if moderator is None:
        raise HTTPException(400, "workspace 没 moderator agent, 无法 合成 event")

    moderator_fields = {
        "moderator_agent_id": str(moderator.id),
        "moderator_agent_name": moderator.name,
        "moderator_agent_nickname": moderator.nickname,
        "moderator_agent_color": moderator.color or "amber",
    }

    et = payload.event_type
    reason = (payload.reason or "[dev inject]")[:80]
    synthetic: dict = {**moderator_fields, "reason": reason}

    if et == "agenda_off_topic":
        synthetic.update(
            {
                "type": "agenda_off_topic",
                "off_topic_severity": payload.off_topic_severity or "confirmed",
                "off_topic_summary": payload.off_topic_summary or "[dev] 测试 偏题 摘要",
                "current_agenda_item": payload.current_agenda_item,
                "suggested_agenda_item": payload.suggested_agenda_item,
                "auto_summon_after_s": payload.auto_summon_after_s,
            }
        )
    elif et == "agenda_stuck":
        synthetic.update(
            {
                "type": "agenda_stuck",
                "stuck_summary": payload.stuck_summary or "[dev] 测试 stuck 摘要",
                "auto_summon_after_s": payload.auto_summon_after_s or 5,
            }
        )
    elif et == "agenda_time_warning":
        synthetic.update(
            {
                "type": "agenda_time_warning",
                "time_warning_text": payload.time_warning_text or "[dev] 测试 time warning",
                "elapsed_min": payload.elapsed_min or 10,
            }
        )
    elif et == "agenda_advance_suggested":
        synthetic.update(
            {
                "type": "agenda_advance_suggested",
                "advance_reason": payload.advance_reason or "[dev] 测试 推进 建议",
                "current_agenda_item": payload.current_agenda_item,
                "next_agenda_item": payload.next_agenda_item,
                "current_agenda_idx": payload.current_agenda_idx,
                "next_agenda_idx": payload.next_agenda_idx,
            }
        )
    elif et == "agenda_decision_summary":
        # v26.14-P6.3
        synthetic.update(
            {
                "type": "agenda_decision_summary",
                "decision_brief": payload.decision_brief or "[dev] 测试 决策 收口",
                "decision_summary_query": payload.decision_summary_query
                    or "请你 作为 主持人, 帮 大家 把 几个 立场 列 一下, 建议 锁定 一个.",
                "current_agenda_item": payload.current_agenda_item,
                "auto_summon_after_s": payload.auto_summon_after_s or 12,
            }
        )
    else:
        raise HTTPException(400, f"不支持 的 event_type: {et}")

    try:
        await session_state.broadcast(m.id, synthetic)
    except Exception:
        logger.exception("dev inject broadcast failed")
        raise HTTPException(500, "WS 广播 失败")

    return {"ok": True, "injected": synthetic}


# ---------------------------------------------------------------------------
# v26.14-P5.4: 会议 全景 时间线 — minutes tab 用
# ---------------------------------------------------------------------------
# 会议 结束后, 给 用户 看 一遍 整场 怎么 走 的:
#   - 议程 各 项 的 实际 起止 + 用时
#   - 中间 触发 过 啥 AI 事件 (off_topic / stuck / advance_suggested / time_warning)
#   - 用户 自己 推进 / 跳转 议程 的 操作 时间戳
# 数据 源:
#   - meeting.agenda_progress (P5.1 写入)
#   - audit_log filter by target_id = meeting.id AND action LIKE 'agenda.%' OR
#     action LIKE 'meeting.agenda.%'
#
# ABAC: workspace 任何 成员 可看 (跟 GET /agenda-progress 一致).


class TimelineEvent(BaseModel):
    ts: datetime
    kind: str  # agenda_start | agenda_end | off_topic | stuck | time_warning
               # | advance_suggested | advance_action | jump_action
    label: str
    details: Optional[dict] = None


class MeetingTimelineOut(BaseModel):
    events: list[TimelineEvent]
    has_agenda: bool


def _format_audit_label(action: str, payload: dict) -> str:
    """v26.14-P5.4: 把 audit_log 行 转 一句 人话 timeline label."""
    if action == "agenda.agenda_off_topic":
        sev = payload.get("off_topic_severity") or "?"
        sev_label = {"suspected": "疑似", "confirmed": "确认", "severe": "严重"}.get(sev, sev)
        summary = payload.get("off_topic_summary") or payload.get("reason") or ""
        return f"⚠️ {sev_label} 偏题 — {summary}"
    if action == "agenda.agenda_stuck":
        summary = payload.get("stuck_summary") or payload.get("reason") or ""
        return f"🔄 讨论 陷入 僵局 — {summary}"
    if action == "agenda.agenda_time_warning":
        elapsed = payload.get("elapsed_min")
        text = payload.get("time_warning_text") or payload.get("reason") or ""
        return f"⏱ 时间 预警 — {text}{f' (已开会 {elapsed}m)' if elapsed else ''}"
    if action == "agenda.agenda_advance_suggested":
        reason = payload.get("advance_reason") or payload.get("reason") or ""
        nxt = payload.get("next_agenda_item")
        return f"🚀 AI 建议 推进 → 「{nxt}」 — {reason}" if nxt else f"🚀 AI 建议 推进 — {reason}"
    if action == "meeting.agenda.advance":
        from_idx = payload.get("from_idx")
        to_idx = payload.get("to_idx")
        is_complete = payload.get("is_complete")
        if is_complete:
            return f"✅ 议程 已完成 (推进 至 末项 之后)"
        return f"➡️ 推进 议程 {from_idx + 1 if from_idx is not None else '?'} → {to_idx + 1 if to_idx is not None else '?'}"
    if action == "meeting.agenda.jump":
        from_idx = payload.get("from_idx")
        to_idx = payload.get("to_idx")
        return f"↪ 跳转 议程 {from_idx + 1 if from_idx is not None else '?'} → {to_idx + 1 if to_idx is not None else '?'}"
    return action


@router.get("/{meeting_id}/timeline", response_model=MeetingTimelineOut)
async def get_meeting_timeline(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.14-P5.4: 会议 全景 时间线 — 议程 进度 + AI 事件 时序 合一.

    minutes tab (会议结束后) 顶部 渲. 任何 ws 成员 可看.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)

    events: list[TimelineEvent] = []

    # 1. 议程 进度 — 各 项 的 start / end
    for prog in (m.agenda_progress or []):
        try:
            idx = int(prog.get("idx"))
        except (TypeError, ValueError):
            continue
        agenda = m.agenda or []
        if idx < 0 or idx >= len(agenda):
            continue
        item = agenda[idx]
        title = (item.get("title") or "").strip() or f"议程项 {idx + 1}"
        budget = item.get("time_budget_min")

        if prog.get("started_at"):
            try:
                ts = datetime.fromisoformat(prog["started_at"].replace("Z", "+00:00"))
                events.append(TimelineEvent(
                    ts=ts,
                    kind="agenda_start",
                    label=f"▶️ 进入 议程 {idx + 1}: {title}",
                    details={"idx": idx, "title": title, "time_budget_min": budget},
                ))
            except (ValueError, AttributeError):
                pass

        if prog.get("ended_at"):
            try:
                end_ts = datetime.fromisoformat(prog["ended_at"].replace("Z", "+00:00"))
                start_ts = (
                    datetime.fromisoformat(prog["started_at"].replace("Z", "+00:00"))
                    if prog.get("started_at") else None
                )
                elapsed_min = int((end_ts - start_ts).total_seconds() / 60) if start_ts else None
                budget_str = f"/{budget}m 预算" if budget else ""
                used_str = f"用时 {elapsed_min}m{budget_str}" if elapsed_min is not None else ""
                events.append(TimelineEvent(
                    ts=end_ts,
                    kind="agenda_end",
                    label=f"✓ 完成 议程 {idx + 1}: {title}{f' ({used_str})' if used_str else ''}",
                    details={
                        "idx": idx, "title": title,
                        "elapsed_min": elapsed_min, "time_budget_min": budget,
                    },
                ))
            except (ValueError, AttributeError):
                pass

    # 2. AI 事件 + 用户 操作 — 拉 audit_log
    from ..models import AuditLog as _AuditLog
    from sqlalchemy import or_
    audit_rows = (
        await session.execute(
            select(_AuditLog).where(
                _AuditLog.target_id == str(m.id),
                or_(
                    _AuditLog.action.like("agenda.agenda_%"),
                    _AuditLog.action.like("meeting.agenda.%"),
                ),
            ).order_by(_AuditLog.ts)
        )
    ).scalars().all()

    for r in audit_rows:
        action = r.action
        # kind 映射 (剥前缀)
        if action.startswith("agenda.agenda_"):
            kind = action.replace("agenda.agenda_", "")  # off_topic / stuck / time_warning / advance_suggested
        elif action == "meeting.agenda.advance":
            kind = "advance_action"
        elif action == "meeting.agenda.jump":
            kind = "jump_action"
        else:
            kind = action
        events.append(TimelineEvent(
            ts=r.ts,
            kind=kind,
            label=_format_audit_label(action, r.payload or {}),
            details=r.payload or {},
        ))

    # 排序 by ts (Python sort 稳定 — 同时间 的 顺序 不变)
    events.sort(key=lambda e: e.ts)

    return MeetingTimelineOut(
        events=events,
        has_agenda=bool(m.agenda and len(m.agenda) > 0),
    )


class DissentRunNowOut(BaseModel):
    fired: bool
    payload: Optional[dict] = None
    note: Optional[str] = None


@router.post("/{meeting_id}/dissent-detector/run-now", response_model=DissentRunNowOut)
async def run_dissent_detector(
    meeting_id: str,
    auth: AuthContext = Depends(get_current_auth),
    session: AsyncSession = Depends(get_session),
):
    """
    Synchronous trigger for the dissent detector — analogous to
    `/agenda-monitor/run-now`. Bypasses the 25s throttle and 60s post-
    fire cooldown. Returns either the banner payload or a no-signal note.

    Useful for Cowork: inject a few opposing-view lines via
    /manual-transcript, then call this endpoint to deterministically
    drive the LLM check (production runs on a wall-clock cadence that's
    too slow for CI).
    """
    await _load_owned_meeting(meeting_id, session, auth)

    async def _noop(_payload: dict) -> None:
        return None

    fired = await maybe_detect_dissent(uuid.UUID(meeting_id), on_message=_noop, force=True)

    if fired is None:
        return DissentRunNowOut(fired=False, note="no_signal_or_no_named_speakers")
    return DissentRunNowOut(fired=True, payload=fired)


# --------- M3.0: action items CRUD --------------------------------------------


class ActionItemOut(BaseModel):
    id: uuid.UUID
    meeting_id: uuid.UUID
    content: str
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_name: Optional[str] = None
    assignee_name_hint: Optional[str] = None
    due_at: Optional[datetime] = None
    status: str
    source_type: str
    created_at: datetime
    updated_at: datetime
    # v25.14: 关联 Task 的状态信息(用户视角:行动项 + 流转 是一回事)
    task_id: Optional[uuid.UUID] = None
    task_status: Optional[str] = None
    task_assignee_name: Optional[str] = None
    task_co_assignees_count: int = 0
    # v25.15: 实录依据 — LLM 抽出待办时记下的纪要原文支撑句
    evidence_quote: Optional[str] = None
    # v25.19: 实录行号锚点 — 前端拿到后能 跳转 meeting?focus=ids 高亮 + 展开上下文
    evidence_anchor_line_ids: Optional[list[int]] = None
    # v26.0: 主责 AI 专家 — 任务真正的主人(科室专家)
    assignee_agent_id: Optional[uuid.UUID] = None
    assignee_agent_name: Optional[str] = None
    assignee_agent_color: Optional[str] = None
    # v26.0: 协办 AI 专家 ids (字符串数组)
    co_agent_ids: Optional[list[str]] = None
    co_agent_count: int = 0
    # v26.0: LLM 抽取时给的主题关键词 (用于诊断 + 后续重路由)
    topic_keywords: Optional[list[str]] = None


class ActionItemIn(BaseModel):
    content: str
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None


class ActionItemPatch(BaseModel):
    content: Optional[str] = None
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None
    status: Optional[str] = None  # open | done | cancelled


def _action_to_out(
    row: MeetingActionItem,
    name_by_id: dict[uuid.UUID, str],
    task_info_by_id: Optional[dict[uuid.UUID, dict]] = None,  # v25.14
    agent_info_by_id: Optional[dict[uuid.UUID, dict]] = None,  # v26.0
) -> ActionItemOut:
    ti = (task_info_by_id or {}).get(row.task_id) if row.task_id else None
    # v26.0: task.assignee_agent_id → agent info (name/color)
    agent_id = ti.get("assignee_agent_id") if ti else None
    ai = (agent_info_by_id or {}).get(agent_id) if agent_id else None
    co_agent_ids = ti.get("co_agent_ids") if ti else None
    topic_kws = None
    if ti and isinstance(ti.get("source_ref"), dict):
        topic_kws = ti["source_ref"].get("topic_keywords")
    return ActionItemOut(
        id=row.id,
        meeting_id=row.meeting_id,
        content=row.content,
        assignee_user_id=row.assignee_user_id,
        assignee_name=name_by_id.get(row.assignee_user_id) if row.assignee_user_id else None,
        assignee_name_hint=row.assignee_name_hint,
        due_at=row.due_at,
        status=row.status,
        source_type=row.source_type,
        created_at=row.created_at,
        updated_at=row.updated_at,
        task_id=row.task_id,
        task_status=ti["status"] if ti else None,
        task_assignee_name=ti["assignee_name"] if ti else None,
        task_co_assignees_count=ti["co_count"] if ti else 0,
        evidence_quote=row.evidence_quote,  # v25.15
        evidence_anchor_line_ids=row.evidence_anchor_line_ids,  # v25.19
        # v26.0
        assignee_agent_id=agent_id,
        assignee_agent_name=ai["name"] if ai else None,
        assignee_agent_color=ai["color"] if ai else None,
        co_agent_ids=co_agent_ids,
        co_agent_count=len(co_agent_ids) if co_agent_ids else 0,
        topic_keywords=topic_kws,
    )


@router.get("/{meeting_id}/actions", response_model=list[ActionItemOut])
async def list_action_items(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """List all action items for this meeting (auto-extracted + manual).

    v25.14: 同时拉每个 action 关联的 Task 的状态 + 主责姓名 + 协办数,
    让前端 「行动项」 cards 直接展示 流转,不必再去 /trace 二次拉.
    """
    await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingActionItem)
            .where(MeetingActionItem.meeting_id == meeting_id)
            .order_by(MeetingActionItem.created_at)
        )
    ).scalars().all()
    user_ids = {r.assignee_user_id for r in rows if r.assignee_user_id}
    # v25.14: 拉关联 Task 的状态
    task_ids = [r.task_id for r in rows if r.task_id]
    task_info_by_id: dict[uuid.UUID, dict] = {}
    agent_ids: set[uuid.UUID] = set()  # v26.0
    if task_ids:
        tasks = (
            await session.execute(select(Task).where(Task.id.in_(task_ids)))
        ).scalars().all()
        for t in tasks:
            if t.assignee_user_id:
                user_ids.add(t.assignee_user_id)
            if t.assignee_agent_id:  # v26.0
                agent_ids.add(t.assignee_agent_id)
            task_info_by_id[t.id] = {
                "status": t.status,
                "assignee_user_id": t.assignee_user_id,
                "assignee_agent_id": t.assignee_agent_id,    # v26.0
                "co_agent_ids": t.co_agent_ids,              # v26.0
                "co_count": len(t.co_assignees) if t.co_assignees else 0,
                "source_ref": t.source_ref,                  # v26.0 (topic_keywords)
            }
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    # v26.0: 拉 agent info (name, color)
    from ..models import Agent
    agent_info_by_id: dict[uuid.UUID, dict] = {}
    if agent_ids:
        agents = (
            await session.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        ).scalars().all()
        agent_info_by_id = {a.id: {"name": a.name, "color": a.color} for a in agents}
    # 把 assignee_name 注入 task_info
    for tid, info in task_info_by_id.items():
        aid = info.get("assignee_user_id")
        info["assignee_name"] = name_by_id.get(aid) if aid else None
    return [_action_to_out(r, name_by_id, task_info_by_id, agent_info_by_id) for r in rows]


# v23.5: 会议追溯链 ----------------------------------------------------------


class MeetingTraceTaskOut(BaseModel):
    """A Task that originated from this meeting."""
    task_id: uuid.UUID
    action_item_id: uuid.UUID  # 原会议 action item id(供老页面 deeplink)
    title: Optional[str] = None
    content: str
    status: str
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_name: Optional[str] = None
    due_at: Optional[datetime] = None
    co_assignees: list[uuid.UUID] = []
    data_classification: str = "general"
    created_at: datetime
    updated_at: datetime


class MeetingTraceOut(BaseModel):
    """
    v23.5 — 会议追溯链:这次会议产生了哪些任务、它们现在的状态.

    只展示「meeting → task」一层(被引用关系如「该 task 又被 X 任务引用」
    留 v24+).
    """
    meeting_id: uuid.UUID
    meeting_title: str
    tasks: list[MeetingTraceTaskOut] = []
    total: int = 0
    by_status: dict[str, int] = {}  # 'open': 3, 'done': 5, ...


@router.get("/{meeting_id}/trace", response_model=MeetingTraceOut)
async def get_meeting_trace(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v23.5: 这次会议沉淀了哪些 Task + 它们现在的状态.

    workspace 内任何成员可看(沿用 _load_owned_meeting 的 workspace 隔离).
    Task 自身分级在 /api/me/tasks/{tid}/detail 时再细查 — trace 列表是
    元数据,不展示敏感正文.

    流程:Meeting → MeetingActionItem(meeting_id) → Task(via action_item.task_id)
    """
    m = await _load_owned_meeting(meeting_id, session, auth)

    # MeetingActionItem.task_id 在 v17 后是必填(虽然字段还是 nullable),
    # 一对一映射到 Task.
    action_rows = (
        await session.execute(
            select(MeetingActionItem)
            .where(
                MeetingActionItem.meeting_id == m.id,
                MeetingActionItem.task_id.is_not(None),
            )
            .order_by(MeetingActionItem.created_at)
        )
    ).scalars().all()

    if not action_rows:
        return MeetingTraceOut(
            meeting_id=m.id, meeting_title=m.title or "未命名会议", tasks=[], total=0, by_status={}
        )

    task_ids = [a.task_id for a in action_rows if a.task_id]
    task_by_id: dict[uuid.UUID, Task] = {}
    if task_ids:
        trows = (
            await session.execute(
                select(Task).where(Task.id.in_(task_ids), Task.workspace_id == m.workspace_id)
            )
        ).scalars().all()
        task_by_id = {t.id: t for t in trows}

    # 收集所有 assignee user_id 一次解析名字
    user_ids: set[uuid.UUID] = set()
    for t in task_by_id.values():
        if t.assignee_user_id:
            user_ids.add(t.assignee_user_id)
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        urows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {uid: nm for uid, nm in urows}

    out_tasks: list[MeetingTraceTaskOut] = []
    by_status: dict[str, int] = {}
    for ai in action_rows:
        t = task_by_id.get(ai.task_id) if ai.task_id else None
        if t is None:
            continue
        co_uuids: list[uuid.UUID] = []
        for s in (t.co_assignees or []):
            try:
                co_uuids.append(uuid.UUID(s))
            except (TypeError, ValueError):
                continue
        out_tasks.append(
            MeetingTraceTaskOut(
                task_id=t.id,
                action_item_id=ai.id,
                title=t.title,
                content=t.content,
                status=t.status,
                assignee_user_id=t.assignee_user_id,
                assignee_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
                due_at=t.due_at,
                co_assignees=co_uuids,
                data_classification=t.data_classification or "general",
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
        by_status[t.status] = by_status.get(t.status, 0) + 1

    return MeetingTraceOut(
        meeting_id=m.id,
        meeting_title=m.title or "未命名会议",
        tasks=out_tasks,
        total=len(out_tasks),
        by_status=by_status,
    )


@router.post("/{meeting_id}/actions", response_model=ActionItemOut)
async def create_action_item(
    meeting_id: str,
    payload: ActionItemIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Manually add a new action item (source_type='manual')."""
    m = await _load_owned_meeting(meeting_id, session, auth)
    if not payload.content.strip():
        raise HTTPException(400, "content required")
    if payload.assignee_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.assignee_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "assignee_user_id not in this workspace")
    row, _task = add_action_with_task(
        session,
        workspace_id=m.workspace_id,
        meeting_id=m.id,
        content=payload.content.strip()[:1000],
        assignee_user_id=payload.assignee_user_id,
        assignee_name_hint=None,
        due_at=payload.due_at,
        status="open",
        action_source_type="manual",
        created_by_user_id=auth.user.id,
    )
    await session.flush()
    # Theme 1: notify the assignee unless they're the caller themselves
    # (no self-notify — you know what you just did).
    if (
        row.assignee_user_id is not None
        and row.assignee_user_id != auth.user.id
    ):
        await emit_notification(
            session,
            workspace_id=m.workspace_id,
            user_id=row.assignee_user_id,
            kind="action_assigned",
            payload={
                "meeting_id": str(m.id),
                "meeting_title": m.title,
                "action_id": str(row.id),
                "task_id": str(row.task_id) if row.task_id else None,
                "content": row.content,
                "due_at": row.due_at.isoformat() if row.due_at else None,
                "assigned_by": auth.user.name,
            },
        )
    await session.commit()
    await session.refresh(row)
    name_by_id = {}
    if row.assignee_user_id:
        u = (
            await session.execute(select(User).where(User.id == row.assignee_user_id))
        ).scalar_one_or_none()
        if u:
            name_by_id[u.id] = u.name
    return _action_to_out(row, name_by_id)


@router.patch("/{meeting_id}/actions/{action_id}", response_model=ActionItemOut)
async def update_action_item(
    meeting_id: str,
    action_id: str,
    payload: ActionItemPatch,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Toggle done / edit content / change assignee or due date."""
    m = await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "action item not found")
    new_status: Optional[str] = None
    new_content: Optional[str] = None
    new_due_at_set = False
    new_due_at: Optional[datetime] = None
    new_assignee_set = False
    new_assignee: Optional[uuid.UUID] = None
    if payload.status is not None:
        if payload.status not in ("open", "done", "cancelled"):
            raise HTTPException(400, "status must be open|done|cancelled")
        row.status = payload.status
        new_status = payload.status
    if payload.content is not None:
        row.content = payload.content.strip()[:1000]
        new_content = row.content
    if payload.due_at is not None:
        row.due_at = payload.due_at
        new_due_at_set = True
        new_due_at = payload.due_at
    new_assignee_to_notify: Optional[uuid.UUID] = None
    if payload.assignee_user_id is not None:
        u = (
            await session.execute(
                select(User).where(
                    User.id == payload.assignee_user_id,
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not u:
            raise HTTPException(400, "assignee_user_id not in this workspace")
        # Notify only if it's actually a *change* and the new assignee
        # isn't the caller themselves (don't self-notify).
        if (
            row.assignee_user_id != payload.assignee_user_id
            and payload.assignee_user_id != auth.user.id
        ):
            new_assignee_to_notify = payload.assignee_user_id
        row.assignee_user_id = payload.assignee_user_id
        row.assignee_name_hint = None  # rebound — drop the freeform hint
        new_assignee_set = True
        new_assignee = payload.assignee_user_id
    # v17: mirror this patch onto the paired Task so /api/me/tasks and
    # other Task-side readers see the same state as ActionItem.
    await mirror_patch_to_task(
        session,
        row,
        content=new_content,
        assignee_user_id_set=new_assignee_set,
        assignee_user_id=new_assignee,
        due_at_set=new_due_at_set,
        due_at=new_due_at,
        status=new_status,
    )
    if new_assignee_to_notify is not None:
        await emit_notification(
            session,
            workspace_id=m.workspace_id,
            user_id=new_assignee_to_notify,
            kind="action_assigned",
            payload={
                "meeting_id": str(m.id),
                "meeting_title": m.title,
                "action_id": str(row.id),
                "task_id": str(row.task_id) if row.task_id else None,
                "content": row.content,
                "due_at": row.due_at.isoformat() if row.due_at else None,
                "assigned_by": auth.user.name,
            },
        )
    await session.commit()
    await session.refresh(row)
    name_by_id = {}
    if row.assignee_user_id:
        u = (
            await session.execute(select(User).where(User.id == row.assignee_user_id))
        ).scalar_one_or_none()
        if u:
            name_by_id[u.id] = u.name
    return _action_to_out(row, name_by_id)


@router.delete("/{meeting_id}/actions/{action_id}", status_code=204)
async def delete_action_item(
    meeting_id: str,
    action_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "action item not found")
    # v17: cascade-delete the paired Task. We delete the Task FIRST while the
    # FK from action_item.task_id → task.id is still set; the FK has
    # ondelete=SET NULL so it doesn't block. Then we delete the action.
    await delete_task_for_action(session, row)
    await session.delete(row)
    await session.commit()


# --------- Theme 1 (P0): action item comments + notify hooks ------------------


class ActionCommentOut(BaseModel):
    id: uuid.UUID
    action_item_id: uuid.UUID
    author_user_id: Optional[uuid.UUID] = None
    author_name: Optional[str] = None
    content: str
    created_at: datetime
    can_delete: bool = False  # True iff the caller authored this comment


class ActionCommentIn(BaseModel):
    content: str


@router.get(
    "/{meeting_id}/actions/{action_id}/comments",
    response_model=list[ActionCommentOut],
)
async def list_action_comments(
    meeting_id: str,
    action_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _load_owned_meeting(meeting_id, session, auth)
    # Verify the action belongs to this meeting (and therefore workspace).
    parent = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not parent:
        raise HTTPException(404, "action item not found")
    rows = (
        await session.execute(
            select(MeetingActionItemComment)
            .where(MeetingActionItemComment.action_item_id == action_id)
            .order_by(MeetingActionItemComment.created_at)
        )
    ).scalars().all()
    author_ids = {r.author_user_id for r in rows if r.author_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if author_ids:
        users = (
            await session.execute(select(User).where(User.id.in_(author_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    return [
        ActionCommentOut(
            id=r.id,
            action_item_id=r.action_item_id,
            author_user_id=r.author_user_id,
            author_name=name_by_id.get(r.author_user_id) if r.author_user_id else None,
            content=r.content,
            created_at=r.created_at,
            can_delete=(r.author_user_id == auth.user.id),
        )
        for r in rows
    ]


@router.post(
    "/{meeting_id}/actions/{action_id}/comments",
    response_model=ActionCommentOut,
)
async def create_action_comment(
    meeting_id: str,
    action_id: str,
    payload: ActionCommentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Append a progress note to an action item.

    Side effect: notify the assignee + every prior commenter (besides the
    caller themselves) with kind=`action_comment` so a comment thread keeps
    everyone who has touched it informed without manual @ mentions.
    """
    m = await _load_owned_meeting(meeting_id, session, auth)
    parent = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.id == action_id,
            )
        )
    ).scalar_one_or_none()
    if not parent:
        raise HTTPException(404, "action item not found")
    body = (payload.content or "").strip()
    if not body:
        raise HTTPException(400, "content required")
    body = body[:2000]  # hard cap; comments are notes, not essays

    row = MeetingActionItemComment(
        action_item_id=parent.id,
        author_user_id=auth.user.id,
        content=body,
    )
    session.add(row)
    await session.flush()

    # Build the audience: assignee + all prior commenters, minus the
    # current author (who knows what they just typed).
    audience: set[uuid.UUID] = set()
    if parent.assignee_user_id:
        audience.add(parent.assignee_user_id)
    prior_commenters = (
        await session.execute(
            select(MeetingActionItemComment.author_user_id)
            .where(
                MeetingActionItemComment.action_item_id == parent.id,
                MeetingActionItemComment.id != row.id,
                MeetingActionItemComment.author_user_id.isnot(None),
            )
            .distinct()
        )
    ).all()
    for (uid,) in prior_commenters:
        if uid is not None:
            audience.add(uid)
    audience.discard(auth.user.id)

    if audience:
        preview = body if len(body) <= 80 else body[:80] + "…"
        for uid in audience:
            await emit_notification(
                session,
                workspace_id=m.workspace_id,
                user_id=uid,
                kind="action_comment",
                payload={
                    "meeting_id": str(m.id),
                    "meeting_title": m.title,
                    "action_id": str(parent.id),
                    "task_id": str(parent.task_id) if parent.task_id else None,
                    "action_content": parent.content,
                    "comment_id": str(row.id),
                    "comment_preview": preview,
                    "author_name": auth.user.name,
                },
            )

    await session.commit()
    await session.refresh(row)
    return ActionCommentOut(
        id=row.id,
        action_item_id=row.action_item_id,
        author_user_id=row.author_user_id,
        author_name=auth.user.name,
        content=row.content,
        created_at=row.created_at,
        can_delete=True,
    )


@router.delete(
    "/{meeting_id}/actions/{action_id}/comments/{comment_id}",
    status_code=204,
)
async def delete_action_comment(
    meeting_id: str,
    action_id: str,
    comment_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Author-only delete. Per product decision: comments are deletable but
    not editable, so the audit trail isn't quietly rewritten.
    """
    await _load_owned_meeting(meeting_id, session, auth)
    row = (
        await session.execute(
            select(MeetingActionItemComment)
            .join(
                MeetingActionItem,
                MeetingActionItem.id == MeetingActionItemComment.action_item_id,
            )
            .where(
                MeetingActionItemComment.id == comment_id,
                MeetingActionItem.id == action_id,
                MeetingActionItem.meeting_id == meeting_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "comment not found")
    if row.author_user_id != auth.user.id:
        raise HTTPException(403, "[资源保护] 仅评论作者可删除此评论")
    await session.delete(row)
    await session.commit()


# --------- M3.0: Cowork-friendly Agent message reader -------------------------


class AgentCitationOut(BaseModel):
    """v24.3 #1: 单条 RAG 引用(KB chunk)."""
    chunk_id: str
    document_id: str
    document_filename: str
    chunk_index: int
    snippet: str
    distance: float


class AgentMessageOut(BaseModel):
    id: int
    agent_id: uuid.UUID
    text: str
    trigger: Optional[str] = None
    citations: list[AgentCitationOut] = []  # v24.3 #1
    created_at: datetime
    # v26.3-03: 线程化 + 议程索引
    reply_to_agent_message_id: Optional[int] = None
    agenda_idx: Optional[int] = None


@router.get("/{meeting_id}/agent-messages", response_model=list[AgentMessageOut])
async def list_agent_messages(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Persistent record of every Agent reply produced in this meeting.

    Streaming chunks during a live WS session can be assembled by listening
    for `agent_message_*` events; this endpoint is the post-hoc transcript
    of those replies, useful when:
      - The meeting has ended and you want to audit who said what
      - You're driving via REST only (Cowork) and want to verify the
        keyword/@-mention/manual triggers actually fired the right Agent
    """
    await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingAgentMessage)
            .where(MeetingAgentMessage.meeting_id == meeting_id)
            .order_by(MeetingAgentMessage.id)
        )
    ).scalars().all()
    out: list[AgentMessageOut] = []
    for r in rows:
        cits: list[AgentCitationOut] = []
        if isinstance(r.citations, list):
            for c in r.citations:
                if not isinstance(c, dict):
                    continue
                try:
                    cits.append(AgentCitationOut(**c))
                except Exception:
                    pass  # legacy / malformed shapes — skip
        out.append(
            AgentMessageOut(
                id=r.id,
                agent_id=r.agent_id,
                text=r.text,
                trigger=r.trigger,
                citations=cits,
                created_at=r.created_at,
                reply_to_agent_message_id=r.reply_to_agent_message_id,
                agenda_idx=r.agenda_idx,
            )
        )
    return out


# v26.3-03: 议程项 共识 + 分歧 list (auto 会议)


class ConsensusOut(BaseModel):
    id: uuid.UUID
    agenda_idx: int
    agenda_title: Optional[str] = None
    consensus_md: Optional[str] = None
    dissents: list[dict] = []
    needs_human_review: bool = False
    reviewed_by_user_id: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    review_decision: Optional[str] = None
    turn_count: Optional[int] = None
    token_estimate: Optional[int] = None
    elapsed_sec: Optional[float] = None
    created_at: datetime


@router.get("/{meeting_id}/consensus", response_model=list[ConsensusOut])
async def list_meeting_consensus(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.3-03: 拉所有议程项的 共识 + 分歧.UI 弹"分歧待裁决"横幅用."""
    from ..models import MeetingConsensus
    await _load_owned_meeting(meeting_id, session, auth)
    rows = (
        await session.execute(
            select(MeetingConsensus).where(
                MeetingConsensus.meeting_id == meeting_id
            ).order_by(MeetingConsensus.agenda_idx)
        )
    ).scalars().all()
    return [
        ConsensusOut(
            id=r.id,
            agenda_idx=r.agenda_idx,
            agenda_title=r.agenda_title,
            consensus_md=r.consensus_md,
            dissents=r.dissents or [],
            needs_human_review=r.needs_human_review,
            reviewed_by_user_id=r.reviewed_by_user_id,
            reviewed_at=r.reviewed_at,
            review_decision=r.review_decision,
            turn_count=r.turn_count,
            token_estimate=r.token_estimate,
            elapsed_sec=r.elapsed_sec,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ============================================================================
# v26.3-07 · 召集人会后批量裁决分歧 (Q3=D 决策落地)
# ============================================================================


class ConsensusReviewItem(BaseModel):
    """单条 dissent 的裁决.dissent_idx 跟 MeetingConsensus.dissents 数组对齐."""
    dissent_idx: int
    action: str   # 'pick_a' | 'pick_b' | 'compromise' | 'defer' (Q1=A)
    rationale: str


class ConsensusReviewInput(BaseModel):
    """整议程的批量裁决.必须 覆盖 该议程的 所有 dissent (一锅端,避免半批)."""
    reviews: list[ConsensusReviewItem]


_REVIEW_ACTIONS: frozenset[str] = frozenset({"pick_a", "pick_b", "compromise", "defer"})
_REVIEW_RATIONALE_MIN_CHARS = 10


@router.post(
    "/{meeting_id}/consensus/{agenda_idx}/review",
    response_model=ConsensusOut,
)
async def review_meeting_consensus(
    meeting_id: str,
    agenda_idx: int,
    body: ConsensusReviewInput,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v26.3-07a (Q3=D · 会后批量裁决):召集人对一议程项里的所有 dissent 一次性裁决.

    - 权限 (Q5 实操化): workspace role in (owner, admin, leader) 才能裁决.
      (spec 原 Q5=A 仅 organizer,但 Meeting 无 organizer_user_id 字段,
       退一步到 leader 三角色.收口范围跟 spec 精神一致 — 不开放给 attendee.)
    - 校验:
      1. meeting.mode='auto' (hybrid 没有 consensus 表)
      2. consensus 行存在 + needs_human_review=True (无 dissent 不允许裁决)
      3. 未裁决过 (reviewed_at IS NULL) — 已裁决返 409 (本期不支持改判)
      4. reviews 数组 长度 == len(dissents) 且 dissent_idx 覆盖 0..N-1 不重复
      5. 每条 action ∈ {pick_a, pick_b, compromise, defer}
      6. 每条 rationale ≥ 10 字
    - 落库:
      - review_decision = json.dumps(reviews 数组)
      - reviewed_by_user_id, reviewed_at
      - needs_human_review 保持 True (历史可回看 "这是当时被裁决的分歧")
    - 副作用:
      - audit_log 'dissent.review'
      - fire-and-forget schedule_consensus_consolidate (沉淀回 涉及 agent 的 KB)
    """
    import json as _json
    from datetime import datetime, timezone

    from ..audit import audit_log
    from ..auth import is_leader_or_admin
    from ..models import MeetingConsensus

    # --- 1. 加载 meeting + 鉴权 ---
    m = await _load_owned_meeting(meeting_id, session, auth)
    if m.mode != "auto":
        raise HTTPException(400, f"only auto meetings have consensus to review (mode={m.mode})")
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "[权限不足] 裁决分歧仅 owner / admin / leader 可操作")

    # --- 2. 加载 consensus 行 ---
    row = (
        await session.execute(
            select(MeetingConsensus).where(
                MeetingConsensus.meeting_id == m.id,
                MeetingConsensus.agenda_idx == agenda_idx,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"consensus for agenda_idx={agenda_idx} not found")
    if not row.needs_human_review:
        raise HTTPException(400, "this agenda has no dissent to review")
    if row.reviewed_at is not None:
        raise HTTPException(
            409,
            f"already reviewed at {row.reviewed_at.isoformat()} by user "
            f"{row.reviewed_by_user_id}; re-review not supported in v26.3",
        )

    dissents = row.dissents or []
    if len(dissents) == 0:
        # 与 needs_human_review 不一致 — 防御性
        raise HTTPException(500, "consensus marks needs_review but dissents 数组为空 — 数据异常")

    # --- 3. 校验 reviews ---
    if len(body.reviews) != len(dissents):
        raise HTTPException(
            400,
            f"reviews 数 ({len(body.reviews)}) ≠ dissents 数 ({len(dissents)}); "
            "必须 一次裁决该议程全部 dissent (Q1 决策 4选1 + 必填理由)",
        )
    seen_idx: set[int] = set()
    for r in body.reviews:
        if r.action not in _REVIEW_ACTIONS:
            raise HTTPException(400, f"invalid action '{r.action}'; 允许:{sorted(_REVIEW_ACTIONS)}")
        if r.dissent_idx < 0 or r.dissent_idx >= len(dissents):
            raise HTTPException(400, f"dissent_idx {r.dissent_idx} 越界 (0..{len(dissents)-1})")
        if r.dissent_idx in seen_idx:
            raise HTTPException(400, f"dissent_idx {r.dissent_idx} 重复出现")
        seen_idx.add(r.dissent_idx)
        if len(r.rationale.strip()) < _REVIEW_RATIONALE_MIN_CHARS:
            raise HTTPException(
                400,
                f"dissent {r.dissent_idx} 的 rationale 太短 (≥ {_REVIEW_RATIONALE_MIN_CHARS} 字)",
            )

    # --- 4. 落库 ---
    review_payload = [
        {"dissent_idx": r.dissent_idx, "action": r.action, "rationale": r.rationale.strip()}
        for r in sorted(body.reviews, key=lambda x: x.dissent_idx)
    ]
    now = datetime.now(timezone.utc)
    row.review_decision = _json.dumps(review_payload, ensure_ascii=False)
    row.reviewed_by_user_id = auth.user.id
    row.reviewed_at = now
    await session.commit()
    await session.refresh(row)

    # --- 5. audit ---
    await audit_log(
        session,
        auth,
        "dissent.review",
        target_type="meeting_consensus",
        target_id=str(row.id),
        payload={
            "meeting_id": str(m.id),
            "agenda_idx": agenda_idx,
            "dissent_count": len(dissents),
            # review_payload 是 dict 列表 (上面转过了),不是 Pydantic 对象,所以用 r["action"]
            "actions": [r["action"] for r in review_payload],
        },
    )

    # --- 6. fire-and-forget 沉淀 ---
    try:
        from ..consensus_consolidator import schedule_consensus_consolidate
        schedule_consensus_consolidate(row.id)
    except Exception:
        import logging as _logging
        _logging.getLogger(__name__).exception(
            "schedule_consensus_consolidate 失败 (review 已落库,沉淀 missed)"
        )

    return ConsensusOut(
        id=row.id,
        agenda_idx=row.agenda_idx,
        agenda_title=row.agenda_title,
        consensus_md=row.consensus_md,
        dissents=row.dissents or [],
        needs_human_review=row.needs_human_review,
        reviewed_by_user_id=row.reviewed_by_user_id,
        reviewed_at=row.reviewed_at,
        review_decision=row.review_decision,
        turn_count=row.turn_count,
        token_estimate=row.token_estimate,
        elapsed_sec=row.elapsed_sec,
        created_at=row.created_at,
    )
