"""
v24.2 #3 — 公文智能审核.

智慧住建文档 §3.3 公文智能审核:
> 输入:待审核文稿 → 格式检查 → 用语规范检测 → 政策引用校验
> 输出:审核意见 + 修改建议

3 维 LLM 审核:
  - format   格式(标题层级 / 段落结构 / 标点 / 起承转合)
  - wording  用语规范(口语化 / 敬语 / 长句拆分 / 错别字)
  - policy   政策引用(提到法规但未明引则 medium 警告;v25 接政策库精确校验)

输出每条问题 {severity, category, location, issue, suggestion} + 总评.

不修改原文,只产出审核报告.客户可基于报告手工或半自动改稿.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .llm_direct import LlmError, get_active_provider, stream_chat

logger = logging.getLogger(__name__)


_MAX_TEXT_CHARS = 20_000   # 长文截断,防 LLM 超 context
_MAX_ISSUES_RETURN = 50    # LLM 偶尔啰嗦,截断


_SYSTEM_PROMPT = """你是「政务公文智能审核助手」.审核给定文稿,**严格 JSON**
返回所有问题(不要 markdown 围栏,不要解释):

{
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "format|wording|policy",
      "location": "出现在哪段(描述位置,如「开头第 1 段」「第 3 段第 2 句」)",
      "issue": "问题简述(20 字内)",
      "suggestion": "修改建议(40 字内)"
    }
  ],
  "overall": "整体评价 1-2 句"
}

# 三维审核标准

## format(格式)
- 标题层级混乱(.如「一、(一)1.」错位)
- 段落结构松散(无明显起承转合)
- 标点错误(中英混用 / 句号缺失)
- 数字 / 日期格式不规范(如「2025-1-1」应「2025 年 1 月 1 日」)

## wording(用语规范)
- 口语化(如「搞」「弄」「咱」)
- 用词不准(如「大概有 30 户」应「30 户」或「约 30 户」)
- 长句无拆分(>50 字一句)
- 缺主谓宾的省略句
- 错别字 / 同音错字

## policy(政策引用)
- 提到法规但未给文号(如「按规定」「相关条例」)
- 引用文号格式不规范(如「深住建[2024]15 号」应「深住建发〔2024〕15 号」)
- 引用过时文号(暂不校验,留 hook)

# 严重度判定
- high:歧义 / 政策引用错误 / 数字事实
- medium:格式松散 / 长句 / 不规范引用
- low:小标点 / 措辞优化建议

# 输出规则
- issues 列表按 severity 降序(high → low)
- 没问题时 issues=[],overall="文稿规范,无明显问题"
- 不要修改原文 — 只产出审核报告"""


def _safe_parse_json_obj(s: str) -> Optional[dict[str, Any]]:
    if not s:
        return None
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


_VALID_SEVERITIES = {"high", "medium", "low"}
_VALID_CATEGORIES = {"format", "wording", "policy"}


async def audit_document(
    session: AsyncSession, text: str
) -> dict[str, Any]:
    """
    Returns:
      {
        "issues": [...],
        "overall": "...",
        "audited_chars": int,
        "truncated": bool,
        "fallback_used": bool,
        "error": Optional[str],
      }
    """
    text = (text or "").strip()
    if not text:
        return {
            "issues": [],
            "overall": "(空文档,无审核结果)",
            "audited_chars": 0,
            "truncated": False,
            "fallback_used": False,
            "error": None,
        }

    truncated = len(text) > _MAX_TEXT_CHARS
    text_for_llm = text[:_MAX_TEXT_CHARS]

    provider = await get_active_provider(session)
    if provider is None:
        return {
            "issues": [],
            "overall": "未配置可用的 LLM Provider,无法审核",
            "audited_chars": len(text_for_llm),
            "truncated": truncated,
            "fallback_used": True,
            "error": "no_provider",
        }

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=f"# 待审核文稿\n\n{text_for_llm}",
        ):
            chunks.append(c)
    except LlmError as exc:
        logger.warning("document_audit: LLM call failed: %s", exc)
        return {
            "issues": [],
            "overall": f"LLM 调用失败: {exc}",
            "audited_chars": len(text_for_llm),
            "truncated": truncated,
            "fallback_used": True,
            "error": str(exc),
        }

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if parsed is None:
        logger.warning("document_audit: bad LLM output: %r", raw[:300])
        return {
            "issues": [],
            "overall": "LLM 返回格式异常,请重试",
            "audited_chars": len(text_for_llm),
            "truncated": truncated,
            "fallback_used": True,
            "error": "bad_llm_format",
        }

    raw_issues = parsed.get("issues") or []
    if not isinstance(raw_issues, list):
        raw_issues = []
    cleaned: list[dict[str, str]] = []
    for it in raw_issues[:_MAX_ISSUES_RETURN]:
        if not isinstance(it, dict):
            continue
        sev = (it.get("severity") or "low").lower()
        cat = (it.get("category") or "wording").lower()
        if sev not in _VALID_SEVERITIES:
            sev = "low"
        if cat not in _VALID_CATEGORIES:
            cat = "wording"
        loc = (it.get("location") or "").strip()[:200]
        issue = (it.get("issue") or "").strip()[:200]
        suggestion = (it.get("suggestion") or "").strip()[:300]
        if not issue:
            continue
        cleaned.append(
            {
                "severity": sev,
                "category": cat,
                "location": loc,
                "issue": issue,
                "suggestion": suggestion,
            }
        )

    # 排序:high > medium > low
    sev_order = {"high": 0, "medium": 1, "low": 2}
    cleaned.sort(key=lambda x: sev_order.get(x["severity"], 3))

    overall = (parsed.get("overall") or "").strip()[:300]
    if not overall:
        overall = "文稿规范,无明显问题" if not cleaned else f"发现 {len(cleaned)} 条问题"

    return {
        "issues": cleaned,
        "overall": overall,
        "audited_chars": len(text_for_llm),
        "truncated": truncated,
        "fallback_used": False,
        "error": None,
    }
