"""
v27.0-mobile Phase 0: backfill AIInsight from existing MeetingAgentMessage.

启 发式 抽 取 (无 LLM 成本), 让 移动端 智囊 视图 立刻 有 数据.
后续 Phase 改 closure_curator LLM 抽 — 但 那 是 上线 后 优化.

跑法 (prod):
  docker exec aimeeting-backend python -m scripts.backfill_ai_insights

幂等: 每 个 AgentMessage 仅 抽一次 (查 已存在 AIInsight WHERE source_message_id=X).
"""

from __future__ import annotations

import asyncio
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import AIInsight, Agent, Meeting, MeetingAgentMessage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
logger = logging.getLogger("backfill_ai_insights")


def _detect_type(text: str) -> str:
    """启 发式 — 看 前 30 字 决定 type."""
    head = text[:40]
    # 优先级: 风险 > 决策建议 > 洞察 > 思路 > 建议
    if any(kw in head for kw in ("风险", "缺", "可能 误", "雷", "违规", "合规 问题")):
        return "风险"
    if any(kw in head for kw in ("决议", "拍板", "选 一个", "锁定", "投票")):
        return "决策建议"
    if any(kw in head for kw in ("数据", "%", "占比", "同比", "环比", "趋势", "异常")):
        return "洞察"
    if any(kw in head for kw in ("拆", "拆成", "分 成", "可以分", "三 步", "两 个 维度", "建议 流程")):
        return "思路"
    return "建议"


def _split_content_evidence(text: str) -> tuple[str, str | None]:
    """从 一段 AgentMessage 文本 抽出: 一句话 结论 + 一段 依据.

    简单 启发式:
      - 找 第一个 "。" 或 "\n" 截断 → 是 结论
      - 剩 下 取 前 200 字 → 是 依据
    """
    text = text.strip()
    if not text:
        return "", None
    # 找 第一个 句号 (中 + 英) OR 换行
    m = re.search(r"[。\n]", text)
    if m:
        content = text[: m.start()].strip()
        evidence = text[m.end():].strip()[:300] or None
    else:
        # 没 句号 — 整段 当 结论, 没 依据
        content = text[:120].strip()
        evidence = None
    # 防 空
    if not content:
        content = text[:120].strip()
    return content, evidence


async def backfill_one_workspace(db: AsyncSession, workspace_id) -> int:
    """扫 该 workspace 所有 AgentMessage, 给 没 抽过 的 抽 AIInsight."""
    # 必 join Agent — 老 数据 有 孤儿 message (agent 已被 删) 跳 过
    rows = (
        await db.execute(
            select(MeetingAgentMessage, Meeting.workspace_id, Meeting.id)
            .join(Meeting, Meeting.id == MeetingAgentMessage.meeting_id)
            .join(Agent, Agent.id == MeetingAgentMessage.agent_id)  # 强制 inner join 过滤 孤儿
            .where(Meeting.workspace_id == workspace_id)
        )
    ).all()

    n_added = 0
    for msg, ws_id, mid in rows:
        # 幂等 check
        existing = (
            await db.execute(
                select(AIInsight.id).where(AIInsight.source_message_id == msg.id)
            )
        ).scalar_one_or_none()
        if existing:
            continue
        # text 不应 太 短
        if not msg.text or len(msg.text.strip()) < 30:
            continue

        insight_type = _detect_type(msg.text)
        content, evidence = _split_content_evidence(msg.text)

        # topic_idx 从 agenda_idx 字段 拿 (v26.3 加 在 MeetingAgentMessage)
        topic_idx = getattr(msg, "agenda_idx", None)

        insight = AIInsight(
            workspace_id=ws_id,
            meeting_id=mid,
            agent_id=msg.agent_id,
            type=insight_type,
            content=content,
            evidence=evidence,
            source_message_id=msg.id,
            topic_idx=topic_idx,
        )
        db.add(insight)
        n_added += 1

    await db.commit()
    return n_added


async def main() -> None:
    async with SessionLocal() as db:
        # 拉 所有 workspace
        from app.models import Workspace
        workspaces = (
            await db.execute(select(Workspace.id, Workspace.name))
        ).all()
        total = 0
        for ws_id, ws_name in workspaces:
            n = await backfill_one_workspace(db, ws_id)
            logger.info("workspace %s (%s) — backfilled %d insights", ws_name, ws_id, n)
            total += n
        logger.info("done. total = %d new insights", total)


if __name__ == "__main__":
    asyncio.run(main())
