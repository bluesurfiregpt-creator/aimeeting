"""
v1.4.0 Phase C · 10 NEW-B — 议题主题 一级对象 CRUD.

NORTH_STAR § 6.3 #10 痛点 5: 议题持续 跨多场会议, 让 客户 1 个月后 看到
"AI 真记得 议题脉络".

MVP 简化 (二期 加):
- 1 个 meeting 关联 1 个 topic (single-topic-per-meeting), 二期 升 many-to-many
- 议题 不 LLM 自动 提议 — 显式 创建
- 议题 status: active / archived (不删, § 7.5 防 mock 假装真实)

权限:
- 读 (list / detail) — workspace 所有成员
- 写 (create / archive / link meeting) — leader / admin / workspace_creator

Endpoints:
- GET    /api/topics                    list (workspace-scoped, ?status= filter)
- POST   /api/topics                    create (leader+)
- GET    /api/topics/{topic_id}         detail + 关联 meetings (按 started_at desc)
- PATCH  /api/topics/{topic_id}         update (name / desc / status)
- POST   /api/meetings/{mid}/topic      link meeting → topic (leader+)
- DELETE /api/meetings/{mid}/topic      unlink (leader+)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import system_audit_log
from ..auth import AuthContext, get_current_auth, is_leader_or_admin
from ..db import get_session
from ..models import Meeting, Topic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/topics", tags=["topics"])


# ============================================================================
# Schemas
# ============================================================================

class TopicCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)


class TopicUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = Field(default=None)  # active / archived


class TopicOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: Optional[str]
    status: str
    created_by_user_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    meeting_count: int = 0


class TopicMeetingOut(BaseModel):
    """议题线 时间线 单元: 一场 关联会议 的 简要 信息."""
    id: uuid.UUID
    title: str
    status: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    mode: str


class TopicDetailOut(TopicOut):
    meetings: list[TopicMeetingOut] = []


# ============================================================================
# Endpoints
# ============================================================================

@router.get("", response_model=list[TopicOut])
async def list_topics(
    status: Optional[str] = Query(None, description="active | archived; 默认 全部"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """list workspace 议题. status filter 可选."""
    q = select(Topic).where(Topic.workspace_id == auth.workspace.id)
    if status in ("active", "archived"):
        q = q.where(Topic.status == status)
    q = q.order_by(Topic.updated_at.desc())
    rows = (await session.execute(q)).scalars().all()

    # 计 每 topic 的 关联 meeting 数 (1 个 query, group by topic_id)
    from sqlalchemy import func as sql_func
    counts_q = (
        select(Meeting.topic_id, sql_func.count(Meeting.id))
        .where(
            Meeting.workspace_id == auth.workspace.id,
            Meeting.topic_id.in_([r.id for r in rows]) if rows else False,
        )
        .group_by(Meeting.topic_id)
    )
    counts = {}
    if rows:
        for tid, c in (await session.execute(counts_q)).all():
            counts[tid] = c

    return [
        TopicOut(
            id=r.id,
            workspace_id=r.workspace_id,
            name=r.name,
            description=r.description,
            status=r.status,
            created_by_user_id=r.created_by_user_id,
            created_at=r.created_at,
            updated_at=r.updated_at,
            meeting_count=counts.get(r.id, 0),
        )
        for r in rows
    ]


@router.post("", response_model=TopicOut)
async def create_topic(
    body: TopicCreate,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """创建 议题. leader / admin 权限."""
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "leader / admin 才 可 创建 议题")

    t = Topic(
        workspace_id=auth.workspace.id,
        name=body.name,
        description=body.description,
        status="active",
        created_by_user_id=auth.user.id,
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)

    try:
        await system_audit_log(
            session,
            auth.workspace.id,
            "topic.created",
            target_type="topic",
            target_id=str(t.id),
            payload={"name": t.name, "user_id": str(auth.user.id)},
        )
    except Exception:
        logger.exception("topic.created audit log failed (non-fatal)")

    return TopicOut(
        id=t.id,
        workspace_id=t.workspace_id,
        name=t.name,
        description=t.description,
        status=t.status,
        created_by_user_id=t.created_by_user_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        meeting_count=0,
    )


@router.get("/{topic_id}", response_model=TopicDetailOut)
async def get_topic(
    topic_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """议题 详情 + 关联 meeting 时间线 (started_at desc, NULL 排最后)."""
    t = (
        await session.execute(
            select(Topic).where(
                Topic.id == topic_id,
                Topic.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "议题不存在 或 不属于本 workspace")

    meetings = (
        await session.execute(
            select(Meeting)
            .where(
                Meeting.workspace_id == auth.workspace.id,
                Meeting.topic_id == topic_id,
            )
            .order_by(Meeting.started_at.desc().nullslast())
        )
    ).scalars().all()

    return TopicDetailOut(
        id=t.id,
        workspace_id=t.workspace_id,
        name=t.name,
        description=t.description,
        status=t.status,
        created_by_user_id=t.created_by_user_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        meeting_count=len(meetings),
        meetings=[
            TopicMeetingOut(
                id=m.id,
                title=m.title or "(未命名)",
                status=m.status,
                started_at=m.started_at,
                ended_at=m.ended_at,
                mode=getattr(m, "mode", "hybrid"),
            )
            for m in meetings
        ],
    )


@router.patch("/{topic_id}", response_model=TopicOut)
async def update_topic(
    topic_id: uuid.UUID,
    body: TopicUpdate,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """更新 议题 (name / desc / status). leader / admin 权限."""
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "leader / admin 才 可 改 议题")

    t = (
        await session.execute(
            select(Topic).where(
                Topic.id == topic_id,
                Topic.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "议题不存在")

    changes = {}
    if body.name is not None:
        changes["name"] = body.name
    if body.description is not None:
        changes["description"] = body.description
    if body.status is not None:
        if body.status not in ("active", "archived"):
            raise HTTPException(400, "status 必须 是 active 或 archived")
        changes["status"] = body.status
    if not changes:
        # no-op
        return TopicOut(
            id=t.id,
            workspace_id=t.workspace_id,
            name=t.name,
            description=t.description,
            status=t.status,
            created_by_user_id=t.created_by_user_id,
            created_at=t.created_at,
            updated_at=t.updated_at,
            meeting_count=0,  # 不算 — patch 不需要
        )

    await session.execute(
        update(Topic).where(Topic.id == topic_id).values(**changes)
    )
    await session.commit()
    await session.refresh(t)

    try:
        await system_audit_log(
            session,
            auth.workspace.id,
            "topic.updated",
            target_type="topic",
            target_id=str(topic_id),
            payload={"changes": list(changes.keys()), "user_id": str(auth.user.id)},
        )
    except Exception:
        logger.exception("topic.updated audit log failed (non-fatal)")

    return TopicOut(
        id=t.id,
        workspace_id=t.workspace_id,
        name=t.name,
        description=t.description,
        status=t.status,
        created_by_user_id=t.created_by_user_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        meeting_count=0,
    )


# ============================================================================
# Meeting ↔ Topic linker (mounted under /api/meetings)
# ============================================================================

linker_router = APIRouter(prefix="/api/meetings", tags=["topics"])


class LinkMeetingTopicBody(BaseModel):
    topic_id: uuid.UUID


@linker_router.post("/{meeting_id}/topic", response_model=dict)
async def link_meeting_topic(
    meeting_id: uuid.UUID,
    body: LinkMeetingTopicBody,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """把 meeting 关联到 议题. leader/admin 权限. Idempotent — 重复绑定 no-op."""
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "leader / admin 才 可 改 meeting 议题")

    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id,
                Meeting.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "meeting 不存在")

    t = (
        await session.execute(
            select(Topic).where(
                Topic.id == body.topic_id,
                Topic.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if t is None:
        raise HTTPException(404, "议题 不存在 或 不 跨 workspace")

    await session.execute(
        update(Meeting)
        .where(Meeting.id == meeting_id)
        .values(topic_id=body.topic_id)
    )
    await session.commit()
    return {"meeting_id": str(meeting_id), "topic_id": str(body.topic_id)}


@linker_router.delete("/{meeting_id}/topic", response_model=dict)
async def unlink_meeting_topic(
    meeting_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """从 meeting 拆 议题 (topic_id → NULL). leader/admin 权限."""
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(403, "leader / admin 才 可 改 meeting 议题")

    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id,
                Meeting.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "meeting 不存在")

    await session.execute(
        update(Meeting).where(Meeting.id == meeting_id).values(topic_id=None)
    )
    await session.commit()
    return {"meeting_id": str(meeting_id), "topic_id": None}
