"""
v1.4.0 · Saga T2 (Phase 2 W2) · Task urgency derive + 中文 humanize.

SCHEMA-mobile-v2.md §0 urgency enum:
  "urgent" | "today" | "week" | "none"

Saga T1 决定 不在 DB 持久化 urgency, 后端 derive — 跟 Task.due_at vs now 实时算.
Phase 1 (Saga O) frontend mock 直接写死 urgency 字符串; Phase 2 Saga T2 起所有
真接 endpoint (pending-tasks / tasks/grouped) 都 必须 走本模块, 不允许在 router
内 inline if-else.

为什么 提取统一文件:
  - Saga T2 起 5 个 endpoint 中 2 个 直接 渲染 urgency (pending-tasks + tasks/grouped)
  - 后续 Saga T3-T7 还会用 (decisions / experts / banner)
  - 单一文件 = 改阈值一处生效 (eg 2h vs 当天 0:00 边界 PM 想 调)

ABAC: 本模块不依赖 workspace_id / user. 纯函数 — 输入 (due_at, now) → 输出.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Optional


# ============================================================================
# urgency derive · 输入 Task.due_at + now → SCHEMA enum
# ============================================================================


def derive_urgency(due_at: Optional[datetime], now: Optional[datetime] = None) -> str:
    """v1.4.0 Saga T2 · Task.due_at + now → SCHEMA §0 urgency enum.

    规则 (跟 Saga T1 priority-banner 一致):
      due_at IS NULL                → "none"  (没截止 不算紧急)
      due_at < now                  → "urgent" (已 overdue)
      due_at 落在 今天 23:59 之前   → "today"
      due_at 落在 未来 7 天 之内    → "week"
      其他 (> 7 天)                 → "none"

    边界:
      now=None → 用 datetime.now(timezone.utc) (避免 caller 每次 算)
    """
    if not due_at:
        return "none"

    if now is None:
        now = datetime.now(timezone.utc)

    # tz-aware 防御 — Task.due_at 入库 是 UTC tz-aware (models.py:758
    # DateTime(timezone=True)). 但万一 caller 传 naive datetime, 也兜底 UTC.
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    delta = due_at - now
    delta_seconds = delta.total_seconds()

    # overdue → urgent (高于今天判定, 即使 due_at 落今天但已过点 也算 urgent)
    if delta_seconds < 0:
        return "urgent"

    # 落今天 23:59:59 之前 → today
    today_end = datetime.combine(now.date(), time.max, tzinfo=now.tzinfo)
    if due_at <= today_end:
        return "today"

    # 未来 7 天之内 → week
    if delta_seconds < 7 * 24 * 3600:
        return "week"

    return "none"


# ============================================================================
# due_display · 中文 humanize (跟设计稿 / mock 一致)
# ============================================================================


# 中文 周几 (周一 = 0)
_CN_WEEKDAY = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def due_display(due_at: Optional[datetime], now: Optional[datetime] = None) -> str:
    """v1.4.0 Saga T2 · Task.due_at + now → 中文显示文案.

    跟设计稿 mock 文案 对齐 (v2_tasks_memory.py:220 _TASKS_PENDING):
      due_at = 今天 11:30        → "今天 11:30"
      due_at = 明天 任意时间      → "明天"
      due_at = 本周 周三           → "本周三"
      due_at = 下周                → "下周"
      due_at = 已 overdue (今天)  → "今天 11:30"  (仍按 hh:mm 显示, urgency 字段 已 urgent)
      due_at = 已 overdue (过去)  → "已 overdue"
      due_at = None               → ""
      due_at = > 30 天            → "MM-DD" (eg "07-15")
      done 状态 (caller 端处理)  → "已完成"  (本 helper 不知 Task.status, caller 决定)

    边界:
      now=None → 用 datetime.now(timezone.utc)
    """
    if not due_at:
        return ""

    if now is None:
        now = datetime.now(timezone.utc)

    # tz-aware 防御
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    today = now.date()
    due_date = due_at.date()
    delta_days = (due_date - today).days

    # 已 overdue (过去日子, 不含 今天)
    if delta_days < 0:
        return "已 overdue"

    # 今天 — 显示 "今天 HH:MM"
    if delta_days == 0:
        return f"今天 {due_at.strftime('%H:%M')}"

    # 明天
    if delta_days == 1:
        return "明天"

    # 本周 (周一 = 0; today.weekday() 0~6) — due 在本周日 (周日=6) 之前
    today_weekday = today.weekday()
    # 本周剩余 天数 = 6 - today_weekday (eg 周三 today_weekday=2, 剩 4 天)
    days_to_sunday = 6 - today_weekday
    if delta_days <= days_to_sunday:
        # 本周 X (周二 / 周三 / ...)
        return f"本{_CN_WEEKDAY[due_date.weekday()]}"

    # 下周 (8 ~ 14 天)
    if delta_days <= days_to_sunday + 7:
        return "下周"

    # > 30 天 → "07-15" 格式
    if delta_days > 30:
        return due_at.strftime("%m-%d")

    # 14 ~ 30 天 → "X 天后"
    return f"{delta_days} 天后"
