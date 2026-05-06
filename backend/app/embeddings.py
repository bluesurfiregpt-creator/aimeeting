"""
Embedding client.

We need 1536-dim vectors (matching the pgvector column on long_term_memory).
DashScope's `text-embedding-v2` returns exactly 1536 dims and the user
already has a DashScope key (shared with STT), so embeddings stay free of
extra signups. The OpenAI-compatible endpoint at
`/compatible-mode/v1/embeddings` accepts the same auth header.

If the user later wants OpenAI's text-embedding-3-small (also 1536 dim),
they just add an OpenAI key to model_provider_config and we can route
embeddings to it — but this module deliberately keeps embeddings on
DashScope today since *some* working embedding source must always exist
regardless of which chat LLM the user picks.
"""

from __future__ import annotations

import logging
from typing import Sequence

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)

EMBED_DIM = 1536
EMBED_MODEL = "text-embedding-v2"
DASHSCOPE_OPENAI_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class EmbeddingError(RuntimeError):
    pass


async def compute_embeddings(texts: Sequence[str]) -> list[list[float]]:
    """
    Returns one 1536-dim vector per input string. Empty strings yield a
    zero vector so caller logic can stay loop-free.
    """
    settings = get_settings()
    if not settings.dashscope_api_key:
        raise EmbeddingError("DashScope API key not configured")

    inputs: list[str] = [t if t and t.strip() else "" for t in texts]
    # DashScope's openai-compat /embeddings rejects empty strings; substitute
    # a neutral filler and overwrite with zeros after the call.
    payload_inputs = [t if t else "_" for t in inputs]

    body = {"model": EMBED_MODEL, "input": payload_inputs}
    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
        r = await c.post(
            f"{DASHSCOPE_OPENAI_BASE}/embeddings", headers=headers, json=body
        )
        if r.status_code >= 400:
            raise EmbeddingError(
                f"embeddings {r.status_code}: {r.text[:300]}"
            )
        d = r.json()

    items = d.get("data") or []
    if len(items) != len(inputs):
        raise EmbeddingError(
            f"embedding count mismatch: got {len(items)}, expected {len(inputs)}"
        )
    out: list[list[float]] = []
    for orig, item in zip(inputs, items):
        if not orig:
            out.append([0.0] * EMBED_DIM)
            continue
        vec = item.get("embedding")
        if not isinstance(vec, list) or len(vec) != EMBED_DIM:
            raise EmbeddingError(
                f"unexpected embedding shape: len={len(vec) if isinstance(vec, list) else 'N/A'}"
            )
        out.append(vec)
    return out


async def compute_embedding(text: str) -> list[float]:
    """Single-text convenience wrapper."""
    vecs = await compute_embeddings([text])
    return vecs[0]
