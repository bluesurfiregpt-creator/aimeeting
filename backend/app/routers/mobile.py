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

from ..audit import audit_log
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
    # v27.0-mobile P21 记忆模块金字塔:
    #   worth_remembering — AI 推荐"值得沉淀"
    #   human_decision   — 用户审批结果 (NULL/pending = 待审, accepted/rejected = 已决)
    worth_remembering: bool = False
    human_decision: Optional[str] = None


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
    """首页 一次性 拉 全部 数据 — 进行中 会议 + 等我处理 + 今日 智囊产出.

    P8 性能优化 (v27.0-mobile P8): 14 queries → 6 queries.
    旧版每场 ongoing/每条 action item 都嵌套 query insight (N+1), 5+5 场 = 10 子 query.
    新版批量 IN 拉所有相关 insight 一次, Python 侧分组.
    """
    ws_id = auth.workspace.id
    me_id = auth.user.id
    now = datetime.now(timezone.utc)
    today_start = now - timedelta(hours=24)

    # ===== 1. 进行中会议 + 等我处理 + 今日智囊 — 各拉一次 =====================

    # 1.a ongoing meetings
    ongoing_rows = (
        await session.execute(
            select(Meeting)
            .where(Meeting.workspace_id == ws_id, Meeting.status == "ongoing")
            .order_by(desc(Meeting.started_at))
            .limit(5)
        )
    ).scalars().all()

    # 1.b 我 assignee 的 open action items
    action_rows = (
        await session.execute(
            select(MeetingActionItem, Meeting.title)
            .join(Meeting, Meeting.id == MeetingActionItem.meeting_id)
            .where(
                MeetingActionItem.workspace_id == ws_id,
                MeetingActionItem.assignee_user_id == me_id,
                MeetingActionItem.status == "open",
            )
            .order_by(desc(MeetingActionItem.created_at))
            .limit(5)
        )
    ).all()

    # 1.c 我 primary_user 的 pending memory drafts
    draft_rows = (
        await session.execute(
            select(MemoryDraft, Meeting.title)
            .outerjoin(Meeting, Meeting.id == MemoryDraft.source_meeting_id)
            .where(
                MemoryDraft.workspace_id == ws_id,
                MemoryDraft.primary_user_id == me_id,
                MemoryDraft.status == "pending",
            )
            .order_by(desc(MemoryDraft.created_at))
            .limit(5)
        )
    ).all()

    # 1.d 今日全局 insights (过去 24h)
    todays_insight_rows = (
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

    # ===== 2. 批量拉 ongoing + action 涉及的 meeting 的 insights ============
    #
    # 老代码 5 个 ongoing × 1 insight query + 5 个 action × 1 insight query = 10 子 query.
    # 新做法: 收集所有相关 meeting_id, 一次 IN 查, Python 侧按 meeting_id 分组.

    relevant_meeting_ids: set[uuid.UUID] = set()
    for m in ongoing_rows:
        relevant_meeting_ids.add(m.id)
    for ai_item, _ in action_rows:
        if ai_item.meeting_id:
            relevant_meeting_ids.add(ai_item.meeting_id)

    insights_by_meeting: dict[uuid.UUID, list[tuple]] = {}
    if relevant_meeting_ids:
        ins_rows = (
            await session.execute(
                select(AIInsight, Agent.name, Agent.nickname)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .where(AIInsight.meeting_id.in_(relevant_meeting_ids))
                .order_by(desc(AIInsight.created_at))
                .limit(200)  # 5 会 × ~30 insight buffer 够
            )
        ).all()
        for ins, a_name, a_nick in ins_rows:
            insights_by_meeting.setdefault(ins.meeting_id, []).append(
                (ins, a_name, a_nick)
            )

    # ===== 3. 组装 ongoing meetings 输出 ====================================
    ongoing: list[WorkbenchOngoingMeeting] = []
    for m in ongoing_rows:
        started_min = int((now - m.started_at).total_seconds() / 60) if m.started_at else 0
        agenda_total = len(m.agenda or [])
        cur_idx = m.current_agenda_idx

        # Python 侧筛: 取该会议 (current topic 匹配) 的 latest insight.
        # 已按 created_at DESC 排, 找第一条 topic_idx 匹配的即可.
        latest_insight: Optional[AIInsightBrief] = None
        for ins, a_name, a_nick in insights_by_meeting.get(m.id, []):
            if cur_idx is not None and ins.topic_idx != cur_idx:
                continue
            latest_insight = AIInsightBrief(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
            )
            break

        ongoing.append(WorkbenchOngoingMeeting(
            meeting_id=m.id, title=m.title or "(未命名)",
            started_minutes_ago=started_min,
            current_agenda_idx=cur_idx, total_agenda_items=agenda_total,
            latest_insight=latest_insight,
        ))

    # ===== 4. 组装 pending (action items + drafts) ==========================
    pending: list[WorkbenchPendingTask] = []

    for ai_item, m_title in action_rows:
        # 每条 action 关联的 insights — 从 in-memory map 取 top 3.
        candidate = insights_by_meeting.get(ai_item.meeting_id, [])
        insights = [
            AIInsightBrief(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
            )
            for ins, a_name, a_nick in candidate[:3]
        ]
        pending.append(WorkbenchPendingTask(
            kind="confirm",
            id=str(ai_item.id),
            title=ai_item.content[:80],
            source_meeting_title=m_title,
            insights=insights,
            cta_label="确认 派发",
        ))

    for d, m_title in draft_rows:
        pending.append(WorkbenchPendingTask(
            kind="approve_draft",
            id=str(d.id),
            title=d.proposed_content[:80],
            source_meeting_title=m_title,
            insights=[],
            cta_label="开始 审",
        ))

    # ===== 5. 今日 insights 输出 ============================================
    todays_insights = [
        AIInsightFull(
            id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
            agent_nickname=a_nick, type=ins.type, content=ins.content,
            evidence=ins.evidence, meeting_id=ins.meeting_id,
            meeting_title=m_title, topic_idx=ins.topic_idx,
            source_message_id=ins.source_message_id, created_at=ins.created_at,
        )
        for ins, a_name, a_nick, m_title in todays_insight_rows
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
# /api/m/meetings — 会议列表 (按状态分组)
# ============================================================================

class MobileMeetingListRow(BaseModel):
    meeting_id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    minutes_total: Optional[int] = None  # 已开 or 总时长 (分钟)
    planned_minutes: Optional[int] = None  # 议程预算累计 (分钟); 没议程时 None
    agenda_total: int = 0
    current_agenda_idx: Optional[int] = None
    users_count: int = 0       # 真人参会人数 (MeetingAttendee.user_id)
    agents_count: int = 0      # AI 专家参会数 (MeetingAttendee.agent_id)
    insights_count: int = 0
    actions_count: int = 0


class MobileMeetingsListOut(BaseModel):
    items: list[MobileMeetingListRow]


@router.get("/meetings", response_model=MobileMeetingsListOut)
async def list_mobile_meetings(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile: 会议列表 — 进行中 + 即将开始 + 最近完成 (30天).

    前端按 status 分组. 排序: ongoing/scheduled 时间正序, finished/processed 时间倒序.
    """
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)

    # 拉 候选 meetings: 全部 ongoing + scheduled, 过去 30 天 finished/processed
    rows = (
        await session.execute(
            select(Meeting)
            .where(
                Meeting.workspace_id == ws_id,
                # 进行中/未开 永远拉; finished/processed 只 30 天内
                (
                    Meeting.status.in_(["ongoing", "scheduled"])
                    | ((Meeting.status.in_(["finished", "processed"])) & (Meeting.ended_at >= cutoff))
                ),
            )
            .order_by(desc(Meeting.started_at))
        )
    ).scalars().all()

    # P8 性能优化: 旧版每场会议 4 次子 query (users/agents/insights/actions count),
    # N 场会议 = 4N+1 queries. 用户实测 7 场 = 29 queries → 2.1s.
    # 新版: 4 次 GROUP BY 拿 meeting_id → count 字典, Python 侧 lookup.
    # = 5 queries 不管多少场会议.
    from ..models import MeetingActionItem, MeetingAttendee
    meeting_ids = [m.id for m in rows]

    users_count_map: dict[uuid.UUID, int] = {}
    agents_count_map: dict[uuid.UUID, int] = {}
    insights_count_map: dict[uuid.UUID, int] = {}
    actions_count_map: dict[uuid.UUID, int] = {}

    if meeting_ids:
        # 真人参会数 group by meeting
        u_rows = (
            await session.execute(
                select(MeetingAttendee.meeting_id, func.count(MeetingAttendee.id))
                .where(
                    MeetingAttendee.meeting_id.in_(meeting_ids),
                    MeetingAttendee.user_id.isnot(None),
                )
                .group_by(MeetingAttendee.meeting_id)
            )
        ).all()
        users_count_map = {mid: int(c) for mid, c in u_rows}

        # AI 参会数 group by meeting
        a_rows = (
            await session.execute(
                select(MeetingAttendee.meeting_id, func.count(MeetingAttendee.id))
                .where(
                    MeetingAttendee.meeting_id.in_(meeting_ids),
                    MeetingAttendee.agent_id.isnot(None),
                )
                .group_by(MeetingAttendee.meeting_id)
            )
        ).all()
        agents_count_map = {mid: int(c) for mid, c in a_rows}

        # insights count
        ins_rows_cnt = (
            await session.execute(
                select(AIInsight.meeting_id, func.count(AIInsight.id))
                .where(AIInsight.meeting_id.in_(meeting_ids))
                .group_by(AIInsight.meeting_id)
            )
        ).all()
        insights_count_map = {mid: int(c) for mid, c in ins_rows_cnt}

        # actions count
        act_rows_cnt = (
            await session.execute(
                select(MeetingActionItem.meeting_id, func.count(MeetingActionItem.id))
                .where(MeetingActionItem.meeting_id.in_(meeting_ids))
                .group_by(MeetingActionItem.meeting_id)
            )
        ).all()
        actions_count_map = {mid: int(c) for mid, c in act_rows_cnt}

    items: list[MobileMeetingListRow] = []
    for m in rows:
        # 时长 计算 — 实际
        minutes_total = None
        if m.status == "ongoing" and m.started_at:
            minutes_total = max(0, int((now - m.started_at).total_seconds() / 60))
        elif m.ended_at and m.started_at:
            minutes_total = max(0, int((m.ended_at - m.started_at).total_seconds() / 60))

        # 计划时长 — agenda 各项 time_budget_min 累加 (NULL 跳过)
        planned_minutes: Optional[int] = None
        if m.agenda:
            budget_sum = 0
            has_budget = False
            for it in m.agenda:
                v = it.get("time_budget_min") if isinstance(it, dict) else None
                if isinstance(v, (int, float)) and v > 0:
                    budget_sum += int(v)
                    has_budget = True
            if has_budget:
                planned_minutes = budget_sum

        users_n = users_count_map.get(m.id, 0)
        agents_n = agents_count_map.get(m.id, 0)
        insights_n = insights_count_map.get(m.id, 0)
        actions_n = actions_count_map.get(m.id, 0)

        items.append(MobileMeetingListRow(
            meeting_id=m.id,
            title=m.title or "(未命名)",
            status=m.status,
            started_at=m.started_at,
            ended_at=m.ended_at,
            minutes_total=minutes_total,
            planned_minutes=planned_minutes,
            agenda_total=len(m.agenda or []),
            current_agenda_idx=m.current_agenda_idx,
            users_count=int(users_n),
            agents_count=int(agents_n),
            insights_count=int(insights_n),
            actions_count=int(actions_n),
        ))

    return MobileMeetingsListOut(items=items)


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


class AgentMini(BaseModel):
    """会议中已邀请的 AI 专家, 给召 AI sheet 用. 紧凑字段."""
    agent_id: uuid.UUID
    name: str
    nickname: Optional[str] = None
    domain: Optional[str] = None
    color: Optional[str] = None
    role: str


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

    # v27.0-mobile P4.2: 已邀请的 AI 专家 (给召 AI sheet 用)
    attending_agents: list[AgentMini] = []

    # v1.4.0 Saga E.E (Sprint 2-3) AI 圆桌真协同 — mobile 端 也要 渲染 auto
    # 会议 orchestrator state. 不再 让 mobile 单独 拉 /orchestrate/state
    # endpoint (那是 desktop 用), 直接在 detail 聚合里 一次给.
    #   mode               — "hybrid" | "auto" | "human"
    #   orchestrate_phase  — auto 会议: idle / running / paused / done / failed / cancelled
    #                        非 auto 会议: None
    #   current_speaker_agent_id — orchestrator 当前发言的 agent_id (running 时高亮)
    mode: str = "hybrid"
    orchestrate_phase: Optional[str] = None
    current_speaker_agent_id: Optional[uuid.UUID] = None
    orchestrate_turn_count: int = 0
    orchestrate_completed_agenda_count: int = 0


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
    from ..models import MeetingTranscript, MeetingAttendee
    transcript_total = (
        await session.execute(
            select(func.count(MeetingTranscript.id)).where(
                MeetingTranscript.meeting_id == m.id
            )
        )
    ).scalar() or 0

    # v27.0-mobile P4.2: 拉已邀请的 AI 专家给召 AI sheet 用
    agent_rows = (
        await session.execute(
            select(Agent)
            .join(MeetingAttendee, MeetingAttendee.agent_id == Agent.id)
            .where(
                MeetingAttendee.meeting_id == m.id,
                Agent.is_active.is_(True),
            )
            .order_by(Agent.name)
        )
    ).scalars().all()
    attending_agents = [
        AgentMini(
            agent_id=a.id,
            name=a.name,
            nickname=a.nickname,
            domain=a.domain,
            color=a.color,
            role=a.role,
        )
        for a in agent_rows
    ]

    other_topics_count = max(0, len(agenda) - (1 if cur_idx is not None else 0))

    # v1.4.0 Saga E.E (Sprint 2-3): auto 会议 orchestrator state 一并返回 (避免
    # mobile 端 再 单独 polling /orchestrate/state). hybrid/human 模式 这些字段都是 None / 默认.
    orch_phase: Optional[str] = None
    cur_speaker: Optional[uuid.UUID] = None
    orch_turn = 0
    orch_completed = 0
    if (m.mode or "").lower() == "auto":
        st = m.auto_state or {}
        orch_phase = str(st.get("phase") or "idle")
        spk = st.get("current_speaker_agent_id")
        if spk:
            try:
                cur_speaker = uuid.UUID(str(spk))
            except (ValueError, TypeError):
                cur_speaker = None
        try:
            orch_turn = int(st.get("turn_count") or 0)
        except (ValueError, TypeError):
            orch_turn = 0
        # count consensus 行 = 已完成议程数
        from ..models import MeetingConsensus
        orch_completed = int(
            (
                await session.execute(
                    select(func.count()).select_from(MeetingConsensus).where(
                        MeetingConsensus.meeting_id == m.id
                    )
                )
            ).scalar_one() or 0
        )

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
        attending_agents=attending_agents,
        mode=(m.mode or "hybrid"),
        orchestrate_phase=orch_phase,
        current_speaker_agent_id=cur_speaker,
        orchestrate_turn_count=orch_turn,
        orchestrate_completed_agenda_count=orch_completed,
    )


# ============================================================================
# /api/m/meetings/{id}/summon — 召 AI 发言 (Phase 4.2)
# ============================================================================
#
# 桌面端走 WebSocket "action=invoke_agent". 移动端不走长连, 包一层 REST.
# 后端 fire-and-forget 触发 invoke_agent_directly, 返 202 立即返回. AI 回复
# 异步写入 MeetingAgentMessage, 前端等几秒后 refetch /api/m/meetings/{id} 就能
# 看到 (回复也会进 current_topic_insights, 若 LLM 抽出 structured insight).

class SummonAgentIn(BaseModel):
    agent_id: uuid.UUID
    query: Optional[str] = None  # 可选额外提示, 不给走默认 "请基于刚才讨论..."


class SummonAgentOut(BaseModel):
    accepted: bool = True
    agent_id: uuid.UUID
    agent_name: str


class StartMeetingOut(BaseModel):
    meeting_id: uuid.UUID
    status: str
    started_at: Optional[datetime] = None


@router.post("/meetings/{meeting_id}/start", response_model=StartMeetingOut)
async def start_mobile_meeting(
    meeting_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P9: 把会议从 scheduled → ongoing.

    桌面端是 WS connect 时自动改, mobile 端需要 explicit endpoint
    (避免依赖 WS 副作用, 创建后立即开始体验更顺).

    校验:
      - 会议在当前 workspace
      - 当前 status=scheduled (ongoing 时 no-op 返当前状态)
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
    if m.status in ("finished", "processed", "cancelled"):
        raise HTTPException(
            400,
            f"meeting status is {m.status}, can not start finished/processed meeting",
        )
    if m.status == "scheduled":
        m.status = "ongoing"
        now_ts = datetime.now(timezone.utc)
        m.started_at = now_ts
        # P14: 同时自动进议程第 1 项, 避免用户进会议室还要手动推进议程才能看到当前议题.
        # 如果 agenda 不空 且 current_agenda_idx 仍未设, 设第 1 项 active.
        if m.agenda and (m.current_agenda_idx is None):
            m.current_agenda_idx = 0
            m.agenda_progress = [{
                "idx": 0,
                "started_at": now_ts.isoformat(),
                "ended_at": None,
                "advanced_by_user_id": str(auth.user.id),
                "status": "active",
            }]
        await session.commit()
        await session.refresh(m)
    return StartMeetingOut(
        meeting_id=m.id,
        status=m.status,
        started_at=m.started_at,
    )


@router.post("/meetings/{meeting_id}/summon", response_model=SummonAgentOut)
async def summon_agent_in_meeting(
    meeting_id: uuid.UUID,
    payload: SummonAgentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """召 AI 发言 — 包桌面 invoke_agent_directly. fire-and-forget 模式.

    校验:
      - 会议存在 + 属于当前 workspace + status=ongoing
      - agent 存在 + 属于当前 workspace + is_active
      - agent 已被邀请到此会议 (MeetingAttendee.agent_id 命中)
    返回:
      - 202 风格, accepted=true 表示已派发. AI 回复异步写入 DB.
    """
    import asyncio
    from ..agent_router import invoke_agent_directly
    from ..models import MeetingAttendee

    ws_id = auth.workspace.id

    # 1. 校验会议
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id, Meeting.workspace_id == ws_id
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")
    if m.status != "ongoing":
        raise HTTPException(400, f"meeting status is {m.status}, only ongoing can summon AI")

    # 2. 校验 agent 存在 + 在 workspace
    a = (
        await session.execute(
            select(Agent).where(
                Agent.id == payload.agent_id,
                Agent.workspace_id == ws_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found or inactive")

    # 3. 校验已邀请 (避免随便召会议外的 agent)
    invited = (
        await session.execute(
            select(MeetingAttendee.id).where(
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.agent_id == payload.agent_id,
            )
        )
    ).scalar_one_or_none()
    if not invited:
        raise HTTPException(400, "agent not invited to this meeting")

    # 4. fire-and-forget. on_message 仅 log — 移动端通过 refetch 拿结果.
    async def _noop(_evt: dict) -> None:
        return None

    asyncio.create_task(
        invoke_agent_directly(
            meeting_id=meeting_id,
            agent_id=payload.agent_id,
            on_message=_noop,
            query=payload.query,
        )
    )

    return SummonAgentOut(
        accepted=True,
        agent_id=a.id,
        agent_name=a.name,
    )


# ============================================================================
# /api/m/tasks — 任务 闭环 视图
# ============================================================================
#
# 聚合 两 类:
#   - MeetingActionItem where assignee_user_id = me        (任务)
#   - MemoryDraft where primary_user_id = me + pending     (待审 草稿)
#
# 分 三 组:
#   pending  (默认 展开) — 待 你 处理: 待确认 / 待审 / 阻塞
#   tracking (折叠) — 跟踪 中: 已 派发 进行中 没 异常
#   done     (折叠) — 已 完成
#
# "其他 参与" — Phase 2 真接 (现 仅 返 count, 链 stub)


class MobileTaskItem(BaseModel):
    kind: str            # confirm | approve_draft | tracking | done
    id: str              # action_item.id OR memory_draft.id
    # P4.3: 数据源类型 — kind="done" 时两种实体共用 kind, 这个字段消歧.
    # action 类可跳 /m/tasks/<id> 详情; draft 类无详情页.
    source_kind: str = "action"  # "action" | "draft"
    title: str
    group: str           # pending | tracking | done
    source_meeting_id: Optional[uuid.UUID] = None
    source_meeting_title: Optional[str] = None
    created_at: datetime
    age_days: Optional[int] = None         # 任务 创建 至今 多少 天
    insights: list[AIInsightBrief] = []    # action_item 关联 AI 智囊 (前 3 条)
    cta_primary: Optional[str] = None      # 主 CTA 文案
    cta_secondary: Optional[str] = None    # 副 CTA 文案


class MobileTasksOut(BaseModel):
    me_primary_count: int
    other_participating_count: int  # stub — Phase 2 真接
    items: list[MobileTaskItem]


@router.get("/tasks", response_model=MobileTasksOut)
async def get_mobile_tasks(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile: 任务 闭环 视图. 我 主责 三 组."""
    ws_id = auth.workspace.id
    me_id = auth.user.id
    now = datetime.now(timezone.utc)

    items: list[MobileTaskItem] = []

    # ----- action items (我 是 assignee) ----------------------------------
    action_rows = (
        await session.execute(
            select(MeetingActionItem, Meeting.title, Meeting.id)
            .outerjoin(Meeting, Meeting.id == MeetingActionItem.meeting_id)
            .where(
                MeetingActionItem.workspace_id == ws_id,
                MeetingActionItem.assignee_user_id == me_id,
            )
            .order_by(desc(MeetingActionItem.created_at))
        )
    ).all()

    # P8 性能优化: 旧版每条 action 1 次 insight query (N+1 → 2.7s).
    # 新版: 批量 IN 一次拿所有相关 meeting 的 insights, Python 侧分组取 top 3.
    action_meeting_ids: set[uuid.UUID] = set()
    for ai, _m_title, m_id in action_rows:
        if m_id:
            action_meeting_ids.add(m_id)

    ins_by_meeting: dict[uuid.UUID, list[AIInsightBrief]] = {}
    if action_meeting_ids:
        all_ins = (
            await session.execute(
                select(AIInsight, Agent.name, Agent.nickname)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .where(AIInsight.meeting_id.in_(action_meeting_ids))
                .order_by(desc(AIInsight.created_at))
                .limit(500)  # N actions × 3 insights = ample buffer
            )
        ).all()
        for ins, a_name, a_nick in all_ins:
            ins_by_meeting.setdefault(ins.meeting_id, []).append(
                AIInsightBrief(
                    id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                    agent_nickname=a_nick, type=ins.type, content=ins.content,
                )
            )

    for ai, m_title, m_id in action_rows:
        age_days = max(0, int((now - ai.created_at).total_seconds() / 86400))
        # 关联 AI 智囊 — top 3 from in-memory map
        insights: list[AIInsightBrief] = []
        if m_id and m_id in ins_by_meeting:
            insights = ins_by_meeting[m_id][:3]

        if ai.status == "done":
            group = "done"
            kind = "done"
            cta_p = None
            cta_s = None
        elif ai.status == "cancelled":
            continue  # 跳过 已 取消
        else:
            # open — 进一步 分 待确认 vs 跟踪中
            #   < 2 天 + 无 task_id 转 dispatched → confirm
            #   else → tracking
            if age_days < 2:
                group = "pending"
                kind = "confirm"
                cta_p = "确认"
                cta_s = "驳回"
            else:
                group = "tracking"
                kind = "tracking"
                cta_p = None
                cta_s = None
        items.append(MobileTaskItem(
            kind=kind,
            id=str(ai.id),
            source_kind="action",
            title=ai.content[:80],
            group=group,
            source_meeting_id=m_id,
            source_meeting_title=m_title,
            created_at=ai.created_at,
            age_days=age_days,
            insights=insights,
            cta_primary=cta_p,
            cta_secondary=cta_s,
        ))

    # ----- memory drafts (我 是 primary_user) -----------------------------
    draft_rows = (
        await session.execute(
            select(MemoryDraft, Meeting.title, Meeting.id)
            .outerjoin(Meeting, Meeting.id == MemoryDraft.source_meeting_id)
            .where(
                MemoryDraft.workspace_id == ws_id,
                MemoryDraft.primary_user_id == me_id,
            )
            .order_by(desc(MemoryDraft.created_at))
        )
    ).all()
    for d, m_title, m_id in draft_rows:
        age_days = max(0, int((now - d.created_at).total_seconds() / 86400))
        if d.status == "approved":
            group = "done"
            kind = "done"
            cta_p = None
            cta_s = None
        elif d.status == "pending":
            group = "pending"
            kind = "approve_draft"
            cta_p = "通过"
            cta_s = "驳回"
        else:
            continue  # rejected / expired 不显
        items.append(MobileTaskItem(
            kind=kind,
            id=str(d.id),
            source_kind="draft",
            title=d.proposed_content[:80],
            group=group,
            source_meeting_id=m_id,
            source_meeting_title=m_title,
            created_at=d.created_at,
            age_days=age_days,
            insights=[],  # memory drafts 不挂 AI insights (草稿 本身 就 是 AI 抽 的)
            cta_primary=cta_p,
            cta_secondary=cta_s,
        ))

    # 排序: pending 优先 (按 created_at 倒序), 然后 tracking, 然后 done
    GROUP_ORDER = {"pending": 0, "tracking": 1, "done": 2}
    items.sort(key=lambda x: (GROUP_ORDER.get(x.group, 9), -x.created_at.timestamp()))

    me_primary = len([x for x in items if x.group != "done"]) + len(
        [x for x in items if x.group == "done"]
    )

    return MobileTasksOut(
        me_primary_count=me_primary,
        other_participating_count=0,  # Phase 2
        items=items,
    )


# ============================================================================
# /api/m/agents/workboard — AI 专家工卡墙
# ============================================================================
#
# 用户校准: A+B 合一 — 工卡列表, 每张卡含该专家最近产出. 移动端 "专家视角".
# 不展示大头像 / 不像通讯录, 走卡片+chip 的 native app 风.

class AgentRecentMeetingBrief(BaseModel):
    meeting_id: uuid.UUID
    title: str
    started_at: Optional[datetime] = None


class AgentTasksSummary(BaseModel):
    total: int = 0
    open_count: int = 0       # 进行中
    done_count: int = 0       # 已完成
    overdue_count: int = 0    # 已超期 (open + due_at < now)


class AgentWorkCardOut(BaseModel):
    agent_id: uuid.UUID
    name: str
    nickname: Optional[str] = None
    domain: Optional[str] = None
    color: Optional[str] = None
    role: str

    recent_meetings: list[AgentRecentMeetingBrief] = []  # 最近 3 场参加的会议
    tasks: AgentTasksSummary = AgentTasksSummary()       # 这个专家归属的任务汇总
    last_active: Optional[datetime] = None               # 最近一次产出 / 参会时间


class AgentsWorkboardOut(BaseModel):
    agents: list[AgentWorkCardOut]


@router.get("/agents/workboard", response_model=AgentsWorkboardOut)
async def get_agents_workboard(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile · v2: 专家工卡墙. 用户校准 — 不展示 AI 智囊产出,
    改展示参与和负责数据:
      - recent_meetings: 最近 3 场参加过的会议
      - tasks: 归属这个专家的任务汇总 (assignee_agent_id, 进行中/已完成/超期)

    排序: 活跃 (有 meeting 参与) 优先, 闲置沉底.
    """
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)

    # 拉 workspace 所有 active expert agents (排除 moderator 内置主持人)
    agents = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == ws_id,
                Agent.is_active.is_(True),
                Agent.role == "expert",
            )
        )
    ).scalars().all()

    # P8 性能优化: 旧版 N agents × 4 subqueries (meetings + tasks + last_meeting + last_insight)
    # = 4N + 1 queries. 31 agents 实测 = 125 queries → 3.4s.
    # 新版: 5 个批量 query (全部 IN + GROUP BY), Python 侧分组.
    from ..models import MeetingAttendee, Task as TaskModel

    agent_ids = [a.id for a in agents]
    OPEN_STATES = {"open", "dispatched", "accepted", "in_progress", "submitted"}
    DONE_STATES = {"done", "archived"}

    # 预填空 maps
    meetings_by_agent: dict[uuid.UUID, list[AgentRecentMeetingBrief]] = {
        aid: [] for aid in agent_ids
    }
    tasks_by_agent: dict[uuid.UUID, tuple[int, int, int]] = {
        aid: (0, 0, 0) for aid in agent_ids
    }  # (open, done, overdue)
    last_meeting_by_agent: dict[uuid.UUID, datetime] = {}
    last_insight_by_agent: dict[uuid.UUID, datetime] = {}

    if agent_ids:
        # Q1: 批量拉所有 agent 参加的会议 (一次 IN), Python 侧按 agent 分组 取 top 3.
        # 加 LIMIT 大数 避免单 agent 拉无数; 31 agents × top 3 = 93, 给 500 buffer.
        m_rows = (
            await session.execute(
                select(
                    MeetingAttendee.agent_id,
                    Meeting.id, Meeting.title, Meeting.started_at,
                )
                .join(MeetingAttendee, MeetingAttendee.meeting_id == Meeting.id)
                .where(
                    MeetingAttendee.agent_id.in_(agent_ids),
                    Meeting.workspace_id == ws_id,
                )
                .order_by(desc(Meeting.started_at))
                .limit(500)
            )
        ).all()
        for aid, mid, title, started_at in m_rows:
            cur = meetings_by_agent.setdefault(aid, [])
            if len(cur) < 3:  # 每 agent 取 top 3 (已按 started_at DESC)
                cur.append(AgentRecentMeetingBrief(
                    meeting_id=mid,
                    title=title or "(未命名)",
                    started_at=started_at,
                ))

        # Q2: 批量拿所有 agent 的 task 状态 + due_at — Python 侧统计 open/done/overdue.
        task_rows = (
            await session.execute(
                select(TaskModel.assignee_agent_id, TaskModel.status, TaskModel.due_at)
                .where(
                    TaskModel.workspace_id == ws_id,
                    TaskModel.assignee_agent_id.in_(agent_ids),
                )
            )
        ).all()
        # Python 侧 group
        for aid, status, due_at in task_rows:
            o, d, ov = tasks_by_agent.get(aid, (0, 0, 0))
            if status in OPEN_STATES:
                o += 1
                if due_at is not None and due_at < now:
                    ov += 1
            elif status in DONE_STATES:
                d += 1
            tasks_by_agent[aid] = (o, d, ov)

        # Q3: last_active 之 meeting source — group max
        lm_rows = (
            await session.execute(
                select(MeetingAttendee.agent_id, func.max(Meeting.started_at))
                .join(Meeting, Meeting.id == MeetingAttendee.meeting_id)
                .where(MeetingAttendee.agent_id.in_(agent_ids))
                .group_by(MeetingAttendee.agent_id)
            )
        ).all()
        last_meeting_by_agent = {aid: t for aid, t in lm_rows if t is not None}

        # Q4: last_active 之 insight source — group max
        li_rows = (
            await session.execute(
                select(AIInsight.agent_id, func.max(AIInsight.created_at))
                .where(AIInsight.agent_id.in_(agent_ids))
                .group_by(AIInsight.agent_id)
            )
        ).all()
        last_insight_by_agent = {aid: t for aid, t in li_rows if t is not None}

    cards: list[AgentWorkCardOut] = []
    for a in agents:
        open_n, done_n, overdue_n = tasks_by_agent.get(a.id, (0, 0, 0))
        total = open_n + done_n
        lm = last_meeting_by_agent.get(a.id)
        li = last_insight_by_agent.get(a.id)
        last_active: Optional[datetime] = None
        if lm and li:
            last_active = max(lm, li)
        elif lm:
            last_active = lm
        elif li:
            last_active = li

        cards.append(AgentWorkCardOut(
            agent_id=a.id,
            name=a.name,
            nickname=a.nickname,
            domain=a.domain,
            color=a.color,
            role=a.role,
            recent_meetings=meetings_by_agent.get(a.id, []),
            tasks=AgentTasksSummary(
                total=total,
                open_count=open_n,
                done_count=done_n,
                overdue_count=overdue_n,
            ),
            last_active=last_active,
        ))

    # 排序: 活跃优先 (有 last_active) 按时间倒序, 闲置按 name
    def sort_key(c: AgentWorkCardOut):
        if c.last_active:
            return (0, -c.last_active.timestamp())
        return (1, c.name)
    cards.sort(key=sort_key)

    return AgentsWorkboardOut(agents=cards)


@router.get("/insights", response_model=list[AIInsightFull])
async def list_insights(
    by_agent: Optional[uuid.UUID] = Query(None),
    by_meeting: Optional[uuid.UUID] = Query(None),
    for_review: bool = Query(
        False,
        description="True = 只返 AI 推荐入记忆 + 用户未审 的 (worth_remembering=true AND human_decision IS NULL)",
    ),
    limit: int = Query(30, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """记忆模块 (前称 智囊) 产出 列表.

    v27.0-mobile P21 金字塔:
      默认 — 返全量快照, 给"快照" tab 用
      for_review=true — 返 AI 推荐 + 用户未审 的, 给"待审" tab 用
    """
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
    if for_review:
        # 待审 = AI 推过 worth_remembering 且 人还没审 (human_decision NULL)
        q = q.where(
            AIInsight.worth_remembering.is_(True),
            AIInsight.human_decision.is_(None),
        )

    rows = (await session.execute(q)).all()
    return [
        AIInsightFull(
            id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
            agent_nickname=a_nick, type=ins.type, content=ins.content,
            evidence=ins.evidence, meeting_id=ins.meeting_id,
            meeting_title=m_title, topic_idx=ins.topic_idx,
            source_message_id=ins.source_message_id, created_at=ins.created_at,
            worth_remembering=ins.worth_remembering,
            human_decision=ins.human_decision,
        )
        for ins, a_name, a_nick, m_title in rows
    ]


# ============================================================================
# v27.0-mobile P21: PATCH /api/m/insights/{id}/decision — 人审决策
# ============================================================================

class InsightDecisionIn(BaseModel):
    decision: str  # 'accepted' | 'rejected'


class InsightDecisionOut(BaseModel):
    id: uuid.UUID
    human_decision: str
    memory_id: Optional[uuid.UUID] = None  # accepted 时返新生成的 memory id


@router.patch(
    "/insights/{insight_id}/decision",
    response_model=InsightDecisionOut,
)
async def patch_insight_decision(
    insight_id: uuid.UUID,
    payload: InsightDecisionIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P21: 用户对待审 insight 拍板.

    accepted → INSERT 一条 long_term_memory + 标 insight.human_decision='accepted'
    rejected → 仅 标 insight.human_decision='rejected', insight 保留 (快照 tab 仍可见)

    幂等: 已决过 (accepted/rejected) 的 insight 再次 PATCH 同一 decision 返 200 (no-op);
    跨决策 (rejected → accepted) 也允许 — 用户反悔机制留 Phase 3, 此处简单覆盖.
    """
    decision = (payload.decision or "").strip().lower()
    if decision not in ("accepted", "rejected"):
        raise HTTPException(400, "decision 必须是 'accepted' 或 'rejected'")

    ins = (
        await session.execute(
            select(AIInsight).where(
                AIInsight.id == insight_id,
                AIInsight.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if ins is None:
        raise HTTPException(404, "insight 不存在 或 不属于本工作区")
    if not ins.worth_remembering:
        raise HTTPException(
            400,
            "该 insight 未被 AI 推荐入记忆 (worth_remembering=false), 不可审",
        )

    memory_id: Optional[uuid.UUID] = None

    if decision == "accepted":
        # 同步写 long_term_memory. 引用 insight 的 content + evidence + 来源.
        # scope='org' 默认 — 这是 workspace 共享记忆 (后续可加 UI 选 scope).
        # importance=0.6 默认 — AI 推 + 人审过, 中等偏上.
        from ..models import LongTermMemory

        # 拼 memory.content — 主体 = insight.content, 后缀 evidence 引用
        mem_content_parts = [ins.content]
        if ins.evidence:
            mem_content_parts.append(f"\n依据: {ins.evidence}")
        mem_content = "\n".join(mem_content_parts)[:2000]  # safety cap

        mem = LongTermMemory(
            workspace_id=auth.workspace.id,
            scope="org",
            content=mem_content,
            importance=0.6,
            source_type="ai_insight",
            source_id=str(ins.id),
            source_meeting_id=ins.meeting_id,
            curated_by_user_id=auth.user.id,
            curated_at=datetime.now(timezone.utc),
        )
        session.add(mem)
        await session.flush()
        memory_id = mem.id

    ins.human_decision = decision
    await session.commit()

    await audit_log(
        session, auth, "insight.decision",
        target_type="ai_insight", target_id=str(ins.id),
        payload={
            "decision": decision,
            "memory_id": str(memory_id) if memory_id else None,
        },
    )
    return InsightDecisionOut(
        id=ins.id, human_decision=decision, memory_id=memory_id,
    )


# ============================================================================
# /api/m/agents/{agent_id} — 单专家详情聚合 (Phase 3)
# ============================================================================
#
# 工卡点击后的展开页. 三段:
#   1. 顶部档案 (name / domain / 累计 / last_active)
#   2. 会议 — 所有参加过的会议 (带 该专家在此会的 insight 计数)
#   3. 任务 — 所有归属任务 (Task.assignee_agent_id), 按状态分组
#   4. 智囊 — 该专家产出的 AIInsight (按时间倒序)

class AgentDetailMeetingItem(BaseModel):
    meeting_id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    insights_count: int = 0  # 该专家在此会议产出的 insight 数


class AgentDetailTaskItem(BaseModel):
    task_id: uuid.UUID
    # P4.3: 反查的 ActionItem id, 前端跳详情页用 /m/tasks/<action_item_id>.
    # 若 Task 没有镜像 ActionItem (legacy 老数据) 为 None, 前端不可点.
    action_item_id: Optional[uuid.UUID] = None
    title: str           # task.title or content 前 40 字
    status: str          # open|dispatched|accepted|in_progress|submitted|done|archived|cancelled
    due_at: Optional[datetime] = None
    is_overdue: bool = False
    source_meeting_id: Optional[uuid.UUID] = None
    source_meeting_title: Optional[str] = None
    created_at: datetime


class AgentDetailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    # 档案
    agent_id: uuid.UUID
    name: str
    nickname: Optional[str] = None
    domain: Optional[str] = None
    color: Optional[str] = None
    role: str
    # 累计
    total_meetings: int = 0
    total_insights: int = 0
    last_active: Optional[datetime] = None
    # 三段
    meetings: list[AgentDetailMeetingItem] = []
    tasks: list[AgentDetailTaskItem] = []
    insights: list[AIInsightFull] = []


@router.get("/agents/{agent_id}", response_model=AgentDetailOut)
async def get_agent_detail(
    agent_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """单专家详情 — 工卡点开后看的展开页. 一次聚合返回三段."""
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)

    # 1. 找到 agent, 验 workspace 归属
    a = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.workspace_id == ws_id)
        )
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(404, "agent not found in workspace")

    # 2. 参与的会议 (从 MeetingAttendee join) + 每场该 agent 的 insight 计数
    from ..models import MeetingAttendee, Task as TaskModel

    meeting_rows = (
        await session.execute(
            select(Meeting.id, Meeting.title, Meeting.status,
                   Meeting.started_at, Meeting.ended_at)
            .join(MeetingAttendee, MeetingAttendee.meeting_id == Meeting.id)
            .where(
                MeetingAttendee.agent_id == agent_id,
                Meeting.workspace_id == ws_id,
            )
            .order_by(desc(Meeting.started_at))
            .limit(50)
        )
    ).all()

    # 一次性查 该 agent 在所有这些会议的 insight 计数
    meeting_ids = [r[0] for r in meeting_rows]
    insights_per_meeting: dict[uuid.UUID, int] = {}
    if meeting_ids:
        cnt_rows = (
            await session.execute(
                select(AIInsight.meeting_id, func.count(AIInsight.id))
                .where(
                    AIInsight.agent_id == agent_id,
                    AIInsight.meeting_id.in_(meeting_ids),
                )
                .group_by(AIInsight.meeting_id)
            )
        ).all()
        insights_per_meeting = {mid: int(c) for mid, c in cnt_rows}

    meetings = [
        AgentDetailMeetingItem(
            meeting_id=r[0],
            title=r[1] or "(未命名)",
            status=r[2],
            started_at=r[3],
            ended_at=r[4],
            insights_count=insights_per_meeting.get(r[0], 0),
        )
        for r in meeting_rows
    ]

    # 3. 归属任务 (Task.assignee_agent_id = agent_id)
    task_rows = (
        await session.execute(
            select(
                TaskModel.id, TaskModel.title, TaskModel.content,
                TaskModel.status, TaskModel.due_at, TaskModel.created_at,
                TaskModel.source_ref,
            )
            .where(
                TaskModel.workspace_id == ws_id,
                TaskModel.assignee_agent_id == agent_id,
            )
            .order_by(desc(TaskModel.created_at))
            .limit(100)
        )
    ).all()

    # P4.3: 一次性反查 Task → ActionItem (ActionItem.task_id), 拿 action_item_id
    # 让前端能跳 /m/tasks/<action_item_id> 详情页.
    task_id_to_action_id: dict[uuid.UUID, uuid.UUID] = {}
    if task_rows:
        from ..models import MeetingActionItem
        t_ids = [r[0] for r in task_rows]
        ai_rows = (
            await session.execute(
                select(MeetingActionItem.id, MeetingActionItem.task_id).where(
                    MeetingActionItem.task_id.in_(t_ids)
                )
            )
        ).all()
        task_id_to_action_id = {tid: aid for aid, tid in ai_rows}

    # 提取 source_meeting_id 集合, 一次性 lookup titles
    OPEN_STATES = {"open", "dispatched", "accepted", "in_progress", "submitted"}
    source_meeting_ids: set[uuid.UUID] = set()
    for r in task_rows:
        sref = r[6]  # source_ref JSON
        if isinstance(sref, dict):
            mid = sref.get("meeting_id")
            if mid:
                try:
                    source_meeting_ids.add(uuid.UUID(mid) if isinstance(mid, str) else mid)
                except (ValueError, TypeError):
                    pass
    title_map: dict[uuid.UUID, str] = {}
    if source_meeting_ids:
        t_rows = (
            await session.execute(
                select(Meeting.id, Meeting.title).where(
                    Meeting.id.in_(source_meeting_ids)
                )
            )
        ).all()
        title_map = {tid: t or "(未命名)" for tid, t in t_rows}

    tasks: list[AgentDetailTaskItem] = []
    for r in task_rows:
        task_id, title, content, status, due_at, created_at, sref = r
        sm_id: Optional[uuid.UUID] = None
        if isinstance(sref, dict) and sref.get("meeting_id"):
            try:
                raw = sref["meeting_id"]
                sm_id = uuid.UUID(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                sm_id = None
        display_title = title or (content[:40] if content else "(未命名任务)")
        is_overdue = (
            status in OPEN_STATES
            and due_at is not None
            and due_at < now
        )
        tasks.append(AgentDetailTaskItem(
            task_id=task_id,
            action_item_id=task_id_to_action_id.get(task_id),
            title=display_title,
            status=status,
            due_at=due_at,
            is_overdue=is_overdue,
            source_meeting_id=sm_id,
            source_meeting_title=title_map.get(sm_id) if sm_id else None,
            created_at=created_at,
        ))

    # 4. 智囊 — 该专家所有 AIInsight (限 50)
    ins_rows = (
        await session.execute(
            select(AIInsight, Meeting.title)
            .join(Meeting, Meeting.id == AIInsight.meeting_id)
            .where(
                AIInsight.workspace_id == ws_id,
                AIInsight.agent_id == agent_id,
            )
            .order_by(desc(AIInsight.created_at))
            .limit(50)
        )
    ).all()
    insights = [
        AIInsightFull(
            id=ins.id, agent_id=ins.agent_id,
            agent_name=a.name, agent_nickname=a.nickname,
            type=ins.type, content=ins.content, evidence=ins.evidence,
            meeting_id=ins.meeting_id, meeting_title=m_title,
            topic_idx=ins.topic_idx,
            source_message_id=ins.source_message_id,
            created_at=ins.created_at,
        )
        for ins, m_title in ins_rows
    ]

    # 5. 累计统计 + last_active
    total_meetings = (
        await session.execute(
            select(func.count(MeetingAttendee.id))
            .where(MeetingAttendee.agent_id == agent_id)
        )
    ).scalar() or 0
    total_insights = (
        await session.execute(
            select(func.count(AIInsight.id))
            .where(
                AIInsight.workspace_id == ws_id,
                AIInsight.agent_id == agent_id,
            )
        )
    ).scalar() or 0

    last_meeting_t = (
        await session.execute(
            select(func.max(Meeting.started_at))
            .join(MeetingAttendee, MeetingAttendee.meeting_id == Meeting.id)
            .where(MeetingAttendee.agent_id == agent_id)
        )
    ).scalar()
    last_insight_t = (
        await session.execute(
            select(func.max(AIInsight.created_at))
            .where(AIInsight.agent_id == agent_id)
        )
    ).scalar()
    last_active: Optional[datetime] = None
    if last_meeting_t and last_insight_t:
        last_active = max(last_meeting_t, last_insight_t)
    elif last_meeting_t:
        last_active = last_meeting_t
    elif last_insight_t:
        last_active = last_insight_t

    return AgentDetailOut(
        agent_id=a.id,
        name=a.name,
        nickname=a.nickname,
        domain=a.domain,
        color=a.color,
        role=a.role,
        total_meetings=int(total_meetings),
        total_insights=int(total_insights),
        last_active=last_active,
        meetings=meetings,
        tasks=tasks,
        insights=insights,
    )


# ============================================================================
# /api/m/tasks/{action_item_id} — 单任务详情聚合 (Phase 4.3)
# ============================================================================
#
# 工作站 /m/tasks 列表 + 工卡详情页任务 tab 的点击目标. 详情页只 "查看 + 评论",
# 不再做 "确认 / 驳回" CTA — 那些动作 list 上做.
#
# 聚合返回:
#   1. 任务 meta (title / content / status / due_at / assignee / source_meeting)
#   2. AI 智囊依据 (该任务源议题的 insights)
#   3. 实录依据 (evidence_quote + evidence_anchor_line_ids 解析出的 transcript 行)
#   4. 评论 (MeetingActionItemComment 时间线)

class TaskDetailEvidenceLine(BaseModel):
    line_id: int                    # MeetingTranscript.id
    text: str
    speaker_name: Optional[str] = None
    at_minute: int = 0              # 距会议开始多少分钟


class TaskDetailComment(BaseModel):
    id: uuid.UUID
    author_user_id: Optional[uuid.UUID] = None
    author_name: str                # hydrated, 删除用户时显 "(已删除用户)"
    content: str
    created_at: datetime
    can_delete: bool = False        # 当前 user 是否能删 (作者本人)


class TaskDetailOut(BaseModel):
    # ---- 基本字段 ----
    action_item_id: uuid.UUID
    task_id: Optional[uuid.UUID] = None  # 1:1 mirror Task.id
    title: str                            # content 前 80 字 (legacy ActionItem 无独立 title)
    content: str                          # 全文
    # Task 状态优先 (8-state), 没 Task 时 fallback ActionItem 3-state
    status: str
    due_at: Optional[datetime] = None
    is_overdue: bool = False
    created_at: datetime

    # ---- 归属 ----
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_user_name: Optional[str] = None
    assignee_agent_id: Optional[uuid.UUID] = None
    assignee_agent_name: Optional[str] = None
    assignee_agent_nickname: Optional[str] = None
    assignee_name_hint: Optional[str] = None  # 解析不上 user 时的原文本

    # ---- 来源 ----
    source_meeting_id: Optional[uuid.UUID] = None
    source_meeting_title: Optional[str] = None
    source_type: str = "summary"

    # ---- 依据 ----
    evidence_quote: Optional[str] = None        # AI 抽出待办时附的支撑句
    evidence_lines: list[TaskDetailEvidenceLine] = []  # 实录行原文 (解析 anchor_ids)

    # ---- AI 智囊 (源会议同议题的 insights, 上限 5) ----
    insights: list[AIInsightFull] = []

    # ---- 评论 ----
    comments: list[TaskDetailComment] = []


@router.get("/tasks/{action_item_id}", response_model=TaskDetailOut)
async def get_mobile_task_detail(
    action_item_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """任务详情 — 工卡点开后看的展开页. 一次聚合, 减 round-trip."""
    from ..models import MeetingActionItem, MeetingActionItemComment, MeetingTranscript, Task as TaskModel
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)

    # 1. 拉 ActionItem + workspace 校验
    ai = (
        await session.execute(
            select(MeetingActionItem).where(
                MeetingActionItem.id == action_item_id,
                MeetingActionItem.workspace_id == ws_id,
            )
        )
    ).scalar_one_or_none()
    if not ai:
        raise HTTPException(404, "task not found")

    # 2. 拉 Task (1:1 镜像; 没有时 fallback 用 ActionItem 状态)
    task: Optional[TaskModel] = None
    if ai.task_id:
        task = (
            await session.execute(
                select(TaskModel).where(TaskModel.id == ai.task_id)
            )
        ).scalar_one_or_none()

    OPEN_STATES = {"open", "dispatched", "accepted", "in_progress", "submitted"}
    final_status = task.status if task else ai.status
    is_overdue = (
        final_status in OPEN_STATES
        and ai.due_at is not None
        and ai.due_at < now
    )

    # 3. 拉源会议 title
    src_meeting_title: Optional[str] = None
    if ai.meeting_id:
        src_meeting_title = (
            await session.execute(
                select(Meeting.title).where(Meeting.id == ai.meeting_id)
            )
        ).scalar()

    # 4. 归属 user / agent 名字
    assignee_user_name: Optional[str] = None
    if ai.assignee_user_id:
        from ..models import User as UserModel
        assignee_user_name = (
            await session.execute(
                select(UserModel.name).where(UserModel.id == ai.assignee_user_id)
            )
        ).scalar()
    assignee_agent_id: Optional[uuid.UUID] = None
    assignee_agent_name: Optional[str] = None
    assignee_agent_nickname: Optional[str] = None
    if task and task.assignee_agent_id:
        ag_row = (
            await session.execute(
                select(Agent.id, Agent.name, Agent.nickname).where(
                    Agent.id == task.assignee_agent_id
                )
            )
        ).first()
        if ag_row:
            assignee_agent_id = ag_row[0]
            assignee_agent_name = ag_row[1]
            assignee_agent_nickname = ag_row[2]

    # 5. 实录依据 — anchor_line_ids 批量查 transcript + 过滤幻觉 ids
    evidence_lines: list[TaskDetailEvidenceLine] = []
    if ai.evidence_anchor_line_ids and ai.meeting_id:
        anchor_ids = [i for i in ai.evidence_anchor_line_ids if isinstance(i, int)]
        if anchor_ids:
            line_rows = (
                await session.execute(
                    select(MeetingTranscript).where(
                        MeetingTranscript.id.in_(anchor_ids),
                        MeetingTranscript.meeting_id == ai.meeting_id,
                    )
                    .order_by(MeetingTranscript.id)
                )
            ).scalars().all()
            # 解析 speaker_user_id → User.name
            spk_ids = [l.speaker_user_id for l in line_rows if l.speaker_user_id]
            spk_name_map: dict[uuid.UUID, str] = {}
            if spk_ids:
                from ..models import User as UserModel
                spk_rows = (
                    await session.execute(
                        select(UserModel.id, UserModel.name).where(
                            UserModel.id.in_(spk_ids)
                        )
                    )
                ).all()
                spk_name_map = {uid: name for uid, name in spk_rows}
            # 拿源会议 started_at 算 at_minute
            mt_started = (
                await session.execute(
                    select(Meeting.started_at).where(Meeting.id == ai.meeting_id)
                )
            ).scalar()
            for l in line_rows:
                at_min = 0
                if mt_started and l.start_ms is not None:
                    at_min = max(0, int(l.start_ms / 60000))
                spk_name: Optional[str] = None
                if l.speaker_user_id and l.speaker_user_id in spk_name_map:
                    spk_name = spk_name_map[l.speaker_user_id]
                elif l.speaker_label and l.speaker_label != "UNKNOWN":
                    spk_name = l.speaker_label
                evidence_lines.append(TaskDetailEvidenceLine(
                    line_id=l.id, text=l.text,
                    speaker_name=spk_name, at_minute=at_min,
                ))

    # 6. AI 智囊 — 同会议 insights (上限 5; 不绑 topic_idx 因为 ActionItem 没存 topic 关联)
    insights: list[AIInsightFull] = []
    if ai.meeting_id:
        ins_rows = (
            await session.execute(
                select(AIInsight, Agent.name, Agent.nickname, Meeting.title)
                .join(Agent, Agent.id == AIInsight.agent_id)
                .join(Meeting, Meeting.id == AIInsight.meeting_id)
                .where(AIInsight.meeting_id == ai.meeting_id)
                .order_by(desc(AIInsight.created_at))
                .limit(5)
            )
        ).all()
        for ins, a_name, a_nick, m_title in ins_rows:
            insights.append(AIInsightFull(
                id=ins.id, agent_id=ins.agent_id, agent_name=a_name,
                agent_nickname=a_nick, type=ins.type, content=ins.content,
                evidence=ins.evidence, meeting_id=ins.meeting_id,
                meeting_title=m_title, topic_idx=ins.topic_idx,
                source_message_id=ins.source_message_id, created_at=ins.created_at,
            ))

    # 7. 评论 — 时间正序 (老 → 新, 让用户从上往下读时间线)
    comment_rows = (
        await session.execute(
            select(MeetingActionItemComment).where(
                MeetingActionItemComment.action_item_id == action_item_id
            )
            .order_by(MeetingActionItemComment.created_at)
        )
    ).scalars().all()
    # 解析 author user names 一次性
    author_ids = list({c.author_user_id for c in comment_rows if c.author_user_id})
    author_name_map: dict[uuid.UUID, str] = {}
    if author_ids:
        from ..models import User as UserModel
        ar = (
            await session.execute(
                select(UserModel.id, UserModel.name).where(UserModel.id.in_(author_ids))
            )
        ).all()
        author_name_map = {uid: name for uid, name in ar}
    comments: list[TaskDetailComment] = []
    me_id = auth.user.id
    for c in comment_rows:
        author_name = (
            author_name_map.get(c.author_user_id, "(已删除用户)")
            if c.author_user_id
            else "(已删除用户)"
        )
        comments.append(TaskDetailComment(
            id=c.id,
            author_user_id=c.author_user_id,
            author_name=author_name,
            content=c.content,
            created_at=c.created_at,
            can_delete=(c.author_user_id == me_id),
        ))

    return TaskDetailOut(
        action_item_id=ai.id,
        task_id=ai.task_id,
        title=ai.content[:80],
        content=ai.content,
        status=final_status,
        due_at=ai.due_at,
        is_overdue=is_overdue,
        created_at=ai.created_at,
        assignee_user_id=ai.assignee_user_id,
        assignee_user_name=assignee_user_name,
        assignee_agent_id=assignee_agent_id,
        assignee_agent_name=assignee_agent_name,
        assignee_agent_nickname=assignee_agent_nickname,
        assignee_name_hint=ai.assignee_name_hint,
        source_meeting_id=ai.meeting_id,
        source_meeting_title=src_meeting_title,
        source_type=ai.source_type or "summary",
        evidence_quote=ai.evidence_quote,
        evidence_lines=evidence_lines,
        insights=insights,
        comments=comments,
    )


# ============================================================================
# /api/m/meetings/{id}/transcript — 会议完整转录流 (Phase 5A)
# ============================================================================
#
# 合并 MeetingTranscript (真人 ASR) + MeetingAgentMessage (AI 发言) 按时间正序.
# 一次请求拿全, 比客户端分别拉 + merge 省 round-trip + 解析 speaker / agent
# 都在服务器一次性 join 完.
#
# 不分页 (mvp). 大会议 (>500 句) 后续加 cursor.
# 不接 WebSocket — 那是 P5B 的活. 用户手动下拉刷新.

class TranscriptStreamLine(BaseModel):
    kind: str               # "user" | "agent"
    id: int                 # transcript.id 或 agent_message.id
    text: str
    at_minute: int          # 距 meeting.started_at 多少分钟 (0 = 开会瞬间)
    created_at: datetime    # ISO 时间戳, 客户端可格式化
    # user 类字段
    speaker_name: Optional[str] = None       # 解析后真人名字 (UNKNOWN/未识别时 None)
    speaker_status: Optional[str] = None     # auto_recognized | manually_corrected | UNKNOWN
    # agent 类字段
    agent_id: Optional[uuid.UUID] = None
    agent_name: Optional[str] = None
    agent_nickname: Optional[str] = None
    agent_color: Optional[str] = None
    trigger: Optional[str] = None            # manual | auto_orchestrator | keyword | at_mention
    citations_count: int = 0                 # 简化, 不返完整 citations (前端 mvp 不展开)
    # v1.4.0 Phase B · 9 NEW-A 简版: agent message 立场被后续 message 覆盖 时 标
    # superseded. UI 灰化 + 标 "已被覆盖". 仅 kind="agent" 时填.
    status: Optional[str] = None             # "active" | "superseded" (老数据 NULL 当 active)
    superseded_by_message_id: Optional[int] = None  # 覆盖本发言的 message.id, UI 可链接跳转


class MobileTranscriptOut(BaseModel):
    meeting_id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime] = None
    total_user_lines: int = 0
    total_agent_lines: int = 0
    lines: list[TranscriptStreamLine] = []   # 按 created_at 正序 (老→新)


@router.get("/meetings/{meeting_id}/transcript", response_model=MobileTranscriptOut)
async def get_mobile_transcript(
    meeting_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """会议完整转录 — 真人 + AI 合并按时间正序."""
    from ..models import MeetingTranscript, User as UserModel

    ws_id = auth.workspace.id

    # 1. 拉 meeting + 校验
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id, Meeting.workspace_id == ws_id
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found")

    started_at = m.started_at

    def at_min(t: datetime) -> int:
        if not started_at or not t:
            return 0
        return max(0, int((t - started_at).total_seconds() / 60))

    # 2. 拉 transcript (按 created_at 排, fallback start_ms)
    tr_rows = (
        await session.execute(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == meeting_id)
            .order_by(MeetingTranscript.created_at)
        )
    ).scalars().all()

    # 3. 拉 agent messages
    ag_rows = (
        await session.execute(
            select(MeetingAgentMessage)
            .where(MeetingAgentMessage.meeting_id == meeting_id)
            .order_by(MeetingAgentMessage.created_at)
        )
    ).scalars().all()

    # 4. 一次性解析 speaker 名字 + agent 名字
    spk_ids = {t.speaker_user_id for t in tr_rows if t.speaker_user_id}
    spk_name_map: dict[uuid.UUID, str] = {}
    if spk_ids:
        rows = (
            await session.execute(
                select(UserModel.id, UserModel.name).where(UserModel.id.in_(spk_ids))
            )
        ).all()
        spk_name_map = {uid: name for uid, name in rows}

    ag_ids = {a.agent_id for a in ag_rows}
    ag_info_map: dict[uuid.UUID, tuple[str, Optional[str], Optional[str]]] = {}
    if ag_ids:
        rows = (
            await session.execute(
                select(Agent.id, Agent.name, Agent.nickname, Agent.color)
                .where(Agent.id.in_(ag_ids))
            )
        ).all()
        ag_info_map = {
            aid: (name, nickname, color) for aid, name, nickname, color in rows
        }

    # 5. 构建 lines
    lines: list[TranscriptStreamLine] = []
    for t in tr_rows:
        speaker_name: Optional[str] = None
        if t.speaker_user_id and t.speaker_user_id in spk_name_map:
            speaker_name = spk_name_map[t.speaker_user_id]
        elif t.speaker_label and t.speaker_label != "UNKNOWN":
            speaker_name = t.speaker_label
        lines.append(TranscriptStreamLine(
            kind="user",
            id=t.id,
            text=t.text or "",
            at_minute=at_min(t.created_at),
            created_at=t.created_at,
            speaker_name=speaker_name,
            speaker_status=t.speaker_status,
        ))
    for a in ag_rows:
        info = ag_info_map.get(a.agent_id)
        if not info:
            # agent 被删了 — 老数据兜底, 显示 "(已下线 AI)"
            ag_name, ag_nick, ag_color = "(已下线 AI)", None, None
        else:
            ag_name, ag_nick, ag_color = info
        cite_n = len(a.citations) if isinstance(a.citations, list) else 0
        lines.append(TranscriptStreamLine(
            kind="agent",
            id=a.id,
            text=a.text or "",
            at_minute=at_min(a.created_at),
            created_at=a.created_at,
            agent_id=a.agent_id,
            agent_name=ag_name,
            agent_nickname=ag_nick,
            agent_color=ag_color,
            trigger=a.trigger,
            citations_count=cite_n,
            # v1.4.0 Phase B · 9 NEW-A: 立场对立 自动标 superseded
            status=getattr(a, "status", None) or "active",
            superseded_by_message_id=getattr(a, "superseded_by_message_id", None),
        ))

    # 6. 合并排序: 按 created_at 正序
    lines.sort(key=lambda l: l.created_at)

    return MobileTranscriptOut(
        meeting_id=m.id,
        title=m.title or "(未命名)",
        status=m.status,
        started_at=started_at,
        total_user_lines=len(tr_rows),
        total_agent_lines=len(ag_rows),
        lines=lines,
    )
