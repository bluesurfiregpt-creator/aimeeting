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

阅读下面这场会议的实录(带说话人姓名), 抽出真实发生过的内容, 整理成一份结构化纪要。
严格遵守以下规则:

1. 输出**纯 Markdown**, 不要包代码块。
2. 严格按下面 8 个 ## 二级标题, 即使某节为空也要列出"无"或"暂无"。
3. 内容必须忠实于实录,**不要凭空编造**。如果实录信息不足,直接写"实录中未提及"。
4. 决策、风险、待办都要标注**责任人**(如果实录中提到)和**时间节点**(如果实录中提到)。
5. 简洁: 每个 bullet 一行,直接说事实/结论, 不要解释。
6. 称呼说话人用实录中的真实姓名(如"邓西"), 不要用"用户"、"speaker_01"。

固定结构(必须每节都出现):

## 会议主题
(一句话,从对话中归纳出的核心议题)

## 概览
(2-4 句话,这场会议讨论了什么、形成了什么共识)

## 关键要点
- (要点 1)
- (要点 2)
...

## 已形成决策
- (决策内容) — 决策人: XXX
- ...
(如无决策,写"暂无明确决策")

## 分歧事项
- (谁与谁在哪点上看法不同, 各自的理由)
...
(如无分歧,写"无明显分歧")

## 风险提醒
- (风险描述) — 提出人: XXX
...

## 待办事项
- [ ] (具体事项) — 负责: XXX, 截止: YYYY-MM-DD 或"待定"
...

## 下一步建议
- (建议 1)
...
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
        speaker = name_by_user.get(r.speaker_user_id) if r.speaker_user_id else "未识别"
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


async def generate_summary(
    meeting_id: uuid.UUID,
    *,
    force: bool = False,
) -> Optional[str]:
    """
    Generate a markdown summary and persist to meeting.summary_md.

    Returns the markdown on success, None when skipped (no transcripts /
    no LLM configured / etc.). If force=False and a summary already exists,
    returns the existing one instead of regenerating.
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return None
        if not force and meeting.summary_md and not meeting.summary_md.startswith("<!--"):
            return meeting.summary_md

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
        async for c in stream_chat(
            provider=provider,
            system_prompt=SUMMARY_SYSTEM_PROMPT,
            user_prompt=user_prompt,
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
    return summary
