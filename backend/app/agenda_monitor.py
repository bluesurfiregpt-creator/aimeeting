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


@dataclass
class AgendaSignal:
    kind: str  # off_topic | time_warning | stuck
    payload: dict


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
  "off_topic": true/false,
  "off_topic_summary": "<不超过 25 字, 描述大家在聊什么 vs 应该聊什么>",
  "current_agenda_item_idx": <最近 N 句最匹配的议程项 index, 从 0 开始; 都不匹配填 -1>,
  "suggested_agenda_item_idx": <若 off_topic, 应回到哪个议程项 index>,
  "time_warning": true/false,
  "time_warning_text": "<若 time_warning, 简短解释>",
  "stuck": true/false,
  "stuck_summary": "<若 stuck, 一句话写两边各坚持什么>",
  "reason": "<不超过 30 字的中文短句, 用于 banner 上展示>"
}

判断规则:
1. off_topic:近 5 句话题与当前议程项的 title / note 字段几乎不沾边, 且持续 ≥ 3 句 → true
2. 偶尔的离题闲谈(< 3 句)不算
3. time_warning:某议程项已用时间 / time_budget_min ≥ 0.8 时 → true (用时由调用方传入)
4. stuck (僵局):**最近 5+ 句**对话存在**重复立场**且**没新增论据** —— 几个人反复说同一件事但谁也说服不了谁,讨论原地打转 → true
   - 反例:有新数据 / 新方案出现 → false
   - 反例:正在快速达成共识(同意/接力) → false
5. **同一轮调用最多触发一种**,优先级 stuck > off_topic > time_warning
6. reason 必须**简短并对用户有意义**, 例如:
   - "在聊午餐安排, 议程是「合规风险评估」, 建议拉回"
   - "「数据出境讨论」预算 15 分钟已用 13, 建议推进下一项"
   - "邓西、王架构反复就「先做 A 还是 B」打转, 主持人介入收口"
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
        if len(rows) < 3:
            return  # not enough discussion to judge yet

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

    off_topic = bool(parsed.get("off_topic"))
    time_warning = bool(parsed.get("time_warning"))
    stuck = bool(parsed.get("stuck"))
    if not (off_topic or time_warning or stuck):
        return  # nothing to surface

    reason = (parsed.get("reason") or "").strip()[:80]

    # Pick which one to fire — only one banner per cycle so we don't spam.
    # Priority: stuck > off_topic > time_warning. Stuck is the strongest
    # actionable signal (people locked in disagreement), off_topic next,
    # time_warning is informational and softest.
    payload: dict = {
        "moderator_agent_id": str(moderator.id),
        "moderator_agent_name": moderator.name,
        "moderator_agent_color": moderator.color or "amber",
        "reason": reason or "议程进度需要关注",
    }
    if stuck:
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
    elif off_topic:
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
                "off_topic_summary": (parsed.get("off_topic_summary") or "")[:60],
                "current_agenda_item": cur_item,
                "suggested_agenda_item": sug_item,
            }
        )
    else:
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
                current_agenda_item=payload.get("current_agenda_item"),
                suggested_agenda_item=payload.get("suggested_agenda_item"),
                off_topic_summary=payload.get("off_topic_summary"),
            )
        elif payload["type"] == "agenda_stuck":
            audit_payload.update(
                stuck_summary=payload.get("stuck_summary"),
                auto_summon_after_s=payload.get("auto_summon_after_s"),
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
