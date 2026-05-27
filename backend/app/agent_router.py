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

from sqlalchemy import select, update
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
# v1.4.0 Phase A · 2 (NORTH_STAR § 6.1 · 痛点 1+6): LLM judge 主动度调优 ——
# AI 应该自己主动插话, 不要被动等关键词. 原 8s/30s 太保守, hybrid 真会议
# 一两分钟才有 1 个 AI 反应, 客户感受 "AI 在睡觉". 降到 4s/15s 让 AI 更敢插.
MIN_GAP_MEETING_S = 4       # don't spam: any agent at most every 4s overall (was 8s)
MIN_GAP_PER_AGENT_S = 15    # same agent at most every 15s (was 30s)
MAX_TEXT_LEN = 800          # Dify response truncation guard


@dataclass
class _RateState:
    last_at_meeting: float = 0.0
    last_at_per_agent: dict[uuid.UUID, float] = field(default_factory=dict)


# In-memory per-meeting rate state. Lives only as long as the WS does;
# acceptable for Phase 1.5 single-process backend.
_rate: dict[uuid.UUID, _RateState] = {}


def _detect_at_mention(text: str, agents: list[Agent]) -> Optional[Agent]:
    """Return the first agent whose name OR nickname appears as @<...> in `text`.

    v26.12-Home: 同时 接受 @name 和 @nickname (拟人外号).
    e.g. agent.name="数据分析报告师", agent.nickname="数妙妙" → @数妙妙 也 触发.
    nickname 优先 (更短 / 更易 typed), name 兜底.
    """
    for ag in agents:
        # Tolerate Chinese full-width @ and a few common typo forms.
        # 先 试 nickname (拟人外号), 再 试 name (职务身份).
        for candidate in (ag.nickname, ag.name):
            if not candidate or not candidate.strip():
                continue
            pattern = re.compile(rf"[@＠]\s*{re.escape(candidate)}", re.IGNORECASE)
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
    # v1.4.0 Phase A · 3 (NORTH_STAR § 6.1 · 痛点 2): 立场守门加强 ——
    # 客户原话: "AI 总是在和稀泥,什么都说都有道理". 真专家 不该 这样.
    # 下面 4 / 4.1-4.3 / 5 都是 立场守门 强化 (从原 1 条 升 到 4 条).
    "要求:\n"
    "1. 先在 meeting_context 中识别核心议题,再针对 query 给出判断与建议。\n"
    "2. 视角是这场会议的专家,关注关键决策、风险、可行性,不要泛泛鼓励。\n"
    "3. 精炼可执行: 直接说结论 + 1-3 条理由,总长 2-5 句话。会议是抢时间的场合。\n"
    "4. **立场守门** (核心要求): 你是 insider 专家, 一定 有 自己 的 倾向 —— 直接 说出来.\n"
    "   4.1 **禁止 和稀泥**: 不允许 出现 \"两个都可以\" / \"看情况\" / \"都有道理\" / \n"
    "       \"各有利弊\" / \"取决于...\" 这类 模糊 措辞. 看到 自己 这么写, 重 写.\n"
    "   4.2 **必须 选边**: 即便 信息 不全, 你 也要 基于 已知 信息 给 默认 推荐 —— \n"
    "       \"建议 先做 X, 因为 ...; 如果 信息 改变 (e.g. Y 数据 出来), 再 重 评估\".\n"
    "       不要 把 决定 推回 给 提问人. 用户 找 专家 就是 不想 自己 拍板.\n"
    "   4.3 **明确 反对 时 直说**: 如果 在场 别人 (尤其 同级 AI) 的 观点 你 不 认同, \n"
    "       直接 说 \"我 不同意 XX 的 观点, 因为 ...\" + 给 替代 方案. 不要 假装 同意.\n"
    "5. **个性 + 边界**: 你 是 <agent.name>, 不是 通用 AI. 你 的 立场 来自 你 的 领域 \n"
    "   (domain) + 人格 (persona). 谈 自己 领域 内 的 事 强硬, 出 自己 领域 就 谦让 \n"
    "   (\"这 不是 我 专业, 但 我 看 法务 / 数据 / UX 角度 是 ...\").\n"
    "6. 直接称呼会议中真实的发言人,像真在参会,不要\"用户您好\"。\n"
    "7. 不重复 query 已说过的内容,不引用知识库。\n"
    "8. meeting_context 为空时,基于 query 常识做最小判断,保持精炼+有立场。"
)


# v26.13.1-fix2: chat 调试模式 用 一套 完全不同 的 system prompt.
# 老 bug: 复用 会议室 prompt → AI "有立场不墙头草" 行为 越过 用户 直接指令
# (用户 让 列就 不去 列, 反而 自作主张 给 设计建议). 调试 playground 体验 巨差.
# 新 prompt: 纯执行器, persona 仅 影响 风格, 不影响 指令 解读.
DEFAULT_CHAT_ASSISTANT_PROMPT = (
    "你是用户在调试模式下一对一找你试聊的 AI 助手。\n\n"
    "核心原则 (优先级 从高到低):\n"
    "1. **服从指令** — 用户让做什么就做什么:让列就列、让提取就提取、让总结就总结、\n"
    "   让翻译就翻译。**不要** 自作主张改成你认为更好的方式 (例如把\"列清单\"改成\n"
    "   \"我帮你设计看板\"). 用户知道自己要什么。\n"
    "2. **基于上传内容** — 用户上传的文件内容会出现在 prompt 的【用户 本次 上传 的 文件】\n"
    "   段落里. 你的回答必须基于该内容, 不要凭空编造或忽略它.\n"
    "3. **persona 仅决定风格** — 下文给的 persona / 领域 / 语气 定义 你的视角和表达方式,\n"
    "   但 **不要让 它 覆盖** 用户的直接指令. 你是 X 专家, 但用户让你列文档你就列, 别老\n"
    "   把所有问题都拐回 X 视角.\n"
    "4. **想给建议时, 放最后** — 完成用户的请求之后, 如果你确实有改进建议, 用单独一段\n"
    "   开头\"另外我想补充:\"做主次分明的补充. 不要在用户问 A 时把答 A 跳过去答 B.\n"
    "5. **直接对话** — 用\"你\" / \"您\" 称呼用户, 不要假装在会议里发言.\n"
    "6. **简洁但完整** — 不要为了短而省略用户要的内容. 用户让列 20 条就列 20 条 (除非\n"
    "   你看到文件里实际只有 N 条, 那就如实列 N 条 + 说明)."
)


def _compose_system_prompt(
    agent: Agent,
    memory_lines: list[str] | None = None,
    kb_snippets: list[tuple[str, str]] | None = None,  # (filename, content)
    *,
    mode: str = "meeting",  # v26.13.1-fix2: "meeting" | "chat"
) -> str:
    """Combine agent persona with a base template.

    mode='meeting' (default, 老行为):  会议室 — AI 有立场 / 精炼 / 不墙头草
    mode='chat' (v26.13.1):           调试 playground — AI 是 纯执行器,
                                       service user 直接指令 优先 于 自己 的 倾向

    If memory_lines is provided, they're appended as a "你过去知道的相关
    事实" section so the agent can reference prior decisions. If
    kb_snippets is provided, they're appended as a "你的知识库" section
    that the agent must prefer over its own prior."""
    base = (
        DEFAULT_CHAT_ASSISTANT_PROMPT if mode == "chat"
        else DEFAULT_MEETING_EXPERT_PROMPT
    )
    parts = [base, ""]
    parts.append(f"你的角色: {agent.name}")
    # v26.12-Home: 让 LLM 知道 自己 还 有 一个 拟人 外号 ——
    # 用户 在 会议 中 可能 喊 "数妙妙" 也 可能 喊 "数据分析报告师", LLM 都 应 知 是 在 叫 自己.
    if agent.nickname and agent.nickname.strip():
        parts.append(
            f"你的拟人外号: {agent.nickname.strip()} "
            f"(用户 也可能 直接 用 这个 名字 叫 你, 都是 在 跟 你 说话; "
            f"严肃 场景 / 正式回答 仍 自报 \"{agent.name}\", 轻松 场景 可 自报 \"{agent.nickname.strip()}\")"
        )
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
            # v26.12-Home: nickname 可空; 前端 拿到 后 拟人 主 + 职务 副 渲染 bubble.
            "agent_nickname": agent.nickname,
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
                            # v26.7-01: 传 agent.id 过滤 — 该 AI 只拿到 挂它身上 的 memory
                            # + workspace 通用记忆. 减少 跨 AI 噪音 (房屋安全 AI 不会拿到
                            # 物业 AI 的 memory).
                            mems = await retrieve_relevant(
                                db,
                                workspace_id=meeting.workspace_id,
                                query_text=(context + "\n" + query).strip(),
                                project_refs=project_refs or None,
                                user_refs=user_refs or None,
                                agent_id=agent.id,  # v26.7-01 ★ 关键
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
                    # v26.12-Home: agent 被 调用 + 真返回 内容 → invoke_count +1.
                    # atomic UPDATE 避免 多进程 race condition (老 invoke_count + 1
                    # 这种 read-modify-write 会 丢 计数).
                    await db.execute(
                        update(Agent)
                        .where(Agent.id == agent.id)
                        .values(invoke_count=Agent.invoke_count + 1)
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
                # v26.12-Home: 前端 banner 优先 显 nickname (拟人感)
                "agent_nickname": rec.agent_nickname,
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


# ============================================================================
# v26.13.1: AI 私聊 调试模式 — _call_for_chat
# ============================================================================
# 跟 _call_dify_and_stream 平行, 但:
#   - 不 拿 meeting_id (没有 会议 上下文)
#   - context 来自 browser 传 的 messages 历史
#   - **完全 read** agent 的 KB + memory (调试模式 = 看 AI 完整能力)
#   - **不写** transcript / agent_message / memory / KB
#   - **不触发** orchestrator (没下一个发言者建议)
#   - invoke_count +1 (调试也算 调用, 用于 首页 "热度" 排序)
# 故意 重写 一份 retrieval 逻辑 而 不 refactor 现有 _call_dify_and_stream — 后者 跟
# meetings 强耦合, 现在 动 它 风险 大, 等 v26.14 再 statically 抽 共用 helper.
# ============================================================================


def _compose_chat_user_prompt(messages: list[dict], attachments: list[dict]) -> str:
    """
    Build user prompt from browser-supplied chat history + attachments.

    messages: [{role: "user"|"assistant", content: str}], 最近 10 条
    attachments: [{filename: str, text: str}] — 解析后 的 文件文本
    """
    # 历史 (除 最新 一条 user) 当成 上下文
    history = messages[:-1] if messages else []
    history_lines: list[str] = []
    for m in history[-10:]:  # 最多 10 条 历史
        role = m.get("role", "user")
        content = (m.get("content") or "").strip()
        if not content:
            continue
        prefix = "用户" if role == "user" else "你 (AI 助手)"
        history_lines.append(f"{prefix}: {content[:800]}")

    # 最新 一条 user 消息 = 当前 query
    last_user = ""
    if messages and messages[-1].get("role") == "user":
        last_user = (messages[-1].get("content") or "").strip()

    parts: list[str] = []
    if history_lines:
        parts.append("【之前 对话】")
        parts.extend(history_lines)
        parts.append("")
    if attachments:
        parts.append("【用户 本次 上传 的 文件】")
        for att in attachments:
            fn = att.get("filename") or "未命名"
            txt = (att.get("text") or "")[:4000]  # 单文件 截 4k 字
            if txt:
                parts.append(f"--- 文件: {fn} ---\n{txt}")
        parts.append("")
    parts.append("【用户 当前 问题】")
    parts.append(last_user or "(空消息)")
    return "\n".join(parts)


async def invoke_agent_for_chat(
    agent_id: uuid.UUID,
    *,
    on_message: Callable[[dict], Awaitable[None]],
    messages: list[dict],
    attachments: list[dict] | None = None,
    user_id: Optional[uuid.UUID] = None,
    workspace_id: Optional[uuid.UUID] = None,
) -> None:
    """
    AI 私聊 调试模式 — 单次 LLM 调用, 流式 回复.

    不写 任何表 (transcript / agent_message / memory / KB). KB + memory 仍 read
    (调试 看 AI 完整能力). invoke_count +1.

    on_message 推 跟 会议 同一套 schema:
      - agent_message_start / agent_message_chunk / agent_message_end
      - (调试 信息) chat_debug_info — citations 跟 memory 命中 数, 给 sidebar 显
    """
    attachments = attachments or []

    async with SessionLocal() as db:
        agent = (
            await db.execute(
                select(Agent).where(Agent.id == agent_id, Agent.is_active.is_(True))
            )
        ).scalar_one_or_none()
    if not agent:
        await on_message({"type": "system", "msg": "agent_unconfigured"})
        return

    # 边界: workspace 必须 跟 agent workspace 一致 (前端 已校验 ABAC, 这里 兜底)
    if workspace_id is not None and agent.workspace_id != workspace_id:
        await on_message({"type": "system", "msg": "agent_workspace_mismatch"})
        return

    logger.info(
        "chat-invoke agent=%s user=%s messages=%d attachments=%d",
        agent.name, user_id, len(messages), len(attachments),
    )

    await on_message(
        {
            "type": "agent_message_start",
            "agent_id": str(agent.id),
            "agent_name": agent.name,
            "agent_nickname": agent.nickname,
            "agent_color": agent.color or "violet",
        }
    )

    # v26.13.1-fix1: 不 再 走 check_quota_or_raise 的 30/分钟 LLM 限速 —
    # 那 是 给 会议室 防 buggy 客户端 的 (ASR 触发 可能 1 秒 多次),
    # 调试模式 = 用户 手动 发 1 条 1 条, per-user 日配额 200 已 是 上限.
    # 多 一层 30/min 会 让 manager 想 快测 几条 时 卡住, 体验 巨差.

    text_buf: list[str] = []
    use_dify = bool(agent.dify_api_key)

    user_prompt = _compose_chat_user_prompt(messages, attachments)
    last_user_msg = (
        messages[-1].get("content", "") if messages and messages[-1].get("role") == "user" else ""
    )

    citations: list[dict[str, Any]] = []
    memory_lines: list[str] = []
    kb_snippets: list[tuple[str, str]] = []

    try:
        if use_dify:
            # Dify 路径 — 跟 会议 同样 走 Dify 编排器 (它 内部 有 自己的 KB / memory)
            client = DifyClient(
                api_key=agent.dify_api_key,
                base_url=agent.dify_base_url or "https://api.dify.ai",
            )
            # Dify 的 user 标识 — 给 它 一个 用户级 id, 让 Dify 内部 区分 会话
            dify_user = f"chat:{user_id}:{agent.id}" if user_id else f"chat:{agent.id}"
            async for ev in client.chat_stream(
                query=last_user_msg or user_prompt,
                inputs={"meeting_context": user_prompt},
                user=dify_user,
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
                    logger.warning("dify error in chat: %s", ev)
                    await on_message(
                        {"type": "agent_message_chunk", "agent_id": str(agent.id),
                         "chunk": f"[Dify 错误: {ev.get('message')}]"}
                    )
        else:
            async with SessionLocal() as db:
                provider = await get_active_provider(db)
                if provider is None:
                    await on_message({
                        "type": "agent_message_chunk", "agent_id": str(agent.id),
                        "chunk": "[未配置可用的 LLM 模型,请去「LLM 模型」页面设置]",
                    })
                else:
                    # KB retrieval — 调试模式 也 走 KB, 让 manager 验证 KB 配置
                    if agent.knowledge_base_ids:
                        try:
                            kb_results = await retrieve_chunks(
                                db,
                                query_text=user_prompt[-2000:],
                                kb_ids=list(agent.knowledge_base_ids),
                                k=4,
                            )
                            kb_snippets = [
                                (r.document_filename, r.content) for r in kb_results
                            ]
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
                            logger.exception("chat: kb retrieval failed")

                    # Memory retrieval — workspace-scoped, agent-scoped
                    if workspace_id is not None:
                        try:
                            mems = await retrieve_relevant(
                                db,
                                workspace_id=workspace_id,
                                query_text=user_prompt[-2000:],
                                project_refs=None,
                                user_refs=None,
                                agent_id=agent.id,
                                k=4,
                            )
                            memory_lines = [m.content for m in mems if m.distance < 0.6]
                        except Exception:
                            logger.exception("chat: memory retrieval failed")

                    # 推 调试信息 给前端 sidebar 显 "本次 召回 N chunks / M memories"
                    await on_message({
                        "type": "chat_debug_info",
                        "agent_id": str(agent.id),
                        "kb_hits": len(citations),
                        "memory_hits": len(memory_lines),
                    })

                    system_prompt = _compose_system_prompt(
                        agent,
                        memory_lines or None,
                        kb_snippets or None,
                        mode="chat",  # v26.13.1-fix2: 用 调试模式 system prompt
                    )
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
        logger.exception("chat agent call failed")
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": f"[调用失败: {e}]"}
        )
    except Exception:
        logger.exception("chat agent call unexpected error")
        await on_message(
            {"type": "agent_message_chunk", "agent_id": str(agent.id), "chunk": "[调用失败: internal_error]"}
        )
    finally:
        full = ("".join(text_buf))[:MAX_TEXT_LEN]
        # invoke_count +1 (调试也算 调用 — 让 首页 "热度" 反映 真实使用)
        if full:
            try:
                async with SessionLocal() as db:
                    await db.execute(
                        update(Agent)
                        .where(Agent.id == agent.id)
                        .values(invoke_count=Agent.invoke_count + 1)
                    )
                    await db.commit()
            except Exception:
                logger.exception("chat: invoke_count update failed")
        await on_message({
            "type": "agent_message_end",
            "agent_id": str(agent.id),
            "text": full,
            "citations": citations,
        })

        # v26.13.2: 闭环 — 如果 AI 有 绑 KB 但 本次 召回 0 chunks 且 用户 问题 不平凡,
        # 推 kb_miss_hint, 前端 显 "📚 用 Perplexity 帮我补充 这块" 按钮.
        if (
            full  # AI 真的 回复 了 (排除 配额fail / agent_unconfigured)
            and len(citations) == 0
            and agent.knowledge_base_ids  # agent 绑了 KB, 才有 "补充" 意义
            and last_user_msg
            and len(last_user_msg.strip()) >= 5
        ):
            await on_message({
                "type": "kb_miss_hint",
                "agent_id": str(agent.id),
                "kb_id": str(agent.knowledge_base_ids[0]),  # 推荐 入 第一个 KB
                "suggested_query": last_user_msg.strip()[:200],
                "reason": "本次 回复 没 引用 KB 中 任何 文档 — 可能 该 知识点 还没 进 KB.",
            })


async def _agents_for_meeting(db: AsyncSession, meeting_id: uuid.UUID) -> list[Agent]:
    """Active agents 显式邀请到本会议的.

    v25.7-#1 修复:之前 没邀请任何 AI 时 fallback 到「all active agents」 →
    一场会议被 16+ AI 关键词触发满天乱蹦.现在 没勾就 0 个,
    不自动触发任何 AI(用户可在会议中手动 invoke).
    """
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
        return []  # v25.7-#1: 没邀请就不触发(关键改动)
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
