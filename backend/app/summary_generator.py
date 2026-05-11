"""
Post-meeting summary generation.

Per blueprint §3.3, the summary follows a fixed 8-section structure so
downstream consumers (briefings, long-term memory extraction in Sprint E)
can parse it deterministically:

  1. 会议主题
  2. 概览
  3. 关键要点
  4. 已形成决策
  5. 分歧事项
  6. 风险提醒
  7. 待办事项
  8. 下一步建议

Implementation: reads the named transcript (post-identify) plus any AI
agent contributions, stuffs them into a single prompt, asks the active
model_provider_config row's LLM to write structured markdown, saves to
meeting.summary_md.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, Meeting, MeetingAgentMessage, MeetingTranscript, User

logger = logging.getLogger(__name__)


SUMMARY_SYSTEM_PROMPT = """你是一名为政府/企业会议撰写正式纪要的专业秘书。

【最高优先级 反幻觉规则】违反任一条 都比 不写更糟。

A. **每个 bullet 必须能在实录原文中找到对应字句来源**。如果你想写一句话但
   找不到对应来源 → **不要写**,直接整节写"暂无"。
B. **严禁补全 / 演绎 / 总结引申**。即使你认为"按常理这场会议应该会讨论 X",
   实录没明确提到 → 不写。
C. **禁用承接词**:不要写"通过会议讨论"、"大家一致认为"、"经过讨论"、
   "据介绍"、"经研究决定"、"会议指出"等套话。直接写事实陈述。
D. **整个纪要总长度 不超过实录原文的 1/3**。实录短 → 纪要更短。
E. 实录里 没有 "决定/决议/决策" 关键词 → "已形成决策"节 必须只写 "暂无"。
   没有 "风险/隐患/担心/担忧" → "风险提醒" 必须只写 "无"。
   没有 "下一步/接下来/计划/打算" → "下一步建议" 必须只写 "无"。
F. 称呼说话人用实录中的真实姓名(如"张明"), 不要用"用户"、"speaker_01"、
   "[?]"(实录里 [?] 表示该句说话人未识别 — 你也用 "[?]" 不要乱给名字)。

【输出格式】

1. 输出**纯 Markdown**, 不要包代码块, 不要带任何注释或前后说明。
2. 严格按下面 8 个 ## 二级标题, 即使某节为空也要列出, 但只写"暂无"。
3. 决策 / 风险 / 待办 都要标注**责任人**(若实录提到)和**时间节点**(若实录提到)。
4. 每个 bullet 一行,简洁,不要换行。

【固定结构】

## 会议主题
(一句话,从对话中归纳出的核心议题。实录信息不足 → "实录信息不足,无法确定主题")

## 概览
(2-4 句话,只陈述实录中实际讨论过的内容。不补充行业常识。
若实录少于 5 句有效发言 → "实录过短,无法概括")

## 关键要点
- (要点 1 — 必须对应实录原文片段)
- (要点 2)
...
(没有要点 → "暂无")

## 已形成决策
- (决策内容) — 决策人: XXX
(实录没有 "决定/决议/决策/通过" → "暂无")

## 分歧事项
- (谁与谁在哪点上看法不同)
(没有 → "无明显分歧")

## 风险提醒
- (风险描述) — 提出人: XXX
(实录没有提及风险/隐患/担忧 → "无")

## 待办事项
- [ ] (具体事项) — 负责: XXX, 截止: YYYY-MM-DD 或"待定"
(没有明确待办 → "无")

## 下一步建议
- (建议 1 — 必须实录中有人明确提到要"接下来 / 下一步 / 计划")
(没有 → "无")
"""


async def _build_named_transcript(db: AsyncSession, meeting_id: uuid.UUID) -> str:
    """Read transcripts + speaker names + agent messages, return a single
    plain-text rendering ready to feed into an LLM."""
    rows = (
        await db.execute(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == meeting_id)
            .order_by(MeetingTranscript.id)
        )
    ).scalars().all()

    # Resolve user names
    user_ids = {r.speaker_user_id for r in rows if r.speaker_user_id}
    name_by_user: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_user = {u.id: u.name for u in users}

    # Pull agent messages too — they should appear in the timeline
    agent_msgs = (
        await db.execute(
            select(MeetingAgentMessage)
            .where(MeetingAgentMessage.meeting_id == meeting_id)
            .order_by(MeetingAgentMessage.id)
        )
    ).scalars().all()
    agent_ids = {m.agent_id for m in agent_msgs}
    name_by_agent: dict[uuid.UUID, str] = {}
    if agent_ids:
        agents = (
            await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        ).scalars().all()
        name_by_agent = {a.id: a.name for a in agents}

    # Interleave by timestamp. Transcript lines have start_ms; agent
    # messages have created_at. We approximate agent ordering by
    # inserting them after the transcript line whose end_ms is just
    # below their created_at (approximate but readable).
    lines: list[str] = []
    for r in rows:
        # v25.7-#2: 未识别 标 [?] 提醒 LLM 这句不可借此推论意图
        speaker = name_by_user.get(r.speaker_user_id) if r.speaker_user_id else "[?]"
        lines.append(f"[{_fmt_ms(r.start_ms)}] {speaker}: {r.text.strip()}")
    if agent_msgs:
        # Just append agent messages at the end with an "AI 专家发言" divider —
        # exact interleaving not critical for the summary task.
        lines.append("")
        lines.append("--- AI 专家发言 ---")
        for m in agent_msgs:
            agent_name = name_by_agent.get(m.agent_id, "AI 专家")
            lines.append(f"[AI · {agent_name}]: {m.text.strip()}")
    return "\n".join(lines)


def _fmt_ms(ms: Optional[int]) -> str:
    if ms is None:
        return "  ?  "
    s = ms / 1000.0
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


# v25.7-#2 反幻觉:阈值显著提高,脏数据直接 skip 不调 LLM
MIN_TRANSCRIPT_LINES = 10   # 之前 3,真人测试反馈"3 句话也生成了乱编纪要"
MIN_TRANSCRIPT_CHARS = 300  # 之前 60,中文 300 字才有总结价值

# v25.7-#2: 纪要专用 LLM(qwen-max-latest 中文政务 + 结构化 + 反幻觉最强)
# 不依赖 user 在 /admin/models 里选的 model — 那个保留给 起草/问数 等快任务.
SUMMARY_MODEL_OVERRIDE = "qwen-max-latest"


async def generate_summary(
    meeting_id: uuid.UUID,
    *,
    force: bool = False,
) -> Optional[str]:
    """
    Generate a markdown summary and persist to meeting.summary_md.

    Returns the markdown on success, None when skipped (no transcripts /
    no LLM configured / content too thin). If force=False and a summary
    already exists, returns the existing one instead of regenerating.

    'Too thin' detection: testers reported the LLM was happily filling
    out the 8-section template even for one-word meetings. We now require
    >=MIN_TRANSCRIPT_LINES final ASR sentences AND >=MIN_TRANSCRIPT_CHARS
    of total text; below that we write a marker the front-end shows as
    'skipped' instead of producing a hallucinated summary.
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return None
        if not force and meeting.summary_md and not meeting.summary_md.startswith("<!--"):
            return meeting.summary_md

        # Count meaningful content before paying for an LLM call
        rows = (
            await db.execute(
                select(MeetingTranscript)
                .where(
                    MeetingTranscript.meeting_id == meeting_id,
                    MeetingTranscript.is_final.is_(True),
                )
            )
        ).scalars().all()
        n_lines = len(rows)
        total_chars = sum(len((r.text or "").strip()) for r in rows)
        if n_lines < MIN_TRANSCRIPT_LINES or total_chars < MIN_TRANSCRIPT_CHARS:
            note = (
                f"实录过短(共 {n_lines} 句, {total_chars} 字),"
                "未生成纪要。请讨论时间更长一些再试。"
            )
            await db.execute(
                update(Meeting)
                .where(Meeting.id == meeting_id)
                .values(summary_md=f"<!-- summary:skipped: {note} -->")
            )
            await db.commit()
            logger.info("summary skipped for %s: %s", meeting_id, note)
            return None

        named = await _build_named_transcript(db, meeting_id)
        if not named.strip():
            return None
        provider = await get_active_provider(db)

    if provider is None:
        logger.warning("summary_generator: no active LLM provider")
        return None

    user_prompt = (
        f"会议标题: {meeting.title or '未命名会议'}\n\n"
        f"以下是这场会议的实录:\n\n{named}"
    )

    chunks: list[str] = []
    try:
        # v25.7-#2: 强制 qwen-max-latest + temperature=0 + top_p=0.1 — 反幻觉
        async for c in stream_chat(
            provider=provider,
            system_prompt=SUMMARY_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            model_override=SUMMARY_MODEL_OVERRIDE,
            temperature=0.0,
            top_p=0.1,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("summary LLM call failed")
        return None
    except Exception:
        logger.exception("summary unexpected error")
        return None

    summary = "".join(chunks).strip()
    if not summary:
        return None

    async with SessionLocal() as db:
        await db.execute(
            update(Meeting).where(Meeting.id == meeting_id).values(summary_md=summary)
        )
        await db.commit()

    logger.info("generated summary for meeting %s (%d chars)", meeting_id, len(summary))

    # Chain: extract long-term memories from this fresh summary in the
    # background. Imported lazily to avoid cycle (memory_extractor imports
    # llm_direct, which doesn't depend on us — the cycle is just code-level).
    try:
        import asyncio
        from .memory_extractor import extract_and_store_memories
        asyncio.create_task(extract_and_store_memories(meeting_id, summary_md=summary))
    except Exception:
        logger.exception("failed to schedule memory extraction")

    # M3.0: also extract structured action items (待办事项) — separate LLM
    # pass on the same summary, so we get a queryable / checkable list.
    try:
        import asyncio
        from .action_extractor import extract_and_store_actions
        asyncio.create_task(extract_and_store_actions(meeting_id, summary_md=summary))
    except Exception:
        logger.exception("failed to schedule action extraction")

    return summary
