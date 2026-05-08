"""
Direct LLM streaming client.

Bypasses Dify and talks straight to the active model_provider_config row.
Supports any provider that exposes an OpenAI-compatible /chat/completions
endpoint with SSE streaming — that covers Qwen (DashScope compatible mode),
OpenAI, DeepSeek, and Gemini's OpenAI-compat endpoint. Anthropic uses a
different wire format and is handled separately.

We use this when an Agent has NO Dify key configured — the simpler path
matches the user's request: configure persona in our admin UI, pick an
active LLM provider, that's it.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ModelProviderConfig

logger = logging.getLogger(__name__)


class LlmError(RuntimeError):
    pass


async def get_active_provider(db: AsyncSession) -> Optional[ModelProviderConfig]:
    return (
        await db.execute(
            select(ModelProviderConfig).where(ModelProviderConfig.is_active.is_(True))
        )
    ).scalar_one_or_none()


async def stream_chat(
    *,
    provider: ModelProviderConfig,
    system_prompt: str,
    user_prompt: str,
) -> AsyncIterator[str]:
    """Yields response text chunks. Raises LlmError on failure."""
    if provider.provider == "anthropic":
        async for chunk in _stream_anthropic(provider, system_prompt, user_prompt):
            yield chunk
        return
    async for chunk in _stream_openai_compatible(provider, system_prompt, user_prompt):
        yield chunk


# ----- OpenAI-compatible (Qwen / OpenAI / DeepSeek / Gemini) ------------------

async def _stream_openai_compatible(
    provider: ModelProviderConfig,
    system_prompt: str,
    user_prompt: str,
) -> AsyncIterator[str]:
    base = (provider.base_url or "").rstrip("/")
    # Qwen DashScope's OpenAI-compatible mode adds /chat/completions under
    # /compatible-mode/v1; OpenAI is /v1/chat/completions; DeepSeek same.
    # Gemini's OpenAI-compat endpoint is /v1beta/openai/chat/completions —
    # if user pointed base_url at the Gemini native endpoint we transparently
    # add /openai.
    if "googleapis.com" in base and "/openai" not in base:
        if base.endswith("/v1beta"):
            url = base + "/openai/chat/completions"
        else:
            url = base + "/v1beta/openai/chat/completions"
    else:
        url = base + "/chat/completions"

    body = {
        "model": provider.model_id or _default_model(provider.provider),
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    # Strip whitespace defensively — pasted keys often have trailing
    # newlines, and httpx refuses to send a header value with whitespace.
    headers = {
        "Authorization": f"Bearer {(provider.api_key or '').strip()}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as c:
        async with c.stream("POST", url, json=body, headers=headers) as r:
            if r.status_code >= 400:
                text = (await r.aread()).decode("utf-8", "ignore")
                raise LlmError(f"{provider.provider} {r.status_code}: {text[:300]}")
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload == "[DONE]":
                    return
                try:
                    d = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                # OpenAI-shape: choices[0].delta.content
                try:
                    delta = d["choices"][0].get("delta") or {}
                    chunk = delta.get("content")
                except (KeyError, IndexError, TypeError):
                    chunk = None
                if chunk:
                    yield chunk


# ----- Anthropic ---------------------------------------------------------------

async def _stream_anthropic(
    provider: ModelProviderConfig,
    system_prompt: str,
    user_prompt: str,
) -> AsyncIterator[str]:
    base = (provider.base_url or "https://api.anthropic.com/v1").rstrip("/")
    # /messages is the canonical endpoint
    url = base + ("/messages" if not base.endswith("/messages") else "")
    body: dict[str, Any] = {
        "model": provider.model_id or "claude-sonnet-4-6",
        "max_tokens": 1024,
        "stream": True,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    headers = {
        "x-api-key": (provider.api_key or "").strip(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as c:
        async with c.stream("POST", url, json=body, headers=headers) as r:
            if r.status_code >= 400:
                text = (await r.aread()).decode("utf-8", "ignore")
                raise LlmError(f"anthropic {r.status_code}: {text[:300]}")
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload:
                    continue
                try:
                    d = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if d.get("type") == "content_block_delta":
                    delta = d.get("delta") or {}
                    chunk = delta.get("text")
                    if chunk:
                        yield chunk
                elif d.get("type") == "message_stop":
                    return


def _default_model(provider: str) -> str:
    return {
        "qwen": "qwen-plus",
        "openai": "gpt-4o-mini",
        "anthropic": "claude-sonnet-4-6",
        "deepseek": "deepseek-chat",
        "gemini": "gemini-2.0-flash",
    }.get(provider, "gpt-4o-mini")
