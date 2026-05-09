"""
v22 — 看板 dashboard endpoints.

**单一聚合**:`GET /api/dashboard/overview` 返回所有 7 个 KPI,前端一次
拉取就能渲染整个看板.聚合而非拆分的理由:
  - 看板就是一次性渲染的页面,N 个并发请求没意义
  - 所有数据共享 workspace_id 过滤条件,SQL 层可以串起来
  - 缓存友好(可加 Cache-Control 5s)

**角色 scope**:
  - leader/admin/owner: 看 workspace 全局
  - expert: 仅 bound agent 范围(source_ref.agent_id 匹配)
  - member: 只看自己作为 assignee 的 Task

`/api/dashboard/seed-eval-data`:智慧住建场景的测试数据 seed,生成
一个月的 4 维评价数据.admin-only.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    AuthContext,
    expert_bound_agent_id,
    get_current_auth,
    is_leader_or_admin,
    require_leader_or_admin,
)
from ..db import get_session
from ..models import Agent, Task, TaskEvaluation, User, WorkspaceMembership

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ---- Pydantic shapes -------------------------------------------------------


class StatusBucket(BaseModel):
    status: str
    count: int


class SourceBucket(BaseModel):
    source_type: str
    count: int


class AssigneeWorkload(BaseModel):
    user_id: uuid.UUID
    name: str
    open_count: int      # 待处理(open + dispatched + accepted + in_progress + submitted)
    overdue_count: int   # 其中已逾期


class CompletionPoint(BaseModel):
    date: str            # 'YYYY-MM-DD'
    completed: int       # 当天 done 的数量
    created: int         # 当天创建的 Task 数(7 天创建趋势)


class FourDimEvaluation(BaseModel):
    user_id: uuid.UUID
    name: str
    completion_rate: float
    on_time_rate: float
    quality_score: float
    collaboration_score: float
    composite: float     # 0.3c + 0.3o + 0.2q + 0.2col


class DashboardOverview(BaseModel):
    # 顶部 4 KPI 卡
    total_tasks: int
    pending_review: int  # status='dispatched',待签收
    overdue_red_purple: int  # 逾期红+紫(过 due_at 且 status 不在终态)
    completion_rate_this_month: float  # 0-1

    # 中部图
    by_status: list[StatusBucket]
    by_source: list[SourceBucket]
    workload: list[AssigneeWorkload]  # top 10
    completion_30d: list[CompletionPoint]  # 末 30 天

    # 底部图
    creation_7d: list[CompletionPoint]   # 末 7 天创建趋势(只看 created 字段)
    evaluations: list[FourDimEvaluation]  # 本月 4 维评价(top 6)

    # 元信息
    period: str  # 'YYYY-MM'
    role: str    # 'leader' | 'expert' | 'member'
    scope_label: str  # '全工作空间' | '我绑定的 AI 专家' | '我的待办'


# ---- helpers ---------------------------------------------------------------


_ACTIVE_STATUSES = ("open", "dispatched", "accepted", "in_progress", "submitted")
_TERMINAL_STATUSES = ("done", "archived", "cancelled")


def _period_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _start_of_month_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


async def _scope_filter_clauses(
    session: AsyncSession, auth: AuthContext
) -> tuple[list, str, str]:
    """
    Returns (sql_filter_list, role_label, scope_label).

    sql_filter_list 是要 AND 进 Task 查询的 where 条件.
    leader/admin → 仅 workspace_id 过滤(一个条件)
    expert       → 加 (assignee=me OR source_ref.agent_id=bound)
    member       → 仅 assignee=me

    把决策集中在这一处,各 KPI 查询直接 unpack 用.
    """
    base = [Task.workspace_id == auth.workspace.id]
    if await is_leader_or_admin(session, auth):
        return (base, "leader", "全工作空间")
    bound = await expert_bound_agent_id(session, auth)
    if bound is not None:
        # expert: assignee=我 或 source_ref.agent_id=bound
        # JSONB ->> 'agent_id' 是文本提取,bound 转 str 后比.
        from sqlalchemy import text
        clause = or_(
            Task.assignee_user_id == auth.user.id,
            text("(task.source_ref ->> 'agent_id') = :bound").bindparams(
                bound=str(bound)
            ),
        )
        return (base + [clause], "expert", "我绑定的 AI 专家")
    # member / 其他
    return (base + [Task.assignee_user_id == auth.user.id], "member", "我的待办")


# ---- /api/dashboard/overview -----------------------------------------------


@router.get("/overview", response_model=DashboardOverview)
async def overview(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    scope_filters, role_label, scope_label = await _scope_filter_clauses(
        session, auth
    )
    period = _period_now()
    month_start = _start_of_month_utc()
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_ago = now - timedelta(days=7)

    # 1) 总 Task 数
    total_tasks = (
        await session.execute(
            select(func.count(Task.id)).where(*scope_filters)
        )
    ).scalar_one() or 0

    # 2) 待签收(status='dispatched')
    pending_review = (
        await session.execute(
            select(func.count(Task.id)).where(
                *scope_filters, Task.status == "dispatched"
            )
        )
    ).scalar_one() or 0

    # 3) 逾期红+紫(已过 due_at 且 status 不在终态)
    overdue_red_purple = (
        await session.execute(
            select(func.count(Task.id)).where(
                *scope_filters,
                Task.due_at.is_not(None),
                Task.due_at < now,
                Task.status.notin_(_TERMINAL_STATUSES),
            )
        )
    ).scalar_one() or 0

    # 4) 本月完成率:本月 done / 本月所有 active+done(不计 cancelled)
    month_done = (
        await session.execute(
            select(func.count(Task.id)).where(
                *scope_filters,
                Task.status == "done",
                Task.updated_at >= month_start,
            )
        )
    ).scalar_one() or 0
    month_total = (
        await session.execute(
            select(func.count(Task.id)).where(
                *scope_filters,
                Task.status.notin_(("cancelled",)),
                Task.created_at >= month_start,
            )
        )
    ).scalar_one() or 0
    completion_rate_this_month = (
        round(month_done / month_total, 4) if month_total > 0 else 0.0
    )

    # 5) 状态分布
    rows = (
        await session.execute(
            select(Task.status, func.count(Task.id))
            .where(*scope_filters)
            .group_by(Task.status)
        )
    ).all()
    by_status = [
        StatusBucket(status=r[0], count=int(r[1])) for r in rows
    ]

    # 6) 触发源分布
    rows = (
        await session.execute(
            select(Task.source_type, func.count(Task.id))
            .where(*scope_filters)
            .group_by(Task.source_type)
        )
    ).all()
    by_source = [
        SourceBucket(source_type=r[0], count=int(r[1])) for r in rows
    ]

    # 7) assignee 工作量 top 10(各状态 active count + 其中 overdue)
    overdue_case = case(
        (
            and_(
                Task.due_at.is_not(None),
                Task.due_at < now,
                Task.status.in_(_ACTIVE_STATUSES),
            ),
            1,
        ),
        else_=0,
    )
    workload_rows = (
        await session.execute(
            select(
                Task.assignee_user_id,
                func.count(Task.id).label("open_count"),
                func.sum(overdue_case).label("overdue_count"),
            )
            .where(
                *scope_filters,
                Task.assignee_user_id.is_not(None),
                Task.status.in_(_ACTIVE_STATUSES),
            )
            .group_by(Task.assignee_user_id)
            .order_by(func.count(Task.id).desc())
            .limit(10)
        )
    ).all()
    user_ids = [r[0] for r in workload_rows]
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        urows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {u[0]: u[1] for u in urows}
    workload = [
        AssigneeWorkload(
            user_id=r[0],
            name=name_by_id.get(r[0], "(未知用户)"),
            open_count=int(r[1] or 0),
            overdue_count=int(r[2] or 0),
        )
        for r in workload_rows
    ]

    # 8) 30 天完成率折线 — 每天 done count
    completed_per_day_rows = (
        await session.execute(
            select(
                func.date(Task.updated_at).label("d"),
                func.count(Task.id),
            )
            .where(
                *scope_filters,
                Task.status == "done",
                Task.updated_at >= thirty_days_ago,
            )
            .group_by("d")
            .order_by("d")
        )
    ).all()
    created_per_day_30_rows = (
        await session.execute(
            select(
                func.date(Task.created_at).label("d"),
                func.count(Task.id),
            )
            .where(*scope_filters, Task.created_at >= thirty_days_ago)
            .group_by("d")
            .order_by("d")
        )
    ).all()
    completed_map = {str(r[0]): int(r[1]) for r in completed_per_day_rows}
    created_30_map = {str(r[0]): int(r[1]) for r in created_per_day_30_rows}
    # 把 30 天每天填齐(空天为 0)便于 ε 折线连续
    completion_30d: list[CompletionPoint] = []
    for i in range(30, -1, -1):
        d = (now - timedelta(days=i)).date().isoformat()
        completion_30d.append(
            CompletionPoint(
                date=d,
                completed=completed_map.get(d, 0),
                created=created_30_map.get(d, 0),
            )
        )

    # 9) 7 天创建趋势 — 直接从 created_30_map 末 7 天截取
    creation_7d: list[CompletionPoint] = []
    for i in range(7, -1, -1):
        d = (now - timedelta(days=i)).date().isoformat()
        creation_7d.append(
            CompletionPoint(
                date=d,
                completed=completed_map.get(d, 0),
                created=created_30_map.get(d, 0),
            )
        )

    # 10) 4 维评价 top 6(本月)— 按 composite score 降序
    eval_rows = (
        await session.execute(
            select(TaskEvaluation, User)
            .join(User, User.id == TaskEvaluation.assignee_user_id)
            .where(
                TaskEvaluation.workspace_id == auth.workspace.id,
                TaskEvaluation.period == period,
            )
            .order_by(
                (
                    TaskEvaluation.completion_rate * 0.3
                    + TaskEvaluation.on_time_rate * 0.3
                    + TaskEvaluation.quality_score * 0.2
                    + TaskEvaluation.collaboration_score * 0.2
                ).desc()
            )
            .limit(6)
        )
    ).all()
    evaluations = [
        FourDimEvaluation(
            user_id=u.id,
            name=u.name,
            completion_rate=round(e.completion_rate, 4),
            on_time_rate=round(e.on_time_rate, 4),
            quality_score=round(e.quality_score, 4),
            collaboration_score=round(e.collaboration_score, 4),
            composite=round(
                e.completion_rate * 0.3
                + e.on_time_rate * 0.3
                + e.quality_score * 0.2
                + e.collaboration_score * 0.2,
                4,
            ),
        )
        for (e, u) in eval_rows
    ]

    return DashboardOverview(
        total_tasks=int(total_tasks),
        pending_review=int(pending_review),
        overdue_red_purple=int(overdue_red_purple),
        completion_rate_this_month=completion_rate_this_month,
        by_status=by_status,
        by_source=by_source,
        workload=workload,
        completion_30d=completion_30d,
        creation_7d=creation_7d,
        evaluations=evaluations,
        period=period,
        role=role_label,
        scope_label=scope_label,
    )


# ---- /api/dashboard/seed-eval-data -----------------------------------------


class SeedEvalIn(BaseModel):
    period: Optional[str] = None  # 默认本月,'YYYY-MM' 格式可指定历史月份
    overwrite: bool = False  # 已有同月数据时是否覆盖


class SeedEvalOut(BaseModel):
    period: str
    inserted: int
    updated: int


@router.post("/seed-eval-data", response_model=SeedEvalOut)
async def seed_eval_data(
    payload: SeedEvalIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v22: 智慧住建演示用 — 给 workspace 的活跃 assignees 生成一个月的
    4 维评价 seed 数据.分布按一个简化的「政务能力分布」:
      - 完成率 / 及时率:多数 0.7-0.95,长尾低分
      - 质量分:多数 0.7-0.9
      - 协作分:多数 0.6-0.85(协办能力分布更宽,因为 v22.5 才有真协办数据)

    用 deterministic seed(基于 user_id + period),让多次跑不会跳来跳去.
    """
    await require_leader_or_admin(session, auth)
    period = payload.period or _period_now()

    # 拿活跃 assignees(workspace 内有过 Task 的 user)
    rows = (
        await session.execute(
            select(Task.assignee_user_id)
            .where(
                Task.workspace_id == auth.workspace.id,
                Task.assignee_user_id.is_not(None),
            )
            .group_by(Task.assignee_user_id)
        )
    ).all()
    assignees = [r[0] for r in rows]

    # 已有同 period 的行
    existing_rows = (
        await session.execute(
            select(TaskEvaluation).where(
                TaskEvaluation.workspace_id == auth.workspace.id,
                TaskEvaluation.period == period,
            )
        )
    ).scalars().all()
    existing_by_user = {e.assignee_user_id: e for e in existing_rows}

    inserted = 0
    updated = 0

    for uid in assignees:
        rng = random.Random(f"{uid}-{period}")
        completion = round(rng.uniform(0.55, 0.97), 3)
        on_time = round(rng.uniform(0.5, 0.95), 3)
        quality = round(rng.uniform(0.6, 0.92), 3)
        collab = round(rng.uniform(0.55, 0.88), 3)
        # 一些虚构的累计指标
        total_assigned = rng.randint(8, 35)
        total_done = int(total_assigned * completion)
        total_overdue = int(total_done * (1 - on_time))

        existing = existing_by_user.get(uid)
        if existing is not None:
            if not payload.overwrite:
                continue
            existing.completion_rate = completion
            existing.on_time_rate = on_time
            existing.quality_score = quality
            existing.collaboration_score = collab
            existing.total_assigned = total_assigned
            existing.total_done = total_done
            existing.total_overdue = total_overdue
            updated += 1
        else:
            session.add(
                TaskEvaluation(
                    workspace_id=auth.workspace.id,
                    assignee_user_id=uid,
                    period=period,
                    completion_rate=completion,
                    on_time_rate=on_time,
                    quality_score=quality,
                    collaboration_score=collab,
                    total_assigned=total_assigned,
                    total_done=total_done,
                    total_overdue=total_overdue,
                )
            )
            inserted += 1

    await session.commit()
    return SeedEvalOut(period=period, inserted=inserted, updated=updated)


# ---- v23: 看板二期 — AI 专家 Kanban + 科长 Kanban -------------------------


# Kanban 默认只展示活跃任务(不含 done/archived/cancelled),保持视图聚焦
_KANBAN_ACTIVE_STATUSES = (
    "open",
    "dispatched",
    "accepted",
    "in_progress",
    "submitted",
)


class KanbanCard(BaseModel):
    task_id: uuid.UUID
    content: str
    status: str
    due_at: Optional[datetime] = None
    is_overdue: bool = False
    assignee_user_id: Optional[uuid.UUID] = None
    assignee_name: Optional[str] = None
    co_assignee_count: int = 0
    co_submitted_count: int = 0  # 协办进度 N/M 用
    source_type: str
    created_at: datetime


class KanbanColumn(BaseModel):
    # 列的标识 — 取决于 grouping 维度
    column_id: str
    column_label: str
    # 列的子标题(比如 Agent 列下显示「8 项 · 2 逾期」)
    summary: str
    cards: list[KanbanCard]


class KanbanOut(BaseModel):
    grouping: str  # 'agent' | 'user'
    columns: list[KanbanColumn]
    period_label: str  # '本月' / 显示给用户的时间范围标签
    role: str  # leader / expert / member
    scope_label: str
    include_closed: bool


def _task_to_card(
    t: Task, name_by_id: dict[uuid.UUID, str], now: datetime
) -> KanbanCard:
    overdue = bool(
        t.due_at
        and t.due_at < now
        and t.status not in ("done", "archived", "cancelled")
    )
    co_count = len(t.co_assignees) if t.co_assignees else 0
    return KanbanCard(
        task_id=t.id,
        content=t.content,
        status=t.status,
        due_at=t.due_at,
        is_overdue=overdue,
        assignee_user_id=t.assignee_user_id,
        assignee_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
        co_assignee_count=co_count,
        co_submitted_count=0,  # 后面 batch fill
        source_type=t.source_type,
        created_at=t.created_at,
    )


async def _fetch_kanban_tasks(
    session: AsyncSession, auth: AuthContext, include_closed: bool
) -> tuple[list[Task], dict[uuid.UUID, str], str, str]:
    """统一的 Kanban 数据拉取 — 跟 /overview 共享 scope 过滤."""
    scope_filters, role_label, scope_label = await _scope_filter_clauses(
        session, auth
    )
    q = select(Task).where(*scope_filters)
    if not include_closed:
        q = q.where(Task.status.in_(_KANBAN_ACTIVE_STATUSES))
    q = q.order_by(Task.due_at.asc().nullslast(), Task.created_at.desc())
    tasks = (await session.execute(q)).scalars().all()

    # 批量取 user name
    user_ids = {t.assignee_user_id for t in tasks if t.assignee_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        rows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {r[0]: r[1] for r in rows}
    return tasks, name_by_id, role_label, scope_label


def _agent_id_for_task(
    t: Task, agent_by_user: dict[uuid.UUID, uuid.UUID]
) -> Optional[uuid.UUID]:
    """
    推断 Task 应当归到哪个 Agent 列:
      1. assignee 有 bound_agent → 用 bound
      2. source_ref.agent_id → 用 source_ref
      3. 否则 → None(归入「未分配」列)
    """
    if t.assignee_user_id and t.assignee_user_id in agent_by_user:
        return agent_by_user[t.assignee_user_id]
    if isinstance(t.source_ref, dict):
        aid = t.source_ref.get("agent_id")
        if isinstance(aid, str):
            try:
                return uuid.UUID(aid)
            except ValueError:
                return None
    return None


@router.get("/kanban-by-agent", response_model=KanbanOut)
async def kanban_by_agent(
    include_closed: bool = Query(False),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    AI 专家视角 Kanban — 每个 Agent 一列,水平滚动.

    Task → 列归属判断:assignee 的 bound_agent_id 优先,然后 source_ref.agent_id,
    都没有的归入「未分配」列(只在该列非空时显示).
    """
    tasks, name_by_id, role_label, scope_label = await _fetch_kanban_tasks(
        session, auth, include_closed
    )
    now = datetime.now(timezone.utc)

    # 取 workspace 所有 Agent + bound_agent_id 映射
    agents = (
        await session.execute(
            select(Agent).where(Agent.workspace_id == auth.workspace.id).order_by(
                Agent.name
            )
        )
    ).scalars().all()
    bound_rows = (
        await session.execute(
            select(
                WorkspaceMembership.user_id, WorkspaceMembership.bound_agent_id
            ).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.bound_agent_id.is_not(None),
            )
        )
    ).all()
    agent_by_user = {r[0]: r[1] for r in bound_rows}

    # 列容器
    cols_by_agent: dict[uuid.UUID, list[KanbanCard]] = {a.id: [] for a in agents}
    unassigned: list[KanbanCard] = []

    for t in tasks:
        card = _task_to_card(t, name_by_id, now)
        agent_id = _agent_id_for_task(t, agent_by_user)
        if agent_id is not None and agent_id in cols_by_agent:
            cols_by_agent[agent_id].append(card)
        else:
            unassigned.append(card)

    # 装配输出 — 始终展示所有 Agent 列(空列也展示,UI 显示「暂无任务」),让 16 AI 一目了然
    columns: list[KanbanColumn] = []
    for a in agents:
        cards = cols_by_agent.get(a.id, [])
        overdue_n = sum(1 for c in cards if c.is_overdue)
        columns.append(
            KanbanColumn(
                column_id=str(a.id),
                column_label=a.name,
                summary=f"{len(cards)} 项 · {overdue_n} 逾期" if cards else "暂无任务",
                cards=cards,
            )
        )
    if unassigned:
        overdue_n = sum(1 for c in unassigned if c.is_overdue)
        columns.append(
            KanbanColumn(
                column_id="__unassigned__",
                column_label="未分配 Agent",
                summary=f"{len(unassigned)} 项 · {overdue_n} 逾期",
                cards=unassigned,
            )
        )

    return KanbanOut(
        grouping="agent",
        columns=columns,
        period_label="活跃任务" if not include_closed else "全部任务",
        role=role_label,
        scope_label=scope_label,
        include_closed=include_closed,
    )


@router.get("/kanban-by-user", response_model=KanbanOut)
async def kanban_by_user(
    include_closed: bool = Query(False),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    科长视角 Kanban — 按 assignee 分列,看「我手下谁忙谁闲」.
    """
    tasks, name_by_id, role_label, scope_label = await _fetch_kanban_tasks(
        session, auth, include_closed
    )
    now = datetime.now(timezone.utc)

    # 按 assignee 分桶;无 assignee 的归「未指派」列
    cols_by_user: dict[uuid.UUID, list[KanbanCard]] = {}
    unassigned: list[KanbanCard] = []
    for t in tasks:
        card = _task_to_card(t, name_by_id, now)
        if t.assignee_user_id:
            cols_by_user.setdefault(t.assignee_user_id, []).append(card)
        else:
            unassigned.append(card)

    # 排序:按工作量(任务多的排前)
    sorted_users = sorted(
        cols_by_user.items(), key=lambda kv: len(kv[1]), reverse=True
    )

    columns: list[KanbanColumn] = []
    for uid, cards in sorted_users:
        overdue_n = sum(1 for c in cards if c.is_overdue)
        columns.append(
            KanbanColumn(
                column_id=str(uid),
                column_label=name_by_id.get(uid, "(未知用户)"),
                summary=f"{len(cards)} 项 · {overdue_n} 逾期",
                cards=cards,
            )
        )
    if unassigned:
        overdue_n = sum(1 for c in unassigned if c.is_overdue)
        columns.append(
            KanbanColumn(
                column_id="__unassigned__",
                column_label="未指派",
                summary=f"{len(unassigned)} 项 · {overdue_n} 逾期",
                cards=unassigned,
            )
        )

    return KanbanOut(
        grouping="user",
        columns=columns,
        period_label="活跃任务" if not include_closed else "全部任务",
        role=role_label,
        scope_label=scope_label,
        include_closed=include_closed,
    )
