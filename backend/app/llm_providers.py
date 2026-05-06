"""
LLM provider registry.

The user wants a single admin UI where they configure multiple providers
(Qwen / OpenAI / Anthropic / DeepSeek / Gemini), pick one as the active
default, and have the rest of the backend (summary generation, briefing,
memory extraction) call whatever's active without rewiring code.

Dify handles its own model selection internally; this registry is for
*direct* LLM calls our backend makes outside of Dify.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ProviderName = Literal["qwen", "openai", "anthropic", "deepseek", "gemini"]


@dataclass(frozen=True)
class ProviderSpec:
    name: ProviderName
    label: str
    default_base_url: str
    default_model: str
    api_key_help: str
    docs_url: str


# Static catalog. Anything user-editable (key/model_id) lives in DB; this is
# only for "what providers does the UI know about".
SUPPORTED_PROVIDERS: list[ProviderSpec] = [
    ProviderSpec(
        name="qwen",
        label="通义千问 (DashScope)",
        default_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus",
        api_key_help="阿里云 DashScope key,以 sk- 开头(可与 STT 共用)",
        docs_url="https://help.aliyun.com/zh/dashscope/",
    ),
    ProviderSpec(
        name="openai",
        label="OpenAI",
        default_base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        api_key_help="OpenAI API key,以 sk- 开头",
        docs_url="https://platform.openai.com/api-keys",
    ),
    ProviderSpec(
        name="anthropic",
        label="Anthropic Claude",
        default_base_url="https://api.anthropic.com/v1",
        default_model="claude-sonnet-4-6",
        api_key_help="Anthropic API key,以 sk-ant- 开头",
        docs_url="https://console.anthropic.com/settings/keys",
    ),
    ProviderSpec(
        name="deepseek",
        label="DeepSeek",
        default_base_url="https://api.deepseek.com/v1",
        default_model="deepseek-chat",
        api_key_help="DeepSeek API key",
        docs_url="https://platform.deepseek.com/api_keys",
    ),
    ProviderSpec(
        name="gemini",
        label="Google Gemini",
        default_base_url="https://generativelanguage.googleapis.com/v1beta",
        default_model="gemini-2.0-flash",
        api_key_help="Google AI Studio API key",
        docs_url="https://aistudio.google.com/apikey",
    ),
]


def get_spec(name: str) -> ProviderSpec | None:
    for s in SUPPORTED_PROVIDERS:
        if s.name == name:
            return s
    return None
