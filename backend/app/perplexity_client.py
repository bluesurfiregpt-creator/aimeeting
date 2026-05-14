"""
v26.13.2: Perplexity API 客户端.

Perplexity 提供 "online" 模型 (sonar / sonar-pro / sonar-reasoning-pro) ——
跟 LLM 平行, 但 自带 web search + citations. 我们 把它 当 "AI 馆长 去市场 买书"
的 入口:

  用户 query → Perplexity sonar → 返回 {synthesis_text, citations[]}
  → 沉淀草稿 → manager 审批 → 入 KB

API 文档: https://docs.perplexity.ai/reference/post_chat_completions

请求 形态 跟 OpenAI Chat Completions 兼容, 加 几个 web-search 专属 参数 (例
search_recency_filter / return_citations). 我们 用 sonar (最便宜 又 自带搜索).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.perplexity.ai"
DEFAULT_MODEL = "sonar"  # 最便宜 ($1/M input tokens), 自带 web search
DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


class PerplexityError(Exception):
    """Caller-friendly error from Perplexity API."""


@dataclass(frozen=True)
class PerplexityCitation:
    url: str
    title: Optional[str] = None


@dataclass(frozen=True)
class PerplexitySearchResult:
    """One Perplexity search call's result — synthesized answer + citations."""
    query: str
    answer: str
    citations: list[PerplexityCitation]
    model: str
    fetched_at: datetime


_SYSTEM_PROMPT = (
    "你是一个 专业 检索 助手. 用户 给 你 一个 主题, 请 联网 检索 最新 + 权威 信息, "
    "整理 成 一份 详细 综述, 至少 600 字, 用 中文. \n\n"
    "要求:\n"
    "1. 优先 引用 政府 / 学术 / 行业权威 来源.\n"
    "2. 信息 标注 时间 (例 '2024 年 X 月 发布').\n"
    "3. 用 Markdown 二级 标题 组织 几个 子话题.\n"
    "4. 末尾 不必 列 来源 URL (系统 会 自动 附在 文档 尾部).\n"
    "5. 如果 检索 不到 高质量 信息, 诚实 说 \"该 主题 公开 资料 较少\", 不要 编造."
)


async def search(
    *,
    query: str,
    api_key: str,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    recency_filter: Optional[str] = None,  # 'day' | 'week' | 'month' | 'year' | None
) -> PerplexitySearchResult:
    """
    单次 Perplexity 检索, 返回 synthesized 答案 + citations.

    错误处理: 网络异常 / 401 / 429 / 5xx → raise PerplexityError 给上层 友好 处理.
    """
    if not api_key or not api_key.strip():
        raise PerplexityError("api_key 为空 (请 在 检索 API 设置页 填 Perplexity API Key)")
    if not query or not query.strip():
        raise PerplexityError("query 为空")

    api_key = api_key.strip()
    base = (base_url or DEFAULT_BASE_URL).rstrip("/")
    model = (model or DEFAULT_MODEL).strip()

    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": query.strip()},
        ],
        "return_citations": True,  # 强制返回 citations 数组
        # temperature 不设 — sonar 默认 web-search 自带 grounding
    }
    if recency_filter:
        body["search_recency_filter"] = recency_filter

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            r = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        logger.exception("perplexity network error: %s", exc)
        raise PerplexityError(f"网络错误: {exc}") from exc

    if r.status_code == 401:
        raise PerplexityError("API Key 无效 (Perplexity 返回 401)")
    if r.status_code == 429:
        raise PerplexityError("Perplexity 端 触发 频率限速, 请 稍后 重试")
    if r.status_code >= 400:
        snippet = (r.text or "")[:300]
        raise PerplexityError(f"Perplexity HTTP {r.status_code}: {snippet}")

    try:
        payload = r.json()
    except ValueError as exc:
        raise PerplexityError(f"Perplexity 返回 非 JSON: {(r.text or '')[:200]}") from exc

    # 解析
    answer = ""
    try:
        answer = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            or ""
        ).strip()
    except (IndexError, AttributeError):
        pass
    if not answer:
        raise PerplexityError("Perplexity 返回 空答案")

    # citations 可能 是 list[str] (老 schema) 或 list[dict] (新 schema)
    raw_cits = payload.get("citations") or []
    citations: list[PerplexityCitation] = []
    for c in raw_cits[:20]:  # 最多 20 个, 防止 异常 返回
        if isinstance(c, str):
            citations.append(PerplexityCitation(url=c))
        elif isinstance(c, dict):
            u = c.get("url") or c.get("href")
            if u:
                citations.append(PerplexityCitation(
                    url=u,
                    title=c.get("title") or c.get("name"),
                ))

    logger.info(
        "perplexity search ok query=%r answer_chars=%d citations=%d model=%s",
        query[:80], len(answer), len(citations), model,
    )

    return PerplexitySearchResult(
        query=query.strip(),
        answer=answer,
        citations=citations,
        model=model,
        fetched_at=datetime.now(timezone.utc),
    )


async def test_credentials(
    api_key: str,
    base_url: Optional[str] = None,
) -> tuple[bool, str]:
    """
    用 极短 query 验证 API Key 有效. UI 上 "测试" 按钮 用.
    Return (ok, msg).
    """
    try:
        r = await search(
            query="测试: hello", api_key=api_key, base_url=base_url,
        )
        return (True, f"✓ 调用 成功, 模型 {r.model}, 返回 {len(r.answer)} 字 + {len(r.citations)} citations")
    except PerplexityError as e:
        return (False, str(e))
    except Exception as e:
        return (False, f"未知错误: {e}")
