"""
v19 — 领导指令(自然语言)→ 结构化 Task 草稿 拆解器.

复用了 `action_extractor` 的 LLM 调用 / `_match_user` / `_parse_due`,
但 prompt 形态不同:action_extractor 是从「会议纪要」里抽,这里是从
「单条指令」里拆。指令里通常已经显式说了负责人和截止时间(政务公文
风格),拆解的关键是把「一句指令拆成多条任务 / 不要漏关键截止 /
正确识别科室名/人名」。

输出形态(本模块返回的 Python dict 列表,直接序列化为 LeaderDirective.parsed_drafts):
[
  {
    "content": "提交小散工程上半年安全检查报告",
    "title": null,                            # 可选短标题
    "assignee_name": "王科长",                # 原文中识别到的负责人/科室名
    "assignee_user_id": "<uuid>" | null,     # 用 _match_user 弱匹配后绑定;失败 null
    "due_at": "2026-05-15"                    # ISO 日期字符串;无则 null
  },
  ...
]

设计选择:
- 同步调用,等 LLM 返回(5-15s);v20 再考虑异步队列
- 拆解失败 / LLM 不可用时返回空 list,调用方写 LeaderDirective.parse_error
- 不入库,只返回纯 dict — 由 router 层决定写不写 LeaderDirective
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .action_extractor import _match_user, _parse_due, _safe_parse_json_obj
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import User

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """你是一名公文/指令拆解助手。把下面的自然语言指令拆解成 1 个或多个**结构化任务**.

**严格 JSON 单行**输出,不要包代码块,不要其他文字:
{"tasks": [{"content": "<任务描述,简短一句>", "title": "<可选,<=20 字>", "assignee_name": "<负责人姓名/科室名,可空字符串>", "due_at": "YYYY-MM-DD 或空字符串"}]}

**拆解必须**满足:
1. **每条任务必须是明确的工作动作**(动词 + 对象);不要拆出「通知/讨论/沟通」这类空话.
2. **assignee_name 只能从原文精确抽取**,不能编造;原文写「全员」「相关同志」「视情况」「下属」时,留空字符串.
3. **due_at 只有原文明文给出 deadline 才填**(本周五 / 5 月 15 日 / 月底 等可推算的也算);相对时间不可推算时留空字符串.
4. 一条指令通常拆出 **1-3 条**任务,不要过度拆解(把同一目标的两步骤拆成两条是 OK 的;把陈述句拆成 5 条不行).
5. content 要简短可执行,不要把「关于…的安排」这类公文修饰也搬过来.

**绝对不要**:
- 拆出「研究/学习/重视/加强」这类无具体动作的话.
- 把指令的开头称谓/客套话当成任务.
- 凭空补充原文没有的负责人或截止日期.

**没有任何可拆任务时,必须返回** `{"tasks": []}`,空列表是合法且优先的输出.

示例 1 (典型政务指令 → 拆出 1 条):
输入:「请王科长在本周五前提交一份小散工程上半年安全检查报告.」
输出: {"tasks": [
  {"content":"提交小散工程上半年安全检查报告","title":"","assignee_name":"王科长","due_at":""}
]}
(due_at 留空因为「本周五」是相对时间,模型不知道今天是哪天)

示例 2 (含明确日期 + 多条):
输入:「李主任,5月15日前完成下半年预算初稿;张科长同步起草一份招标公告.」
输出: {"tasks": [
  {"content":"完成下半年预算初稿","title":"","assignee_name":"李主任","due_at":"2026-05-15"},
  {"content":"起草招标公告","title":"","assignee_name":"张科长","due_at":""}
]}

示例 3 (空话 → 空):
输入:「大家辛苦,要继续重视安全生产工作.」
输出: {"tasks": []}
"""


async def parse_directive(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    content: str,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """
    Parse a natural-language directive into draft Task dicts.

    Returns (drafts, error_message). If the LLM call fails, drafts is []
    and error_message carries a short human-readable reason. The caller
    should still persist a LeaderDirective row so the user can see the
    failure state and retry.
    """
    text = (content or "").strip()
    if not text:
        return ([], "指令内容为空")

    provider = await get_active_provider(session)
    if provider is None:
        return ([], "未配置可用的 LLM Provider")

    # Load workspace users for assignee fuzzy match.
    ws_users: list[User] = (
        await session.execute(
            select(User).where(User.workspace_id == workspace_id)
        )
    ).scalars().all()

    user_prompt = f"指令原文:\n\n{text}"
    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError as exc:
        logger.exception("directive_parser LLM call failed")
        return ([], f"LLM 调用失败: {exc}")

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    items = (parsed or {}).get("tasks") if parsed else None
    if not isinstance(items, list):
        # Empty list is fine (LLM said no tasks); other shapes mean
        # the LLM didn't follow contract.
        if parsed is not None:
            logger.warning("directive_parser: bad shape %r", parsed)
            return ([], "LLM 返回格式异常,请重试")
        return ([], "LLM 未返回有效 JSON")

    drafts: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        c = (it.get("content") or "").strip()
        if not c:
            continue
        title = (it.get("title") or "").strip()
        assignee_name = (it.get("assignee_name") or "").strip()
        due_str = (it.get("due_at") or "").strip()
        assignee_user_id = _match_user(ws_users, assignee_name)
        due_at_dt = _parse_due(due_str)
        drafts.append(
            {
                "content": c[:1000],
                "title": title[:64] if title else None,
                "assignee_name": assignee_name[:128] if assignee_name else None,
                "assignee_user_id": str(assignee_user_id) if assignee_user_id else None,
                "due_at": due_at_dt.date().isoformat() if due_at_dt else None,
            }
        )
    return (drafts, None)
