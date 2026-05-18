"""
v27.0-mobile · 移动端 H5 专用 endpoint.

设计 原则:
  - 仅 加 不 改: 老 桌面 endpoint 一概 不动. 移动端 需要 的 数据 形态 不同 →
    新 endpoint 聚合 / 改组. 共 同 后端 + DB.
  - 一次 拉全 (workbench): 移动端 网 不稳, 减 round-trip
  - 操作 wrapper: 一键 CTA 走 单 endpoint, 内部 复用 老 PATCH/POST

ABAC: 全 部 endpoint 走 老 get_current_auth, workspace 隔离 一致.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import (
    Agent,
    AIInsight,
    Meeting,
    MeetingActionItem,
    MeetingAgentMessage,
    MemoryDraft,
    User,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/m", tags=["mobile"])


# ============================================================================
# Shared schemas
# ============================================================================

class AIInsightBrief(BaseModel):
    """卡 内 紧凑版 — 一行 一条, 无 依据."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    agent_id: uuid.UUID
    agent_name: str
    agent_nickname: Optional[str] = None
    type: str  # 建议 | 风险 | 洞察 | 思路 | 决策建议
    content: str  # 一句话 结论


class AIInsightFull(AIInsightBrief):
    """详情 — 含 依据 + 来源."""
    evidence: Optional[str] = None
    meeting_id: uuid.UUID
    meeting_title: Optional[str] = None
    topic_idx: Optional[int] = None
    source_message_id: Optional[int] = None
    created_at: datetime


# ============================================================================
# /api/m/workbench — 首页 聚合
# ============================================================================

class WorkbenchOngoingMeeting(BaseModel):
    meeting_id: uuid.UUID
    title: str
    started_minutes_ago: int
    current_agenda_idx: Optional[int] = None
    total_agenda_items: int
    latest_insight: Optional[AIInsightBrief] = None  # 当前 议题 最新 1 条


class WorkbenchPendingTask(BaseModel):
    kind: str  # confirm | approve_draft | blocked
    id: str  # task_id / draft_id / etc
    title: str
    source_meeting_title: Optional[str] = None
    insights: list[AIInsightBrief] = []  # 0-3 条 紧凑 AI 判断
    cta_label: str  # 主 CTA 按钮 文案


class WorkbenchOut(BaseModel):
    ongoing_meetings: list[WorkbenchOngoingMeeting]
    pending: list[WorkbenchPendingTask]
    todays_insights: list[AIInsightFull]


@router.get("/workbench", response_model=WorkbenchOut)
async def get_workbench(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """首页 一次性 拉 全部 数据 — 进行中 会议 + 等我处理 + 今日 智囊产出."""
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)
    today_start = now - timedelta(hours=24)

    # 1. 进行中 会议 (ongoing) — 最多 5 场
    ongoing_rows = (
        await session.execute(
            select(Meeting)
            .where(Meeting.workspace_id == ws_id, Meeting.status == "ongoing")
            .order_by(desc(Meeting.started_at))
            .limit(5)
        )
    ).scalars().all()

    ongoing: list[WorkbenchOngoingMeeting] = []
    for m in ongoing_rows:
        started_min = int((now - m.started_at).total_seconds() / 60) if m.started_at else 0
        agenda_total = len(m.agenda or [])
        # 拉 这 场 当前 议程 项 下 最新 一 条 AI 智囊
        latest_insight: Optional[AIInsightBrief] = None
        cur_idx = m.current_agenda_idx
        insight_q = (
            select(AIInsight, Agent.name, Agent.nickname)
            .join(Agent, Agent.id == AIInsight.agent_id)
            .where(AIInsight.meeting_id == m.id)
            .order_by(desc(AIInsight.created_at))
            .limit(1)
        )
        if cur_idx is not None:
            insight_q = (
                select(AIInsight, Agent.name, Agent.nickname)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .where(AIInsight.meeting_id == m.id, AIInsight.topic_idx == cur_idx)
                .order_by(desc(AIInsight.created_at))
                .limit(1)
            )
        ins_row = (await session.execute(insight_q)).first()
        if ins_row:
            ins, a_name, a_nick = ins_row
            latest_insight = AIInsightBrief(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
            )
        ongoing.append(WorkbenchOngoingMeeting(
            meeting_id=m.id, title=m.title or "(未命名)",
            started_minutes_ago=started_min,
            current_agenda_idx=cur_idx, total_agenda_items=agenda_total,
            latest_insight=latest_insight,
        ))

    # 2. 等我处理 — 当前 用户 待 处理 的 三 类:
    #    (a) 我 assignee 的 open action items
    #    (b) 我 primary_user 的 pending memory drafts
    #    (c) 我 assignee 的 "blocked" action items (复用 a, 标 kind 不同)
    pending: list[WorkbenchPendingTask] = []

    # (a) action items
    action_rows = (
        await session.execute(
            select(MeetingActionItem, Meeting.title)
            .join(Meeting, Meeting.id == MeetingActionItem.meeting_id)
            .where(
                MeetingActionItem.workspace_id == ws_id,
                MeetingActionItem.assignee_user_id == auth.user.id,
                MeetingActionItem.status == "open",
            )
            .order_by(desc(MeetingActionItem.created_at))
            .limit(5)
        )
    ).all()
    for ai, m_title in action_rows:
        # 拉 该 议程 项 关联 的 AI 智囊 (最多 3 条)
        insights: list[AIInsightBrief] = []
        ins_rows = (
            await session.execute(
                select(AIInsight, Agent.name, Agent.nickname)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .where(AIInsight.meeting_id == ai.meeting_id)
                .order_by(desc(AIInsight.created_at))
                .limit(3)
            )
        ).all()
        for ins, a_name, a_nick in ins_rows:
            insights.append(AIInsightBrief(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
            ))
        pending.append(WorkbenchPendingTask(
            kind="confirm",
            id=str(ai.id),
            title=ai.content[:80],
            source_meeting_title=m_title,
            insights=insights,
            cta_label="确认 派发",
        ))

    # (b) pending memory drafts (primary_user = me)
    draft_rows = (
        await session.execute(
            select(MemoryDraft, Meeting.title)
            .outerjoin(Meeting, Meeting.id == MemoryDraft.source_meeting_id)
            .where(
                MemoryDraft.workspace_id == ws_id,
                MemoryDraft.primary_user_id == auth.user.id,
                MemoryDraft.status == "pending",
            )
            .order_by(desc(MemoryDraft.created_at))
            .limit(5)
        )
    ).all()
    for d, m_title in draft_rows:
        pending.append(WorkbenchPendingTask(
            kind="approve_draft",
            id=str(d.id),
            title=d.proposed_content[:80],
            source_meeting_title=m_title,
            insights=[],
            cta_label="开始 审",
        ))

    # 3. 今日 智囊 产出 — 过去 24h, 跟 我 相关 的 (在 我 参 的 会 中) — MVP 简化: workspace 全部
    insight_rows = (
        await session.execute(
            select(AIInsight, Agent.name, Agent.nickname, Meeting.title)
            .join(Agent, Agent.id == AIInsight.agent_id)
            .join(Meeting, Meeting.id == AIInsight.meeting_id)
            .where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
            )
            .order_by(desc(AIInsight.created_at))
            .limit(10)
        )
    ).all()
    todays_insights = [
        AIInsightFull(
            id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
            agent_nickname=a_nick, type=ins.type, content=ins.content,
            evidence=ins.evidence, meeting_id=ins.meeting_id,
            meeting_title=m_title, topic_idx=ins.topic_idx,
            source_message_id=ins.source_message_id, created_at=ins.created_at,
        )
        for ins, a_name, a_nick, m_title in insight_rows
    ]

    return WorkbenchOut(
        ongoing_meetings=ongoing,
        pending=pending,
        todays_insights=todays_insights,
    )


# ============================================================================
# /api/m/insights — 智囊 产出 列表 (三 视图 切换)
# ============================================================================

# ============================================================================
# /api/m/meetings/{id} — 单 场 会议 推进 视图 聚合
# ============================================================================

class MobileMeetingAgendaItem(BaseModel):
    idx: int
    title: str
    time_budget_min: Optional[int] = None
    status: str  # done | active | pending
    elapsed_min: Optional[int] = None


class MobileMeetingHumanLine(BaseModel):
    speaker_name: str  # 李局长 / 未识别
    text: str  # 实录 文本 (前 80 字)
    at_minute: int  # 距 会议 开始 多少 分钟


class MobileMeetingDetailOut(BaseModel):
    meeting_id: uuid.UUID
    title: str
    status: str
    started_minutes_ago: int
    can_control: bool  # 用户 是否 可 推进 议程 (leader+ OR 创建人)

    # 议程 全 视图
    agenda_items: list[MobileMeetingAgendaItem]
    current_agenda_idx: Optional[int] = None
    is_agenda_complete: bool = False

    # 当前 议题 详情
    current_topic_title: Optional[str] = None
    current_topic_elapsed_min: Optional[int] = None
    current_topic_insights: list[AIInsightFull] = []  # 当前 议题 的 AI 智囊
    current_topic_recent_lines: list[MobileMeetingHumanLine] = []  # 最近 N 条 真人 实录

    # 折 叠 计数
    transcript_total: int = 0
    other_topics_count: int = 0


@router.get("/meetings/{meeting_id}", response_model=MobileMeetingDetailOut)
async def get_mobile_meeting_detail(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile: 单 场 会议 推进 视图 聚合 endpoint.

    一 次 拉 全 — meta + agenda + current_topic_insights + recent_lines.
    移动 端 网 不稳 减 round-trip.
    """
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id,
                Meeting.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")

    now = datetime.now(timezone.utc)
    started_min = int((now - m.started_at).total_seconds() / 60) if m.started_at else 0

    # can_control: leader+ OR 创建人
    from ..auth import is_leader_or_admin
    can_control = await is_leader_or_admin(session, auth)
    if not can_control and m.created_by_user_id == auth.user.id:
        can_control = True

    # 议程 项 + progress 合 并
    agenda = m.agenda or []
    progress = m.agenda_progress or []
    progress_by_idx = {p.get("idx"): p for p in progress}

    agenda_items: list[MobileMeetingAgendaItem] = []
    for i, item in enumerate(agenda):
        p = progress_by_idx.get(i, {})
        status = p.get("status") or "pending"
        elapsed_min = None
        s = p.get("started_at")
        e = p.get("ended_at")
        try:
            if s:
                start_t = datetime.fromisoformat(s.replace("Z", "+00:00"))
                end_t = (
                    datetime.fromisoformat(e.replace("Z", "+00:00")) if e else now
                )
                elapsed_min = max(0, int((end_t - start_t).total_seconds() / 60))
        except (ValueError, AttributeError):
            pass
        agenda_items.append(MobileMeetingAgendaItem(
            idx=i,
            title=(item.get("title") or "").strip() or f"议程项 {i + 1}",
            time_budget_min=item.get("time_budget_min"),
            status=status,
            elapsed_min=elapsed_min,
        ))

    is_complete = (
        m.current_agenda_idx is not None
        and len(agenda) > 0
        and m.current_agenda_idx >= len(agenda)
    )

    # 当前 议题
    current_topic_title = None
    current_topic_elapsed_min = None
    current_topic_insights: list[AIInsightFull] = []
    current_topic_recent_lines: list[MobileMeetingHumanLine] = []
    cur_idx = m.current_agenda_idx

    if cur_idx is not None and not is_complete and 0 <= cur_idx < len(agenda):
        cur_item = agenda[cur_idx]
        current_topic_title = (cur_item.get("title") or "").strip() or f"议程项 {cur_idx + 1}"
        cur_progress = progress_by_idx.get(cur_idx, {})
        try:
            s = cur_progress.get("started_at")
            if s:
                start_t = datetime.fromisoformat(s.replace("Z", "+00:00"))
                current_topic_elapsed_min = max(0, int((now - start_t).total_seconds() / 60))
        except (ValueError, AttributeError):
            pass

        # AI 智囊 — 该 议题 全部 insights
        ins_rows = (
            await session.execute(
                select(AIInsight, Agent.name, Agent.nickname)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .where(
                    AIInsight.meeting_id == m.id,
                    AIInsight.topic_idx == cur_idx,
                )
                .order_by(desc(AIInsight.created_at))
            )
        ).all()
        for ins, a_name, a_nick in ins_rows:
            current_topic_insights.append(AIInsightFull(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
                evidence=ins.evidence, meeting_id=ins.meeting_id,
                meeting_title=m.title, topic_idx=ins.topic_idx,
                source_message_id=ins.source_message_id, created_at=ins.created_at,
            ))

        # 真 人 实录 — 该 议题 开始后 的 transcript lines
        # 简化: 取 该 议题 started_at 之后 的 最近 10 条
        from ..models import MeetingTranscript
        line_q = (
            select(MeetingTranscript, User.name)
            .outerjoin(User, User.id == MeetingTranscript.speaker_user_id)
            .where(MeetingTranscript.meeting_id == m.id)
            .order_by(desc(MeetingTranscript.id))
            .limit(10)
        )
        # 若 议题 有 started_at 则 filter by start_ms (简单 估 — start_ms 是 距 会议 开始 ms)
        cur_topic_start = cur_progress.get("started_at")
        if cur_topic_start and m.started_at:
            try:
                topic_t = datetime.fromisoformat(cur_topic_start.replace("Z", "+00:00"))
                offset_ms = int((topic_t - m.started_at).total_seconds() * 1000)
                line_q = line_q.where(MeetingTranscript.start_ms >= offset_ms - 5000)
            except (ValueError, AttributeError):
                pass
        line_rows = (await session.execute(line_q)).all()
        for line, speaker_name in reversed(line_rows):  # 时间 正序
            ms = line.start_ms or 0
            current_topic_recent_lines.append(MobileMeetingHumanLine(
                speaker_name=speaker_name or "未识别",
                text=(line.text or "")[:80],
                at_minute=max(0, int(ms / 60_000)),
            ))

    # transcript 总 数
    from ..models import MeetingTranscript
    transcript_total = (
        await session.execute(
            select(func.count(MeetingTranscript.id)).where(
                MeetingTranscript.meeting_id == m.id
            )
        )
    ).scalar() or 0

    other_topics_count = max(0, len(agenda) - (1 if cur_idx is not None else 0))

    return MobileMeetingDetailOut(
        meeting_id=m.id,
        title=m.title or "(未命名)",
        status=m.status,
        started_minutes_ago=started_min,
        can_control=can_control,
        agenda_items=agenda_items,
        current_agenda_idx=cur_idx,
        is_agenda_complete=is_complete,
        current_topic_title=current_topic_title,
        current_topic_elapsed_min=current_topic_elapsed_min,
        current_topic_insights=current_topic_insights,
        current_topic_recent_lines=current_topic_recent_lines,
        transcript_total=int(transcript_total),
        other_topics_count=other_topics_count,
    )


@router.get("/insights", response_model=list[AIInsightFull])
async def list_insights(
    by_agent: Optional[uuid.UUID] = Query(None),
    by_meeting: Optional[uuid.UUID] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """智囊 全部 产出 — 默认 按 时间 倒序, 可 按 专家 / 议题 筛."""
    q = (
        select(AIInsight, Agent.name, Agent.nickname, Meeting.title)
        .join(Agent, Agent.id == AIInsight.agent_id)
        .join(Meeting, Meeting.id == AIInsight.meeting_id)
        .where(AIInsight.workspace_id == auth.workspace.id)
        .order_by(desc(AIInsight.created_at))
        .limit(limit)
    )
    if by_agent:
        q = q.where(AIInsight.agent_id == by_agent)
    if by_meeting:
        q = q.where(AIInsight.meeting_id == by_meeting)

    rows = (await session.execute(q)).all()
    return [
        AIInsightFull(
            id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
            agent_nickname=a_nick, type=ins.type, content=ins.content,
            evidence=ins.evidence, meeting_id=ins.meeting_id,
            meeting_title=m_title, topic_idx=ins.topic_idx,
            source_message_id=ins.source_message_id, created_at=ins.created_at,
        )
        for ins, a_name, a_nick, m_title in rows
    ]
