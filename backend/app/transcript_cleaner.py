"""
v25.8-#2 — 实录 ASR 后修正层(Post-ASR LLM Correction).

ASR 实时转录(paraformer-realtime-v2)即使升级后,中文 WER 仍然有 5-15%,
特别是业务术语(粤港澳大湾区 / 前海合作区 / 专精特新 / 等)+ 多人语速差异
+ 噪音环境.客户测试反馈"大量错别字"主要在这一层.

策略:
  会议结束(run_identify final=True 阶段),把所有 final 实录 + 元数据
  喂给 qwen-max-latest 一次性 修字,不改语义,只改 错字 / 标点 / 业务术语
  归一化.返回的修正结果 in-place 更新 MeetingTranscript.text.

提示词死规矩(防 LLM 二次幻觉):
  - 只允许 改字 / 加标点 / 修分句
  - 严禁 添加 / 删除 / 合并 / 推断 任何内容
  - 严禁 修改时间戳 / 行号
  - 输入是 JSON 数组,输出是 同长度 JSON 数组,行号一一对应
  - 任何一行没把握修 → 原样返回(不修就不修)

调用规模:中等会议 30-100 行,单次 LLM 调用 5-15s,成本 ~¥0.05.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, resolve_model_id, stream_chat
from .models import Agent, Meeting, MeetingAttendee, MeetingTranscript, User

logger = logging.getLogger(__name__)


# v1.4.0 Saga R preflight: hardcode 是历史最终兜底, 实际跑 走 active provider.model_id
# (resolve_model_id below).
CLEANER_MODEL = "qwen-max-latest"
MAX_LINES_PER_BATCH = 80   # 长会议 拆批
MIN_LINES_TO_CLEAN = 5     # 太短不调 LLM


CLEANER_SYSTEM_PROMPT = """你是会议实录的专业校对员。任务:修复 ASR(自动语音识别)的错字 / 标点 / 业务术语,不改变意思。

【铁律】违反任何一条 都比 不改 更糟:

A. **每行只许 改字 / 加标点 / 修分句**.严禁 添加新内容 / 删除内容 / 合并句子 / 推断意图.
B. 必须输出 JSON 数组,长度 必须与输入完全相等,顺序必须一一对应.
C. 每个对象只有 "i"(行号 — 原样)和 "t"(修后文字).
D. 没把握修的 → "t" 直接复制 原文,不要改.
E. 严禁解释 / 加 markdown / 加注释 / 加前后说明 — 只输出 JSON 数组本身.
F. 错字判断 必须有上下文支持(行内 + 元数据 hot words),不要凭空猜.

【可参考的元数据】(在 user prompt 里)
  - 会议标题 / 议程 — 议题方向
  - 参会人姓名(可能在实录里被 ASR 听错 — 例如"张明"→"章明")
  - 会议邀请的 AI 专家 keywords — 重点业务术语,见到 接近的 ASR 输出 优先归一化
  - KB 文档关键词 — 同上

【典型修正例】
  ✅ "前嗨合作区" → "前海合作区"      (业务术语)
  ✅ "我们今天讨论一下,产业孵化" → "我们今天讨论一下产业孵化的问题。"  (修标点)
  ✅ "邓西的提议比较好"  → "邓西的提议比较好。"  (人名匹配 attendee + 标点)

【禁止例】
  ❌ "嗯就是" → ""  (不能删,只能保留)
  ❌ "我们要做的是产品" → "我们要做的是产品和服务"  (添加内容)
  ❌ 把短句合并成长句  (改结构)
"""


async def clean_meeting_transcripts(meeting_id: uuid.UUID) -> int:
    """读 meeting 全部 final 实录 → LLM 修字 → in-place 更新.

    返回更新的行数(0 表示 skip 或失败).idempotent.
    """
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            return 0

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

        if len(rows) < MIN_LINES_TO_CLEAN:
            logger.info(
                "transcript_cleaner: meeting %s has %d lines (<min %d), skip",
                meeting_id, len(rows), MIN_LINES_TO_CLEAN,
            )
            return 0

        # 元数据
        meta_lines = [f"会议标题:{meeting.title or '未命名'}"]
        if meeting.agenda:
            try:
                titles = [
                    (a.get("title") if isinstance(a, dict) else str(a))
                    for a in meeting.agenda
                ]
                meta_lines.append("议程项: " + " / ".join(titles))
            except Exception:
                pass

        attendees = (
            await db.execute(
                select(MeetingAttendee).where(MeetingAttendee.meeting_id == meeting_id)
            )
        ).scalars().all()
        user_ids = [a.user_id for a in attendees if a.user_id]
        agent_ids = [a.agent_id for a in attendees if a.agent_id]
        if user_ids:
            users = (
                await db.execute(select(User).where(User.id.in_(user_ids)))
            ).scalars().all()
            names = [u.name for u in users if u.name]
            if names:
                meta_lines.append("参会人姓名: " + "、".join(names))
        hot_words: list[str] = []
        if agent_ids:
            agents = (
                await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            ).scalars().all()
            for ag in agents:
                if ag.keywords:
                    hot_words.extend([kw for kw in ag.keywords if kw])
        if hot_words:
            # 去重保留顺序
            seen: set[str] = set()
            uniq: list[str] = []
            for kw in hot_words:
                if kw not in seen:
                    seen.add(kw)
                    uniq.append(kw)
            meta_lines.append("业务术语 hot words: " + "、".join(uniq[:60]))

        provider = await get_active_provider(db)

    if provider is None:
        logger.warning("transcript_cleaner: no LLM provider, skip")
        return 0

    # v1.4.0 Saga R preflight: 走 active provider.model_id, CLEANER_MODEL 仅 兜底.
    cleaner_model = resolve_model_id(provider, purpose="transcript_cleaner")

    # 分批(每批 MAX_LINES_PER_BATCH 行)
    total_updated = 0
    for batch_start in range(0, len(rows), MAX_LINES_PER_BATCH):
        batch = rows[batch_start : batch_start + MAX_LINES_PER_BATCH]
        input_arr = [{"i": r.id, "t": (r.text or "").strip()} for r in batch]
        user_prompt = (
            "\n".join(meta_lines)
            + "\n\n请按规则修字 — 输入 JSON 数组(每个对象 i=行号 t=ASR 文字),"
              "输出 同长度 JSON 数组,只输出 JSON 不加任何解释:\n\n"
            + json.dumps(input_arr, ensure_ascii=False, indent=2)
        )

        chunks: list[str] = []
        try:
            async for c in stream_chat(
                provider=provider,
                system_prompt=CLEANER_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                model_override=cleaner_model,
                temperature=0.0,
                top_p=0.1,
            ):
                chunks.append(c)
        except LlmError:
            logger.exception("transcript_cleaner LLM call failed (batch %d)", batch_start)
            continue
        except Exception:
            logger.exception("transcript_cleaner unexpected error (batch %d)", batch_start)
            continue

        raw = "".join(chunks).strip()
        # 兼容 LLM 可能加 ```json fence
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        try:
            cleaned_arr = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(
                "transcript_cleaner: LLM 返回非 JSON,batch %d 跳过.前 200 chars: %s",
                batch_start, raw[:200],
            )
            continue
        if not isinstance(cleaned_arr, list) or len(cleaned_arr) != len(batch):
            logger.warning(
                "transcript_cleaner: LLM 返回长度 不匹配(input %d / output %d),跳过 batch",
                len(batch), len(cleaned_arr) if isinstance(cleaned_arr, list) else -1,
            )
            continue

        # in-place update (只有真改了才写)
        async with SessionLocal() as db2:
            for input_item, output_item in zip(input_arr, cleaned_arr):
                if not isinstance(output_item, dict):
                    continue
                new_t = (output_item.get("t") or "").strip()
                if not new_t or new_t == input_item["t"]:
                    continue
                # 防御:如果 LLM 把一行修得 比原文 长 2x 以上 → 大概率是加内容了,丢
                if len(new_t) > len(input_item["t"]) * 2 + 20:
                    logger.warning(
                        "transcript_cleaner: line %d 修后明显变长 — 丢弃修正(原 %d → 改 %d)",
                        input_item["i"], len(input_item["t"]), len(new_t),
                    )
                    continue
                await db2.execute(
                    update(MeetingTranscript)
                    .where(MeetingTranscript.id == input_item["i"])
                    .values(text=new_t)
                )
                total_updated += 1
            await db2.commit()

    logger.info(
        "transcript_cleaner: meeting %s — %d lines updated (of %d)",
        meeting_id, total_updated, len(rows),
    )
    return total_updated
