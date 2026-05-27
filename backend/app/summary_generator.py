"""
Post-meeting summary generation.

## v1.4.0 Phase A · 4 (NORTH_STAR § 6.1 痛点 3) — summary v2

Old behavior (v25.10 Bug B 后): summary 主动 剔除 AI 专家 发言, 只 看 真人.
副作用: AI 圆桌 真 产出 (Sprint 2-3 后) 完全 没沉淀, "复盘 不到 AI 协作".

New behavior: summary_generator 同时 看 MeetingTranscript (真人) +
MeetingAgentMessage (AI 专家), LLM 输出 **结构化 JSON** 按 topic 分组,
每个 topic 下 列 所有 speaker (人 + AI) 的 stance + 任务出处.

输出 双轨:
- `Meeting.summary_md` — markdown 8 节 (旧版兼容, 由 JSON 派生)
- `Meeting.summary_json` — 结构化 JSON (新版 UI 用)

老会议 没 summary_json 走 markdown fallback. 新会议 跑 完 同时 写两个.

## 结构化 JSON schema (LLM 输出)

  {
    "title": str,                  # 会议主题 (一句话)
    "overview": str,               # 2-4 句话 overview
    "topics": [
      {
        "topic": str,              # 议题名 (≤ 30 字)
        "summary": str,            # 议题概述 1-2 句
        "speakers": [{
          "speaker_name": str,
          "speaker_type": "human" | "ai",
          "agent_id": str | None,
          "stance": "support" | "caution" | "block" | "neutral",
          "points": [str],
          "source_line_ids": [int],     # MeetingTranscript.id refs
          "source_message_ids": [int],  # MeetingAgentMessage.id refs
        }],
        "decision": str | None,
        "action_items": [{
          "text": str,
          "owner": str | None,
          "due_date": str | None,       # ISO yyyy-mm-dd
          "source_line_id": int | None  # 跳实录 anchor
        }]
      }
    ],
    "key_takeaways": [str],
    "risks": [{ "text": str, "raised_by": str | None, "source_line_id": int | None }],
    "next_steps": [str]
  }

LLM 走 一次 调用 (JSON 模式). 失败 fallback 老 markdown prompt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, resolve_model_id, stream_chat
from .models import Agent, Meeting, MeetingAgentMessage, MeetingTranscript, User

logger = logging.getLogger(__name__)


# ─── 老 markdown 8-section system prompt (legacy 兜底 + JSON 失败 fallback) ───
SUMMARY_SYSTEM_PROMPT = """你是一名为政府/企业会议撰写正式纪要的专业秘书。

【最高优先级 反幻觉规则】违反任一条 都比 不写更糟。

A. **每个 bullet 必须能在实录原文中找到对应字句来源**。如果你想写一句话但
   找不到对应来源 → **不要写**,直接整节写"暂无"。
B. **严禁补全 / 演绎 / 总结引申**。即使你认为"按常理这场会议应该会讨论 X",
   实录没明确提到 → 不写。
C. **禁用承接词**:不要写"通过会议讨论"、"大家一致认为"、"经过讨论"、
   "据介绍"、"经研究决定"、"会议指出"等套话。直接写事实陈述。
D. **整个纪要总长度 不超过实录原文的 1/3**。实录短 → 纪要更短。
E. 实录里 没有 "决定/决议/决策" 关键词 → "已形成决策"节 必须只写 "暂无"。
   没有 "风险/隐患/担心/担忧" → "风险提醒" 必须只写 "无"。
   没有 "下一步/接下来/计划/打算" → "下一步建议" 必须只写 "无"。
F. 称呼说话人用实录中的真实姓名(如"张明"), 不要用"用户"、"speaker_01"、
   "[?]"(实录里 [?] 表示该句说话人未识别 — 你也用 "[?]" 不要乱给名字)。

G. **AI 专家 (`[AI]` 前缀) 是会议受邀的 AI 顾问, 跟真人一样是参会方** —
   他们的 立场 / 建议 / 数据 可以 作为 「关键要点 / 分歧 / 风险」依据,
   也可以 作为 「决策」如果 真人 明确 接受 了 AI 的 建议. **不要** 把 AI 发言
   一笔带过 也 不要 完全 忽略.

H. **每个 bullet 最多 30 字**.超长 说明你在编故事,删掉它,改写更短.

【输出格式】

1. 输出**纯 Markdown**, 不要包代码块, 不要带任何注释或前后说明。
2. 严格按下面 8 个 ## 二级标题, 即使某节为空也要列出, 但只写"暂无"。
3. 决策 / 风险 / 待办 都要标注**责任人**(若实录提到)和**时间节点**(若实录提到)。
4. 每个 bullet 一行,简洁,不要换行。

【固定结构】

## 会议主题
(一句话,从对话中归纳出的核心议题。实录信息不足 → "实录信息不足,无法确定主题")

## 概览
(2-4 句话,只陈述实录中实际讨论过的内容。不补充行业常识。
若实录少于 5 句有效发言 → "实录过短,无法概括")

## 关键要点
- (要点 1 — 必须对应实录原文片段)
- (要点 2)
...
(没有要点 → "暂无")

## 已形成决策
- (决策内容) — 决策人: XXX
(实录没有 "决定/决议/决策/通过" → "暂无")

## 分歧事项
- (谁与谁在哪点上看法不同)
(没有 → "无明显分歧")

## 风险提醒
- (风险描述) — 提出人: XXX
(实录没有提及风险/隐患/担忧 → "无")

## 待办事项
- [ ] (具体事项) — 负责: XXX, 截止: YYYY-MM-DD 或"待定"
(没有明确待办 → "无")

## 下一步建议
- (建议 1 — 必须实录中有人明确提到要"接下来 / 下一步 / 计划")
(没有 → "无")
"""


# ─── v1.4.0 Phase A · 4: 新结构化 JSON system prompt (痛点 3) ───
SUMMARY_JSON_SYSTEM_PROMPT = """你是一名为政府/企业会议撰写**结构化纪要**的专业秘书。

【最高优先级 反幻觉规则】违反任一条 都比 不写更糟。

A. **每个 point / decision / action_item 必须能在实录原文中找到对应字句来源**.
   找不到对应来源 → **不要写**, 该字段置 null 或 [].
B. **严禁补全 / 演绎 / 总结引申**. 实录没明确提到 → 不写.
C. **禁用 承接词** ("通过会议讨论" / "大家一致认为" / "经研究决定" 等).
   直接 陈述 事实.
D. **每条 point 最多 30 字**, **每条 action_item text 最多 40 字**.
E. 实录里 没有 "决定/决议/决策" → 整个 `decision` 字段为 null.
   没有 "风险/隐患/担心" → `risks` 为 [].
   没有 "下一步/接下来/计划" → `next_steps` 为 [].
F. 称呼 speaker 用 实录原 姓名 (如 "张明") + AI 的 用 nickname/name.
   实录 用 [?] 表示未识别 — 你也用 "[?]".

G. **AI 专家 (实录 中 `[AI]` 前缀) 是 会议 受邀 顾问, 跟 真人 一样 是 参会方**.
   他们 的 立场 / 建议 / 数据 应该 作为 该 topic 的 speaker 项 列出. 不要 跳过.
   **如果 真人 明确 接受 了 AI 建议 → 该 接受 进 decision**.

H. **任务/决策 source_line_id**: 实录 每行 前 有 `[L:<id>]` 这样 的 line id 标签.
   你 提到 的 任务/决策, 必须 给 出处 line id (取 决策 那句 的 id).
   AI 发言 行 标 `[M:<id>]` 表示 message_id (跟 line_id 不同).

【topic 划分原则】

- 一场 会议 一般 1-5 个 topic. 不要 每句 都 单 一 个 topic.
- 真人 + AI 围绕 同一 议题 讨论 (即使 用 不同 角度) 归 1 topic.
- 真 新 议题 切换 (用户 说 "下一个 问题"、"另外 还有 一件 事") 才 切.

【speaker stance 判定】

- support: 明确 表示 同意 / 推进 / 可行
- caution: 表达 担忧 / 风险 / 但 仍 可接受 (附带 条件)
- block: 明确 反对 / 不可行 / 要求 暂停
- neutral: 仅 提供 信息 / 数据 / 历史背景, 不 选边

【输出 严格 JSON 单行 或 多行】 不允许 包 ```json``` 代码块, 不允许 前 / 后 任何 文字.

输出 schema:

{
  "title": "<会议主题 一句话>",
  "overview": "<2-4 句话 overview, 实录不足 5 句有效发言 写 '实录过短,无法概括'>",
  "topics": [
    {
      "topic": "<议题名 ≤ 30 字>",
      "summary": "<议题概述 1-2 句>",
      "speakers": [
        {
          "speaker_name": "<真名 或 AI nickname>",
          "speaker_type": "human" | "ai",
          "agent_id": "<UUID 字符串 | null, AI 才有>",
          "stance": "support" | "caution" | "block" | "neutral",
          "points": ["<点 1>", "<点 2>"],
          "source_line_ids": [<int>, <int>],
          "source_message_ids": [<int>]
        }
      ],
      "decision": "<本议题决定 | null>",
      "action_items": [
        {
          "text": "<待办内容 ≤ 40 字>",
          "owner": "<责任人 | null>",
          "due_date": "<YYYY-MM-DD | null>",
          "source_line_id": <line_id | null>
        }
      ]
    }
  ],
  "key_takeaways": ["<整场会议 最重要 1-3 条>"],
  "risks": [{ "text": "<风险>", "raised_by": "<提出人 | null>", "source_line_id": <int | null> }],
  "next_steps": ["<下一步建议>"]
}

如 实录 过短 / 无 有效内容, 仍 输出 完整 JSON 结构, 但 topics/risks/next_steps
都 是 []`.title 写 "实录过短" + overview 说明 原因.
"""


async def _build_named_transcript(db: AsyncSession, meeting_id: uuid.UUID) -> str:
    """v1.4.0 Phase A · 4 重做: 混 真人 + AI 行 + 加 [L:<id>] / [M:<id>] 标签

    输出 给 LLM 的 文本 每行格式:
      [00:34] [L:123] 张明: 我们 要 先 看 数据
      [00:36] [M:45] [AI] ARIA: 数据 支持, P95 在 SLA 内
      [00:38] [L:124] 李华: 同意 ARIA 的 观点

    LLM 用 line_id / message_id 在 source_*_ids 字段 反引用.
    """
    rows = (
        await db.execute(
            select(MeetingTranscript)
            .where(
                MeetingTranscript.meeting_id == meeting_id,
                MeetingTranscript.is_final.is_(True),
            )
            .order_by(MeetingTranscript.id)
        )
    ).scalars().all()

    # Resolve user names
    user_ids = {r.speaker_user_id for r in rows if r.speaker_user_id}
    name_by_user: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        name_by_user = {u.id: u.name for u in users}

    # v1.4.0 Phase A · 4: 重新拉 AI agent messages (老版本 移除了 — 客户 反映 AI 不上 summary).
    # 跟 transcript 按 created_at / start_ms 时间排, 让 LLM 看到 真实 对话顺序.
    agent_msgs = (
        await db.execute(
            select(MeetingAgentMessage)
            .where(MeetingAgentMessage.meeting_id == meeting_id)
            .order_by(MeetingAgentMessage.created_at)
        )
    ).scalars().all()

    agent_ids = {m.agent_id for m in agent_msgs}
    agent_by_id: dict[uuid.UUID, Agent] = {}
    if agent_ids:
        agents = (
            await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        ).scalars().all()
        agent_by_id = {a.id: a for a in agents}

    # Build a list of (sort_key, line) tuples; sort_key = ms-since-meeting-start
    # for transcript rows, and (created_at - meeting.started_at) for agent msgs.
    # If sort_key 算不出来 直接用 db id ranking.
    items: list[tuple[float, str]] = []

    for r in rows:
        speaker = name_by_user.get(r.speaker_user_id) if r.speaker_user_id else "[?]"
        ts = _fmt_ms(r.start_ms)
        sort_key = float(r.start_ms) if r.start_ms is not None else float(r.id) * 1000
        items.append((sort_key, f"[{ts}] [L:{r.id}] {speaker}: {(r.text or '').strip()}"))

    # Agent messages don't have start_ms; use created_at relative to first transcript or meeting start.
    # For simplicity 一律 排在 transcripts 后 (created_at 升序), 这样 LLM 看到的 顺序仍 合理.
    # Actually better: 用 agent.created_at epoch 直接, 当 sort_key. 跟 transcripts ms 比可能错位, 用相对偏移:
    if rows:
        # 把 agent_msg 排到 同期 transcript 末尾 — agent 一般 是 在 LLM judge 触发后 几秒 内 fire
        # 用 r.id 找 最近 transcript: 取 created_at 之前 最后一条 transcript 的 sort_key + 0.5 偏移
        last_ts_sort = float(rows[-1].start_ms or rows[-1].id * 1000)
    else:
        last_ts_sort = 0.0

    for i, m in enumerate(agent_msgs):
        ag = agent_by_id.get(m.agent_id)
        nick = (ag.nickname.strip() if ag and ag.nickname and ag.nickname.strip() else None)
        name = ag.name if ag else "AI"
        label = nick or name
        # 用 created_at 的 ms epoch 作 sort, 但 跟 transcript ms 不同 scale —
        # 简化: agent_msg 一律 排 在 transcripts 之后 (last_ts_sort + 1ms * i + 偏移)
        sort_key = last_ts_sort + (i + 1) * 0.001
        # ts 显示 created_at 相对 meeting 起始 (best effort, 没有 also fine)
        ts = _fmt_ms(int((sort_key) - 0))  # 不算准, 仅 表 后续
        items.append((sort_key, f"[{ts}] [M:{m.id}] [AI] {label}: {(m.text or '').strip()}"))

    items.sort(key=lambda x: x[0])
    return "\n".join(line for _, line in items)


def _fmt_ms(ms: Optional[int]) -> str:
    if ms is None:
        return "  ?  "
    s = ms / 1000.0
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


# v25.7-#2 反幻觉:阈值显著提高,脏数据直接 skip 不调 LLM
MIN_TRANSCRIPT_LINES = 10   # 之前 3,真人测试反馈"3 句话也生成了乱编纪要"
MIN_TRANSCRIPT_CHARS = 300  # 之前 60,中文 300 字才有总结价值

# v25.7-#2: 纪要专用 LLM(qwen-max-latest 中文政务 + 结构化 + 反幻觉最强)
# 不依赖 user 在 /admin/models 里选的 model — 那个保留给 起草/问数 等快任务.
# v1.4.0 Saga R preflight: 历史 hardcode "qwen-max-latest" 在 prod deepseek active 时
# → API 400 unknown model. 改成 fallback 兜底, 实际 model 走 active provider.model_id
# (resolve_model_id below). 这个 常量 仅 作 last-resort 兜底.
SUMMARY_MODEL_OVERRIDE = "qwen-max-latest"


def _strip_json_fence(s: str) -> str:
    """LLM 偶尔 仍 包 ```json``` 即使 prompt 禁止. 暴力 剥."""
    s = s.strip()
    if s.startswith("```"):
        # 找 第一个 换行 跳 过 fence 行
        nl = s.find("\n")
        if nl >= 0:
            s = s[nl + 1:]
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


def _render_md_from_json(j: dict[str, Any]) -> str:
    """从 结构化 JSON 派生 8-section markdown (backward compat).

    Phase A · 4: 客户端 还没 全部 切换 到 summary_json 渲染, 老 client / docx
    导出 / memory_extractor 都 还 走 summary_md, 必须 保 一份 deterministic
    markdown 派生.
    """
    lines: list[str] = []
    title = (j.get("title") or "").strip() or "实录信息不足,无法确定主题"
    lines.append("## 会议主题")
    lines.append(title)
    lines.append("")

    overview = (j.get("overview") or "").strip() or "实录过短,无法概括"
    lines.append("## 概览")
    lines.append(overview)
    lines.append("")

    # 关键要点 = key_takeaways + 每 topic 里 所有 speaker 的 points 头 1 条
    takeaways = j.get("key_takeaways") or []
    lines.append("## 关键要点")
    if takeaways:
        for t in takeaways:
            if t:
                lines.append(f"- {t}")
    else:
        lines.append("暂无")
    lines.append("")

    # 已形成决策 = 每个 topic.decision 非 null
    decisions: list[str] = []
    for tp in j.get("topics") or []:
        d = (tp.get("decision") or "").strip()
        if d:
            # 加 topic prefix 让 markdown 更可读
            tname = (tp.get("topic") or "").strip()
            decisions.append(f"- 【{tname}】{d}" if tname else f"- {d}")
    lines.append("## 已形成决策")
    if decisions:
        lines.extend(decisions)
    else:
        lines.append("暂无")
    lines.append("")

    # 分歧事项 = 每个 topic 里 stance 不全 是 support 时 列 一条
    dissents: list[str] = []
    for tp in j.get("topics") or []:
        speakers = tp.get("speakers") or []
        stances = {s.get("stance") for s in speakers if s.get("stance")}
        if {"support", "block"} <= stances or {"support", "caution"} <= stances or {"caution", "block"} <= stances:
            tname = (tp.get("topic") or "").strip()
            parties_by_stance: dict[str, list[str]] = {}
            for sp in speakers:
                st = sp.get("stance")
                if st:
                    parties_by_stance.setdefault(st, []).append(sp.get("speaker_name") or "?")
            parts = []
            for st in ("support", "caution", "block"):
                if st in parties_by_stance:
                    label = {"support": "支持", "caution": "顾虑", "block": "反对"}[st]
                    parts.append(f"{label}: {', '.join(parties_by_stance[st])}")
            dissents.append(f"- 【{tname}】{' | '.join(parts)}")
    lines.append("## 分歧事项")
    if dissents:
        lines.extend(dissents)
    else:
        lines.append("无明显分歧")
    lines.append("")

    # 风险提醒 = risks 数组
    risks = j.get("risks") or []
    lines.append("## 风险提醒")
    if risks:
        for r in risks:
            t = (r.get("text") or "").strip()
            if not t:
                continue
            by = (r.get("raised_by") or "").strip()
            lines.append(f"- {t}" + (f" — 提出人: {by}" if by else ""))
    else:
        lines.append("无")
    lines.append("")

    # 待办事项 = 每个 topic.action_items flatten
    actions: list[str] = []
    for tp in j.get("topics") or []:
        for a in tp.get("action_items") or []:
            text = (a.get("text") or "").strip()
            if not text:
                continue
            owner = (a.get("owner") or "").strip()
            due = (a.get("due_date") or "").strip()
            tail = []
            if owner:
                tail.append(f"负责: {owner}")
            if due:
                tail.append(f"截止: {due}")
            suffix = f" — {', '.join(tail)}" if tail else ""
            actions.append(f"- [ ] {text}{suffix}")
    lines.append("## 待办事项")
    if actions:
        lines.extend(actions)
    else:
        lines.append("无")
    lines.append("")

    # 下一步建议
    nexts = j.get("next_steps") or []
    lines.append("## 下一步建议")
    if nexts:
        for n in nexts:
            if n:
                lines.append(f"- {n}")
    else:
        lines.append("无")
    return "\n".join(lines)


async def _try_parse_summary_json(raw: str) -> Optional[dict[str, Any]]:
    """Parse LLM JSON output, validate top-level keys, return None on fail."""
    try:
        s = _strip_json_fence(raw)
        # LLM 偶尔 在 JSON 前 加 一行 解释 (尽管 prompt 禁了) — 找 第一个 { ... 最后一个 }
        first = s.find("{")
        last = s.rfind("}")
        if first < 0 or last < 0 or last < first:
            return None
        s = s[first : last + 1]
        parsed = json.loads(s)
        if not isinstance(parsed, dict):
            return None
        # Soft validate top-level keys
        for k in ("title", "overview", "topics", "key_takeaways", "risks", "next_steps"):
            if k not in parsed:
                # be liberal — fill missing keys with sensible defaults
                if k in ("topics", "key_takeaways", "risks", "next_steps"):
                    parsed[k] = []
                else:
                    parsed[k] = ""
        # Validate topics is list-of-dicts
        if not isinstance(parsed.get("topics"), list):
            parsed["topics"] = []
        return parsed
    except Exception:
        logger.exception("summary JSON parse failed")
        return None


async def generate_summary(
    meeting_id: uuid.UUID,
    *,
    force: bool = False,
) -> Optional[str]:
    """
    Generate a structured summary (JSON + derived markdown) and persist to
    `meeting.summary_json` + `meeting.summary_md`.

    Returns the markdown on success, None when skipped (no transcripts /
    no LLM configured / content too thin). If force=False and a summary
    already exists, returns the existing one instead of regenerating.

    'Too thin' detection: testers reported the LLM was happily filling
    out the 8-section template even for one-word meetings. We now require
    >=MIN_TRANSCRIPT_LINES final ASR sentences AND >=MIN_TRANSCRIPT_CHARS
    of total text; below that we write a marker the front-end shows as
    'skipped' instead of producing a hallucinated summary.

    v1.4.0 Phase A · 4: 单 LLM 调用 输出 JSON, 派生 markdown 是 deterministic.
    LLM JSON 解析 失败 走 老 markdown prompt fallback (zero-risk regression).
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return None
        if not force and meeting.summary_md and not meeting.summary_md.startswith("<!--"):
            return meeting.summary_md

        # Count meaningful content before paying for an LLM call
        rows = (
            await db.execute(
                select(MeetingTranscript)
                .where(
                    MeetingTranscript.meeting_id == meeting_id,
                    MeetingTranscript.is_final.is_(True),
                )
            )
        ).scalars().all()
        n_lines = len(rows)
        total_chars = sum(len((r.text or "").strip()) for r in rows)
        # v1.4.0 Phase A · 4: 也 算 AI agent messages 字数 — 全 AI 会议
        # (mode=auto) 真人 transcript 可能 是 0 行, 但 AI 发言 几千 字 仍 有
        # summary 价值. 加和 后 判 阈值.
        agent_msgs_count = (
            await db.execute(
                select(MeetingAgentMessage.id).where(
                    MeetingAgentMessage.meeting_id == meeting_id,
                )
            )
        ).scalars().all()
        n_ai = len(agent_msgs_count)
        # 拉 一遍 AI text 来 算字数 (small overhead, ok)
        if n_ai > 0:
            ai_chars = sum(
                len((m.text or "").strip())
                for m in (
                    await db.execute(
                        select(MeetingAgentMessage).where(
                            MeetingAgentMessage.meeting_id == meeting_id,
                        )
                    )
                ).scalars().all()
            )
        else:
            ai_chars = 0
        total_effective_lines = n_lines + n_ai
        total_effective_chars = total_chars + ai_chars
        if (
            total_effective_lines < MIN_TRANSCRIPT_LINES
            or total_effective_chars < MIN_TRANSCRIPT_CHARS
        ):
            note = (
                f"实录过短(共 {total_effective_lines} 句, {total_effective_chars} 字),"
                "未生成纪要。请讨论时间更长一些再试。"
            )
            await db.execute(
                update(Meeting)
                .where(Meeting.id == meeting_id)
                .values(summary_md=f"<!-- summary:skipped: {note} -->")
            )
            await db.commit()
            logger.info("summary skipped for %s: %s", meeting_id, note)
            return None

        named = await _build_named_transcript(db, meeting_id)
        if not named.strip():
            return None
        provider = await get_active_provider(db)

    if provider is None:
        logger.warning("summary_generator: no active LLM provider")
        return None

    user_prompt = (
        f"会议标题: {meeting.title or '未命名会议'}\n\n"
        f"以下是这场会议的实录 (真人 + AI 专家 混合, [L:<id>] 是 真人 line id, "
        f"[M:<id>] 是 AI message id):\n\n{named}"
    )

    # v1.4.0 Phase A · 4: 第一阶段 — JSON 输出
    chunks: list[str] = []
    model_id = resolve_model_id(provider, purpose="summary")
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=SUMMARY_JSON_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            model_override=model_id,
            temperature=0.0,
            top_p=0.1,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("summary JSON LLM call failed; will fallback to markdown")
        chunks = []
    except Exception:
        logger.exception("summary JSON unexpected error; will fallback to markdown")
        chunks = []

    raw_json = "".join(chunks).strip()
    parsed = await _try_parse_summary_json(raw_json) if raw_json else None

    if parsed is not None:
        # JSON 成功 — 派生 markdown
        summary_md = _render_md_from_json(parsed)
        async with SessionLocal() as db:
            await db.execute(
                update(Meeting)
                .where(Meeting.id == meeting_id)
                .values(summary_md=summary_md, summary_json=parsed)
            )
            await db.commit()
        logger.info(
            "generated structured summary v2 for meeting %s (%d topics)",
            meeting_id,
            len(parsed.get("topics") or []),
        )
    else:
        # Fallback: 走老 markdown prompt
        logger.warning(
            "summary JSON parse failed for %s; falling back to markdown-only path",
            meeting_id,
        )
        md_chunks: list[str] = []
        try:
            async for c in stream_chat(
                provider=provider,
                system_prompt=SUMMARY_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                model_override=model_id,
                temperature=0.0,
                top_p=0.1,
            ):
                md_chunks.append(c)
        except LlmError:
            logger.exception("summary fallback markdown LLM call failed")
            return None
        except Exception:
            logger.exception("summary fallback markdown unexpected error")
            return None
        summary_md = "".join(md_chunks).strip()
        if not summary_md:
            return None
        async with SessionLocal() as db:
            await db.execute(
                update(Meeting)
                .where(Meeting.id == meeting_id)
                .values(summary_md=summary_md)
            )
            await db.commit()
        logger.info(
            "generated legacy markdown summary for meeting %s (%d chars)",
            meeting_id,
            len(summary_md),
        )

    # Chain: extract long-term memories from this fresh summary in the
    # background.
    try:
        from .memory_extractor import extract_and_store_memories
        asyncio.create_task(extract_and_store_memories(meeting_id, summary_md=summary_md))
    except Exception:
        logger.exception("failed to schedule memory extraction")

    # M3.0: extract structured action items (待办事项) — separate LLM pass.
    try:
        from .action_extractor import extract_and_store_actions
        asyncio.create_task(extract_and_store_actions(meeting_id, summary_md=summary_md))
    except Exception:
        logger.exception("failed to schedule action extraction")

    return summary_md
