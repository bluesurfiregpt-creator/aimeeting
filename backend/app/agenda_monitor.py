"""
Agenda monitor — the M3.0 self-driving meeting moderator.

When a meeting has `agenda` set, this module watches the transcript drift
and time pacing in the background. It can fire three kinds of WS banners,
all routed through the workspace's built-in `moderator` Agent so the user
can one-click summon the moderator to actually intervene:

- **agenda_off_topic** — discussion has drifted from the current agenda
  item for ≥ ~2 minutes
- **agenda_time_warning** — current item's time budget is ≥ 80% spent
- **agenda_stuck** — last 5 lines repeat positions without new info
  (deferred to a future sprint; the LLM signal exists but not yet wired)

Trigger model (mirrors dissent_detector for consistency):
- runs after each finalized transcript line (ASR or manual)
- per-meeting rate-limit: at most 1 LLM check every CHECK_INTERVAL_S
- after a banner fires, COOLDOWN_S of silence to avoid pestering
- the LLM call is skipped entirely when meeting.agenda is empty

The actual moderator Agent intervention (summary / steering message) is a
SEPARATE step — the banner just *suggests*, the user clicks 召唤主持人 to
trigger `invoke_agent_directly` against the moderator (which then uses its
moderator-specific persona to produce a 1-2 sentence steering reply).
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from sqlalchemy import select

from .audit import system_audit_log
from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, Meeting, MeetingTranscript, User

logger = logging.getLogger(__name__)


LOOKBACK_LINES = 12
CHECK_INTERVAL_S = 60       # at most 1 LLM check / 60s / meeting
COOLDOWN_S = 90             # after a banner fires, suppress for 90s

# v26.14-P4.2: 偏题 触发 阈值 — 至少 N 条 *valid* (post-filter) 连续行 才 LLM 判.
# 老 是 任何 3 条 finalized 行 (含 嗯啊/单字反应) → 误报 多.
MIN_VALID_LINES = 3

# v26.14-P4.2: 口头禅 / 短反应 — 仅由 这些 字符 组成 (含 标点) 的 行 → 低信息密度.
# 不是 黑名单 而是 "整行 都 是 这些" 才 滤. "嗯, 我 觉得 A" 仍 保留.
_FILLER_TOKENS = set("嗯啊呃哦哎喂咳呀诶嗨好对错是的不行那个这个那么这么")
_PUNCT_AND_SPACE = set("., 。,;;:::、!!??""''「」()()… 　\t\n\r")


@dataclass
class AgendaSignal:
    kind: str  # off_topic | time_warning | stuck
    payload: dict


def _is_low_signal_line(text: str) -> bool:
    """v26.14-P4.2: 一行 是否 是 低信息密度 (口头禅 / 短反应 / 单字).

    True 时 该行 不计入 偏题 触发 阈值. LLM 仍会 看到 它 (上下文), 但 不 单独 计数.

    判 规则:
      a) 去 标点 空格 后 < 4 字符 → True
      b) 去 标点 空格 后 全 由 _FILLER_TOKENS 组成 → True (例: "嗯嗯" "好的" "对对对")
    """
    if not text:
        return True
    # 去 标点 + 空格
    stripped = "".join(c for c in text if c not in _PUNCT_AND_SPACE)
    if len(stripped) < 4:
        return True
    if all(c in _FILLER_TOKENS for c in stripped):
        return True
    return False


def _count_consecutive_valid(rows: list) -> int:
    """v26.14-P4.2: 从 末尾 倒数 连续 多少 条 是 valid (非 低信息密度).

    遇到 第一条 低信息密度 行 就 停 — 计数 是 "尾部 连续" 而非 总数.
    这样 一段 闲扯 中间 出现 一句 干货 会 重置 计数, 避免 误报.
    """
    n = 0
    for r in reversed(rows):
        if _is_low_signal_line(r.text or ""):
            break
        n += 1
    return n


# Per-meeting cooldown state (in-process; same caveat as dissent_detector).
_cooldown: dict[uuid.UUID, dict[str, float]] = {}


def _can_run(meeting_id: uuid.UUID) -> bool:
    s = _cooldown.get(meeting_id) or {}
    now = time.monotonic()
    if (s.get("last_run", 0.0) + CHECK_INTERVAL_S) > now:
        return False
    if (s.get("last_fire", 0.0) + COOLDOWN_S) > now:
        return False
    return True


def _mark_run(meeting_id: uuid.UUID) -> None:
    s = _cooldown.setdefault(meeting_id, {})
    s["last_run"] = time.monotonic()


def _mark_fire(meeting_id: uuid.UUID) -> None:
    s = _cooldown.setdefault(meeting_id, {})
    s["last_fire"] = time.monotonic()


_SYSTEM_PROMPT = """你是这场会议的主持人助理。会议有事先约定的议程,请评估当前讨论的状态。

**严格 JSON 单行**输出, 不要包代码块, 不要任何其他文字:
{
  "off_topic_severity": "none" | "suspected" | "confirmed" | "severe",
  "off_topic_summary": "<不超过 25 字, 描述大家在聊什么 vs 应该聊什么>",
  "current_agenda_item_idx": <最近 N 句最匹配的议程项 index, 从 0 开始; 都不匹配填 -1>,
  "suggested_agenda_item_idx": <若 off_topic, 应回到哪个议程项 index>,
  "time_warning": true/false,
  "time_warning_text": "<若 time_warning, 简短解释>",
  "stuck": true/false,
  "stuck_summary": "<若 stuck, 一句话写两边各坚持什么>",
  "should_advance": true/false,
  "advance_reason": "<若 should_advance, 不超过 30 字, 说明 为什么 该 进 下一项>",
  "reason": "<不超过 30 字的中文短句, 用于 banner 上展示>"
}

判断规则:

【off_topic_severity 三级 — v26.14-P4.2】
评估 最近 N 句 跟 当前 议程项 (title + note) 的 偏离度, 分 4 档:

- "none":整体 在 议程 范围内. 偶尔 一两句 闲扯 不算 偏题.
- "suspected" (轻度怀疑):**3-4 句** 开始 偏离, 但 还 跟 议程 主题 有 弱关联
  (例: 议程 是 "合规风险" 在 聊 同部门 的 别项目 经验). 用户 还 可能 自己 拐回来.
- "confirmed" (确认偏离):**5+ 句** 完全 跟 议程 不沾边, 但 不 紧迫
  (例: 议程 是 "合规风险" 在 聊 周末 团建).
- "severe" (严重偏题):**8+ 句** 完全 偏离 + 占用 议程 大量 时间 (elapsed 跟 议程 总预算 的 比 已 超 50%)
  (例: 议程 是 "数据出境" 整场 在 聊 别公司 的 八卦, 主持人 必须 立刻 介入).

【其他 信号】
- time_warning:某议程项 已用 时间 / time_budget_min ≥ 0.8 时 → true (用时 由 调用方 传入)
- stuck (僵局):**最近 5+ 句** 对话 存在 **重复立场** 且 **没新增论据** —— 几个人 反复说 同一件事 但 谁也 说服不了 谁, 讨论 原地 打转 → true
   - 反例:有 新数据 / 新方案 出现 → false
   - 反例:正在 快速 达成 共识 (同意/接力) → false

【should_advance — v26.14-P5.3】
当前 议程项 是否 看起来 **该 推进 到 下一项** 了, 满足 下列 任一 → true:
1. 出现 **总结性 发言** ("那这件事 就 这么 定了" / "OK 没问题" / "我们 就 按 X 来")
2. 出现 **决议性 发言** ("通过" / "下一项" / "可以 收 这个 议题 了")
3. 议程项 已用 时间 ≥ 100% 预算 (overtime), 且 没有 新 推进 意见
4. 长时间 (≥ 60s 内) 全员 沉默 / 无人 接话
反例:
- 仍 在 激烈 讨论 + 出 新观点 → false
- 时间 还 充裕 + 没 收尾 信号 → false

advance_reason 必须 简短 中文, 例:
- "已达成 共识 '按 A 方案 走', 可推进"
- "议程 1 用时 16/15min 超时, 没 新 推进, 建议 进下一项"
- "全员 沉默 1 分钟, 此项 似 已 没有 讨论"

【优先级】
- **同一轮 调用 最多 触发 一种**
- stuck > off_topic_severity ≥ "confirmed" > should_advance > time_warning > off_topic_severity == "suspected"
- 即:suspected 是 最弱 信号; should_advance 仅在 没 偏题 / 没 stuck 时 才触发

【reason 要求】
- 简短 + 对 用户 有意义, 例如:
   - "在聊 午餐 安排, 议程 是「合规风险评估」, 建议 拉回"
   - "「数据出境讨论」预算 15 分钟 已用 13, 建议 推进 下一项"
   - "邓西、王架构 反复就「先做 A 还是 B」打转, 主持人 介入 收口"
"""


async def maybe_check_agenda(
    meeting_id: uuid.UUID,
    *,
    on_message: Callable[[dict], Awaitable[None]],
    force: bool = False,
) -> Optional[dict]:
    """
    Fire-and-forget agenda check driven by each finalized transcript line.
    Caller does NOT need to await — errors are swallowed and logged.

    `force=True` (per v11 ISSUE-4) bypasses the rate-limit + cooldown so
    the dev endpoint `POST /api/meetings/{id}/agenda-monitor/run-now`
    can drive the same logic synchronously for tests.

    Returns the banner payload that was emitted (None if nothing fired).
    """
    if not force and not _can_run(meeting_id):
        return None
    _mark_run(meeting_id)

    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if m is None or not m.agenda:
            return  # no meeting, or meeting has no agenda → no-op

        rows = (
            await db.execute(
                select(MeetingTranscript)
                .where(MeetingTranscript.meeting_id == meeting_id)
                .order_by(MeetingTranscript.id.desc())
                .limit(LOOKBACK_LINES)
            )
        ).scalars().all()
        rows = list(reversed(rows))
        if len(rows) < MIN_VALID_LINES:
            return  # not enough discussion to judge yet

        # v26.14-P4.2: 偏题 触发 阈值 — 至少 N 条 *valid* 连续行 (尾部).
        # 老 是 "任何 3 条 finalized 行" → 嗯啊/单字反应 也 算, 误报 多.
        # 改 后 一条 干货 也能 重置 计数, 避免 短反应 触发 误报.
        consecutive_valid = _count_consecutive_valid(rows)
        if consecutive_valid < MIN_VALID_LINES:
            logger.debug(
                "agenda_monitor skipped meeting %s: only %d consecutive valid lines (need %d)",
                meeting_id, consecutive_valid, MIN_VALID_LINES,
            )
            return

        user_ids = {r.speaker_user_id for r in rows if r.speaker_user_id}
        name_by_id: dict[uuid.UUID, str] = {}
        if user_ids:
            users = (
                await db.execute(select(User).where(User.id.in_(user_ids)))
            ).scalars().all()
            name_by_id = {u.id: u.name for u in users}

        # Find the moderator agent (auto-created per workspace by init_db).
        # If the workspace lost it somehow, give up silently rather than 500.
        moderator: Agent | None = None
        if m.workspace_id is not None:
            moderator = (
                await db.execute(
                    select(Agent).where(
                        Agent.workspace_id == m.workspace_id,
                        Agent.role == "moderator",
                        Agent.is_active.is_(True),
                    )
                )
            ).scalar_one_or_none()
        if moderator is None:
            logger.warning("no moderator agent for meeting %s; skipping monitor", meeting_id)
            return

        provider = await get_active_provider(db)
        if provider is None:
            return

        # Wall-clock minutes elapsed since meeting started — for time_warning.
        meeting_started_at = m.started_at or m.created_at
        elapsed_min = 0
        if meeting_started_at is not None:
            from datetime import datetime, timezone
            elapsed_min = int(
                (datetime.now(timezone.utc) - meeting_started_at).total_seconds() / 60
            )

    transcript_block = "\n".join(
        f"{(name_by_id.get(r.speaker_user_id) if r.speaker_user_id else '未识别')}: {r.text}"
        for r in rows
    )

    agenda_summary = "\n".join(
        f"  [{i}] {(item.get('title') or '').strip()}"
        + (
            f" (预算 {item['time_budget_min']} 分钟)"
            if item.get("time_budget_min")
            else ""
        )
        + (
            f" — 备注: {item['note']}"
            if item.get("note")
            else ""
        )
        for i, item in enumerate(m.agenda or [])
    )

    user_prompt = (
        f"会议议程:\n{agenda_summary}\n\n"
        f"已开会 {elapsed_min} 分钟。\n\n"
        f"最近 {len(rows)} 句对话:\n{transcript_block}"
    )

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("agenda_monitor LLM call failed")
        return

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if not parsed:
        return

    # v26.14-P4.2: 老 schema 是 off_topic: bool, 新 schema 是 off_topic_severity: 4 档.
    # 兼容: 若 LLM 返 老 字段 (off_topic=true) 也 视为 confirmed, 不让 老模型 突然 哑掉.
    raw_severity = parsed.get("off_topic_severity")
    if raw_severity in ("none", "suspected", "confirmed", "severe"):
        off_topic_severity = raw_severity
    elif parsed.get("off_topic") is True:
        off_topic_severity = "confirmed"
    else:
        off_topic_severity = "none"
    off_topic_active = off_topic_severity != "none"

    time_warning = bool(parsed.get("time_warning"))
    stuck = bool(parsed.get("stuck"))
    should_advance = bool(parsed.get("should_advance"))
    if not (off_topic_active or time_warning or stuck or should_advance):
        return  # nothing to surface

    reason = (parsed.get("reason") or "").strip()[:80]

    # Pick which one to fire — only one banner per cycle so we don't spam.
    # v26.14-P5.3 优先级:
    #   stuck > off_topic(confirmed/severe) > should_advance > time_warning > off_topic(suspected)
    # should_advance 比 time_warning 强 — 推进 是 主动 引路, time_warning 仅 是 提醒.
    payload: dict = {
        "moderator_agent_id": str(moderator.id),
        "moderator_agent_name": moderator.name,
        # v26.12-Home: 前端 banner 优先 显 nickname (拟人感)
        "moderator_agent_nickname": moderator.nickname,
        "moderator_agent_color": moderator.color or "amber",
        "reason": reason or "议程进度需要关注",
    }

    # 决策 树: 显式 算 一遍 才 不会 漏 case
    fire_type: str
    is_strong_off_topic = off_topic_severity in ("confirmed", "severe")
    if stuck:
        fire_type = "stuck"
    elif is_strong_off_topic:
        fire_type = "off_topic"
    elif should_advance:
        fire_type = "advance_suggested"
    elif time_warning:
        fire_type = "time_warning"
    elif off_topic_severity == "suspected":
        fire_type = "off_topic"
    else:
        return  # 不该 到 这里 (上面 已 return), 防御性

    if fire_type == "stuck":
        payload.update(
            {
                "type": "agenda_stuck",
                "stuck_summary": (parsed.get("stuck_summary") or "")[:80],
                # M3.0.4: client renders this banner with a 5s countdown that
                # auto-summons the moderator if the user does nothing — a
                # tighter loop than off_topic which just sits there.
                "auto_summon_after_s": 5,
            }
        )
    elif fire_type == "off_topic":
        cur_idx = parsed.get("current_agenda_item_idx")
        sug_idx = parsed.get("suggested_agenda_item_idx")
        cur_item = (
            (m.agenda or [])[cur_idx].get("title")
            if isinstance(cur_idx, int) and 0 <= cur_idx < len(m.agenda or [])
            else None
        )
        sug_item = (
            (m.agenda or [])[sug_idx].get("title")
            if isinstance(sug_idx, int) and 0 <= sug_idx < len(m.agenda or [])
            else None
        )
        payload.update(
            {
                "type": "agenda_off_topic",
                # v26.14-P4.2: 三级 严重度 — 前端 P4.3 据此 渲 轻/强/全屏 modal
                "off_topic_severity": off_topic_severity,  # suspected | confirmed | severe
                "off_topic_summary": (parsed.get("off_topic_summary") or "")[:60],
                "current_agenda_item": cur_item,
                "suggested_agenda_item": sug_item,
                # severe 严重时 自动 summon 倒计时 (像 stuck), 让 用户 不点 也 会 介入
                "auto_summon_after_s": 8 if off_topic_severity == "severe" else None,
            }
        )
    elif fire_type == "advance_suggested":
        # v26.14-P5.3: LLM 判 当前 项 似乎 已 收口, 建议 推进 下一项. 前端 渲 一个
        # 主持人 banner + "推进" 按钮 (controller 见) + "稍后" (任何人 见).
        # 当前 项 / 下一项 title (供 banner 显, 让 用户 一眼 看清 "从 X → Y")
        cur_idx = parsed.get("current_agenda_item_idx")
        cur_item = (
            (m.agenda or [])[cur_idx].get("title")
            if isinstance(cur_idx, int) and 0 <= cur_idx < len(m.agenda or [])
            else None
        )
        next_idx = (cur_idx + 1) if isinstance(cur_idx, int) and cur_idx >= 0 else None
        next_item = (
            (m.agenda or [])[next_idx].get("title")
            if next_idx is not None and 0 <= next_idx < len(m.agenda or [])
            else None
        )
        payload.update(
            {
                "type": "agenda_advance_suggested",
                "advance_reason": (parsed.get("advance_reason") or "")[:80],
                "current_agenda_item": cur_item,
                "next_agenda_item": next_item,
                "current_agenda_idx": cur_idx if isinstance(cur_idx, int) else None,
                "next_agenda_idx": next_idx,
            }
        )
    else:  # time_warning
        payload.update(
            {
                "type": "agenda_time_warning",
                "time_warning_text": (parsed.get("time_warning_text") or "")[:60],
                "elapsed_min": elapsed_min,
            }
        )

    _mark_fire(meeting_id)
    logger.info("agenda_monitor fired %s in meeting %s: %s", payload["type"], meeting_id, reason)

    # v11 ISSUE-2: audit row so REST-only callers can verify the trigger
    # fired even without subscribing to the live WS.
    try:
        # Per-type audit payload shape — all have reason + moderator id, then
        # type-specific fields layered on top.
        audit_payload: dict = {
            "reason": reason[:80],
            "moderator_agent_id": payload.get("moderator_agent_id"),
        }
        if payload["type"] == "agenda_off_topic":
            audit_payload.update(
                # v26.14-P4.2: 严重度 也 落 audit, 方便 后续 分析 误报率
                off_topic_severity=payload.get("off_topic_severity"),
                current_agenda_item=payload.get("current_agenda_item"),
                suggested_agenda_item=payload.get("suggested_agenda_item"),
                off_topic_summary=payload.get("off_topic_summary"),
                auto_summon_after_s=payload.get("auto_summon_after_s"),
            )
        elif payload["type"] == "agenda_stuck":
            audit_payload.update(
                stuck_summary=payload.get("stuck_summary"),
                auto_summon_after_s=payload.get("auto_summon_after_s"),
            )
        elif payload["type"] == "agenda_advance_suggested":
            # v26.14-P5.3: 推进 建议 audit — 后续 可统计 LLM 给的 建议 用户 接受率
            audit_payload.update(
                advance_reason=payload.get("advance_reason"),
                current_agenda_item=payload.get("current_agenda_item"),
                next_agenda_item=payload.get("next_agenda_item"),
                current_agenda_idx=payload.get("current_agenda_idx"),
                next_agenda_idx=payload.get("next_agenda_idx"),
            )
        else:  # agenda_time_warning
            audit_payload.update(
                elapsed_min=payload.get("elapsed_min"),
                time_warning_text=payload.get("time_warning_text"),
            )
        async with SessionLocal() as audit_db:
            await system_audit_log(
                audit_db,
                m.workspace_id,
                f"agenda.{payload['type']}",
                target_type="meeting",
                target_id=str(meeting_id),
                payload=audit_payload,
            )
    except Exception:
        logger.exception("agenda audit write failed (non-fatal)")

    await on_message(payload)
    return payload


def _safe_parse_json_obj(raw: str) -> Optional[dict]:
    if not raw:
        return None
    if raw.startswith("```"):
        m = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
        if m:
            raw = m.group(1)
    s = raw.find("{")
    e = raw.rfind("}")
    if s == -1 or e == -1 or e <= s:
        return None
    try:
        parsed = json.loads(raw[s : e + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
