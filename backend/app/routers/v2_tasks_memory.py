"""
v1.4.0 · Saga O (Phase 1 · W3) · Mobile App v2 — Tasks + Memory 命名空间.

Mock endpoint, Phase 1 全部 写死 mock JSON (PM 5=a 拍板).
契约: docs/SCHEMA-mobile-v2.md §4 (tasks + memory 全部 4 个 endpoint).

约定:
  - 与 老 /api/m/tasks + /api/m/memory 隔离, 走 /api/v2/tasks/* + /api/v2/memory/*
  - 与 §2 meetings / §3 today 共用 mock 数据风格 (福田住建局)
  - 不挂 auth gate. Phase 1 mock 数据均匿名可拉
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace
AI: Stratos / Sage / Hummingbird / Lex / Mira / Aria / Aria-7 / Phoenix / Saga / Echo
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2", tags=["mobile-v2-tasks-memory"])


# ============================================================================
# §4.1 — GET /api/v2/tasks/priority-banner (M4 Mira 优先级 banner)
# ============================================================================


class PriorityBannerResponse(BaseModel):
    urgent_task_count: int
    summary_text: str
    ai_suggestion_count: int
    ai_suggestion_text: str


@router.get("/tasks/priority-banner", response_model=PriorityBannerResponse)
async def get_tasks_priority_banner() -> PriorityBannerResponse:
    """Mira 优先级 banner — 今日必做 + AI 建议 计数."""
    return PriorityBannerResponse(
        urgent_task_count=1,
        summary_text="1 项今日必做 · 11:30 前拍板「协作功能能否进入 Q3」",
        ai_suggestion_count=2,
        ai_suggestion_text="AI 找到 2 项任务可触发",
    )


# ============================================================================
# §4.2 — GET /api/v2/tasks/grouped (M4 按来源会议分组)
# ============================================================================


class TaskAISource(BaseModel):
    id: str
    name: str
    glyph: str
    color: str  # hex


class TaskItem(BaseModel):
    id: str
    title: str
    urgency: str  # "urgent" | "today" | "week" | "none"
    ai_source: TaskAISource
    due_at: str
    due_display: str
    status: str  # "pending" | "tracking" | "done"
    source_meeting: Optional[str] = None
    source_meeting_id: Optional[str] = None


class TaskGroup(BaseModel):
    meeting_id: str
    meeting_title: str
    tasks: List[TaskItem]


class TasksGroupedResponse(BaseModel):
    groups: List[TaskGroup]


# pending 状态 — 3 组各 1 task (Q3 / Sage / Hummingbird)
_TASKS_PENDING: List[TaskGroup] = [
    TaskGroup(
        meeting_id="m-live-q3-roadmap",
        meeting_title="Q3 路线图对齐",
        tasks=[
            TaskItem(
                id="t-q3-collab",
                title="拍板「协作功能能否进入 Q3」",
                urgency="today",
                ai_source=TaskAISource(
                    id="ai-stratos",
                    name="Stratos",
                    glyph="◆",
                    color="#AF52DE",
                ),
                due_at="2026-05-27T11:30:00Z",
                due_display="今天 11:30",
                status="pending",
                source_meeting="Q3 路线图对齐",
                source_meeting_id="m-live-q3-roadmap",
            ),
        ],
    ),
    TaskGroup(
        meeting_id="m-upcoming-search-review-4",
        meeting_title="搜索体验评审 #4",
        tasks=[
            TaskItem(
                id="t-sage-chip",
                title="审核 Sage 搜索结果页 chip 顺序变更",
                urgency="today",
                ai_source=TaskAISource(
                    id="ai-sage",
                    name="Sage",
                    glyph="✦",
                    color="#5E5CE6",
                ),
                due_at="2026-05-27T14:00:00Z",
                due_display="今天 14:00",
                status="pending",
                source_meeting="搜索体验评审 #4",
                source_meeting_id="m-upcoming-search-review-4",
            ),
        ],
    ),
    TaskGroup(
        meeting_id="m-upcoming-hummingbird-feedback",
        meeting_title="客户访谈",
        tasks=[
            TaskItem(
                id="t-hummingbird-reply",
                title="回复 Hummingbird 关于摘要质量的疑问",
                urgency="week",
                ai_source=TaskAISource(
                    id="ai-hummingbird",
                    name="Hummingbird",
                    glyph="♪",
                    color="#FF6482",
                ),
                due_at="2026-05-29T18:00:00Z",
                due_display="本周",
                status="pending",
                source_meeting="客户访谈",
                source_meeting_id="m-upcoming-hummingbird-feedback",
            ),
        ],
    ),
]


# tracking 状态 — 1 组 1 task
_TASKS_TRACKING: List[TaskGroup] = [
    TaskGroup(
        meeting_id="m-finished-data-compliance",
        meeting_title="数据安全合规风险评估会",
        tasks=[
            TaskItem(
                id="t-lex-pii-followup",
                title="跟进 Lex 提的 PII 审计补丁部署进度",
                urgency="week",
                ai_source=TaskAISource(
                    id="ai-lex",
                    name="Lex",
                    glyph="§",
                    color="#FF9F0A",
                ),
                due_at="2026-05-30T18:00:00Z",
                due_display="本周",
                status="tracking",
                source_meeting="数据安全合规风险评估会",
                source_meeting_id="m-finished-data-compliance",
            ),
        ],
    ),
]


# done 状态 — 1 组 2 task
_TASKS_DONE: List[TaskGroup] = [
    TaskGroup(
        meeting_id="m-finished-elevator-upgrade",
        meeting_title="电梯改造方案决策会",
        tasks=[
            TaskItem(
                id="t-elevator-budget",
                title="提交 电梯改造 Q3 预算明细给财政科",
                urgency="none",
                ai_source=TaskAISource(
                    id="ai-saga",
                    name="Saga",
                    glyph="◐",
                    color="#34C759",
                ),
                due_at="2026-05-23T18:00:00Z",
                due_display="已完成",
                status="done",
                source_meeting="电梯改造方案决策会",
                source_meeting_id="m-finished-elevator-upgrade",
            ),
            TaskItem(
                id="t-elevator-notice",
                title="发布 电梯改造 业主告知函",
                urgency="none",
                ai_source=TaskAISource(
                    id="ai-echo",
                    name="Echo",
                    glyph="◇",
                    color="#BF5AF2",
                ),
                due_at="2026-05-22T18:00:00Z",
                due_display="已完成",
                status="done",
                source_meeting="电梯改造方案决策会",
                source_meeting_id="m-finished-elevator-upgrade",
            ),
        ],
    ),
]


@router.get("/tasks/grouped", response_model=TasksGroupedResponse)
async def get_tasks_grouped(
    status: str = Query("pending", description="pending | tracking | done"),
) -> TasksGroupedResponse:
    """按来源会议分组的任务. status 切换 pending/tracking/done."""
    if status == "tracking":
        return TasksGroupedResponse(groups=_TASKS_TRACKING)
    if status == "done":
        return TasksGroupedResponse(groups=_TASKS_DONE)
    # default: pending
    return TasksGroupedResponse(groups=_TASKS_PENDING)


# ============================================================================
# §4.3 — GET /api/v2/memory/radar (M5 雷达图 hero)
# ============================================================================


class RadarAxisMetric(BaseModel):
    axis_name: str
    my_count: int
    team_diff: int
    label: str


class RadarData(BaseModel):
    total_memories: int
    total_axes_covered: int
    axes: List[str]
    my_values: List[int]
    team_values: List[int]
    axis_metrics: List[RadarAxisMetric]


@router.get("/memory/radar", response_model=RadarData)
async def get_memory_radar() -> RadarData:
    """雷达 hero 数据 — PM 2=a 6 轴写死."""
    return RadarData(
        total_memories=100,
        total_axes_covered=6,
        axes=[
            "数据洞察",
            "产品策略",
            "UX 体验",
            "法规合规",
            "财务建模",
            "客户体验",
        ],
        my_values=[32, 24, 18, 8, 12, 6],
        team_values=[28, 30, 22, 14, 16, 10],
        axis_metrics=[
            RadarAxisMetric(
                axis_name="数据洞察",
                my_count=32,
                team_diff=4,
                label="数据洞察 32",
            ),
            RadarAxisMetric(
                axis_name="财务建模",
                my_count=12,
                team_diff=4,
                label="财务建模 团队+4",
            ),
        ],
    )


# ============================================================================
# §4.4 — GET /api/v2/memory/snapshots (M5 快照 list 升级)
# ============================================================================


class SnapshotAIAvatar(BaseModel):
    glyph: str
    gradient_from: str
    gradient_to: str


class MemorySnapshot(BaseModel):
    id: str
    topic: str
    ai_avatars: List[SnapshotAIAvatar]
    types: List[str]
    count: int
    source_meeting_id: Optional[str] = None


class MemorySnapshotsResponse(BaseModel):
    items: List[MemorySnapshot]
    total_count: int


# AI 头像 速查表 (跟 SCHEMA §1 一致)
_AI_AVATAR = {
    "Mira": SnapshotAIAvatar(glyph="◎", gradient_from="#FFB340", gradient_to="#FF9F0A"),
    "Aria": SnapshotAIAvatar(glyph="⌬", gradient_from="#0A84FF", gradient_to="#5E5CE6"),
    "Stratos": SnapshotAIAvatar(glyph="◆", gradient_from="#AF52DE", gradient_to="#FF375F"),
    "Lex": SnapshotAIAvatar(glyph="§", gradient_from="#FF9F0A", gradient_to="#FFB340"),
    "Saga": SnapshotAIAvatar(glyph="◐", gradient_from="#34C759", gradient_to="#1F8A5B"),
    "Sage": SnapshotAIAvatar(glyph="✦", gradient_from="#5E5CE6", gradient_to="#AF52DE"),
    "Phoenix": SnapshotAIAvatar(glyph="▲", gradient_from="#FF3B30", gradient_to="#FF6482"),
    "Aria-7": SnapshotAIAvatar(glyph="◉", gradient_from="#30B0C7", gradient_to="#0A84FF"),
    "Hummingbird": SnapshotAIAvatar(glyph="♪", gradient_from="#FF6482", gradient_to="#FF375F"),
    "Echo": SnapshotAIAvatar(glyph="◇", gradient_from="#BF5AF2", gradient_to="#5E5CE6"),
}


def _ss(idx: int, topic: str, ai_names: List[str], types: List[str], count: int, meeting_id: Optional[str]) -> MemorySnapshot:
    """简易 snapshot 构造器."""
    return MemorySnapshot(
        id=f"snap-{idx:03d}",
        topic=topic,
        ai_avatars=[_AI_AVATAR[n] for n in ai_names if n in _AI_AVATAR],
        types=types,
        count=count,
        source_meeting_id=meeting_id,
    )


# 25 条 mock 快照, 跟现有 25 条对齐 (覆盖 福田住建局 各议题)
_SNAPSHOTS: List[MemorySnapshot] = [
    _ss(1, "数据安全合规风险评估会", ["Sage", "Lex"], ["洞察", "建议"], 2, "m-finished-data-compliance"),
    _ss(2, "电梯改造方案决策会", ["Saga", "Stratos"], ["决策"], 4, "m-finished-elevator-upgrade"),
    _ss(3, "Q3 路线图对齐", ["Stratos", "Mira"], ["决策", "风险"], 3, "m-live-q3-roadmap"),
    _ss(4, "搜索体验评审 #4", ["Sage", "Aria"], ["洞察", "建议"], 5, "m-upcoming-search-review-4"),
    _ss(5, "客户访谈 · Hummingbird 反馈", ["Hummingbird", "Sage"], ["洞察"], 2, "m-upcoming-hummingbird-feedback"),
    _ss(6, "摘要模型 A/B 复盘", ["Aria-7", "Aria"], ["突破", "洞察"], 4, "m-finished-ab-review"),
    _ss(7, "Q1 投诉趋势复盘", ["Sage", "Echo"], ["洞察"], 3, "m-finished-q1-complaint"),
    _ss(8, "物业巡检流程优化", ["Phoenix", "Stratos"], ["建议"], 2, None),
    _ss(9, "业主满意度专题会", ["Hummingbird"], ["洞察"], 1, None),
    _ss(10, "新员工合规培训 复盘", ["Lex"], ["建议"], 1, None),
    _ss(11, "Q2 KPI 中期回顾", ["Stratos", "Saga"], ["决策"], 3, None),
    _ss(12, "数据看板原型评审", ["Aria", "Sage"], ["建议"], 2, None),
    _ss(13, "节能改造 二期方案", ["Stratos", "Saga"], ["决策", "风险"], 4, None),
    _ss(14, "供应商合规 排查", ["Lex"], ["风险"], 2, None),
    _ss(15, "客户增长 半年规划", ["Hummingbird", "Aria-7"], ["决策"], 3, None),
    _ss(16, "记忆库 沉淀 规则梳理", ["Echo"], ["建议"], 1, None),
    _ss(17, "Q4 协作功能 PRD 评审", ["Stratos", "Aria", "Mira"], ["决策"], 5, None),
    _ss(18, "AI 摘要 prompt 优化", ["Sage", "Aria"], ["突破"], 2, None),
    _ss(19, "投诉响应 SLA 调整", ["Phoenix"], ["决策"], 1, None),
    _ss(20, "数据资产 命名规范", ["Sage", "Echo"], ["建议"], 2, None),
    _ss(21, "用户调研 招募 流程", ["Hummingbird"], ["建议"], 1, None),
    _ss(22, "财务对账 自动化方案", ["Saga"], ["建议"], 1, None),
    _ss(23, "新版搜索 性能基线", ["Sage", "Stratos"], ["突破"], 3, None),
    _ss(24, "合规自检 checklist", ["Lex"], ["建议"], 1, None),
    _ss(25, "Mira 早晨简报 模板 V2", ["Mira"], ["建议"], 1, None),
]


@router.get("/memory/snapshots", response_model=MemorySnapshotsResponse)
async def get_memory_snapshots(
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None, description="opaque cursor, ignored in mock"),
) -> MemorySnapshotsResponse:
    """记忆 快照 list — 25 条 mock 议题."""
    # cursor 当前 mock 忽略, 直接 按 limit 截
    items = _SNAPSHOTS[:limit]
    return MemorySnapshotsResponse(items=items, total_count=len(_SNAPSHOTS))
