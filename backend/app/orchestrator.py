"""
Multi-agent orchestrator (V1 — recommendation only).

Per the Phase 3 启动会 decision: V1 just *suggests* who should speak next.
The user always confirms via a click. V2 (Phase 3 末) may add full
auto-relay; we deliberately stop short of that here to keep the meeting
under user control.

Flow:
  agent A finishes speaking
    → recommend_next_speaker(...) classifies the conversation tail
    → if a relevant other agent is found, return (agent_id, reason)
    → caller pushes a WS event the front-end renders as a soft banner

The classifier is a single LLM call with all candidate agents'
name/domain/keywords inlined as a small JSON catalog. Output is forced to
one JSON line so we can parse without fluff. We deliberately allow
"no recommendation" as a valid output — better silent than wrong.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, MeetingAttendee, MeetingTranscript, User

logger = logging.getLogger(__name__)


CONTEXT_WINDOW_LINES = 8


@dataclass
class Recommendation:
    agent_id: uuid.UUID
    agent_name: str
    agent_color: str
    reason: str
    # v26.12-Home: 拟人外号 (可空). 前端 banner 优先 显 nickname.
    agent_nickname: str | None = None


_SYSTEM_PROMPT = """你是会议主持人。一位 AI 专家刚发言完毕,现在需要你**判断**接下来由哪位 AI 专家接着说最合适。

输入:
- 最近的会议对话片段(谁说了什么)
- 上一位 AI 专家的发言全文
- 候选的 AI 专家列表(name / domain / keywords)

输出**严格**的单行 JSON, 不要包代码块, 不要任何其他文字:
{"agent_id": "<uuid 或 null>", "reason": "<不超过 25 字的中文短句>"}

判断规则:
1. 上一位专家提出了**对应另一专家领域**的问题 / 风险 / 建议 → 推荐那位专家接力
   (如:产品专家提出"合规风险"→ 推荐法务专家;架构专家提出"成本要算"→ 推荐项目推进专家)
2. 当前讨论已收敛, 用户应该回应 → agent_id=null
3. 上一位专家的发言只是回答一个具体问题, 没有新的延伸 → agent_id=null
4. 候选列表里没有合适的专家 → agent_id=null
5. 不要推荐**刚发完言**的那位专家自己

reason 必须**简短并对用户有意义**, 例如:
- "邓西提到合规风险, 听听法务的"
- "技术方案需要评估成本, 转给项目推进"
- "讨论已收敛, 等待人决策"  (此时 agent_id=null)

绝对不要编造不在候选列表里的 agent。"""


async def recommend_next_speaker(
    meeting_id: uuid.UUID,
    *,
    just_finished_agent_id: uuid.UUID,
    just_finished_agent_text: str,
) -> Optional[Recommendation]:
    """
    Look at the last few transcript lines + the agent's reply, ask the
    active LLM whether another agent's perspective would naturally
    follow, and return that recommendation. None means "stay quiet".
    """
    async with SessionLocal() as db:
        # All eligible agents in this workspace (active, present in this
        # meeting OR the global pool — same logic as _agents_for_meeting)
        attendee_agent_rows = (
            await db.execute(
                select(MeetingAttendee.agent_id).where(
                    MeetingAttendee.meeting_id == meeting_id,
                    MeetingAttendee.agent_id.is_not(None),
                )
            )
        ).all()
        attendee_agent_ids = [r[0] for r in attendee_agent_rows]
        if attendee_agent_ids:
            agents = (
                await db.execute(
                    select(Agent).where(
                        Agent.id.in_(attendee_agent_ids),
                        Agent.is_active.is_(True),
                    )
                )
            ).scalars().all()
        else:
            agents = (
                await db.execute(
                    select(Agent).where(Agent.is_active.is_(True))
                )
            ).scalars().all()

        # Drop the agent that just finished — we want a *different* speaker
        candidates = [a for a in agents if a.id != just_finished_agent_id]
        if not candidates:
            return None

        context = await _build_context(meeting_id, db)
        provider = await get_active_provider(db)

    if provider is None:
        return None

    catalog = [
        {
            "agent_id": str(a.id),
            "name": a.name,
            "domain": a.domain or "",
            "keywords": a.keywords or [],
        }
        for a in candidates
    ]

    user_prompt = (
        f"会议最近 {CONTEXT_WINDOW_LINES} 句:\n{context or '(无)'}\n\n"
        f"上一位 AI 专家的发言:\n{just_finished_agent_text}\n\n"
        f"候选专家:\n{json.dumps(catalog, ensure_ascii=False)}"
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
        logger.exception("orchestrator LLM call failed")
        return None

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if not parsed:
        return None
    aid_raw = parsed.get("agent_id")
    if aid_raw in (None, "null", "", "None"):
        return None
    try:
        aid = uuid.UUID(str(aid_raw))
    except ValueError:
        return None
    target = next((a for a in candidates if a.id == aid), None)
    if target is None:
        # LLM hallucinated an agent_id outside the catalog
        return None
    reason = (parsed.get("reason") or "").strip()[:80] or "建议接力"

    return Recommendation(
        agent_id=target.id,
        agent_name=target.name,
        agent_nickname=target.nickname,  # v26.12-Home
        agent_color=target.color or "violet",
        reason=reason,
    )


async def _build_context(meeting_id: uuid.UUID, db: AsyncSession) -> str:
    rows = (
        await db.execute(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == meeting_id)
            .order_by(MeetingTranscript.id.desc())
            .limit(CONTEXT_WINDOW_LINES)
        )
    ).scalars().all()
    rows = list(reversed(rows))
    user_ids = {r.speaker_user_id for r in rows if r.speaker_user_id}
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_id = {u.id: u.name for u in users}
    return "\n".join(
        f"{(name_by_id.get(r.speaker_user_id) if r.speaker_user_id else '未识别')}: {r.text}"
        for r in rows
    )


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
