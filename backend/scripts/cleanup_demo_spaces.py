"""
v27.0-mobile · 一次性清理 demo workspace 数据库里中文字符之间的随机空格.

来由: 之前的 seed_demo_property + backfill_ai_insights 把含空格的中文写入了
meeting.title / transcript / agent_message / action_item / memory_draft /
long_term_memory / agent.persona 等字段. 前端代码已扫一遍, 但数据库里仍是脏的.

策略: 仅清理 owner 所在的 demo workspace, 用前端同套迭代正则
([一-鿿])\s+([一-鿿]) → 收缩.

跑法 (prod):
  docker exec aimeeting-backend python -m scripts.cleanup_demo_spaces

幂等: 重复跑无副作用 (没空格的字串不动).
"""

from __future__ import annotations

import asyncio
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Agent,
    AIInsight,
    LongTermMemory,
    Meeting,
    MeetingActionItem,
    MeetingAgentMessage,
    MeetingTranscript,
    MemoryDraft,
    User,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
logger = logging.getLogger("cleanup_spaces")


PAT = re.compile(r"([一-鿿])\s+([一-鿿])")


def fix(s):
    """迭代收缩中文之间的空白 (跟前端 A 步同套). None / 非 str 透传."""
    if not s or not isinstance(s, str):
        return s
    while True:
        new = PAT.sub(r"\1\2", s)
        if new == s:
            return s
        s = new


async def main():
    async with SessionLocal() as db:
        owner = (
            await db.execute(
                select(User).where(User.email == "bluesurfiregpt@gmail.com")
            )
        ).scalar_one_or_none()
        if not owner or not owner.workspace_id:
            logger.error("找不到 owner / workspace")
            return
        ws_id = owner.workspace_id
        logger.info("cleaning workspace=%s", ws_id)

        # ----- 1. Meeting.title + agenda --------------------------------
        meetings = (
            await db.execute(
                select(Meeting).where(Meeting.workspace_id == ws_id)
            )
        ).scalars().all()
        meeting_ids = [m.id for m in meetings]
        m_n = 0
        for m in meetings:
            new_title = fix(m.title)
            if new_title != m.title:
                m.title = new_title
                m_n += 1
            if m.agenda:
                new_agenda = []
                agenda_changed = False
                for item in m.agenda:
                    if isinstance(item, dict):
                        nitem = dict(item)
                        for k in ("title", "note"):
                            v = nitem.get(k)
                            nv = fix(v)
                            if nv != v:
                                nitem[k] = nv
                                agenda_changed = True
                        new_agenda.append(nitem)
                    else:
                        new_agenda.append(item)
                if agenda_changed:
                    m.agenda = new_agenda
        logger.info("meetings cleaned: %d", m_n)

        # ----- 2. action items ------------------------------------------
        action_items = (
            await db.execute(
                select(MeetingActionItem).where(MeetingActionItem.workspace_id == ws_id)
            )
        ).scalars().all()
        ai_n = 0
        for ai in action_items:
            new_c = fix(ai.content)
            new_e = fix(ai.evidence_quote)
            if new_c != ai.content:
                ai.content = new_c
                ai_n += 1
            if new_e != ai.evidence_quote:
                ai.evidence_quote = new_e
        logger.info("action_items cleaned: %d", ai_n)

        # ----- 3. transcripts -------------------------------------------
        if meeting_ids:
            tx = (
                await db.execute(
                    select(MeetingTranscript).where(
                        MeetingTranscript.meeting_id.in_(meeting_ids)
                    )
                )
            ).scalars().all()
            tx_n = 0
            for t in tx:
                new = fix(t.text)
                if new != t.text:
                    t.text = new
                    tx_n += 1
            logger.info("transcripts cleaned: %d", tx_n)

            # ----- 4. agent messages ------------------------------------
            agm = (
                await db.execute(
                    select(MeetingAgentMessage).where(
                        MeetingAgentMessage.meeting_id.in_(meeting_ids)
                    )
                )
            ).scalars().all()
            agm_n = 0
            for a in agm:
                new = fix(a.text)
                if new != a.text:
                    a.text = new
                    agm_n += 1
            logger.info("agent_messages cleaned: %d", agm_n)

        # ----- 5. AI insights -------------------------------------------
        insights = (
            await db.execute(
                select(AIInsight).where(AIInsight.workspace_id == ws_id)
            )
        ).scalars().all()
        ins_n = 0
        for i in insights:
            new_c = fix(i.content)
            new_e = fix(i.evidence)
            if new_c != i.content:
                i.content = new_c
                ins_n += 1
            if new_e != i.evidence:
                i.evidence = new_e
        logger.info("ai_insights cleaned: %d", ins_n)

        # ----- 6. memory drafts -----------------------------------------
        drafts = (
            await db.execute(
                select(MemoryDraft).where(MemoryDraft.workspace_id == ws_id)
            )
        ).scalars().all()
        md_n = 0
        for d in drafts:
            new = fix(d.proposed_content)
            if new != d.proposed_content:
                d.proposed_content = new
                md_n += 1
        logger.info("memory_drafts cleaned: %d", md_n)

        # ----- 7. long-term memory --------------------------------------
        mems = (
            await db.execute(
                select(LongTermMemory).where(LongTermMemory.workspace_id == ws_id)
            )
        ).scalars().all()
        mem_n = 0
        for mem in mems:
            new = fix(mem.content)
            if new != mem.content:
                mem.content = new
                mem_n += 1
        logger.info("long_term_memory cleaned: %d", mem_n)

        # ----- 8. agents (persona/tone/boundary/etc) --------------------
        agents = (
            await db.execute(
                select(Agent).where(Agent.workspace_id == ws_id)
            )
        ).scalars().all()
        ag_n = 0
        for a in agents:
            for field in ("name", "nickname", "domain", "persona", "tone", "boundary"):
                val = getattr(a, field, None)
                if val and isinstance(val, str):
                    new = fix(val)
                    if new != val:
                        setattr(a, field, new)
                        ag_n += 1
        logger.info("agent fields cleaned: %d", ag_n)

        await db.commit()
        logger.info("DONE")


if __name__ == "__main__":
    asyncio.run(main())
