"""
Extract action items from a finished meeting's summary.

Runs after `summary_generator.generate_summary()` succeeds (chained the same
way memory_extractor already is). Reads the summary's 待办事项 + 关键决策
sections, asks the active LLM for a structured JSON list of TODOs, fuzzy-
matches each assignee text to a workspace user, and inserts into
`meeting_action_item`.

Idempotency: before inserting, we delete existing rows with `source_type =
'summary'` for this meeting (manual / agent-added items survive). This way
calling /summary/regenerate cleanly replaces auto-extracted items without
touching anything the user manually added.

LLM output contract:
{
  "items": [
    {"content": "...", "assignee_name": "...", "due_at": "YYYY-MM-DD" | null}
  ]
}
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .llm_direct import LlmError, get_active_provider, stream_chat
from .models import Meeting, MeetingActionItem, MeetingTranscript, User
from .task_sync import add_action_with_task, delete_tasks_for_meeting_summary_actions

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """你是一名会议秘书。从会议纪要里抽取 **确定要做** 的工作型待办行动项 (Action Items).

**v26 重大变更**:任务的主责不再是真人,而是 AI 专家(科室专家).你不需要抽出
负责人姓名 — 改为抽出该任务的【主题关键词】(topic_keywords),后端会自动
根据主题路由到合适的 AI 专家.

**严格 JSON 单行** 输出,不要包代码块,不要任何其他文字:
{"items": [{"content": "<待办内容,简短>", "topic_keywords": ["关键词1","关键词2","关键词3"], "due_at": "YYYY-MM-DD 或空字符串", "evidence_quote": "<实录原文 1-3 句围绕该待办的真人对话,30-150 字>", "evidence_anchor_line_ids": [<行号数组>]}]}

topic_keywords 字段(v26 新增,关键):
  - 这条待办 所属的【业务主题 / 领域】.2-5 个 词,**短**(2-6 字).
  - 用于后端 4 维路由匹配 AI 专家(企业服务 / UI/UX / 政策 / 产品 / 法务 等).
  - **可包含**:
    • 业务领域:"企业服务"、"政策研究"、"用户体验"、"产品规划"、"合规"
    • 工作类型:"PRD 撰写"、"流程梳理"、"数据分析"、"竞品分析"
    • 具体技术:"Figma"、"Tailwind"、"Postgres"、"对接 API"
  - **不要**写:真人姓名、纪要原文整句、"待办"、"任务" 这种空洞词
  - 示例: 待办 "完善系统功能模块划分" → ["产品规划", "需求分析", "系统架构"]
  - 示例: 待办 "对齐企业端政策" → ["政策研究", "企业服务", "深圳合规"]

evidence_quote 字段是关键追溯信息:
  - 必填,不能空字符串
  - **必须**从【会议实录】(真人对话)逐字摘抄,**不是**从【会议纪要】(markdown 列表)抄
  - 长度 30-150 字,**包含 1-3 句围绕该待办的讨论上下文**.可包含说话人姓名前缀.
  - 示例(好的 evidence):"张明:我们这周要完成 PRD V2 吧? 邓西:好,我周五前提交,
    需要法务也跟一下。 李法务:可以,我下周三前出意见。"
  - 反例(坏的 evidence — 不要这样):"提交 PRD V2 — 负责: 邓西"
    (这是 纪要 markdown 的 bullet,不是真人对话原话,等于自证)
  - 找不到实录原文支撑 → 整条 待办 不抽(违反规则 A)

evidence_anchor_line_ids 字段(v25.19 新增,极重要):
  - 实录每一行 前面都有 `[<数字>]` 形式的【行号】标记,如 `[123] 张三: 我们要做 ...`
  - 你需要把【支撑这条待办的实录行号】 全部列入数组,通常 2-6 个行号
  - **行号必须从实录文本里逐字复制**,严禁猜测 / 编造数字
  - evidence_quote 摘的内容 应该 大致 对应 这些行号 的实际文本(允许略有缩减拼接)
  - 必须**至少**返回 1 个行号.找不到 → 整条 待办 不抽.

【最高优先级 反幻觉规则】违反任一条 都比 不抽 更糟:

A. **每条 content 必须能在实录原文找到对应字句来源**.找不到来源的 → 一律 不抽.
B. **严禁补全 / 演绎 / 总结引申**.即使你认为"按常理这场会议应该会做 X",原文没明确写 → 不抽.
C. **topic_keywords 必须 精炼 + 业务相关**.不要 抄实录原文整句,不要 写空洞词.
D. **due_at 只接受 原文明文写出的日期**(如 "5月20日"、"2025-06-12").
   原文没明确 deadline → due_at 必须留 空字符串.**严禁编造日期 / 倒推日期 / 默认今天**.
E. **AI 专家发言不算 工作待办依据**.如果纪要里出现 "AI 专家说..."、"AI 建议..."、
   "根据 AI 建议..." 类语言 — 这是 AI 助手的建议,不是真人承诺.**忽略**,不抽.
   实录中说话人为 "[?]" 或 AI 专家名(如 "企业服务专家"、"UI/UX 专家")的行,也不能作为
   evidence_anchor_line_ids 的唯一支撑 — 必须有真人发言行 配合.
F. **闲聊 / 私人安排 / 模糊想法 / 没有清晰承诺**: 一律不抽.
G. **evidence_anchor_line_ids 严禁编造行号**.行号必须真实存在于实录中.

**没有符合的工作待办时,必须返回** `{"items": []}`.空列表是合法且优先的输出.

抽取必须全部满足:
1. 明确的工作/项目相关行动(动词 + 对象).
2. topic_keywords 至少 2 个 (体现该任务跨什么业务领域).
3. 一句一项,不要把多件事塞一起.

【典型反例 — 不要这样做】
反例 1:纪要里 AI 专家说 "建议组织对齐 Figma 变量命名" → **不能抽** (AI 建议不算).
反例 2:纪要写 "本月底前提交" 但没说具体日期 → due_at 留空,**不要编**成 "2024-06-12".
反例 3:topic_keywords=["完善","系统","功能模块"] → 太空洞,应该是 ["产品规划","需求分析"].
反例 4:实录里没有 [42] 这行 但你编了 evidence_anchor_line_ids=[42] → 整条丢弃.

示例 1 (闲聊 + AI 建议 → 空):
输入: 「[1] 李四: 今天天气不错。[2] 企业服务专家: 建议先聚焦深圳政策。[3] 张三: 中午去吃拉面吧。」
输出: {"items": []}

示例 2 (真人承诺 → 抽):
输入: 「[10] 邓西: 这周五前我把 PRD V2 提交吧。[11] 张明: 好,法务也跟下。
       [12] 李法务: 没问题,我下周三前出合规意见。」
输出: {"items": [
  {"content":"提交 PRD V2","topic_keywords":["产品规划","PRD撰写","需求分析"],"due_at":"",
   "evidence_quote":"邓西:这周五前我把 PRD V2 提交吧。张明:好,法务也跟下。",
   "evidence_anchor_line_ids":[10,11]},
  {"content":"出具合规意见","topic_keywords":["合规","法务","政策研究"],"due_at":"",
   "evidence_quote":"李法务:没问题,我下周三前出合规意见。",
   "evidence_anchor_line_ids":[12]}
]}
"""


# How many of an assignee_name's chars must match a known user.name to bind.
_MIN_NAME_OVERLAP = 0.6


async def extract_and_store_actions(
    meeting_id: uuid.UUID,
    *,
    summary_md: Optional[str] = None,
    mode: Optional[str] = None,
) -> int:
    """
    Returns count of action items inserted. 0 means none extractable
    (which is normal for many meetings — not all have explicit TODOs).

    `summary_md` is optional — if not passed, we re-load from DB.
    `mode` — v26.3:'auto' 时跳过 "AI 发言不算依据" 规则 E.原因:
       hybrid 模式 真人才是决策者, AI 只是辅助 → 规则 E 防 AI 建议被当 task.
       auto 模式 全场 AI 自主讨论,AI 发言就是会议决策 → 规则 E 反而把全部 task 都过滤掉.
    """
    async with SessionLocal() as db:
        m = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if m is None:
            return 0
        if summary_md is None:
            summary_md = m.summary_md
        if not summary_md or summary_md.startswith("<!--"):
            return 0

        provider = await get_active_provider(db)
        if provider is None:
            logger.warning("action_extractor: no active LLM provider")
            return 0

        # Load workspace users for fuzzy assignee matching
        ws_users: list[User] = []
        if m.workspace_id is not None:
            ws_users = (
                await db.execute(
                    select(User).where(User.workspace_id == m.workspace_id)
                )
            ).scalars().all()

        # v25.17: 同时拉实录原文 — evidence_quote 必须从实录摘,而不是 summary 重复
        transcript_rows = (
            await db.execute(
                select(MeetingTranscript).where(
                    MeetingTranscript.meeting_id == meeting_id,
                    MeetingTranscript.is_final.is_(True),
                )
                .order_by(MeetingTranscript.id)
            )
        ).scalars().all()
        # resolve speaker names
        speaker_ids = {r.speaker_user_id for r in transcript_rows if r.speaker_user_id}
        name_by_uid: dict = {}
        if speaker_ids:
            users_speaker = (
                await db.execute(select(User).where(User.id.in_(speaker_ids)))
            ).scalars().all()
            name_by_uid = {u.id: u.name for u in users_speaker}
        # v25.19: 实录文本前面挂【行号】 — LLM 看到 `[<id>] 说话人: 文本`,
        # 输出 evidence_anchor_line_ids 时 直接复制这些数字.后端再 validate.
        valid_line_ids: set[int] = set()
        transcript_lines: list[str] = []
        for r in transcript_rows:
            text = (r.text or "").strip()
            if not text:
                continue
            valid_line_ids.add(r.id)
            speaker_name = (
                name_by_uid.get(r.speaker_user_id)
                if r.speaker_user_id else None
            ) or "[?]"
            transcript_lines.append(f"[{r.id}] {speaker_name}: {text}")
        transcript_text = "\n".join(transcript_lines)
        # 太长截断(LLM token 限制),保留后半段 — 纪要话题主要在会议后半段
        if len(transcript_text) > 8000:
            transcript_text = transcript_text[-8000:]
            # 重算 valid_line_ids — 只保留被截断后仍在文本里的 id
            # 用 简单的 [N] 正则提取
            kept_ids = set(int(x) for x in re.findall(r"\[(\d+)\]", transcript_text))
            valid_line_ids = valid_line_ids & kept_ids

        user_prompt = (
            f"会议标题: {m.title or '未命名会议'}\n\n"
            f"=== 会议纪要 (Markdown,用来定 待办内容 / 负责人 / 截止) ===\n\n"
            f"{summary_md}\n\n"
            f"=== 会议实录 原文(逐句,行号在前,用来摘 evidence_quote + anchor)===\n\n"
            f"{transcript_text or '(实录为空)'}\n\n"
            f"=== 任务 ===\n\n"
            f"按规则抽取 action items.evidence_quote 必须从【实录原文】摘 — "
            f"不是从【纪要】重抄.evidence_anchor_line_ids 必须是上面实录前面方括号里 "
            f"的真实数字,通常 2-6 个,严禁编造."
        )

        # v26.3: auto 模式跳 规则 E "AI 发言不算依据" — 全场是 AI 自主讨论,
        # 那就是 决策本身.加一段 system_prompt override.
        system_prompt = _SYSTEM_PROMPT
        if mode == "auto":
            system_prompt = (
                _SYSTEM_PROMPT
                + "\n\n【v26.3 auto 模式 特殊规则】\n"
                "本会议是 mode='auto' 全 AI 自主会议(无真人发言).因此:\n"
                "  - 规则 E 失效 — AI 专家的发言 / 共识 = 本会议的决策,正常抽取\n"
                "  - evidence_quote 从 议程的共识 / wrap_up 摘抄(那里就是 AI 共识)\n"
                "  - evidence_anchor_line_ids 留 空数组 []（auto 会议无 transcript line_id）\n"
                "  - assignee_name 留空(routing 算法会按 topic_keywords 派给 主责 AI)\n"
            )

        chunks: list[str] = []
        try:
            # v25.11: 用 qwen-max + temperature=0 + top_p=0.1 反幻觉
            async for c in stream_chat(
                provider=provider,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model_override="qwen-max-latest",
                temperature=0.0,
                top_p=0.1,
            ):
                chunks.append(c)
        except LlmError:
            logger.exception("action_extractor LLM call failed")
            return 0

        raw = "".join(chunks).strip()
        parsed = _safe_parse_json_obj(raw)
        items = (parsed or {}).get("items") if parsed else None
        if not items or not isinstance(items, list):
            logger.info("action_extractor: meeting %s — no items extracted", meeting_id)
            # Still wipe stale auto-extracted items so a previous extraction
            # that DID find items doesn't linger.
            await db.execute(
                delete(MeetingActionItem).where(
                    MeetingActionItem.meeting_id == meeting_id,
                    MeetingActionItem.source_type == "summary",
                )
            )
            await db.commit()
            return 0

        # v17: clean up the summary-source rows AND their paired Tasks before
        # the replace-all insert. Order matters: drop Tasks first (while
        # action.task_id still points at them), then drop the actions.
        await delete_tasks_for_meeting_summary_actions(db, meeting_id)
        await db.execute(
            delete(MeetingActionItem).where(
                MeetingActionItem.meeting_id == meeting_id,
                MeetingActionItem.source_type == "summary",
            )
        )

        # v17: clean up summary-source rows + paired Tasks before replace-all insert.
        # (delete_tasks_for_meeting_summary_actions + delete action_items 已在上面)
        # 已经在前面 if not items 分支调用过了,这里 dedup 一下

        # v26.0: 改用 agent-routing.候选 = workspace 内有 primary_user_id 的
        # active agent.对每条 task,跑 find_best_agent_for_task.
        from .routing import find_best_agent_for_task, _HIGH_CONFIDENCE_THRESHOLD

        inserted = 0
        auto_dispatched = 0
        for it in items:
            content = (it.get("content") or "").strip()
            if not content:
                continue
            due_str = (it.get("due_at") or "").strip()
            evidence = (it.get("evidence_quote") or "").strip()  # v25.15
            # v26: 抽 topic_keywords (替代 v25 的 assignee_name)
            raw_topic = it.get("topic_keywords") or []
            topic_keywords: list[str] = []
            if isinstance(raw_topic, list):
                for x in raw_topic:
                    if isinstance(x, str) and x.strip():
                        topic_keywords.append(x.strip())
                # cap 5
                topic_keywords = topic_keywords[:5]
            # v25.19: 实录行号锚点 — LLM 输出后,validate against valid_line_ids
            raw_anchors = it.get("evidence_anchor_line_ids") or []
            anchor_ids: list[int] = []
            if isinstance(raw_anchors, list):
                seen: set[int] = set()
                for x in raw_anchors:
                    try:
                        v = int(x)
                    except (TypeError, ValueError):
                        continue
                    if v in valid_line_ids and v not in seen:
                        anchor_ids.append(v)
                        seen.add(v)
                anchor_ids = anchor_ids[:20]

            # v26 routing — 跑 agent 评分
            agent_id: Optional[uuid.UUID] = None
            user_id: Optional[uuid.UUID] = None
            assignee_name_hint: Optional[str] = None
            co_agent_ids: list[str] = []
            try:
                decision = await find_best_agent_for_task(
                    db,
                    workspace_id=m.workspace_id,
                    task_content=content,
                    topic_keywords=topic_keywords,
                    threshold=_HIGH_CONFIDENCE_THRESHOLD,  # 只有 ≥0.60 才自动派
                )
            except Exception:
                logger.exception("routing failed for task %s", content[:50])
                decision = None

            if decision and decision.confidence_tier == "high":
                # 高置信 → 自动派给 winner agent
                agent_id = decision.winner.agent_id
                user_id = decision.winner.primary_user_id
                assignee_name_hint = decision.winner.agent_name
                # 把 composite > 0.5 的非 winner 候选记为协办 (top 2)
                for c in decision.all_candidates[1:3]:
                    if c.composite > 0.5:
                        co_agent_ids.append(str(c.agent_id))
                auto_dispatched += 1
            elif decision and decision.all_candidates:
                # 中等 / 低置信 — 不自动派,但记下 LLM 推断的最佳候选作为 hint.
                # task 留 status='open',assignee_agent_id=NULL,等 leader 手动选.
                # hint 显示给 UI 当 "AI 推荐 (但没把握)"
                top = decision.all_candidates[0]
                assignee_name_hint = (
                    f"AI 推荐: {top.agent_name} ({top.composite:.2f})"
                )

            add_action_with_task(
                db,
                workspace_id=m.workspace_id,
                meeting_id=meeting_id,
                content=content[:1000],
                assignee_agent_id=agent_id,             # v26 新字段
                assignee_user_id=user_id,                # derive: agent.primary_user_id
                co_agent_ids=co_agent_ids or None,       # v26 新字段
                assignee_name_hint=(assignee_name_hint[:128] if assignee_name_hint else None),
                due_at=_parse_due(due_str),
                status="open",
                action_source_type="summary",
                created_by_user_id=None,
                evidence_quote=evidence[:500] or None,  # v25.15
                evidence_anchor_line_ids=anchor_ids or None,  # v25.19
                # 把 topic_keywords 也存到 source_ref,后续 backfill / 重路由用
                topic_keywords=topic_keywords or None,
            )
            inserted += 1

        await db.commit()
        logger.info(
            "action_extractor: meeting %s — inserted %d action items "
            "(auto-dispatched %d to AI agents)",
            meeting_id, inserted, auto_dispatched,
        )
        return inserted


def _match_user(users: list[User], name_text: str) -> Optional[uuid.UUID]:
    """Best-effort fuzzy match. Empty / vague (全员 / 待定) → None."""
    if not name_text:
        return None
    cleaned = name_text.strip().lower()
    if cleaned in {"全员", "待定", "tbd", "n/a", "无", "暂无"}:
        return None
    # 1) exact match
    for u in users:
        if u.name and u.name.strip().lower() == cleaned:
            return u.id
    # 2) substring containment either way
    for u in users:
        n = (u.name or "").strip().lower()
        if not n:
            continue
        if n in cleaned or cleaned in n:
            return u.id
    return None


def _parse_due(s: str) -> Optional[datetime]:
    """Accept 'YYYY-MM-DD' (assume UTC midnight). Anything else → None."""
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s.strip())
    if not m:
        return None
    try:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return datetime(y, mo, d, tzinfo=timezone.utc)
    except ValueError:
        return None


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
