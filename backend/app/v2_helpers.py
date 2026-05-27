"""
v1.4.0 · Saga T2 / T3+T4 (Phase 2 W2 / W3) · Mobile App v2 — 共享 helper.

T2 build_meeting_item: 把 ORM Meeting + attendees + insights → SCHEMA §2.2
  V2MeetingItem dict. 两处 复用 (避免 重复):
    - /api/v2/meetings (§2.2) — list 所有 状态 meeting
    - /api/v2/today/live-meeting (§3.2) — 单个 live meeting

T3+T4 扩展 (本次):
  humanize_timestamp(ts, now) — "刚刚" / "X 分钟前" / "X 小时前" / "X 天前".
    给 §3.7 experts.last_active_display 用. 跟 task_urgency.due_display 一脉相承
    (中文 humanize, 但 这是 历史时刻 不是 未来 due, 所以 单独函数 不强加 到
    task_urgency 里).
  group_insights_by_topic(insights) — 按 meeting_id 分组 (SCHEMA §4.4 topic).
    AIInsight 没 topic 列, 只能 用 meeting_id 当 group key. caller 给 Meeting
    title 当 topic 文本.

提取统一 helper 是 因为 §2.2 和 §3.2 共享 同一 schema, 任何 字段 / 计算 (elapsed
/ countdown / decision_count) 改动 要在 一处 生效, 不能 各自 inline 写.

ABAC: 本模块 不主动 query DB. caller 负责 已经 走过 ABAC 拉好 Meeting + attendees,
本 helper 只做 shape transform.

字段对照 (SCHEMA §2.2):
  id, title, topic_summary, status,
  started_at, scheduled_for, ended_at,
  elapsed_minutes, countdown_seconds,
  decision_count,
  attendees (V2Attendee[]),
  human_count, ai_count,
  ai_badges (V2AIBadge[])

DB 字段映射:
  title             ← Meeting.title
  topic_summary     ← Meeting.description (Meeting.description 是 用户写的 brief
                      段, 见 models.py:342, 没有则 Meeting.title)
  status            ← map_meeting_status(Meeting.status)
                      DB: scheduled | ongoing | finished | processed
                      SCHEMA: upcoming | live | finished | processed
  scheduled_for     ← Meeting.started_at (没 设计 scheduled_for 列, 用 started_at;
                      若 NULL 退到 created_at)
  started_at        ← Meeting.started_at
  ended_at          ← Meeting.ended_at
  elapsed_minutes   ← live: (now - started_at).seconds / 60
                      finished: (ended_at - started_at).seconds / 60
                      upcoming: None
  countdown_seconds ← upcoming: max(0, (started_at - now).seconds), 没 started_at NULL
                      live/finished: None
  decision_count    ← AIInsight.count by meeting_id, type IN DECISION_INSIGHT_TYPES
  attendees         ← JOIN MeetingAttendee → users (type='human') + agents (type='ai')
  human_count       ← attendees 中 type='human' 计数
  ai_count          ← attendees 中 type='ai' 计数
  ai_badges         ← attendees 中 type='ai' 部分 → V2AIBadge shape
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence

from .agent_glyphs import (
    agent_to_ai_badge,
    agent_to_attendee,
    user_to_attendee,
)
from .models import Agent, AIInsight, Meeting, User


# ============================================================================
# Status mapping · Meeting.status (DB) → SCHEMA §0 meeting_status enum
# ============================================================================
#
# DB Meeting.status (models.py:331):
#   scheduled  — 创建 但 还没 开始 (upcoming)
#   ongoing    — 进行中 (live)
#   finished   — 已结束 (finished)
#   processed  — 已 出 summary / Recording 处理完 (processed)
#
# SCHEMA §0 meeting_status:
#   upcoming | live | finished | processed
#
# 一一映射 (scheduled → upcoming).

_MEETING_STATUS_DB_TO_SCHEMA: dict[str, str] = {
    "scheduled": "upcoming",
    "ongoing": "live",
    "finished": "finished",
    "processed": "processed",
}


def map_meeting_status(db_status: Optional[str]) -> str:
    """Meeting.status (DB) → SCHEMA §0 enum.

    未知 / NULL → "upcoming" (兜底 — 不抛错, 防 老 status seed 干扰).
    """
    if not db_status:
        return "upcoming"
    return _MEETING_STATUS_DB_TO_SCHEMA.get(db_status, "upcoming")


def _to_iso_z(dt: Optional[datetime]) -> Optional[str]:
    """datetime → ISO 8601 Z 字符串. None → None."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_meeting_item(
    meeting: Meeting,
    *,
    human_users: Sequence[User],
    ai_agents: Sequence[Agent],
    decision_count: int = 0,
    now: Optional[datetime] = None,
) -> dict:
    """v1.4.0 Saga T2 · ORM Meeting + attendees → SCHEMA §2.2 V2MeetingItem dict.

    输入:
      meeting       — Meeting ORM 实例 (已 拉好)
      human_users   — 已 join MeetingAttendee → User 的 真人 list
      ai_agents     — 已 join MeetingAttendee → Agent 的 AI list
      decision_count — 已 算好的 决策类 insight 计数 (caller 端 SQL 算)
      now           — 当前时刻, 默认 datetime.now(timezone.utc) (测试可注入)

    返回: V2MeetingItem dict (跟 Pydantic schema 字段一致).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # status
    status = map_meeting_status(meeting.status)

    # scheduled_for — 用 started_at, 没有 退到 created_at (兜底 不抛)
    if meeting.started_at:
        scheduled_for_dt = meeting.started_at
    else:
        scheduled_for_dt = meeting.created_at

    # elapsed_minutes / countdown_seconds
    elapsed_minutes: Optional[int] = None
    countdown_seconds: Optional[int] = None

    if status == "live" and meeting.started_at:
        delta = (now - meeting.started_at).total_seconds()
        elapsed_minutes = max(0, int(delta // 60))
    elif status in ("finished", "processed") and meeting.started_at and meeting.ended_at:
        delta = (meeting.ended_at - meeting.started_at).total_seconds()
        elapsed_minutes = max(0, int(delta // 60))
    elif status == "upcoming" and meeting.started_at:
        delta = (meeting.started_at - now).total_seconds()
        countdown_seconds = max(0, int(delta))

    # topic_summary — Meeting.description 是 用户写的 brief 段 (models.py:342),
    # 没有 就 退到 title (UI 显示 fallback 不空)
    topic_summary = (meeting.description or "").strip() or (meeting.title or "")

    # attendees — human + ai 拼接, type 决定 顺序无所谓 (前端 各自渲)
    attendees: list[dict] = []
    for u in human_users:
        # surname_char 从 user.name 取 首字符 (跟 mock "周凯" → "周" 一致)
        first_char = (u.name or "").strip()[:1] if u.name else None
        attendees.append(user_to_attendee(u.id, u.name, surname_char=first_char))
    for a in ai_agents:
        attendees.append(agent_to_attendee(a))

    human_count = len(human_users)
    ai_count = len(ai_agents)

    # ai_badges — 走 agent_to_ai_badge helper
    ai_badges = [agent_to_ai_badge(a) for a in ai_agents]

    return {
        "id": str(meeting.id),
        "title": meeting.title or "未命名会议",
        "topic_summary": topic_summary,
        "status": status,
        "started_at": _to_iso_z(meeting.started_at),
        "scheduled_for": _to_iso_z(scheduled_for_dt) or "",
        "ended_at": _to_iso_z(meeting.ended_at),
        "elapsed_minutes": elapsed_minutes,
        "countdown_seconds": countdown_seconds,
        "decision_count": int(decision_count or 0),
        "attendees": attendees,
        "human_count": human_count,
        "ai_count": ai_count,
        "ai_badges": ai_badges,
    }


# ============================================================================
# T3+T4 helper · humanize_timestamp — 历史时刻 中文相对时间
# ============================================================================
#
# 跟 task_urgency.due_display 区别:
#   due_display     是 未来 due (今天 11:30 / 明天 / 本周三 / 下周)
#   humanize_timestamp 是 过去 时刻 (刚刚 / X 分钟前 / X 小时前 / X 天前)
#
# 给 SCHEMA §3.7 experts.last_active_display 用. 设计稿样例:
#   "刚刚" (≤ 5 分钟)
#   "15 分钟前"
#   "30 分钟前"
#   "1 小时前"
#   "昨天"
#   "5 天前"
#   "7 天前"


def humanize_timestamp(ts: Optional[datetime], now: Optional[datetime] = None) -> str:
    """v1.4.0 Saga T4 · 历史时刻 → 中文相对时间.

    规则 (跟设计稿 mock 文案 对齐):
      ts IS NULL                    → "暂无活动"
      ts > now                      → "刚刚" (兜底, 未来时刻 不应出现)
      now - ts <= 5 分钟             → "刚刚"
      5 分钟 < diff <= 60 分钟       → "X 分钟前"
      1 小时 < diff <= 24 小时       → "X 小时前"
      1 天 < diff <= 2 天 (=今昨界) → "昨天"
      2 天 < diff <= 30 天           → "X 天前"
      > 30 天                       → "MM-DD" (eg "04-15")

    边界:
      now=None → 用 datetime.now(timezone.utc)
      tz-naive → 兜底 UTC (避免 caller 传 naive 时 crash)
    """
    if ts is None:
        return "暂无活动"

    if now is None:
        now = datetime.now(timezone.utc)

    # tz-aware 防御
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    delta_seconds = (now - ts).total_seconds()

    # 未来时刻 兜底 "刚刚" (不应出现, 但防 时钟漂移)
    if delta_seconds < 0:
        return "刚刚"

    # ≤ 5 分钟
    if delta_seconds <= 5 * 60:
        return "刚刚"

    # 5 分钟 ~ 60 分钟 — X 分钟前
    if delta_seconds < 60 * 60:
        minutes = int(delta_seconds // 60)
        return f"{minutes} 分钟前"

    # 1 小时 ~ 24 小时 — X 小时前
    if delta_seconds < 24 * 60 * 60:
        hours = int(delta_seconds // 3600)
        return f"{hours} 小时前"

    # 计算 天数差 (按日期边界, 不按 24 小时滚动)
    today = now.date()
    ts_date = ts.date()
    delta_days = (today - ts_date).days

    # 1 天前 (昨天)
    if delta_days <= 1:
        return "昨天"

    # 2 ~ 30 天
    if delta_days <= 30:
        return f"{delta_days} 天前"

    # > 30 天 — "MM-DD" 兜底
    return ts.strftime("%m-%d")


# ============================================================================
# T3 helper · group_insights_by_topic — AIInsight 按 meeting_id 分组
# ============================================================================
#
# SCHEMA §4.4 memory/snapshots 每条 是 "议题 group", 含 多个 insight.
# DB 端 AIInsight 没 topic 列 (只 topic_idx int), 所以 group key = meeting_id —
# 同一个会议 的所有 insight 算同一个 议题. caller 端 拿 Meeting.title 当 topic
# 文本显示.
#
# 边界:
#   meeting_id IS NULL 的 insight → 归 "orphan" key (跟 tasks/grouped 一致 sentinel).


_ORPHAN_TOPIC_KEY = "orphan"


def group_insights_by_topic(
    insights: Sequence[AIInsight],
) -> dict[str, list[AIInsight]]:
    """v1.4.0 Saga T3 · AIInsight list → { meeting_id: [insight, ...] } 分组.

    AIInsight 没 topic 列, 只能 用 meeting_id 当 group key.
    caller 端 拿 Meeting.title 当 topic 文本显示.

    特殊 key:
      "orphan" — meeting_id IS NULL 的 insight (老数据可能).

    顺序: dict 保留 输入顺序 (Python 3.7+ dict 保插入序). 排序 由 caller 端控.
    """
    grouped: dict[str, list[AIInsight]] = {}
    for ins in insights:
        if ins.meeting_id is None:
            key = _ORPHAN_TOPIC_KEY
        else:
            key = str(ins.meeting_id)
        grouped.setdefault(key, []).append(ins)
    return grouped
