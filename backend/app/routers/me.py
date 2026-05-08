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
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import Meeting, MeetingActionItem, Notification, Task, User
from ..notify import emit_notification
from ..task_state import (
    TASK_ACTION_ACCEPT,
    TASK_ACTION_CANCEL,
    TASK_ACTION_COMPLETE,
    TASK_ACTION_DISPATCH,
    TASK_ACTION_RETURN,
    TASK_ACTION_START,
    mirror_to_action_status,
    transition,
)

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
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None
    status: str
    # v18: state-machine timestamps. NULL until the corresponding transition
    # fires; never cleared once set (audit trail).
    dispatched_at: Optional[datetime] = None
    dispatched_by_user_id: Optional[uuid.UUID] = None
    accepted_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
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
    status: str = Query(
        "active",
        regex="^(open|all|done|in_progress|dispatched|accepted|cancelled|active|pending|working)$",
    ),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Returns Tasks assigned to the caller in the active workspace, ordered
    (due_at NULLS LAST, created_at desc).

    Status filter — atomic + composite:
      Atomic   : open | dispatched | accepted | in_progress | done | cancelled | all
      Composite: active   = open|dispatched|accepted|in_progress (default;
                            "anything not yet finished")
                 pending  = dispatched (待签收 — UI tab on /me page)
                 working  = accepted|in_progress (办理中)

    For source_type='meeting' rows we hydrate `meeting_id` and
    `meeting_title` from source_ref's meeting_id (one extra join).
    """
    q = select(Task).where(
        Task.assignee_user_id == auth.user.id,
        Task.workspace_id == auth.workspace.id,
    )
    if status == "active":
        q = q.where(
            Task.status.in_(["open", "dispatched", "accepted", "in_progress"])
        )
    elif status == "pending":
        q = q.where(Task.status == "dispatched")
    elif status == "working":
        q = q.where(Task.status.in_(["accepted", "in_progress"]))
    elif status in ("open", "dispatched", "accepted", "in_progress", "done", "cancelled"):
        q = q.where(Task.status == status)
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
                assignee_user_id=t.assignee_user_id,
                due_at=t.due_at,
                status=t.status,
                dispatched_at=t.dispatched_at,
                dispatched_by_user_id=t.dispatched_by_user_id,
                accepted_at=t.accepted_at,
                started_at=t.started_at,
                source_type=t.source_type,
                source_ref=t.source_ref,
                meeting_id=meeting_id,
                meeting_title=meeting_title,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return out


# --------- v18: Task lifecycle endpoints ------------------------------------


class DispatchIn(BaseModel):
    assignee_user_id: uuid.UUID
    due_at: Optional[datetime] = None
    note: Optional[str] = None  # optional context line for the assignee


class ReturnIn(BaseModel):
    reason: Optional[str] = None


class CancelIn(BaseModel):
    reason: Optional[str] = None


async def _load_task_in_workspace(
    session: AsyncSession, task_id: str, workspace_id: uuid.UUID
) -> Task:
    """Load a Task scoped to the caller's workspace, or 404."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(400, "invalid task id")
    t = (
        await session.execute(
            select(Task).where(Task.id == tid, Task.workspace_id == workspace_id)
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "task not found")
    return t


async def _mirror_status_to_action(
    session: AsyncSession, task: Task
) -> None:
    """
    After Task.status changes, mirror the corresponding ActionItem.status
    via the v18 state-mirror table. Idempotent: if no ActionItem links
    back, this is a no-op (e.g. v19 leader-directive Tasks have no
    paired ActionItem).
    """
    target = mirror_to_action_status(task.status)
    await session.execute(
        update(MeetingActionItem)
        .where(MeetingActionItem.task_id == task.id)
        .values(status=target)
    )


def _task_to_meeting_payload(task: Task) -> dict:
    """Build the meeting_id / meeting_title / action_id chunk for notifications."""
    out: dict = {
        "task_id": str(task.id),
        "content": task.content,
    }
    if isinstance(task.source_ref, dict):
        mid = task.source_ref.get("meeting_id")
        aid = task.source_ref.get("action_item_id")
        if isinstance(mid, str):
            out["meeting_id"] = mid
        if isinstance(aid, str):
            out["action_id"] = aid
    return out


@router.post("/tasks/{task_id}/dispatch", response_model=MyTaskOut)
async def dispatch_task(
    task_id: str,
    payload: DispatchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Set assignee + due + transition `open → dispatched`.

    Anyone in the workspace can dispatch — v18 doesn't gate this on role.
    The assignee must also be in this workspace. Notifies the assignee
    (severity=normal, kind=task_dispatched). Self-dispatch is allowed but
    suppresses the notification (no need to ping yourself).
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    new_status = transition(TASK_ACTION_DISPATCH, t.status)

    # Verify assignee is in this workspace.
    u = (
        await session.execute(
            select(User).where(
                User.id == payload.assignee_user_id,
                User.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not u:
        raise HTTPException(400, "assignee_user_id not in this workspace")

    now = datetime.now(timezone.utc)
    t.assignee_user_id = payload.assignee_user_id
    if payload.due_at is not None:
        t.due_at = payload.due_at
    t.status = new_status
    t.dispatched_at = now
    t.dispatched_by_user_id = auth.user.id

    await _mirror_status_to_action(session, t)

    if payload.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["due_at"] = t.due_at.isoformat() if t.due_at else None
        notify_payload["dispatched_by"] = auth.user.name
        if payload.note:
            notify_payload["note"] = payload.note[:200]
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=payload.assignee_user_id,
            kind="task_dispatched",
            payload=notify_payload,
        )

    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/accept", response_model=MyTaskOut)
async def accept_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Assignee acknowledges the dispatch. dispatched → accepted.
    Only the assignee may accept. Notifies the dispatcher.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.assignee_user_id != auth.user.id:
        raise HTTPException(403, "only the assignee can accept this task")
    new_status = transition(TASK_ACTION_ACCEPT, t.status)

    now = datetime.now(timezone.utc)
    t.status = new_status
    t.accepted_at = now

    await _mirror_status_to_action(session, t)

    if t.dispatched_by_user_id and t.dispatched_by_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["accepted_by"] = auth.user.name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.dispatched_by_user_id,
            kind="task_accepted",
            payload=notify_payload,
        )

    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/return", response_model=MyTaskOut)
async def return_task(
    task_id: str,
    payload: ReturnIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Assignee declines the dispatch. dispatched → open + clears assignee.
    Notifies the dispatcher with the reason so they can re-dispatch.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.assignee_user_id != auth.user.id:
        raise HTTPException(403, "only the assignee can return this task")
    new_status = transition(TASK_ACTION_RETURN, t.status)

    prior_dispatcher = t.dispatched_by_user_id
    t.status = new_status
    t.assignee_user_id = None
    # Keep dispatched_at / by for audit; the next dispatch will overwrite.

    await _mirror_status_to_action(session, t)

    if prior_dispatcher and prior_dispatcher != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["returned_by"] = auth.user.name
        if payload.reason:
            notify_payload["reason"] = payload.reason[:300]
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=prior_dispatcher,
            kind="task_returned",
            payload=notify_payload,
        )

    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/start", response_model=MyTaskOut)
async def start_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Assignee starts execution. accepted → in_progress.
    Internal transition; no notification.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.assignee_user_id != auth.user.id:
        raise HTTPException(403, "only the assignee can start this task")
    new_status = transition(TASK_ACTION_START, t.status)

    t.status = new_status
    t.started_at = datetime.now(timezone.utc)

    await _mirror_status_to_action(session, t)
    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/complete", response_model=MyTaskOut)
async def complete_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Mark done. {open|accepted|in_progress} → done. Only assignee.
    Notifies the dispatcher (if there was one and != caller).
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.assignee_user_id != auth.user.id:
        raise HTTPException(403, "only the assignee can complete this task")
    new_status = transition(TASK_ACTION_COMPLETE, t.status)

    t.status = new_status

    await _mirror_status_to_action(session, t)

    if t.dispatched_by_user_id and t.dispatched_by_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["completed_by"] = auth.user.name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.dispatched_by_user_id,
            kind="task_completed",
            payload=notify_payload,
        )

    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/cancel", response_model=MyTaskOut)
async def cancel_task(
    task_id: str,
    payload: CancelIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Cancel from any active state. Allowed for: assignee, dispatcher, creator.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    allowed = {t.assignee_user_id, t.dispatched_by_user_id, t.created_by_user_id}
    if auth.user.id not in allowed:
        raise HTTPException(
            403, "only the assignee, dispatcher, or creator can cancel"
        )
    new_status = transition(TASK_ACTION_CANCEL, t.status)

    t.status = new_status

    await _mirror_status_to_action(session, t)
    await session.commit()
    await session.refresh(t)
    return _task_to_my_out(t, await _meeting_title_for(session, t))


async def _meeting_title_for(
    session: AsyncSession, task: Task
) -> Optional[tuple[uuid.UUID, str]]:
    """Resolve (meeting_id, meeting_title) from task.source_ref or None."""
    if task.source_type != "meeting" or not isinstance(task.source_ref, dict):
        return None
    mid_raw = task.source_ref.get("meeting_id")
    if not isinstance(mid_raw, str):
        return None
    try:
        mid = uuid.UUID(mid_raw)
    except ValueError:
        return None
    title = (
        await session.execute(select(Meeting.title).where(Meeting.id == mid))
    ).scalar_one_or_none()
    return (mid, title) if title else (mid, "")


def _task_to_my_out(
    t: Task, meeting_pair: Optional[tuple[uuid.UUID, str]]
) -> MyTaskOut:
    return MyTaskOut(
        id=t.id,
        title=t.title,
        content=t.content,
        assignee_user_id=t.assignee_user_id,
        due_at=t.due_at,
        status=t.status,
        dispatched_at=t.dispatched_at,
        dispatched_by_user_id=t.dispatched_by_user_id,
        accepted_at=t.accepted_at,
        started_at=t.started_at,
        source_type=t.source_type,
        source_ref=t.source_ref,
        meeting_id=meeting_pair[0] if meeting_pair else None,
        meeting_title=meeting_pair[1] if meeting_pair else None,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


# --------- /api/me/notifications --------------------------------------------


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    severity: str = "normal"  # v18: normal | yellow | red | purple
    payload: Optional[dict] = None
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int
    # v18: highest severity among unread items — drives bell badge color.
    # 'purple' > 'red' > 'yellow' > 'normal'. Empty unread set → 'normal'.
    max_unread_severity: str = "normal"


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

    # v18: compute max severity among ALL unread (not just the limit'd page)
    # so the bell badge color is consistent regardless of paging.
    severity_rank = {"normal": 0, "yellow": 1, "red": 2, "purple": 3}
    rank_to_severity = {v: k for k, v in severity_rank.items()}
    max_unread_rank = (
        await session.execute(
            select(Notification.severity)
            .where(
                Notification.user_id == auth.user.id,
                Notification.workspace_id == auth.workspace.id,
                Notification.read_at.is_(None),
            )
            .distinct()
        )
    ).all()
    rank = 0
    for (sev,) in max_unread_rank:
        rank = max(rank, severity_rank.get(sev or "normal", 0))
    max_unread_severity = rank_to_severity.get(rank, "normal")

    return NotificationListOut(
        items=[
            NotificationOut(
                id=r.id,
                kind=r.kind,
                severity=r.severity or "normal",
                payload=r.payload,
                read_at=r.read_at,
                created_at=r.created_at,
            )
            for r in rows
        ],
        unread_count=int(unread_count or 0),
        max_unread_severity=max_unread_severity,
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
