"""
v24.1 #6 — AI 辅助起草汇报.

智慧住建文档 §4.3:
> 阶段性上报...在此过程中可唤起 AI 专家辅助起草汇报.

输入:
  - Task 原文(content)
  - 协办进度(TaskCoProgress 历史)
  - 评论历史(MeetingActionItemComment,若 source_type='meeting')
  - 旧 submission_payload(若已经写过一版)

输出 JSON:
  {"completed": "...", "problems": "...", "next_steps": "..."}

每段 1-3 句,精炼.用户拿到草稿后可在 SubmitDialog 里继续编辑再提交.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import (
    MeetingActionItem,
    MeetingActionItemComment,
    Task,
    TaskCoProgress,
    User,
)

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """你是「政务阶段汇报起草助手」.基于给定的任务正文 + 协作历史,
起草一份**阶段性汇报**草稿.

# 输出严格 JSON 格式(不要 markdown 围栏,不要解释,不要其他字符):
{
  "completed": "已完成工作摘要(1-3 句)",
  "problems": "当前问题/风险(0-3 句;若无问题写「暂无」)",
  "next_steps": "下一步计划(1-3 句)"
}

# 风格要求:
- 政务公文风格,简洁、客观、可量化(尽量给具体数字 / 时间节点)
- 不要重复任务原文里的描述;聚焦「最近做了什么 + 接下来打算」
- 不要编造没说过的事;若协作历史很少,「completed」可以写「项目刚启动,
  正在调研收资」之类的诚实描述
- "暂无" 是允许的回答(尤其 problems 字段)

# 特别注意:
- 即使输入信息有限,也要按格式输出 3 个非空字段(可以语气保守)
- 不要返回数组、嵌套对象、或 markdown."""


_DRAFT_LEN_LIMIT = 600  # 单字段长度上限,LLM 偶尔啰嗦,截断兜底


def _safe_parse_json_obj(s: str) -> Optional[dict[str, Any]]:
    """容忍 LLM 偶尔在 JSON 外面包 ```json ... ``` 或多行解释."""
    if not s:
        return None
    # 抓第一个 {...}
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _truncate(s: Any) -> str:
    if not isinstance(s, str):
        return ""
    return s.strip()[:_DRAFT_LEN_LIMIT]


async def draft_submission(
    session: AsyncSession,
    *,
    workspace_id,
    task: Task,
) -> tuple[Optional[dict[str, str]], Optional[str]]:
    """
    Returns (drafts, error).
    drafts = {"completed", "problems", "next_steps"} 都是 string,长度 ≤ 600.
    error = 字符串错误描述(LLM 失败 / 配置缺失等);drafts=None 时必有 error.
    """
    provider = await get_active_provider(session)
    if provider is None:
        return (None, "未配置可用的 LLM Provider")

    # 收集协作历史(给 LLM 上下文)
    co_rows = (
        await session.execute(
            select(TaskCoProgress, User.name)
            .join(User, User.id == TaskCoProgress.co_assignee_user_id)
            .where(TaskCoProgress.task_id == task.id)
            .order_by(TaskCoProgress.submitted_at.desc())
            .limit(10)
        )
    ).all()

    comment_rows: list[tuple[MeetingActionItemComment, Optional[str]]] = []
    if task.source_type == "meeting":
        # 通过 action_item.task_id == task.id 找回 comments(若有)
        ai_id = (
            await session.execute(
                select(MeetingActionItem.id).where(MeetingActionItem.task_id == task.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if ai_id:
            comment_rows = (
                await session.execute(
                    select(MeetingActionItemComment, User.name)
                    .join(
                        User,
                        User.id == MeetingActionItemComment.author_user_id,
                        isouter=True,
                    )
                    .where(MeetingActionItemComment.action_item_id == ai_id)
                    .order_by(MeetingActionItemComment.created_at)
                    .limit(20)
                )
            ).all()

    # 旧 submission_payload(若有)
    prior = (
        task.source_ref.get("submission_payload")
        if isinstance(task.source_ref, dict)
        else None
    )

    # 拼 user_prompt
    parts: list[str] = []
    parts.append(f"# 任务正文\n{task.content[:1500]}")
    if task.title:
        parts.insert(0, f"# 任务标题\n{task.title}")
    if co_rows:
        parts.append("# 协办交付历史(最近 10 条):")
        for cp, name in co_rows:
            parts.append(
                f"- {name or '(协办)'} @ {cp.submitted_at.isoformat() if cp.submitted_at else '-'}: "
                f"{(cp.content or '').strip()[:300]}"
            )
    if comment_rows:
        parts.append("# 协作评论(按时间序):")
        for c, name in comment_rows:
            parts.append(
                f"- {name or '(已删用户)'} @ {c.created_at.isoformat()}: {c.content[:300]}"
            )
    if prior:
        parts.append("# 之前的汇报(供参考,可基于此更新):")
        if prior.get("completed"):
            parts.append(f"  上次已完成:{prior['completed'][:300]}")
        if prior.get("problems"):
            parts.append(f"  上次问题:{prior['problems'][:300]}")
        if prior.get("next_steps"):
            parts.append(f"  上次下一步:{prior['next_steps'][:300]}")
    user_prompt = "\n\n".join(parts)

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError as exc:
        logger.exception("submission_drafter LLM call failed")
        return (None, f"LLM 调用失败: {exc}")

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if parsed is None:
        logger.warning("submission_drafter: bad LLM output: %r", raw[:300])
        return (None, "LLM 返回格式异常,请重试或手动填写")

    drafts = {
        "completed": _truncate(parsed.get("completed", "")),
        "problems": _truncate(parsed.get("problems", "")),
        "next_steps": _truncate(parsed.get("next_steps", "")),
    }
    if not any(drafts.values()):
        return (None, "LLM 未生成有效内容,请手动填写")
    return (drafts, None)
