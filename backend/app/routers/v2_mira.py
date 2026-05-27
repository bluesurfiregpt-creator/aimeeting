"""
v1.4.0 · Saga P-2 (Phase 1 · W4) · Mobile App v2 — Mira 命名空间.

Mock NLU endpoint, Phase 1 全部写死 mock JSON (PM 3=a · V1 mock).
契约: docs/SCHEMA-mobile-v2.md §5.3.

约定:
  - 与 老 /api/m/* 隔离, 走 /api/v2/mira/* 命名空间
  - 不挂 auth gate. Phase 1 mock 数据均匿名可拉
  - 字段命名 snake_case · 跟 SCHEMA 严格一致
  - 假装思考 1.1s (asyncio.sleep) 模拟 LLM NLU 推理时延

§5.3: POST /draft-meeting — 用户描述需求 → Mira 拟主题/议程/AI 阵容

仿真场景: 输入 "下周搜索改版上线…" → 拟出 "搜索改版上线前评审" + 议程 +
Lex/Sage/Mira 3 个 AI 专家 + 李局长/陈科长 2 个真人.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v2/mira", tags=["mobile-v2-mira"])


# ============================================================================
# §5.3 — POST /api/v2/mira/draft-meeting (Mira 描述需求 → 自动配 AI)
# ============================================================================


class DraftMeetingRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=2000)
    input_mode: Literal["text", "voice"] = "text"


class MiraAgendaItem(BaseModel):
    label: str
    duration_min: int
    led_by_ai: str


class MiraProposedAI(BaseModel):
    id: str
    name: str
    glyph: str
    gradient_from: str
    gradient_to: str
    reason: str


class MiraProposedHuman(BaseModel):
    id: str
    name: str
    surname_char: str
    avatar_color: str


class DraftMeetingResponse(BaseModel):
    confidence: float
    proposed_title: str
    proposed_topic: str
    proposed_agenda: list[MiraAgendaItem]
    total_duration_min: int
    proposed_ais: list[MiraProposedAI]
    proposed_humans: list[MiraProposedHuman]
    sample_prompts: list[str]


@router.post("/draft-meeting", response_model=DraftMeetingResponse)
async def post_mira_draft_meeting(
    req: DraftMeetingRequest,
) -> DraftMeetingResponse:
    """Mira NLU 拟方案 — 给 input_text 拟主题/议程/AI 阵容/真人. Phase 1 mock.

    Phase 2: 接 LLM (Claude / GPT-4o) 做真实 NLU + 推 AI 阵容.
    """
    # 假装思考 1.1s — 模拟 LLM NLU 推理时延 (PM 3=a V1 mock)
    await asyncio.sleep(1.1)

    return DraftMeetingResponse(
        confidence=0.85,
        proposed_title="搜索改版上线前评审",
        proposed_topic="评估搜索改版上线的合规风险 + 体验回归",
        proposed_agenda=[
            MiraAgendaItem(label="合规审查同步", duration_min=10, led_by_ai="Lex"),
            MiraAgendaItem(label="搜索体验回归", duration_min=15, led_by_ai="Sage"),
            MiraAgendaItem(label="决策上线日期", duration_min=5, led_by_ai="Mira"),
        ],
        total_duration_min=30,
        proposed_ais=[
            MiraProposedAI(
                id="ai-lex",
                name="Lex",
                glyph="§",
                gradient_from="#FF9F0A",
                gradient_to="#FFB340",
                reason="合规审查",
            ),
            MiraProposedAI(
                id="ai-sage",
                name="Sage",
                glyph="✦",
                gradient_from="#5E5CE6",
                gradient_to="#AF52DE",
                reason="搜索体验",
            ),
            MiraProposedAI(
                id="ai-mira",
                name="Mira",
                glyph="◎",
                gradient_from="#FFB340",
                gradient_to="#FF9F0A",
                reason="主持收敛",
            ),
        ],
        proposed_humans=[
            MiraProposedHuman(
                id="u1",
                name="李局长",
                surname_char="李",
                avatar_color="#FF9F0A",
            ),
            MiraProposedHuman(
                id="u2",
                name="陈科长",
                surname_char="陈",
                avatar_color="#FF375F",
            ),
        ],
        sample_prompts=[
            "评估搜索改版上线的合规风险",
            "Q3 路线图回顾",
            "客户 Hummingbird 最近一周的反馈",
        ],
    )
