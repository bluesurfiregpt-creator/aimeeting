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
