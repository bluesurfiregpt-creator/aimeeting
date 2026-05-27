#!/usr/bin/env python3
"""
v1.4.0 Phase B · 8 (NEW-C) 双盲测试 chat runner.

跟 meeting-based blind-test-runner.py 平行 — 测 `_call_for_chat` (v26.13.1)
chat 路径 (没 meeting, 没 orchestrator, 仅 单 agent 多 turn).

行为:
  1. 登录 (httpx cookie jar)
  2. 拉 agents 列表 (找 script.agent_name 对应 ID)
  3. 按 script.turns 多 turn 跟 单 agent 对话:
     - 发 POST /api/agents/<id>/chat SSE (跟 frontend streamChat 同源)
     - parse `data: <json>` 行, 收 agent_message_chunk / end / debug / quota
     - 每 turn 跑完 把 assistant 回复 append 到 messages history, 下 turn 带上
  4. 出 result JSON 含: 全 events / chunks / final text per turn / metric:
     - chat_turns_count
     - chat_total_chars (sum assistant text)
     - chat_avg_chunks_per_turn
     - chat_kb_hits_total / chat_memory_hits_total
     - chat_stance_violations (跟 会议 metric 同 — 都可以/看情况)
     - chat_quota_remaining

剧本 schema:
  {
    "name": "chat-A · Mira 多 turn",
    "agent_name": "Mira",
    "turns": [
      {"text": "我们 公司 要 灰度 B 组 20%, 你 怎么看?", "expected": {...}},
      ...
    ]
  }
"""

import argparse
import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import httpx


BASE_URL = "https://aimeeting.zhzjpt.cn"


async def login(client: httpx.AsyncClient, email: str, password: str) -> dict:
    r = await client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
    )
    if r.status_code != 200:
        raise RuntimeError(f"login failed: {r.status_code} {r.text[:200]}")
    return r.json()


async def list_agents(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(f"{BASE_URL}/api/agents")
    if r.status_code != 200:
        raise RuntimeError(f"list_agents: {r.status_code}")
    return r.json()


async def stream_chat(
    client: httpx.AsyncClient,
    agent_id: str,
    messages: list[dict],
    timeout: float = 180.0,
) -> AsyncIterator[dict]:
    """SSE 解析 — 复用 backend `_call_for_chat` 走的 endpoint."""
    async with client.stream(
        "POST",
        f"{BASE_URL}/api/agents/{agent_id}/chat",
        json={"messages": messages, "attachments": []},
        timeout=httpx.Timeout(timeout, read=timeout),
    ) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise RuntimeError(f"chat HTTP {resp.status_code}: {body[:200]!r}")
        async for raw_line in resp.aiter_lines():
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue
            payload_str = line[len("data:"):].strip()
            if not payload_str:
                continue
            try:
                yield json.loads(payload_str)
            except json.JSONDecodeError:
                yield {"type": "_raw", "line": payload_str[:300]}


async def run_chat_script(
    client: httpx.AsyncClient,
    script: dict,
    agent_id: str,
) -> tuple[list[dict], list[dict]]:
    """
    跑剧本 多 turn. 返回 (events, turn_summaries).

    每 turn:
      - 把 turn.text 加到 messages 末 (role=user)
      - SSE stream → 收 chunks → final assistant text
      - assistant text append 到 messages (role=assistant)
      - 下 turn 用 累积 messages
    """
    events: list[dict] = []
    turn_summaries: list[dict] = []
    messages: list[dict] = []

    for i, turn in enumerate(script.get("turns") or []):
        user_text = turn["text"]
        messages.append({"role": "user", "content": user_text})
        turn_start_ts = time.time()
        events.append({
            "ts": turn_start_ts,
            "type": "turn_start",
            "payload": {"turn": i, "user_text": user_text},
        })

        chunks: list[str] = []
        final_text = ""
        first_chunk_ts: float | None = None
        debug_info: dict | None = None
        quota_info: dict | None = None
        try:
            async for ev in stream_chat(client, agent_id, messages):
                events.append({"ts": time.time(), "type": "ws_recv", "payload": ev})
                ev_type = ev.get("type")
                if ev_type == "agent_message_chunk":
                    if first_chunk_ts is None:
                        first_chunk_ts = time.time()
                    chunks.append(ev.get("chunk") or "")
                elif ev_type == "agent_message_end":
                    final_text = ev.get("text") or "".join(chunks)
                elif ev_type == "chat_debug_info":
                    debug_info = {
                        "kb_hits": ev.get("kb_hits", 0),
                        "memory_hits": ev.get("memory_hits", 0),
                    }
                elif ev_type == "chat_quota":
                    quota_info = {
                        "remaining_today": ev.get("remaining_today"),
                        "daily_limit": ev.get("daily_limit"),
                    }
        except Exception as e:
            events.append({"ts": time.time(), "type": "stream_error", "payload": str(e)})
            final_text = f"❌ {e}"

        # 累积 messages
        if final_text:
            messages.append({"role": "assistant", "content": final_text})

        turn_end_ts = time.time()
        turn_summaries.append({
            "turn": i,
            "user_text": user_text,
            "assistant_text": final_text,
            "chunks_count": len(chunks),
            "chars": len(final_text),
            "ttfc_s": round(first_chunk_ts - turn_start_ts, 2) if first_chunk_ts else None,
            "total_duration_s": round(turn_end_ts - turn_start_ts, 2),
            "debug": debug_info,
            "quota": quota_info,
        })
        events.append({
            "ts": turn_end_ts,
            "type": "turn_end",
            "payload": turn_summaries[-1],
        })

    return events, turn_summaries


def compute_results(turn_summaries: list[dict], events: list[dict]) -> dict:
    """自动 metric 计算."""
    total_chars = sum(t["chars"] for t in turn_summaries)
    total_chunks = sum(t["chunks_count"] for t in turn_summaries)
    ttfcs = [t["ttfc_s"] for t in turn_summaries if t["ttfc_s"] is not None]
    kb_hits_total = sum(
        (t["debug"]["kb_hits"] if t.get("debug") else 0)
        for t in turn_summaries
    )
    memory_hits_total = sum(
        (t["debug"]["memory_hits"] if t.get("debug") else 0)
        for t in turn_summaries
    )

    # 立场守门 grep — chat 同样 不允许 和稀泥
    avoid_words = ["都可以", "看情况", "各有利弊", "两个都可以", "都有道理"]
    want_words = ["建议", "因为"]
    violations: list[str] = []
    strong_hits: list[str] = []
    for t in turn_summaries:
        text = t["assistant_text"] or ""
        for w in avoid_words:
            if w in text:
                idx = text.index(w)
                snippet = text[max(0, idx - 15) : idx + 15]
                violations.append(f"turn={t['turn']} word='{w}' ctx='{snippet}'")
        for w in want_words:
            if w in text:
                strong_hits.append(f"turn={t['turn']} word='{w}'")

    # quota: 最后 一个 turn 的 quota.remaining
    final_quota = None
    for t in reversed(turn_summaries):
        if t.get("quota"):
            final_quota = t["quota"]["remaining_today"]
            break

    return {
        "chat_turns_count": len(turn_summaries),
        "chat_total_chars": total_chars,
        "chat_total_chunks": total_chunks,
        "chat_avg_chunks_per_turn": (
            round(total_chunks / len(turn_summaries), 1) if turn_summaries else 0
        ),
        "chat_avg_ttfc_s": (
            round(sum(ttfcs) / len(ttfcs), 2) if ttfcs else None
        ),
        "chat_kb_hits_total": kb_hits_total,
        "chat_memory_hits_total": memory_hits_total,
        "chat_stance_violations": violations,
        "chat_stance_strong": strong_hits,
        "chat_quota_remaining": final_quota,
    }


async def amain(args):
    script_path = Path(args.script).resolve()
    script = json.loads(script_path.read_text(encoding="utf-8"))
    started_at_iso = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(180.0, read=180.0),
        follow_redirects=True,
        trust_env=False,
    ) as client:
        me = await login(client, args.email, args.password)
        print(f"[chat-runner] logged in as {me['name']} ({me['role']})", file=sys.stderr)

        agents = await list_agents(client)
        agents_by_name = {a["name"]: a["id"] for a in agents}
        target_name = script.get("agent_name", "Mira")
        agent_id = agents_by_name.get(target_name)
        if not agent_id:
            raise RuntimeError(f"agent '{target_name}' not found in workspace")
        print(f"[chat-runner] chat with {target_name} ({agent_id})", file=sys.stderr)

        events, turn_summaries = await run_chat_script(client, script, agent_id)
        print(f"[chat-runner] script done, {len(turn_summaries)} turns", file=sys.stderr)

    ended_at_iso = datetime.now(timezone.utc).isoformat()
    results = compute_results(turn_summaries, events)

    out = {
        "runner": args.runner,
        "script_name": script.get("name", "unknown"),
        "script_path": str(script_path),
        "agent_id": agent_id,
        "agent_name": target_name,
        "started_at": started_at_iso,
        "ended_at": ended_at_iso,
        "me": {"user_id": me["user_id"], "name": me["name"], "role": me["role"]},
        "turn_summaries": turn_summaries,
        "events_count": len(events),
        "results": results,
    }
    if args.include_events:
        out["events"] = events

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[chat-runner] wrote {out_path}", file=sys.stderr)

    print(json.dumps({
        "agent": target_name,
        "turns": results["chat_turns_count"],
        "total_chars": results["chat_total_chars"],
        "avg_ttfc_s": results["chat_avg_ttfc_s"],
        "kb_hits": results["chat_kb_hits_total"],
        "stance_violations": len(results["chat_stance_violations"]),
        "stance_strong": len(results["chat_stance_strong"]),
        "quota_remaining": results["chat_quota_remaining"],
    }, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--script", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--runner", default="claude", choices=["claude", "kimi"])
    p.add_argument("--out", required=True)
    p.add_argument("--include-events", action="store_true", help="dump 完整 events list (默认 不 dump, 省 文件)")
    args = p.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
