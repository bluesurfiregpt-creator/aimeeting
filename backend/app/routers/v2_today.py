"""
v1.4.0 · Saga N (Phase 1 · W2) · Mobile App v2 — Today 命名空间.

Mock endpoint, Phase 1 全部写死 mock JSON (PM 5=a 拍板).
契约: docs/SCHEMA-mobile-v2.md §3 (today/* 全部 7 个 endpoint).

约定:
  - 与 老 /api/m/* (mobile.py) 隔离, 走 /api/v2/today/* 命名空间
  - 与 §2 meetings 共用 V2Attendee / V2AIBadge / V2MeetingItem schema (从
    v2_meetings 复用避免重复)
  - 不挂 auth gate. Phase 1 mock 数据均匿名可拉
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace · Q3 路线图 / 搜索体验评审 / 客户访谈
AI 10 个 (v1.4.0 Saga Q · Phase 1 P0 修复, 严格按设计稿 mobile-shared.jsx:24-34):
  Mira ◎ / Aria ⌬ / Stratos ◆ / Sage ✦ / Lex § / Scout ◈ /
  Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from .v2_meetings import (
    V2MeetingItem,
    _LIVE_MEETING,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2/today", tags=["mobile-v2-today"])


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
    """Mira 早间简报 — Phase 1 写死 mock."""
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
        target_meeting_id=_LIVE_MEETING.id,
    )


# ============================================================================
# §3.2 — GET /api/v2/today/live-meeting
# ============================================================================


class LiveMeetingResponse(BaseModel):
    meeting: Optional[V2MeetingItem] = None
    mira_note: Optional[str] = None


@router.get("/live-meeting", response_model=LiveMeetingResponse)
async def get_today_live_meeting() -> LiveMeetingResponse:
    """当前 live 会议 + Mira 笔记. 无 live 时 meeting=null.

    v1.4.0 Saga Q (Phase 1 P0): mira_note 改为跟设计稿一致 ("12 个关键点 · 3 个待你确认").
    """
    return LiveMeetingResponse(
        meeting=_LIVE_MEETING,
        mira_note="Mira 已记录 12 个关键点 · 3 个待你确认",
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
async def get_today_snapshot() -> SnapshotResponse:
    """4 格 stat tile — 场会议 / 待处理 / AI 洞察 / 已决策.

    v1.4.0 Saga Q (Phase 1 P0): pending_tasks 从 3 改 6, 跟设计稿一致.
    """
    return SnapshotResponse(
        meetings_today=4,
        pending_tasks=6,
        ai_insights_today=4,
        decisions_today=2,
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


_PENDING_TASKS = [
    PendingTaskItem(
        id="t-q3-collab",
        title="拍板「协作功能能否进入 Q3」",
        source_meeting="Q3 路线图对齐",
        source_meeting_id="m-live-q3-roadmap",
        urgency="today",
        ai_source=PendingTaskAISource(
            id="ai-stratos",
            name="Stratos",
            glyph="◆",
            color="#AF52DE",
        ),
        due_at="2026-05-27T11:30:00Z",
        due_display="今天 11:30",
    ),
    PendingTaskItem(
        id="t-sage-chip",
        title="审核 Sage 搜索结果页 chip 顺序变更",
        source_meeting="搜索体验评审",
        source_meeting_id="m-upcoming-search-review-4",
        urgency="today",
        ai_source=PendingTaskAISource(
            id="ai-sage",
            name="Sage",
            glyph="✦",
            color="#5E5CE6",
        ),
        due_at="2026-05-27T14:00:00Z",
        due_display="今天 14:00",
    ),
    PendingTaskItem(
        id="t-hummingbird-reply",
        title="回复客户关于摘要质量的疑问",
        source_meeting="客户访谈",
        source_meeting_id="m-upcoming-hummingbird-feedback",
        urgency="week",
        # v1.4.0 Saga Q: Hummingbird → 服务赵姐 (设计稿固定阵容)
        ai_source=PendingTaskAISource(
            id="ai-zhaojie",
            name="服务赵姐",
            glyph="♥",
            color="#FF6482",
        ),
        due_at="2026-05-29T18:00:00Z",
        due_display="本周",
    ),
]


@router.get("/pending-tasks", response_model=PendingTasksResponse)
async def get_today_pending_tasks() -> PendingTasksResponse:
    """等你处理 — 3 条今日 / 本周 pending 任务."""
    return PendingTasksResponse(
        items=_PENDING_TASKS,
        total_count=len(_PENDING_TASKS),
    )


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
async def get_today_insights() -> InsightsResponse:
    """AI 智囊·今日 — 3 条 (决策 / 风险 / 洞察)."""
    return InsightsResponse(items=_INSIGHTS)


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


_DECISIONS = [
    DecisionItem(
        id="dec-q3-collab",
        title="Q3 路线图: 协作功能延后到 Q4 第一双周",
        decided_at="2026-05-27T11:35:00Z",
        meeting_id="m-live-q3-roadmap",
    ),
    DecisionItem(
        id="dec-search-compliance",
        title="搜索改版上线前补 1 周合规审查",
        decided_at="2026-05-27T10:45:00Z",
        meeting_id="m-upcoming-search-review-4",
    ),
]


@router.get("/decisions", response_model=DecisionsResponse)
async def get_today_decisions() -> DecisionsResponse:
    """今天的决策 — 2 条已敲定."""
    return DecisionsResponse(items=_DECISIONS, total_count=len(_DECISIONS))


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
