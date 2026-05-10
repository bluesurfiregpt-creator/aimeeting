"""
v24.4 — LLM rate limit (令牌桶 — 防 buggy 客户端 / 攻击 烧 DashScope token).

简单内存实现(单 backend 实例够用;v25+ 多实例时迁 Redis).

策略:
  per user        30 calls / 60s  滑窗
  per workspace   200 calls / 60s 滑窗

触发限制 → HTTPException 429 + Retry-After 头.

集成点(一律 LLM 调用前 await check_quota_or_raise()):
  - directive_parser.parse_directive
  - submission_drafter.draft_submission
  - closure_curator.curate_closed_task
  - chart_qa.answer_chart_question
  - document_audit.audit_document
  - agent_router 各 LLM 路径

豁免:system 触发的 LLM(workspace_id=None / user_id=None)不限.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Optional
from uuid import UUID

from fastapi import HTTPException

logger = logging.getLogger(__name__)


# 滑窗大小(秒)
_WINDOW_SECONDS = 60

# 默认配额(可被环境变量覆盖,留 v25+)
_PER_USER_LIMIT = 30
_PER_WORKSPACE_LIMIT = 200

# 内存计数:key=str(uuid),value=deque[timestamp(monotonic)]
_user_calls: dict[str, deque[float]] = {}
_workspace_calls: dict[str, deque[float]] = {}


def _prune_and_count(d: dict[str, deque[float]], key: str, now: float) -> int:
    """把 deque 里 < now - window 的全 popleft;返回剩余 count."""
    if key not in d:
        return 0
    q = d[key]
    cutoff = now - _WINDOW_SECONDS
    while q and q[0] < cutoff:
        q.popleft()
    if not q:
        del d[key]
        return 0
    return len(q)


def _record(d: dict[str, deque[float]], key: str, now: float) -> None:
    if key not in d:
        d[key] = deque()
    d[key].append(now)


async def check_quota_or_raise(
    user_id: Optional[UUID], workspace_id: Optional[UUID]
) -> None:
    """
    LLM 调用前 await 这个.超限直接 raise HTTPException 429.

    System-triggered(无 user_id 也无 workspace_id)直接放行 — alert_monitor /
    closure_curator(从 task_id 开 session)等没有 caller context.
    """
    if user_id is None and workspace_id is None:
        return
    now = time.monotonic()
    if user_id is not None:
        u_key = str(user_id)
        u_count = _prune_and_count(_user_calls, u_key, now)
        if u_count >= _PER_USER_LIMIT:
            logger.warning(
                "LLM quota exceeded user=%s count=%d/%d", u_key, u_count, _PER_USER_LIMIT
            )
            raise HTTPException(
                429,
                detail=f"LLM 调用频率超限(用户 {_PER_USER_LIMIT}/分钟),请稍后再试",
                headers={"Retry-After": "60"},
            )
    if workspace_id is not None:
        w_key = str(workspace_id)
        w_count = _prune_and_count(_workspace_calls, w_key, now)
        if w_count >= _PER_WORKSPACE_LIMIT:
            logger.warning(
                "LLM quota exceeded workspace=%s count=%d/%d",
                w_key, w_count, _PER_WORKSPACE_LIMIT,
            )
            raise HTTPException(
                429,
                detail=f"工作空间 LLM 调用频率超限({_PER_WORKSPACE_LIMIT}/分钟),请稍后再试",
                headers={"Retry-After": "60"},
            )
    # 通过 → record
    if user_id is not None:
        _record(_user_calls, str(user_id), now)
    if workspace_id is not None:
        _record(_workspace_calls, str(workspace_id), now)


def get_quota_status(user_id: UUID, workspace_id: UUID) -> dict:
    """供 admin debugging:看当前配额使用."""
    now = time.monotonic()
    return {
        "user_used": _prune_and_count(_user_calls, str(user_id), now),
        "user_limit": _PER_USER_LIMIT,
        "workspace_used": _prune_and_count(_workspace_calls, str(workspace_id), now),
        "workspace_limit": _PER_WORKSPACE_LIMIT,
        "window_seconds": _WINDOW_SECONDS,
    }
