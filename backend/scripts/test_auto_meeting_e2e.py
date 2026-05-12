"""
v26.3-03 端到端验证脚本.

直接调 auto_meeting_orchestrator 的入口函数,不走 HTTP — 用于
在服务器上 docker exec 跑一次完整的 auto meeting,验证:
  1. mode='auto' meeting 能成功创建
  2. orchestrator 主循环跑完 N 议程
  3. meeting_agent_message 落库(含 agenda_idx + reply_to)
  4. meeting_consensus 一议程一行,dissents 按预期
  5. summary_md 由 v25 链路 finalize 出来
  6. auto_state.phase 终态 = 'done'

注意:本脚本会真调 LLM,跑 3 议程 ~2 分钟,~3 元 LLM 成本.

用法:
  docker exec -w /app aimeeting-backend python -m scripts.test_auto_meeting_e2e

cleanup:
  脚本结束自动删 test meeting (CASCADE 带走 messages / consensus).
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.auto_meeting_orchestrator import start_auto_meeting, _running_tasks
from app.auto_meeting_state import PHASE_DONE, PHASE_FAILED, PHASE_CANCELLED, get_phase
from app.db import SessionLocal
from app.models import (
    Agent,
    Meeting,
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingConsensus,
    Workspace,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("v26.3-03-e2e")


# 用 3 议程 (~2 分钟跑完,缩短验证时间)
TEST_TITLE = "[v26.3-03 E2E 验证] 公积金管理办法快速研究"
TEST_AGENDA = [
    {"title": "现行管理办法核心条款梳理"},
    {"title": "新房产政策对公积金的影响"},
    {"title": "管理办法修订方向建议"},
]


async def setup_test_meeting() -> uuid.UUID:
    """SQL 直接创建 一个 mode='auto' meeting + 邀请 4 个 expert + moderator."""
    from app.auto_meeting_state import default_auto_state
    async with SessionLocal() as db:
        ws = (
            await db.execute(select(Workspace).order_by(Workspace.created_at))
        ).scalars().first()
        if not ws:
            raise RuntimeError("no workspace")

        # 拿 4 个绑了 primary_user 的 expert agent
        experts = (
            await db.execute(
                select(Agent).where(
                    Agent.workspace_id == ws.id,
                    Agent.role == "expert",
                    Agent.is_active.is_(True),
                    Agent.primary_user_id.is_not(None),
                ).limit(4)
            )
        ).scalars().all()
        if len(experts) < 3:
            raise RuntimeError(
                f"workspace {ws.name} 只有 {len(experts)} 个 expert 绑了 primary_user. "
                "需 ≥3 才能跑 auto."
            )

        # 创建 meeting
        m = Meeting(
            title=TEST_TITLE,
            status="ongoing",
            workspace_id=ws.id,
            mode="auto",
            agenda=TEST_AGENDA,
            auto_state=default_auto_state(),
            started_at=datetime.now(timezone.utc),
        )
        db.add(m)
        await db.flush()
        # attendee = 召集人 + N AI
        await db.commit()

        # 在 commit 之后才 attach attendee(确保 m.id 已稳)
        async with SessionLocal() as db2:
            for ag in experts:
                db2.add(MeetingAttendee(meeting_id=m.id, agent_id=ag.id))
            await db2.commit()

        logger.info("✓ 创建 test meeting %s (3 议程 × %d AI)", m.id, len(experts))
        return m.id


async def wait_for_completion(meeting_id: uuid.UUID, timeout_sec: int = 600) -> str:
    """轮询 phase 直到终态."""
    t0 = time.time()
    last_print = 0.0
    while time.time() - t0 < timeout_sec:
        async with SessionLocal() as db:
            m = (
                await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            ).scalar_one_or_none()
            if not m:
                return PHASE_FAILED
            phase = get_phase(m.auto_state)
            cur_idx = (m.auto_state or {}).get("current_agenda_idx", 0)
            turn = (m.auto_state or {}).get("turn_count", 0)
        if phase in (PHASE_DONE, PHASE_FAILED, PHASE_CANCELLED):
            return phase
        if time.time() - last_print > 10:
            logger.info(
                "[%ds] phase=%s agenda=%d turn=%d",
                int(time.time() - t0), phase, cur_idx, turn,
            )
            last_print = time.time()
        await asyncio.sleep(2)
    return "timeout"


async def report(meeting_id: uuid.UUID) -> dict:
    """跑完后 拉数据 + 输出报告."""
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one()
        messages = (
            await db.execute(
                select(MeetingAgentMessage).where(
                    MeetingAgentMessage.meeting_id == meeting_id,
                ).order_by(MeetingAgentMessage.id)
            )
        ).scalars().all()
        consenses = (
            await db.execute(
                select(MeetingConsensus).where(
                    MeetingConsensus.meeting_id == meeting_id,
                ).order_by(MeetingConsensus.agenda_idx)
            )
        ).scalars().all()

    out = {
        "meeting_id": str(meeting_id),
        "phase": get_phase(m.auto_state),
        "status": m.status,
        "summary_chars": len(m.summary_md or ""),
        "message_count": len(messages),
        "consensus_count": len(consenses),
        "agenda_count": len(TEST_AGENDA),
        "total_dissents": sum(len(c.dissents or []) for c in consenses),
        "total_tokens": sum((c.token_estimate or 0) for c in consenses),
        "total_elapsed": sum((c.elapsed_sec or 0) for c in consenses),
    }
    print()
    print("=" * 72)
    print("  📊 v26.3-03 E2E 端到端 验证结果")
    print("=" * 72)
    for k, v in out.items():
        print(f"  {k:20s} = {v}")
    print()
    print("议程项详情:")
    for c in consenses:
        flag = "⚠️" if c.dissents else "✓"
        print(f"  {flag} [{c.agenda_idx + 1}] {c.agenda_title}")
        print(f"      messages={c.turn_count} · {c.elapsed_sec:.0f}s · "
              f"dissents={len(c.dissents or [])}")
        if c.consensus_md:
            print(f"      共识:{c.consensus_md[:100]}…")
        for d in (c.dissents or []):
            print(f"      ⚠ {d.get('point','?')}")
    print()
    print("Message 链路 sample (前 6 条):")
    for msg in messages[:6]:
        async with SessionLocal() as db:
            ag = (await db.execute(select(Agent).where(Agent.id == msg.agent_id))).scalar_one_or_none()
        nm = ag.name if ag else "?"
        reply = f" → 回应 #{msg.reply_to_agent_message_id}" if msg.reply_to_agent_message_id else ""
        print(f"  [{msg.id}] agenda={msg.agenda_idx} · {nm}{reply}: {msg.text[:80]}…")
    return out


async def cleanup_test_meeting(meeting_id: uuid.UUID) -> None:
    """删 test meeting (cascade 带走 messages + consensus + attendee)."""
    async with SessionLocal() as db:
        await db.execute(delete(Meeting).where(Meeting.id == meeting_id))
        await db.commit()
    logger.info("✓ cleanup meeting %s", meeting_id)


async def main():
    keep = "--keep" in sys.argv  # 留住 meeting 不删,便于手动检查
    skip_summary_wait = "--no-summary-wait" in sys.argv

    meeting_id = await setup_test_meeting()
    print(f"\n→ 启动 orchestrator for meeting {meeting_id}")
    start_auto_meeting(meeting_id)

    final_phase = await wait_for_completion(meeting_id)
    print(f"\n→ orchestrator 收尾,phase = {final_phase}")

    # wait for summary_generator (orchestrator finalize 是 await 的,应已写入)
    # 但 action_extractor 是 fire-and-forget,可能还在跑 — sleep 10s 等一下
    if final_phase == PHASE_DONE and not skip_summary_wait:
        print("\n→ 等 action_extractor / 沉淀 链跑完 (10s)...")
        await asyncio.sleep(10)

    out = await report(meeting_id)

    if not keep:
        await cleanup_test_meeting(meeting_id)
    else:
        print(f"\n--keep:meeting {meeting_id} 保留,自己手动 DELETE.")

    # 验证 pass 条件
    pass_cond = (
        out["phase"] == "done"
        and out["consensus_count"] == out["agenda_count"]
        and out["message_count"] >= 3 * out["agenda_count"]  # intro+1+wrap_up
    )
    print()
    print("=" * 72)
    print(f"  RESULT: {'✅ PASS' if pass_cond else '❌ FAIL'}")
    print("=" * 72)
    sys.exit(0 if pass_cond else 1)


if __name__ == "__main__":
    asyncio.run(main())
