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

import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException

from .db import SessionLocal
from .dify_client import DifyClient, DifyError
from .knowledge_retrieval import retrieve_chunks
from .llm_direct import LlmError, get_active_provider, stream_chat
from .llm_quota import check_quota_or_raise
from .memory_retrieval import retrieve_relevant
from .models import Agent, MeetingAgentMessage, MeetingAttendee, Meeting, MeetingTranscript, User
from .orchestrator import recommend_next_speaker

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


DEFAULT_MEETING_EXPERT_PROMPT = (
    "你是一位资深参会专家,在一场会议中作为受邀的 AI 顾问发言。\n\n"
    "输入:\n"
    "- meeting_context: 会议中已发生的对话片段,带说话人姓名,按时间顺序。\n"
    "- query: 你被请发言的当前句子。\n\n"
    "要求:\n"
    "1. 先在 meeting_context 中识别核心议题,再针对 query 给出判断与建议。\n"
    "2. 视角是这场会议的专家,关注关键决策、风险、可行性,不要泛泛鼓励。\n"
    "3. 精炼可执行: 直接说结论 + 1-3 条理由,总长 2-5 句话。会议是抢时间的场合。\n"
    "4. 有立场: 明确说\"我建议先做 X 因为...\",不要\"两个都可以、看情况\"。\n"
    "5. 直接称呼会议中真实的发言人,像真在参会,不要\"用户您好\"。\n"
    "6. 不重复 query 已说过的内容,不引用知识库。\n"
    "7. meeting_context 为空时,基于 query 常识做最小判断,保持精炼+有立场。"
)


def _compose_system_prompt(
    agent: Agent,
    memory_lines: list[str] | None = None,
    kb_snippets: list[tuple[str, str]] | None = None,  # (filename, content)
) -> str:
    """Combine agent persona with the meeting-expert template. The agent's
    own persona/domain/tone are layered on top of the generic template so
    each agent specialises while keeping the meeting-aware behaviours.
    If memory_lines is provided, they're appended as a "你过去知道的相关
    事实" section so the agent can reference prior decisions. If
    kb_snippets is provided, they're appended as a "你的知识库" section
    that the agent must prefer over its own prior."""
    parts = [DEFAULT_MEETING_EXPERT_PROMPT, ""]
    parts.append(f"你的角色: {agent.name}")
    if agent.domain:
        parts.append(f"领域: {agent.domain}")
    if agent.persona:
        parts.append(f"人格与风格:\n{agent.persona}")
    if agent.tone:
        parts.append(f"语气: {agent.tone}")
    if agent.boundary:
        parts.append(f"边界(不要做的事):\n{agent.boundary}")
    if kb_snippets:
        parts.append("")
        parts.append(
            "下面是你绑定的知识库中与当前讨论相关的片段。"
            "回答时**优先**参考这里的内容,如果这里没有相关信息,再用你的一般知识。"
            "引用具体内容时简短标明来自哪个文档(如「《XXX》指出...」)。"
        )
        for fname, content in kb_snippets:
            short = content[:600]
            parts.append(f"\n【{fname}】\n{short}")
    if memory_lines:
        parts.append("")
        parts.append("你过去在相关会议中已经知道的事实(优先用这些, 不要凭空编造):")
        for line in memory_lines:
            parts.append(f"- {line}")
    return "\n".join(parts).strip()


def _compose_user_prompt(query: str, context: str) -> str:
    parts = []
    if context:
        parts.append("【会议上下文】\n" + context)
    parts.append("【当前需要你回应的内容】\n" + query)
    return "\n\n".join(parts)


async def _call_dify_and_stream(
    *,
    meeting_id: uuid.UUID,
    agent: Agent,
    query: str,
    context: str,
    trigger: str,
    trigger_payload: dict,
    on_message: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Stream a single agent call back over WS and persist the message at end.

    Path selection:
      - if the agent has a Dify api_key configured, route through Dify
        (gives the user access to KB / branching / Dify-managed memory)
      - otherwise call the active model_provider_config row directly with
        the agent's persona as system prompt — much simpler, no Dify needed
    """
    await on_message(
        {
            "type": "agent_message_start",
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "agent_color": agent.color or "violet",
        }
    )

    text_buf: list[str] = []
    use_dify = bool(agent.dify_api_key)

    # v24.4 #1: LLM 配额 — agent 触发无 user_id (auto-trigger 来自任意发言人 ASR);
    # 只用 workspace 配额(200/min) 兜底 防 buggy 客户端 / 攻击.
    # 拿 workspace_id 必须 query DB(meeting.workspace_id),提前到此.
    try:
        async with SessionLocal() as _ws_db:
            _meeting = (
                await _ws_db.execute(
                    select(Meeting).where(Meeting.id == meeting_id)
                )
            ).scalar_one_or_none()
            _ws_id = _meeting.workspace_id if _meeting else None
        await check_quota_or_raise(user_id=None, workspace_id=_ws_id)
    except HTTPException as quota_exc:
        # 429 → 给 FE 一个友好 chunk + end (不抛 exception)
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id),
             "chunk": f"[配额超限: {quota_exc.detail}]"}
        )
        await on_message({
            "type": "agent_message_end",
            "agent_id": str(agent.id),
            "text": f"[配额超限: {quota_exc.detail}]",
            "citations": [],
        })
        return

    try:
        if use_dify:
            client = DifyClient(
                api_key=agent.dify_api_key,
                base_url=agent.dify_base_url or "https://api.dify.ai",
            )
            async for ev in client.chat_stream(
                query=query,
                inputs={"meeting_context": context},
                user=f"meeting:{meeting_id}",
                app_type=agent.dify_app_type or "chatflow",
            ):
                evt = ev.get("event")
                if evt in ("message", "agent_message"):
                    chunk = ev.get("answer") or ""
                    if chunk:
                        text_buf.append(chunk)
                        await on_message(
                            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": chunk}
                        )
                elif evt in ("message_end", "workflow_finished"):
                    break
                elif evt == "error":
                    logger.warning("dify error event: %s", ev)
                    await on_message(
                        {"type": "agent_message_chunk", "agent_id": str(agent.id),
                         "chunk": f"[Dify 错误: {ev.get('message')}]"}
                    )
        else:
            memory_lines: list[str] = []
            kb_snippets: list[tuple[str, str]] = []
            # v24.3 #1: 收集 citations(给 FE 展示溯源 chip + 持久化到 DB)
            citations: list[dict[str, Any]] = []
            async with SessionLocal() as db:
                provider = await get_active_provider(db)
                if provider is not None:
                    # KB retrieval first — agents grounded in uploaded docs
                    # outperform agents grounded only in past meeting facts
                    # for technical questions.
                    if agent.knowledge_base_ids:
                        try:
                            kb_results = await retrieve_chunks(
                                db,
                                query_text=(context + "\n" + query).strip(),
                                kb_ids=list(agent.knowledge_base_ids),
                                k=4,
                            )
                            kb_snippets = [
                                (r.document_filename, r.content) for r in kb_results
                            ]
                            # v24.3 #1: 同时把命中 chunks 收成 citations payload
                            citations = [
                                {
                                    "chunk_id": r.chunk_id,
                                    "document_id": r.document_id,
                                    "document_filename": r.document_filename,
                                    "chunk_index": r.chunk_index,
                                    "snippet": (r.content or "").strip()[:240],
                                    "distance": round(r.distance, 4),
                                }
                                for r in kb_results
                            ]
                        except Exception:
                            logger.exception("kb retrieval failed; continuing without")
                    # Retrieve project + attendee-scoped memories that match
                    # the recent context. We scope to:
                    #   - project: this meeting's title
                    #   - users: attendees by name
                    meeting = (
                        await db.execute(
                            select(Meeting).where(Meeting.id == meeting_id)
                        )
                    ).scalar_one_or_none()
                    project_refs = [meeting.title] if meeting and meeting.title else []
                    attendee_ids = (
                        await db.execute(
                            select(MeetingAttendee.user_id).where(
                                MeetingAttendee.meeting_id == meeting_id,
                                MeetingAttendee.user_id.is_not(None),
                            )
                        )
                    ).all()
                    user_refs: list[str] = []
                    if attendee_ids:
                        users = (
                            await db.execute(
                                select(User).where(User.id.in_([r[0] for r in attendee_ids]))
                            )
                        ).scalars().all()
                        user_refs = [u.name for u in users]
                    try:
                        if meeting and meeting.workspace_id:
                            mems = await retrieve_relevant(
                                db,
                                workspace_id=meeting.workspace_id,
                                query_text=(context + "\n" + query).strip(),
                                project_refs=project_refs or None,
                                user_refs=user_refs or None,
                                k=4,
                            )
                            # Filter out very-far matches; cosine distance > 0.6 is
                            # usually irrelevant noise.
                            memory_lines = [m.content for m in mems if m.distance < 0.6]
                    except Exception:
                        logger.exception("memory retrieval failed; continuing without")

            if provider is None:
                await on_message(
                    {"type": "agent_message_chunk", "agent_id": str(agent.id),
                     "chunk": "[未配置可用的 LLM 模型,请去「LLM 模型」页面设置一个并设为默认]"}
                )
            else:
                system_prompt = _compose_system_prompt(
                    agent,
                    memory_lines or None,
                    kb_snippets or None,
                )
                user_prompt = _compose_user_prompt(query, context)
                async for chunk in stream_chat(
                    provider=provider,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                ):
                    if chunk:
                        text_buf.append(chunk)
                        await on_message(
                            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": chunk}
                        )
    except (DifyError, LlmError) as e:
        logger.exception("agent call failed")
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": f"[调用失败: {e}]"}
        )
    except Exception:
        logger.exception("agent call unexpected error")
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": "[调用失败: internal_error]"}
        )
    finally:
        full = ("".join(text_buf))[:MAX_TEXT_LEN]
        # v24.3 #1: citations 可能在 try 块里没初始化(early exception),safe default
        try:
            cits = citations  # type: ignore[name-defined]
        except NameError:
            cits = []
        if full:
            try:
                async with SessionLocal() as db:
                    db.add(
                        MeetingAgentMessage(
                            meeting_id=meeting_id,
                            agent_id=agent.id,
                            text=full,
                            trigger=trigger,
                            trigger_payload=trigger_payload,
                            citations=cits or None,
                        )
                    )
                    await db.commit()
            except Exception:
                logger.exception("persist agent message failed")
        await on_message({
            "type": "agent_message_end",
            "agent_id": str(agent.id),
            "text": full,
            "citations": cits,  # v24.3 #1: 给 FE chips 渲染
        })

        # Sprint J: orchestrate next speaker. We run this async — the
        # current agent's bubble is already done from the user's POV;
        # the recommendation banner appears whenever the LLM returns
        # (typically 1-3s later).
        if full:
            asyncio.create_task(
                _suggest_next_speaker(
                    meeting_id=meeting_id,
                    just_finished_agent_id=agent.id,
                    just_finished_agent_text=full,
                    on_message=on_message,
                )
            )


async def _suggest_next_speaker(
    *,
    meeting_id: uuid.UUID,
    just_finished_agent_id: uuid.UUID,
    just_finished_agent_text: str,
    on_message: Callable[[dict], Awaitable[None]],
) -> None:
    try:
        rec = await recommend_next_speaker(
            meeting_id,
            just_finished_agent_id=just_finished_agent_id,
            just_finished_agent_text=just_finished_agent_text,
        )
    except Exception:
        logger.exception("orchestrator failed; suppressing recommendation")
        return
    if rec is None:
        return
    try:
        await on_message(
            {
                "type": "agent_recommendation",
                "agent_id": str(rec.agent_id),
                "agent_name": rec.agent_name,
                "agent_color": rec.agent_color,
                "reason": rec.reason,
            }
        )
    except Exception:
        logger.exception("ws push agent_recommendation failed")


async def maybe_invoke_agents(
    meeting_id: uuid.UUID,
    new_text: str,
    *,
    on_message: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Auto-trigger path: called after each finalized ASR sentence. Picks at most
    one agent by @-mention or keyword match and (if within rate limits) invokes
    its Dify app.
    """
    state = _rate.setdefault(meeting_id, _RateState())
    now = time.monotonic()
    if now - state.last_at_meeting < MIN_GAP_MEETING_S:
        return

    async with SessionLocal() as db:
        agents = await _agents_for_meeting(db, meeting_id)
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

    logger.info("auto-invoking agent %s on meeting %s", agent.name, meeting_id)
    trigger = "at_mention" if "@" in new_text or "＠" in new_text else "keyword"
    await _call_dify_and_stream(
        meeting_id=meeting_id,
        agent=agent,
        query=new_text,
        context=context,
        trigger=trigger,
        trigger_payload={"trigger_text": new_text[:200]},
        on_message=on_message,
    )


async def invoke_agent_directly(
    meeting_id: uuid.UUID,
    agent_id: uuid.UUID,
    *,
    on_message: Callable[[dict], Awaitable[None]],
    query: Optional[str] = None,
) -> None:
    """
    Manual trigger path: user clicked the agent's avatar in the meeting UI.
    Bypasses keyword/@-mention detection AND rate limits — it's an explicit
    intent. Builds context from the recent transcript and asks the agent for
    its take on what's been said.
    """
    async with SessionLocal() as db:
        agent = (
            await db.execute(
                select(Agent).where(Agent.id == agent_id, Agent.is_active.is_(True))
            )
        ).scalar_one_or_none()
        if not agent:
            await on_message({"type": "system", "msg": "agent_unconfigured"})
            return
        context = await _build_context(meeting_id, db)

    state = _rate.setdefault(meeting_id, _RateState())
    state.last_at_meeting = time.monotonic()
    state.last_at_per_agent[agent.id] = time.monotonic()

    logger.info("manual-invoke agent %s on meeting %s", agent.name, meeting_id)
    user_query = query or "请基于刚才的会议讨论,以你的专业角度给出意见与建议。"
    await _call_dify_and_stream(
        meeting_id=meeting_id,
        agent=agent,
        query=user_query,
        context=context,
        trigger="manual",
        trigger_payload={"hint": query} if query else {},
        on_message=on_message,
    )


async def _agents_for_meeting(db: AsyncSession, meeting_id: uuid.UUID) -> list[Agent]:
    """Active agents bound to this meeting; falls back to all active agents
    so single-Agent setups don't require ticking a box every time."""
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
        return list(
            (
                await db.execute(
                    select(Agent).where(Agent.is_active.is_(True))
                )
            ).scalars()
        )
    return list(
        (
            await db.execute(
                select(Agent).where(
                    Agent.id.in_(agent_ids),
                    Agent.is_active.is_(True),
                )
            )
        ).scalars()
    )
