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

from .embeddings import EmbeddingError, compute_embedding
from .models import Agent, KnowledgeChunk, Task, User

logger = logging.getLogger(__name__)


# ---- 阈值 / 权重 (v26.1) ---------------------------------------------------
# v26.1 调权:knowledge ↑ (KB 检索 实测后 含金量高);history ↓ (新 workspace
# 没历史不能压制其他维度).load 同步降以保证 sum=1.00.
_HIGH_CONFIDENCE_THRESHOLD = 0.60   # 自动派
_MIN_COMPOSITE_THRESHOLD = 0.40     # AI 推荐 (中等置信)
# < 0.40 = 玫红 (低,手动)

_W_SEMANTIC = 0.40      # 关键词 + domain 字面匹配
_W_KNOWLEDGE = 0.35     # v26.1: KB embedding 检索(从 0.25 提到 0.35)
_W_HISTORY = 0.10       # v26.1: 完成数 × 完成率(从 0.15 降到 0.10)
_W_LOAD = 0.10          # v26.1: 同步降到 0.10 (保 sum=1.00)
_W_AVAILABILITY = 0.05

# history 看最近多少天
_HISTORY_WINDOW_DAYS = 30
# history 满分计数:30d 内做完 5+ 同主题任务 = 满分
_HISTORY_FULL_COUNT = 5

# v26.1 KB 检索参数
_KB_TOP_K = 5              # 每个 agent 取 top-K chunk
_KB_MAX_DISTANCE = 0.55    # > 0.55 视为不相关 (与 knowledge_retrieval 一致)

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


async def _knowledge_score(
    session: AsyncSession,
    qvec: Optional[list[float]],
    agent: Agent,
) -> tuple[float, int]:
    """
    v26.1: agent 知识库 embedding 检索 → score in [0,1].
    Returns (score, hit_count).

    实现:
      1. 用预先 embed 好的 task.content 向量(qvec)在 agent.knowledge_base_ids
         里跑 cosine_distance 检索 top K
      2. 过滤 distance > MAX_DISTANCE 的(不相关)
      3. similarity = 1 - distance (clamp [0,1])
      4. score = avg(similarity) × count_weight
         - count_weight = min(1, hit_count / TOP_K)
         - 这样 5 个全命中且 都很近 → ≈ avg_sim
         - 1 个命中(其他 4 个都太远)→ 打 0.2 折(避免单点 KB 假高分)
         - 0 命中 → 0

    Fallback:
      qvec=None (embedding 失败 / 没配 provider) → 退到 v26.0 的配置丰富度近似.
      这样新部署 / 测试环境 仍能跑.
    """
    if qvec is None or not agent.knowledge_base_ids:
        return _knowledge_score_fallback(agent), 0

    # 用 SQLAlchemy 跑 pgvector cosine_distance
    distance_expr = KnowledgeChunk.embedding.cosine_distance(qvec).label("distance")
    stmt = (
        select(distance_expr)
        .where(KnowledgeChunk.kb_id.in_(list(agent.knowledge_base_ids)))
        .order_by(distance_expr)
        .limit(_KB_TOP_K)
    )
    try:
        rows = (await session.execute(stmt)).all()
    except Exception:
        # KB 查询出错 — 不让整个 routing 崩,fallback
        logger.exception("KB 检索失败 for agent %s — fallback to config 近似", agent.id)
        return _knowledge_score_fallback(agent), 0

    if not rows:
        # agent 绑了 KB 但里面是空的 / 没 embeddings → fallback
        return _knowledge_score_fallback(agent), 0

    similarities: list[float] = []
    for (dist,) in rows:
        if dist is None:
            continue
        d = float(dist)
        if d > _KB_MAX_DISTANCE:
            continue
        sim = max(0.0, min(1.0, 1.0 - d))
        similarities.append(sim)

    if not similarities:
        # KB 里全是不相关 chunk → 真正"该 AI 不懂这个" → 给一个小分,不是 0
        # 完全 0 会让 knowledge 维度直接抹掉 35% 权重过激;给配置丰富度的 30%
        # 作为兜底.
        return _knowledge_score_fallback(agent) * 0.3, 0

    avg_sim = sum(similarities) / len(similarities)
    count_weight = min(1.0, len(similarities) / _KB_TOP_K)
    score = avg_sim * count_weight
    return min(1.0, score), len(similarities)


def _knowledge_score_fallback(agent: Agent) -> float:
    """
    v26.0 风格的 近似指标:用 agent 配置丰富度 当 KB 检索失败时的兜底.
      • knowledge_base_ids 非空 + 数量 → +0.4
      • persona 长 (>200 chars) → +0.3
      • domain 非空 → +0.2
      • keywords ≥ 3 → +0.1
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
) -> tuple[float, int, float]:
    """
    v26.1: history = count_factor × completion_rate

    count_factor    = min(1, completed / 5)         # 做过 5+ 同主题为满分
    completion_rate = completed / total_with_topic  # 完成率(0-1)
    score           = count_factor × completion_rate

    新增 completion_rate 因子,避免"做过但做砸"的 AI 拿满分.

    Returns (score, completed_count, completion_rate).
    """
    if not primary_user_id or not task_hits:
        return 0.0, 0, 0.0
    since = datetime.now(timezone.utc) - timedelta(days=_HISTORY_WINDOW_DAYS)

    # 拿该 primary_user 过去 30d 所有 task(各 status)
    rows = (
        await session.execute(
            select(Task.content, Task.status).where(
                Task.workspace_id == workspace_id,
                Task.assignee_user_id == primary_user_id,
                Task.created_at >= since,
            )
        )
    ).all()
    if not rows:
        return 0.0, 0, 0.0

    completed = 0     # 命中关键词 且 已 done/archived
    total_hit = 0     # 命中关键词 的所有(含未完成 / cancelled / open)
    for content, status in rows:
        text_lower = (content or "").lower()
        is_hit = any(kw in text_lower for kw in task_hits)
        if not is_hit:
            continue
        total_hit += 1
        if status in ("done", "archived"):
            completed += 1

    if total_hit == 0:
        return 0.0, 0, 0.0

    count_factor = min(1.0, completed / _HISTORY_FULL_COUNT)
    completion_rate = completed / total_hit
    score = count_factor * completion_rate
    return min(1.0, score), completed, completion_rate


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

    # v26.1: embed task.content **一次**,所有 agent 复用.
    # query 包括 task_content + topic_keywords(用户决策:content 全文优先)
    qvec: Optional[list[float]] = None
    if task_content and task_content.strip():
        query_text = task_content.strip()
        if topic_keywords:
            # 附加 关键词 进一步聚焦语义
            query_text = query_text + " " + " ".join(topic_keywords)
        try:
            qvec = await compute_embedding(query_text)
        except EmbeddingError:
            logger.warning(
                "routing: embedding failed — knowledge dimension falls back to config 近似"
            )
            qvec = None

    candidates: list[RoutingScore] = []

    for agent in agents:
        primary_user = primary_user_by_id.get(agent.primary_user_id) if agent.primary_user_id else None

        # 1) 语义匹配 (keywords + domain + LLM 给的 topic_keywords)
        sem_score, hits = _semantic_match_score(
            task_content, agent.keywords, agent.domain, topic_keywords
        )

        # 2) v26.1: 知识库 — KB embedding 检索
        kn_score, kn_hits = await _knowledge_score(session, qvec, agent)

        # 3) v26.1: 历史经验 — 完成数 × 完成率
        hits_set = set(hits)
        if topic_keywords:
            hits_set.update([k.lower() for k in topic_keywords if k])
        history_score, history_count, completion_rate = await _history_score(
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
                    "_completion_rate": round(completion_rate, 3),
                    "_kb_hits": kn_hits,            # v26.1: KB 命中 chunk 数
                    "_candidate_load": candidate_load,
                    "_kb_used_embedding": qvec is not None,  # 是否真跑了 embedding
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
