"""
v1.4.0 · Saga M (Phase 1 · W1) + Saga T2 (Phase 2 · W2) · Mobile App v2 — Meetings.

契约: docs/SCHEMA-mobile-v2.md §2.1 (week-pulse) + §2.2 (meetings 升级).

Phase 1 (Saga M · mock): week-pulse + meetings (升级 schema).
Phase 2 (Saga T2 · 真接 DB): /api/v2/meetings — 走 ABAC + workspace filter +
                              JOIN MeetingAttendee → users / agents + AIInsight
                              decision_count. week-pulse 留 mock 给 Saga T6 NLU.

约定:
  - 与老 /api/m/meetings (mobile.py) 隔离, 走 /api/v2/meetings 命名空间
  - 真接 endpoint 走 get_current_auth + workspace.id filter (Saga T2 起强制)
  - mock endpoint (week-pulse) Phase 1 anon 暂留, T6 转真时上 ABAC
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace · Q3 路线图 / 搜索体验评审 / 客户访谈
AI 10 个 (v1.4.0 Saga Q · Phase 1 P0, 严格按设计稿 mobile-shared.jsx:24-34):
  Mira ◎ / Aria ⌬ / Stratos ◆ / Sage ✦ / Lex § / Scout ◈ /
  Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent_glyphs import DECISION_INSIGHT_TYPES
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import AIInsight, Agent, Meeting, MeetingAttendee, User
from ..v2_helpers import build_meeting_item, map_meeting_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2", tags=["mobile-v2"])


# ============================================================================
# Shared schemas — Attendee / AI badge (跟 SCHEMA §1 一致)
# ============================================================================

class V2Attendee(BaseModel):
    """会议 参与者 — type 决定 是 human 还是 ai."""
    type: str  # "human" | "ai"
    id: str
    name: str
    color: str  # human: avatar_color · ai: gradient_from
    glyph: Optional[str] = None  # ai 才有
    gradient_to: Optional[str] = None  # ai 才有


class V2AIBadge(BaseModel):
    """AI badge — 精简版 AIAgent, 卡片 右下 角 用."""
    id: str
    name: str
    glyph: str
    gradient_from: str
    gradient_to: str


# ============================================================================
# §2.1 — GET /api/v2/meetings/week-pulse (MiraPulseNotice)
# ============================================================================

class WeekPulseChip(BaseModel):
    label: str
    count: int
    icon: str  # emoji or icon name


class WeekPulseResponse(BaseModel):
    week_start: str
    week_end: str
    meeting_count: int
    summary_text: str
    decision_recommendation: str
    chips: List[WeekPulseChip]


@router.get("/meetings/week-pulse", response_model=WeekPulseResponse)
async def get_week_pulse() -> WeekPulseResponse:
    """Mira 本周脉络 inline notice. Phase 1 写死 mock (Saga T6 NLU 真接)."""
    return WeekPulseResponse(
        week_start="2026-05-25T00:00:00Z",
        week_end="2026-05-31T23:59:59Z",
        meeting_count=6,
        summary_text="本周 6 场会, 搜索体验线吃掉了 4 场",
        decision_recommendation=(
            "Q3 路线图卡在「协作功能取舍」上, 建议 10:30 拍板, "
            "后补会议由 Stratos 提摘要"
        ),
        chips=[
            WeekPulseChip(label="今日决策", count=1, icon="📌"),
            WeekPulseChip(label="待同步", count=3, icon="📥"),
        ],
    )


# ============================================================================
# §2.2 — GET /api/v2/meetings (升级版 带 attendees + AI badges + topic)
# ============================================================================

class V2MeetingItem(BaseModel):
    id: str
    title: str
    topic_summary: str
    status: str  # "upcoming" | "live" | "finished" | "processed"
    started_at: Optional[str] = None
    scheduled_for: str
    ended_at: Optional[str] = None
    elapsed_minutes: Optional[int] = None
    countdown_seconds: Optional[int] = None
    decision_count: int = 0
    attendees: List[V2Attendee]
    human_count: int
    ai_count: int
    ai_badges: List[V2AIBadge]


class V2MeetingsListResponse(BaseModel):
    items: List[V2MeetingItem]
    next_cursor: Optional[str] = None


# ============================================================================
# Saga T2 · Internal helper — load attendees + decisions for a batch of meetings
# ============================================================================


async def _load_meeting_extras(
    session: AsyncSession,
    meetings: List[Meeting],
) -> tuple[dict[str, List[User]], dict[str, List[Agent]], dict[str, int]]:
    """v1.4.0 Saga T2 · 批量 加载 attendees + decision count.

    给一批 Meeting, 单次 query 拉出:
      humans_by_meeting    — { meeting_id: [User, ...] }
      agents_by_meeting    — { meeting_id: [Agent, ...] }
      decisions_by_meeting — { meeting_id: int }

    避免 N+1 查询 — 每个 meeting 拉一次 attendees / decisions 会爆.

    边界: 空 meetings list → 3 个空 dict, 不查 DB.
    """
    humans_by_meeting: dict[str, List[User]] = {}
    agents_by_meeting: dict[str, List[Agent]] = {}
    decisions_by_meeting: dict[str, int] = {}

    if not meetings:
        return humans_by_meeting, agents_by_meeting, decisions_by_meeting

    meeting_ids = [m.id for m in meetings]

    # 1) Humans — JOIN MeetingAttendee → User (user_id IS NOT NULL)
    human_rows = (
        await session.execute(
            select(MeetingAttendee.meeting_id, User)
            .join(User, User.id == MeetingAttendee.user_id)
            .where(
                MeetingAttendee.meeting_id.in_(meeting_ids),
                MeetingAttendee.user_id.is_not(None),
            )
        )
    ).all()
    for meeting_id, user in human_rows:
        humans_by_meeting.setdefault(str(meeting_id), []).append(user)

    # 2) Agents — JOIN MeetingAttendee → Agent (agent_id IS NOT NULL)
    agent_rows = (
        await session.execute(
            select(MeetingAttendee.meeting_id, Agent)
            .join(Agent, Agent.id == MeetingAttendee.agent_id)
            .where(
                MeetingAttendee.meeting_id.in_(meeting_ids),
                MeetingAttendee.agent_id.is_not(None),
            )
        )
    ).all()
    for meeting_id, agent in agent_rows:
        agents_by_meeting.setdefault(str(meeting_id), []).append(agent)

    # 3) Decision count — AIInsight WHERE meeting_id IN (...) + type IN DECISION
    decision_rows = (
        await session.execute(
            select(
                AIInsight.meeting_id,
                func.count(AIInsight.id),
            )
            .where(
                AIInsight.meeting_id.in_(meeting_ids),
                AIInsight.type.in_(DECISION_INSIGHT_TYPES),
            )
            .group_by(AIInsight.meeting_id)
        )
    ).all()
    for meeting_id, cnt in decision_rows:
        decisions_by_meeting[str(meeting_id)] = int(cnt or 0)

    return humans_by_meeting, agents_by_meeting, decisions_by_meeting


# ============================================================================
# §2.2 — Handler
# ============================================================================


# DB status 字面值 — caller `?status=live` 等 SCHEMA enum 反查 DB status:
#   SCHEMA upcoming  → DB scheduled
#   SCHEMA live      → DB ongoing
#   SCHEMA finished  → DB finished
#   SCHEMA processed → DB processed
_SCHEMA_STATUS_TO_DB: dict[str, tuple[str, ...]] = {
    "upcoming": ("scheduled",),
    "live": ("ongoing",),
    # finished 含 已 处理 (UI Tab "已结束" 一般也 看 processed)
    "finished": ("finished", "processed"),
    "processed": ("processed",),
}


@router.get("/meetings", response_model=V2MeetingsListResponse)
async def list_v2_meetings(
    status: Optional[str] = Query(
        None,
        description="过滤状态: live | upcoming | finished | processed",
    ),
    limit: int = Query(20, ge=1, le=50),
    cursor: Optional[str] = Query(None, description="分页 cursor (暂未实现, 留接口)"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> V2MeetingsListResponse:
    """v2 会议列表 — 真接 DB. SCHEMA §2.2.

    v1.4.0 Saga T2 (Phase 2 W2): mock → 真接 (ABAC + workspace filter).

    数据源:
      Meeting WHERE workspace_id + (status 过滤) 排序 started_at desc
        live     → ongoing
        upcoming → scheduled
        finished → finished + processed (UI 概念一并归 已结束)
      attendees + AI badges + decision_count 走 _load_meeting_extras 批量 拉.

    排序:
      live: 1 个就 1 个 (没 排序 必要)
      upcoming: ORDER BY started_at ASC (最近 一个 在前)
      finished: ORDER BY ended_at DESC NULLS LAST, started_at DESC (最近 结束 在前)
      default (all): live → upcoming → finished 拼接, 各自内排

    边界:
      - empty workspace → items=[], 不 raise
      - meeting started_at NULL → scheduled_for 退到 created_at (v2_helpers)
    """
    ws_id = auth.workspace.id

    # 1) Build query — status 过滤
    base_query = select(Meeting).where(Meeting.workspace_id == ws_id)

    if status:
        db_statuses = _SCHEMA_STATUS_TO_DB.get(status)
        if db_statuses is None:
            # 未知 status enum, 兜底 返 空 list (不 抛 400, 给 client 容忍)
            return V2MeetingsListResponse(items=[], next_cursor=None)
        base_query = base_query.where(Meeting.status.in_(db_statuses))

        # 排序 跟 SCHEMA tab 业务一致
        if status == "upcoming":
            base_query = base_query.order_by(Meeting.started_at.asc().nulls_last())
        elif status == "finished":
            base_query = base_query.order_by(
                Meeting.ended_at.desc().nulls_last(),
                Meeting.started_at.desc().nulls_last(),
            )
        else:
            # live / processed
            base_query = base_query.order_by(Meeting.started_at.desc().nulls_last())
    else:
        # 不指定 status — live 优先, 然后 scheduled, 最后 finished/processed
        # SQL CASE 排序: ongoing=0 / scheduled=1 / finished/processed=2
        base_query = base_query.order_by(
            func.coalesce(Meeting.started_at, Meeting.created_at).desc()
        )

    meetings_rows = (
        await session.execute(base_query.limit(limit))
    ).scalars().all()

    if not meetings_rows:
        return V2MeetingsListResponse(items=[], next_cursor=None)

    # 2) 批量 加载 attendees + decisions (一次 SQL 各)
    humans_by_meeting, agents_by_meeting, decisions_by_meeting = (
        await _load_meeting_extras(session, list(meetings_rows))
    )

    # 3) Build items
    items: List[V2MeetingItem] = []
    for m in meetings_rows:
        mid = str(m.id)
        item_dict = build_meeting_item(
            m,
            human_users=humans_by_meeting.get(mid, []),
            ai_agents=agents_by_meeting.get(mid, []),
            decision_count=decisions_by_meeting.get(mid, 0),
        )
        items.append(V2MeetingItem(**item_dict))

    return V2MeetingsListResponse(items=items, next_cursor=None)
