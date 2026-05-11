"""
Extract action items from a finished meeting's summary.

Runs after `summary_generator.generate_summary()` succeeds (chained the same
way memory_extractor already is). Reads the summary's 待办事项 + 关键决策
sections, asks the active LLM for a structured JSON list of TODOs, fuzzy-
matches each assignee text to a workspace user, and inserts into
`meeting_action_item`.

Idempotency: before inserting, we delete existing rows with `source_type =
'summary'` for this meeting (manual / agent-added items survive). This way
calling /summary/regenerate cleanly replaces auto-extracted items without
touching anything the user manually added.

LLM output contract:
{
  "items": [
    {"content": "...", "assignee_name": "...", "due_at": "YYYY-MM-DD" | null}
  ]
}
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Meeting, MeetingActionItem, User
from .task_sync import add_action_with_task, delete_tasks_for_meeting_summary_actions

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """你是一名会议秘书。从会议纪要里抽取 **确定要做** 的工作型待办行动项 (Action Items).

**严格 JSON 单行** 输出,不要包代码块,不要任何其他文字:
{"items": [{"content": "<待办内容,简短>", "assignee_name": "<负责人姓名,可空字符串>", "due_at": "YYYY-MM-DD 或空字符串"}]}

【最高优先级 反幻觉规则】违反任一条 都比 不抽 更糟:

A. **每条 content 必须能在纪要原文找到对应字句来源**.找不到来源的 → 一律 不抽.
B. **严禁补全 / 演绎 / 总结引申**.即使你认为"按常理这场会议应该会做 X",纪要没明确写 → 不抽.
C. **assignee_name 必须从原文精确抽取**.原文没出现的人名 → 留空字符串.严禁编造姓名.
D. **due_at 只接受 纪要原文明文写出的日期**(如 "5月20日"、"2025-06-12").
   原文没明确 deadline → due_at 必须留 空字符串.**严禁编造日期 / 倒推日期 / 默认今天**.
E. **AI 专家发言不算 工作待办依据**.如果纪要里出现 "AI 专家说..."、"AI 建议..."、
   "根据 AI 建议..." 类语言 — 这是 AI 助手的建议,不是真人承诺.**忽略**,不抽.
F. **闲聊 / 私人安排 / 模糊想法 / 没有清晰承诺**: 一律不抽.

**没有符合的工作待办时,必须返回** `{"items": []}`.空列表是合法且优先的输出.

抽取必须全部满足:
1. 明确的工作/项目相关行动(动词 + 对象).
2. 明确的负责人(出现的人名 / 角色 / 团队名);否则跳过.
3. 一句一项,不要把多件事塞一起.

【典型反例 — 不要这样做】
反例 1:纪要里 AI 专家说 "建议组织对齐 Figma 变量命名" → **不能抽** (AI 建议不算).
反例 2:纪要写 "本月底前提交" 但没说具体日期 → due_at 留空,**不要编**成 "2024-06-12".
反例 3:纪要没出现 "邓西" 但你觉得他应该负责 → assignee_name 留空,**不要瞎填**.

示例 1 (闲聊 + AI 建议 → 空):
输入: 「今天天气不错。AI 专家建议先聚焦深圳政策。中午去吃拉面吧。」
输出: {"items": []}

示例 2 (真人承诺 → 抽):
输入: 「邓西负责本周五前提交 PRD V2。中午去吃拉面。李法务下周三前出合规意见。」
输出: {"items": [
  {"content":"提交 PRD V2","assignee_name":"邓西","due_at":""},
  {"content":"出具合规意见","assignee_name":"李法务","due_at":""}
]}
(注意:吃拉面被剔除;due_at 因「下周三前」是相对时间没法确定具体日期 → 留空,严禁编)
"""


# How many of an assignee_name's chars must match a known user.name to bind.
_MIN_NAME_OVERLAP = 0.6


async def extract_and_store_actions(
    meeting_id: uuid.UUID,
    *,
    summary_md: Optional[str] = None,
) -> int:
    """
    Returns count of action items inserted. 0 means none extractable
    (which is normal for many meetings — not all have explicit TODOs).

    `summary_md` is optional — if not passed, we re-load from DB.
    """
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if m is None:
            return 0
        if summary_md is None:
            summary_md = m.summary_md
        if not summary_md or summary_md.startswith("<!--"):
            return 0

        provider = await get_active_provider(db)
        if provider is None:
            logger.warning("action_extractor: no active LLM provider")
            return 0

        # Load workspace users for fuzzy assignee matching
        ws_users: list[User] = []
        if m.workspace_id is not None:
            ws_users = (
                await db.execute(
                    select(User).where(User.workspace_id == m.workspace_id)
                )
            ).scalars().all()

        user_prompt = (
            f"会议标题: {m.title or '未命名会议'}\n\n"
            f"会议纪要 (Markdown):\n\n{summary_md}"
        )

        chunks: list[str] = []
        try:
            # v25.11: 用 qwen-max + temperature=0 + top_p=0.1 反幻觉
            async for c in stream_chat(
                provider=provider,
                system_prompt=_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                model_override="qwen-max-latest",
                temperature=0.0,
                top_p=0.1,
            ):
                chunks.append(c)
        except LlmError:
            logger.exception("action_extractor LLM call failed")
            return 0

        raw = "".join(chunks).strip()
        parsed = _safe_parse_json_obj(raw)
        items = (parsed or {}).get("items") if parsed else None
        if not items or not isinstance(items, list):
            logger.info("action_extractor: meeting %s — no items extracted", meeting_id)
            # Still wipe stale auto-extracted items so a previous extraction
            # that DID find items doesn't linger.
            await db.execute(
                delete(MeetingActionItem).where(
                    MeetingActionItem.meeting_id == meeting_id,
                    MeetingActionItem.source_type == "summary",
                )
            )
            await db.commit()
            return 0

        # v17: clean up the summary-source rows AND their paired Tasks before
        # the replace-all insert. Order matters: drop Tasks first (while
        # action.task_id still points at them), then drop the actions.
        await delete_tasks_for_meeting_summary_actions(db, meeting_id)
        await db.execute(
            delete(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.source_type == "summary",
            )
        )

        inserted = 0
        for it in items:
            content = (it.get("content") or "").strip()
            if not content:
                continue
            assignee_name = (it.get("assignee_name") or "").strip()
            due_str = (it.get("due_at") or "").strip()
            assignee_user_id = _match_user(ws_users, assignee_name)

            # v17 dual-write: every summary-extracted action also creates
            # its 1:1 Task (source_type='meeting'). The helper picks ids
            # client-side so cross-linking is one transaction.
            add_action_with_task(
                db,
                workspace_id=m.workspace_id,
                meeting_id=meeting_id,
                content=content[:1000],
                assignee_user_id=assignee_user_id,
                assignee_name_hint=(
                    assignee_name[:128]
                    if assignee_name and assignee_user_id is None
                    else None
                ),
                due_at=_parse_due(due_str),
                status="open",
                action_source_type="summary",
                created_by_user_id=None,  # extractor is system-driven
            )
            inserted += 1

        await db.commit()
        logger.info(
            "action_extractor: meeting %s — inserted %d action items", meeting_id, inserted
        )
        return inserted


def _match_user(users: list[User], name_text: str) -> Optional[uuid.UUID]:
    """Best-effort fuzzy match. Empty / vague (全员 / 待定) → None."""
    if not name_text:
        return None
    cleaned = name_text.strip().lower()
    if cleaned in {"全员", "待定", "tbd", "n/a", "无", "暂无"}:
        return None
    # 1) exact match
    for u in users:
        if u.name and u.name.strip().lower() == cleaned:
            return u.id
    # 2) substring containment either way
    for u in users:
        n = (u.name or "").strip().lower()
        if not n:
            continue
        if n in cleaned or cleaned in n:
            return u.id
    return None


def _parse_due(s: str) -> Optional[datetime]:
    """Accept 'YYYY-MM-DD' (assume UTC midnight). Anything else → None."""
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s.strip())
    if not m:
        return None
    try:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return datetime(y, mo, d, tzinfo=timezone.utc)
    except ValueError:
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
