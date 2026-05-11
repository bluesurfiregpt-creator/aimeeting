"""
v26.0 backfill: 把现有 Task 重新派给 AI 专家 (assignee_agent_id).

之前 v25.x 的 task 都只有 assignee_user_id,没有 agent_id.v26 把"主责" 概念
变成 AI 专家,旧 task 要补回 agent_id 才能正常显示 / 路由 / 评分.

策略:
  对每条 status != 'cancelled' 的 task:
    1) 跑 LLM 抽 主题关键词 (qwen-max + 反幻觉 prompt) — 2-5 个词
    2) 跑 v26 agent-routing (find_best_agent_for_task)
    3) decision tier:
         high   → 自动写 assignee_agent_id + assignee_user_id (= primary_user)
         medium → 写 assignee_agent_id (但保留 assignee_user_id) 标 hint
         low    → 不动 task,记录到日志让 leader 看
    4) 把 topic_keywords 也存到 task.source_ref

用法:
    # dry-run (默认):看会改哪些
    docker exec -w /app aimeeting-backend python -m scripts.backfill_task_agent
    # apply 写入
    docker exec -w /app aimeeting-backend python -m scripts.backfill_task_agent --apply

只在演示 / 客户上线前 一次性跑.重复跑 幂等(已有 agent_id 的 task 跳过).
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from typing import Optional

from sqlalchemy import select, update

from app.db import SessionLocal
from app.llm_direct import LlmError, get_active_provider, stream_chat
from app.models import Agent, MeetingActionItem, Task
from app.routing import (
    _HIGH_CONFIDENCE_THRESHOLD,
    _MIN_COMPOSITE_THRESHOLD,
    find_best_agent_for_task,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


_TOPIC_PROMPT = """你是任务分类助手.给你一条任务的内容,抽出 2-5 个【主题关键词】.

要求:
- **JSON 单行**:{"keywords": ["词1", "词2", ...]}
- 关键词 2-6 字,**业务领域 / 工作类型 / 具体技术** 等(企业服务 / 政策研究 / UI/UX / PRD撰写 / 法务 / 数据分析 / Figma 等)
- **不要**:真人姓名、整句、"任务"等空洞词
- 找不到合适关键词 → 返回 `{"keywords": []}`

例:
  输入: "完善系统功能模块划分"
  输出: {"keywords": ["产品规划","需求分析","系统架构"]}
"""


async def _extract_topic_keywords(provider, content: str) -> list[str]:
    """LLM 抽主题关键词.失败返回 []."""
    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_TOPIC_PROMPT,
            user_prompt=f"任务内容: {content[:500]}",
            model_override="qwen-max-latest",
            temperature=0.0,
            top_p=0.1,
        ):
            chunks.append(c)
    except LlmError:
        return []

    raw = "".join(chunks).strip()
    # 去掉可能的 markdown code fence
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        raw = raw.rsplit("```", 1)[0]
    try:
        obj = json.loads(raw)
        kws = obj.get("keywords")
        if isinstance(kws, list):
            return [str(k).strip() for k in kws if isinstance(k, str) and k.strip()][:5]
    except (json.JSONDecodeError, AttributeError):
        pass
    return []


async def run(apply: bool = False, limit: Optional[int] = None) -> None:
    """跑 backfill.dry-run 时只 print,apply=True 才 commit."""
    async with SessionLocal() as db:
        provider = await get_active_provider(db)
        if provider is None:
            logger.error("No active LLM provider — abort")
            return

        # 拿所有 没有 assignee_agent_id 且 没 cancel 的 task
        q = select(Task).where(
            Task.assignee_agent_id.is_(None),
            Task.status != "cancelled",
        )
        if limit:
            q = q.limit(limit)
        tasks = (await db.execute(q)).scalars().all()
        logger.info(
            "Found %d tasks without assignee_agent_id (apply=%s)",
            len(tasks), apply,
        )

        stats = {"high": 0, "medium": 0, "low": 0, "no_keywords": 0, "no_decision": 0}

        for i, t in enumerate(tasks, 1):
            logger.info(
                "[%d/%d] %s task=%s status=%s",
                i, len(tasks),
                "🤖" if apply else "(dry-run)",
                str(t.id)[:8],
                t.status,
            )
            logger.info("       content: %s", t.content[:100])

            # 已有 keywords ? skip LLM
            existing_kws: list[str] = []
            if isinstance(t.source_ref, dict):
                ek = t.source_ref.get("topic_keywords")
                if isinstance(ek, list):
                    existing_kws = [k for k in ek if isinstance(k, str)]
            if existing_kws:
                kws = existing_kws
                logger.info("       cached topic_keywords: %s", kws)
            else:
                kws = await _extract_topic_keywords(provider, t.content)
                logger.info("       LLM topic_keywords: %s", kws)

            if not kws:
                stats["no_keywords"] += 1
                continue

            # 跑 routing
            decision = await find_best_agent_for_task(
                db,
                workspace_id=t.workspace_id,
                task_content=t.content,
                topic_keywords=kws,
                threshold=0.0,  # 拿全候选
            )
            if decision is None:
                logger.warning("       no agent candidates (workspace has no bound primary_user agents)")
                stats["no_decision"] += 1
                continue

            tier = decision.confidence_tier
            winner = decision.winner
            logger.info(
                "       routing winner: agent=%s composite=%.3f tier=%s primary_user=%s",
                winner.agent_name, winner.composite, tier,
                winner.primary_user_name or "(none)",
            )
            stats[tier] += 1

            if not apply:
                continue

            # 写入 — high 全写,medium 也写 (assignee_agent_id) 但 assignee_user_id
            # 保持原状(让 leader 决定要不要 dispatch).
            new_source_ref = dict(t.source_ref) if isinstance(t.source_ref, dict) else {}
            new_source_ref["topic_keywords"] = kws
            new_source_ref["backfilled_at"] = uuid.uuid1().hex  # 标记
            new_source_ref["assignee_agent_id"] = str(winner.agent_id)

            update_values: dict = {
                "assignee_agent_id": winner.agent_id,
                "source_ref": new_source_ref,
            }
            # high 才同步更新 assignee_user_id (= primary_user_id)
            if tier == "high" and winner.primary_user_id and t.status == "open":
                update_values["assignee_user_id"] = winner.primary_user_id

            await db.execute(
                update(Task).where(Task.id == t.id).values(**update_values)
            )

        if apply:
            await db.commit()

        logger.info(
            "Done. stats: high=%d medium=%d low=%d no_kw=%d no_decision=%d",
            stats["high"], stats["medium"], stats["low"],
            stats["no_keywords"], stats["no_decision"],
        )


def main():
    apply = "--apply" in sys.argv
    limit_arg = None
    for arg in sys.argv:
        if arg.startswith("--limit="):
            try:
                limit_arg = int(arg.split("=", 1)[1])
            except ValueError:
                pass
    asyncio.run(run(apply=apply, limit=limit_arg))


if __name__ == "__main__":
    main()
