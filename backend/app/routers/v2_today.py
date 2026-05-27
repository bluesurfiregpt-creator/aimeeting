"""
v1.4.0 · Saga N (Phase 1 · W2) + Saga T1/T2 (Phase 2 · W1/W2) · Mobile App v2 — Today.

契约: docs/SCHEMA-mobile-v2.md §3 (today/* 全部 7 个 endpoint).

Phase 1 (Saga N · 全部 mock): brief / live-meeting / snapshot / pending-tasks /
                              insights / decisions / experts.
Phase 2 真接 DB:
  Saga T1 · snapshot + insights — ABAC + workspace filter.
  Saga T2 · live-meeting + pending-tasks + decisions — ABAC + JOIN + Task derive.
  Saga T4 (后续) · experts.
  Saga T6 (后续) · brief (LLM).

约定:
  - 与 老 /api/m/* (mobile.py) 隔离, 走 /api/v2/today/* 命名空间
  - 与 §2 meetings 共用 V2Attendee / V2AIBadge / V2MeetingItem schema (从
    v2_meetings 复用避免重复)
  - 真接 endpoint 走 get_current_auth + workspace.id filter (Saga T1 起强制)
  - mock endpoint Phase 1 anon 暂留, 后续 sub-saga 转真时一并上 ABAC
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace · Q3 路线图 / 搜索体验评审 / 客户访谈
AI 10 个 (v1.4.0 Saga Q · Phase 1 P0 修复, 严格按设计稿 mobile-shared.jsx:24-34):
  Mira ◎ / Aria ⌬ / Stratos ◆ / Sage ✦ / Lex § / Scout ◈ /
  Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent_glyphs import (
    DECISION_INSIGHT_TYPES,
    agent_to_ai_source,
    normalize_insight_type,
)
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import AIInsight, Agent, Meeting, MeetingAttendee, Task, User
from ..task_urgency import derive_urgency, due_display
from ..v2_helpers import build_meeting_item
from .v2_meetings import V2MeetingItem, _load_meeting_extras

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2/today", tags=["mobile-v2-today"])


# ============================================================================
# Saga T1 helpers — Today 0:00 UTC / 今天 23:59:59 UTC 窗口.
# ============================================================================


def _today_window_utc() -> tuple[datetime, datetime]:
    """返回 (今天 00:00 UTC, 今天 23:59:59 UTC) 元组.

    Saga T1 决策: 用 UTC 边界, 不用 server 本地时区. 跟 demo workspace seed 时间
    一致 (seed 是 UTC). Phase 2 后续若 PM 要 切到 UTC+8, 在这一处改即可.
    """
    now = datetime.now(timezone.utc)
    start = datetime.combine(now.date(), time.min, tzinfo=timezone.utc)
    end = datetime.combine(now.date(), time.max, tzinfo=timezone.utc)
    return start, end


# ============================================================================
# §3.1 — GET /api/v2/today/brief (Mira 早间简报)
# ============================================================================


class BriefChip(BaseModel):
    label: str
    color: str  # hex


class BriefResponse(BaseModel):
    id: str
    generated_at: str
    title: str
    summary_text: str
    chips: List[BriefChip]
    target_meeting_id: str


@router.get("/brief", response_model=BriefResponse)
async def get_today_brief() -> BriefResponse:
    """Mira 早间简报 — Phase 1 写死 mock. Saga T6 (NLU) 转真接."""
    return BriefResponse(
        id="brief-2026-05-27",
        generated_at="2026-05-27T08:00:00Z",
        title="Mira · 早间简报",
        summary_text=(
            "今天 3 场会议, 其中 Q3 路线图是关键. 已为你提取昨天遗留的 4 个"
            "未决议题, Mira 建议优先在 10:30 的会上拍板「协作功能是否进入 Q3」."
        ),
        chips=[
            BriefChip(label="优先拍板", color="#5E5CE6"),
            BriefChip(label="Q3 协作功能", color="#7A5AF0"),
            BriefChip(label="预读 Sage 评审稿", color="#AF52DE"),
        ],
        # target_meeting_id Saga T6 时改成查 DB 当日 第一 ongoing meeting.id
        target_meeting_id="m-live-q3-roadmap",
    )


# ============================================================================
# §3.2 — GET /api/v2/today/live-meeting
# ============================================================================


class LiveMeetingResponse(BaseModel):
    meeting: Optional[V2MeetingItem] = None
    mira_note: Optional[str] = None


@router.get("/live-meeting", response_model=LiveMeetingResponse)
async def get_today_live_meeting(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> LiveMeetingResponse:
    """当前 live 会议 + Mira 笔记. 无 live 时 meeting=null.

    v1.4.0 Saga T2 (Phase 2 W2): mock → 真接 (ABAC + workspace filter).

    数据源:
      Meeting WHERE workspace_id + status='ongoing' ORDER BY started_at DESC LIMIT 1
      attendees / decisions 通过 v2_meetings._load_meeting_extras 批量加载.
      mira_note: AIInsight COUNT (今会 + 全部) + COUNT (今会 + human_decision pending).
                  当前 走 真实 数字 + 模板, Saga T6 转 LLM 生成.

    边界:
      - 无 ongoing meeting → meeting=null, mira_note=null
      - 有 meeting 但 0 个 insight → mira_note="Mira 已记录 0 个关键点 · 0 个待你确认"
    """
    ws_id = auth.workspace.id

    # 1) 拿 当前 workspace 的 ongoing meeting (live), 最近 1 个
    live_meeting = (
        await session.execute(
            select(Meeting)
            .where(
                Meeting.workspace_id == ws_id,
                Meeting.status == "ongoing",
            )
            .order_by(Meeting.started_at.desc().nulls_last())
            .limit(1)
        )
    ).scalar_one_or_none()

    if live_meeting is None:
        return LiveMeetingResponse(meeting=None, mira_note=None)

    # 2) 批量 加载 attendees + decisions
    humans_by_meeting, agents_by_meeting, decisions_by_meeting = (
        await _load_meeting_extras(session, [live_meeting])
    )

    mid = str(live_meeting.id)
    item_dict = build_meeting_item(
        live_meeting,
        human_users=humans_by_meeting.get(mid, []),
        ai_agents=agents_by_meeting.get(mid, []),
        decision_count=decisions_by_meeting.get(mid, 0),
    )

    # 3) mira_note — 当前 走 真实 insight 数字
    #   N = AIInsight WHERE meeting_id=this + workspace_id (关键点 = 全部 insight)
    #   M = AIInsight WHERE meeting_id=this + worth_remembering=true + human_decision IS NULL
    #       (待你确认 = AI 推过 但 用户 没审 的, 严格按 P21 流)
    total_keypoints = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.meeting_id == live_meeting.id,
            )
        )
    ).scalar_one() or 0
    pending_review = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.meeting_id == live_meeting.id,
                AIInsight.worth_remembering.is_(True),
                AIInsight.human_decision.is_(None),
            )
        )
    ).scalar_one() or 0

    mira_note = f"Mira 已记录 {int(total_keypoints)} 个关键点 · {int(pending_review)} 个待你确认"

    return LiveMeetingResponse(
        meeting=V2MeetingItem(**item_dict),
        mira_note=mira_note,
    )


# ============================================================================
# §3.3 — GET /api/v2/today/snapshot (4 格 stat)
# ============================================================================


class SnapshotResponse(BaseModel):
    meetings_today: int
    pending_tasks: int
    ai_insights_today: int
    decisions_today: int


@router.get("/snapshot", response_model=SnapshotResponse)
async def get_today_snapshot(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> SnapshotResponse:
    """4 格 stat tile — 场会议 / 待处理 / AI 洞察 / 已决策.

    v1.4.0 Saga T1 (Phase 2 W1): mock → 真接 4 个 COUNT (ABAC + workspace filter).

    数据源:
      meetings_today    — Meeting WHERE workspace_id + (started_at OR ended_at)
                          落在今天窗口 (今天开过会的 都算 — 跟 SCHEMA §3.3 "今天"
                          语义一致)
      pending_tasks     — Task WHERE workspace_id + assignee = caller +
                          status IN (open / dispatched / accepted / in_progress)
                          (Task 状态机 v18+ 实际有 8 个 status, 'pending' / 'tracking'
                          是 SCHEMA enum, 在后端 map 到 真状态机)
      ai_insights_today — AIInsight WHERE workspace_id + created_at >= 今天 0:00
      decisions_today   — AIInsight WHERE workspace_id + type IN (决策/决策建议) +
                          created_at >= 今天 0:00 (Phase 2 决策源 沿用 AIInsight,
                          见 Planning §3.2 决策 A)

    边界: empty workspace → 4 个 0, 不 raise.
    """
    ws_id = auth.workspace.id
    today_start, today_end = _today_window_utc()

    # 1) meetings_today — 今天有过会议状态变化的 (started_at 或 ended_at 落今天)
    # 用 OR 兼容 "今天开始 还没结束" + "今天结束 是昨天开始" 两种 case.
    meetings_today = (
        await session.execute(
            select(func.count(Meeting.id)).where(
                Meeting.workspace_id == ws_id,
                or_(
                    and_(
                        Meeting.started_at >= today_start,
                        Meeting.started_at <= today_end,
                    ),
                    and_(
                        Meeting.ended_at >= today_start,
                        Meeting.ended_at <= today_end,
                    ),
                ),
            )
        )
    ).scalar_one()

    # 2) pending_tasks — 派给 caller 的 未办结 task. Task 状态机 active 状态:
    #    open / dispatched / accepted / in_progress / submitted
    #    (done / archived / cancelled 不算 pending)
    pending_tasks = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == auth.user.id,
                Task.status.in_(
                    ("open", "dispatched", "accepted", "in_progress", "submitted")
                ),
            )
        )
    ).scalar_one()

    # 3) ai_insights_today — 今天产出的所有 AI 洞察
    ai_insights_today = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
            )
        )
    ).scalar_one()

    # 4) decisions_today — 今天决策类 insight (type IN '决策' / '决策建议')
    decisions_today = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
                AIInsight.type.in_(DECISION_INSIGHT_TYPES),
            )
        )
    ).scalar_one()

    return SnapshotResponse(
        meetings_today=int(meetings_today or 0),
        pending_tasks=int(pending_tasks or 0),
        ai_insights_today=int(ai_insights_today or 0),
        decisions_today=int(decisions_today or 0),
    )


# ============================================================================
# §3.4 — GET /api/v2/today/pending-tasks (等你处理)
# ============================================================================


class PendingTaskAISource(BaseModel):
    id: str
    name: str
    glyph: str
    color: str  # hex


class PendingTaskItem(BaseModel):
    id: str
    title: str
    source_meeting: str
    source_meeting_id: str
    urgency: str  # "urgent" | "today" | "week" | "none"
    ai_source: PendingTaskAISource
    due_at: str
    due_display: str


class PendingTasksResponse(BaseModel):
    items: List[PendingTaskItem]
    total_count: int


# T2 active task status — 同 T1 priority-banner.
_ACTIVE_TASK_STATUSES: tuple[str, ...] = (
    "open",
    "dispatched",
    "accepted",
    "in_progress",
    "submitted",
)


@router.get("/pending-tasks", response_model=PendingTasksResponse)
async def get_today_pending_tasks(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> PendingTasksResponse:
    """等你处理 — pending 任务列表 (派给 caller).

    v1.4.0 Saga T2 (Phase 2 W2): mock → 真接 (ABAC + workspace + assignee filter).

    数据源:
      Task WHERE workspace_id + assignee_user_id = caller + status active
      ORDER BY due_at ASC NULLS LAST LIMIT 10
      JOIN Agent ON Task.assignee_agent_id → ai_source (走 agent_to_ai_source)
      JOIN Meeting ON Task.source_ref->>'meeting_id' (Task.source_type='meeting' 时)
                     → source_meeting / source_meeting_id

    urgency / due_display: 走 task_urgency.py 两个 helper.

    边界:
      - empty → items=[], total_count=0
      - Task 没 assignee_agent_id → ai_source 走 agent_to_ai_source(None) fallback
      - Task 没 source_meeting → source_meeting="" source_meeting_id=""
    """
    ws_id = auth.workspace.id
    user_id = auth.user.id
    now = datetime.now(timezone.utc)

    # 1) 拿 caller 的 active task — top 10 by due_at
    tasks = (
        await session.execute(
            select(Task)
            .where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == user_id,
                Task.status.in_(_ACTIVE_TASK_STATUSES),
            )
            .order_by(Task.due_at.asc().nulls_last())
            .limit(10)
        )
    ).scalars().all()

    # 2) total_count — 同 filter 不 limit
    total_count = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == user_id,
                Task.status.in_(_ACTIVE_TASK_STATUSES),
            )
        )
    ).scalar_one() or 0

    if not tasks:
        return PendingTasksResponse(items=[], total_count=0)

    # 3) 批量 加载 agents (ai_source) + meetings (source_meeting)
    agent_ids = {t.assignee_agent_id for t in tasks if t.assignee_agent_id}
    agents_by_id: dict = {}
    if agent_ids:
        agent_rows = (
            await session.execute(
                select(Agent).where(Agent.id.in_(agent_ids))
            )
        ).scalars().all()
        agents_by_id = {a.id: a for a in agent_rows}

    # source_meeting — Task.source_type='meeting' + Task.source_ref->>'meeting_id'.
    # 用 Python 端 解 source_ref dict (JSON 列, models.py:789).
    meeting_ids: set = set()
    for t in tasks:
        if t.source_type == "meeting" and isinstance(t.source_ref, dict):
            mid = t.source_ref.get("meeting_id")
            if mid:
                meeting_ids.add(mid)
    meetings_by_id: dict = {}
    if meeting_ids:
        meeting_rows = (
            await session.execute(
                select(Meeting).where(Meeting.id.in_(meeting_ids))
            )
        ).scalars().all()
        meetings_by_id = {str(m.id): m for m in meeting_rows}

    # 4) Build items
    items: List[PendingTaskItem] = []
    for t in tasks:
        agent = agents_by_id.get(t.assignee_agent_id) if t.assignee_agent_id else None
        ai_source_dict = agent_to_ai_source(agent)

        # source_meeting / source_meeting_id
        source_meeting = ""
        source_meeting_id = ""
        if t.source_type == "meeting" and isinstance(t.source_ref, dict):
            mid = t.source_ref.get("meeting_id")
            if mid:
                source_meeting_id = str(mid)
                m = meetings_by_id.get(str(mid))
                if m:
                    source_meeting = m.title or ""

        # title — Task.title 优先, fallback content 前 40 字
        title = (t.title or t.content or "")[:200].strip()

        items.append(
            PendingTaskItem(
                id=str(t.id),
                title=title,
                source_meeting=source_meeting,
                source_meeting_id=source_meeting_id,
                urgency=derive_urgency(t.due_at, now),
                ai_source=PendingTaskAISource(
                    id=ai_source_dict["id"],
                    name=ai_source_dict["name"],
                    glyph=ai_source_dict["glyph"],
                    color=ai_source_dict["color"],
                ),
                due_at=(
                    t.due_at.astimezone(timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z")
                    if t.due_at
                    else ""
                ),
                due_display=due_display(t.due_at, now),
            )
        )

    return PendingTasksResponse(items=items, total_count=int(total_count))


# ============================================================================
# §3.5 — GET /api/v2/today/insights (AI 智囊·今日)
# ============================================================================


class InsightAISource(BaseModel):
    id: str
    name: str
    glyph: str
    color: str  # hex


class InsightItem(BaseModel):
    id: str
    type: str  # "突破" | "决策" | "风险" | "洞察" | "思路"
    ai_source: InsightAISource
    title: str
    body: str
    source_meeting: str
    source_meeting_id: str
    created_at: str


class InsightsResponse(BaseModel):
    items: List[InsightItem]


_INSIGHTS = [
    InsightItem(
        id="ins-stratos-collab-delay",
        type="决策",
        ai_source=InsightAISource(
            id="ai-stratos",
            name="Stratos",
            glyph="◆",
            color="#AF52DE",
        ),
        title="建议把协作功能延后到 Q4 第一双周",
        body=(
            "Q3 已锁 3 大特性, 协作功能预估 18d, 撞到上线窗口."
            "若强插会牺牲搜索改版的回归测试. Q4 第一双周开是更安全的窗口."
        ),
        source_meeting="Q3 路线图对齐",
        source_meeting_id="m-live-q3-roadmap",
        created_at="2026-05-27T09:50:00Z",
    ),
    InsightItem(
        id="ins-lex-search-compliance",
        type="风险",
        ai_source=InsightAISource(
            id="ai-lex",
            name="Lex",
            glyph="§",
            color="#FF9F0A",
        ),
        title="搜索改版上线前需补合规审查",
        body=(
            "新增按词典分词逻辑可能触及 PII 处理边界, 建议在 上线前 1 周"
            "走 数据安全合规小组评审. 否则上线后 30 天内有被审计风险."
        ),
        source_meeting="搜索体验评审",
        source_meeting_id="m-upcoming-search-review-4",
        created_at="2026-05-27T10:15:00Z",
    ),
    InsightItem(
        id="ins-sage-hummingbird-rhythm",
        type="洞察",
        ai_source=InsightAISource(
            id="ai-sage",
            name="Sage",
            glyph="✦",
            color="#5E5CE6",
        ),
        title="Hummingbird 客户对摘要节奏感反馈强烈",
        body=(
            "近 7 天 3 位客户提到「想要更短的摘要 + 关键句加粗」, 现行"
            "5 段式过长. 建议提到摘要模板下次迭代."
        ),
        source_meeting="客户访谈",
        source_meeting_id="m-upcoming-hummingbird-feedback",
        created_at="2026-05-27T11:00:00Z",
    ),
]


@router.get("/insights", response_model=InsightsResponse)
async def get_today_insights(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> InsightsResponse:
    """AI 智囊·今日 — 今天产出的 AI insight top 10.

    v1.4.0 Saga T1 (Phase 2 W1): mock → 真接 (ABAC + workspace filter).

    SQL:
      SELECT AIInsight, Agent, Meeting
      JOIN Agent ON ai.agent_id = agent.id
      JOIN Meeting ON ai.meeting_id = meeting.id
      WHERE ai.workspace_id = ? AND ai.created_at >= 今天 0:00
        AND (ai.human_decision IS NULL OR ai.human_decision = 'accepted')
      ORDER BY ai.created_at DESC LIMIT 10

    映射:
      - SCHEMA §3.5 字段 title = AIInsight.content (DB 是一句话结论)
      - SCHEMA §3.5 字段 body  = AIInsight.evidence (依据)
      - SCHEMA enum type     = normalize_insight_type(ai.type) — DB '决策建议'
                               → SCHEMA '决策'; '建议' → '思路'
      - ai_source            = agent_to_ai_source(agent) — 10 个固定 AI glyph 表

    过滤策略 (跟 task spec status='accepted' 对齐):
      AIInsight 模型 用 human_decision 字段 (NULL=pending / accepted / rejected).
      SCHEMA §3.5 mock 展示 全 当日 insight feed, 不限 已 accept.
      折中: 排除 human_decision='rejected' 已 显式拒的, 保留 NULL (pending) +
      'accepted' — 这样 "AI 智囊" 不会 因为 用户 没审 而 空盘.

    边界: empty → items=[], 不 raise.
    """
    ws_id = auth.workspace.id
    today_start, _ = _today_window_utc()

    rows = (
        await session.execute(
            select(AIInsight, Agent, Meeting.title)
            .join(Agent, Agent.id == AIInsight.agent_id)
            .outerjoin(Meeting, Meeting.id == AIInsight.meeting_id)
            .where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
                # 排除 已 显式拒绝 的 insight (rejected 不再 feed). NULL + 'accepted' 都 算.
                or_(
                    AIInsight.human_decision.is_(None),
                    AIInsight.human_decision == "accepted",
                ),
            )
            .order_by(desc(AIInsight.created_at))
            .limit(10)
        )
    ).all()

    items: List[InsightItem] = []
    for ins, agent, meeting_title in rows:
        ai_source_dict = agent_to_ai_source(agent)
        items.append(
            InsightItem(
                id=str(ins.id),
                type=normalize_insight_type(ins.type),
                ai_source=InsightAISource(
                    id=ai_source_dict["id"],
                    name=ai_source_dict["name"],
                    glyph=ai_source_dict["glyph"],
                    color=ai_source_dict["color"],
                ),
                title=ins.content or "",
                body=ins.evidence or "",
                source_meeting=meeting_title or "",
                source_meeting_id=str(ins.meeting_id) if ins.meeting_id else "",
                created_at=ins.created_at.astimezone(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            )
        )

    return InsightsResponse(items=items)


# ============================================================================
# §3.6 — GET /api/v2/today/decisions
# ============================================================================


class DecisionItem(BaseModel):
    id: str
    title: str
    decided_at: str
    meeting_id: str


class DecisionsResponse(BaseModel):
    items: List[DecisionItem]
    total_count: int


@router.get("/decisions", response_model=DecisionsResponse)
async def get_today_decisions(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> DecisionsResponse:
    """今天的决策 — 决策类 insight 当日 列表.

    v1.4.0 Saga T2 (Phase 2 W2): mock → 真接 (ABAC + workspace filter).

    数据源 (Planning §3.2 决策 A · 复用 AIInsight):
      AIInsight WHERE workspace_id + type IN DECISION_INSIGHT_TYPES
                + created_at >= 今天 0:00
      ORDER BY created_at DESC LIMIT 10

    映射 (SCHEMA §3.6):
      id          = AIInsight.id
      title       = AIInsight.content  (一句话 结论, 跟 insights endpoint 一致)
      decided_at  = AIInsight.created_at
      meeting_id  = AIInsight.meeting_id

    total_count 同 filter 不 limit.

    边界: empty → items=[], total_count=0.
    """
    ws_id = auth.workspace.id
    today_start, _ = _today_window_utc()

    # 1) Top 10 decisions today
    rows = (
        await session.execute(
            select(AIInsight)
            .where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
                AIInsight.type.in_(DECISION_INSIGHT_TYPES),
            )
            .order_by(desc(AIInsight.created_at))
            .limit(10)
        )
    ).scalars().all()

    # 2) total_count — 同 filter 无 limit
    total_count = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= today_start,
                AIInsight.type.in_(DECISION_INSIGHT_TYPES),
            )
        )
    ).scalar_one() or 0

    items: List[DecisionItem] = [
        DecisionItem(
            id=str(ins.id),
            title=ins.content or "",
            decided_at=ins.created_at.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            meeting_id=str(ins.meeting_id) if ins.meeting_id else "",
        )
        for ins in rows
    ]

    return DecisionsResponse(items=items, total_count=int(total_count))


# ============================================================================
# §3.7 — GET /api/v2/today/experts (专家视角列表)
# ============================================================================


class ExpertRecentMeeting(BaseModel):
    id: str
    title: str
    joined_at: str


class ExpertItem(BaseModel):
    id: str
    name: str
    glyph: str
    gradient_from: str
    gradient_to: str
    role_short: str
    last_active_at: str
    last_active_display: str
    recent_meetings: List[ExpertRecentMeeting]
    task_count: int


class ExpertsResponse(BaseModel):
    experts: List[ExpertItem]


# v1.4.0 Saga Q (Phase 1 P0): 10 个 AI 严格按设计稿 mobile-shared.jsx:24-34.
# 顺序 last_active_at desc 排序.
# 删: Phoenix ▲ / Saga ◐ / Aria-7 ◉ / Hummingbird ♪ / Echo ◇ (非设计稿)
# 加: Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥ / Scout ◈ (设计稿固定 10)
_EXPERTS = [
    ExpertItem(
        id="ai-mira",
        name="Mira",
        glyph="◎",
        gradient_from="#FFB340",
        gradient_to="#FF9F0A",
        role_short="主持人",
        last_active_at="2026-05-27T11:30:00Z",
        last_active_display="刚刚",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-live-q3-roadmap",
                title="Q3 路线图对齐",
                joined_at="2026-05-27T09:30:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-data-compliance",
                title="数据安全合规风险评估会",
                joined_at="2026-05-26T15:00:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-elevator-upgrade",
                title="电梯改造方案决策会",
                joined_at="2026-05-21T10:00:00Z",
            ),
        ],
        task_count=3,
    ),
    ExpertItem(
        id="ai-stratos",
        name="Stratos",
        glyph="◆",
        gradient_from="#AF52DE",
        gradient_to="#FF375F",
        role_short="产品策略",
        last_active_at="2026-05-27T11:15:00Z",
        last_active_display="15 分钟前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-live-q3-roadmap",
                title="Q3 路线图对齐",
                joined_at="2026-05-27T09:30:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-elevator-upgrade",
                title="电梯改造方案决策会",
                joined_at="2026-05-21T10:00:00Z",
            ),
        ],
        task_count=1,
    ),
    ExpertItem(
        id="ai-sage",
        name="Sage",
        glyph="✦",
        gradient_from="#FF2D55",
        gradient_to="#AF52DE",
        role_short="UX 顾问",
        last_active_at="2026-05-27T11:00:00Z",
        last_active_display="30 分钟前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-upcoming-search-review-4",
                title="搜索体验评审 #4",
                joined_at="2026-05-27T14:00:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-data-compliance",
                title="数据安全合规风险评估会",
                joined_at="2026-05-26T15:00:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-q1-complaint",
                title="Q1 投诉趋势复盘",
                joined_at="2026-05-20T09:30:00Z",
            ),
        ],
        task_count=2,
    ),
    ExpertItem(
        id="ai-aria",
        name="Aria",
        glyph="⌬",
        gradient_from="#0A84FF",
        gradient_to="#5E5CE6",
        role_short="数据分析师",
        last_active_at="2026-05-27T10:55:00Z",
        last_active_display="35 分钟前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-live-q3-roadmap",
                title="Q3 路线图对齐",
                joined_at="2026-05-27T09:30:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-ab-review",
                title="摘要模型 A/B 复盘",
                joined_at="2026-05-22T14:00:00Z",
            ),
        ],
        task_count=1,
    ),
    ExpertItem(
        id="ai-lex",
        name="Lex",
        glyph="§",
        gradient_from="#FF9F0A",
        gradient_to="#FFB340",
        role_short="法务合规",
        last_active_at="2026-05-26T16:42:00Z",
        last_active_display="昨天",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-finished-data-compliance",
                title="数据安全合规风险评估会",
                joined_at="2026-05-26T15:00:00Z",
            ),
            ExpertRecentMeeting(
                id="m-finished-q1-complaint",
                title="Q1 投诉趋势复盘",
                joined_at="2026-05-20T09:30:00Z",
            ),
        ],
        task_count=0,
    ),
    ExpertItem(
        id="ai-zhaojie",
        name="服务赵姐",
        glyph="♥",
        gradient_from="#FF6482",
        gradient_to="#FF375F",
        role_short="客户体验",
        last_active_at="2026-05-26T11:00:00Z",
        last_active_display="昨天",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-upcoming-hummingbird-feedback",
                title="客户访谈 · Hummingbird 反馈",
                joined_at="2026-05-27T16:30:00Z",
            ),
        ],
        task_count=1,
    ),
    ExpertItem(
        id="ai-shu",
        name="数小妙",
        glyph="∑",
        gradient_from="#5E5CE6",
        gradient_to="#AF52DE",
        role_short="数据 · KPI",
        last_active_at="2026-05-25T16:10:00Z",
        last_active_display="2 天前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-finished-ab-review",
                title="摘要模型 A/B 复盘",
                joined_at="2026-05-22T14:00:00Z",
            ),
        ],
        task_count=0,
    ),
    ExpertItem(
        id="ai-scout",
        name="Scout",
        glyph="◈",
        gradient_from="#34C759",
        gradient_to="#30B0C7",
        role_short="竞品研究",
        last_active_at="2026-05-22T15:08:00Z",
        last_active_display="5 天前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-finished-ab-review",
                title="摘要模型 A/B 复盘",
                joined_at="2026-05-22T14:00:00Z",
            ),
        ],
        task_count=0,
    ),
    ExpertItem(
        id="ai-falao",
        name="法老张",
        glyph="⚖",
        gradient_from="#FF9F0A",
        gradient_to="#FF6482",
        role_short="法规 · 合规",
        last_active_at="2026-05-21T11:30:00Z",
        last_active_display="6 天前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-finished-elevator-upgrade",
                title="电梯改造方案决策会",
                joined_at="2026-05-21T10:00:00Z",
            ),
        ],
        task_count=0,
    ),
    ExpertItem(
        id="ai-tally",
        name="Tally",
        glyph="¥",
        gradient_from="#64D2FF",
        gradient_to="#0A84FF",
        role_short="财务建模",
        last_active_at="2026-05-20T10:55:00Z",
        last_active_display="7 天前",
        recent_meetings=[
            ExpertRecentMeeting(
                id="m-finished-q1-complaint",
                title="Q1 投诉趋势复盘",
                joined_at="2026-05-20T09:30:00Z",
            ),
        ],
        task_count=0,
    ),
]


@router.get("/experts", response_model=ExpertsResponse)
async def get_today_experts() -> ExpertsResponse:
    """专家视角 — 10 个 AI, 按 last_active_at desc 排序."""
    return ExpertsResponse(experts=_EXPERTS)
