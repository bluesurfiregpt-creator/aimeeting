"""
Agent invocation router for in-meeting AI participation.

Per blueprint §3.2 the router decides *when* and *which* agent speaks. Phase
B starts with two simple triggers:

1. **@-mention** — the user explicitly addresses an agent ("@产品专家 帮我看一下…")
2. **Keyword hit** — the agent's configured keywords appear in the recent
   context (e.g. an agent tagged with "合规, 风险" auto-joins when "合规风险"
   shows up)

A few guard-rails:
- Per-meeting rate-limit (max 1 invocation per 15s, then ≤ 1 per agent per
  60s) so agents don't bury the conversation.
- We pass the LAST CONTEXT_WINDOW_LINES of named transcript to Dify as
  `meeting_context` (so the agent "knows what was said") plus the trigger
  query as `query`.
- Agent persona / tone / boundary fields are joined into Dify's system prompt
  via the agent's app config, NOT here. We just hand Dify the context.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .dify_client import DifyClient, DifyError
from .models import Agent, MeetingAgentMessage, MeetingAttendee, MeetingTranscript, User

logger = logging.getLogger(__name__)

CONTEXT_WINDOW_LINES = 12
MIN_GAP_MEETING_S = 8       # don't spam: any agent at most every 8s overall
MIN_GAP_PER_AGENT_S = 30    # same agent at most every 30s
MAX_TEXT_LEN = 800          # Dify response truncation guard


@dataclass
class _RateState:
    last_at_meeting: float = 0.0
    last_at_per_agent: dict[uuid.UUID, float] = field(default_factory=dict)


# In-memory per-meeting rate state. Lives only as long as the WS does;
# acceptable for Phase 1.5 single-process backend.
_rate: dict[uuid.UUID, _RateState] = {}


def _detect_at_mention(text: str, agents: list[Agent]) -> Optional[Agent]:
    """Return the first agent whose name appears as @<name> in `text`."""
    for ag in agents:
        if not ag.name:
            continue
        # Tolerate Chinese full-width @ and a few common typo forms.
        # The agent name may contain spaces; match exactly.
        pattern = re.compile(rf"[@＠]\s*{re.escape(ag.name)}", re.IGNORECASE)
        if pattern.search(text):
            return ag
    return None


def _detect_keyword(text: str, agents: list[Agent]) -> Optional[Agent]:
    for ag in agents:
        if not ag.keywords:
            continue
        for kw in ag.keywords:
            if kw and kw.strip() and kw in text:
                return ag
    return None


async def _build_context(meeting_id: uuid.UUID, db: AsyncSession) -> str:
    """Fetch the last CONTEXT_WINDOW_LINES of transcript + speaker names."""
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

    lines: list[str] = []
    for r in rows:
        speaker = name_by_id.get(r.speaker_user_id) if r.speaker_user_id else "未识别"
        lines.append(f"{speaker}: {r.text}")
    return "\n".join(lines)


async def maybe_invoke_agents(
    meeting_id: uuid.UUID,
    new_text: str,
    *,
    on_message: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Called by the WS handler after each finalized ASR sentence. Inspects
    the new text against active agents bound to this meeting, picks at most
    one agent (priority: @-mention > keyword), and (if triggered, and within
    rate limits) invokes the agent's Dify app and streams a response back.
    """
    state = _rate.setdefault(meeting_id, _RateState())
    now = time.monotonic()
    if now - state.last_at_meeting < MIN_GAP_MEETING_S:
        return  # global rate limit

    async with SessionLocal() as db:
        # active agents that are attendees of this meeting
        attendee_agent_ids = (
            await db.execute(
                select(MeetingAttendee.agent_id).where(
                    MeetingAttendee.meeting_id == meeting_id,
                    MeetingAttendee.agent_id.is_not(None),
                )
            )
        ).all()
        agent_ids = [r[0] for r in attendee_agent_ids]
        if not agent_ids:
            # Phase 1.5 fallback: if no agents are explicitly invited, allow
            # any active agent that has a Dify key set. Lets users try @ even
            # when they didn't tick the box on the new-meeting screen.
            agents = (
                await db.execute(
                    select(Agent).where(
                        Agent.is_active.is_(True),
                        Agent.dify_api_key.is_not(None),
                    )
                )
            ).scalars().all()
        else:
            agents = (
                await db.execute(
                    select(Agent).where(
                        Agent.id.in_(agent_ids),
                        Agent.is_active.is_(True),
                        Agent.dify_api_key.is_not(None),
                    )
                )
            ).scalars().all()
        if not agents:
            return

        agent = _detect_at_mention(new_text, agents) or _detect_keyword(new_text, agents)
        if agent is None:
            return

        last = state.last_at_per_agent.get(agent.id, 0.0)
        if now - last < MIN_GAP_PER_AGENT_S:
            return

        context = await _build_context(meeting_id, db)

    state.last_at_meeting = now
    state.last_at_per_agent[agent.id] = now

    logger.info("invoking agent %s on meeting %s", agent.name, meeting_id)
    await on_message(
        {
            "type": "agent_message_start",
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "agent_color": agent.color or "violet",
        }
    )

    client = DifyClient(
        api_key=agent.dify_api_key,
        base_url=agent.dify_base_url or "https://api.dify.ai",
    )
    text_buf: list[str] = []
    try:
        async for ev in client.chat_stream(
            query=new_text,
            inputs={"meeting_context": context},
            user=f"meeting:{meeting_id}",
            app_type=agent.dify_app_type or "chatflow",
        ):
            evt = ev.get("event")
            if evt in ("message", "agent_message"):
                chunk = ev.get("answer") or ""
                if chunk:
                    text_buf.append(chunk)
                    await on_message({"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": chunk})
            elif evt in ("message_end", "workflow_finished"):
                break
            elif evt == "error":
                logger.warning("dify error event: %s", ev)
                await on_message(
                    {
                        "type": "agent_message_chunk",
                        "agent_id": str(agent.id),
                        "chunk": f"[Dify 错误: {ev.get('message')}]",
                    }
                )
    except DifyError as e:
        logger.exception("dify call failed")
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": f"[调用失败: {e}]"}
        )
    finally:
        full = ("".join(text_buf))[:MAX_TEXT_LEN]
        if full:
            try:
                async with SessionLocal() as db:
                    db.add(
                        MeetingAgentMessage(
                            meeting_id=meeting_id,
                            agent_id=agent.id,
                            text=full,
                            trigger="at_mention" if "@" in new_text else "keyword",
                            trigger_payload={"trigger_text": new_text[:200]},
                        )
                    )
                    await db.commit()
            except Exception:
                logger.exception("persist agent message failed")
        await on_message(
            {"type": "agent_message_end", "agent_id": str(agent.id), "text": full}
        )
