"""
v1.4.0 Phase B · 9 NEW-A 简版 — 立场冲突 LLM judge + 自动标 superseded.

**痛点 4 (NORTH_STAR § 1.4)**: 多方 立场 拉扯 时 容易 没记录 后悔药.
后续发言 推翻 前面 发言 时, 系统 应自动 标 旧 发言 为 "已被覆盖", 让 transcript
看 历史 时 一眼 看清 哪条 失效, 哪条 当前 立场.

**简版** (跟 完整 冲突调解 UI 分开):
- 仅 backend LLM judge 检测 + 自动 update agent_message.status
- 不做 决策 panel / 不做 用户 确认 流程 / 不做 撤销 superseded

**机制**:
1. 每条 新 agent_message 落库后 (auto_meeting_orchestrator._save_message
   或 agent_router.maybe_invoke_agents flush), 调 maybe_mark_superseded.
2. 拉本会议 同 议程 (agenda_idx 同) 前 N=8 条 active agent_messages.
3. LLM judge: 新发言 是否 推翻 某条 旧发言? 输出 {has_conflict, superseded_id, reason}.
4. 若 has_conflict: UPDATE 旧 message status='superseded', superseded_by_message_id=new.id.

**LLM 模型**: 复用 active_provider (跟 dissent_detector / agent_router 一致).
**触发条件**: 新发言 跟 旧发言 立场 明显 对立 (LLM 判断), 而不是 补充 / 同意.
**频率**: 每条 新 agent_message 跑一次 (~2-5s LLM 延迟, 不阻塞 SSE).
**容错**: LLM 失败 → 跳过 (best-effort), 不挡 message 落库.

NOT in scope (留 二期):
- 真人 transcript (MeetingTranscript) 的 conflict — 仅 AI 发言 间.
- 多重 chain (A 覆盖 B, C 又 覆盖 A) — 每条 仅 1 个 superseded_by, 链式 自然 形成.
- Manual undo — admin 想 恢复 active 走 API 改.
- 跨议程 冲突 (仅 同 agenda_idx, 不同议程 立场 默认 互相 独立).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Agent, MeetingAgentMessage

logger = logging.getLogger(__name__)

LOOKBACK_MESSAGES = 8  # 同议程 最近 N 条 agent_messages 给 LLM 看


_SYSTEM_PROMPT = """你是会议主持人, 判断 **最新一条 AI 发言** 是否 **明确推翻** 列表中某条 **更早的 AI 发言** 的立场.

**严格 JSON 单行**输出, 不要 包代码块, 不要 任何其他文字:
{
  "has_conflict": true/false,
  "superseded_index": <被推翻发言 在 列表里 的 序号 (0-based) 或 -1 if has_conflict=false>,
  "reason": "<不超过 30 字 中文短句, 说明 为什么 立场对立>"
}

判断规则:
1. **必须 是 明确 推翻** — 新发言 跟 旧发言 在 同一 决策点 上 给出 相反 的 立场 / 建议 / 结论.
2. **补充 / 细化 / 部分修正 不算** — 例如 旧 "建议 灰度 20%", 新 "建议 灰度 20%, 监控 P95" — 是细化 不是 推翻.
3. **同意 / 引用 不算** — 例如 新发言 引用 旧发言 内容 并 赞同 + 加 数据 → 不是 推翻.
4. **不同主题 不算** — 旧 谈 隐私, 新 谈 性能 — 两个 独立 议题, 都 active.
5. **只 标 1 条** — 列表 多条 都 对立 时, 选 立场 最直接 对立 的 那条. 其他 留 active (二期 加链式).
6. **保守 判断** — 不确定 是否 真冲突 → has_conflict=false. 宁可漏标, 不可错标.
7. reason 写人话, 例如:
   - "新发言 建议 推全, 跟 旧建议 暂缓 直接 矛盾"
   - "新方案 用 PaaS, 旧方案 自建 — 路径冲突"
"""


async def maybe_mark_superseded(
    meeting_id: uuid.UUID,
    new_message_id: int,
) -> Optional[dict]:
    """对 新落库 的 agent_message 跑 LLM judge, 若 推翻 某条 旧 agent_message
    则 update 旧 message status='superseded' + superseded_by_message_id=new.id.

    Returns: {"superseded_id": int, "reason": str} 或 None (无冲突 / 错误 / 不满足 触发条件).
    """
    async with SessionLocal() as db:
        # 1. 拉 新 message
        new_msg = (
            await db.execute(
                select(MeetingAgentMessage).where(
                    MeetingAgentMessage.id == new_message_id
                )
            )
        ).scalar_one_or_none()
        if not new_msg or new_msg.meeting_id != meeting_id:
            return None

        # 2. 同议程 (or 全会议 if agenda_idx is None) 拉 最近 N 条 active agent messages
        #    新 message 自己 不算
        conditions = [
            MeetingAgentMessage.meeting_id == meeting_id,
            MeetingAgentMessage.id != new_msg.id,
            MeetingAgentMessage.status == "active",
        ]
        if new_msg.agenda_idx is not None:
            conditions.append(MeetingAgentMessage.agenda_idx == new_msg.agenda_idx)

        rows = (
            await db.execute(
                select(MeetingAgentMessage)
                .where(and_(*conditions))
                .order_by(MeetingAgentMessage.id.desc())
                .limit(LOOKBACK_MESSAGES)
            )
        ).scalars().all()
        if len(rows) < 1:
            return None  # 没 前置 message, 不可能 推翻
        rows = list(reversed(rows))  # 正序 给 LLM 看 时间线

        # 3. 拉 agent name (给 LLM 更可读 上下文)
        agent_ids = {r.agent_id for r in rows} | {new_msg.agent_id}
        agents = (
            await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        ).scalars().all()
        name_by_id = {a.id: a.name for a in agents}

        # 4. 拉 active LLM provider
        provider = await get_active_provider(db)

    if provider is None:
        logger.debug("conflict_detector: no active LLM provider, skip")
        return None

    # 5. 构造 user prompt
    prev_block = "\n".join(
        f"[{i}] {name_by_id.get(r.agent_id, 'AI')}: {r.text[:300]}"
        for i, r in enumerate(rows)
    )
    new_speaker = name_by_id.get(new_msg.agent_id, "AI")
    user_prompt = (
        f"**最新发言** (待判断 是否 推翻 下面 列表 某条):\n"
        f"{new_speaker}: {new_msg.text[:500]}\n\n"
        f"**之前同议程 {len(rows)} 条 AI 发言** (按 时间线 正序):\n"
        f"{prev_block}\n\n"
        f"判断 最新发言 是否 推翻 列表中 某条? 给 JSON."
    )

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("conflict_detector LLM call failed")
        return None

    raw = "".join(chunks).strip()
    parsed = _safe_parse_json_obj(raw)
    if not parsed or not parsed.get("has_conflict"):
        return None

    idx = parsed.get("superseded_index")
    if not isinstance(idx, int) or idx < 0 or idx >= len(rows):
        logger.warning(
            "conflict_detector: invalid superseded_index=%s (rows=%d) raw=%s",
            idx, len(rows), raw[:200],
        )
        return None

    superseded_msg = rows[idx]
    reason = (parsed.get("reason") or "").strip()[:80]

    # 6. UPDATE 旧 message
    async with SessionLocal() as db:
        await db.execute(
            update(MeetingAgentMessage)
            .where(MeetingAgentMessage.id == superseded_msg.id)
            .values(status="superseded", superseded_by_message_id=new_msg.id)
        )
        await db.commit()

    logger.info(
        "conflict_detector: marked msg %d superseded by msg %d (meeting=%s, reason=%s)",
        superseded_msg.id, new_msg.id, meeting_id, reason,
    )
    return {
        "superseded_id": superseded_msg.id,
        "superseded_by": new_msg.id,
        "reason": reason,
    }


def _safe_parse_json_obj(raw: str) -> Optional[dict]:
    if not raw:
        return None
    if raw.startswith("```"):
        m = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
        if m:
            raw = m.group(1)
    s = raw.find("{")
    e = raw.rfind("}")
    if s == -1 or e == -1 or e <= s:
        return None
    try:
        parsed = json.loads(raw[s : e + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
