"""
v1.4.0 · Saga O (Phase 1 · W3) + Saga T1/T2/T3 (Phase 2 · W1/W2/W3) · Mobile App v2 — Tasks + Memory.

契约: docs/SCHEMA-mobile-v2.md §4 (tasks + memory 全部 4 个 endpoint).

Phase 1 (Saga O · 全部 mock): priority-banner / tasks/grouped / memory/radar /
                              memory/snapshots.
Phase 2 真接 DB:
  Saga T1 · priority-banner — ABAC + workspace filter.
  Saga T2 · tasks/grouped — ABAC + GROUP BY source_meeting.
  Saga T3 · memory/snapshots — ABAC + JOIN AIInsight + Agent + Meeting.
  Saga T5 (后续) · memory/radar.

约定:
  - 与 老 /api/m/tasks + /api/m/memory 隔离, 走 /api/v2/tasks/* + /api/v2/memory/*
  - 与 §2 meetings / §3 today 共用 mock 数据风格 (福田住建局)
  - 真接 endpoint 走 get_current_auth + workspace.id filter (Saga T1 起强制)
  - mock endpoint Phase 1 anon 暂留
  - 字段命名 snake_case · 时间 ISO 8601 UTC · enum 跟 schema 严格一致

仿真场景: 福田住建局 demo workspace
AI 10 个 (v1.4.0 Saga Q · Phase 1 P0, 严格按设计稿 mobile-shared.jsx:24-34):
  Mira ◎ / Aria ⌬ / Stratos ◆ / Sage ✦ / Lex § / Scout ◈ /
  Falao ⚖ / Shu ∑ / Zhaojie ♥ / Tally ¥
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent_glyphs import agent_to_ai_badge, agent_to_ai_source, normalize_insight_type
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import Agent, AIInsight, Meeting, Task
from ..task_urgency import derive_urgency, due_display
from ..v2_helpers import group_insights_by_topic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2", tags=["mobile-v2-tasks-memory"])


# ============================================================================
# Saga T1 · Task urgency derive (Planning §3.1, SCHEMA §0 urgency enum).
# ============================================================================
#
# Task.urgency 不持久化, 后端 derive from Task.due_at vs now.
#   urgent — due_at - now <= 0 or 落在 今天 (T1 中, banner 端 任何 今天 到期 算紧急)
#   today  — (T2 sub-saga 起 拆开 用)
#   week   — due_at 落在 7 天内
#   none   — 其他 (没 due_at 或 > 7 天)
#
# T1 priority-banner 只用 urgent 一个判定 (今天到期且未办结). T2 真接
# /tasks/grouped + /today/pending-tasks 时再加 today/week/none 三个 case.


# ============================================================================
# §4.1 — GET /api/v2/tasks/priority-banner (M4 Mira 优先级 banner)
# ============================================================================


class PriorityBannerResponse(BaseModel):
    urgent_task_count: int
    summary_text: str
    ai_suggestion_count: int
    ai_suggestion_text: str


@router.get("/tasks/priority-banner", response_model=PriorityBannerResponse)
async def get_tasks_priority_banner(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> PriorityBannerResponse:
    """Mira 优先级 banner — 今日必做 + AI 建议 计数.

    v1.4.0 Saga T1 (Phase 2 W1): mock → 真接 (ABAC + workspace filter).

    数据源:
      urgent_task_count   — Task WHERE workspace_id + assignee = caller +
                            due_at <= 今天 23:59 + status active (含已 overdue)
      summary_text        — "{count} 项今日必做 · 优先拍板「{top.title}」"
                            top = ORDER BY due_at ASC LIMIT 1 (最紧急的 1 个)
      ai_suggestion_count — Task WHERE workspace_id + assignee = caller +
                            source_type='meeting' (会议产生的待办 = AI 建议任务)
      ai_suggestion_text  — "AI 找到 {count} 项任务可触发"

    边界:
      - empty workspace / 没紧急任务 → 降级 文案 "今天没有紧急任务,继续保持"
      - source_type='meeting' 0 个 → ai_suggestion_text "AI 暂未找到可触发任务"
    """
    ws_id = auth.workspace.id
    user_id = auth.user.id

    now = datetime.now(timezone.utc)
    today_end = datetime.combine(now.date(), time.max, tzinfo=timezone.utc)

    # 1) urgent_task_count — 今日到期 + 未办结
    active_statuses = ("open", "dispatched", "accepted", "in_progress", "submitted")
    urgent_count = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == user_id,
                Task.due_at.is_not(None),
                Task.due_at <= today_end,
                Task.status.in_(active_statuses),
            )
        )
    ).scalar_one() or 0
    urgent_count = int(urgent_count)

    # 2) summary_text — 拿最紧急的 1 个 title
    summary_text: str
    if urgent_count == 0:
        summary_text = "今天没有紧急任务,继续保持"
    else:
        top_task = (
            await session.execute(
                select(Task)
                .where(
                    Task.workspace_id == ws_id,
                    Task.assignee_user_id == user_id,
                    Task.due_at.is_not(None),
                    Task.due_at <= today_end,
                    Task.status.in_(active_statuses),
                )
                .order_by(Task.due_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

        title_hint = ""
        if top_task is not None:
            # title 优先, fallback content 前 40 字 (跟 Meeting/ActionItem 一致)
            title_hint = (top_task.title or top_task.content or "")[:40].strip()
        if title_hint:
            summary_text = f"{urgent_count} 项今日必做 · 优先拍板「{title_hint}」"
        else:
            summary_text = f"{urgent_count} 项今日必做"

    # 3) ai_suggestion_count — 来自会议的 task (会议 action_extractor 产出)
    # 用 Task.source_type='meeting' 一处过滤 (Task 模型注释 §716: meeting 类型
    # source_ref 含 {meeting_id, action_item_id})
    ai_suggestion_count = (
        await session.execute(
            select(func.count(Task.id)).where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == user_id,
                Task.source_type == "meeting",
                Task.status.in_(active_statuses),
            )
        )
    ).scalar_one() or 0
    ai_suggestion_count = int(ai_suggestion_count)

    if ai_suggestion_count == 0:
        ai_suggestion_text = "AI 暂未找到可触发任务"
    else:
        ai_suggestion_text = f"AI 找到 {ai_suggestion_count} 项任务可触发"

    return PriorityBannerResponse(
        urgent_task_count=urgent_count,
        summary_text=summary_text,
        ai_suggestion_count=ai_suggestion_count,
        ai_suggestion_text=ai_suggestion_text,
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


# SCHEMA §4.2 enum status → DB task status 反查.
# SCHEMA: pending | tracking | done
# DB    : open / dispatched / accepted / in_progress / submitted / done / archived / cancelled
#
# 映射 (Planning §3.1 决定):
#   pending  → open / dispatched / accepted  (派 但 还没 启动)
#   tracking → in_progress / submitted        (启动 中 + 提交 待 审)
#   done     → done / archived                (办结 + 归档)
#   (cancelled / blocked 不出现在 SCHEMA, 一并 排除)

_SCHEMA_TO_DB_TASK_STATUS: dict[str, tuple[str, ...]] = {
    "pending": ("open", "dispatched", "accepted"),
    "tracking": ("in_progress", "submitted"),
    "done": ("done", "archived"),
}


# v1.4.0 Saga T2 · "未归类" / orphan 组的 sentinel — 没 source_meeting 的 task 归这.
_ORPHAN_GROUP_ID = "orphan"
_ORPHAN_GROUP_TITLE = "独立任务"


@router.get("/tasks/grouped", response_model=TasksGroupedResponse)
async def get_tasks_grouped(
    status: str = Query("pending", description="pending | tracking | done"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> TasksGroupedResponse:
    """按来源会议分组的任务. SCHEMA §4.2.

    v1.4.0 Saga T2 (Phase 2 W2): mock → 真接 (ABAC + workspace + assignee filter).

    数据源:
      Task WHERE workspace_id + assignee_user_id = caller + status IN DB-状态映射
      (按 SCHEMA enum 反查 DB 真实 status 集)
      Python 端 GROUP BY source_ref->>'meeting_id' (或 'orphan' 兜底)
      Meeting / Agent 各 一次 IN query 批拉, 避免 N+1

    映射:
      - status 严格 SCHEMA enum
      - urgency / due_display 走 task_urgency helper
      - ai_source 走 agent_to_ai_source (Task.assignee_agent_id)
      - source_meeting_id NULL 的 → 归 "orphan" 组 (meeting_id="orphan", meeting_title="独立任务")
      - done 状态 task 的 due_display: 若 due_at 已过 → "已完成" (不显示 overdue, status=done 是 ground truth)

    边界:
      - empty workspace → groups=[]
      - 未知 status enum → 兜底 groups=[]
    """
    ws_id = auth.workspace.id
    user_id = auth.user.id

    db_statuses = _SCHEMA_TO_DB_TASK_STATUS.get(status)
    if db_statuses is None:
        return TasksGroupedResponse(groups=[])

    # 1) 拉 caller 的 task — 按 SCHEMA enum 反查 DB status
    tasks = (
        await session.execute(
            select(Task)
            .where(
                Task.workspace_id == ws_id,
                Task.assignee_user_id == user_id,
                Task.status.in_(db_statuses),
            )
            .order_by(Task.due_at.asc().nulls_last(), Task.created_at.desc())
        )
    ).scalars().all()

    if not tasks:
        return TasksGroupedResponse(groups=[])

    # 2) 批量 加载 agents (ai_source) + meetings (source_meeting_id)
    agent_ids = {t.assignee_agent_id for t in tasks if t.assignee_agent_id}
    agents_by_id: dict = {}
    if agent_ids:
        agent_rows = (
            await session.execute(
                select(Agent).where(Agent.id.in_(agent_ids))
            )
        ).scalars().all()
        agents_by_id = {a.id: a for a in agent_rows}

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

    # 3) Group by source_meeting_id — Python 端聚合 (SQL GROUP BY 受 source_ref JSON 限)
    now = datetime.now(timezone.utc)
    groups_dict: dict[str, dict] = {}  # meeting_id -> {meeting_title, tasks: []}

    for t in tasks:
        # source_meeting derive
        source_meeting_id = ""
        source_meeting_title = ""
        if t.source_type == "meeting" and isinstance(t.source_ref, dict):
            mid = t.source_ref.get("meeting_id")
            if mid:
                source_meeting_id = str(mid)
                m = meetings_by_id.get(str(mid))
                if m:
                    source_meeting_title = m.title or "未命名会议"
                else:
                    # source_meeting 引用 不存在 (Meeting 被删) — 退到 显示 ID 片段
                    source_meeting_title = "已删除会议"

        # group key — 没 source_meeting 归 orphan
        if not source_meeting_id:
            group_key = _ORPHAN_GROUP_ID
            group_title = _ORPHAN_GROUP_TITLE
        else:
            group_key = source_meeting_id
            group_title = source_meeting_title

        if group_key not in groups_dict:
            groups_dict[group_key] = {
                "meeting_id": group_key,
                "meeting_title": group_title,
                "tasks": [],
            }

        # ai_source
        agent = agents_by_id.get(t.assignee_agent_id) if t.assignee_agent_id else None
        ai_source_dict = agent_to_ai_source(agent)

        # due_display — done 状态 强制 "已完成"
        if status == "done":
            display = "已完成"
        else:
            display = due_display(t.due_at, now)

        # title — Task.title 优先, fallback content 前 200 字
        title = (t.title or t.content or "")[:200].strip()

        task_item = TaskItem(
            id=str(t.id),
            title=title,
            urgency=derive_urgency(t.due_at, now),
            ai_source=TaskAISource(
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
            due_display=display,
            status=status,  # SCHEMA enum, 跟 caller param 一致
            source_meeting=source_meeting_title or None,
            source_meeting_id=source_meeting_id or None,
        )
        groups_dict[group_key]["tasks"].append(task_item)

    # 4) Convert to TaskGroup list — orphan 永远 排 最后
    groups: List[TaskGroup] = []
    for key, g in groups_dict.items():
        if key == _ORPHAN_GROUP_ID:
            continue
        groups.append(
            TaskGroup(
                meeting_id=g["meeting_id"],
                meeting_title=g["meeting_title"],
                tasks=g["tasks"],
            )
        )
    if _ORPHAN_GROUP_ID in groups_dict:
        g = groups_dict[_ORPHAN_GROUP_ID]
        groups.append(
            TaskGroup(
                meeting_id=g["meeting_id"],
                meeting_title=g["meeting_title"],
                tasks=g["tasks"],
            )
        )

    return TasksGroupedResponse(groups=groups)


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


# T3: insight broad pool 状态 — accepted (已确认入库) + pending (NULL human_decision).
# 排除 rejected (用户 已 显式拒); accepted + pending 都算 "快照" 范畴.
_SNAPSHOT_INSIGHT_DECISIONS: tuple[str, ...] = ("accepted",)  # NULL 单独 处理


@router.get("/memory/snapshots", response_model=MemorySnapshotsResponse)
async def get_memory_snapshots(
    limit: int = Query(25, ge=1, le=100),
    cursor: Optional[str] = Query(None, description="opaque cursor, 当前未实现"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> MemorySnapshotsResponse:
    """记忆 快照 list — 按 议题 (meeting) 分组的 AIInsight.

    v1.4.0 Saga T3 (Phase 2 W3): mock → 真接 (ABAC + workspace filter).

    数据源:
      AIInsight WHERE workspace_id + human_decision IN (NULL, 'accepted')
                ORDER BY created_at DESC (broad 集合)
      Python 端 group by meeting_id (走 v2_helpers.group_insights_by_topic)
      Meeting / Agent 各 一次 IN query 批拉, 避免 N+1.

    映射 (SCHEMA §4.4):
      id                = "snap-<meeting_id>"  (group 稳定 id; 没 meeting → "snap-orphan-<first_insight_id>")
      topic             = Meeting.title  (orphan group: "未关联议题")
      ai_avatars        = 去重 Agent → agent_to_ai_badge 取 {glyph,gradient_from,gradient_to}
      types             = 去重 normalize_insight_type · 最多 3 个 (设计稿一致)
      count             = group 内 AIInsight 数
      source_meeting_id = meeting_id (orphan → None)

    排序: group 内 max(created_at) desc (最新议题 排前).

    边界:
      - empty workspace / 无 insight → items=[], total_count=0
      - meeting_id IS NULL → 归 "orphan" group, source_meeting_id=None
    """
    ws_id = auth.workspace.id

    # 1) 拉 broad 集合 — accepted + pending (NULL human_decision), 排除 rejected
    insights = (
        await session.execute(
            select(AIInsight)
            .where(
                AIInsight.workspace_id == ws_id,
                # accepted 或 NULL — 显式排除 rejected
                (AIInsight.human_decision.is_(None))
                | (AIInsight.human_decision == "accepted"),
            )
            .order_by(desc(AIInsight.created_at))
        )
    ).scalars().all()

    if not insights:
        return MemorySnapshotsResponse(items=[], total_count=0)

    # 2) Python 端 group by meeting_id (helper)
    grouped = group_insights_by_topic(insights)

    # 3) 批量 加载 meetings (topic) + agents (avatars). dedupe ids 一次性 IN query.
    meeting_ids = {ins.meeting_id for ins in insights if ins.meeting_id}
    agent_ids = {ins.agent_id for ins in insights if ins.agent_id}

    meetings_by_id: dict = {}
    if meeting_ids:
        m_rows = (
            await session.execute(
                select(Meeting).where(Meeting.id.in_(meeting_ids))
            )
        ).scalars().all()
        meetings_by_id = {str(m.id): m for m in m_rows}

    agents_by_id: dict = {}
    if agent_ids:
        a_rows = (
            await session.execute(
                select(Agent).where(Agent.id.in_(agent_ids))
            )
        ).scalars().all()
        agents_by_id = {a.id: a for a in a_rows}

    # 4) Build group 列表 + 按 max(created_at) desc 排序
    group_items: List[tuple[datetime, MemorySnapshot]] = []
    for group_key, group_insights in grouped.items():
        # max created_at — 给排序用
        max_created = max(ins.created_at for ins in group_insights)

        # topic 文本: meeting.title 或 "未关联议题" (orphan)
        if group_key == "orphan":
            topic = "未关联议题"
            source_meeting_id: Optional[str] = None
            snap_id = f"snap-orphan-{group_insights[0].id}"
        else:
            m = meetings_by_id.get(group_key)
            topic = (m.title if m else "已删除会议") or "未命名会议"
            source_meeting_id = group_key
            snap_id = f"snap-{group_key}"

        # ai_avatars: group 内 unique Agent → agent_to_ai_badge → 取 3 字段
        seen_agent_ids: set = set()
        avatars: List[SnapshotAIAvatar] = []
        for ins in group_insights:
            if ins.agent_id and ins.agent_id not in seen_agent_ids:
                seen_agent_ids.add(ins.agent_id)
                agent = agents_by_id.get(ins.agent_id)
                badge = agent_to_ai_badge(agent)
                avatars.append(
                    SnapshotAIAvatar(
                        glyph=badge["glyph"],
                        gradient_from=badge["gradient_from"],
                        gradient_to=badge["gradient_to"],
                    )
                )

        # types: group 内 unique normalize_insight_type · 最多 3 个
        seen_types: set = set()
        types: List[str] = []
        for ins in group_insights:
            t = normalize_insight_type(ins.type)
            if t not in seen_types:
                seen_types.add(t)
                types.append(t)
                if len(types) >= 3:
                    break

        snap = MemorySnapshot(
            id=snap_id,
            topic=topic,
            ai_avatars=avatars,
            types=types,
            count=len(group_insights),
            source_meeting_id=source_meeting_id,
        )
        group_items.append((max_created, snap))

    # 5) 按 max(created_at) desc 排序, 截 limit
    group_items.sort(key=lambda x: x[0], reverse=True)
    items = [snap for _, snap in group_items[:limit]]
    total_count = len(group_items)

    return MemorySnapshotsResponse(items=items, total_count=total_count)
