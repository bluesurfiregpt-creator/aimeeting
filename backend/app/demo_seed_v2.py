"""
v1.4.0 · Phase 2 Sprint 1-A · Demo seed v2 (Today / Tasks / Memory / Meetings 真接).

为什么 (背景):
  Saga M/N/O/P 把移动端 v2 真接到 7 个 endpoint (/api/v2/today/* /api/v2/tasks/*
  /api/v2/memory/* /api/v2/meetings). 但是 福田住建 demo workspace 数据 稀疏:
    - 1 个 task / 1 voiceprint / 0 AIInsight / 0 MeetingAttendee
    - 老 demo_seed.py 灌的 是 10 个历史会议 + 30 个 task, 没 AIInsight 也 没
      MeetingAttendee 跟 v2 endpoint 不 兼容.
  → 客户演示 在 移动端 v2 看到 全是 empty state.

设计原则:
  1. **Idempotent** — 用 固定 demo UUID 检测 已存在; 跑 N 次 不重复.
  2. **不重灌** demo_seed.py — 老 16-agent / 19-user / 10-meeting 设置 不动,
     本模块 只 补足 Phase 2 v2 endpoint 需要 的数据 (5 demo meeting + 10
     英文品牌 agent + 20+ AIInsight + 7 task + 5 voiceprint + 10-12 memory).
  3. **英文品牌 Agent** (Mira / Aria / Stratos / Sage / Lex / Scout / Falao /
     Shu / Zhaojie / Tally) — 让 agent_glyphs._resolve_agent_key() 0 步直接命中
     AGENT_GLYPHS map, 渲染卡片 视觉一致.
  4. **LongTermMemory.axis_tag** — 调 classify_memory_to_axis 自动分类,
     让 6 个 MemoryRadar 轴 至少 各 1 条, 不出 空雷达.
  5. **轻**: 不引 新依赖, 不动 router, 不动 SCHEMA, 不动 frontend.

入口:
  await seed_demo_v2(session) → dict 报告.
  init_db.py bootstrap 末尾 自动 call. 找不到 demo workspace → no-op skip.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .agent_glyphs import AGENT_GLYPHS
from .chunker import split_text
from .demo_kb_corpus_v2 import DEMO_KB_V2
from .embeddings import EmbeddingError, compute_embeddings
from .memory_axis import AXES, classify_memory_to_axis
from .models import (
    Agent,
    AIInsight,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    LongTermMemory,
    Meeting,
    MeetingAttendee,
    Task,
    User,
    Voiceprint,
    Workspace,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 固定 demo UUID — idempotent 检测 + 跨 endpoint 引用稳定
# ============================================================================
#
# 所有 demo UUID 以 00000000- 开头. 真生产 UUID 用 uuid4(), 不会撞.
# 6 位 segment 编码 (resource_kind, slot): meeting / agent / insight / task /
# voiceprint / memory.

_NS = "00000000-0000-0000-0000-"  # 12 字符前缀, 后接 12 位 hex 编码本资源


def _demo_uuid(kind: str, slot: int) -> uuid.UUID:
    """生成 固定 demo UUID. kind ∈ {meeting/agent/insight/task/voiceprint/memory}."""
    # 6 字符 kind code + 6 位 zero-padded slot
    kind_codes = {
        "meeting":    "10dd01",
        "agent":      "20a9e7",
        "insight":    "301751",
        "task":       "40ed5c",
        "voiceprint": "501701",
        "memory":     "60e304",
    }
    code = kind_codes[kind]
    return uuid.UUID(f"{_NS}{code}{slot:06d}")


# 5 个 demo meeting 固定 UUID (slot 1-5)
DEMO_MEETING_Q3_ROADMAP   = _demo_uuid("meeting", 1)
DEMO_MEETING_SEARCH       = _demo_uuid("meeting", 2)
DEMO_MEETING_HUMMINGBIRD  = _demo_uuid("meeting", 3)
DEMO_MEETING_ELEVATOR     = _demo_uuid("meeting", 4)
DEMO_MEETING_DATA_SEC     = _demo_uuid("meeting", 5)


# ============================================================================
# 10 个 英文 品牌 Agent — Mira / Aria / Stratos / Sage / Lex / Scout /
# Falao / Shu / Zhaojie / Tally. 跟 AGENT_GLYPHS dict 1:1 对应,
# alias map 0 步命中, 视觉规格 (glyph/gradient) 立刻可用.
# ============================================================================

# Agent 名 → (role_short 中文短角色, 角色, 描述, dify_app_type, keywords)
# v1.4.0 Phase A 双盲测试 发现: 老 spec 缺 keywords, 导致 agent_router.maybe_invoke_agents
# 的 _detect_keyword 命中 失败 — AI 永远 不主动 chime in (Phase A · 2 阈值调优 治标 不治本).
# keywords 5-8 个 自然词, 跟 NORTH_STAR § 1.3 各 AI 角色一致.
_DEMO_AGENTS_SPEC: list[tuple[str, str, str, str, list[str]]] = [
    # name,    role,        domain,         persona,                                                            keywords
    ("Mira",    "moderator", "首席协调 AI",  "你是首席协调 AI Mira, 串联议程 / 时间 / 决策, 中立可控.",                                       []),  # moderator 不该 被 keyword 召唤, 仅 @ 或 orchestrator recommend
    ("Aria",    "expert",    "用户体验",     "你是 用户体验 AI Aria, 关注用户旅程 / 易用 / 交互细节.",                                          ["用户体验", "用户旅程", "易用", "交互", "UX", "界面"]),
    ("Stratos", "expert",    "工程架构",     "你是 工程架构 AI Stratos, 关注系统稳定性 / 接口设计 / 性能.",                                     ["架构", "性能", "接口", "稳定性", "技术选型", "工程"]),
    ("Sage",    "expert",    "数据洞察",     "你是 数据洞察 AI Sage, 关注指标 / 趋势 / 数据看板.",                                              ["数据", "指标", "趋势", "看板", "数据分析", "数据洞察"]),
    ("Lex",     "expert",    "法规合规",     "你是 法规合规 AI Lex, 关注法律 / 隐私 / 审查 / 合规风险.",                                        ["法务", "合规", "隐私", "审查", "法律", "法规", "风险"]),
    ("Scout",   "expert",    "竞品研究",     "你是 竞品研究 AI Scout, 关注市场动态 / 友商进展.",                                                 ["竞品", "友商", "市场", "对标"]),
    ("Falao",   "expert",    "决策仲裁",     "你是 决策仲裁 AI Falao, 多方权衡 / 拍板建议.",                                                     ["仲裁", "拍板", "权衡", "决策"]),
    ("Shu",     "expert",    "数据 KPI",     "你是 数据 KPI AI Shu, 关注绩效 / KPI 拆解 / 排名.",                                                ["KPI", "绩效", "排名", "考核"]),
    ("Zhaojie", "expert",    "客户体验",     "你是 客户体验 AI Zhaojie (服务赵姐), 关注客户反馈 / 投诉 / NPS.",                                  ["客户", "投诉", "NPS", "服务", "客户反馈"]),
    ("Tally",   "expert",    "财务建模",     "你是 财务建模 AI Tally, 关注预算 / ROI / 现金流 / 成本核算.",                                       ["预算", "ROI", "现金流", "成本", "财务"]),
]


# ============================================================================
# 5 个 demo meeting 元数据
# ============================================================================
#
# 时间窗口 以 "今" / "昨" / "前天" 为基准 — 每次跑都基于 当前 now 重算, 这样
# /today/snapshot 的 meetings_today 永远 看到 q3-roadmap + search-review
# (今天发生过).
#
# field meaning:
#   id, title, status, started_offset_h (相对 now 小时数, None 表示无),
#   ended_offset_h, mode, desc
_DEMO_MEETINGS_META: list[dict] = [
    {
        "id":               DEMO_MEETING_Q3_ROADMAP,
        "title":            "Q3 路线图对齐",
        "status":           "ongoing",
        "started_offset_h": -1,    # 1 小时前开始, 还在进行
        "ended_offset_h":   None,
        "mode":             "hybrid",
        "description":      "对齐 Q3 三个 epic 优先级 + 决策协作功能是否进入 Q3.",
    },
    {
        "id":               DEMO_MEETING_SEARCH,
        "title":            "搜索体验评审 #4",
        "status":           "scheduled",
        "started_offset_h": 4,     # 4 小时后开 (今天稍晚)
        "ended_offset_h":   None,
        "mode":             "hybrid",
        "description":      "Sage 搜索结果页 chip 排序变更评审, 准备灰度.",
    },
    {
        "id":               DEMO_MEETING_HUMMINGBIRD,
        "title":            "客户访谈 · Hummingbird",
        "status":           "scheduled",
        "started_offset_h": 24,    # 明天
        "ended_offset_h":   None,
        "mode":             "hybrid",
        "description":      "Hummingbird 客户对摘要质量的疑问, Zhaojie + Aria 准备回复方案.",
    },
    {
        "id":               DEMO_MEETING_ELEVATOR,
        "title":            "电梯改造方案决策会",
        "status":           "finished",
        "started_offset_h": -26,    # 昨天 14 点左右
        "ended_offset_h":   -23,    # 昨天 16:30 左右
        "mode":             "hybrid",
        "description":      "老旧电梯改造方案 决策 + 业主信息从 Excel 迁物业系统.",
    },
    {
        "id":               DEMO_MEETING_DATA_SEC,
        "title":            "数据安全合规风险评估会",
        "status":           "finished",
        "started_offset_h": -74,    # 3 天前 14 点
        "ended_offset_h":   -72,    # 3 天前 16 点
        "mode":             "hybrid",
        "description":      "数据 5 级分级 合规审查 + Q2 KPI 复盘 + 数据看板原型评审.",
    },
]


# ============================================================================
# 真人 demo 用户 (跟 demo_seed.py _DEMO_USERS 一致, 用 email 反查 User)
# ============================================================================

DEMO_USER_EMAILS = {
    "李建国": "demo.lijg@futian.gov.cn",
    "陈思雨": "demo.chensy@futian.gov.cn",
    "冯磊":   "demo.fengl@futian.gov.cn",
    "韩雪":   "demo.hanx@futian.gov.cn",
}

# 主 bluesurfire 系统超管 (从 Workspace 的 system_owner)
BLUESURFIRE_EMAIL = "bluesurfiregpt@gmail.com"


# ============================================================================
# 入口
# ============================================================================

async def seed_demo_v2(session: AsyncSession) -> dict:
    """
    Phase 2 Sprint 1-A · idempotent 灌 v2 endpoint 需要 的 demo 数据.

    步骤:
      1. 定位 福田 demo workspace (preset.kind='smart_construction' OR name LIKE '%默认%')
         找不到 → 整体 skip (返 0 计数).
      2. seed 10 英文品牌 Agent (固定 UUID, 已存在 skip)
      3. 找 4 demo 用户 (李建国/陈思雨/冯磊/韩雪) — 用 demo_seed.py 写的;
         找不到 任一 → 整体 skip 不灌会议数据 (避免破坏 attendee FK).
      4. seed 5 demo Meeting (固定 UUID)
      5. seed MeetingAttendee (每会议 真人 + AI)
      6. seed 20+ AIInsight 跨 5 type
      7. seed 7 Task 跨 status
      8. seed 5 Voiceprint
      9. seed 10-12 LongTermMemory + axis_tag classify (6 轴覆盖)

    Returns:
      {
        "skipped": bool,
        "skip_reason": str | None,
        "workspace_id": str | None,
        "agents_created": N, "agents_reused": N,
        "meetings_created": N,
        "attendees_created": N,
        "insights_created": N,
        "tasks_created": N,
        "voiceprints_created": N,
        "memories_created": N,
        "axis_distribution": {axis_name: count, ...},
      }
    """
    report: dict = {
        "skipped": False,
        "skip_reason": None,
        "workspace_id": None,
        "agents_created": 0,
        "agents_reused": 0,
        "meetings_created": 0,
        "attendees_created": 0,
        "insights_created": 0,
        "tasks_created": 0,
        "voiceprints_created": 0,
        "memories_created": 0,
        "axis_distribution": {},
        # v1.4.0 Phase B · 8 NEW-C KB fix (Round 1 Kimi 验出 kb_hits=0):
        "kbs_created": 0,
        "kbs_reused": 0,
        "kb_documents_created": 0,
        "kb_chunks_created": 0,
        "kb_embed_failed": 0,
    }

    # ---- Step 1: locate demo workspace ----------------------------------------
    ws = await _locate_demo_workspace(session)
    if ws is None:
        report["skipped"] = True
        report["skip_reason"] = "no demo workspace (preset.smart_construction / 默认 not found)"
        logger.info("[demo_seed_v2] skipped: %s", report["skip_reason"])
        return report
    report["workspace_id"] = str(ws.id)

    # ---- Step 2: 10 英文品牌 Agent --------------------------------------------
    agents_by_name = await _seed_demo_v2_agents(session, ws.id, report)

    # ---- Step 3: 找 4 demo 用户 -----------------------------------------------
    users = await _find_demo_users(session)
    if not all(name in users for name in ("李建国", "陈思雨", "冯磊", "韩雪")):
        # demo_seed.py 还没跑 (没 demo 用户), 跳过 会议级 灌注 (会缺 attendee FK)
        # 但 agent 仍灌好了 — 让后续手动跑 demo_seed.py 后 再 seed_demo_v2 时
        # 走 Step 4+ 的剩余路径.
        report["skip_reason"] = "demo users missing (demo.lijg / demo.chensy / demo.fengl / demo.hanx); skipped meetings + tasks"
        logger.warning("[demo_seed_v2] %s", report["skip_reason"])
        await session.flush()
        return report

    # ---- Step 4: 5 demo Meeting ------------------------------------------------
    meetings_by_id = await _seed_demo_v2_meetings(session, ws.id, users, report)

    # ---- Step 5: MeetingAttendee ----------------------------------------------
    await _seed_demo_v2_attendees(session, meetings_by_id, users, agents_by_name, report)

    # ---- Step 6: AIInsight -----------------------------------------------------
    await _seed_demo_v2_insights(session, ws.id, meetings_by_id, agents_by_name, report)

    # ---- Step 7: Task ----------------------------------------------------------
    await _seed_demo_v2_tasks(session, ws.id, meetings_by_id, users, agents_by_name, report)

    # ---- Step 8: Voiceprint ----------------------------------------------------
    await _seed_demo_v2_voiceprints(session, users, report)

    # ---- Step 9: LongTermMemory + axis_tag classify ----------------------------
    await _seed_demo_v2_memories(session, ws.id, meetings_by_id, users, agents_by_name, report)

    await session.flush()
    logger.info("[demo_seed_v2] seeded workspace=%s report=%s", ws.id, report)
    return report


# ============================================================================
# Helpers
# ============================================================================

async def _locate_demo_workspace(session: AsyncSession) -> Optional[Workspace]:
    """找 福田 demo workspace.

    优先级:
      1. preset.kind = 'smart_construction' (demo_seed.py 灌过的标记)
      2. name LIKE '%默认%' (默认工作空间 fallback)

    用 raw SQL 走 JSON ->> 运算符 (preset 列定义是 JSON, JSONB cast 兼容性
    在 不同 PG 版本 表现不同, 改 ->> 取 text 比较 最稳).
    """
    from sqlalchemy import text as sql_text

    # Try smart_construction first
    result = await session.execute(
        sql_text(
            "SELECT id FROM workspace "
            "WHERE preset IS NOT NULL "
            "  AND (preset::jsonb ->> 'kind') = 'smart_construction' "
            "LIMIT 1"
        )
    )
    row = result.first()
    if row is not None:
        ws = (
            await session.execute(select(Workspace).where(Workspace.id == row[0]))
        ).scalar_one_or_none()
        if ws is not None:
            return ws

    # Fallback to 默认
    result = await session.execute(
        select(Workspace).where(Workspace.name.like("%默认%")).limit(1)
    )
    return result.scalar_one_or_none()


async def _seed_demo_v2_agents(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    report: dict,
) -> dict[str, Agent]:
    """seed 10 英文品牌 Agent. 固定 UUID; 已存在 → 补 keywords + KB (若空)."""
    out: dict[str, Agent] = {}
    for idx, (name, role, domain, persona, keywords) in enumerate(_DEMO_AGENTS_SPEC):
        agent_id = _demo_uuid("agent", idx + 1)
        existing = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one_or_none()
        if existing is not None:
            # v1.4.0 Phase A 双盲测试 发现 老 seed 没 set keywords. 补一下,
            # 否则 maybe_invoke_agents 永远 不命中. 仅 在 keywords 为空 时 补.
            if (not existing.keywords) and keywords:
                existing.keywords = keywords
                report.setdefault("agents_keyword_backfill", 0)
                report["agents_keyword_backfill"] += 1
            out[name] = existing
            report["agents_reused"] += 1
            continue

        # color: 用 AGENT_GLYPHS gradient_from
        _, gradient_from, _, _ = AGENT_GLYPHS[name]
        agent = Agent(
            id=agent_id,
            workspace_id=workspace_id,
            name=name,
            domain=domain,
            persona=persona,
            tone="专业、简洁、有数据感",
            boundary=f"业务范围: {domain}",
            color=gradient_from.lstrip("#")[:16],  # 截 16 字符内
            role=role,
            keywords=keywords,  # v1.4.0 Phase A 双盲测试 fix: 必填, 否则 LLM judge 不命中
            is_active=True,
            dify_app_type="chatflow",
            stage="prod",
        )
        session.add(agent)
        out[name] = agent
        report["agents_created"] += 1

    await session.flush()

    # v1.4.0 Phase B · 8 NEW-C: KB seeding (Round 1 Kimi 双盲 发现 kb_hits=0)
    # 给每个 agent 建 KB + 灌 docs + chunks + embeddings. Idempotent — 已绑 KB
    # 跳过, 已建 KB 跳过 doc 重灌.
    await _seed_demo_v2_kbs(session, workspace_id, out, report)
    return out


async def _seed_demo_v2_kbs(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    agents_by_name: dict[str, Agent],
    report: dict,
) -> None:
    """seed 10 英文品牌 Agent 的 KB + docs + chunks + embeddings.

    Idempotent:
    - 已 set `agent.knowledge_base_ids` → 跳过 该 agent
    - `KB · {name}` 已存在 → 复用 (跳过 doc 灌, 避免 重)

    embeddings 批量 调 DashScope text-embedding-v2 (25 / batch).
    embedding 失败 不挡 seed — 记 `kb_embed_failed` 计数, 后续 可手动 补.
    """
    # 收集 已存在 的 KB by name (避免 重新建)
    existing_kbs = (
        await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.workspace_id == workspace_id)
        )
    ).scalars().all()
    existing_kb_by_name = {kb.name: kb for kb in existing_kbs}

    # 收集 所有 要 embed 的 chunks (跨 agent 批量)
    all_chunks_to_embed: list[tuple[KnowledgeChunk, str]] = []

    for agent_name, agent in agents_by_name.items():
        # 已 绑 KB 跳过 (idempotent)
        if agent.knowledge_base_ids:
            continue

        # 该 agent 是否有 demo 内容
        docs_spec = DEMO_KB_V2.get(agent_name)
        if not docs_spec:
            continue

        # 找 或 建 KB
        kb_name = f"KB · {agent_name}"
        kb = existing_kb_by_name.get(kb_name)
        kb_is_new = False
        if kb is None:
            kb = KnowledgeBase(
                workspace_id=workspace_id,
                name=kb_name,
                description=f"{agent_name} 的演示 KB ({agent.domain}).",
                owner_agent_id=agent.id,
            )
            session.add(kb)
            await session.flush()
            existing_kb_by_name[kb_name] = kb
            report["kbs_created"] += 1
            kb_is_new = True
        else:
            report["kbs_reused"] += 1

        # 绑 agent.knowledge_base_ids
        agent.knowledge_base_ids = [kb.id]

        # 灌 docs — 仅 当 该 KB 没 任何 文档 时 (idempotent: 已存在 docs 跳过)
        if not kb_is_new:
            existing_doc = (
                await session.execute(
                    select(KnowledgeDocument).where(KnowledgeDocument.kb_id == kb.id)
                )
            ).scalars().first()
            if existing_doc is not None:
                continue  # KB 已有 docs, 跳过 灌, 但 binding 已 做 (上面 agent.knowledge_base_ids)

        # 这条 KB 没文档 (新建 或 老的 但 空) → 灌
        for filename, _title, content in docs_spec:
            doc = KnowledgeDocument(
                kb_id=kb.id,
                filename=filename,
                mime_type="text/markdown",
                byte_size=len(content.encode("utf-8")),
                char_count=len(content),
                chunk_count=0,  # 下面 更
                status="ready",
                data_classification="general",
            )
            session.add(doc)
            await session.flush()
            report["kb_documents_created"] += 1

            # 切 chunks (target 400 字符 / overlap 40)
            pieces = split_text(content, target_chars=400, overlap_chars=40)
            for chunk_idx, piece in enumerate(pieces):
                chunk = KnowledgeChunk(
                    document_id=doc.id,
                    kb_id=kb.id,
                    chunk_index=chunk_idx,
                    content=piece,
                )
                session.add(chunk)
                all_chunks_to_embed.append((chunk, piece))
                report["kb_chunks_created"] += 1
            doc.chunk_count = len(pieces)

    # 批量 embed (每批 25)
    if all_chunks_to_embed:
        BATCH = 25
        for i in range(0, len(all_chunks_to_embed), BATCH):
            batch = all_chunks_to_embed[i : i + BATCH]
            texts = [t for _, t in batch]
            try:
                vectors = await compute_embeddings(texts)
                for (chunk, _), vec in zip(batch, vectors):
                    chunk.embedding = vec
            except EmbeddingError as e:
                logger.warning("demo_seed_v2 embedding batch %d failed: %s", i, e)
                report["kb_embed_failed"] += len(batch)

    await session.flush()


async def _find_demo_users(session: AsyncSession) -> dict[str, User]:
    """根据 邮箱 反查 demo 真人 + bluesurfire."""
    emails = list(DEMO_USER_EMAILS.values()) + [BLUESURFIRE_EMAIL]
    rows = (
        await session.execute(select(User).where(User.email.in_(emails)))
    ).scalars().all()
    by_email = {u.email: u for u in rows}
    out: dict[str, User] = {}
    for name, email in DEMO_USER_EMAILS.items():
        if email in by_email:
            out[name] = by_email[email]
    if BLUESURFIRE_EMAIL in by_email:
        out["bluesurfire"] = by_email[BLUESURFIRE_EMAIL]
    return out


async def _seed_demo_v2_meetings(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    users: dict[str, User],
    report: dict,
) -> dict[uuid.UUID, Meeting]:
    """seed 5 demo Meeting 固定 UUID."""
    now = datetime.now(timezone.utc)
    out: dict[uuid.UUID, Meeting] = {}
    creator_id = users["李建国"].id if "李建国" in users else None

    for meta in _DEMO_MEETINGS_META:
        mid = meta["id"]
        existing = (
            await session.execute(select(Meeting).where(Meeting.id == mid))
        ).scalar_one_or_none()
        if existing is not None:
            out[mid] = existing
            continue

        started_at = (
            now + timedelta(hours=meta["started_offset_h"])
            if meta["started_offset_h"] is not None
            else None
        )
        ended_at = (
            now + timedelta(hours=meta["ended_offset_h"])
            if meta["ended_offset_h"] is not None
            else None
        )

        m = Meeting(
            id=mid,
            workspace_id=workspace_id,
            title=meta["title"],
            status=meta["status"],
            started_at=started_at,
            ended_at=ended_at,
            mode=meta["mode"],
            description=meta["description"],
            created_by_user_id=creator_id,
        )
        session.add(m)
        out[mid] = m
        report["meetings_created"] += 1

    await session.flush()
    return out


async def _seed_demo_v2_attendees(
    session: AsyncSession,
    meetings_by_id: dict[uuid.UUID, Meeting],
    users: dict[str, User],
    agents_by_name: dict[str, Agent],
    report: dict,
) -> None:
    """seed MeetingAttendee. 每会议 真人 + AI.

    用 (meeting_id, user_id) UNIQUE constraint 做 idempotent — 已存在 skip.
    AI attendee 没 unique constraint, 用 (meeting_id, agent_id) 反查.
    """
    # (meeting_uuid, list[user_name], list[agent_name])
    layout = [
        (DEMO_MEETING_Q3_ROADMAP,   ["李建国", "陈思雨", "冯磊", "韩雪"], ["Stratos", "Mira", "Sage"]),
        (DEMO_MEETING_SEARCH,       ["陈思雨", "冯磊"],                  ["Sage", "Lex"]),
        (DEMO_MEETING_HUMMINGBIRD,  ["李建国", "冯磊"],                  ["Zhaojie", "Aria"]),
        (DEMO_MEETING_ELEVATOR,     ["李建国", "陈思雨", "冯磊", "韩雪"], ["Stratos", "Lex", "Mira"]),
        (DEMO_MEETING_DATA_SEC,     ["李建国", "陈思雨", "冯磊", "韩雪"], ["Lex", "Sage", "Tally"]),
    ]

    for meeting_id, user_names, agent_names in layout:
        if meeting_id not in meetings_by_id:
            continue
        # 已存在 attendees 全捞 (一会儿对照查)
        rows = (
            await session.execute(
                select(MeetingAttendee).where(MeetingAttendee.meeting_id == meeting_id)
            )
        ).scalars().all()
        existing_user_ids = {r.user_id for r in rows if r.user_id is not None}
        existing_agent_ids = {r.agent_id for r in rows if r.agent_id is not None}

        for uname in user_names:
            if uname not in users:
                continue
            uid = users[uname].id
            if uid in existing_user_ids:
                continue
            session.add(MeetingAttendee(
                meeting_id=meeting_id,
                user_id=uid,
                role="participant",
            ))
            report["attendees_created"] += 1
        for aname in agent_names:
            if aname not in agents_by_name:
                continue
            aid = agents_by_name[aname].id
            if aid in existing_agent_ids:
                continue
            session.add(MeetingAttendee(
                meeting_id=meeting_id,
                agent_id=aid,
                role="moderator" if aname == "Mira" else "expert",
            ))
            report["attendees_created"] += 1

    await session.flush()


async def _seed_demo_v2_insights(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    meetings_by_id: dict[uuid.UUID, Meeting],
    agents_by_name: dict[str, Agent],
    report: dict,
) -> None:
    """seed 20+ AIInsight 跨 5 type, 用固定 UUID idempotent."""
    now = datetime.now(timezone.utc)

    # (slot, meeting_id, agent_name, type, content, evidence, human_decision)
    spec: list[tuple[int, uuid.UUID, str, str, str, str, Optional[str]]] = [
        # Q3 路线图 (ongoing) — 6 条
        (1,  DEMO_MEETING_Q3_ROADMAP,  "Stratos", "决策建议",
         "建议把协作功能延后到 Q4 第一双周, Q3 聚焦 搜索 + 摘要",
         "Q3 容量已 89% 占满, 新功能再插入 会挤压稳定性预算", "accepted"),
        (2,  DEMO_MEETING_Q3_ROADMAP,  "Stratos", "决策建议",
         "Q3 三个 epic 优先级: 搜索 > 摘要 > 协作",
         "上次会议工程预算分配同意搜索 P0, 摘要 P1", "accepted"),
        (3,  DEMO_MEETING_Q3_ROADMAP,  "Sage",    "洞察",
         "搜索功能日均使用 4.2 次 / DAU, 高于摘要 1.8 次 / 协作 0.6 次",
         "近 30 天 dashboard 数据看板 metric", "accepted"),
        (4,  DEMO_MEETING_Q3_ROADMAP,  "Sage",    "洞察",
         "协作功能用户测试 NPS 偏低 (32 → 41), 需要再迭代 UX 体验",
         "Hummingbird 客户访谈 反馈", None),
        (5,  DEMO_MEETING_Q3_ROADMAP,  "Mira",    "突破",
         "议程时间预算已 走 60%, 建议 收口 协作功能讨论",
         "会议时长 90 min 已过 54 min", "accepted"),
        (6,  DEMO_MEETING_Q3_ROADMAP,  "Lex",     "风险",
         "Q3 上线 数据看板 KPI 报表, 需补合规审查",
         "新指标涉及 用户行为, 触发隐私 PIA", None),

        # 电梯改造 (finished) — 5 条
        (7,  DEMO_MEETING_ELEVATOR,    "Stratos", "决策建议",
         "电梯改造方案 A (整体替换) — 18 个月工期",
         "成本估算 ¥1.2M, 业主 2/3 表决通过", "accepted"),
        (8,  DEMO_MEETING_ELEVATOR,    "Lex",     "风险",
         "业主信息存 Excel 不合规, 需迁入 物业系统",
         "数据安全 法规审查 命中 PII 风险", "accepted"),
        (9,  DEMO_MEETING_ELEVATOR,    "Lex",     "风险",
         "Q3 协作功能上线 需要 合规审查 报告",
         "数据 5 级分级 sensitive 级, 跨 AI 共享 需审批", None),
        (10, DEMO_MEETING_ELEVATOR,    "Mira",    "决策建议",
         "方案 A 落地, 同步启动 业主 Excel 信息下线",
         "议程时间 走完, 业主已表决", "accepted"),
        (11, DEMO_MEETING_ELEVATOR,    "Sage",    "洞察",
         "改造周期 18 个月, 影响 27 户业主, 平均年龄 62 岁",
         "业主信息 dashboard 数据分析", "accepted"),

        # 数据安全 (finished) — 8 条
        (12, DEMO_MEETING_DATA_SEC,    "Lex",     "风险",
         "数据 5 级分级 落地, sensitive / important 级 跨 AI 需审批",
         "等保 ISO27001 合规要求", "accepted"),
        (13, DEMO_MEETING_DATA_SEC,    "Lex",     "风险",
         "Q2 数据报表 中 用户行为 字段 PII 风险高, 需脱敏",
         "合规审查 命中 GDPR 类隐私要求", "accepted"),
        (14, DEMO_MEETING_DATA_SEC,    "Lex",     "风险",
         "客户反馈数据 投诉信息 需要 隐私 PIA",
         "客户成功 部门 反馈 NPS 调查", None),
        (15, DEMO_MEETING_DATA_SEC,    "Tally",   "决策建议",
         "Q3 财务预算 安排 ¥350K 给 合规审查 ROI 投入",
         "财务建模 估算: 不合规罚款 vs 审查成本", "accepted"),
        (16, DEMO_MEETING_DATA_SEC,    "Tally",   "决策建议",
         "数据看板 项目 预算 ¥120K, 现金流 Q3 末 闭环",
         "财务报表 成本核算", "accepted"),
        (17, DEMO_MEETING_DATA_SEC,    "Sage",    "洞察",
         "Q2 KPI 数据 显示 重大超时 升至 12 起, 比 Q1 涨 40%",
         "趋势 分析 dashboard 数据洞察", "accepted"),
        (18, DEMO_MEETING_DATA_SEC,    "Sage",    "洞察",
         "数据看板 原型 ux 用户测试 易用 评分 4.2/5",
         "原型 用户体验 反馈", "accepted"),
        (19, DEMO_MEETING_DATA_SEC,    "Mira",    "突破",
         "会议达成 4 项决策, 议程 100% 走完",
         "议程时间 90 min, 实际 110 min, 微超", "accepted"),
    ]

    # offset for created_at: started_at + (slot % 10) min
    for slot, meeting_id, agent_name, itype, content, evidence, decision in spec:
        if meeting_id not in meetings_by_id:
            continue
        if agent_name not in agents_by_name:
            continue
        insight_id = _demo_uuid("insight", slot)
        existing = (
            await session.execute(select(AIInsight).where(AIInsight.id == insight_id))
        ).scalar_one_or_none()
        if existing is not None:
            continue

        m = meetings_by_id[meeting_id]
        # created_at — 会议 started_at 之后 (slot % 30) 分钟
        offset_min = (slot * 7) % 30 + 5
        base_ts = m.started_at or now
        ts = base_ts + timedelta(minutes=offset_min)

        ai = AIInsight(
            id=insight_id,
            workspace_id=workspace_id,
            meeting_id=meeting_id,
            agent_id=agents_by_name[agent_name].id,
            type=itype,
            content=content,
            evidence=evidence,
            created_at=ts,
            worth_remembering=decision == "accepted",
            human_decision=decision,
        )
        session.add(ai)
        report["insights_created"] += 1

    await session.flush()


async def _seed_demo_v2_tasks(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    meetings_by_id: dict[uuid.UUID, Meeting],
    users: dict[str, User],
    agents_by_name: dict[str, Agent],
    report: dict,
) -> None:
    """seed 7 Task 跨 status (open/accepted/in_progress/done)."""
    now = datetime.now(timezone.utc)

    # SCHEMA Task.status: open / dispatched / accepted / in_progress / submitted / done / archived / cancelled
    # SCHEMA UI: pending = open, tracking = accepted/in_progress/submitted, done = done
    #
    # (slot, title, meeting_id, assignee_name, due_offset_h, status, agent_name)
    spec: list[tuple[int, str, uuid.UUID, str, Optional[int], str, str]] = [
        (1, "拍板「协作功能能否进入 Q3」",     DEMO_MEETING_Q3_ROADMAP, "李建国", 2,        "open",        "Stratos"),
        (2, "审核 Sage 搜索结果页 chip 顺序变更", DEMO_MEETING_SEARCH,     "陈思雨", 4,        "open",        "Sage"),
        (3, "回复客户关于摘要质量的疑问",         DEMO_MEETING_HUMMINGBIRD, "冯磊",   72,       "open",        "Zhaojie"),
        (4, "Excel 业主信息下线+迁物业系统",      DEMO_MEETING_ELEVATOR,   "陈思雨", 24 * 18,  "open",        "Lex"),
        (5, "补合规审查报告 Q3 协作功能上线",     DEMO_MEETING_ELEVATOR,   "冯磊",   24,       "in_progress", "Lex"),
        (6, "Q2 KPI 数据复盘",                  DEMO_MEETING_DATA_SEC,   "李建国", -24,      "accepted",    "Sage"),
        (7, "数据看板原型评审",                  DEMO_MEETING_DATA_SEC,   "陈思雨", -48,      "done",        "Tally"),
    ]

    for slot, title, mid, assignee_name, due_offset_h, status, agent_name in spec:
        task_id = _demo_uuid("task", slot)
        existing = (
            await session.execute(select(Task).where(Task.id == task_id))
        ).scalar_one_or_none()
        if existing is not None:
            continue
        if assignee_name not in users:
            continue
        agent = agents_by_name.get(agent_name)
        if mid not in meetings_by_id:
            continue

        due_at = now + timedelta(hours=due_offset_h) if due_offset_h is not None else None

        # source_ref schema: {meeting_id, action_source_type, source_agent}
        source_ref = {
            "meeting_id": str(mid),
            "action_source_type": "agent",
            "source_agent": agent_name,
        }

        task = Task(
            id=task_id,
            workspace_id=workspace_id,
            title=title[:255],
            content=title,
            assignee_user_id=users[assignee_name].id,
            assignee_agent_id=agent.id if agent else None,
            due_at=due_at,
            status=status,
            source_type="meeting",
            source_ref=source_ref,
            # 状态机 时间戳: accepted 以上 stamp accepted_at; in_progress stamp started_at
            accepted_at=now - timedelta(hours=24) if status in ("accepted", "in_progress", "submitted", "done") else None,
            started_at=now - timedelta(hours=12) if status in ("in_progress", "submitted", "done") else None,
        )
        session.add(task)
        report["tasks_created"] += 1

    await session.flush()


async def _seed_demo_v2_voiceprints(
    session: AsyncSession,
    users: dict[str, User],
    report: dict,
) -> None:
    """seed 5 Voiceprint (4 demo 真人 + 1 bluesurfire)."""
    now = datetime.now(timezone.utc)
    # (slot, user_name, days_ago)
    spec = [
        (1, "李建国",       3),
        (2, "陈思雨",       7),
        (3, "冯磊",         5),
        (4, "韩雪",        12),
        (5, "bluesurfire", 15),
    ]
    for slot, uname, days_ago in spec:
        if uname not in users:
            continue
        vp_id = _demo_uuid("voiceprint", slot)
        existing = (
            await session.execute(select(Voiceprint).where(Voiceprint.id == vp_id))
        ).scalar_one_or_none()
        if existing is not None:
            continue
        # 也 check 同 user 已有 active voiceprint → skip (避免 重复 enroll)
        user_has_vp = (
            await session.execute(
                select(Voiceprint).where(
                    Voiceprint.user_id == users[uname].id,
                    Voiceprint.is_active.is_(True),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if user_has_vp is not None:
            continue

        vp = Voiceprint(
            id=vp_id,
            user_id=users[uname].id,
            pyannote_id=f"demo-vp-{slot:03d}",
            pyannote_payload={"demo": True, "source": "demo_seed_v2"},
            sample_seconds=8.5,
            version=1,
            is_active=True,
            created_at=now - timedelta(days=days_ago),
        )
        session.add(vp)
        report["voiceprints_created"] += 1

    await session.flush()


async def _seed_demo_v2_memories(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    meetings_by_id: dict[uuid.UUID, Meeting],
    users: dict[str, User],
    agents_by_name: dict[str, Agent],
    report: dict,
) -> None:
    """seed 10-12 LongTermMemory 跨 6 axis.

    每条 content 故意 含 keyword 让 classify_memory_to_axis 命中.
    6 个 axis 各至少 1 条.
    """
    now = datetime.now(timezone.utc)

    curator_id = users["李建国"].id if "李建国" in users else None

    # (slot, content, source_meeting, source_agent, importance, days_ago)
    # 命中 keyword 提示:
    #   数据洞察:  "数据 dashboard kpi 指标 趋势 数据看板"
    #   产品策略:  "路线图 roadmap 产品 需求"
    #   UX 体验:   "用户体验 ux 用户测试 易用 交互"
    #   法规合规:  "合规 审查 法律 PII 隐私 数据安全"
    #   财务建模:  "预算 财务 成本 ROI 现金流 估算"
    #   客户体验:  "客户 反馈 投诉 NPS 满意度 服务"
    spec: list[tuple[int, str, uuid.UUID, str, float, int]] = [
        (1, "Q3 路线图: 协作功能延后, 搜索优先, 摘要 P1. 产品策略 锚定 用户增长.",
             DEMO_MEETING_Q3_ROADMAP, "Stratos", 0.7,  1),
        (2, "电梯改造方案 业主信息从 Excel 下线, 迁物业系统 — 数据安全 + PII 合规审查 命中 隐私.",
             DEMO_MEETING_ELEVATOR,   "Lex",     0.8,  2),
        (3, "Q2 KPI 数据 趋势: 重大超时 升 40%, 数据看板 dashboard 指标 metric 显著漂移.",
             DEMO_MEETING_DATA_SEC,   "Sage",    0.7,  3),
        (4, "Hummingbird 客户反馈: 摘要质量需补强, NPS 满意度 32 → 41, 投诉 集中在准确率.",
             DEMO_MEETING_HUMMINGBIRD, "Zhaojie", 0.7,  2),
        (5, "数据 5 级分级: sensitive / important / general / public 跨 AI 审批边界 — 合规审查 / 数据安全 / 法规.",
             DEMO_MEETING_DATA_SEC,   "Lex",     0.8,  3),
        (6, "搜索结果页 chip 顺序 用户体验 用户测试 易用 评分 4.2/5, ux 交互调研 反馈.",
             DEMO_MEETING_SEARCH,     "Aria",    0.6,  1),
        (7, "Q3 财务预算: ¥350K 合规审查 + ¥120K 数据看板 — ROI 估算 现金流 Q3 末 闭环, 成本 核算.",
             DEMO_MEETING_DATA_SEC,   "Tally",   0.7,  3),
        (8, "电梯改造方案 决策原则: 法规审查 优先, 业主表决 2/3 通过, 合规整改 18 个月.",
             DEMO_MEETING_ELEVATOR,   "Lex",     0.6,  2),
        (9, "数据看板原型 用户测试 ux 易用 4.2/5 — 界面 视觉 wireframe mockup 设计稿 整体好评.",
             DEMO_MEETING_DATA_SEC,   "Aria",    0.6,  3),
        (10, "客户访谈 Hummingbird 反馈 投诉点: 摘要质量, 服务 NPS 32, 客户成功 部门 跟进.",
             DEMO_MEETING_HUMMINGBIRD, "Zhaojie", 0.7,  2),
        (11, "产品路线图 Q3-Q4 调整: feature 优先级 搜索/摘要/协作 — 需求 PRD spec 规格已对齐.",
             DEMO_MEETING_Q3_ROADMAP, "Stratos", 0.6,  1),
        (12, "财务建模 P&L: Q3 预算 收入 / 支出 估算 现金流, 财务报表 成本 核算 投资 回报.",
             DEMO_MEETING_DATA_SEC,   "Tally",   0.6,  3),
    ]

    for slot, content, meeting_id, agent_name, importance, days_ago in spec:
        mem_id = _demo_uuid("memory", slot)
        existing = (
            await session.execute(select(LongTermMemory).where(LongTermMemory.id == mem_id))
        ).scalar_one_or_none()
        if existing is not None:
            # still累计 axis 分布 给 report (idempotent 第二次跑也要看到分布)
            if existing.axis_tag:
                report["axis_distribution"][existing.axis_tag] = (
                    report["axis_distribution"].get(existing.axis_tag, 0) + 1
                )
            continue

        if meeting_id not in meetings_by_id:
            continue

        axis_tag = classify_memory_to_axis(content)
        agent = agents_by_name.get(agent_name)
        mem = LongTermMemory(
            id=mem_id,
            workspace_id=workspace_id,
            agent_id=agent.id if agent else None,
            scope="project",
            content=content,
            source_type="meeting",
            source_meeting_id=meeting_id,
            curated_by_user_id=curator_id,
            curated_at=now - timedelta(days=days_ago),
            importance=importance,
            data_classification="general",
            axis_tag=axis_tag,
            created_at=now - timedelta(days=days_ago),
        )
        session.add(mem)
        report["memories_created"] += 1

        if axis_tag:
            report["axis_distribution"][axis_tag] = (
                report["axis_distribution"].get(axis_tag, 0) + 1
            )

    await session.flush()
