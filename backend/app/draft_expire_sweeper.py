"""v26.6-05 · 沉淀草稿过期 sweeper.

7 天没人审批的 KbSedimentationDraft / MemoryDraft → 自动标 status='expired'.
跟 due_reminder_loop 同样模式 — 1 个 asyncio loop, 每 1h tick.

为啥要这个: 草稿 堆 pending 太久, 老草稿 跟 当前 task 状态 已经 不一致 (例如
原 task 被删 / agent 被转), 让它 自动 expire 比 让 manager 一个个 拒 更清爽.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from .db import SessionLocal
from .models import KbSedimentationDraft, MemoryDraft

logger = logging.getLogger(__name__)

_TICK_SECONDS = int(os.getenv("DRAFT_EXPIRE_TICK_SECONDS", "3600"))  # 1h
_EXPIRE_AFTER = timedelta(days=int(os.getenv("DRAFT_EXPIRE_DAYS", "7")))


async def _sweep_once() -> tuple[int, int]:
    """Single pass: 标 7+ 天的 pending 为 expired. 返回 (kb_expired, mem_expired)."""
    cutoff = datetime.now(timezone.utc) - _EXPIRE_AFTER
    async with SessionLocal() as db:
        # KB 沉淀
        kb_result = await db.execute(
            update(KbSedimentationDraft)
            .where(
                KbSedimentationDraft.status == "pending",
                KbSedimentationDraft.created_at < cutoff,
            )
            .values(status="expired")
        )
        kb_count = kb_result.rowcount or 0
        # Memory
        mem_result = await db.execute(
            update(MemoryDraft)
            .where(
                MemoryDraft.status == "pending",
                MemoryDraft.created_at < cutoff,
            )
            .values(status="expired")
        )
        mem_count = mem_result.rowcount or 0
        await db.commit()
    return int(kb_count), int(mem_count)


async def draft_expire_loop(stop_event: asyncio.Event) -> None:
    """Background loop. Cancel via stop_event."""
    logger.info(
        "draft_expire_sweeper started: tick=%ds expire_after=%dd",
        _TICK_SECONDS, _EXPIRE_AFTER.days,
    )
    while not stop_event.is_set():
        try:
            kb_n, mem_n = await _sweep_once()
            if kb_n or mem_n:
                logger.info(
                    "[draft_expire_sweeper] expired %d KB drafts, %d Memory drafts",
                    kb_n, mem_n,
                )
        except Exception:
            logger.exception("draft_expire_sweeper tick failed (non-fatal)")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_TICK_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("draft_expire_sweeper stopped")
