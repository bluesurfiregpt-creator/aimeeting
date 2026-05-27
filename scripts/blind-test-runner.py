#!/usr/bin/env python3
"""
v1.4.0 Phase A 双盲测试 runner.

PM 拍板 2026-05-27: Claude 自跑 + Kimi 跑同剧本 + 双 JSON 对账 = GREEN.

行为:
  1. 登录 (POST /api/auth/login) — 拿 cookie + workspace_id
  2. 拉 workspace users 列表 (映射 剧本里 "李局长" → user_id)
  3. 拉 active agents 列表 (邀请会议时 用)
  4. 创建 新 hybrid meeting (POST /api/meetings, agenda 跟剧本一致)
  5. WS 连 /ws/stt?meeting_id=<new>&token=<cookie>
  6. 按剧本 时序 发 text_message (action=text_message + speaker_user_id)
  7. 监听 WS event (transcript_persisted / agent_message_* / agent_recommendation / agenda_*)
  8. 剧本走完 等 8s 让最后 AI chunk 流完, 关 WS
  9. 触发 summary 重生成 (POST /summary/regenerate), 轮询直到 ready
 10. 拉 /summary, 拉 /transcript, dump 全部 events + summary 到 result JSON

剧本 schema:
  {
    "name": "A · 互联网灰度",
    "agenda": [{"title": "...", "time_budget_min": 15, "note": "..."}, ...],
    "agent_names": ["Aria", "Lex", "Sage"],  # 邀请的 AI 专家 (跟 NORTH_STAR § 1.3 名字一致)
    "steps": [
      {
        "delay_ms": 1500,         # 上一句完了等多久再发
        "speaker_name": "李局长",  # 借身份 (workspace 内 user.name; null = me)
        "text": "我们考虑灰度 B 组 20%, 看看 数据 / 法务 / UX 怎么想",
        "expected": {            # 期望 AI 反应 (PASS/FAIL 自动判定)
          "agent_message_within_s": 8,           # item 2: ≤ 8s 出 AI start
          "agent_message_grep_avoid": ["都可以","看情况","各有利弊","两个都可以"],  # item 3
          "agent_message_grep_want": ["建议", "因为"],   # item 3: 反例
        }
      }, ...
    ]
  }

结果 JSON schema:
  {
    "runner": "claude" | "kimi",
    "script_name": "...",
    "meeting_id": "<uuid>",
    "started_at": "<iso>",
    "ended_at": "<iso>",
    "events": [{ts, type, payload}],
    "summary_md": "...",
    "summary_json": {...},
    "transcript_lines_count": N,
    "agent_messages_count": N,
    "results": {                # auto PASS/FAIL
      "item_2_proactive_count": N,
      "item_2_avg_latency_s": N,
      "item_3_stance_violations": [str],   # 命中 禁词 的 AI text 片段
      "item_3_stance_strong": [str],       # 命中 期望 词 的 片段
      "item_4_summary_has_ai_speakers": bool,
      "item_4_action_items_with_source": N,
      "item_5_recommendation_count": N,
    }
  }

CLI:
  $ python3 blind-test-runner.py --script docs/kimi-tests/blind-test/scripts/A-grayrelease.json \\
        --email demo.lijg@futian.gov.cn --password demo123 \\
        --runner claude --out docs/kimi-tests/blind-test/results/run-claude-A-<ts>.json
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets


BASE_URL = "https://aimeeting.zhzjpt.cn"


# ──────────────────────────────────────────────────────────────────────
# Step 1-3: Login + workspace context
# ──────────────────────────────────────────────────────────────────────

async def login(client: httpx.AsyncClient, email: str, password: str) -> dict:
    r = await client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
    )
    if r.status_code != 200:
        raise RuntimeError(f"login failed: {r.status_code} {r.text[:200]}")
    return r.json()


async def list_users(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(f"{BASE_URL}/api/users")
    if r.status_code != 200:
        raise RuntimeError(f"list_users: {r.status_code} {r.text[:200]}")
    return r.json()


async def list_agents(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(f"{BASE_URL}/api/agents")
    if r.status_code != 200:
        raise RuntimeError(f"list_agents: {r.status_code} {r.text[:200]}")
    return r.json()


# ──────────────────────────────────────────────────────────────────────
# Step 4: Create meeting (hybrid mode)
# ──────────────────────────────────────────────────────────────────────

async def create_meeting(
    client: httpx.AsyncClient,
    script: dict,
    me: dict,
    agents_by_name: dict[str, str],
    users_by_name: dict[str, str],
) -> str:
    # 邀请 AI: 取 script.agent_names 对应的 active agent ids
    agent_ids: list[str] = []
    for name in script.get("agent_names") or []:
        aid = agents_by_name.get(name)
        if not aid:
            print(f"[warn] agent '{name}' not found in workspace, skip", file=sys.stderr)
            continue
        agent_ids.append(aid)

    # 邀请 真人 attendee: 从剧本 steps 里 提取 唯一 speaker_name (除了 None) + me
    attendee_user_ids: set[str] = {me["user_id"]}
    for step in script.get("steps") or []:
        sn = step.get("speaker_name")
        if sn:
            uid = users_by_name.get(sn)
            if uid:
                attendee_user_ids.add(uid)

    title = script.get("title") or f"双盲测试 · {script.get('name','unknown')} · {int(time.time())}"
    payload = {
        "title": title,
        "attendee_user_ids": list(attendee_user_ids),
        "attendee_agent_ids": agent_ids,
        "agenda": script.get("agenda") or [],
        "mode": "hybrid",
        "description": script.get("description"),
    }
    r = await client.post(f"{BASE_URL}/api/meetings", json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"create_meeting: {r.status_code} {r.text[:400]}")
    m = r.json()
    return m["id"]


# ──────────────────────────────────────────────────────────────────────
# Step 5-8: WS connect + send text_messages + listen
# ──────────────────────────────────────────────────────────────────────

async def run_ws_script(
    meeting_id: str,
    script: dict,
    users_by_name: dict[str, str],
    cookies: dict,
    me: dict,
) -> list[dict]:
    """Connect WS, run script steps with timing, collect all events."""
    # 用 httpx 拿的 cookie jar 转成 Cookie header
    cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
    ws_url = f"wss://aimeeting.zhzjpt.cn/ws/stt?meeting_id={meeting_id}"
    events: list[dict] = []
    text_sent_at: list[tuple[str, float]] = []  # (step_text, ts)

    async with websockets.connect(
        ws_url,
        additional_headers={"Cookie": cookie_header},
        max_size=10 * 1024 * 1024,
    ) as ws:
        # backend 第一行通常 是 {"type":"system","msg":"ready"} — 等它
        try:
            first = await asyncio.wait_for(ws.recv(), timeout=10)
            events.append({"ts": time.time(), "type": "ws_first", "payload": _safe_json(first)})
        except asyncio.TimeoutError:
            events.append({"ts": time.time(), "type": "ws_timeout", "payload": "no ready in 10s"})

        # listener task: 后台 收 所有 event
        async def listen_loop():
            try:
                async for raw in ws:
                    if isinstance(raw, bytes):
                        # 二进制 audio echo, skip
                        continue
                    parsed = _safe_json(raw)
                    events.append({"ts": time.time(), "type": "ws_recv", "payload": parsed})
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as e:
                events.append({"ts": time.time(), "type": "ws_listener_error", "payload": str(e)})

        listener = asyncio.create_task(listen_loop())

        # 跑 剧本
        for i, step in enumerate(script.get("steps") or []):
            delay_ms = step.get("delay_ms", 1500)
            await asyncio.sleep(delay_ms / 1000.0)

            sn = step.get("speaker_name")
            speaker_user_id = users_by_name.get(sn) if sn else me["user_id"]
            text = step["text"]

            await ws.send(json.dumps({
                "action": "text_message",
                "text": text,
                "speaker_user_id": speaker_user_id,
            }))
            now = time.time()
            events.append({
                "ts": now,
                "type": "ws_send",
                "payload": {
                    "step": i,
                    "speaker_name": sn,
                    "speaker_user_id": speaker_user_id,
                    "text": text,
                    "expected": step.get("expected") or {},
                },
            })
            text_sent_at.append((text, now))

        # 等 LLM judge 最后 8s 流完
        post_wait_s = script.get("post_wait_s", 12)
        print(f"[runner] script done, wait {post_wait_s}s for AI tail", file=sys.stderr)
        await asyncio.sleep(post_wait_s)

        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass

    return events


def _safe_json(raw: Any) -> Any:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        return json.loads(raw)
    except Exception:
        return {"_raw": str(raw)[:500]}


# ──────────────────────────────────────────────────────────────────────
# Step 9-10: regenerate summary + fetch
# ──────────────────────────────────────────────────────────────────────

async def regenerate_and_wait_summary(
    client: httpx.AsyncClient, meeting_id: str, max_wait_s: int = 180,
) -> dict:
    # 强制重生成
    await client.post(f"{BASE_URL}/api/meetings/{meeting_id}/summary/regenerate")
    # poll
    deadline = time.time() + max_wait_s
    last = None
    while time.time() < deadline:
        r = await client.get(f"{BASE_URL}/api/meetings/{meeting_id}/summary")
        if r.status_code == 200:
            last = r.json()
            if last.get("status") in ("ready", "skipped", "failed"):
                return last
        await asyncio.sleep(5)
    return last or {"status": "timeout"}


async def fetch_transcript(client: httpx.AsyncClient, meeting_id: str) -> dict:
    r = await client.get(f"{BASE_URL}/api/m/meetings/{meeting_id}/transcript")
    if r.status_code != 200:
        return {"error": f"{r.status_code}"}
    return r.json()


# ──────────────────────────────────────────────────────────────────────
# 自动判定 Item 2 / 3 / 4 / 5 PASS/FAIL
# ──────────────────────────────────────────────────────────────────────

def compute_results(events: list[dict], summary: dict, script: dict) -> dict:
    # item 2: agent_message_start 跟 上一句 text_message 之间 的延迟
    text_sends = [
        e for e in events
        if e["type"] == "ws_send" and isinstance(e.get("payload"), dict) and e["payload"].get("text")
    ]
    agent_starts = [
        e for e in events
        if e["type"] == "ws_recv"
        and isinstance(e.get("payload"), dict)
        and e["payload"].get("type") == "agent_message_start"
    ]
    latencies: list[float] = []
    for s in agent_starts:
        # 找 最近 之前 的 text_send
        prev_sends = [t for t in text_sends if t["ts"] < s["ts"]]
        if prev_sends:
            latencies.append(s["ts"] - prev_sends[-1]["ts"])

    # item 3: agent_message_chunk 拼成 完整 text, grep 立场守门
    agent_chunks: dict[str, list[str]] = {}  # agent_id → [chunks]
    for e in events:
        if (
            e["type"] == "ws_recv"
            and isinstance(e.get("payload"), dict)
            and e["payload"].get("type") == "agent_message_chunk"
        ):
            aid = e["payload"].get("agent_id") or "unknown"
            agent_chunks.setdefault(aid, []).append(e["payload"].get("chunk") or "")
    agent_texts = {aid: "".join(chs) for aid, chs in agent_chunks.items()}

    violations: list[str] = []
    strong_hits: list[str] = []
    avoid_words = ["都可以", "看情况", "各有利弊", "两个都可以", "都有道理"]
    want_words = ["建议", "因为"]
    for aid, text in agent_texts.items():
        for w in avoid_words:
            if w in text:
                # 取 命中 上下文 30 字
                idx = text.index(w)
                snippet = text[max(0, idx - 15) : idx + 15]
                violations.append(f"agent={aid[:8]} word='{w}' ctx='{snippet}'")
        for w in want_words:
            if w in text:
                strong_hits.append(f"agent={aid[:8]} word='{w}'")

    # item 4: summary_json.topics[].speakers 含 AI
    sj = summary.get("summary_json")
    has_ai = False
    action_with_src = 0
    if sj and isinstance(sj.get("topics"), list):
        for tp in sj["topics"]:
            for sp in tp.get("speakers", []):
                if sp.get("speaker_type") == "ai":
                    has_ai = True
                    break
            for a in tp.get("action_items", []):
                if a.get("source_line_id") is not None:
                    action_with_src += 1
            if has_ai:
                break

    # item 5: agent_recommendation 事件数
    recommend_count = sum(
        1 for e in events
        if e["type"] == "ws_recv"
        and isinstance(e.get("payload"), dict)
        and e["payload"].get("type") == "agent_recommendation"
    )

    return {
        "item_2_proactive_count": len(agent_starts),
        "item_2_avg_latency_s": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "item_2_latencies_s": [round(x, 2) for x in latencies],
        "item_3_stance_violations": violations,
        "item_3_stance_strong": strong_hits,
        "item_3_agent_text_lengths": {aid: len(t) for aid, t in agent_texts.items()},
        "item_4_summary_has_ai_speakers": has_ai,
        "item_4_action_items_with_source": action_with_src,
        "item_4_summary_json_present": sj is not None,
        "item_4_topic_count": len(sj.get("topics", [])) if sj else 0,
        "item_5_recommendation_count": recommend_count,
    }


# ──────────────────────────────────────────────────────────────────────
# Main entry
# ──────────────────────────────────────────────────────────────────────

async def amain(args):
    script_path = Path(args.script).resolve()
    script = json.loads(script_path.read_text(encoding="utf-8"))

    started_at_iso = datetime.now(timezone.utc).isoformat()

    # trust_env=False: 不用 系统 HTTP_PROXY env var (实测 走 proxy 会 hang).
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(180.0, read=180.0),
        follow_redirects=True,
        trust_env=False,
    ) as client:
        # login
        me = await login(client, args.email, args.password)
        print(f"[runner] logged in as {me['name']} ({me['role']})", file=sys.stderr)
        cookies = {c.name: c.value for c in client.cookies.jar}

        # context
        users = await list_users(client)
        users_by_name = {u["name"]: u["id"] for u in users}
        agents = await list_agents(client)
        agents_by_name = {a["name"]: a["id"] for a in agents}
        print(
            f"[runner] {len(users)} users, {len(agents)} agents",
            file=sys.stderr,
        )

        # create meeting
        meeting_id = await create_meeting(client, script, me, agents_by_name, users_by_name)
        print(f"[runner] created meeting {meeting_id}", file=sys.stderr)

        # run script
        events = await run_ws_script(meeting_id, script, users_by_name, cookies, me)
        print(f"[runner] WS done, {len(events)} events", file=sys.stderr)

        # summary regen + fetch
        summary = await regenerate_and_wait_summary(client, meeting_id)
        print(
            f"[runner] summary status={summary.get('status')}",
            file=sys.stderr,
        )

        # transcript
        transcript = await fetch_transcript(client, meeting_id)

    ended_at_iso = datetime.now(timezone.utc).isoformat()

    # compute auto PASS/FAIL
    results = compute_results(events, summary, script)

    out = {
        "runner": args.runner,
        "script_name": script.get("name", "unknown"),
        "script_path": str(script_path),
        "meeting_id": meeting_id,
        "started_at": started_at_iso,
        "ended_at": ended_at_iso,
        "me": {"user_id": me["user_id"], "name": me["name"], "role": me["role"]},
        "events": events,
        "summary_md_len": len(summary.get("summary_md") or ""),
        "summary_md_excerpt": (summary.get("summary_md") or "")[:1500],
        "summary_json": summary.get("summary_json"),
        "summary_status": summary.get("status"),
        "transcript_lines_count": len(transcript.get("lines") or []),
        "results": results,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[runner] wrote result to {out_path}", file=sys.stderr)

    # 简版 stdout summary
    print(
        json.dumps(
            {
                "meeting_id": meeting_id,
                "agent_starts": results["item_2_proactive_count"],
                "avg_latency_s": results["item_2_avg_latency_s"],
                "stance_violations": len(results["item_3_stance_violations"]),
                "summary_has_ai": results["item_4_summary_has_ai_speakers"],
                "action_items_w_src": results["item_4_action_items_with_source"],
                "recommendations": results["item_5_recommendation_count"],
            },
            ensure_ascii=False,
        )
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--script", required=True, help="path to script JSON")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--runner", default="claude", choices=["claude", "kimi"])
    p.add_argument("--out", required=True, help="output JSON path")
    args = p.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
