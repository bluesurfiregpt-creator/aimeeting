"""
v24.2 #4 — AI 数据分析(趋势 + 异常检测 + 简易预测).

智慧住建文档 §3.3 数据分析:
> 输入:时间序列数据 → 统计计算 → 趋势拟合 → 异常检测 → 规则匹配
> 输出:趋势报告 + 预警清单

跟 alert_monitor 的关系:
  - alert_monitor:**反应式** — 触发阈值 → 创建 Task(给 leader 处理)
  - trend_analysis:**描述式** — 读 + 可视化(给 leader 看)

本模块只做读 + 计算,不写库.前端 /dashboard/trends 显示 sparkline + 统计.

3 个内置指标:
  task_creation_daily   每日新建任务数
  task_completion_daily 每日完成数
  task_overdue_rate     每日逾期率(0-1)

每个指标算:
  series       时间序列(N 天 daily 数据)
  mean / std   描述统计
  current      最新一天的值
  z_score      (current - mean) / std,|z|>2 标 anomaly
  slope_per_day 简单线性拟合斜率(每天涨/跌多少)
  forecast_7d   current + slope * 7
  trend_label  上升 / 下降 / 平稳(基于斜率)
"""

from __future__ import annotations

import logging
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Task

logger = logging.getLogger(__name__)


_DEFAULT_DAYS = 30
_ANOMALY_Z_THRESHOLD = 2.0  # |z| > 2 → 异常
_TREND_SLOPE_THRESHOLD = 0.05  # 占 mean 5% 算明显趋势


# ---- 序列采集 --------------------------------------------------------------


async def _series_creation_daily(
    session: AsyncSession, ws_id: UUID, days: int
) -> list[float]:
    """近 days 天每日新建数."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await session.execute(
            select(func.date(Task.created_at), func.count(Task.id))
            .where(Task.workspace_id == ws_id, Task.created_at >= cutoff)
            .group_by(func.date(Task.created_at))
        )
    ).all()
    by_day = {str(d): float(c) for d, c in rows}
    out: list[float] = []
    today = datetime.now(timezone.utc).date()
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append(by_day.get(d, 0.0))
    return out


async def _series_completion_daily(
    session: AsyncSession, ws_id: UUID, days: int
) -> list[float]:
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
        )
    ).all()
    by_day = {str(d): float(c) for d, c in rows}
    out: list[float] = []
    today = datetime.now(timezone.utc).date()
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append(by_day.get(d, 0.0))
    return out


async def _series_overdue_rate_daily(
    session: AsyncSession, ws_id: UUID, days: int
) -> list[float]:
    """近 days 天每日逾期率(0-1)."""
    today = datetime.now(timezone.utc).date()
    out: list[float] = []
    for i in range(days, -1, -1):
        d = today - timedelta(days=i)
        snapshot = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        total = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == ws_id,
                    Task.created_at < snapshot,
                    Task.status.notin_(("done", "archived", "cancelled")),
                )
            )
        ).scalar() or 0
        overdue = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.workspace_id == ws_id,
                    Task.created_at < snapshot,
                    Task.status.notin_(("done", "archived", "cancelled")),
                    Task.due_at.is_not(None),
                    Task.due_at < snapshot,
                )
            )
        ).scalar() or 0
        out.append(round(overdue / total, 3) if total > 0 else 0.0)
    return out


# ---- 统计 ------------------------------------------------------------------


def _linear_slope(series: list[float]) -> float:
    """简单 OLS slope:y = slope*x + intercept,返回 slope(单位:每天 +/- N)."""
    n = len(series)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(series) / n
    num = sum((xs[i] - mean_x) * (series[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    if den == 0:
        return 0.0
    return num / den


def _stats_for_series(series: list[float]) -> dict[str, float]:
    """mean / std / current / z_score / slope / forecast_7d / trend_label."""
    if not series:
        return {
            "mean": 0.0, "std": 0.0, "current": 0.0,
            "z_score": 0.0, "slope_per_day": 0.0, "forecast_7d": 0.0,
            "anomaly": False, "trend_label": "无数据",
        }
    current = series[-1]
    if len(series) < 2:
        return {
            "mean": current, "std": 0.0, "current": current,
            "z_score": 0.0, "slope_per_day": 0.0, "forecast_7d": current,
            "anomaly": False, "trend_label": "样本不足",
        }
    mean = sum(series) / len(series)
    try:
        std = statistics.stdev(series)
    except statistics.StatisticsError:
        std = 0.0
    z = (current - mean) / std if std > 0 else 0.0
    slope = _linear_slope(series)
    forecast = max(0.0, current + slope * 7)
    abs_slope_pct = abs(slope) / mean if mean > 0 else 0.0
    if abs_slope_pct < _TREND_SLOPE_THRESHOLD:
        trend = "平稳"
    elif slope > 0:
        trend = "上升"
    else:
        trend = "下降"
    anomaly = abs(z) > _ANOMALY_Z_THRESHOLD
    return {
        "mean": round(mean, 3),
        "std": round(std, 3),
        "current": round(current, 3),
        "z_score": round(z, 3),
        "slope_per_day": round(slope, 4),
        "forecast_7d": round(forecast, 3),
        "anomaly": anomaly,
        "trend_label": trend,
    }


# ---- Public --------------------------------------------------------------


_METRICS = {
    "task_creation_daily": {
        "label": "每日新建任务数",
        "fn": _series_creation_daily,
        "unit": "条",
    },
    "task_completion_daily": {
        "label": "每日完成任务数",
        "fn": _series_completion_daily,
        "unit": "条",
    },
    "task_overdue_rate": {
        "label": "每日逾期率",
        "fn": _series_overdue_rate_daily,
        "unit": "%",
    },
}


async def compute_trends(
    session: AsyncSession, workspace_id: UUID, days: int = _DEFAULT_DAYS
) -> dict[str, Any]:
    """
    Returns:
      {
        "days": N,
        "metrics": {
          "task_creation_daily": {
            "label": "每日新建任务数",
            "unit": "条",
            "series": [{"name": "2026-05-01", "value": 5.0}, ...],
            "mean": ...,
            "std": ...,
            ...
          },
          ...
        }
      }
    """
    days = max(7, min(days, 90))
    today = datetime.now(timezone.utc).date()
    out_metrics: dict[str, Any] = {}
    for key, meta in _METRICS.items():
        series = await meta["fn"](session, workspace_id, days)
        stats = _stats_for_series(series)
        labeled_series = []
        for i, v in enumerate(series):
            d = (today - timedelta(days=days - i)).isoformat()
            labeled_series.append({"name": d, "value": v})
        out_metrics[key] = {
            "label": meta["label"],
            "unit": meta["unit"],
            "series": labeled_series,
            **stats,
        }
    return {"days": days, "metrics": out_metrics}
