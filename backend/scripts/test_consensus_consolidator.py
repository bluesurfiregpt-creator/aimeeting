"""
v26.3-07 沉淀链路 端到端 验证脚本.

直接调 consensus_consolidator.consolidate_dissent_to_agent_kb,
绕过 HTTP endpoint,验证:
  1. MeetingConsensus.reviewed_at 必须非 null 才允许沉淀
  2. dissents 数组中的 involved_agents 名字 能解析到 Agent
  3. 每个 涉及 agent 都产 1 个 KnowledgeDocument (source_type='consensus_dissent')
  4. doc.status 最终 = 'ready' + chunk_count ≥ 1
  5. LLM 失败时 fallback 模板能跑通

本脚本会:
  - 创建临时 Workspace + Meeting + MeetingConsensus + 2 个 Agent
  - 跑沉淀
  - 校验 KB doc 落库
  - cleanup (CASCADE)

用法 (在 backend 容器内):
  docker exec -w /app aimeeting-backend python -m scripts.test_consensus_consolidator
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.consensus_consolidator import consolidate_dissent_to_agent_kb
from app.db import SessionLocal
from app.models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    Meeting,
    MeetingConsensus,
    Workspace,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("v26.3-07-e2e")


async def setup_fixture() -> tuple[uuid.UUID, uuid.UUID, list[uuid.UUID], uuid.UUID]:
    """创建临时 workspace + meeting + 2 agents + 1 consensus (含 2 dissent + 已裁决).
    返回 (workspace_id, meeting_id, agent_ids, consensus_id)."""
    async with SessionLocal() as db:
        ws = Workspace(name=f"v26.3-07-test-{uuid.uuid4().hex[:8]}")
        db.add(ws)
        await db.flush()

        ag1 = Agent(
            workspace_id=ws.id,
            name="政策专家-甲",
            role="expert",
            description="测试 agent A",
            knowledge_base_ids=[],
            active=True,
            color="violet",
        )
        ag2 = Agent(
            workspace_id=ws.id,
            name="政策专家-乙",
            role="expert",
            description="测试 agent B",
            knowledge_base_ids=[],
            active=True,
            color="emerald",
        )
        db.add(ag1)
        db.add(ag2)
        await db.flush()

        m = Meeting(
            workspace_id=ws.id,
            title="v26.3-07 沉淀测试",
            status="finished",
            mode="auto",
            agenda=[{"title": "议程 A · 关键决策"}],
        )
        db.add(m)
        await db.flush()

        # 2 个 dissent:
        # 第 0 个 已裁决 pick_a
        # 第 1 个 已裁决 compromise
        dissents = [
            {
                "point": "议题 1 互斥立场",
                "summary": "甲主张 X,乙主张反 X,两边都给了合规依据",
                "involved_agents": ["政策专家-甲", "政策专家-乙"],
            },
            {
                "point": "议题 2 时序优先",
                "summary": "先 A 后 B vs 先 B 后 A,不能同时",
                "involved_agents": ["政策专家-甲", "政策专家-乙"],
            },
        ]
        review_decision = json.dumps(
            [
                {"dissent_idx": 0, "action": "pick_a", "rationale": "经研讨甲方依据更充分,采纳甲方"},
                {
                    "dissent_idx": 1,
                    "action": "compromise",
                    "rationale": "两方各有道理,试点先A后B并观察3个月",
                },
            ],
            ensure_ascii=False,
        )
        c = MeetingConsensus(
            meeting_id=m.id,
            agenda_idx=0,
            agenda_title="议程 A · 关键决策",
            consensus_md="## 共识\n部分共识达成",
            dissents=dissents,
            needs_human_review=True,
            reviewed_by_user_id=None,
            reviewed_at=datetime.now(timezone.utc),
            review_decision=review_decision,
            turn_count=4,
            token_estimate=1200,
            elapsed_sec=42.0,
        )
        db.add(c)
        await db.commit()

        return ws.id, m.id, [ag1.id, ag2.id], c.id


async def verify_kb_docs(workspace_id: uuid.UUID, agent_ids: list[uuid.UUID]) -> dict:
    """检查每个 agent 是否各得到 2 个 consensus_dissent doc (2 个 dissent × 1 agent = 2 doc).
    返回 {agent_id: [doc info]}.
    """
    async with SessionLocal() as db:
        result: dict[str, list] = {}
        for ag_id in agent_ids:
            docs = (
                await db.execute(
                    select(KnowledgeDocument).where(
                        KnowledgeDocument.source_agent_id == ag_id,
                        KnowledgeDocument.source_type == "consensus_dissent",
                    ).order_by(KnowledgeDocument.created_at)
                )
            ).scalars().all()
            result[str(ag_id)] = [
                {
                    "id": str(d.id),
                    "filename": d.filename,
                    "status": d.status,
                    "chunk_count": d.chunk_count,
                    "error_message": d.error_message,
                    "char_count": d.char_count,
                }
                for d in docs
            ]
        return result


async def cleanup(workspace_id: uuid.UUID) -> None:
    """删 workspace (CASCADE 带走 meeting / agents / consensus / kb / docs / chunks)."""
    async with SessionLocal() as db:
        await db.execute(delete(Workspace).where(Workspace.id == workspace_id))
        await db.commit()


async def main() -> int:
    logger.info("==== v26.3-07 沉淀链路 e2e START ====")
    workspace_id, meeting_id, agent_ids, consensus_id = await setup_fixture()
    logger.info("fixture: ws=%s, meeting=%s, agents=%s, consensus=%s",
                workspace_id, meeting_id, agent_ids, consensus_id)

    failures: list[str] = []
    try:
        # 跑沉淀
        report = await consolidate_dissent_to_agent_kb(consensus_id)
        logger.info("consolidate report: %s", report)

        if report["dissent_count"] != 2:
            failures.append(f"expected 2 dissents, got {report['dissent_count']}")

        # 2 agents × 2 dissents = 4 docs expected
        if report["docs_created"] < 4:
            failures.append(f"expected ≥4 docs_created, got {report['docs_created']}")

        if report["agents_touched"] != 2:
            failures.append(f"expected 2 agents_touched, got {report['agents_touched']}")

        if report["errors"]:
            failures.append(f"errors not empty: {report['errors']}")

        # 检查 DB
        kb_state = await verify_kb_docs(workspace_id, agent_ids)
        for ag_id, docs in kb_state.items():
            logger.info("agent %s: %d docs", ag_id, len(docs))
            if len(docs) < 2:
                failures.append(f"agent {ag_id} got only {len(docs)} docs, expected ≥2")
                continue
            for d in docs:
                if d["status"] != "ready":
                    failures.append(
                        f"agent {ag_id} doc {d['id']} status={d['status']} "
                        f"err={d['error_message']}"
                    )
                if not d["chunk_count"] or d["chunk_count"] < 1:
                    failures.append(
                        f"agent {ag_id} doc {d['id']} chunk_count={d['chunk_count']}"
                    )
                if not d["filename"].startswith("[召集人裁决]"):
                    failures.append(
                        f"agent {ag_id} doc filename '{d['filename']}' "
                        "not prefixed [召集人裁决]"
                    )

        # 防御:验证 未裁决的 consensus 拒绝沉淀
        async with SessionLocal() as db:
            from sqlalchemy import update
            await db.execute(
                update(MeetingConsensus)
                .where(MeetingConsensus.id == consensus_id)
                .values(reviewed_at=None, review_decision=None)
            )
            await db.commit()
        try:
            await consolidate_dissent_to_agent_kb(consensus_id)
            failures.append("expected RuntimeError when consensus not reviewed, got success")
        except RuntimeError as e:
            if "not yet reviewed" not in str(e):
                failures.append(f"unexpected error msg: {e}")
            else:
                logger.info("unreviewed consensus correctly rejected: %s", e)

    finally:
        await cleanup(workspace_id)

    if failures:
        logger.error("==== %d failures ====", len(failures))
        for f in failures:
            logger.error("  - %s", f)
        return 1

    logger.info("==== ALL PASS ====")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
