"""
v24.2 #2 — 自然语言图表生成.

智慧住建文档 §3.3 图表生成:
> 输入:查询条件+数据范围 → 数据查询→图表类型推荐→图表配置生成 → 可交互图表.

为安全 + 演示稳定,**用预设模板**(LLM 选模板 + 填参数,而不是写自由 SQL):
  - 防 SQL 注入(完全用 SQLAlchemy 参数化 query)
  - 演示效果稳定(LLM 偏题时只选 fallback 模板,不会爆错)
  - 客户后续可加新模板,不动 LLM prompt

支持的模板(7 个,覆盖智慧住建 8 成日常问数):
  task_by_status         状态分布 → pie
  task_by_assignee_topN  Top N 工作量 → bar(横)
  task_by_source         触发源分布 → pie
  task_by_agent          按 AI 专家分组 → bar
  task_daily_creation    近 N 天新建数 → line
  task_daily_completion  近 N 天完成数 → line
  task_overdue_rate_trend 逾期率趋势 → line
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, Task, User, WorkspaceMembership

logger = logging.getLogger(__name__)


_TEMPLATES_FOR_LLM = """[
  {"key":"task_by_status","desc":"任务按状态分布(open/dispatched/.../done)","chart":"pie","params":["window_days?"]},
  {"key":"task_by_assignee_topN","desc":"前 N 名 assignee 的工作量(active task 数)","chart":"bar","params":["top_n?","window_days?"]},
  {"key":"task_by_source","desc":"任务按触发源分布(meeting/leader_directive/upper_doc/cron/alert/report/manual)","chart":"pie","params":["window_days?"]},
  {"key":"task_by_agent","desc":"任务按绑定 AI 专家分组(通过 assignee.bound_agent)","chart":"bar","params":["window_days?"]},
  {"key":"task_daily_creation","desc":"近 N 天每日新建任务数","chart":"line","params":["window_days?"]},
  {"key":"task_daily_completion","desc":"近 N 天每日完成任务数","chart":"line","params":["window_days?"]},
  {"key":"task_overdue_rate_trend","desc":"近 N 天每日逾期率趋势(0-1)","chart":"line","params":["window_days?"]}
]"""

_SYSTEM_PROMPT_PICK = (
    "你是智慧住建数据问数引擎的「意图 → 模板」匹配器.根据用户的中文问题,"
    "从给定模板列表里**只**选 1 个最贴切的,并提取 window_days(整数,默认 30)"
    "+ top_n(整数,默认 8,只 task_by_assignee_topN 用得上).\n\n"
    f"# 可用模板\n{_TEMPLATES_FOR_LLM}\n\n"
    "# 输出严格 JSON(不要 markdown):\n"
    '{"template": "key", "window_days": 30, "top_n": 8, "title": "适合的中文图表标题(15 字内)"}\n\n'
    "# 没有合适模板时,选 task_by_status + window_days=30."
)


def _safe_parse_json_obj(s: str) -> Optional[dict[str, Any]]:
    if not s:
        return None
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _clamp_window(d: Any) -> int:
    try:
        n = int(d)
    except (TypeError, ValueError):
        n = 30
    return max(1, min(n, 365))


def _clamp_top(d: Any) -> int:
    try:
        n = int(d)
    except (TypeError, ValueError):
        n = 8
    return max(1, min(n, 30))


# ---- Template runners ------------------------------------------------------


_STATUS_LABEL = {
    "open": "未派发",
    "dispatched": "待签收",
    "accepted": "已签收",
    "in_progress": "办理中",
    "submitted": "待审核",
    "done": "已完成",
    "archived": "已归档",
    "cancelled": "已取消",
}

_SOURCE_LABEL = {
    "meeting": "会议",
    "manual": "手工",
    "leader_directive": "领导指令",
    "upper_doc": "上级文件",
    "cron": "定期巡检",
    "alert": "异常预警",
    "report": "问题上报",
}


async def _t_task_by_status(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(Task.status, func.count(Task.id))
            .where(Task.workspace_id == ws_id, Task.created_at >= cutoff)
            .group_by(Task.status)
        )
    ).all()
    return {
        "chart_type": "pie",
        "data": [
            {"name": _STATUS_LABEL.get(s, s), "value": int(c)} for s, c in rows
        ],
    }


async def _t_task_by_assignee_topN(
    session: AsyncSession, ws_id: UUID, days: int, top_n: int
) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(Task.assignee_user_id, func.count(Task.id))
            .where(
                Task.workspace_id == ws_id,
                Task.created_at >= cutoff,
                Task.assignee_user_id.is_not(None),
            )
            .group_by(Task.assignee_user_id)
            .order_by(func.count(Task.id).desc())
            .limit(top_n)
        )
    ).all()
    if not rows:
        return {"chart_type": "bar", "data": []}
    uids = [r[0] for r in rows]
    name_by_uid = {
        u.id: u.name
        for u in (await session.execute(select(User).where(User.id.in_(uids)))).scalars().all()
    }
    return {
        "chart_type": "bar",
        "data": [
            {"name": name_by_uid.get(uid, "(未知)"), "value": int(c)} for uid, c in rows
        ],
    }


async def _t_task_by_source(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(Task.source_type, func.count(Task.id))
            .where(Task.workspace_id == ws_id, Task.created_at >= cutoff)
            .group_by(Task.source_type)
        )
    ).all()
    return {
        "chart_type": "pie",
        "data": [{"name": _SOURCE_LABEL.get(s, s), "value": int(c)} for s, c in rows],
    }


async def _t_task_by_agent(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    """按 assignee.bound_agent 分组."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # 走 join: Task → User (assignee) → WorkspaceMembership (bound_agent_id) → Agent
    rows = (
        await session.execute(
            select(Agent.name, func.count(Task.id))
            .select_from(Task)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == Task.assignee_user_id)
            .join(Agent, Agent.id == WorkspaceMembership.bound_agent_id)
            .where(
                Task.workspace_id == ws_id,
                Task.created_at >= cutoff,
                WorkspaceMembership.workspace_id == ws_id,
                WorkspaceMembership.bound_agent_id.is_not(None),
            )
            .group_by(Agent.name)
            .order_by(func.count(Task.id).desc())
            .limit(20)
        )
    ).all()
    return {
        "chart_type": "bar",
        "data": [{"name": n, "value": int(c)} for n, c in rows],
    }


async def _t_task_daily_creation(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(func.date(Task.created_at), func.count(Task.id))
            .where(Task.workspace_id == ws_id, Task.created_at >= cutoff)
            .group_by(func.date(Task.created_at))
            .order_by(func.date(Task.created_at))
        )
    ).all()
    by_day = {str(d): int(c) for d, c in rows}
    out = []
    today = datetime.now(timezone.utc).date()
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append({"name": d, "value": by_day.get(d, 0)})
    return {"chart_type": "line", "data": out}


async def _t_task_daily_completion(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(func.date(Task.updated_at), func.count(Task.id))
            .where(
                Task.workspace_id == ws_id,
                Task.status == "done",
                Task.updated_at >= cutoff,
            )
            .group_by(func.date(Task.updated_at))
            .order_by(func.date(Task.updated_at))
        )
    ).all()
    by_day = {str(d): int(c) for d, c in rows}
    out = []
    today = datetime.now(timezone.utc).date()
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append({"name": d, "value": by_day.get(d, 0)})
    return {"chart_type": "line", "data": out}


async def _t_task_overdue_rate_trend(
    session: AsyncSession, ws_id: UUID, days: int
) -> dict[str, Any]:
    """近 N 天每日:当日存在的活跃任务里,逾期数 / 总活跃数."""
    today = datetime.now(timezone.utc).date()
    out = []
    for i in range(days, -1, -1):
        d = today - timedelta(days=i)
        snapshot_dt = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        # 当日存在 = created_at <= snapshot_dt 且 (status not 终态 or updated_at > snapshot_dt)
        # 简化:创建于该日及之前 + 当前非终态 → "活跃"
        # 这是粗近似,准确算需要状态变更日志,留 v25 audit log 表
        total = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == ws_id,
                    Task.created_at < snapshot_dt,
                    Task.status.notin_(("done", "archived", "cancelled")),
                )
            )
        ).scalar() or 0
        overdue = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == ws_id,
                    Task.created_at < snapshot_dt,
                    Task.status.notin_(("done", "archived", "cancelled")),
                    Task.due_at.is_not(None),
                    Task.due_at < snapshot_dt,
                )
            )
        ).scalar() or 0
        rate = round(overdue / total, 3) if total > 0 else 0.0
        out.append({"name": d.isoformat(), "value": rate})
    return {"chart_type": "line", "data": out}


_TEMPLATES = {
    "task_by_status": _t_task_by_status,
    "task_by_assignee_topN": _t_task_by_assignee_topN,
    "task_by_source": _t_task_by_source,
    "task_by_agent": _t_task_by_agent,
    "task_daily_creation": _t_task_daily_creation,
    "task_daily_completion": _t_task_daily_completion,
    "task_overdue_rate_trend": _t_task_overdue_rate_trend,
}


# ---- Public API ------------------------------------------------------------


async def answer_chart_question(
    session: AsyncSession, workspace_id: UUID, question: str
) -> dict[str, Any]:
    """
    Returns:
      {
        "template": "task_by_status",
        "title": "近30天任务状态分布",
        "chart_type": "pie",
        "data": [{name, value}, ...],
        "params": {"window_days": 30, "top_n": 8},
        "rationale": "LLM 选择理由(可选)",
        "fallback_used": bool,
      }
    """
    q = (question or "").strip()
    if not q:
        return {
            "template": "task_by_status",
            "title": "近 30 天任务状态分布(默认)",
            "chart_type": "pie",
            "data": (await _t_task_by_status(session, workspace_id, 30))["data"],
            "params": {"window_days": 30},
            "rationale": "未提供问题,fallback 默认模板",
            "fallback_used": True,
        }

    # LLM 选模板
    provider = await get_active_provider(session)
    chosen: Optional[dict[str, Any]] = None
    fallback_used = False
    if provider is not None:
        chunks: list[str] = []
        try:
            async for c in stream_chat(
                provider=provider,
                system_prompt=_SYSTEM_PROMPT_PICK,
                user_prompt=f"用户问题:\n{q[:500]}",
            ):
                chunks.append(c)
            raw = "".join(chunks).strip()
            chosen = _safe_parse_json_obj(raw)
        except LlmError as e:
            logger.warning("chart_qa: LLM failed: %s", e)
    if not chosen or chosen.get("template") not in _TEMPLATES:
        # fallback to status pie 30d
        chosen = {
            "template": "task_by_status",
            "window_days": 30,
            "title": "任务状态分布(LLM 未给有效结果,fallback)",
        }
        fallback_used = True

    template_key = chosen["template"]
    days = _clamp_window(chosen.get("window_days", 30))
    top_n = _clamp_top(chosen.get("top_n", 8))
    title = (chosen.get("title") or template_key)[:80]

    fn = _TEMPLATES[template_key]
    if template_key == "task_by_assignee_topN":
        result = await fn(session, workspace_id, days, top_n)
    else:
        result = await fn(session, workspace_id, days)

    return {
        "template": template_key,
        "title": title,
        "chart_type": result["chart_type"],
        "data": result["data"],
        "params": {"window_days": days, "top_n": top_n if template_key == "task_by_assignee_topN" else None},
        "rationale": None,
        "fallback_used": fallback_used,
    }
