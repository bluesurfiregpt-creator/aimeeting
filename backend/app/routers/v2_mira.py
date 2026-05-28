"""
v1.4.0 · Saga P-2 (Phase 1 · W4) · Mobile App v2 — Mira 命名空间.

**v1.4.0 Phase C · 13 升级** (2026-05-28): 从 mock 改 真 LLM NLU.
- 老 Phase 1: asyncio.sleep(1.1) + hardcoded mock JSON (PM 3=a · V1 mock)
- 新 Phase 2: 真 LLM (走 active provider, 当前 prod 是 deepseek-v4-pro) 做 NLU.
  - input_text → 拟 title / topic / agenda / proposed_ais / proposed_humans
  - workspace 内 真实 agent + user 名单 给 LLM 选, 不会 推 不存在的人

契约: docs/SCHEMA-mobile-v2.md §5.3.

约定:
  - 与 老 /api/m/* 隔离, 走 /api/v2/mira/* 命名空间
  - Phase 2 加 auth gate (workspace 名单 必须 scope)
  - 字段命名 snake_case · 跟 SCHEMA 严格一致
  - LLM 失败 fallback hardcoded mock (UI 不挂)

§5.3: POST /draft-meeting — 用户描述需求 → Mira 拟主题/议程/AI 阵容
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent_glyphs import AGENT_GLYPHS
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..llm_direct import LlmError, get_active_provider, stream_chat
from ..models import Agent, User, WorkspaceMembership

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


# ============================================================================
# v1.4.0 Phase C · 13 — LLM NLU (替老 mock)
# ============================================================================

_NLU_SYSTEM_PROMPT = """你是会议筹备助手 Mira. 用户 给一句话需求, 你要 拟 一个 完整 会议草稿.

**严格 JSON 单行 输出**, 不要 包 代码块, 不要 任何 其他 文字:
{
  "confidence": 0.0-1.0,
  "proposed_title": "<不超过 24 字 中文 标题, 像 真实 会议标题>",
  "proposed_topic": "<不超过 60 字 中文 简要 描述, 帮 Mira 串场用>",
  "proposed_agenda": [
    {"label": "<不超过 20 字 议程项>", "duration_min": <5-30>, "led_by_ai": "<AI agent name>"},
    ... (建议 2-5 项, 累计 15-60 分钟)
  ],
  "proposed_ai_names": ["<agent name>", ...],
  "proposed_human_names": ["<workspace 真人 name>", ...],
  "sample_prompts": ["<相关 follow-up 短句>", ...]
}

判断规则:
1. **AI 名单 必须 从 给定 列表 选** — 不在列表 的 不要写
2. **真人 名单 也 必须 从 给定 列表 选** — 不在列表 的 不要写
3. **议程 led_by_ai 必须 在 proposed_ai_names 列表 里**
4. **每议程 duration_min 5-30 分钟**, total = sum (不要 短 < 10 分 或 长 > 90 分)
5. **AI 选 2-4 个**, 真人 选 1-3 个 (太多 嘈杂)
6. **confidence**: 内容 跟 描述 贴 > 0.7, 牵强 0.4-0.6, 没识别 < 0.4
7. **sample_prompts**: 3-5 条 用户 可能 接着 问 的 短句

写作风格:
- 标题 简洁 + 信号 强, 像 "搜索改版 上线前 评审" / "Q3 路线图对齐"
- 不写 火星文, 不写 emoji
- 议程 label 用 名词短语 + 动词 (评审 / 决策 / 同步 / 回顾)
"""


async def _llm_draft_meeting(
    *,
    input_text: str,
    workspace_id: uuid.UUID,
    db: AsyncSession,
) -> Optional[dict]:
    """走 active LLM provider 跑 NLU. 返回 parsed dict 或 None (失败).

    workspace-scoped: 只 让 LLM 看 本 workspace 的 agent + user 名单.
    """
    # 拉 workspace agents (active)
    agents = (
        await db.execute(
            select(Agent).where(
                Agent.workspace_id == workspace_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all()
    if not agents:
        return None
    agent_lines = [
        f"- {a.name} ({a.domain or '通用'})" for a in agents
    ]

    # 拉 workspace 真人 (走 membership)
    members = (
        await db.execute(
            select(User)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(WorkspaceMembership.workspace_id == workspace_id)
        )
    ).scalars().all()
    if not members:
        return None
    user_lines = [f"- {u.name}" for u in members if u.name]

    provider = await get_active_provider(db)
    if provider is None:
        logger.warning("draft-meeting: no active LLM provider, returning fallback")
        return None

    user_prompt = (
        f"用户 描述:\n{input_text.strip()}\n\n"
        f"**本 workspace 可用 AI agent**:\n{chr(10).join(agent_lines)}\n\n"
        f"**本 workspace 可用 真人**:\n{chr(10).join(user_lines)}\n\n"
        f"拟 一个 会议草稿 给我."
    )

    chunks: list[str] = []
    try:
        async for c in stream_chat(
            provider=provider,
            system_prompt=_NLU_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            chunks.append(c)
    except LlmError:
        logger.exception("draft-meeting LLM call failed")
        return None

    raw = "".join(chunks).strip()
    return _safe_parse_json_obj(raw)


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


def _map_ai_to_proposed(
    name: str, agents: list[Agent], reason: str = ""
) -> Optional[MiraProposedAI]:
    """name → MiraProposedAI (含 glyph + gradient)."""
    agent = next((a for a in agents if a.name == name), None)
    if agent is None:
        return None
    glyph_entry = AGENT_GLYPHS.get(name)
    if glyph_entry:
        glyph, gradient_from, gradient_to, _ = glyph_entry
    else:
        glyph, gradient_from, gradient_to = "◎", "#5E5CE6", "#AF52DE"
    return MiraProposedAI(
        id=str(agent.id),
        name=agent.name,
        glyph=glyph,
        gradient_from=gradient_from,
        gradient_to=gradient_to,
        reason=reason[:32] or agent.domain or "辅助",
    )


_HUMAN_AVATAR_COLORS = [
    "#FF9F0A", "#34C759", "#5E5CE6", "#FF375F",
    "#30B0C7", "#FF6482", "#5856D6", "#AF52DE",
]


def _map_human_to_proposed(
    name: str, members: list[User]
) -> Optional[MiraProposedHuman]:
    """name → MiraProposedHuman (含 avatar_color 跟 surname_char)."""
    user = next((u for u in members if u.name == name), None)
    if user is None:
        return None
    surname = name[0] if name else "?"
    color = _HUMAN_AVATAR_COLORS[hash(name) % len(_HUMAN_AVATAR_COLORS)]
    return MiraProposedHuman(
        id=str(user.id),
        name=user.name,
        surname_char=surname,
        avatar_color=color,
    )


def _fallback_mock() -> DraftMeetingResponse:
    """LLM 失败 / workspace 空 时 fallback. 跟 老 Phase 1 mock 一致."""
    return DraftMeetingResponse(
        confidence=0.50,
        proposed_title="(待 Mira 拟) 会议草稿",
        proposed_topic="LLM 暂不可用, 请 自定义 tab 手工 填表 或 稍后 重试.",
        proposed_agenda=[
            MiraAgendaItem(label="议题 同步", duration_min=10, led_by_ai="Mira"),
            MiraAgendaItem(label="决策 拍板", duration_min=10, led_by_ai="Mira"),
        ],
        total_duration_min=20,
        proposed_ais=[
            MiraProposedAI(
                id="ai-mira-fallback",
                name="Mira",
                glyph="◎",
                gradient_from="#FFB340",
                gradient_to="#FF9F0A",
                reason="主持收敛",
            ),
        ],
        proposed_humans=[],
        sample_prompts=[
            "评估 X 项目 上线 风险",
            "Q3 路线图 回顾",
            "客户 反馈 周复盘",
        ],
    )


@router.post("/draft-meeting", response_model=DraftMeetingResponse)
async def post_mira_draft_meeting(
    req: DraftMeetingRequest,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
) -> DraftMeetingResponse:
    """Mira NLU 拟方案 — input_text → title / agenda / AI 阵容 / 真人.

    v1.4.0 Phase C · 13: 替老 mock 走 真 LLM (active provider).
    workspace-scoped: 只 让 LLM 推 本 workspace 真实 存在的 agent + user.
    LLM 失败 fallback hardcoded mock (UI 不挂).
    """
    parsed = await _llm_draft_meeting(
        input_text=req.input_text,
        workspace_id=auth.workspace.id,
        db=session,
    )
    if not parsed:
        return _fallback_mock()

    # 拉 workspace agents + users 用于 name → ID 转换
    agents = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == auth.workspace.id,
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all()
    members = (
        await session.execute(
            select(User)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(WorkspaceMembership.workspace_id == auth.workspace.id)
        )
    ).scalars().all()

    # name → proposed_ais (drop 名字不在列表的)
    proposed_ai_names = parsed.get("proposed_ai_names") or []
    if not isinstance(proposed_ai_names, list):
        proposed_ai_names = []
    proposed_ais: list[MiraProposedAI] = []
    for name in proposed_ai_names[:6]:
        if not isinstance(name, str):
            continue
        # reason 不在 LLM 输出, 从 agent.domain 兜
        prop = _map_ai_to_proposed(name, agents, reason="")
        if prop is not None:
            proposed_ais.append(prop)

    # name → proposed_humans
    proposed_human_names = parsed.get("proposed_human_names") or []
    if not isinstance(proposed_human_names, list):
        proposed_human_names = []
    proposed_humans: list[MiraProposedHuman] = []
    for name in proposed_human_names[:6]:
        if not isinstance(name, str):
            continue
        prop = _map_human_to_proposed(name, members)
        if prop is not None:
            proposed_humans.append(prop)

    # agenda 校验 + 去掉 led_by_ai 不在 proposed_ais 的
    valid_ai_names = {a.name for a in proposed_ais}
    raw_agenda = parsed.get("proposed_agenda") or []
    if not isinstance(raw_agenda, list):
        raw_agenda = []
    agenda: list[MiraAgendaItem] = []
    for item in raw_agenda[:8]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "")[:40]
        duration = item.get("duration_min")
        led_by = str(item.get("led_by_ai") or "Mira")
        if not label:
            continue
        if not isinstance(duration, int) or duration < 3 or duration > 60:
            duration = 10
        if led_by not in valid_ai_names and valid_ai_names:
            # fallback 头一个 ai
            led_by = next(iter(valid_ai_names))
        agenda.append(MiraAgendaItem(
            label=label, duration_min=duration, led_by_ai=led_by,
        ))

    if not agenda:
        # LLM 没出有效 agenda — fallback
        return _fallback_mock()

    total = sum(a.duration_min for a in agenda)

    # confidence + title + topic 兜底
    try:
        confidence = float(parsed.get("confidence", 0.6))
    except (TypeError, ValueError):
        confidence = 0.6
    confidence = max(0.0, min(1.0, confidence))

    title = str(parsed.get("proposed_title") or "")[:48] or "(未命名) 会议草稿"
    topic = str(parsed.get("proposed_topic") or "")[:120] or req.input_text[:120]

    sample_prompts_raw = parsed.get("sample_prompts") or []
    if not isinstance(sample_prompts_raw, list):
        sample_prompts_raw = []
    sample_prompts = [str(s)[:60] for s in sample_prompts_raw if isinstance(s, str)][:5]
    if not sample_prompts:
        sample_prompts = [
            "Q3 路线图 回顾",
            "客户 反馈 周复盘",
            "评估 X 项目 上线 风险",
        ]

    return DraftMeetingResponse(
        confidence=confidence,
        proposed_title=title,
        proposed_topic=topic,
        proposed_agenda=agenda,
        total_duration_min=total,
        proposed_ais=proposed_ais,
        proposed_humans=proposed_humans,
        sample_prompts=sample_prompts,
    )
