"""
v1.4.0 · Saga P-1 (Phase 1 · W4) · Mobile App v2 — Profile 命名空间.

Mock endpoint, Phase 1 全部写死 mock JSON (PM 5=a 拍板).
契约: docs/SCHEMA-mobile-v2.md §5.1 + §5.2.

约定:
  - 与 老 /api/m/* 隔离, 走 /api/v2/profile/* 命名空间
  - 不挂 auth gate. Phase 1 mock 数据均匿名可拉
  - 字段命名 snake_case · 时间 ISO 8601 UTC · 跟 SCHEMA 严格一致

§5.1: /ai-stats — Mira AI 智囊 7 天采纳率 (PM 4=a 7 天窗口)
§5.2: /voiceprints-stats — 声纹库 counter

仿真场景: 福田住建局 demo workspace · Aria (用户体验) 是被采纳最多的 AI.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

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


@router.get("/ai-stats", response_model=AIStatsResponse)
async def get_profile_ai_stats() -> AIStatsResponse:
    """近 7 天 AI 建议采纳率 + 最热门 AI. Phase 1 写死 mock."""
    return AIStatsResponse(
        period_days=7,
        total_suggestions=24,
        adopted=18,
        adoption_rate=0.75,
        most_popular_ai=MostPopularAI(
            id="ai-aria",
            name="Aria",
            glyph="⌬",
            gradient_from="#0A84FF",
            gradient_to="#5E5CE6",
            adoption_pct=0.46,
        ),
    )


# ============================================================================
# §5.2 — GET /api/v2/profile/voiceprints-stats (声纹库 counter — M6 row subline)
# ============================================================================


class VoiceprintsStatsResponse(BaseModel):
    count: int
    last_updated_at: str
    last_updated_display: str


@router.get("/voiceprints-stats", response_model=VoiceprintsStatsResponse)
async def get_profile_voiceprints_stats() -> VoiceprintsStatsResponse:
    """声纹库统计 (条数 + 最后更新时间). Phase 1 写死 mock."""
    return VoiceprintsStatsResponse(
        count=6,
        last_updated_at="2026-05-22T15:30:00Z",
        last_updated_display="上次更新 5 天前",
    )
