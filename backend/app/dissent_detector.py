"""
Dissent detector — surfaces opposing views and routes them to a relevant
AI expert.

Per blueprint §1.2 + M2.3: when the system detects a budget/risk/policy
conflict between participants, it should *proactively* suggest the
expert most likely to help resolve it. Unlike the keyword/@-mention
triggers (agent_router.maybe_invoke_agents), this is an LLM-powered
classification — keyword heuristics for "不同意 / 但是 / 可是" produce
too many false positives in normal conversation.

Trigger model:
- runs after each finalized ASR sentence (fire-and-forget)
- per-meeting rate-limit: at most 1 detection every DETECT_INTERVAL_S
- after a dissent fires, SUPPRESS_AFTER_FIRE_S of cooldown to avoid
  pestering the user about the same conflict every other line

Detection model:
- pull last LOOKBACK_LINES of named transcript
- ask the active LLM to return a strict JSON: {has_dissent, parties,
  topic, suggested_domain, reason}
- if has_dissent and we can map suggested_domain → an Agent in this
  workspace, push a 'dissent_detected' WS event

Mapping:
- exact domain match wins (Agent.domain like "法务 · 合规" vs LLM's
  "法务"); we substring-match either direction
- fallback: pick the Agent whose keywords overlap the topic most
- final fallback: drop the signal silently
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
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import system_audit_log
from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, Meeting, MeetingTranscript, User

logger = logging.getLogger(__name__)


# v1.4.0 Phase A · 2 (NORTH_STAR § 6.1 · 痛点 1+6): 降阈值 + 加 lookback ——
# 让 dissent detector 跑 更勤 (15s 一次 vs 25s), fire 后 冷却 短 (45s vs 60s),
# 看 更多 上文 (10 行 vs 8 行 — 抓 中长 期 分歧, 不 只是 隔壁 两句对话).
LOOKBACK_LINES = 10        # was 8
DETECT_INTERVAL_S = 15     # was 25 — 让 LLM judge 跑 更勤
SUPPRESS_AFTER_FIRE_S = 45  # was 60 — fire 后 冷却 短一些


@dataclass
class DissentSignal:
    topic: str
    parties: list[str]
    suggested_agent_id: uuid.UUID
    suggested_agent_name: str
    suggested_agent_color: str
    reason: str


# Per-meeting cooldown state. Lives only in-process; acceptable since
# detection is best-effort and the user can also @-mention manually.
_cooldown: dict[uuid.UUID, dict[str, float]] = {}


def _can_run(meeting_id: uuid.UUID) -> bool:
    s = _cooldown.get(meeting_id) or {}
    now = time.monotonic()
    if (s.get("last_run", 0.0) + DETECT_INTERVAL_S) > now:
        return False
    if (s.get("last_fire", 0.0) + SUPPRESS_AFTER_FIRE_S) > now:
        return False
    return True


def _mark_run(meeting_id: uuid.UUID) -> None:
    s = _cooldown.setdefault(meeting_id, {})
    s["last_run"] = time.monotonic()


def _mark_fire(meeting_id: uuid.UUID) -> None:
    s = _cooldown.setdefault(meeting_id, {})
    s["last_fire"] = time.monotonic()


_SYSTEM_PROMPT = """你是会议主持人。检测最近 N 句对话中是否存在**两位或以上参会人就同一话题持对立观点**的分歧。

**严格 JSON 单行**输出, 不要包代码块, 不要任何其他文字:
{
  "has_dissent": true/false,
  "topic": "<不超过 30 字, 形容核心争议>",
  "parties": ["<参与者 A>", "<参与者 B>"],
  "suggested_domain": "<法务 | 产品 | 架构 | 项目推进 | 财务 | 其他>",
  "reason": "<不超过 25 字的中文短句, 用于在 banner 上向用户解释>"
}

判断规则:
1. **必须**是同一话题上不同立场, 不是简单问答或补充。
2. 单独一个人发问/犹豫不算分歧。
3. 同意/接力(如"对", "我也这么想")不算分歧。
4. 时间线短(< 3 句)、没明确对立的不算分歧。
5. 如果没分歧, has_dissent=false 即可, 其他字段留空字符串或空数组。
6. suggested_domain 选最适合**仲裁**这一争议的领域:
   - 涉及合规/数据/采购 → 法务
   - 涉及用户价值/产品方向/优先级 → 产品
   - 涉及技术选型/性能/架构 → 架构
   - 涉及交付/排期/责任人 → 项目推进
   - 涉及预算/成本 → 财务
   - 不属于上面任何一个 → 其他
7. reason 必须**口语化**, 例如:
   "邓西要先做声纹, 幸世杰要先做 AI 专家, 听听产品的"
   "在数据出境上看法不同, 转给法务"
"""


async def maybe_detect_dissent(
    meeting_id: uuid.UUID,
    *,
    on_message: Callable[[dict], Awaitable[None]],
    force: bool = False,
) -> Optional[dict]:
    """
    Fire-and-forget detection driven by each finalized transcript line.
    Caller does NOT need to await — errors are swallowed and logged.

    `force=True` (M3.0.x) bypasses the rate-limit + cooldown so the dev
    endpoint `POST /api/meetings/{id}/dissent-detector/run-now` can drive
    the same logic synchronously for tests.

    Returns the banner payload that was emitted (None when nothing fired).
    """
    if not force and not _can_run(meeting_id):
        return None
    _mark_run(meeting_id)

    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(MeetingTranscript)
                .where(MeetingTranscript.meeting_id == meeting_id)
                .order_by(MeetingTranscript.id.desc())
                .limit(LOOKBACK_LINES)
            )
        ).scalars().all()
        rows = list(reversed(rows))
        # Need at least 3 lines and at least 2 distinct named speakers
        named = [r for r in rows if r.speaker_user_id]
        if len(named) < 3:
            return
        speakers = {r.speaker_user_id for r in named}
        if len(speakers) < 2:
            return

        user_ids = list(speakers)
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}

        agents = (
            await db.execute(
                select(Agent).where(Agent.is_active.is_(True))
            )
        ).scalars().all()
        # Workspace-scope agents by going through one of the speakers'
        # workspace (all attendees share a workspace).
        sample_user = users[0] if users else None
        if sample_user and sample_user.workspace_id:
            agents = [a for a in agents if a.workspace_id == sample_user.workspace_id]
        if not agents:
            return

        provider = await get_active_provider(db)
    if provider is None:
        return

    transcript_block = "\n".join(
        f"{(name_by_id.get(r.speaker_user_id) if r.speaker_user_id else '未识别')}: {r.text}"
        for r in rows
    )
    domains_offered = sorted({(a.domain or "").split(" ")[0] or a.name for a in agents})
    user_prompt = (
        f"最近 {len(rows)} 句对话:\n{transcript_block}\n\n"
        f"本工作空间可用的领域专家覆盖: {', '.join(domains_offered)}"
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
        logger.exception("dissent_detector LLM call failed")
        return

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if not parsed or not parsed.get("has_dissent"):
        return

    parties = parsed.get("parties") or []
    if not isinstance(parties, list) or len(parties) < 2:
        return
    topic = (parsed.get("topic") or "").strip()
    suggested_domain = (parsed.get("suggested_domain") or "").strip()
    reason = (parsed.get("reason") or "").strip() or "检测到分歧, 听听专家意见"

    chosen = _pick_agent(agents, suggested_domain, topic)
    if chosen is None:
        return

    _mark_fire(meeting_id)
    logger.info("dissent fired in meeting %s -> %s (%s)", meeting_id, chosen.name, topic)

    # v11 ISSUE-2: write an audit row so REST-only callers (Cowork) can
    # verify the detector fired without subscribing to the live WS.
    # Look up workspace_id from the meeting (we already have a fresh DB
    # session inside the call site below). Best-effort — failures are
    # swallowed by system_audit_log itself.
    try:
        async with SessionLocal() as audit_db:
            m_row = (
                await audit_db.execute(select(Meeting).where(Meeting.id == meeting_id))
            ).scalar_one_or_none()
            ws_id = m_row.workspace_id if m_row is not None else None
        async with SessionLocal() as audit_db:
            await system_audit_log(
                audit_db,
                ws_id,
                "dissent.detected",
                target_type="meeting",
                target_id=str(meeting_id),
                payload={
                    "topic": topic[:80],
                    "parties": [str(p)[:32] for p in parties[:4]],
                    "suggested_agent_id": str(chosen.id),
                    "suggested_agent_name": chosen.name,
                    "reason": reason[:80],
                },
            )
    except Exception:
        logger.exception("dissent audit write failed (non-fatal)")

    payload_out = {
        "type": "dissent_detected",
        "topic": topic[:40],
        "parties": [str(p)[:32] for p in parties[:4]],
        "suggested_agent_id": str(chosen.id),
        "suggested_agent_name": chosen.name,
        # v26.12-Home: 前端 banner 优先 显 nickname (拟人感)
        "suggested_agent_nickname": chosen.nickname,
        "suggested_agent_color": chosen.color or "rose",
        "reason": reason[:80],
    }
    await on_message(payload_out)
    return payload_out


def _pick_agent(
    agents: list[Agent], suggested_domain: str, topic: str
) -> Optional[Agent]:
    sd = suggested_domain.lower()
    # 1) substring match on domain
    for a in agents:
        if not a.domain:
            continue
        d = a.domain.lower()
        if sd and (sd in d or d in sd):
            return a
    # 2) keyword overlap on topic
    topic_lower = topic.lower()
    best, best_hits = None, 0
    for a in agents:
        if not a.keywords:
            continue
        hits = sum(1 for k in a.keywords if k and k.lower() in topic_lower)
        if hits > best_hits:
            best, best_hits = a, hits
    if best is not None and best_hits >= 1:
        return best
    return None


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
