"""
v20 — 定期巡检触发源 (cron_rule).

后台 lifespan loop, 每 60 秒 tick 一次. 每个 tick:
  1. SELECT 所有 is_active=true 的 cron_rule
  2. 解析 cron_expr → 是否「当前分钟」匹配
  3. 匹配的:
     - INSERT 一行 Task(source_type='cron', source_ref={rule_id, fired_at})
     - UPDATE rule.last_fired_at + fire_count
     - 如果 auto_dispatch + assignee 都有,直接进 status='dispatched' + 发通知

故意没引入 croniter 依赖. 实现的是简化版 cron, 五段:
    分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
每段支持:
    *           — 任意值
    数字        — 单个值,如 9
    数字,数字   — 列表,如 0,15,30,45
    */N         — 间隔, 如 */15 表示每 15 分钟一次
不支持: 范围(1-5)、L/W 等高级语法. 真复杂 cron 用户可以建多条 rule.

幂等保证:rule.last_fired_at 是上次 fire 的分钟时间戳 (truncated to minute).
当前 tick 的「当前分钟」如果 == last_fired_at 的分钟,跳过 — 防止
loop 间隔抖动导致同一分钟连开两条 Task.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models import CronRule, Task
from .notify import emit_notification

logger = logging.getLogger(__name__)

# 每 60s 跑一次. 也可通过 env 调小用于测试.
_TICK_SECONDS = int(os.getenv("CRON_RUNNER_TICK_SECONDS", "60"))


def _parse_segment(seg: str, lo: int, hi: int) -> Optional[set[int]]:
    """
    把 cron 表达式的一段解析成允许值集合.
    返回 None 表示「全匹配」(等价于全集),省得每次比较时构造大集合.
    解析失败返回 set() — 后续 _matches() 会因为不在集合里而判否.
    """
    s = (seg or "").strip()
    if s == "*":
        return None  # 全匹配
    # */N
    if s.startswith("*/"):
        try:
            n = int(s[2:])
            if n <= 0:
                return set()
            return {v for v in range(lo, hi + 1) if v % n == 0}
        except ValueError:
            return set()
    # 数字 列表
    out: set[int] = set()
    for piece in s.split(","):
        try:
            v = int(piece.strip())
            if lo <= v <= hi:
                out.add(v)
        except ValueError:
            return set()
    return out


def _matches(cron_expr: str, now: datetime) -> bool:
    """
    判断 `now`(UTC)是否匹配 `cron_expr`.
    cron_expr 5 段: 分 时 日 月 周.
    周用 0-6, 0=周日, 与 Python 的 weekday() 不同 — 用 isoweekday() % 7.
    """
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False
    minutes = _parse_segment(parts[0], 0, 59)
    hours = _parse_segment(parts[1], 0, 23)
    doms = _parse_segment(parts[2], 1, 31)
    months = _parse_segment(parts[3], 1, 12)
    dows = _parse_segment(parts[4], 0, 6)

    def _ok(allowed: Optional[set[int]], v: int) -> bool:
        return allowed is None or v in allowed

    return (
        _ok(minutes, now.minute)
        and _ok(hours, now.hour)
        and _ok(doms, now.day)
        and _ok(months, now.month)
        and _ok(dows, now.isoweekday() % 7)
    )


def validate_cron_expr_or_error(cron_expr: str) -> Optional[str]:
    """
    Returns None if the expression parses to *something usable*, or a
    short error message describing why it's invalid.

    A segment is invalid if `_parse_segment` returns an empty set —
    that means the user wrote something that isn't `*`, `*/N`, or a
    valid number list, and would never match. We refuse such rules
    early so the user sees the mistake at create-time.
    """
    parts = (cron_expr or "").strip().split()
    if len(parts) != 5:
        return "必须是 5 段(分 时 日 月 周)"
    bounds = [
        ("分", 0, 59),
        ("时", 0, 23),
        ("日", 1, 31),
        ("月", 1, 12),
        ("周", 0, 6),
    ]
    for seg, (label, lo, hi) in zip(parts, bounds):
        result = _parse_segment(seg, lo, hi)
        # `None` = wildcard '*', valid. Empty set = bad input.
        if result is not None and len(result) == 0:
            return f"{label}段无效:{seg!r}(应为数字、`*`、`*/N` 或逗号列表)"
    return None


def _truncate_to_minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


async def fire_rule(
    session: AsyncSession,
    rule: CronRule,
    *,
    fired_at: Optional[datetime] = None,
) -> uuid.UUID:
    """
    Instantiate one Task from this rule. Idempotent对调用方:同一规则同一分钟
    多次调用会写多条(由 caller 保证不重复).返回新 Task.id.
    """
    now = fired_at or datetime.now(timezone.utc)
    wants_dispatch = rule.auto_dispatch and rule.task_template_assignee_user_id is not None
    due = (
        now + timedelta(days=rule.due_days_after) if rule.due_days_after else None
    )
    new_task = Task(
        workspace_id=rule.workspace_id,
        title=rule.task_template_title,
        content=rule.task_template_content[:1000],
        assignee_user_id=rule.task_template_assignee_user_id,
        created_by_user_id=rule.created_by_user_id,
        due_at=due,
        status="dispatched" if wants_dispatch else "open",
        source_type="cron",
        source_ref={
            "rule_id": str(rule.id),
            "rule_name": rule.name,
            "fired_at": now.isoformat(),
        },
    )
    if wants_dispatch:
        new_task.dispatched_at = now
        new_task.dispatched_by_user_id = rule.created_by_user_id
    session.add(new_task)
    await session.flush()

    if (
        wants_dispatch
        and rule.task_template_assignee_user_id is not None
        and rule.task_template_assignee_user_id != rule.created_by_user_id
    ):
        await emit_notification(
            session,
            workspace_id=rule.workspace_id,
            user_id=rule.task_template_assignee_user_id,
            kind="task_dispatched",
            payload={
                "task_id": str(new_task.id),
                "content": new_task.content,
                "due_at": new_task.due_at.isoformat() if new_task.due_at else None,
                "dispatched_by": "定时巡检",
                "rule_id": str(rule.id),
                "rule_name": rule.name,
            },
        )

    rule.last_fired_at = _truncate_to_minute(now)
    rule.fire_count = (rule.fire_count or 0) + 1
    return new_task.id


async def _tick_once(session: AsyncSession, now: datetime) -> int:
    """
    Scan active rules, fire those matching `now` (truncated to minute) +
    not already fired this same minute. Returns number of Tasks created.
    """
    now_min = _truncate_to_minute(now)
    rules = (
        await session.execute(
            select(CronRule).where(CronRule.is_active.is_(True))
        )
    ).scalars().all()

    created_count = 0
    for rule in rules:
        # 防重:本分钟已 fire 过则跳过
        if rule.last_fired_at is not None and _truncate_to_minute(
            rule.last_fired_at
        ) == now_min:
            continue
        try:
            if not _matches(rule.cron_expr, now_min):
                continue
        except Exception:
            logger.exception(
                "cron_runner: bad cron_expr in rule %s: %r",
                rule.id,
                rule.cron_expr,
            )
            continue
        try:
            await fire_rule(session, rule, fired_at=now_min)
            created_count += 1
        except Exception:
            logger.exception("cron_runner: fire_rule failed for %s", rule.id)
    if created_count:
        await session.commit()
    return created_count


async def cron_runner_loop(stop_event: asyncio.Event) -> None:
    """
    Long-running loop. Wired into FastAPI lifespan alongside due_reminder_loop.
    """
    logger.info("cron_runner_loop starting; tick=%ds", _TICK_SECONDS)
    # 短暂 warm-up,避免热重载期间双进程同时 fire
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=10)
        return
    except asyncio.TimeoutError:
        pass
    while not stop_event.is_set():
        try:
            async with SessionLocal() as session:
                n = await _tick_once(session, datetime.now(timezone.utc))
                if n:
                    logger.info("cron_runner tick: created %d task(s)", n)
        except Exception:
            logger.exception("cron_runner tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            continue
    logger.info("cron_runner_loop exiting")
