"""
v26.3-03 Auto Meeting Orchestrator — 全 AI 自主会议调度器.

从 scripts/auto_meeting_demo.py 升级:
  - 调度循环 一样 (5 prompts, max_turns, adequacy check, consensus collect)
  - 写 meeting_agent_message (含 agenda_idx + reply_to_agent_message_id)
  - 写 meeting_consensus (含 dissents + needs_human_review)
  - 用 auto_meeting_state.apply_transition 严格管 phase
  - 议程跑完 → finalize_meeting → action_extractor → 沉淀(已有 v26 链路)
  - 启动时 lifespan resume:扫所有 phase=running 的 meeting 接着跑

调用入口:
  start_auto_meeting(meeting_id)    手动启动(POST /orchestrate/start)
  resume_running_meetings()         lifespan 启动时 扫一遍

不暴露 HTTP 给前端 — 由 routers/meetings.py 的 endpoint 调用本模块.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .auto_meeting_state import (
    AUTO_ACTION_COMPLETE,
    AUTO_ACTION_FAIL,
    AUTO_ACTION_START,
    PHASE_DONE,
    PHASE_FAILED,
    PHASE_PAUSED,
    PHASE_RUNNING,
    IllegalPhaseTransition,
    apply_transition,
    get_phase,
    is_terminal,
)
from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, Meeting, MeetingAgentMessage, MeetingConsensus

logger = logging.getLogger(__name__)


# ============================================================================
# Tunables (一致同 scripts/auto_meeting_demo.py)
# ============================================================================

MAX_TURNS_PER_AGENDA = 6
ADEQUACY_CHECK_AFTER_TURN = 3
AGENT_REPLY_MAX_CHARS = 800

# 检查 pause 信号的轮询粒度(在长 LLM 调用之间也 check 一次)
PAUSE_CHECK_INTERVAL_SEC = 2.0

# orchestrator 全局注册表:meeting_id → asyncio.Task
# 用于 防止 同一会议 重复启动 + 召集人 pause/resume/cancel 信号传递.
_running_tasks: dict[uuid.UUID, asyncio.Task] = {}


# ============================================================================
# Prompts (从 demo 脚本拷贝,已经在 v26.3-01 实跑校准过)
# ============================================================================

MODERATOR_SYSTEM = """你是一名严谨的政务会议主持人,代表会议的"流程秩序",
不代表任何科室专家的立场.

风格:
- 中立 — 不站队任何专家,不预设立场,不评价某专家"说得对".
- 简洁 — 不长篇大论,不重复专家说过的话.
- 政务腔 — 用 "建议 / 拟 / 经讨论" 等公文语.避免 "大家好" 之类口语化.
- 严肃 — 会议是正式场合,不开玩笑,不寒暄.

禁止:
- intro 阶段不要直接给结论
- wrap_up 时不要引入新观点(只能总结专家发过的)
- 不要 @ 具体专家催发言
- 不要使用 markdown 标题
- 不要表达情绪
"""

MODERATOR_INTRO_USER = """当前议程项:"{title}"

请用 60-100 字简要陈述议题 + 提出 1-2 个引导问题让在场 AI 专家围绕讨论.
不要给结论,你只是主持."""

MODERATOR_WRAPUP_USER = """议程项:"{title}"

各 AI 专家已发言完毕,以下是讨论记录:
{messages}

请用 100-200 字 收尾总结本议程项的核心结论 / 分歧点.只总结专家发过
的内容,不要引入新观点.准备进入下一议程项."""

MODERATOR_JUDGE_USER = """议程项:"{title}"

已有 {turn_count} 轮发言:
{messages}

请判定本议程项是否已讨论充分(共识达成 或 分歧已清晰).
严格输出 JSON 单行,无任何其他文字:
{{
  "is_adequate": true/false,
  "reason": "<20-40 字理由>",
  "missing_perspectives": ["如不充分,缺什么角度;充分则空数组"]
}}"""

AGENT_REPLY_SYSTEM = """你是 {agent_name},专精 {domain}.

你的人格设定:
{persona}

会议发言风格:
- 100-300 字,简洁锋利,不客套
- 必须 reference 你的知识库 / 经验,可用 [资料 X] 角标 表示
- 不要总结全局(那是主持人的事)
- 不要重复别的专家已说的
"""

AGENT_REPLY_USER = """当前议程项:"{title}"

前面已发言(按时间顺序):
{prev_messages}

请基于你的知识库 + 经验,做以下其一(选一个最合适的):
  1) 【补充】前面没提到的视角(如:实操影响 / 历史经验 / 跨部门衔接)
  2) 【反驳】对某位专家观点提出不同看法 + 理由
  3) 【整合】把前面 2-3 个观点 拢成一个执行方案

100-300 字.直接说观点,不要客套."""

CONSENSUS_SYSTEM = """你是政务会议秘书,从会议讨论中识别 共识 与 分歧.

【共识判定 — 这是默认结果,不要保守】

共识成立的信号(满足任一即可,不必都满足):
  ✓ 主持人在 wrap_up 发言里明确总结了 N 条建议 / 行动方向 → 这些建议即共识
  ✓ 多位专家就同一议题 提出 一致 或 **互补** 方案 → 整合为共识
  ✓ 各专家从 不同角度(实操 / 监管 / 合规 / 跨部门) 发言,但 共同推动同一目标 → 共识

【强调】"互补" 是共识的一种形式,不是分歧:
  • 专家 A 谈住房保障角度,B 谈公共建设角度,C 谈营商环境角度 → 互补,**算共识**
  • 专家 A 说要防范风险,B 说要建立调剂机制 → 互补的两种风控考量,**算共识**

【分歧判定 — 严格,默认无分歧】

只有同时满足以下条件 才记入 dissents:
  ✓ 涉及 同一具体决策(比如"是否放宽 X" / "比例上调还是下调" / "做 A 还是做 B")
  ✓ 至少 2 名专家持 互斥立场 — 一方 propose 某方案,另一方 明确 reject 或 propose 相反方案
  ✓ 双方立场无法 同时成立(必须 二选一)

【反例 — 绝对不是分歧】
  ✗ A 提议"防范提取风险",B 提议"建立流动性调剂" → 互补两种风控,不算分歧
  ✗ A 关注住房保障,B 关注棚改,C 关注营商 → 角度不同,共同 inform 决策,不算分歧
  ✗ A 说"还要考虑 Y 因素",B 没回应 → A 的补充,不算分歧

【正例 — 是分歧】
  ✓ A 说"应大幅放宽提取条件",B 说"绝不应放宽,会加剧风险" → 同议题 互斥立场
  ✓ A 说"缴存比例上调到 15%",B 说"必须降到 8%" → 同变量 互斥取值

【主持人 wrap_up 是关键信号】
  主持人 wrap_up 通常 已经总结好了共识(以"经讨论,提出以下建议:一是... 二是... 三是..."等格式).
  你的 consensus 输出 应该 直接整合 wrap_up 的要点."""

CONSENSUS_USER = """议程项:"{title}"

完整发言记录(按时间;**特别注意主持人结尾的 wrap_up 总结,那里通常已有 N 条共识建议**):
{messages}

按规则识别 共识 + 分歧.

输出 JSON 单行,无其他文字:
{{
  "consensus": "<markdown 150-400 字>",
  "dissents": [
    {{
      "point": "<分歧点 必须是 一个 具体决策>",
      "summary": "<具体 互斥立场 50-120 字>",
      "involved_agents": ["<专家名>", ...]
    }}
  ]
}}

提醒:
- 99% 的政务讨论里 各专家是互补关系,真分歧少见.dissents=[] 是常态.
- 如果你拿不准 — 判定不是分歧."""


# ============================================================================
# Pause 信号 + 状态读取(orchestrator 跑长 LLM 间隙 check)
# ============================================================================


async def _read_current_phase(meeting_id: uuid.UUID) -> str:
    """从 DB 拿最新 phase.每议程项 / 每轮发言间 check 一次,响应 pause/cancel."""
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not m:
            return PHASE_FAILED
        return get_phase(m.auto_state)


async def _update_phase(
    meeting_id: uuid.UUID,
    action: str,
    *,
    actor_user_id: Optional[uuid.UUID] = None,
    extra: Optional[dict[str, Any]] = None,
) -> str:
    """用 state machine apply_transition 写回 DB.返回新 phase."""
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not m:
            raise RuntimeError(f"meeting {meeting_id} not found")
        new_state = apply_transition(
            m.auto_state, action,
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            extra=extra,
        )
        await db.execute(
            update(Meeting).where(Meeting.id == meeting_id).values(auto_state=new_state)
        )
        await db.commit()
        return new_state["phase"]


async def _wait_if_paused(meeting_id: uuid.UUID) -> str:
    """
    跑长 LLM 调用前 check 一次:
      - phase=paused → block 直到变回 running(或被 cancel/fail)
      - phase 在终态 → return,让 caller 跳出主循环
      - phase=running → 继续
    返回当前 phase.
    """
    while True:
        phase = await _read_current_phase(meeting_id)
        if phase != PHASE_PAUSED:
            return phase
        await asyncio.sleep(PAUSE_CHECK_INTERVAL_SEC)


# ============================================================================
# LLM 调用 helpers
# ============================================================================


async def _call_llm(
    provider,
    system_prompt: str,
    user_prompt: str,
    *,
    model_override: str = "qwen-max-latest",
    temperature: float = 0.3,
) -> tuple[str, int, float]:
    """Returns (content, token_estimate, elapsed_sec). Raises LlmError."""
    t0 = time.time()
    chunks: list[str] = []
    async for chunk in stream_chat(
        provider=provider,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model_override=model_override,
        temperature=temperature,
        top_p=0.7,
    ):
        chunks.append(chunk)
    content = "".join(chunks).strip()
    elapsed = time.time() - t0
    token_est = len(content) // 2
    return content, token_est, elapsed


def _parse_json_strict(s: str) -> Optional[dict]:
    if not s:
        return None
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _format_messages(messages: list[MeetingAgentMessage], window: int = 8) -> str:
    if not messages:
        return "(暂无)"
    tail = messages[-window:]
    return "\n\n".join(
        f"【{getattr(m, '_speaker_name', '?')}】\n{m.text}"
        for m in tail
    )


# ============================================================================
# 消息持久化 + agent 选择
# ============================================================================


async def _save_message(
    db: AsyncSession,
    meeting_id: uuid.UUID,
    agent_id: uuid.UUID,
    text: str,
    *,
    agenda_idx: int,
    reply_to: Optional[int] = None,
    trigger_payload: Optional[dict] = None,
) -> MeetingAgentMessage:
    msg = MeetingAgentMessage(
        meeting_id=meeting_id,
        agent_id=agent_id,
        text=text,
        trigger="auto_orchestrator",
        trigger_payload=trigger_payload,
        reply_to_agent_message_id=reply_to,
        agenda_idx=agenda_idx,
    )
    db.add(msg)
    await db.flush()
    return msg


def _pick_next_speaker(
    experts: list[Agent],
    speaker_seq_ids: list[uuid.UUID],
) -> Optional[Agent]:
    """v26.3-03 简化:优先没说过,都说过了 轮转回头."""
    spoken = set(speaker_seq_ids)
    unsaid = [a for a in experts if a.id not in spoken]
    if unsaid:
        return unsaid[0]
    if len(speaker_seq_ids) >= MAX_TURNS_PER_AGENDA:
        return None
    return experts[len(speaker_seq_ids) % len(experts)]


# ============================================================================
# 议程项 主循环(对应 demo 脚本 run_agenda_item)
# ============================================================================


@dataclass
class _SpeakerHelper:
    """方便 _format_messages 拿 speaker 名字 — 把名字 attach 到 message 上."""
    by_agent: dict[uuid.UUID, str]

    def annotate(self, msg: MeetingAgentMessage) -> MeetingAgentMessage:
        msg._speaker_name = self.by_agent.get(msg.agent_id, "?")
        return msg


async def _run_agenda_item(
    meeting_id: uuid.UUID,
    moderator: Agent,
    experts: list[Agent],
    agenda_idx: int,
    agenda_title: str,
    provider,
) -> dict:
    """
    跑一议程项.返回 stats {turn_count, token_estimate, elapsed_sec, has_dissent}.

    每议程项的产物:
      - meeting_agent_message: intro + N reply + wrap_up (全带 agenda_idx)
      - meeting_consensus: 1 行(含 consensus_md + dissents)
    """
    t_start = time.time()
    total_tokens = 0
    helper = _SpeakerHelper(by_agent={moderator.id: moderator.name, **{a.id: a.name for a in experts}})

    # 1. moderator intro -----------------------------------------------------
    intro, tok, _ = await _call_llm(
        provider,
        system_prompt=MODERATOR_SYSTEM,
        user_prompt=MODERATOR_INTRO_USER.format(title=agenda_title),
        temperature=0.2,
    )
    total_tokens += tok
    async with SessionLocal() as db:
        intro_msg = await _save_message(
            db, meeting_id, moderator.id, intro,
            agenda_idx=agenda_idx,
            trigger_payload={"stage": "intro"},
        )
        intro_msg_id = intro_msg.id
        await db.commit()

    # 拉本议程项目前为止 的全部 messages(便于 prompt context)
    async def _load_messages() -> list[MeetingAgentMessage]:
        async with SessionLocal() as db:
            rows = (
                await db.execute(
                    select(MeetingAgentMessage).where(
                        MeetingAgentMessage.meeting_id == meeting_id,
                        MeetingAgentMessage.agenda_idx == agenda_idx,
                    ).order_by(MeetingAgentMessage.id)
                )
            ).scalars().all()
            return [helper.annotate(m) for m in rows]

    # 2. 轮发言 --------------------------------------------------------------
    speaker_seq_ids: list[uuid.UUID] = []
    last_msg_id: Optional[int] = intro_msg_id

    for turn in range(MAX_TURNS_PER_AGENDA):
        # pause / cancel 检查
        phase = await _wait_if_paused(meeting_id)
        if phase != PHASE_RUNNING:
            logger.info("orchestrator meeting=%s phase=%s 终止议程", meeting_id, phase)
            break

        next_agent = _pick_next_speaker(experts, speaker_seq_ids)
        if not next_agent:
            break

        messages = await _load_messages()
        prev_formatted = _format_messages(messages, window=8)

        sys_prompt = AGENT_REPLY_SYSTEM.format(
            agent_name=next_agent.name,
            domain=next_agent.domain or next_agent.name,
            persona=(next_agent.persona or "(无 persona)")[:800],
        )
        user_prompt = AGENT_REPLY_USER.format(
            title=agenda_title, prev_messages=prev_formatted
        )

        try:
            reply, tok, _ = await _call_llm(
                provider, system_prompt=sys_prompt, user_prompt=user_prompt,
                temperature=0.5,
            )
        except LlmError as e:
            logger.warning("orchestrator meeting=%s agent=%s LLM 失败 — 跳过本轮: %s",
                          meeting_id, next_agent.name, e)
            continue
        total_tokens += tok
        if len(reply) > AGENT_REPLY_MAX_CHARS:
            reply = reply[:AGENT_REPLY_MAX_CHARS] + "…"

        async with SessionLocal() as db:
            new_msg = await _save_message(
                db, meeting_id, next_agent.id, reply,
                agenda_idx=agenda_idx,
                reply_to=last_msg_id,
                trigger_payload={"stage": "reply", "turn": turn + 1},
            )
            last_msg_id = new_msg.id
            await db.commit()
        speaker_seq_ids.append(next_agent.id)

        # 推进 turn_count + current_speaker_agent_id 到 auto_state
        try:
            await _update_phase(
                meeting_id, action="start",  # noop transition — 但 extra 注入 state
                extra={
                    "current_agenda_idx": agenda_idx,
                    "current_speaker_agent_id": str(next_agent.id),
                    "turn_count": turn + 1,
                },
            )
        except IllegalPhaseTransition:
            # phase 已经不在 idle (是 running),apply_transition('start') 会抛.
            # 改成 直接 update 不走 transition.
            async with SessionLocal() as db:
                m = (await db.execute(select(Meeting).where(Meeting.id == meeting_id))).scalar_one()
                st = dict(m.auto_state or {})
                st["current_agenda_idx"] = agenda_idx
                st["current_speaker_agent_id"] = str(next_agent.id)
                st["turn_count"] = turn + 1
                await db.execute(update(Meeting).where(Meeting.id == meeting_id).values(auto_state=st))
                await db.commit()

        # 3. 每 ADEQUACY_CHECK_AFTER_TURN 轮后 让 moderator 判
        if (turn + 1) >= ADEQUACY_CHECK_AFTER_TURN:
            messages = await _load_messages()
            try:
                jr, tok, _ = await _call_llm(
                    provider,
                    system_prompt=MODERATOR_SYSTEM,
                    user_prompt=MODERATOR_JUDGE_USER.format(
                        title=agenda_title, turn_count=turn + 1,
                        messages=_format_messages(messages, window=20),
                    ),
                    temperature=0.0,
                )
                total_tokens += tok
            except LlmError:
                continue
            parsed = _parse_json_strict(jr)
            if parsed and parsed.get("is_adequate"):
                logger.info("orchestrator meeting=%s agenda=%d 充分,提前收 (轮%d)",
                           meeting_id, agenda_idx, turn + 1)
                break

    # 4. moderator wrap_up ---------------------------------------------------
    messages = await _load_messages()
    try:
        wrap, tok, _ = await _call_llm(
            provider,
            system_prompt=MODERATOR_SYSTEM,
            user_prompt=MODERATOR_WRAPUP_USER.format(
                title=agenda_title,
                messages=_format_messages(messages, window=20),
            ),
            temperature=0.2,
        )
        total_tokens += tok
        async with SessionLocal() as db:
            await _save_message(
                db, meeting_id, moderator.id, wrap,
                agenda_idx=agenda_idx,
                reply_to=last_msg_id,
                trigger_payload={"stage": "wrap_up"},
            )
            await db.commit()
    except LlmError as e:
        logger.warning("orchestrator wrap_up 失败 meeting=%s: %s", meeting_id, e)

    # 5. consensus + dissents ------------------------------------------------
    messages = await _load_messages()
    consensus_md = ""
    dissents: list[dict] = []
    if len(messages) >= 3:
        try:
            cr, tok, _ = await _call_llm(
                provider,
                system_prompt=CONSENSUS_SYSTEM,
                user_prompt=CONSENSUS_USER.format(
                    title=agenda_title,
                    messages=_format_messages(messages, window=30),
                ),
                temperature=0.0,
            )
            total_tokens += tok
            parsed = _parse_json_strict(cr)
            if parsed:
                consensus_md = parsed.get("consensus", "") or ""
                dissents = parsed.get("dissents", []) or []
        except LlmError as e:
            logger.warning("consensus 收集失败 meeting=%s: %s", meeting_id, e)

    elapsed = time.time() - t_start

    # 写 MeetingConsensus(force replace if force=True / 已存在)
    async with SessionLocal() as db:
        await db.execute(
            delete(MeetingConsensus).where(
                MeetingConsensus.meeting_id == meeting_id,
                MeetingConsensus.agenda_idx == agenda_idx,
            )
        )
        consensus_row = MeetingConsensus(
            meeting_id=meeting_id,
            agenda_idx=agenda_idx,
            agenda_title=agenda_title,
            consensus_md=consensus_md or None,
            dissents=dissents,
            needs_human_review=bool(dissents),
            turn_count=len(speaker_seq_ids),
            token_estimate=total_tokens,
            elapsed_sec=elapsed,
        )
        db.add(consensus_row)
        await db.commit()

    return {
        "turn_count": len(speaker_seq_ids),
        "token_estimate": total_tokens,
        "elapsed_sec": elapsed,
        "has_dissent": bool(dissents),
        "dissent_count": len(dissents),
    }


# ============================================================================
# Auto 会议 summary 拼装 (议程 consensus → meeting.summary_md)
# ============================================================================


async def _build_summary_from_consensus(
    meeting_id: uuid.UUID,
    agenda: list[dict],
) -> str:
    """
    把 meeting_consensus 行 + 议程标题 拼成一份 markdown summary.
    这是 mode='auto' 会议的 finalize 产物(替代 summary_generator,因为它只看
    真人 transcript,auto 会议没真人发言).

    输出供 action_extractor 抽 task 用 — 包含 共识(具体建议)+ 分歧(需裁决).
    """
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        consenses = (
            await db.execute(
                select(MeetingConsensus).where(
                    MeetingConsensus.meeting_id == meeting_id
                ).order_by(MeetingConsensus.agenda_idx)
            )
        ).scalars().all()

    lines: list[str] = []
    title = m.title if m else "AI 自主会议"
    lines.append(f"# {title}")
    lines.append("")
    lines.append(
        f"_本会议由 v26.3 召集人模式 自动跑出,议程 {len(agenda)} 项,"
        f"经 N 个 AI 专家轮流发言 + 议程主持收敛形成._"
    )
    lines.append("")

    for c in consenses:
        ag_title = c.agenda_title or f"议程 {c.agenda_idx + 1}"
        lines.append(f"## 议程 {c.agenda_idx + 1}:{ag_title}")
        lines.append("")
        if c.consensus_md:
            lines.append(c.consensus_md)
            lines.append("")
        if c.dissents:
            lines.append(f"**⚠️ 待召集人裁决的分歧({len(c.dissents)} 处):**")
            lines.append("")
            for d in c.dissents:
                point = d.get("point", "?")
                summary = d.get("summary", "")
                involved = d.get("involved_agents", [])
                lines.append(f"- **{point}**")
                lines.append(f"  - {summary}")
                if involved:
                    lines.append(f"  - 涉及专家:{', '.join(str(x) for x in involved)}")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines).strip()


# ============================================================================
# Meeting 主循环
# ============================================================================


async def _load_meeting_for_run(meeting_id: uuid.UUID) -> Optional[tuple[Meeting, Agent, list[Agent], list[dict]]]:
    """Resolve meeting + moderator + experts + agenda list.None on config err."""
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not m:
            return None
        if m.mode != "auto":
            logger.warning("meeting %s mode=%s, not auto — abort orchestrator", meeting_id, m.mode)
            return None
        # agenda
        agenda = m.agenda or []
        if not agenda:
            logger.warning("meeting %s 无议程 — abort", meeting_id)
            return None
        # moderator
        moderator = (
            await db.execute(
                select(Agent).where(
                    Agent.workspace_id == m.workspace_id,
                    Agent.role == "moderator",
                    Agent.is_active.is_(True),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not moderator:
            logger.warning("meeting %s 缺 moderator agent — abort", meeting_id)
            return None
        # experts (邀请的 agent;只取 active 且 mode!='moderator')
        from .models import MeetingAttendee
        invited_rows = (
            await db.execute(
                select(MeetingAttendee.agent_id).where(
                    MeetingAttendee.meeting_id == m.id,
                    MeetingAttendee.agent_id.is_not(None),
                )
            )
        ).all()
        invited_ids = {r[0] for r in invited_rows if r[0]}
        if not invited_ids:
            logger.warning("meeting %s 没邀请 AI 专家 — abort", meeting_id)
            return None
        experts = (
            await db.execute(
                select(Agent).where(
                    Agent.id.in_(invited_ids),
                    Agent.is_active.is_(True),
                    Agent.role == "expert",
                ).order_by(Agent.name)
            )
        ).scalars().all()
        if len(experts) < 2:
            logger.warning("meeting %s 邀请的 active expert < 2 (%d) — abort",
                          meeting_id, len(experts))
            return None
    return m, moderator, list(experts), agenda


async def _run_auto_meeting(meeting_id: uuid.UUID) -> None:
    """
    主循环 — 跑完所有议程项,最后 transition COMPLETE + finalize.
    被 start_auto_meeting / resume_running_meetings 调用.
    在自己的 asyncio task 里跑;异常被 try/except 包住 写入 last_error.
    """
    logger.info("orchestrator START meeting=%s", meeting_id)
    try:
        loaded = await _load_meeting_for_run(meeting_id)
        if not loaded:
            await _update_phase(meeting_id, AUTO_ACTION_FAIL,
                               extra={"error": "load_meeting_failed (见 backend log)"})
            return
        m, moderator, experts, agenda = loaded

        # 拿 LLM provider
        async with SessionLocal() as db:
            provider = await get_active_provider(db)
        if not provider:
            await _update_phase(meeting_id, AUTO_ACTION_FAIL,
                               extra={"error": "no active LLM provider"})
            return

        # 拉到 phase=idle 才能 start;否则可能是 resume 路径
        current_phase = await _read_current_phase(meeting_id)
        if current_phase == "idle":
            await _update_phase(meeting_id, AUTO_ACTION_START)

        total_dissents = 0
        for idx, item in enumerate(agenda):
            phase = await _wait_if_paused(meeting_id)
            if is_terminal(phase):
                logger.info("orchestrator meeting=%s 在议程 %d 前 phase=%s,退出", meeting_id, idx, phase)
                return
            title = (item.get("title") if isinstance(item, dict) else str(item)) or f"议程 {idx + 1}"
            logger.info("orchestrator meeting=%s 议程 %d/%d: %s",
                       meeting_id, idx + 1, len(agenda), title)
            try:
                stats = await _run_agenda_item(
                    meeting_id, moderator, experts, idx, title, provider,
                )
                total_dissents += stats["dissent_count"]
            except Exception as e:
                logger.exception("orchestrator agenda %d 失败 meeting=%s", idx, meeting_id)
                await _update_phase(meeting_id, AUTO_ACTION_FAIL,
                                   extra={"error": f"agenda {idx}: {e}"})
                return

        # 全部议程跑完 → 直接合成 summary_md(用各议程 consensus 拼)
        # 不调 summary_generator(它只看 transcript 表,auto 会议没真人发言).
        # 然后 链 action_extractor + 沉淀(v26.0/.2 链路).
        summary_md = await _build_summary_from_consensus(meeting_id, agenda)

        async with SessionLocal() as db:
            mm = (await db.execute(select(Meeting).where(Meeting.id == meeting_id))).scalar_one()
            new_st = apply_transition(
                mm.auto_state, AUTO_ACTION_COMPLETE,
                extra={"dissent_count": total_dissents},
            )
            mm.auto_state = new_st
            mm.status = "finished"
            mm.ended_at = datetime.now(timezone.utc)
            mm.summary_md = summary_md
            await db.commit()

        # 触发 action_extractor (它会读 summary_md + 抽 topic_keywords + 派给 agent)
        # v26.3: 显式传 mode='auto' — 让 prompt 跳过"AI 发言不算依据"规则,
        # 否则全 AI 会议会抽 0 task.
        # await 而不是 create_task — orchestrator 是 已经在 background task 里跑,
        # 这里再 fire-and-forget 嵌套 一是没必要 二是 在测试环境(一次性进程) child
        # task 会被 cancel.直接 await 跑完更可靠,只多等 ~10s.
        try:
            from .action_extractor import extract_and_store_actions
            n_actions = await extract_and_store_actions(
                meeting_id, summary_md=summary_md, mode="auto",
            )
            logger.info("orchestrator meeting=%s 抽出 %d action items",
                       meeting_id, n_actions)
        except Exception:
            logger.exception("orchestrator action_extractor 失败 meeting=%s", meeting_id)

        logger.info("orchestrator DONE meeting=%s (%d dissents 待裁决,summary %d 字)",
                   meeting_id, total_dissents, len(summary_md))
    except Exception as e:
        logger.exception("orchestrator 不可恢复异常 meeting=%s", meeting_id)
        try:
            await _update_phase(meeting_id, AUTO_ACTION_FAIL,
                               extra={"error": str(e)[:500]})
        except Exception:
            pass
    finally:
        _running_tasks.pop(meeting_id, None)


# ============================================================================
# 公开入口
# ============================================================================


def start_auto_meeting(meeting_id: uuid.UUID) -> None:
    """启动 orchestrator(创建会议时 / leader 手动 start endpoint 调).

    幂等:如果 已有 task 在跑 → 不重复启动.
    """
    if meeting_id in _running_tasks and not _running_tasks[meeting_id].done():
        logger.info("orchestrator already running for meeting=%s", meeting_id)
        return
    task = asyncio.create_task(_run_auto_meeting(meeting_id))
    _running_tasks[meeting_id] = task
    logger.info("orchestrator scheduled meeting=%s", meeting_id)


async def resume_running_meetings() -> int:
    """
    Lifespan startup hook:扫所有 mode='auto' 且 phase∈(running, idle, paused) 的会议
    重新启动 orchestrator.

    paused 也启动 — 因为 orchestrator 内部 _wait_if_paused 会停在那;
    召集人 resume 时 phase 切回 running,orchestrator 自动继续.

    Returns 重启的会议数.
    """
    from sqlalchemy import text as sa_text
    resumed = 0
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Meeting).where(
                    Meeting.mode == "auto",
                    sa_text("auto_state->>'phase' IN ('running', 'paused', 'idle')"),
                )
            )
        ).scalars().all()
        for m in rows:
            phase = get_phase(m.auto_state)
            logger.info("orchestrator resume meeting=%s phase=%s", m.id, phase)
            start_auto_meeting(m.id)
            resumed += 1
    return resumed
