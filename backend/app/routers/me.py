"""
Theme 1 (P0): personal collaboration dashboard.

This router answers two questions for the logged-in user:

  1. "What's on my plate across all meetings?" — `GET /api/me/actions`
  2. "What new things should I notice since I last looked?" — bell-drawer
     endpoints under `GET /api/me/notifications`

Both are scoped to the caller's active workspace (matches the standard
auth-context guarantee — no cross-tenant leakage). The actions endpoint
is a thin SELECT over `meeting_action_item` filtered by assignee + a
helpful join to fetch the meeting title so the FE doesn't need a second
round trip per row.

Notifications are intentionally cheap reads: a single index hit on
`(user_id, created_at desc)` plus a `COUNT(*) WHERE read_at IS NULL` for
the bell badge. Mark-read is a flat UPDATE; no soft-delete — once a user
clears it, it stays cleared. The cron in `notify.py` writes new rows;
this router only reads / flips read_at.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import Meeting, MeetingActionItem, Notification, Task

router = APIRouter(prefix="/api/me", tags=["me"])


# --------- /api/me/actions --------------------------------------------------


class MyActionOut(BaseModel):
    id: uuid.UUID
    meeting_id: uuid.UUID
    meeting_title: Optional[str] = None
    content: str
    due_at: Optional[datetime] = None
    status: str
    source_type: str
    created_at: datetime
    updated_at: datetime


@router.get("/actions", response_model=list[MyActionOut])
async def list_my_actions(
    status: str = Query("open", regex="^(open|all|done)$"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    My action items across the active workspace.

    `status=open`  → only `status='open'` rows (default; what the bell-tile
                    "我的待办" shows).
    `status=done`  → only completed rows (closure history).
    `status=all`   → no status filter; useful for sortable dashboard mode.

    Ordered by (due_at NULLS LAST, created_at desc) so overdue items naturally
    float to the top once a due date is set; un-dated items still appear
    newest-first.
    """
    q = (
        select(MeetingActionItem, Meeting.title)
        .join(Meeting, Meeting.id == MeetingActionItem.meeting_id)
        .where(
            MeetingActionItem.assignee_user_id == auth.user.id,
            MeetingActionItem.workspace_id == auth.workspace.id,
        )
    )
    if status == "open":
        q = q.where(MeetingActionItem.status == "open")
    elif status == "done":
        q = q.where(MeetingActionItem.status == "done")
    # status=='all' → no extra filter

    q = q.order_by(
        MeetingActionItem.due_at.asc().nullslast(),
        MeetingActionItem.created_at.desc(),
    )
    rows = (await session.execute(q)).all()
    return [
        MyActionOut(
            id=r[0].id,
            meeting_id=r[0].meeting_id,
            meeting_title=r[1],
            content=r[0].content,
            due_at=r[0].due_at,
            status=r[0].status,
            source_type=r[0].source_type,
            created_at=r[0].created_at,
            updated_at=r[0].updated_at,
        )
        for r in rows
    ]


# --------- /api/me/tasks ----------------------------------------------------


class MyTaskOut(BaseModel):
    id: uuid.UUID
    title: Optional[str] = None
    content: str
    due_at: Optional[datetime] = None
    status: str
    source_type: str
    # When source_type='meeting', source_ref carries the originating
    # meeting + action_item ids so the FE can deeplink. Other source
    # types carry their own keys (see Task.source_type docstring).
    source_ref: Optional[dict] = None
    # Convenience for the meeting-source case — saves the FE a join.
    meeting_id: Optional[uuid.UUID] = None
    meeting_title: Optional[str] = None
    created_at: datetime
    updated_at: datetime


@router.get("/tasks", response_model=list[MyTaskOut])
async def list_my_tasks(
    status: str = Query("open", regex="^(open|all|done|in_progress)$"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v17: Task-side mirror of /api/me/actions.

    Returns Tasks assigned to the caller in the active workspace, ordered
    (due_at NULLS LAST, created_at desc) — same UX shape as /actions.
    For source_type='meeting' rows we also populate `meeting_id` and
    `meeting_title` from the source_ref's meeting_id (one extra join).

    `status` accepts 'in_progress' here (Task has it; ActionItem doesn't)
    so v18 state-machine UIs can call /tasks without a back-compat wart.
    """
    q = select(Task).where(
        Task.assignee_user_id == auth.user.id,
        Task.workspace_id == auth.workspace.id,
    )
    if status == "open":
        q = q.where(Task.status == "open")
    elif status == "done":
        q = q.where(Task.status == "done")
    elif status == "in_progress":
        q = q.where(Task.status == "in_progress")
    # status == 'all' → no extra filter
    q = q.order_by(Task.due_at.asc().nullslast(), Task.created_at.desc())
    tasks = (await session.execute(q)).scalars().all()
    if not tasks:
        return []

    # Bulk-fetch meeting titles for source_type='meeting' rows.
    meeting_ids: list[uuid.UUID] = []
    for t in tasks:
        if t.source_type == "meeting" and isinstance(t.source_ref, dict):
            mid = t.source_ref.get("meeting_id")
            if isinstance(mid, str):
                try:
                    meeting_ids.append(uuid.UUID(mid))
                except ValueError:
                    pass
    title_by_id: dict[uuid.UUID, str] = {}
    if meeting_ids:
        rows = (
            await session.execute(
                select(Meeting.id, Meeting.title).where(Meeting.id.in_(meeting_ids))
            )
        ).all()
        title_by_id = {r[0]: r[1] for r in rows}

    out: list[MyTaskOut] = []
    for t in tasks:
        meeting_id: Optional[uuid.UUID] = None
        meeting_title: Optional[str] = None
        if t.source_type == "meeting" and isinstance(t.source_ref, dict):
            mid_raw = t.source_ref.get("meeting_id")
            if isinstance(mid_raw, str):
                try:
                    meeting_id = uuid.UUID(mid_raw)
                    meeting_title = title_by_id.get(meeting_id)
                except ValueError:
                    pass
        out.append(
            MyTaskOut(
                id=t.id,
                title=t.title,
                content=t.content,
                due_at=t.due_at,
                status=t.status,
                source_type=t.source_type,
                source_ref=t.source_ref,
                meeting_id=meeting_id,
                meeting_title=meeting_title,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return out


# --------- /api/me/notifications --------------------------------------------


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    payload: Optional[dict] = None
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int


@router.get("/notifications", response_model=NotificationListOut)
async def list_my_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Bell drawer feed.

    Returns the most recent `limit` notifications + a separate `unread_count`
    so the bell can render a badge without re-fetching everything. The
    `unread_count` always reflects the full unread set (not capped by limit).
    """
    q = (
        select(Notification)
        .where(
            Notification.user_id == auth.user.id,
            Notification.workspace_id == auth.workspace.id,
        )
    )
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc()).limit(limit)
    rows = (await session.execute(q)).scalars().all()

    unread_count = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == auth.user.id,
                Notification.workspace_id == auth.workspace.id,
                Notification.read_at.is_(None),
            )
        )
    ).scalar_one()

    return NotificationListOut(
        items=[
            NotificationOut(
                id=r.id,
                kind=r.kind,
                payload=r.payload,
                read_at=r.read_at,
                created_at=r.created_at,
            )
            for r in rows
        ],
        unread_count=int(unread_count or 0),
    )


@router.post("/notifications/{notif_id}/read", status_code=204)
async def mark_notification_read(
    notif_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Mark a single notification as read. Idempotent."""
    try:
        nid = uuid.UUID(notif_id)
    except ValueError:
        raise HTTPException(400, "invalid notification id")
    row = (
        await session.execute(
            select(Notification).where(
                Notification.id == nid,
                Notification.user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "notification not found")
    if row.read_at is None:
        row.read_at = func.now()
        await session.commit()


@router.post("/notifications/read-all", status_code=204)
async def mark_all_notifications_read(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Bulk-mark every unread notification of the current user as read."""
    await session.execute(
        update(Notification)
        .where(
            Notification.user_id == auth.user.id,
            Notification.workspace_id == auth.workspace.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=func.now())
    )
    await session.commit()
