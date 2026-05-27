"""
v1.4.0 · Saga T1 (Phase 2 W1) · AI 专家视觉规格 单一来源.

设计稿 mobile-shared.jsx:24-34 + Saga R subagent A 验过的 10 个固定 AI 阵容.
本模块是 全后端唯一权威 — 任何 router 要把 Agent ORM 转 SCHEMA §3.4 V2AISource
shape, 必须走 agent_to_ai_source() / agent_to_ai_badge().

为什么提取统一文件:
  - Saga N/O/P mock data 里散布 三套 重复数据 (v2_today.py / v2_tasks_memory.py /
    v2_meetings.py 各自 hardcode glyph + gradient_from + gradient_to + role_short)
  - Phase 2 Saga T1 起后续 5 个 sub-saga 都要 join Agent → 渲染卡片
  - 单一文件 = 改色/改 glyph 一处生效

跟 SCHEMA §1 AIAgent 字段对齐:
  glyph         — 单字符 icon (◎ / ⌬ / ◆ / §)
  gradient_from — hex 6 位 (#FFB340)
  gradient_to   — hex 6 位 (#FF9F0A)
  role_short    — 中文 短角色 ("首席协调 AI" / "工程架构")

ABAC: 本模块不依赖 workspace_id, 不依赖 ABAC — 它是 纯 lookup, 只读 Agent.name.
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Agent


# 10 个固定 AI 视觉规格 (mobile-shared.jsx:24-34 + Saga R subagent A 验证).
# (glyph, gradient_from, gradient_to, role_short)
#
# 注意 顺序 跟 设计稿 一致 — Saga R 已 review 过 不能再 漂移.
AGENT_GLYPHS: dict[str, tuple[str, str, str, str]] = {
    "Mira":    ("◎", "#FFB340", "#FF9F0A", "首席协调 AI"),
    "Aria":    ("⌬", "#0A84FF", "#5E5CE6", "用户体验"),
    "Stratos": ("◆", "#AF52DE", "#FF375F", "工程架构"),
    "Sage":    ("✦", "#FF2D55", "#AF52DE", "数据洞察"),
    "Lex":     ("§", "#FF9F0A", "#FFB340", "法规合规"),
    "Scout":   ("◈", "#34C759", "#30B0C7", "竞品研究"),
    "Falao":   ("⚖", "#FF9F0A", "#FF6482", "决策仲裁"),
    "Shu":     ("∑", "#5E5CE6", "#AF52DE", "数据 KPI"),
    "Zhaojie": ("♥", "#FF6482", "#FF375F", "客户体验"),
    "Tally":   ("¥", "#64D2FF", "#0A84FF", "财务建模"),
}

# 中文别名 → 英文 key (Saga Q 决定 服务赵姐 = Zhaojie, 数小妙 = Shu, 法老张 = Falao).
# 让 老 agent (DB seed 时 name 用 中文名) 也能映射到正确视觉规格.
_AGENT_NAME_ALIAS: dict[str, str] = {
    "服务赵姐": "Zhaojie",
    "数小妙":   "Shu",
    "法老张":   "Falao",
}

# fallback 视觉规格 — 当 Agent.name 不在 map 时退到这套.
# 用 Mira 渐变色 + 通用 glyph "◎" 保证 前端 不爆.
_FALLBACK_GLYPH: tuple[str, str, str, str] = ("◎", "#5E5CE6", "#0A84FF", "AI 专家")


def _resolve_agent_key(agent_name: Optional[str]) -> str:
    """从 Agent.name 解析 AGENT_GLYPHS 的 key. 容忍 中文别名 + None."""
    if not agent_name:
        return ""
    if agent_name in AGENT_GLYPHS:
        return agent_name
    # 中文别名
    if agent_name in _AGENT_NAME_ALIAS:
        return _AGENT_NAME_ALIAS[agent_name]
    return ""


def agent_to_ai_source(agent: Optional["Agent"]) -> dict:
    """v1.4.0 Saga T1 · Agent ORM → SCHEMA §3.4 V2AISource shape.

    SCHEMA §3.4 字段: { id, name, glyph, color }
      - color = gradient_from (单 hex, 给前端 简化场景 用)

    用法 (Phase 2 后续 sub-saga 必须走 这个 helper, 不要 再 hardcode):
      ai_source = agent_to_ai_source(agent)
      # → {"id": "uuid", "name": "Stratos", "glyph": "◆", "color": "#AF52DE"}

    fallback: agent=None → 返 Aria demo (避免 前端 crash). 真生产 不应 出现 None.
    """
    if agent is None:
        glyph, color, _, _ = _FALLBACK_GLYPH
        return {
            "id": "ai-fallback",
            "name": "AI 专家",
            "glyph": glyph,
            "color": color,
        }

    key = _resolve_agent_key(agent.name)
    if key:
        glyph, gradient_from, _, _ = AGENT_GLYPHS[key]
    else:
        glyph, gradient_from, _, _ = _FALLBACK_GLYPH

    return {
        "id": f"ai-{key.lower()}" if key else str(agent.id),
        "name": agent.name or "AI 专家",
        "glyph": glyph,
        "color": gradient_from,
    }


def agent_to_ai_badge(agent: Optional["Agent"]) -> dict:
    """v1.4.0 Saga T1 · Agent ORM → SCHEMA §2.2 V2AIBadge / §5.1 MostPopularAI shape.

    SCHEMA §2.2 字段: { id, name, glyph, gradient_from, gradient_to }
      跟 V2AISource 区别: 含 gradient_to 让 前端 渲 渐变 头像 (不只 单色).

    用法:
      badge = agent_to_ai_badge(agent)
      # → {"id": "...", "name": "Stratos", "glyph": "◆",
      #    "gradient_from": "#AF52DE", "gradient_to": "#FF375F"}
    """
    if agent is None:
        glyph, gradient_from, gradient_to, _ = _FALLBACK_GLYPH
        return {
            "id": "ai-fallback",
            "name": "AI 专家",
            "glyph": glyph,
            "gradient_from": gradient_from,
            "gradient_to": gradient_to,
        }

    key = _resolve_agent_key(agent.name)
    if key:
        glyph, gradient_from, gradient_to, _ = AGENT_GLYPHS[key]
    else:
        glyph, gradient_from, gradient_to, _ = _FALLBACK_GLYPH

    return {
        "id": f"ai-{key.lower()}" if key else str(agent.id),
        "name": agent.name or "AI 专家",
        "glyph": glyph,
        "gradient_from": gradient_from,
        "gradient_to": gradient_to,
    }


def agent_role_short(agent: Optional["Agent"]) -> str:
    """v1.4.0 Saga T1 · Agent ORM → role_short 中文短角色 ("首席协调 AI" 等).

    Used by /api/v2/today/experts (SCHEMA §3.7) — 暂未迁到 T1, 留给 后续 Saga T4.
    """
    if agent is None:
        return _FALLBACK_GLYPH[3]
    key = _resolve_agent_key(agent.name)
    if key:
        return AGENT_GLYPHS[key][3]
    return _FALLBACK_GLYPH[3]


# ============================================================================
# Insight type 映射 — SCHEMA §3.5 vs DB AIInsight.type 不一致, T1 起统一在这.
# ============================================================================
#
# SCHEMA §3.5 enum:  "突破" | "决策" | "风险" | "洞察" | "思路"
# DB AIInsight.type: "建议" | "风险" | "洞察" | "思路" | "决策建议"
#                     (insight_extractor.py:47 LLM prompt 写死)
#
# 映射:
#   "决策建议" → "决策"  (DB 长名 → SCHEMA 短名)
#   "建议"     → "思路"  (DB 没有 "突破", 建议 最接近 "思路")
#   其他       → 原样 pass through (风险/洞察/思路 三个 enum 重合)
#
# 这是 单向 映射 (DB → SCHEMA). 反向 (SCHEMA → DB) 留给 Saga T3 处理决策源时再做.

_INSIGHT_TYPE_DB_TO_SCHEMA: dict[str, str] = {
    "决策建议": "决策",
    "建议":    "思路",  # DB 旧 "建议" 视为 思路类 SCHEMA enum
}

# 决策类 DB type 值 — query 时 IN (...) 筛.
DECISION_INSIGHT_TYPES: tuple[str, ...] = ("决策建议", "决策")


def normalize_insight_type(db_type: Optional[str]) -> str:
    """v1.4.0 Saga T1 · AIInsight.type (DB) → SCHEMA §3.5 enum.

    NULL / 不识别的 type → 退到 "洞察" (SCHEMA enum 中 最中性 的一个).
    """
    if not db_type:
        return "洞察"
    if db_type in _INSIGHT_TYPE_DB_TO_SCHEMA:
        return _INSIGHT_TYPE_DB_TO_SCHEMA[db_type]
    # 风险 / 洞察 / 思路 / 突破 / 决策 — 直接通过 (跟 SCHEMA 重合)
    if db_type in ("突破", "决策", "风险", "洞察", "思路"):
        return db_type
    # 真有 别的 type 偷偷进来 (eg LLM 输出 "提醒"), 退到 洞察 不让 前端 enum 校验爆.
    return "洞察"
