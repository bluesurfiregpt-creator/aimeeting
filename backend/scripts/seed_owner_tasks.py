"""
v27.0-mobile · 给 owner (bluesurfire) seed 几条待办+草稿, 方便单账号摸 /m/tasks.

跑法 (prod):
  docker exec aimeeting-backend python -m scripts.seed_owner_tasks

幂等: 按 content 字面去重.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Agent,
    Meeting,
    MeetingActionItem,
    MemoryDraft,
    User,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
logger = logging.getLogger("seed_owner_tasks")


OWNER_EMAIL = "bluesurfiregpt@gmail.com"


# 3 条 action items + 2 条 memory drafts, 挂在已有的物业会议上
ACTION_ITEMS = [
    {
        "content": "审核数据合规整改方案 + 拍板 Excel 信息处理优先级",
        "meeting_title_match": "数据安全合规",
        "due_days": 7,
        "evidence": "陈师宇: Excel 那份必须处理 — 这是合规雷",
    },
    {
        "content": "B 栋电梯改造方案 走永大 OR 通力 — 决策签字",
        "meeting_title_match": "电梯改造",
        "due_days": 5,
        "evidence": "李局长: 维保公司要换. 这是第一个决策.",
    },
    {
        "content": "Q1 投诉数据复盘报告 — 汇报给区局",
        "meeting_title_match": "Q1 业主投诉",
        "due_days": 10,
        "evidence": "李局长: Q2 增一次业主满意度调查",
    },
]

MEMORY_DRAFTS = [
    {
        "content": "处理跨部门合规整改时, 必须先确认现有 Excel/Word 等离散存储里的业主敏感信息, 再排期整改, 防止漏点引发 12345 投诉.",
        "agent_name": "数据洞察",
        "meeting_title_match": "数据安全合规",
    },
    {
        "content": "大额维修资金决策走业主大会前, 信息中心/物业管理处必须提前 3 周准备完整对比表, 防止业主群里临时反对拖进度.",
        "agent_name": "数据洞察",
        "meeting_title_match": "电梯改造",
    },
]


async def main():
    async with SessionLocal() as db:
        # 1. 拉 owner user
        owner = (
            await db.execute(select(User).where(User.email == OWNER_EMAIL))
        ).scalar_one_or_none()
        if not owner or not owner.workspace_id:
            logger.error("找不到 owner / workspace")
            return
        ws_id = owner.workspace_id
        logger.info("owner=%s workspace=%s", owner.email, ws_id)

        # 2. 拉所有 meetings 用于关联
        meetings = (
            await db.execute(
                select(Meeting).where(Meeting.workspace_id == ws_id)
            )
        ).scalars().all()

        def find_meeting(name_part: str) -> Meeting | None:
            for m in meetings:
                if name_part in (m.title or ""):
                    return m
            return None

        # 3. seed action items
        added_ai = 0
        for spec in ACTION_ITEMS:
            existing = (
                await db.execute(
                    select(MeetingActionItem).where(
                        MeetingActionItem.workspace_id == ws_id,
                        MeetingActionItem.content == spec["content"],
                    )
                )
            ).scalar_one_or_none()
            if existing:
                # 老的存在 — 把 assignee 改成 owner (防止之前 seed 错)
                if existing.assignee_user_id != owner.id:
                    existing.assignee_user_id = owner.id
                    logger.info("action item 重新绑 owner: %s", spec["content"][:30])
                continue
            m = find_meeting(spec["meeting_title_match"])
            if not m:
                logger.warning("跳过 (找不到会议): %s", spec["meeting_title_match"])
                continue
            due_at = datetime.now(timezone.utc) + timedelta(days=spec["due_days"])
            ai = MeetingActionItem(
                workspace_id=ws_id,
                meeting_id=m.id,
                content=spec["content"],
                assignee_user_id=owner.id,
                due_at=due_at,
                status="open",
                source_type="summary",
                evidence_quote=spec.get("evidence"),
            )
            db.add(ai)
            added_ai += 1
            logger.info("action item added: %s", spec["content"][:30])

        # 4. seed memory drafts (primary_user = owner — 数据洞察归 owner)
        # 数据洞察 agent 的 primary_user 是 owner, drafts 来自这 agent
        ds_agent = (
            await db.execute(
                select(Agent).where(
                    Agent.workspace_id == ws_id,
                    Agent.name == "数据洞察",
                )
            )
        ).scalar_one_or_none()
        if not ds_agent:
            logger.warning("找不到 数据洞察 agent — 跳过 memory drafts")
        else:
            added_md = 0
            for spec in MEMORY_DRAFTS:
                existing = (
                    await db.execute(
                        select(MemoryDraft).where(
                            MemoryDraft.workspace_id == ws_id,
                            MemoryDraft.proposed_content == spec["content"],
                        )
                    )
                ).scalar_one_or_none()
                if existing:
                    continue
                m = find_meeting(spec["meeting_title_match"])
                if not m:
                    logger.warning("跳过 draft (找不到会议): %s", spec["meeting_title_match"])
                    continue
                md = MemoryDraft(
                    workspace_id=ws_id,
                    source_type="meeting",
                    source_meeting_id=m.id,
                    target_agent_ids=[str(ds_agent.id)],
                    primary_user_id=owner.id,
                    proposed_content=spec["content"],
                    proposed_scope="project",
                    proposed_scope_ref=str(m.id),
                    proposed_importance=0.65,
                    proposed_data_classification="general",
                    status="pending",
                )
                db.add(md)
                added_md += 1
                logger.info("memory draft added: %s", spec["content"][:40])
            logger.info("memory drafts added: %d", added_md)

        await db.commit()
        logger.info("action items added: %d", added_ai)
        logger.info("done.")


if __name__ == "__main__":
    asyncio.run(main())
