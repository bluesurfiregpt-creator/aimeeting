"""
v26.0 — Agent-centric 4(+1) 维 自动派发路由.

智慧住建文档 §4.2 派发路由 + v26 北极星:
> 任务的主人是 AI 专家(科室专家),而不是真人.真人是 AI 专家绑的科室账号
> (primary_user)的实际操作员.任务办结后资料 沉淀回 AI 专家 的知识库.

公式 (v26 默认权重):
  composite = 0.40 * semantic   + 0.25 * knowledge
            + 0.15 * history    + 0.15 * load
            + 0.05 * availability

各维度 [0, 1]:
  semantic     Task.content vs Agent.keywords / Agent.domain 字面 + token 匹配
               (后续 v26.1 可加 embedding 语义)
  knowledge    Task.content embedding 检索 Agent.kb (knowledge_base_ids),top-K
               chunk 平均相似度 (v26.0 placeholder: 暂用 agent.knowledge_base_ids
               非空 + persona/domain 长度作为「丰富度」近似;v26.1 上 embedding)
  history      该 Agent 过去 30d 关联 task 中,完成 + 成功的比例 + 数量
  load         该 Agent.primary_user 当前 active task 反向 (workspace 平均参照)
  availability primary_user.suspended_until / 未配置 primary_user 等

阈值 (v26):
  composite >= 0.60  自动派 (高置信,绿)
  0.40 - 0.60        AI 推荐 top 3,leader 一键确认 (中,琥珀)
  < 0.40             候选全列出,要求 leader 手动选 AI 专家 (低,玫红)

候选池 (v26 关键变化):
  active=True AND primary_user_id IS NOT NULL 的 Agent.
  user 这一层不再独立做候选 — 选定 agent 后,assignee_user_id = agent.primary_user_id.
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

from .models import Agent, Task, User

logger = logging.getLogger(__name__)


# ---- 阈值 / 权重 (v26) -----------------------------------------------------
_HIGH_CONFIDENCE_THRESHOLD = 0.60   # 自动派
_MIN_COMPOSITE_THRESHOLD = 0.40     # AI 推荐 (中等置信)
# < 0.40 = 玫红 (低,手动)

_W_SEMANTIC = 0.40
_W_KNOWLEDGE = 0.25
_W_HISTORY = 0.15
_W_LOAD = 0.15
_W_AVAILABILITY = 0.05

# history 看最近多少天
_HISTORY_WINDOW_DAYS = 30
# history 满分计数:30d 内做完 5+ 同主题任务 = 满分
_HISTORY_FULL_COUNT = 5

# 负载活跃任务统计的 status
_ACTIVE_STATUSES = ("dispatched", "accepted", "in_progress", "submitted")


# ---- 数据结构 --------------------------------------------------------------


@dataclass
class RoutingScore:
    """单个 Agent 的得分.v26: 候选直接是 Agent,user 是 derive(primary_user)."""
    agent_id: uuid.UUID
    agent_name: str
    agent_color: Optional[str]
    composite: float
    breakdown: dict[str, Any]  # {semantic, knowledge, history, load, availability, _hits, _history_count}
    # primary_user (= agent 绑的科室账号 — task 真正的 assignee_user_id)
    primary_user_id: Optional[uuid.UUID]
    primary_user_name: Optional[str]
    primary_user_active_count: int


@dataclass
class RoutingDecision:
    """选中的最佳 Agent + 全候选评分 (用于解释 + UI top-3)."""
    winner: RoutingScore
    all_candidates: list[RoutingScore]  # 排序后 (高分在前),含 winner
    threshold: float
    confidence_tier: str  # 'high' | 'medium' | 'low'


# ---- helpers ---------------------------------------------------------------


def _tokenize(text: str) -> set[str]:
    """简单中英 tokenization:抽连续字母/数字/汉字串."""
    if not text:
        return set()
    en_tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    cn_tokens = re.findall(r"[一-龥]+", text)
    return set(en_tokens + cn_tokens)


def _semantic_match_score(
    task_text: str,
    keywords: Optional[list[str]],
    domain: Optional[str],
    extra_topic_kws: Optional[list[str]] = None,
) -> tuple[float, list[str]]:
    """
    v26: semantic = keywords 命中 + domain 命中 + 主题词命中 综合.
    返回 (score in [0,1], hits 列表 用于诊断 / history 计算).

    分子 = 命中数 (去重);分母 = keywords + domain tokens + topic_kws 总数 cap.
    """
    text_lower = (task_text or "").lower()
    hits: set[str] = set()

    all_terms: list[str] = []
    if keywords:
        all_terms.extend([(k or "").strip().lower() for k in keywords if (k or "").strip()])
    if domain:
        all_terms.extend([t.lower() for t in _tokenize(domain) if len(t) >= 2])
    if extra_topic_kws:
        all_terms.extend([(k or "").strip().lower() for k in extra_topic_kws if (k or "").strip()])

    all_terms = list(dict.fromkeys(all_terms))  # de-dup keep order
    if not all_terms:
        return 0.0, []

    for term in all_terms:
        if not term:
            continue
        if term in text_lower:
            hits.add(term)

    denom = max(3, min(len(all_terms), 8))  # cap denom to [3, 8] for stability
    score = len(hits) / denom
    return min(1.0, score), sorted(hits)


def _knowledge_score(agent: Agent) -> float:
    """
    v26.0 placeholder — 真正的 KB embedding 检索 留 v26.1.
    现在用近似指标:agent 有多少 配置丰富度 来代表 "知识沉淀广度".
      • knowledge_base_ids 非空 + 数量 → +0.4
      • persona 长 (>200 chars) → +0.3
      • domain 非空 → +0.2
      • keywords ≥ 3 → +0.1
    最高 1.0.
    """
    score = 0.0
    if agent.knowledge_base_ids:
        n_kb = len(agent.knowledge_base_ids)
        score += min(0.4, 0.15 + 0.10 * min(n_kb, 3))
    if agent.persona and len(agent.persona) > 200:
        score += 0.3
    elif agent.persona and len(agent.persona) > 50:
        score += 0.15
    if agent.domain:
        score += 0.2
    if agent.keywords and len(agent.keywords) >= 3:
        score += 0.1
    return min(1.0, score)


async def _history_score(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    agent_id: uuid.UUID,
    primary_user_id: Optional[uuid.UUID],
    task_hits: set[str],
) -> tuple[float, int]:
    """
    v26: 看 该 agent 关联的 user 过去 30 天 做过 多少条 命中相同 keyword
    且 status='done' 的 task.
    """
    if not primary_user_id or not task_hits:
        return 0.0, 0
    since = datetime.now(timezone.utc) - timedelta(days=_HISTORY_WINDOW_DAYS)

    # 拿该 user 完成 / 在办的 task content 中命中过 hit 的条数
    rows = (
        await session.execute(
            select(Task.content).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id == primary_user_id,
                Task.status.in_(("done", "archived")),
                Task.created_at >= since,
            )
        )
    ).all()
    if not rows:
        return 0.0, 0
    hit_count = 0
    for (content,) in rows:
        text_lower = (content or "").lower()
        for kw in task_hits:
            if kw in text_lower:
                hit_count += 1
                break
    score = min(1.0, hit_count / _HISTORY_FULL_COUNT)
    return score, hit_count


def _load_score(current_load: int, workspace_avg: float) -> float:
    """负载反向:负载越低 分越高."""
    if workspace_avg <= 0:
        # 工作区还没 task → 大家都满分
        return 1.0
    # 当前负载 / (2x 平均) → 反向
    relative = current_load / (workspace_avg * 2)
    return max(0.0, min(1.0, 1.0 - relative))


def _availability_score(primary_user: Optional[User]) -> float:
    """primary_user 在不在岗.suspended_until 在未来 → 0;否则 1."""
    if primary_user is None:
        return 0.0
    if (
        primary_user.suspended_until is not None
        and primary_user.suspended_until > datetime.now(timezone.utc)
    ):
        return 0.0
    return 1.0


# ---- core ------------------------------------------------------------------


async def find_best_agent_for_task(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    task_content: str,
    *,
    topic_keywords: Optional[list[str]] = None,
    threshold: float = _MIN_COMPOSITE_THRESHOLD,
    exclude_agent_ids: Optional[set[uuid.UUID]] = None,
) -> Optional[RoutingDecision]:
    """
    v26: Score every active Agent in workspace, pick winner (AI 专家).
    Returns None if no candidates (e.g. no active agent with primary_user).

    `topic_keywords`:LLM 抽 task 时同时给出的主题关键词 list,加入 semantic 维度.
    `threshold`:低于此 视为 medium/low 置信(caller 应展示给 leader 选,而非自动派).
    `exclude_agent_ids`:排除指定 agent (例如召集人不想用某个).
    """
    exclude = exclude_agent_ids or set()

    # 拿所有 active Agent.v26 要求 primary_user_id 非空 (没绑科室账号的 agent
    # 没法接活).如果是 moderator 也跳过 (它是议程监督,不接 task).
    agents = (
        await session.execute(
            select(Agent).where(
                Agent.workspace_id == workspace_id,
                Agent.is_active.is_(True),
                Agent.primary_user_id.is_not(None),
                Agent.role != "moderator",
            )
        )
    ).scalars().all()
    if not agents:
        return None
    agents = [a for a in agents if a.id not in exclude]
    if not agents:
        return None

    # 拿 workspace 平均负载 (per-user 活跃 task 数)
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

    # 拿所有 涉及的 user (primary_user) 的 record - 一次性
    primary_uids = {a.primary_user_id for a in agents if a.primary_user_id}
    primary_user_by_id: dict[uuid.UUID, User] = {}
    if primary_uids:
        urows = (
            await session.execute(select(User).where(User.id.in_(primary_uids)))
        ).scalars().all()
        primary_user_by_id = {u.id: u for u in urows}

    candidates: list[RoutingScore] = []

    for agent in agents:
        primary_user = primary_user_by_id.get(agent.primary_user_id) if agent.primary_user_id else None

        # 1) 语义匹配 (keywords + domain + LLM 给的 topic_keywords)
        sem_score, hits = _semantic_match_score(
            task_content, agent.keywords, agent.domain, topic_keywords
        )

        # 2) 知识库 (v26.0 placeholder,v26.1 改 embedding)
        kn_score = _knowledge_score(agent)

        # 3) 历史经验
        hits_set = set(hits)
        if topic_keywords:
            hits_set.update([k.lower() for k in topic_keywords if k])
        history_score, history_count = await _history_score(
            session, workspace_id, agent.id, agent.primary_user_id, hits_set
        )

        # 4) 负载 (primary_user 的活跃 task)
        candidate_load = (
            load_by_user.get(agent.primary_user_id, 0)
            if agent.primary_user_id else 0
        )
        load_score = _load_score(candidate_load, workspace_avg)

        # 5) 在岗
        avail_score = _availability_score(primary_user)

        composite = (
            _W_SEMANTIC * sem_score
            + _W_KNOWLEDGE * kn_score
            + _W_HISTORY * history_score
            + _W_LOAD * load_score
            + _W_AVAILABILITY * avail_score
        )

        candidates.append(
            RoutingScore(
                agent_id=agent.id,
                agent_name=agent.name,
                agent_color=agent.color,
                composite=round(composite, 4),
                breakdown={
                    "semantic": round(sem_score, 4),
                    "knowledge": round(kn_score, 4),
                    "history": round(history_score, 4),
                    "load": round(load_score, 4),
                    "availability": round(avail_score, 4),
                    "_hits": hits,
                    "_history_count": history_count,
                    "_candidate_load": candidate_load,
                },
                primary_user_id=agent.primary_user_id,
                primary_user_name=primary_user.name if primary_user else None,
                primary_user_active_count=candidate_load,
            )
        )

    if not candidates:
        return None

    # 按 composite 降序
    candidates.sort(key=lambda c: c.composite, reverse=True)
    winner = candidates[0]

    # 判置信档
    if winner.composite >= _HIGH_CONFIDENCE_THRESHOLD:
        tier = "high"
    elif winner.composite >= _MIN_COMPOSITE_THRESHOLD:
        tier = "medium"
    else:
        tier = "low"

    # threshold=0 时 caller 想拿全候选 (preview 场景),即使最低分也返回
    if winner.composite < threshold:
        # caller 设了 threshold (不是 0) — 说明它只想要 medium+,不要 low
        logger.info(
            "routing: no winner above threshold (best=%.3f < %.3f) — tier=%s",
            winner.composite, threshold, tier,
        )
        return RoutingDecision(
            winner=winner,
            all_candidates=candidates,
            threshold=threshold,
            confidence_tier=tier,
        )

    return RoutingDecision(
        winner=winner,
        all_candidates=candidates,
        threshold=threshold,
        confidence_tier=tier,
    )


# v25 兼容:旧 import 路径仍可用,但 deprecated.内部 forward 到 v26.
# 这样 老代码 (例如 routers/me.py 里几个老 endpoint) 不会立刻 crash.
async def find_best_assignee_for_task(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    task_content: str,
    *,
    threshold: float = _MIN_COMPOSITE_THRESHOLD,
    exclude_user_ids: Optional[set[uuid.UUID]] = None,  # v26 ignored
) -> Optional[RoutingDecision]:
    """v25 兼容 shim — 调用方应改用 find_best_agent_for_task."""
    logger.warning(
        "find_best_assignee_for_task is v25 deprecated; use find_best_agent_for_task"
    )
    return await find_best_agent_for_task(
        session, workspace_id, task_content,
        threshold=threshold,
    )


# ---- 序列化 (Pydantic 友好) -------------------------------------------------


def routing_score_to_dict(s: RoutingScore) -> dict[str, Any]:
    return {
        "agent_id": str(s.agent_id),
        "agent_name": s.agent_name,
        "agent_color": s.agent_color,
        "composite": s.composite,
        "breakdown": s.breakdown,
        # v25 兼容字段名 — UI/老调用方需要 candidate_user_*
        "candidate_user_id": str(s.primary_user_id) if s.primary_user_id else None,
        "candidate_user_name": s.primary_user_name,
        "candidate_user_active_count": s.primary_user_active_count,
        # v26 规范名
        "primary_user_id": str(s.primary_user_id) if s.primary_user_id else None,
        "primary_user_name": s.primary_user_name,
        "primary_user_active_count": s.primary_user_active_count,
    }


def routing_decision_to_dict(d: RoutingDecision) -> dict[str, Any]:
    return {
        "winner": routing_score_to_dict(d.winner),
        "all_candidates": [routing_score_to_dict(c) for c in d.all_candidates],
        "threshold": d.threshold,
        "confidence_tier": d.confidence_tier,
    }
