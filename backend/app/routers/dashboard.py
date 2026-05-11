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
from typing import Any, Optional

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
from ..alert_monitor import force_check_now
from ..audit import audit_log
from ..db import get_session
from ..llm_quota import check_quota_or_raise
from ..models import (
    Agent,
    KnowledgeBase,
    Task,
    TaskEvaluation,
    User,
    Workspace,
    WorkspaceMembership,
)

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


# ---- v24.1 · 智慧住建 16 AI 专家 seed --------------------------------------
#
# 智慧住建文档 §1 项目概述 + §2.2 业务 AI 专家画像(16 节点):
# 15 个业务 AI(对应福田区住建局各科室/单位)+ 1 个全局「住建智脑」.
#
# 每个 AI 配:
#   - Agent 行(name + persona + 默认 keywords + 颜色)
#   - 1 个 KnowledgeBase(空,客户后续填)
#   - Agent.knowledge_base_ids 自动绑定该 KB
#
# 幂等:Agent.name 已存在时 skip(不会重复创建).
# 同时设置 workspace.preset='smart_construction'(若尚未设置).

# (序号, 名称, 科室/单位, 角色定位, 默认 keywords)
_SMART_CONSTRUCTION_AGENTS: list[tuple[str, str, str, str, list[str]]] = [
    (
        "AI-01", "综合事务AI专家", "机关党委(办公室)",
        "全局统筹与督办 — 文电会务、绩效考核、督查督办、人事管理",
        ["综合事务", "文电", "会务", "绩效考核", "督查督办", "人事", "公文", "通知"],
    ),
    (
        "AI-02", "法制政务AI专家", "法制与政务服务科",
        "法制审查与政务 — 规范性文件审查、合同备案、审批标准化",
        ["法制", "政务", "合同", "备案", "审批", "规范性文件", "法律审查"],
    ),
    (
        "AI-03", "房地产与租赁AI专家", "房地产与租赁管理科",
        "房产与租赁监管 — 商品房预售监管、市场检查、租赁监管",
        ["房地产", "租赁", "商品房", "预售", "市场检查", "中介", "租房"],
    ),
    (
        "AI-04", "公共住房建设AI专家", "公共住房建设管理科",
        "住房筹集与建设 — 筹集政策、项目全流程管理、棚户区改造",
        ["公共住房", "筹集", "棚户区改造", "棚改", "项目管理"],
    ),
    (
        "AI-05", "住房保障AI专家", "住房改革与保障科",
        "住房保障与房改 — 公租房租售管理、补贴发放、房改补贴审核",
        ["住房保障", "公租房", "保障房", "补贴", "房改"],
    ),
    (
        "AI-06", "建筑业管理AI专家", "建筑业管理科",
        "建筑行业与市场 — 质量安全监管、招投标监督、施工许可",
        ["建筑业", "质量安全", "招标", "投标", "招投标", "施工许可"],
    ),
    (
        "AI-07", "房屋安全AI专家", "房屋安全管理与整治科",
        "房屋安全与整治 — 结构鉴定监管、老旧小区整治、安全库",
        ["房屋安全", "鉴定", "老旧小区", "整治", "结构安全"],
    ),
    (
        "AI-08", "物业监管AI专家", "物业监管科",
        "物业与维修资金 — 物业行业指导、维修资金审批、小散工程",
        ["物业", "维修资金", "小散工程", "业委会", "物业管理"],
    ),
    (
        "AI-09", "建设科技与燃气AI专家", "建设科技与燃气科",
        "建筑节能与燃气 — 绿色建筑监管、BIM 推广、海绵城市、燃气",
        ["建设科技", "BIM", "绿色建筑", "海绵城市", "燃气", "节能"],
    ),
    (
        "AI-10", "消防人防AI专家", "消防人防管理科",
        "消防审验与人防 — 消防设计审核、竣工验收、人防报建",
        ["消防", "人防", "消防审核", "竣工验收", "人防报建"],
    ),
    (
        "AI-11", "城市更新规划AI专家", "城市更新规划科",
        "城市更新规划 — 更新目标研究、片区统筹、城中村改造",
        ["城市更新", "更新规划", "城中村", "片区", "改造"],
    ),
    (
        "AI-12", "土地整备AI专家", "土地整备科",
        "土地整备与征收 — 征收审查、资金管理、储备地管理",
        ["土地整备", "征收", "储备地", "土地"],
    ),
    (
        "AI-13", "城市更新项目AI专家", "城市更新项目管理科",
        "城市更新实施 — 实施主体审查、搬迁补偿、违建核实",
        ["城市更新项目", "实施主体", "搬迁补偿", "违建"],
    ),
    (
        "AI-14", "建设工程质量安全AI专家", "区建设工程质量安全中心",
        "质量安全监督 — 工程质量安全监督、拆除安全、造价监管",
        ["工程质量", "工程安全", "拆除", "造价", "质量监督"],
    ),
    (
        "AI-15", "住房建设与土地整备AI专家", "区住房建设和土地整备事务中心",
        "保障性住房事务 — 保障房建设管理、申请审核、房源分配",
        ["保障性住房", "保障房建设", "申请审核", "房源分配"],
    ),
    (
        "AI-16", "住建智脑(全局AI专家)", "—",
        "全局决策与派发 — 全局一屏统揽、跨 AI 查询、政策分析、派发",
        ["住建智脑", "全局", "统揽", "跨 AI 查询", "政策分析"],
    ),
]

# 16 个区分度高的 Tailwind 暗色友好色卡(Kanban / 头像条用)
_AGENT_COLORS = [
    "sky", "emerald", "violet", "rose", "amber", "cyan",
    "lime", "fuchsia", "blue", "green", "orange", "red",
    "teal", "indigo", "pink", "yellow",
]


class SeedSCAgentsOut(BaseModel):
    agents_created: int
    agents_skipped: int  # 已存在(name 重复)→ 跳过
    kbs_created: int
    kbs_skipped: int
    preset_set: bool  # 这次是否把 workspace.preset 改成了 smart_construction


@router.post(
    "/seed-smart-construction-agents", response_model=SeedSCAgentsOut
)
async def seed_smart_construction_agents(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 — 智慧住建 16 AI 专家(15 业务 + 1 住建智脑)+ 1:1 知识库 seed.

    幂等:Agent.name 已存在 skip;KB.name 已存在 skip.重跑只补缺.
    同时把 workspace.preset 设成 'smart_construction'(若尚未设置).
    leader / admin only.

    客户登录第一次看到 16 个 AI 专家 + 16 个空 KB,可立即开始上传文档.
    """
    await require_leader_or_admin(session, auth)

    # 1) 现有 Agent / KB 名字索引(幂等检查)
    existing_agents = (
        await session.execute(
            select(Agent.name).where(Agent.workspace_id == auth.workspace.id)
        )
    ).all()
    existing_agent_names = {r[0] for r in existing_agents}

    existing_kbs = (
        await session.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.workspace_id == auth.workspace.id
            )
        )
    ).scalars().all()
    existing_kb_by_name: dict[str, KnowledgeBase] = {kb.name: kb for kb in existing_kbs}

    agents_created = 0
    agents_skipped = 0
    kbs_created = 0
    kbs_skipped = 0

    for i, (code, name, dept, scope_desc, keywords) in enumerate(
        _SMART_CONSTRUCTION_AGENTS
    ):
        # KB 先建/找(Agent 要绑定它的 id)
        kb_name = f"KB · {name}"
        kb = existing_kb_by_name.get(kb_name)
        if kb is None:
            kb = KnowledgeBase(
                workspace_id=auth.workspace.id,
                name=kb_name,
                description=f"{name} 的独立知识库({dept}).文档解析后自动切块嵌入,RAG 召回.",
            )
            session.add(kb)
            await session.flush()
            existing_kb_by_name[kb_name] = kb
            kbs_created += 1
        else:
            kbs_skipped += 1

        # Agent
        if name in existing_agent_names:
            agents_skipped += 1
            continue

        color = _AGENT_COLORS[i % len(_AGENT_COLORS)]
        # persona = 文档里的「角色定位 — 核心能力边界」拼成一段
        persona = (
            f"你是「{name}」.{scope_desc}."
            f"\n所属:{dept}."
            f"\n请基于本知识库内容回答用户的问题,不确定时请明确说明."
            f"\n回答需精确,引用必标明出处."
        )
        agent = Agent(
            workspace_id=auth.workspace.id,
            name=name,
            domain=dept[:64] if dept and dept != "—" else None,
            persona=persona,
            tone="专业、严谨、简洁",
            boundary=f"业务范围:{scope_desc}",
            keywords=keywords,
            color=color,
            knowledge_base_ids=[kb.id],
            role="expert",
        )
        session.add(agent)
        agents_created += 1

    # 2) workspace.preset
    ws = (
        await session.execute(
            select(Workspace).where(Workspace.id == auth.workspace.id)
        )
    ).scalar_one()
    preset_set = False
    current_preset = ws.preset or {}
    if not isinstance(current_preset, dict):
        current_preset = {}
    if current_preset.get("kind") != "smart_construction":
        current_preset["kind"] = "smart_construction"
        current_preset["seeded_at"] = datetime.now(timezone.utc).isoformat()
        ws.preset = current_preset
        preset_set = True

    await audit_log(
        session, auth, "workspace.seed_smart_construction",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={
            "agents_created": agents_created,
            "agents_skipped": agents_skipped,
            "kbs_created": kbs_created,
            "kbs_skipped": kbs_skipped,
            "preset_set": preset_set,
        },
        autocommit=False,
    )
    await session.commit()
    return SeedSCAgentsOut(
        agents_created=agents_created,
        agents_skipped=agents_skipped,
        kbs_created=kbs_created,
        kbs_skipped=kbs_skipped,
        preset_set=preset_set,
    )


# ---- v24.2 #4 · AI 数据分析趋势预警 ----------------------------------------


class TrendStat(BaseModel):
    label: str
    unit: str
    series: list[dict]  # [{name: 'YYYY-MM-DD', value: number}]
    mean: float
    std: float
    current: float
    z_score: float
    slope_per_day: float
    forecast_7d: float
    anomaly: bool
    trend_label: str  # 上升 / 下降 / 平稳 / 样本不足


class TrendsOut(BaseModel):
    days: int
    metrics: dict[str, TrendStat]


@router.get("/trends", response_model=TrendsOut)
async def trends(
    days: int = Query(30, ge=7, le=90),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.2 #4: 3 个内置指标的趋势 + 异常检测(智慧住建文档 §3.3 数据分析).

    指标:
      task_creation_daily   每日新建数
      task_completion_daily 每日完成数
      task_overdue_rate     每日逾期率

    每个指标返回:series(N+1 个点) + mean/std/current/z_score/slope/
    forecast_7d/anomaly/trend_label.前端 sparkline + 大字 + 异常红框.

    Leader/admin only.
    """
    from ..trend_analysis import compute_trends
    await require_leader_or_admin(session, auth)
    result = await compute_trends(session, auth.workspace.id, days)
    return TrendsOut(
        days=result["days"],
        metrics={k: TrendStat(**v) for k, v in result["metrics"].items()},
    )


# ---- v24.2 #2 · 自然语言图表生成 -------------------------------------------


class ChartQAIn(BaseModel):
    question: str


class ChartDataPoint(BaseModel):
    name: str
    value: float


class ChartQAOut(BaseModel):
    template: str
    title: str
    chart_type: str  # 'pie' | 'bar' | 'line'
    data: list[ChartDataPoint]
    params: dict
    rationale: Optional[str] = None
    fallback_used: bool = False


@router.post("/chart-qa", response_model=ChartQAOut)
async def chart_qa(
    payload: ChartQAIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.2 #2: 自然语言问数 → 图表(智慧住建文档 §3.3 图表生成).

    LLM 选 7 个预设模板之一(防 SQL 注入 + 演示稳定),返回 chart_type +
    数据点 + 标题.前端用 recharts 渲染.

    Leader/admin only — 看 workspace 全局数据.
    """
    from ..chart_qa import answer_chart_question
    await require_leader_or_admin(session, auth)
    q = (payload.question or "").strip()
    if len(q) > 500:
        raise HTTPException(400, "question too long (max 500 chars)")
    # v24.4 #1: LLM 配额
    await check_quota_or_raise(auth.user.id, auth.workspace.id)
    result = await answer_chart_question(session, auth.workspace.id, q)
    await audit_log(
        session, auth, "dashboard.chart_qa",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={
            "question": q[:200],
            "template": result["template"],
            "fallback": result.get("fallback_used"),
        },
        autocommit=False,
    )
    await session.commit()
    return ChartQAOut(
        template=result["template"],
        title=result["title"],
        chart_type=result["chart_type"],
        data=[ChartDataPoint(**p) for p in result["data"]],
        params=result["params"],
        rationale=result.get("rationale"),
        fallback_used=result.get("fallback_used", False),
    )


# ---- v24.1 #4 · 24h 签收超时催办手工触发 -----------------------------------


class DispatchOverdueOut(BaseModel):
    notifications_emitted: int


@router.post("/dispatch-overdue/force-check", response_model=DispatchOverdueOut)
async def dispatch_overdue_force_check(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #4: 手工跑一次 24h 签收超时扫描.

    平时由 due_reminder_loop 每 1h 自动跑.这个端点用于 demo / 调试.
    Leader/admin only.返回这一轮 emit 的通知数(被 dedup 抑制的不算).
    """
    from ..due_reminder import _tick_dispatch_overdue
    await require_leader_or_admin(session, auth)
    n = await _tick_dispatch_overdue(session)
    await audit_log(
        session, auth, "dispatch_overdue.force_check",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={"notifications_emitted": n},
        autocommit=False,
    )
    await session.commit()
    return DispatchOverdueOut(notifications_emitted=n)


# ---- v24.3 #4 · 月结评价手工触发 -------------------------------------------


class MonthlyEvalForceRunIn(BaseModel):
    period: Optional[str] = None  # 'YYYY-MM',默认上月


class MonthlyEvalForceRunOut(BaseModel):
    period: str
    workspaces: int
    users: int


@router.post("/monthly-eval/force-run", response_model=MonthlyEvalForceRunOut)
async def monthly_eval_force_run(
    payload: MonthlyEvalForceRunIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.3 #4: 手工跑一次月结评价(给所有 workspace 的所有 active assignees).

    平时由 monthly_eval_loop 在每月 1 号 0-2 点自动跑.
    Leader/admin only.可指定 period(默认上月).
    """
    from ..monthly_eval_runner import run_monthly_eval_for_all
    await require_leader_or_admin(session, auth)
    p = (payload.period or "").strip() or None
    result = await run_monthly_eval_for_all(session, period=p)
    await audit_log(
        session, auth, "monthly_eval.force_run",
        target_type="system", target_id=None,
        payload=result,
        autocommit=False,
    )
    await session.commit()
    return MonthlyEvalForceRunOut(**result)


# ---- v24.3 #3 · 超时扣分手工触发 -------------------------------------------


class PenaltyForceCheckOut(BaseModel):
    new_penalties: int


@router.post("/penalties/force-check", response_model=PenaltyForceCheckOut)
async def penalties_force_check(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.3 #3: 手工跑一次超时扣分扫描(平时 1h 自动).

    Leader/admin only.返回新插入的 penalty 数(已扣过的不重扣).
    """
    from ..due_reminder import _tick_penalties
    await require_leader_or_admin(session, auth)
    n = await _tick_penalties(session)
    await audit_log(
        session, auth, "penalties.force_check",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={"new_penalties": n},
        autocommit=False,
    )
    await session.commit()
    return PenaltyForceCheckOut(new_penalties=n)


# ---- v24.1 #2 · 异常预警手工触发 -------------------------------------------


class AlertCheckOut(BaseModel):
    """每条规则的判定结果(skip / would_fire / 触发的 task_id)."""
    overdue_rate: dict
    assignee_overload: dict
    agent_low_completion: dict


@router.post("/alerts/force-check", response_model=AlertCheckOut)
async def alerts_force_check(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #2: 手工跑一次 3 条异常预警规则(跳 24h dedup).

    用途:
    - 演示 / 客户 demo 时即时看效果(不用等 1h tick)
    - 调试规则阈值

    Leader/admin only.返回每条规则的判定 + 是否真触发了 Task.
    """
    await require_leader_or_admin(session, auth)
    out = await force_check_now(session, auth.workspace.id)
    await audit_log(
        session, auth, "alert.force_check",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={"results": out},
        autocommit=False,
    )
    await session.commit()
    return AlertCheckOut(
        overdue_rate=out.get("overdue_rate", {"would_fire": False, "reason": "n/a"}),
        assignee_overload=out.get(
            "assignee_overload", {"would_fire": False, "reason": "n/a"}
        ),
        agent_low_completion=out.get(
            "agent_low_completion", {"would_fire": False, "reason": "n/a"}
        ),
    )


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


# ---- v25-1 · 演示数据清除 + 一键 demo seed ---------------------------------


class WipeDemoIn(BaseModel):
    confirm: str  # 必须等于 "yes_wipe_all_demo_data" 才执行
    wipe_voiceprints: bool = True


class WipeDemoOut(BaseModel):
    rows_deleted: dict[str, int]
    total: int


@router.post("/wipe-demo-data", response_model=WipeDemoOut)
async def wipe_demo_data(
    payload: WipeDemoIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25-1 — 清除当前 workspace 下所有业务数据.

    ⚠️ 不可逆操作.必须 owner / admin 角色,且 `confirm == 'yes_wipe_all_demo_data'`.

    保留:User / WorkspaceMembership / Workspace 本身 / ModelProviderConfig.
    清除:Notification / AuditLog / KnowledgeBase + Documents + Chunks /
          LongTermMemory / DataAccessRequest / CronRule / Task + 子表 /
          LeaderDirective / UpperDoc / Meeting + 子表 / Agent /
          Voiceprint(可选) / WorkspaceInvitation / workspace.preset.

    成功后调 seed-demo-scenario 一键重新灌入演示场景.
    """
    await require_leader_or_admin(session, auth)
    if payload.confirm != "yes_wipe_all_demo_data":
        raise HTTPException(
            400,
            "confirm 必须显式等于 'yes_wipe_all_demo_data' 才执行(防误触).",
        )
    from ..demo_seed import wipe_workspace_business_data

    counts = await wipe_workspace_business_data(
        session,
        workspace_id=auth.workspace.id,
        caller_user_id=auth.user.id,
        wipe_voiceprints=payload.wipe_voiceprints,
    )

    # 单独写一条 audit_log(在新 session,因为旧 audit 已被 wipe)
    await audit_log(
        session, auth, "workspace.wipe_demo_data",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload={"rows_deleted": counts, "total": sum(counts.values())},
        autocommit=True,
    )
    return WipeDemoOut(rows_deleted=counts, total=sum(counts.values()))


# ---- v25-prod-prep · 全局焦土重置 ------------------------------------------


class ScorchedEarthIn(BaseModel):
    confirm: str  # 必须 "yes_scorched_earth_reset"


class ScorchedEarthOut(BaseModel):
    workspaces_deleted: int
    users_deleted: int
    voiceprints_deleted: int
    password_resets_deleted: int
    main_workspace_business_rows_deleted: int
    main_workspace_id: str
    main_user_id: str
    model_provider_configs_kept: int


@router.post("/scorched-earth-reset", response_model=ScorchedEarthOut)
async def scorched_earth_reset(
    payload: ScorchedEarthIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    生产环境真人测试前 全局重置:
      ⚠️ 删除所有 不属于当前 caller 主 workspace 的 workspace(CASCADE 子表)
      ⚠️ 主 workspace 内 业务数据全清(沿用 wipe_workspace_business_data)
      ⚠️ 删除所有 非 caller 用户 + 他们的 memberships
      ⚠️ 清空 voiceprint / password_reset_token
      ✅ 保留 caller 用户行 + caller 主 workspace 行 + model_provider_config(LLM keys)

    必要 owner 权限 + confirm == 'yes_scorched_earth_reset'.
    """
    from sqlalchemy import delete
    from ..models import (
        MeetingAttendee, MeetingSpeakerSegment, MeetingTranscript,
        ModelProviderConfig, PasswordResetToken, User, Voiceprint,
        Workspace, WorkspaceMembership,
    )
    from ..demo_seed import wipe_workspace_business_data

    if payload.confirm != "yes_scorched_earth_reset":
        raise HTTPException(
            400,
            "confirm 必须显式等于 'yes_scorched_earth_reset' 才执行(不可逆).",
        )

    # owner-only(比 wipe-demo-data 更严)
    membership = (
        await session.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == auth.user.id,
                WorkspaceMembership.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not membership or membership.role not in ("owner",):
        raise HTTPException(403, "scorched-earth 仅 owner 可操作")

    main_user_id = auth.user.id
    main_ws_id = auth.workspace.id

    # Step 1: 主 workspace 内业务数据 全清(内部已 commit)
    counts = await wipe_workspace_business_data(
        session,
        workspace_id=main_ws_id,
        caller_user_id=main_user_id,
        wipe_voiceprints=True,
    )
    main_ws_total = sum(counts.values())

    # Step 2: 删 其他 workspace(CASCADE 删 meeting / agent / kb / task / 等)
    # 单独 commit,确保 CASCADE 真正持久(后续 step 3 报错也不会回滚)
    res = await session.execute(
        delete(Workspace).where(Workspace.id != main_ws_id)
    )
    workspaces_deleted = int(res.rowcount or 0)
    await session.commit()

    # Step 2.5: 防御性删除 meeting_attendee / meeting_transcript 中
    # 引用非 caller 用户的孤儿行.理论上 step 2 的 ws CASCADE 已通过 meeting →
    # attendee/transcript ON DELETE CASCADE 处理,但这两表的 user_id FK 是
    # 默认 RESTRICT — 如果有跨 workspace attendee(seed 时 caller 加进了
    # 别的 ws meeting),这里需要显式删,否则 step 3 删 user 报 FK 错.
    await session.execute(
        delete(MeetingAttendee).where(MeetingAttendee.user_id.is_not(None))
    )
    await session.execute(
        delete(MeetingTranscript).where(MeetingTranscript.speaker_user_id.is_not(None))
    )
    await session.execute(
        delete(MeetingSpeakerSegment).where(MeetingSpeakerSegment.user_id.is_not(None))
    )
    await session.commit()

    # Step 3: 删 非 caller 用户 + memberships
    await session.execute(
        delete(WorkspaceMembership).where(WorkspaceMembership.user_id != main_user_id)
    )
    res = await session.execute(
        delete(User).where(User.id != main_user_id)
    )
    users_deleted = int(res.rowcount or 0)

    # Step 4: voiceprint / password_reset_token 全清
    res = await session.execute(delete(Voiceprint))
    vp_deleted = int(res.rowcount or 0)
    res = await session.execute(delete(PasswordResetToken))
    pwd_deleted = int(res.rowcount or 0)

    # 验证 model_provider_config 完整保留
    mpc_count = (
        await session.execute(select(func.count(ModelProviderConfig.id)))
    ).scalar() or 0

    await session.commit()

    return ScorchedEarthOut(
        workspaces_deleted=workspaces_deleted,
        users_deleted=users_deleted,
        voiceprints_deleted=vp_deleted,
        password_resets_deleted=pwd_deleted,
        main_workspace_business_rows_deleted=main_ws_total,
        main_workspace_id=str(main_ws_id),
        main_user_id=str(main_user_id),
        model_provider_configs_kept=int(mpc_count),
    )


class SeedDemoIn(BaseModel):
    seed_kb_documents: bool = True  # False 时跳过 48 篇 KB(嵌入慢时可关掉)


class SeedDemoOut(BaseModel):
    summary: dict[str, Any]


@router.post("/seed-demo-scenario", response_model=SeedDemoOut)
async def seed_demo_scenario_endpoint(
    payload: SeedDemoIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v25-1 — 一键灌入完整演示场景.

    内容:
      - 16 AI 智慧住建专家(复用 seed-smart-construction-agents)
      - 19 demo 用户(密码 demo123;含 leader/admin/expert/member 各角色)
      - 10 历史 / 进行中 / 计划中 会议(含 transcript / agent message / action item)
      - 5 上级文件 + 5 领导指令(含 LLM 拆解出的 drafts)
      - 30 任务(各状态分布,可激活看板/趋势/月评)
      - 16 AI × 3 篇 KB 文档(共 48 篇,带 embedding 实测 30-60s)

    幂等:已存在的 demo 用户 email 跳过,Agent 名重复跳过.
    建议先调 wipe-demo-data,再 seed-demo-scenario,从干净状态开始.

    leader / admin only.返回各类对象创建数量.
    """
    await require_leader_or_admin(session, auth)
    from ..demo_seed import seed_demo_scenario

    summary = await seed_demo_scenario(
        session,
        workspace_id=auth.workspace.id,
        caller_user_id=auth.user.id,
        seed_kb_documents=payload.seed_kb_documents,
    )
    await audit_log(
        session, auth, "workspace.seed_demo_scenario",
        target_type="workspace", target_id=str(auth.workspace.id),
        payload=summary,
        autocommit=True,
    )
    return SeedDemoOut(summary=summary)
