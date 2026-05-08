"""
List available models from each LLM provider.

The provider config admin page calls this *before* saving — user pastes
an API key, hits "拉取模型列表", we hit the provider's `/models` API
with that key and return the list. The user picks one from a dropdown
instead of remembering exact model strings.

Three API shapes to handle:
- **OpenAI-compatible** (OpenAI / DeepSeek / Qwen DashScope-compat /
  most others): `GET {base_url}/models` with `Authorization: Bearer
  {key}` returns `{"data": [{"id": "..."}]}`.
- **Anthropic**: `GET {base_url}/models` with `x-api-key: {key}` and
  `anthropic-version: 2023-06-01` returns `{"data": [{"id": "...",
  "display_name": "..."}]}`.
- **Gemini**: `GET {base_url}/models?key={key}` returns `{"models":
  [{"name": "models/gemini-...", "supportedGenerationMethods": [...]}]}`
  — we keep only models that support `generateContent`.

Each provider returns errors gracefully so the UI can fall back to the
free-text Model ID field if anything goes wrong.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelEntry:
    id: str
    label: Optional[str] = None


class ListModelsError(Exception):
    """Caller-friendly error returned by list_models()."""


_TIMEOUT = httpx.Timeout(15.0, connect=10.0)


async def list_models(
    provider: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> list[ModelEntry]:
    """Dispatch to the right provider implementation."""
    # httpx rejects header values containing whitespace ("Illegal header
    # value"). Stripped data may have been saved by older versions, by
    # an env var with trailing newline, or by sloppy paste.
    api_key = (api_key or "").strip()
    if not api_key:
        raise ListModelsError("api_key required")
    if base_url:
        base_url = base_url.strip()

    if provider in ("openai", "deepseek", "qwen"):
        return await _list_openai_compat(api_key, base_url or _default_base_url(provider))
    if provider == "anthropic":
        return await _list_anthropic(api_key, base_url or "https://api.anthropic.com/v1")
    if provider == "gemini":
        return await _list_gemini(api_key, base_url or "https://generativelanguage.googleapis.com/v1beta")

    raise ListModelsError(f"unsupported provider: {provider}")


def _default_base_url(provider: str) -> str:
    return {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com/v1",
        "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }[provider]


async def _list_openai_compat(api_key: str, base_url: str) -> list[ModelEntry]:
    url = base_url.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ListModelsError(f"network error: {exc}") from exc
    if r.status_code != 200:
        raise ListModelsError(f"{r.status_code}: {r.text[:200]}")
    try:
        payload = r.json()
    except ValueError as exc:
        raise ListModelsError(f"invalid JSON from {url}") from exc
    data = payload.get("data") or []
    out: list[ModelEntry] = []
    for it in data:
        mid = it.get("id")
        if not mid:
            continue
        out.append(ModelEntry(id=mid, label=it.get("display_name") or it.get("name")))
    out.sort(key=lambda m: m.id)
    return out


async def _list_anthropic(api_key: str, base_url: str) -> list[ModelEntry]:
    url = base_url.rstrip("/") + "/models"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ListModelsError(f"network error: {exc}") from exc
    if r.status_code != 200:
        raise ListModelsError(f"{r.status_code}: {r.text[:200]}")
    try:
        payload = r.json()
    except ValueError as exc:
        raise ListModelsError(f"invalid JSON from {url}") from exc
    data = payload.get("data") or []
    out: list[ModelEntry] = []
    for it in data:
        mid = it.get("id")
        if not mid:
            continue
        out.append(ModelEntry(id=mid, label=it.get("display_name")))
    out.sort(key=lambda m: m.id, reverse=True)  # newest first by id convention
    return out


async def _list_gemini(api_key: str, base_url: str) -> list[ModelEntry]:
    url = base_url.rstrip("/") + "/models"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(url, params={"key": api_key})
    except httpx.HTTPError as exc:
        raise ListModelsError(f"network error: {exc}") from exc
    if r.status_code != 200:
        raise ListModelsError(f"{r.status_code}: {r.text[:200]}")
    try:
        payload = r.json()
    except ValueError as exc:
        raise ListModelsError(f"invalid JSON from {url}") from exc
    out: list[ModelEntry] = []
    for it in payload.get("models") or []:
        full_name = it.get("name") or ""  # e.g. "models/gemini-2.0-flash"
        if not full_name:
            continue
        # Skip models that don't generate content (embeddings etc.)
        methods = it.get("supportedGenerationMethods") or []
        if "generateContent" not in methods:
            continue
        # Trim "models/" prefix — that's what generateContent calls expect
        mid = full_name.split("/", 1)[1] if "/" in full_name else full_name
        out.append(ModelEntry(id=mid, label=it.get("displayName")))
    out.sort(key=lambda m: m.id)
    return out
