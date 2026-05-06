"""
Dify thin client.

Different Dify app types use different endpoints:
- chatflow / chatbot:  POST /v1/chat-messages
- workflow:            POST /v1/workflows/run
- agent:               POST /v1/chat-messages

We default to chatflow's `chat-messages` since that gives us conversation
context (Dify-managed short-term memory). Streaming is preferred so we can
push chunks straight back to the front-end as they arrive.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Optional

import httpx

logger = logging.getLogger(__name__)


class DifyError(RuntimeError):
    pass


class DifyClient:
    def __init__(self, *, api_key: str, base_url: str = "https://api.dify.ai") -> None:
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._timeout = httpx.Timeout(60.0, connect=10.0)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }

    async def chat_completions(
        self,
        query: str,
        *,
        inputs: Optional[dict[str, Any]] = None,
        user: str = "aimeeting-bot",
        conversation_id: Optional[str] = None,
        app_type: str = "chatflow",
    ) -> dict[str, Any]:
        """Single-shot, non-streaming. Returns the parsed JSON response."""
        path = "/v1/chat-messages" if app_type != "workflow" else "/v1/workflows/run"
        body: dict[str, Any] = {
            "inputs": inputs or {},
            "query": query,
            "response_mode": "blocking",
            "user": user,
        }
        if app_type == "workflow":
            body = {"inputs": {**(inputs or {}), "query": query}, "response_mode": "blocking", "user": user}
        if conversation_id:
            body["conversation_id"] = conversation_id

        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.post(self._base + path, headers=self._headers(), json=body)
            if r.status_code >= 400:
                raise DifyError(f"POST {path} {r.status_code}: {r.text[:300]}")
            return r.json()

    async def chat_stream(
        self,
        query: str,
        *,
        inputs: Optional[dict[str, Any]] = None,
        user: str = "aimeeting-bot",
        conversation_id: Optional[str] = None,
        app_type: str = "chatflow",
    ) -> AsyncIterator[dict[str, Any]]:
        """
        SSE-streaming. Yields each parsed event JSON. Caller decides what to
        forward to the front-end. The final event has `event: 'message_end'`
        for chatflow, or `event: 'workflow_finished'` for workflow apps.
        """
        path = "/v1/chat-messages" if app_type != "workflow" else "/v1/workflows/run"
        body: dict[str, Any] = {
            "inputs": inputs or {},
            "query": query,
            "response_mode": "streaming",
            "user": user,
        }
        if app_type == "workflow":
            body = {"inputs": {**(inputs or {}), "query": query}, "response_mode": "streaming", "user": user}
        if conversation_id:
            body["conversation_id"] = conversation_id

        async with httpx.AsyncClient(timeout=self._timeout) as c:
            async with c.stream(
                "POST", self._base + path, headers=self._headers(), json=body
            ) as r:
                if r.status_code >= 400:
                    body_text = (await r.aread()).decode("utf-8", "ignore")
                    raise DifyError(f"POST {path} {r.status_code}: {body_text[:300]}")
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload:
                        continue
                    try:
                        yield json.loads(payload)
                    except json.JSONDecodeError:
                        logger.warning("dify stream: non-JSON line: %s", payload[:120])
