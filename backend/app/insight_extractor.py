"""
v27.0-mobile P21 Phase 2 · LLM 抽 ai_insight + 筛 worth_remembering.

两步流水线 — 会议结束时 (status: ongoing → finished) BackgroundTask 跑:
  1. extract_insights_for_meeting()
     遍历 meeting_agent_message, 每条调 LLM 抽一条 ai_insight (或丢弃).
     幂等: source_message_id 上有 unique 检查, 同一条 message 不重抽.

  2. select_worth_remembering_for_meeting()
     拉这场会议所有 ai_insight + brief + title, 给 LLM 一次性挑出
     "长期沉淀有价值"的 id list, 标 worth_remembering=true.
     数量 AI 自由决定, 没设上限. 宁缺勿滥.

跟旧 backfill_ai_insights.py 的差异:
  旧: 关键词启发式 (在原文前 40 字找关键词分类), 质量糙, 截断粗暴
  新: LLM 真懂语义, 输出结构化 JSON, 允许判定"这条无信息量"丢弃

历史数据: 不主动覆盖. 新会议走新路径, 旧会议保留启发式数据.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import AIInsight, Meeting, MeetingAgentMessage

logger = logging.getLogger(__name__)


# ===== Step 1: 单条 agent_message → ai_insight =================================

INSIGHT_EXTRACT_SYSTEM = """你是政务会议秘书. 从一段 AI 专家在会议里的发言中, 抽出
最多 1 条「值得记录的结构化结论」.

严格按以下 JSON 输出, 不要任何 markdown 围栏 / 解释:

如果这段发言有可结构化的信息:
{"type": "建议|风险|洞察|思路|决策建议", "content": "一句话结论 (≤40 字)", "evidence": "原文支持句 (≤80 字)"}

如果这段发言没有可结构化信息 (打招呼 / 附议 / 寒暄 / 表态 / 提问):
{"type": null}

类型选择标准 (五选一, 选最贴的):
- 「风险」     预警/缺陷/隐患 — "风险/雷/违规/缺失/漏洞" 等关键词
- 「决策建议」 明确的拍板选项 — "建议拟/决议/选 A 还是 B/拍板"
- 「洞察」     数据/现象/趋势发现 — 含数字/百分比/同比/数据对比
- 「思路」     解题路径/拆分角度 — "分三步/拢成一个方案/从 X 角度看"
- 「建议」     兜底 — 推一个具体方案, 上面四类都不算

关键: 一条发言抽一条, 选信息密度最高的那个角度. 不要拆出"建议+风险"两条.
content 是一句话结论, 不要原文 copy, 要浓缩."""


def _build_extract_user_prompt(
    *,
    agent_name: str,
    agent_message_text: str,
    meeting_title: str,
    meeting_brief: Optional[str] = None,
    agenda_title: Optional[str] = None,
) -> str:
    parts = [f'会议: "{meeting_title}"']
    if meeting_brief and meeting_brief.strip():
        parts.append(f"会议背景:\n{meeting_brief.strip()[:500]}")
    if agenda_title:
        parts.append(f'当前议程: "{agenda_title}"')
    # agent_message 限 1500 字 — LLM 输入 token 控制
    msg_text = agent_message_text.strip()[:1500]
    parts.append(f"{agent_name} 的发言:\n{msg_text}")
    parts.append("请按 system prompt 抽 1 条结构化结论 (或返回 type=null).")
    return "\n\n".join(parts)


def _parse_extract_response(text: str) -> Optional[dict[str, Any]]:
    """从 LLM 输出抽 JSON. 返回 dict 或 None (type 为 null / 解析失败)."""
    t = text.strip()
    if t.startswith("```"):
        m = re.search(r"```(?:json)?\s*\n([\s\S]*?)\n```", t)
        if m:
            t = m.group(1).strip()
    # 找第一个 { 到最后一个 }
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        logger.warning("insight extract: response 无 JSON 对象 — %.100s", text)
        return None
    try:
        obj = json.loads(t[start: end + 1])
    except json.JSONDecodeError as e:
        logger.warning("insight extract: JSON 解析失败 %s — %.100s", e, text)
        return None
    if not isinstance(obj, dict):
        return None

    type_val = obj.get("type")
    if type_val is None:
        # LLM 显式表示 "这条不值得抽"
        return None
    if type_val not in ("建议", "风险", "洞察", "思路", "决策建议"):
        logger.warning("insight extract: 未知 type=%r 丢弃", type_val)
        return None

    content = (obj.get("content") or "").strip()
    if not content:
        return None
    evidence = (obj.get("evidence") or "").strip() or None

    return {
        "type": type_val,
        "content": content[:200],  # safety cap
        "evidence": evidence[:400] if evidence else None,
    }


async def _extract_one_insight(
    *,
    provider,
    agent_name: str,
    agent_message_text: str,
    meeting_title: str,
    meeting_brief: Optional[str] = None,
    agenda_title: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """调 LLM 抽一条 insight. 返回 dict 或 None.

    None 表示: LLM 判定无信息量 / 解析失败 / LLM error. 不阻塞后续.
    """
    user_prompt = _build_extract_user_prompt(
        agent_name=agent_name,
        agent_message_text=agent_message_text,
        meeting_title=meeting_title,
        meeting_brief=meeting_brief,
        agenda_title=agenda_title,
    )
    parts: list[str] = []
    try:
        async for chunk in stream_chat(
            provider=provider,
            system_prompt=INSIGHT_EXTRACT_SYSTEM,
            user_prompt=user_prompt,
            temperature=0.2,
        ):
            if chunk:
                parts.append(chunk)
    except LlmError as e:
        logger.warning("insight extract LLM failed: %s", e)
        return None

    return _parse_extract_response("".join(parts))


async def extract_insights_for_meeting(meeting_id: uuid.UUID) -> int:
    """v27.0-mobile P21 Phase 2: 会议结束时抽这场会议所有 agent_message 的 insight.

    幂等:
      跳过 source_message_id 已有 ai_insight 的 message (旧 backfill 跑过的不重抽).

    返回:
      新插入的 insight 行数.
    """
    async with SessionLocal() as db:
        provider = await get_active_provider(db)
    if provider is None:
        logger.warning("insight extract meeting=%s: no active LLM provider", meeting_id)
        return 0

    async with SessionLocal() as db:
        m = (
            await db.execute(
                select(Meeting).where(Meeting.id == meeting_id)
            )
        ).scalar_one_or_none()
        if m is None:
            return 0

        # 拉这场会议所有 agent_message, 排除 stage='intro'/'wrap_up' (这些是 moderator
        # 串场, 不抽 insight). 仅 stage='reply' 或 trigger_payload 为 None 的.
        msgs = (
            await db.execute(
                select(MeetingAgentMessage).where(
                    MeetingAgentMessage.meeting_id == meeting_id,
                ).order_by(MeetingAgentMessage.id)
            )
        ).scalars().all()

        # 已抽过的 source_message_id (幂等)
        existing_ids = set(
            r[0] for r in (
                await db.execute(
                    select(AIInsight.source_message_id).where(
                        AIInsight.meeting_id == meeting_id,
                        AIInsight.source_message_id.is_not(None),
                    )
                )
            ).all()
        )

        # 拉 agent name 映射 (一次性, 避免 N+1 查询)
        from .models import Agent
        agent_ids = list({msg.agent_id for msg in msgs if msg.agent_id is not None})
        agent_name_map = {}
        if agent_ids:
            agent_rows = (
                await db.execute(
                    select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
                )
            ).all()
            agent_name_map = {r[0]: r[1] for r in agent_rows}

        # 拉议程 title 映射 (按 topic_idx)
        agenda_titles: dict[int, str] = {}
        if m.agenda and isinstance(m.agenda, list):
            for i, item in enumerate(m.agenda):
                if isinstance(item, dict):
                    t = item.get("title")
                    if t:
                        agenda_titles[i] = t

        inserted = 0
        for msg in msgs:
            if msg.id in existing_ids:
                continue
            # 跳过 intro / wrap_up (moderator 串场) — 看 trigger_payload.stage
            stage = None
            if isinstance(msg.trigger_payload, dict):
                stage = msg.trigger_payload.get("stage")
            if stage in ("intro", "wrap_up"):
                continue
            # 跳过空 / 太短的发言
            if not msg.text or len(msg.text.strip()) < 30:
                continue

            agenda_idx = msg.agenda_idx
            agenda_title = (
                agenda_titles.get(agenda_idx) if agenda_idx is not None else None
            )
            extracted = await _extract_one_insight(
                provider=provider,
                agent_name=agent_name_map.get(msg.agent_id) or "AI 专家",
                agent_message_text=msg.text,
                meeting_title=m.title or "未命名会议",
                meeting_brief=m.description,
                agenda_title=agenda_title,
            )
            if extracted is None:
                continue

            insight = AIInsight(
                workspace_id=m.workspace_id,
                meeting_id=meeting_id,
                agent_id=msg.agent_id,
                type=extracted["type"],
                content=extracted["content"],
                evidence=extracted["evidence"],
                source_message_id=msg.id,
                topic_idx=agenda_idx,
            )
            db.add(insight)
            inserted += 1

        if inserted:
            await db.commit()
        logger.info(
            "insight extract meeting=%s: %d new insights (scanned %d msgs)",
            meeting_id, inserted, len(msgs),
        )
        return inserted


# ===== Step 2: 一场会议所有 insight → 挑 worth_remembering =====================

WORTH_REMEMBERING_SYSTEM = """你是政务会议秘书. 给你一场会议的所有 AI 快照, 你要挑出
「长期沉淀有价值」的几条 — 这些会被永久存入工作区记忆库, 未来类似议题召开新会时 AI
会自动检索调用.

【值得入库】(挑这些):
- 跨会议适用的原则 / 规则 (例: "Q1 投诉处理流程: 24h 内分派, 72h 内回访")
- 关键数据 / 基线 (例: "2026 Q1 投诉总量 1287 件, 同比 +35%")
- 重要决策 / 拍板结果 (例: "Q2 整改预算 ≤ 50w, 主聚焦安保")
- 跨部门衔接知识 (例: "城管+公安联合执法窗口期是工作日 9:30-11:30")
- 已识别的风险 / 雷点 (例: "莲花山片区夜间巡逻间隔过长是投诉主要源头")

【不值得入库】(过滤掉):
- 临时性发言 (单次会议特定, 过两周就过期)
- 过于具体的执行细节 (谁来做 / 什么时候 — 那是任务, 不是记忆)
- 重复别人观点的附议
- 提问句 / 不确定的探讨

输出严格 JSON, 不要 markdown 围栏:
{"ids": ["选中的 insight id 1", "选中的 insight id 2", ...]}

数量自己定 (0-N 任意, 没上限). 宁缺勿滥 — 只挑你确信值得长期记的."""


def _parse_worth_remembering_response(text: str) -> list[str]:
    """从 LLM 输出抽 ids list."""
    t = text.strip()
    if t.startswith("```"):
        m = re.search(r"```(?:json)?\s*\n([\s\S]*?)\n```", t)
        if m:
            t = m.group(1).strip()
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        obj = json.loads(t[start: end + 1])
    except json.JSONDecodeError:
        return []
    ids = obj.get("ids") if isinstance(obj, dict) else None
    if not isinstance(ids, list):
        return []
    # 校验 + 去重 + 长度限制 (防 LLM 抽风返 100 个)
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        if not isinstance(x, str):
            continue
        x = x.strip()
        if not x or x in seen:
            continue
        seen.add(x)
        out.append(x)
        if len(out) >= 50:  # hard cap, 防 LLM 失控
            break
    return out


async def select_worth_remembering_for_meeting(meeting_id: uuid.UUID) -> int:
    """v27.0-mobile P21 Phase 2: 给一场会议的所有 ai_insight 跑 worth_remembering 推荐.

    把 LLM 挑中的 insight 标 worth_remembering=true. 已经标过的不动 (幂等再跑只增不减).

    返回: 本次新标的数量.
    """
    async with SessionLocal() as db:
        provider = await get_active_provider(db)
    if provider is None:
        return 0

    async with SessionLocal() as db:
        m = (
            await db.execute(
                select(Meeting).where(Meeting.id == meeting_id)
            )
        ).scalar_one_or_none()
        if m is None:
            return 0

        rows = (
            await db.execute(
                select(AIInsight).where(
                    AIInsight.meeting_id == meeting_id,
                    AIInsight.worth_remembering.is_(False),
                ).order_by(AIInsight.created_at)
            )
        ).scalars().all()
        if not rows:
            return 0

        # 拼 LLM 输入
        candidates = [
            {
                "id": str(r.id),
                "type": r.type,
                "content": r.content,
                "evidence": r.evidence or "",
            }
            for r in rows
        ]
        brief_part = (
            f"会议背景:\n{m.description.strip()[:500]}\n\n"
            if m.description and m.description.strip()
            else ""
        )
        user_prompt = (
            f'会议: "{m.title or "未命名会议"}"\n\n'
            f"{brief_part}"
            f"候选快照 (JSON):\n{json.dumps(candidates, ensure_ascii=False, indent=2)[:8000]}\n\n"
            f"请按 system prompt 输出 {{ids: [...]}}, 挑值得长期记的."
        )

        parts: list[str] = []
        try:
            async for chunk in stream_chat(
                provider=provider,
                system_prompt=WORTH_REMEMBERING_SYSTEM,
                user_prompt=user_prompt,
                temperature=0.2,
            ):
                if chunk:
                    parts.append(chunk)
        except LlmError as e:
            logger.warning(
                "worth_remembering meeting=%s LLM failed: %s", meeting_id, e
            )
            return 0

        chosen_ids = _parse_worth_remembering_response("".join(parts))
        if not chosen_ids:
            logger.info(
                "worth_remembering meeting=%s: LLM 挑 0 条", meeting_id
            )
            return 0

        # 校验 chosen_ids 必须在 candidates 里 — 防 LLM 编造 id
        valid_ids: list[uuid.UUID] = []
        candidate_set = {r.id for r in rows}
        for s in chosen_ids:
            try:
                u = uuid.UUID(s)
            except (ValueError, TypeError):
                continue
            if u in candidate_set:
                valid_ids.append(u)

        if not valid_ids:
            logger.warning(
                "worth_remembering meeting=%s: LLM 返了 id 但无一对得上 (编造?)",
                meeting_id,
            )
            return 0

        await db.execute(
            update(AIInsight)
            .where(AIInsight.id.in_(valid_ids))
            .values(worth_remembering=True)
        )
        await db.commit()
        logger.info(
            "worth_remembering meeting=%s: 标 %d 条 (LLM 选了 %d, %d 个无效被丢)",
            meeting_id, len(valid_ids), len(chosen_ids),
            len(chosen_ids) - len(valid_ids),
        )
        return len(valid_ids)


# ===== Pipeline: 会议结束时一次性跑两步 =======================================

async def run_insight_pipeline(meeting_id: uuid.UUID) -> dict[str, int]:
    """会议结束 hook 调这一个就够: 抽 + 筛.

    返回 {"extracted": N, "selected": M}, 给调用方 / log 用.
    异常一律 log + 返 0, 不抛 (BackgroundTask 不希望阻塞主流程).
    """
    try:
        extracted = await extract_insights_for_meeting(meeting_id)
    except Exception:
        logger.exception("insight extract pipeline failed meeting=%s", meeting_id)
        extracted = 0

    try:
        selected = await select_worth_remembering_for_meeting(meeting_id)
    except Exception:
        logger.exception("worth_remembering pipeline failed meeting=%s", meeting_id)
        selected = 0

    return {"extracted": extracted, "selected": selected}
