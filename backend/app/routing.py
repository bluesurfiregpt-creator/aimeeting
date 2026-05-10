"""
v24.1 #3 — 4-维自动派发路由.

智慧住建文档 §4.2 派发路由:
> 系统按"关键词匹配、历史关联、负载均衡、能力标签"四维得分自动匹配责任
> AI 专家.若自动匹配失败或人工介入,则转为手动指派.

公式(per D1 默认权重):
  composite = 0.4 * keyword + 0.3 * history + 0.2 * load + 0.1 * capability

各维度 [0, 1]:
  keyword     Task.content 命中 Agent.keywords 的比例(去停用词后)
  history     该 Agent 关联用户最近 30d 处理过的任务里命中相同 keywords 的数
              / 5(5+ 历史满分)
  load        反向:1 - current_load / (workspace_avg * 2),clamp 到 [0,1]
  capability  Agent.domain 是否覆盖 task 主题(简化:domain 字符串里有
              至少 1 个命中 keyword)→ 1.0 / 0.5

阈值 _MIN_COMPOSITE_THRESHOLD = 0.30:
  - 最高分 < 阈值 → 视为「自动匹配失败」,fallback 手动派发
  - >= 阈值 → 选 winner Agent 名下负载最轻的 bound user

为什么不用 LLM scoring:
  1. 派发请求量级大,LLM 慢且贵
  2. 政务可解释性要求高,规则清晰可调
  3. 后期(v25+)可加 LLM fallback 当所有规则都低分时兜底

后端用法:
  decision = await find_best_assignee_for_task(session, ws_id, task_content)
  if decision is not None:
      # auto-dispatch to decision.user_id
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Agent, Task, User, WorkspaceMembership

logger = logging.getLogger(__name__)

# ---- 阈值 ------------------------------------------------------------------
# composite < 0.30 → 视为自动匹配失败.阈值偏低是因为 4 维都满分太苛刻(尤其
# history 在新 workspace 没数据时永远 0).客户上线一段时间后再可调高.
_MIN_COMPOSITE_THRESHOLD = 0.30

# 维度权重(per D1 默认值)
_W_KEYWORD = 0.4
_W_HISTORY = 0.3
_W_LOAD = 0.2
_W_CAPABILITY = 0.1

# history scoring:5+ 条命中即满分
_HISTORY_FULL_COUNT = 5
# history 看最近多少天
_HISTORY_WINDOW_DAYS = 30

# 负载活跃任务统计的 status
_ACTIVE_STATUSES = ("dispatched", "accepted", "in_progress", "submitted")


# ---- 数据结构 --------------------------------------------------------------


@dataclass
class RoutingScore:
    """单个 Agent 的得分(候选).用于 debug + audit + 让 UI 解释「为啥选他」."""
    agent_id: uuid.UUID
    agent_name: str
    composite: float
    breakdown: dict[str, float]  # {keyword, history, load, capability}
    candidate_user_id: Optional[uuid.UUID]  # Agent 下负载最轻的 bound user
    candidate_user_name: Optional[str]
    candidate_user_active_count: int


@dataclass
class RoutingDecision:
    """选中的最佳 (Agent, User) + 全候选评分(用于解释)."""
    winner: RoutingScore
    all_candidates: list[RoutingScore]  # 排序后(高分在前),含 winner
    threshold: float


# ---- helpers ---------------------------------------------------------------


def _tokenize(text: str) -> set[str]:
    """简单中英 tokenization:抽连续字母/数字/汉字串."""
    if not text:
        return set()
    # 中文按单字 + 英文按词
    en_tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    cn_tokens = re.findall(r"[一-龥]+", text)
    return set(en_tokens + cn_tokens)


def _keyword_match_score(task_text: str, keywords: Optional[list[str]]) -> tuple[float, list[str]]:
    """
    Returns (score, hits).
    keyword 命中比例 — 命中数 / agent.keywords 总数(避免「关键词列表越长越占便宜」).
    keyword 在 task_text 里出现(子串或 token 重叠) → 命中.
    """
    if not keywords:
        return 0.0, []
    text_lower = (task_text or "").lower()
    hits = []
    for kw in keywords:
        kw_low = (kw or "").strip().lower()
        if not kw_low:
            continue
        # 子串匹配(中文友好)
        if kw_low in text_lower:
            hits.append(kw)
    score = len(hits) / len(keywords) if keywords else 0.0
    return min(score, 1.0), hits


async def _history_score(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    bound_user_ids: list[uuid.UUID],
    task_keywords: set[str],
) -> tuple[float, int]:
    """
    Returns (score, matched_count).
    最近 30d 这些 bound user 处理过的 task,有几条 content 含 task_keywords 至少一个.
    """
    if not bound_user_ids or not task_keywords:
        return 0.0, 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=_HISTORY_WINDOW_DAYS)
    rows = (
        await session.execute(
            select(Task.content).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id.in_(bound_user_ids),
                Task.created_at >= cutoff,
            )
        )
    ).all()
    if not rows:
        return 0.0, 0
    matched = 0
    for (content,) in rows:
        text_low = (content or "").lower()
        if any(kw.lower() in text_low for kw in task_keywords):
            matched += 1
    score = min(matched / _HISTORY_FULL_COUNT, 1.0)
    return score, matched


def _load_score(current_load: int, workspace_avg: float) -> float:
    """反向负载:1 - current_load / (avg * 2),clamp [0, 1]."""
    if workspace_avg <= 0:
        return 1.0
    raw = 1.0 - current_load / (workspace_avg * 2)
    return max(0.0, min(1.0, raw))


def _capability_score(agent: Agent, hit_keywords: list[str]) -> float:
    """
    Agent.domain 字符串里包含至少 1 个命中 keyword → 1.0,否则 0.5.
    避免 0 分:即使 domain 不直接覆盖,Agent 也算「能干一些」.
    """
    if not agent.domain or not hit_keywords:
        return 0.5
    domain_low = agent.domain.lower()
    if any(kw.lower() in domain_low for kw in hit_keywords):
        return 1.0
    return 0.5


# ---- core ------------------------------------------------------------------


async def find_best_assignee_for_task(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    task_content: str,
    *,
    threshold: float = _MIN_COMPOSITE_THRESHOLD,
    exclude_user_ids: Optional[set[uuid.UUID]] = None,
) -> Optional[RoutingDecision]:
    """
    Score every active Agent in workspace, pick winner + their best bound user.
    Returns None if winner < threshold (caller does manual dispatch).

    `exclude_user_ids`:不要派给这些用户(例如发起人自己).
    """
    exclude = exclude_user_ids or set()

    # 拿所有 active Agent
    agents = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == workspace_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all()
    if not agents:
        return None

    # 拿 workspace 平均负载(per-user 活跃 task 数)— 一次查询
    load_rows = (
        await session.execute(
            select(Task.assignee_user_id, func.count(Task.id))
            .where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id.is_not(None),
                Task.status.in_(_ACTIVE_STATUSES),
            )
            .group_by(Task.assignee_user_id)
        )
    ).all()
    load_by_user: dict[uuid.UUID, int] = {uid: c for uid, c in load_rows}
    workspace_avg = (
        sum(load_by_user.values()) / len(load_by_user) if load_by_user else 0.0
    )

    # 拿 workspace 内所有 user 的名字(避免 N+1)
    all_user_ids: set[uuid.UUID] = set(load_by_user.keys())
    # 也要包含 0-load 用户(不在 load_rows 里),后面用 bound_users 关联拿
    name_by_uid: dict[uuid.UUID, str] = {}

    candidates: list[RoutingScore] = []

    for agent in agents:
        # 该 Agent 的 bound users
        bound_rows = (
            await session.execute(
                select(WorkspaceMembership.user_id).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.bound_agent_id == agent.id,
                )
            )
        ).all()
        bound_uids = [r[0] for r in bound_rows if r[0] not in exclude]
        # 没人 bound — 该 Agent 不能接活,跳过
        if not bound_uids:
            continue

        # 4 维 score
        kw_score, kw_hits = _keyword_match_score(task_content, agent.keywords)
        task_kws = set(kw_hits)  # 实际命中的(用于 history 计算)
        if not task_kws:
            # 关键词一个都没命中 → 历史也没意义,直接 0
            history_score, history_count = 0.0, 0
        else:
            history_score, history_count = await _history_score(
                session, workspace_id, bound_uids, task_kws
            )

        # 选 bound user 里负载最轻的(也是这个 Agent 的「候选 assignee」)
        candidate_uid = min(bound_uids, key=lambda u: load_by_user.get(u, 0))
        candidate_load = load_by_user.get(candidate_uid, 0)
        load_score = _load_score(candidate_load, workspace_avg)

        cap_score = _capability_score(agent, kw_hits)

        composite = (
            _W_KEYWORD * kw_score
            + _W_HISTORY * history_score
            + _W_LOAD * load_score
            + _W_CAPABILITY * cap_score
        )

        all_user_ids.add(candidate_uid)
        candidates.append(
            RoutingScore(
                agent_id=agent.id,
                agent_name=agent.name,
                composite=round(composite, 4),
                breakdown={
                    "keyword": round(kw_score, 4),
                    "history": round(history_score, 4),
                    "load": round(load_score, 4),
                    "capability": round(cap_score, 4),
                    "_hits": kw_hits,  # debug-only
                    "_history_count": history_count,
                    "_candidate_load": candidate_load,
                },
                candidate_user_id=candidate_uid,
                candidate_user_name=None,  # fill after batch user lookup
                candidate_user_active_count=candidate_load,
            )
        )

    if not candidates:
        return None

    # 批量取 user 名字(避免 N+1)
    if all_user_ids:
        urows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(all_user_ids))
            )
        ).all()
        name_by_uid = {u: n for u, n in urows}
    for c in candidates:
        if c.candidate_user_id:
            c.candidate_user_name = name_by_uid.get(c.candidate_user_id)

    # 按 composite 降序排
    candidates.sort(key=lambda c: c.composite, reverse=True)
    winner = candidates[0]

    if winner.composite < threshold or winner.candidate_user_id is None:
        # 自动匹配失败 — 全榜送回去给 caller 做诊断
        logger.info(
            "routing: no winner above threshold (best=%.3f < %.3f)",
            winner.composite, threshold,
        )
        return None

    return RoutingDecision(
        winner=winner,
        all_candidates=candidates,
        threshold=threshold,
    )


# ---- 让 RoutingDecision / Score 易序列化(Pydantic 友好)---------------------


def routing_score_to_dict(s: RoutingScore) -> dict[str, Any]:
    return {
        "agent_id": str(s.agent_id),
        "agent_name": s.agent_name,
        "composite": s.composite,
        "breakdown": s.breakdown,
        "candidate_user_id": str(s.candidate_user_id) if s.candidate_user_id else None,
        "candidate_user_name": s.candidate_user_name,
        "candidate_user_active_count": s.candidate_user_active_count,
    }


def routing_decision_to_dict(d: RoutingDecision) -> dict[str, Any]:
    return {
        "winner": routing_score_to_dict(d.winner),
        "all_candidates": [routing_score_to_dict(c) for c in d.all_candidates],
        "threshold": d.threshold,
    }
