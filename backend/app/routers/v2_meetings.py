"""
v1.4.0 · Saga M (Phase 1 · W1) · Mobile App v2 — Meetings 命名空间.

Mock endpoint, Phase 1 全部 写死 mock JSON (PM 5=a 拍板).
契约: docs/SCHEMA-mobile-v2.md §2.1 (week-pulse) + §2.2 (meetings 升级).

约定:
  - 与老 /api/m/meetings (mobile.py) 隔离, 走 /api/v2/meetings 命名空间, 不互相影响
  - 不挂 auth gate. Phase 1 mock 数据均匿名可拉. Phase 2 真接时再补 abac
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace · Q3 路线图 / 搜索体验评审 / 客户访谈
AI 10 个 (v1.4.0 Saga Q · Phase 1 P0, 严格按设计稿 mobile-shared.jsx:24-34):
  Mira ◎ / Aria ⌬ / Stratos ◆ / Sage ✦ / Lex § / Scout ◈ /
  Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

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
    """Mira 本周脉络 inline notice. Phase 1 写死 mock."""
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


# Mock data — 仿 福田住建局 demo. 1 live + 2 upcoming + 5 finished = 8 场
_MOCK_AI_ARIA = V2AIBadge(
    id="ai-aria",
    name="Aria",
    glyph="⌬",
    gradient_from="#0A84FF",
    gradient_to="#5E5CE6",
)
_MOCK_AI_STRATOS = V2AIBadge(
    id="ai-stratos",
    name="Stratos",
    glyph="◆",
    gradient_from="#AF52DE",
    gradient_to="#FF375F",
)
_MOCK_AI_MIRA = V2AIBadge(
    id="ai-mira",
    name="Mira",
    glyph="◎",
    gradient_from="#FFB340",
    gradient_to="#FF9F0A",
)
_MOCK_AI_SAGE = V2AIBadge(
    id="ai-sage",
    name="Sage",
    glyph="✦",
    gradient_from="#5E5CE6",
    gradient_to="#AF52DE",
)
_MOCK_AI_LEX = V2AIBadge(
    id="ai-lex",
    name="Lex",
    glyph="§",
    gradient_from="#FF9F0A",
    gradient_to="#FFB340",
)
# v1.4.0 Saga Q (Phase 1 P0): Hummingbird → Zhaojie / Phoenix → Scout (设计稿固定阵容)
_MOCK_AI_ZHAOJIE = V2AIBadge(
    id="ai-zhaojie",
    name="服务赵姐",
    glyph="♥",
    gradient_from="#FF6482",
    gradient_to="#FF375F",
)
_MOCK_AI_SCOUT = V2AIBadge(
    id="ai-scout",
    name="Scout",
    glyph="◈",
    gradient_from="#34C759",
    gradient_to="#30B0C7",
)


def _h(uid: str, name: str, color: str) -> V2Attendee:
    return V2Attendee(
        type="human", id=uid, name=name, color=color, glyph=None, gradient_to=None
    )


def _a(badge: V2AIBadge) -> V2Attendee:
    return V2Attendee(
        type="ai",
        id=badge.id,
        name=badge.name,
        color=badge.gradient_from,
        glyph=badge.glyph,
        gradient_to=badge.gradient_to,
    )


# ─── live meeting ──────────────────────────────────────────────────────────
_LIVE_MEETING = V2MeetingItem(
    id="m-live-q3-roadmap",
    title="Q3 路线图对齐",
    topic_summary="产品组周会 · Q3 重点路线 · 协作功能取舍",
    status="live",
    started_at="2026-05-27T09:30:00Z",
    scheduled_for="2026-05-27T09:30:00Z",
    ended_at=None,
    elapsed_minutes=23,
    countdown_seconds=None,
    decision_count=0,
    attendees=[
        _h("u-zhou", "周凯", "#FF9F0A"),
        _h("u-lin", "林敏", "#34C759"),
        _h("u-wang", "王俊", "#5E5CE6"),
        _h("u-chen", "陈宇", "#FF375F"),
        _h("u-su", "苏蕾", "#30B0C7"),
    ],
    human_count=5,
    ai_count=3,
    ai_badges=[_MOCK_AI_ARIA, _MOCK_AI_STRATOS, _MOCK_AI_MIRA],
)


# ─── upcoming meetings ─────────────────────────────────────────────────────
_UPCOMING_MEETINGS = [
    V2MeetingItem(
        id="m-upcoming-search-review-4",
        title="搜索体验评审 #4",
        topic_summary="设计走查 · 搜索结果页 v5 · chip 顺序",
        status="upcoming",
        started_at=None,
        scheduled_for="2026-05-27T14:00:00Z",
        ended_at=None,
        elapsed_minutes=None,
        countdown_seconds=8280,  # 2h 18m
        decision_count=0,
        attendees=[
            _h("u-lin", "林敏", "#34C759"),
            _h("u-wang", "王俊", "#5E5CE6"),
            _h("u-henry", "Henry", "#AF52DE"),
        ],
        human_count=3,
        ai_count=2,
        ai_badges=[_MOCK_AI_MIRA, _MOCK_AI_SAGE],
    ),
    V2MeetingItem(
        id="m-upcoming-hummingbird-feedback",
        title="客户访谈 · Hummingbird 反馈",
        topic_summary="客户访谈 · 上线后第一周反馈",
        status="upcoming",
        started_at=None,
        scheduled_for="2026-05-27T16:30:00Z",
        ended_at=None,
        elapsed_minutes=None,
        countdown_seconds=17460,  # ~4h 51m
        decision_count=0,
        attendees=[
            _h("u-zhou", "周凯", "#FF9F0A"),
            _h("u-su", "苏蕾", "#30B0C7"),
        ],
        human_count=2,
        ai_count=3,
        ai_badges=[_MOCK_AI_MIRA, _MOCK_AI_ZHAOJIE, _MOCK_AI_SCOUT],
    ),
]


# ─── finished meetings ─────────────────────────────────────────────────────
_FINISHED_MEETINGS = [
    V2MeetingItem(
        id="m-finished-standup",
        title="早间 Standup",
        topic_summary="团队同步 · iOS 联调阻塞 · 详情页过场",
        status="finished",
        started_at="2026-05-27T09:00:00Z",
        scheduled_for="2026-05-27T09:00:00Z",
        ended_at="2026-05-27T09:18:00Z",
        elapsed_minutes=18,
        countdown_seconds=None,
        decision_count=2,
        attendees=[
            _h("u-zhou", "周凯", "#FF9F0A"),
            _h("u-lin", "林敏", "#34C759"),
            _h("u-wang", "王俊", "#5E5CE6"),
            _h("u-chen", "陈宇", "#FF375F"),
            _h("u-su", "苏蕾", "#30B0C7"),
            _h("u-henry", "Henry", "#AF52DE"),
            _h("u-ye", "叶倩", "#FF6482"),
        ],
        human_count=7,
        ai_count=2,
        ai_badges=[_MOCK_AI_MIRA, _MOCK_AI_ARIA],
    ),
    V2MeetingItem(
        id="m-finished-data-compliance",
        title="数据安全合规风险评估会",
        topic_summary="跨部门评审 · 业主敏感信息留存",
        status="finished",
        started_at="2026-05-26T15:00:00Z",
        scheduled_for="2026-05-26T15:00:00Z",
        ended_at="2026-05-26T16:42:00Z",
        elapsed_minutes=102,
        countdown_seconds=None,
        decision_count=3,
        attendees=[
            _h("u-zhou", "周凯", "#FF9F0A"),
            _h("u-henry", "Henry", "#AF52DE"),
            _h("u-tom", "Tom", "#0A84FF"),
            _h("u-ruan", "阮波", "#BF5AF2"),
        ],
        human_count=4,
        ai_count=3,
        ai_badges=[_MOCK_AI_MIRA, _MOCK_AI_LEX, _MOCK_AI_SAGE],
    ),
    V2MeetingItem(
        id="m-finished-ab-review",
        title="摘要模型 A/B 复盘",
        topic_summary="数据复盘 · B 组延迟 vs 有用率",
        status="finished",
        started_at="2026-05-22T14:00:00Z",
        scheduled_for="2026-05-22T14:00:00Z",
        ended_at="2026-05-22T15:08:00Z",
        elapsed_minutes=68,
        countdown_seconds=None,
        decision_count=1,
        attendees=[
            _h("u-wang", "王俊", "#5E5CE6"),
            _h("u-chen", "陈宇", "#FF375F"),
        ],
        human_count=2,
        ai_count=2,
        ai_badges=[_MOCK_AI_ARIA, _MOCK_AI_SAGE],
    ),
    V2MeetingItem(
        id="m-finished-elevator-upgrade",
        title="电梯改造方案决策会",
        topic_summary="物业 + 工程联席 · 12 栋老旧电梯改造排期",
        status="finished",
        started_at="2026-05-21T10:00:00Z",
        scheduled_for="2026-05-21T10:00:00Z",
        ended_at="2026-05-21T11:30:00Z",
        elapsed_minutes=90,
        countdown_seconds=None,
        decision_count=4,
        attendees=[
            _h("u-zhou", "周凯", "#FF9F0A"),
            _h("u-lin", "林敏", "#34C759"),
            _h("u-tom", "Tom", "#0A84FF"),
            _h("u-ye", "叶倩", "#FF6482"),
        ],
        human_count=4,
        ai_count=2,
        ai_badges=[_MOCK_AI_MIRA, _MOCK_AI_STRATOS],
    ),
    V2MeetingItem(
        id="m-finished-q1-complaint",
        title="Q1 投诉趋势复盘",
        topic_summary="数据洞察 · 单栋 + 单分类异常集中",
        status="finished",
        started_at="2026-05-20T09:30:00Z",
        scheduled_for="2026-05-20T09:30:00Z",
        ended_at="2026-05-20T10:55:00Z",
        elapsed_minutes=85,
        countdown_seconds=None,
        decision_count=2,
        attendees=[
            _h("u-zhou", "周凯", "#FF9F0A"),
            _h("u-su", "苏蕾", "#30B0C7"),
            _h("u-ruan", "阮波", "#BF5AF2"),
        ],
        human_count=3,
        ai_count=2,
        ai_badges=[_MOCK_AI_SAGE, _MOCK_AI_LEX],
    ),
]


@router.get("/meetings", response_model=V2MeetingsListResponse)
async def list_v2_meetings(
    status: Optional[str] = Query(
        None,
        description="过滤状态: live | upcoming | finished",
    ),
    limit: int = Query(20, ge=1, le=50),
    cursor: Optional[str] = Query(None, description="分页 cursor (mock 不实现)"),
) -> V2MeetingsListResponse:
    """v2 会议列表 — 升级版含 attendees + AI badges + topic.

    Phase 1 写死 mock data: 1 live + 2 upcoming + 5 finished.
    Phase 2 backend 真接 DB / agent 数据时, schema 不变.
    """
    if status == "live":
        items = [_LIVE_MEETING]
    elif status == "upcoming":
        items = list(_UPCOMING_MEETINGS)
    elif status == "finished":
        items = list(_FINISHED_MEETINGS)
    else:
        items = [_LIVE_MEETING, *_UPCOMING_MEETINGS, *_FINISHED_MEETINGS]
    return V2MeetingsListResponse(items=items[:limit], next_cursor=None)
