"""
v21 — 中央化的 数据访问决策点.

调用方:任何在 router 层拉到一条受分级保护的资源(Task / KB doc / Memory)
后,把资源的 (data_classification, owner_user_id, related_agent_id) 喂进
`can_access_or_raise()`,通过则继续,拒则 raise 403.

为什么集中:
  - 决策规则会演化(v22 加入跨 AI 共享审批后,逻辑更复杂),不希望
    分散在 N 个 router 里
  - 单点更易于写测试 + 之后接 audit log

v21 决策表(简化版,逐级放宽):
  ┌──────────────┬─────────────────────────────────────────────────┐
  │ caller role  │ 能看的范围                                       │
  ├──────────────┼─────────────────────────────────────────────────┤
  │ owner/admin/  │ 全部 — 不受 classification 限制                  │
  │   leader     │                                                 │
  ├──────────────┼─────────────────────────────────────────────────┤
  │ expert       │ - 自己 bound agent 范围内 → classification 不限   │
  │              │ - 跨 agent 资源:                                │
  │              │     public/general → 放行                        │
  │              │     sensitive/important/core → 必须有有效        │
  │              │       已 approve + 未过期的 DataAccessRequest    │
  ├──────────────┼─────────────────────────────────────────────────┤
  │ member       │ - 自己 owner 的 → 不限                          │
  │  (legacy)    │ - 跨人:                                          │
  │              │     public/general → 放行                        │
  │              │     sensitive+ → 同 expert 跨 agent              │
  └──────────────┴─────────────────────────────────────────────────┘

「related_agent_id」是 expert scope 检查的依据.
对于 Task,related_agent_id 应是 task.source_ref 里携带的 agent_id;
没有则视为 None(non-agent-scoped → all experts can see general/public).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import AuthContext, expert_bound_agent_id, is_leader_or_admin
from .models import DataAccessRequest


# 分级里 sensitive 及以上需要走授权审批
_RESTRICTED_CLASSIFICATIONS: frozenset[str] = frozenset(
    {"sensitive", "important", "core"}
)


async def has_active_access_grant(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    target_resource_type: str,
    target_resource_id: uuid.UUID,
) -> bool:
    """是否存在该用户对该资源的 已 approve + 未过期 access request."""
    now = datetime.now(timezone.utc)
    row = (
        await session.execute(
            select(DataAccessRequest.id).where(
                DataAccessRequest.requester_user_id == user_id,
                DataAccessRequest.target_resource_type == target_resource_type,
                DataAccessRequest.target_resource_id == target_resource_id,
                DataAccessRequest.status == "approved",
                (DataAccessRequest.expires_at.is_(None))
                | (DataAccessRequest.expires_at > now),
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def can_access(
    session: AsyncSession,
    auth: AuthContext,
    *,
    resource_type: str,
    resource_id: uuid.UUID,
    classification: str = "general",
    owner_user_id: Optional[uuid.UUID] = None,
    related_agent_id: Optional[uuid.UUID] = None,
) -> bool:
    """
    Returns True iff caller is allowed to read this resource per v21 rules.

    `resource_type` ∈ {'task', 'kb_document', 'memory', 'agent'} — must
    match what gets stored in DataAccessRequest.target_resource_type so
    the grant lookup works.

    Decision order (cheapest first):
      1. caller is leader/admin → allow
      2. caller is owner of the resource → allow
      3. classification ∈ {public, general} → allow
         (注:这只是「最低门槛」— general 跨 agent 也允许,智慧住建文档把
          general 定义为「局内人员可查看」)
      4. caller is expert AND bound to related_agent → allow
         (在自己的 agent 范围内,不受 classification 限制)
      5. fallback: 有 active access grant → allow,否则 deny
    """
    # 1. leader/admin
    if await is_leader_or_admin(session, auth):
        return True

    # 2. owner
    if owner_user_id is not None and owner_user_id == auth.user.id:
        return True

    # 3. low-classification 公共可读
    if classification not in _RESTRICTED_CLASSIFICATIONS:
        return True

    # 4. expert in own agent range
    if related_agent_id is not None:
        bound = await expert_bound_agent_id(session, auth)
        if bound is not None and bound == related_agent_id:
            return True

    # 5. has active access grant
    return await has_active_access_grant(
        session,
        user_id=auth.user.id,
        target_resource_type=resource_type,
        target_resource_id=resource_id,
    )


async def can_access_or_raise(
    session: AsyncSession,
    auth: AuthContext,
    *,
    resource_type: str,
    resource_id: uuid.UUID,
    classification: str = "general",
    owner_user_id: Optional[uuid.UUID] = None,
    related_agent_id: Optional[uuid.UUID] = None,
) -> None:
    """403 with a uniform message if caller is not allowed."""
    if not await can_access(
        session,
        auth,
        resource_type=resource_type,
        resource_id=resource_id,
        classification=classification,
        owner_user_id=owner_user_id,
        related_agent_id=related_agent_id,
    ):
        raise HTTPException(
            403,
            f"该数据(分级:{classification})不在您的访问范围,可发起访问申请",
        )
