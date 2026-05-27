"""
v1.4.0 · Saga P-1 (Phase 1 · W4) + Saga T1 (Phase 2 · W1) · Mobile App v2 — Profile.

契约: docs/SCHEMA-mobile-v2.md §5.1 + §5.2.

Phase 1 (Saga P-1 · 全部 mock): ai-stats / voiceprints-stats.
Phase 2 (Saga T1 · 真接 DB): 全部转真 — ABAC + workspace filter.

约定:
  - 与 老 /api/m/* 隔离, 走 /api/v2/profile/* 命名空间
  - 真接 endpoint 走 get_current_auth + workspace.id filter (Saga T1 起强制)
  - 字段命名 snake_case · 时间 ISO 8601 UTC · 跟 SCHEMA 严格一致

§5.1: /ai-stats — Mira AI 智囊 7 天采纳率 (PM 4=a 7 天窗口)
§5.2: /voiceprints-stats — 声纹库 counter

仿真场景: 福田住建局 demo workspace · 真实数据驱动.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent_glyphs import agent_to_ai_badge
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import AIInsight, Agent, Voiceprint

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2/profile", tags=["mobile-v2-profile"])


# ============================================================================
# §5.1 — GET /api/v2/profile/ai-stats (Mira AI 智囊 hero — M6 Profile)
# ============================================================================


class MostPopularAI(BaseModel):
    id: str
    name: str
    glyph: str
    gradient_from: str
    gradient_to: str
    adoption_pct: float


class AIStatsResponse(BaseModel):
    period_days: int
    total_suggestions: int
    adopted: int
    adoption_rate: float
    most_popular_ai: MostPopularAI


# fallback most_popular_ai — empty workspace 时返这个, 防前端空盘 crash.
# 用 Aria 是 demo 数据里 默认 mock 一致 (见老 mock data).
_FALLBACK_MOST_POPULAR = MostPopularAI(
    id="ai-aria",
    name="Aria",
    glyph="⌬",
    gradient_from="#0A84FF",
    gradient_to="#5E5CE6",
    adoption_pct=0.0,
)


@router.get("/ai-stats", response_model=AIStatsResponse)
async def get_profile_ai_stats(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> AIStatsResponse:
    """近 7 天 AI 建议采纳率 + 最热门 AI.

    v1.4.0 Saga T1 (Phase 2 W1): mock → 真接 (ABAC + workspace filter).

    数据源 (PM 4=a 7 天 窗口, SCHEMA 未指明 user-scope vs workspace-scope —
            Saga T1 选 workspace 全局, 因为 "AI 智囊" 是 workspace 级 共享数据):

      total_suggestions — AIInsight WHERE workspace_id + created_at >= 7 天前
      adopted           — total + human_decision='accepted'
      adoption_rate     — adopted / total (round 2 decimal, total=0 时 = 0)
      most_popular_ai   — GROUP BY agent_id, ORDER BY adopted_count DESC LIMIT 1
                          → JOIN Agent → agent_to_ai_badge() helper 出 SCHEMA shape
                          → adoption_pct = 该 AI adopted / total 全体

    边界: empty workspace → total=0, adopted=0, adoption_rate=0.0,
          most_popular_ai = fallback (Aria 0%).
    """
    ws_id = auth.workspace.id
    now = datetime.now(timezone.utc)
    period_days = 7
    window_start = now - timedelta(days=period_days)

    # 1) total + adopted 两次 COUNT (合并到一次 query, FILTER 条件 区分)
    # 用 case 表达式让 PG 一遍扫一次表
    total_suggestions = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= window_start,
            )
        )
    ).scalar_one() or 0
    total_suggestions = int(total_suggestions)

    adopted = (
        await session.execute(
            select(func.count(AIInsight.id)).where(
                AIInsight.workspace_id == ws_id,
                AIInsight.created_at >= window_start,
                AIInsight.human_decision == "accepted",
            )
        )
    ).scalar_one() or 0
    adopted = int(adopted)

    adoption_rate = round(adopted / total_suggestions, 2) if total_suggestions > 0 else 0.0

    # 2) most_popular_ai — GROUP BY agent_id, ORDER BY adopted DESC LIMIT 1
    most_popular_ai: MostPopularAI = _FALLBACK_MOST_POPULAR
    if adopted > 0:
        winner_row = (
            await session.execute(
                select(
                    AIInsight.agent_id,
                    func.count(AIInsight.id).label("adopted_count"),
                )
                .where(
                    AIInsight.workspace_id == ws_id,
                    AIInsight.created_at >= window_start,
                    AIInsight.human_decision == "accepted",
                )
                .group_by(AIInsight.agent_id)
                .order_by(desc("adopted_count"))
                .limit(1)
            )
        ).first()

        if winner_row is not None:
            winner_agent_id, winner_count = winner_row
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == winner_agent_id)
                )
            ).scalar_one_or_none()
            badge = agent_to_ai_badge(agent)
            adoption_pct = (
                round(winner_count / total_suggestions, 2)
                if total_suggestions > 0
                else 0.0
            )
            most_popular_ai = MostPopularAI(
                id=badge["id"],
                name=badge["name"],
                glyph=badge["glyph"],
                gradient_from=badge["gradient_from"],
                gradient_to=badge["gradient_to"],
                adoption_pct=adoption_pct,
            )

    return AIStatsResponse(
        period_days=period_days,
        total_suggestions=total_suggestions,
        adopted=adopted,
        adoption_rate=adoption_rate,
        most_popular_ai=most_popular_ai,
    )


# ============================================================================
# §5.2 — GET /api/v2/profile/voiceprints-stats (声纹库 counter — M6 row subline)
# ============================================================================


class VoiceprintsStatsResponse(BaseModel):
    count: int
    last_updated_at: str
    last_updated_display: str


def _humanize_days_ago(then: datetime) -> str:
    """v1.4.0 Saga T1 · datetime → 中文 "N 天前" / "刚刚" / "X 小时前".

    简化版 不引入 humanize 依赖. 仅覆盖 SCHEMA §5.2 用例:
      < 1 hour              → "刚刚"
      < 24 hour             → "{n} 小时前"
      < 30 day              → "{n} 天前"
      其他                   → "{YYYY-MM-DD}"
    """
    now = datetime.now(timezone.utc)
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    delta = now - then
    total_seconds = delta.total_seconds()
    if total_seconds < 60:
        return "刚刚"
    minutes = int(total_seconds // 60)
    if minutes < 60:
        return f"{minutes} 分钟前"
    hours = int(total_seconds // 3600)
    if hours < 24:
        return f"{hours} 小时前"
    days = int(total_seconds // 86400)
    if days < 30:
        return f"{days} 天前"
    return then.date().isoformat()


@router.get("/voiceprints-stats", response_model=VoiceprintsStatsResponse)
async def get_profile_voiceprints_stats(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> VoiceprintsStatsResponse:
    """声纹库统计 (条数 + 最后更新时间).

    v1.4.0 Saga T1 (Phase 2 W1): mock → 真接 (ABAC + workspace filter).

    Voiceprint 模型 注释: 声纹挂 user_id (一对多 versioned). workspace 隔离通过
    JOIN User 反推 — 因为 Voiceprint 表本身无 workspace_id 字段, 但 User 有
    workspace_id, 所以 走 User.workspace_id == auth.workspace.id 过滤.

    数据源:
      count                — Voiceprint JOIN User WHERE user.workspace_id = ws +
                             voiceprint.is_active = True (只数 active 声纹版本)
      last_updated_at      — MAX(voiceprint.created_at) within workspace
      last_updated_display — humanize(last_updated_at) → "上次更新 N 天前"

    边界:
      - empty (0 声纹) → count=0, last_updated_at = 当前时刻, display = "暂无声纹"
        (前端 fallback 文案 跟 mock 一致)
    """
    from ..models import User

    ws_id = auth.workspace.id

    # 1) count — only is_active=True (每 user 有 1 active 行)
    count_row = (
        await session.execute(
            select(func.count(Voiceprint.id))
            .join(User, User.id == Voiceprint.user_id)
            .where(
                User.workspace_id == ws_id,
                Voiceprint.is_active.is_(True),
            )
        )
    ).scalar_one() or 0
    count = int(count_row)

    # 2) last_updated_at — MAX(created_at) (Voiceprint 表无 updated_at,
    # created_at 即 录入时间, 跟 SCHEMA 语义一致)
    last_updated_at_dt: datetime | None = (
        await session.execute(
            select(func.max(Voiceprint.created_at))
            .join(User, User.id == Voiceprint.user_id)
            .where(
                User.workspace_id == ws_id,
                Voiceprint.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()

    if last_updated_at_dt is None:
        # 0 声纹 — 用 当前时间 占位, display 标 "暂无声纹"
        now = datetime.now(timezone.utc)
        return VoiceprintsStatsResponse(
            count=0,
            last_updated_at=now.isoformat().replace("+00:00", "Z"),
            last_updated_display="暂无声纹",
        )

    # 确保 timezone 信息齐全 (PG DateTime(tz=True) 默认返 aware datetime)
    if last_updated_at_dt.tzinfo is None:
        last_updated_at_dt = last_updated_at_dt.replace(tzinfo=timezone.utc)

    return VoiceprintsStatsResponse(
        count=count,
        last_updated_at=last_updated_at_dt.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        last_updated_display=f"上次更新 {_humanize_days_ago(last_updated_at_dt)}",
    )
