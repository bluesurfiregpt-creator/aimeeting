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

from fastapi import File, UploadFile

from ..access_control import can_access_or_raise
from ..audit import audit_log
from ..auth import (
    AuthContext,
    expert_bound_agent_id,
    get_current_auth,
    is_leader_or_admin,
    require_leader_or_admin,
)
from ..db import get_session
from ..directive_parser import parse_directive
from ..doc_parser import extract_text_async, kind_from_filename
from ..llm_quota import check_quota_or_raise
from ..evaluation import recompute_for_task_participants, recompute_user_evaluation
from ..models import (
    LeaderDirective,
    Meeting,
    MeetingActionItem,
    MeetingActionItemComment,
    Notification,
    Task,
    TaskCoProgress,
    TaskCollaborationRating,
    UpperDoc,
    User,
    WorkspaceMembership,
)
from ..notify import emit_notification
from ..task_state import (
    TASK_ACTION_ACCEPT,
    TASK_ACTION_APPROVE,
    TASK_ACTION_ARCHIVE,
    TASK_ACTION_CANCEL,
    TASK_ACTION_COMPLETE,
    TASK_ACTION_DISPATCH,
    TASK_ACTION_REJECT,
    TASK_ACTION_RETURN,
    TASK_ACTION_START,
    TASK_ACTION_SUBMIT,
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
    # v21: 数据 5 级分级 (core | important | sensitive | general | public)
    data_classification: str = "general"
    # v22.5: 协办列表 + 已交协办进度(协办视角和主责视角都用得上)
    co_assignees: list[uuid.UUID] = []
    co_submitted_user_ids: list[uuid.UUID] = []  # 协办里已 co-submit 的子集
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
        regex="^(open|all|done|in_progress|dispatched|accepted|submitted|archived|cancelled|active|pending|working|review)$",
    ),
    role: str = Query("assignee", regex="^(assignee|reviewer|coassignee)$"),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Returns Tasks the caller is involved with, ordered
    (due_at NULLS LAST, created_at desc).

    `role`:
      assignee (default) — Tasks where assignee_user_id == caller
      reviewer           — Tasks where dispatched_by == caller OR
                           created_by == caller (used for /me 待我审核 tab;
                           pair with status=review to get exactly the
                           pending-review queue)
      coassignee         — v22.5: Tasks where caller is in co_assignees array
                           (用于 /me 「我的协办」 tab)

    Status filter — atomic + composite:
      Atomic   : open | dispatched | accepted | in_progress | submitted |
                 done | archived | cancelled | all
      Composite: active   = open|dispatched|accepted|in_progress|submitted
                            (default; "anything not yet finished or cancelled")
                 pending  = dispatched (待签收 — UI tab on /me page)
                 working  = accepted|in_progress (办理中)
                 review   = submitted (待审核)

    For source_type='meeting' rows we hydrate `meeting_id` and
    `meeting_title` from source_ref's meeting_id (one extra join).
    """
    if role == "reviewer":
        q = select(Task).where(
            Task.workspace_id == auth.workspace.id,
            (
                (Task.dispatched_by_user_id == auth.user.id)
                | (Task.created_by_user_id == auth.user.id)
            ),
            # 不展示自己派给自己的(避免和 assignee 视角重复)
            (Task.assignee_user_id != auth.user.id)
            | Task.assignee_user_id.is_(None),
        )
    elif role == "coassignee":
        # v22.5: 我作为协办的任务.JSONB 数组里包含我的 user_id 字符串.
        # 用 PG 的 @> 操作符:co_assignees @> '["<my-uuid>"]'
        from sqlalchemy import text
        q = select(Task).where(
            Task.workspace_id == auth.workspace.id,
            text("(task.co_assignees @> :me)").bindparams(
                me=f'["{auth.user.id}"]'
            ),
        )
    else:
        q = select(Task).where(
            Task.assignee_user_id == auth.user.id,
            Task.workspace_id == auth.workspace.id,
        )
    if status == "active":
        q = q.where(
            Task.status.in_(
                ["open", "dispatched", "accepted", "in_progress", "submitted"]
            )
        )
    elif status == "pending":
        q = q.where(Task.status == "dispatched")
    elif status == "working":
        q = q.where(Task.status.in_(["accepted", "in_progress"]))
    elif status == "review":
        q = q.where(Task.status == "submitted")
    elif status in (
        "open",
        "dispatched",
        "accepted",
        "in_progress",
        "submitted",
        "done",
        "archived",
        "cancelled",
    ):
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

    # v22.5: 批量取所有相关 task 的 co_submitted users(避免 N+1)
    task_ids_with_co = [t.id for t in tasks if t.co_assignees]
    co_submitted_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    if task_ids_with_co:
        co_rows = (
            await session.execute(
                select(
                    TaskCoProgress.task_id,
                    TaskCoProgress.co_assignee_user_id,
                ).where(TaskCoProgress.task_id.in_(task_ids_with_co))
            )
        ).all()
        for tid, uid in co_rows:
            co_submitted_map.setdefault(tid, []).append(uid)

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
                data_classification=t.data_classification or "general",
                co_assignees=_parse_co_assignees(t),
                co_submitted_user_ids=co_submitted_map.get(t.id, []),
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
    # v22.5: 协办列表(最多 5 人,不能含主责自己,所有都必须在 workspace).
    # None = 退化到单 assignee 模式,与 v18-v22 完全兼容.
    co_assignees: Optional[list[uuid.UUID]] = None


class ReturnIn(BaseModel):
    reason: Optional[str] = None


class CancelIn(BaseModel):
    reason: Optional[str] = None


# v22.5 上限:每个 Task 最多 5 个协办(per Q5)
_MAX_CO_ASSIGNEES = 5


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

    v21: 派发是「领导/管理员」级动作(per 智慧住建文档「二.1.2 领导权限」),
    expert / member 不能直接派发(可以通过 /commit upper_doc/directive
    时申请 dispatch=true,由 commit 入口检查).

    Self-dispatch 仍然合法但不通知自己(no self-notify).
    """
    await require_leader_or_admin(session, auth)
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
    # v24.3 #3: 暂停派单检查(智慧住建文档 §4.4)
    if u.suspended_until and u.suspended_until > datetime.now(timezone.utc):
        raise HTTPException(
            409,
            f"用户 {u.name} 因连续 2 次重大超时被暂停派单,至 "
            f"{u.suspended_until.astimezone().strftime('%Y-%m-%d %H:%M')} 才可派",
        )

    # v22.5: 验证协办列表
    co_uuids: list[uuid.UUID] = []
    if payload.co_assignees:
        if len(payload.co_assignees) > _MAX_CO_ASSIGNEES:
            raise HTTPException(
                400, f"协办最多 {_MAX_CO_ASSIGNEES} 人,当前 {len(payload.co_assignees)}"
            )
        # 去重 + 不能含主责自己
        seen: set[uuid.UUID] = set()
        for cid in payload.co_assignees:
            if cid == payload.assignee_user_id:
                raise HTTPException(400, "协办不能包含主责自己")
            if cid in seen:
                continue
            seen.add(cid)
            co_uuids.append(cid)
        # 验证全部在 workspace
        if co_uuids:
            valid = (
                await session.execute(
                    select(User.id).where(
                        User.id.in_(co_uuids),
                        User.workspace_id == auth.workspace.id,
                    )
                )
            ).all()
            valid_set = {v[0] for v in valid}
            missing = set(co_uuids) - valid_set
            if missing:
                raise HTTPException(
                    400,
                    f"co_assignee 不在本工作空间:{', '.join(str(x) for x in missing)}",
                )

    now = datetime.now(timezone.utc)
    t.assignee_user_id = payload.assignee_user_id
    if payload.due_at is not None:
        t.due_at = payload.due_at
    t.status = new_status
    t.dispatched_at = now
    t.dispatched_by_user_id = auth.user.id
    t.co_assignees = [str(x) for x in co_uuids] if co_uuids else None

    await _mirror_status_to_action(session, t)

    # 通知主责
    if payload.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["due_at"] = t.due_at.isoformat() if t.due_at else None
        notify_payload["dispatched_by"] = auth.user.name
        if payload.note:
            notify_payload["note"] = payload.note[:200]
        if co_uuids:
            notify_payload["co_assignees_count"] = len(co_uuids)
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=payload.assignee_user_id,
            kind="task_dispatched",
            payload=notify_payload,
        )

    # v22.5: 通知所有协办
    for co_uid in co_uuids:
        if co_uid == auth.user.id:
            continue  # self-notify 抑制
        co_payload = _task_to_meeting_payload(t)
        co_payload["due_at"] = t.due_at.isoformat() if t.due_at else None
        co_payload["dispatched_by"] = auth.user.name
        co_payload["coordinator_user_id"] = str(payload.assignee_user_id)
        co_payload["coordinator_name"] = u.name
        if payload.note:
            co_payload["note"] = payload.note[:200]
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=co_uid,
            kind="task_co_assigned",
            payload=co_payload,
        )

    await audit_log(
        session, auth, "task.dispatch",
        target_type="task", target_id=str(t.id),
        payload={
            "assignee_user_id": str(payload.assignee_user_id),
            "co_assignees_count": len(co_uuids),
            "due_at": t.due_at.isoformat() if t.due_at else None,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


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

    await audit_log(
        session, auth, "task.accept",
        target_type="task", target_id=str(t.id),
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


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

    await audit_log(
        session, auth, "task.return",
        target_type="task", target_id=str(t.id),
        payload={"reason": (payload.reason or "")[:300] or None},
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


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
    await audit_log(
        session, auth, "task.start",
        target_type="task", target_id=str(t.id),
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


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

    await audit_log(
        session, auth, "task.complete",
        target_type="task", target_id=str(t.id),
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


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
    await audit_log(
        session, auth, "task.cancel",
        target_type="task", target_id=str(t.id),
        payload={"reason": (payload.reason or "")[:300] or None},
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


# v19: 上报办结申请 + 领导审核 + 归档 -----------------------------------------


class SubmitIn(BaseModel):
    note: Optional[str] = None  # 阶段汇报简述,可选(legacy back-compat)
    # v22.5: 若有未交协办,默认返回 422 让 UI 警告;客户端确认后带 force=true
    # 再调一次硬过.
    force: bool = False
    # v24.1 #5: 智慧住建文档 §4.3 阶段性上报模板.4 段结构化(都可选,任一非空都
    # 视为「使用结构化模板」).客户端可保留只填 note 的旧行为(纯文本汇报).
    completed: Optional[str] = None      # 已完成工作
    problems: Optional[str] = None       # 当前问题
    next_steps: Optional[str] = None     # 下一步计划
    # 佐证材料链接列表(URLs,如 OSS 存储 / 知识库 KB doc 链接).
    # max 10 条,每条 max 500 字符(防长 URL 攻击).
    evidence_urls: Optional[list[str]] = None


class RejectIn(BaseModel):
    reason: Optional[str] = None


async def _is_workspace_admin(
    session: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> bool:
    """v19: workspace owner/admin 可以代替 dispatcher 审核办结."""
    role = (
        await session.execute(
            select(WorkspaceMembership.role).where(
                WorkspaceMembership.user_id == user_id,
                WorkspaceMembership.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    return role in ("owner", "admin")


@router.post("/tasks/{task_id}/submit", response_model=MyTaskOut)
async def submit_task(
    task_id: str,
    payload: SubmitIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: assignee 上报办结申请. in_progress → submitted.
    通知 dispatcher(如有);若没有 dispatcher,通知 creator(领导指令场景下
    creator 就是发指令的领导).

    v22.5: 若 task.co_assignees 不为空,检查每个协办是否已在 task_co_progress
    里有提交记录.未交时:
      - force=false (默认) → 422 + 返回未交列表给 UI 弹警告
      - force=true → 通过(主责说了算)
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.assignee_user_id != auth.user.id:
        raise HTTPException(403, "only the assignee can submit this task")
    new_status = transition(TASK_ACTION_SUBMIT, t.status)

    # v22.5: 协办未交检查
    unsubmitted: list[uuid.UUID] = []
    if t.co_assignees and not payload.force:
        co_uids = [uuid.UUID(s) for s in t.co_assignees if isinstance(s, str)]
        submitted_rows = (
            await session.execute(
                select(TaskCoProgress.co_assignee_user_id).where(
                    TaskCoProgress.task_id == t.id,
                    TaskCoProgress.co_assignee_user_id.in_(co_uids),
                )
            )
        ).all()
        submitted_set = {r[0] for r in submitted_rows}
        unsubmitted = [u for u in co_uids if u not in submitted_set]
        if unsubmitted:
            raise HTTPException(
                422,
                f"还有 {len(unsubmitted)} 个协办方未提交;如确认强制汇总,请带 force=true 重试",
            )

    t.status = new_status

    # v24.1 #5: 如果用了结构化模板,把 submission_payload 写到 source_ref 里
    # 持久化(给 TaskDetail 页 + 客户审核时看完整阶段汇报).
    submission_payload: dict[str, Any] = {}
    if payload.completed:
        submission_payload["completed"] = payload.completed[:2000]
    if payload.problems:
        submission_payload["problems"] = payload.problems[:2000]
    if payload.next_steps:
        submission_payload["next_steps"] = payload.next_steps[:2000]
    if payload.evidence_urls:
        # 限 max 10 条 + 单条 max 500 chars
        if len(payload.evidence_urls) > 10:
            raise HTTPException(400, "evidence_urls 最多 10 条")
        ev_clean = [(u or "").strip()[:500] for u in payload.evidence_urls if u and u.strip()]
        if ev_clean:
            submission_payload["evidence_urls"] = ev_clean
    if payload.note:
        submission_payload["note"] = payload.note[:500]

    if submission_payload:
        # 把 submission_payload 写到 source_ref(JSONB)的子键,不破坏原 source_ref.
        # 关键:必须 dict() 拷贝出新对象,不能直接 mutate 原 dict — SQLAlchemy
        # 用 identity 比较检测 JSON 列变化,同对象 reassign 视为「无变化」.
        new_ref = dict(t.source_ref) if isinstance(t.source_ref, dict) else {}
        new_ref["submission_payload"] = {
            **submission_payload,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "submitted_by_user_id": str(auth.user.id),
            "submitted_by_name": auth.user.name,
        }
        t.source_ref = new_ref

    await _mirror_status_to_action(session, t)

    reviewer_id = t.dispatched_by_user_id or t.created_by_user_id
    if reviewer_id and reviewer_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["submitted_by"] = auth.user.name
        if payload.note:
            notify_payload["note"] = payload.note[:500]
        # v24.1 #5: 结构化字段非空时给 UI 一个 "structured=true" 提示,引导
        # 审核者点开看(detail 页有完整内容)
        if any([payload.completed, payload.problems, payload.next_steps, payload.evidence_urls]):
            notify_payload["structured"] = True
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=reviewer_id,
            kind="task_submitted",
            payload=notify_payload,
        )

    await audit_log(
        session, auth, "task.submit",
        target_type="task", target_id=str(t.id),
        payload={
            "force": payload.force,
            "note": (payload.note or "")[:500] or None,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/approve", response_model=MyTaskOut)
async def approve_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: 领导审核通过. submitted → done.

    谁可以批:dispatcher / creator(发指令的领导)/ workspace owner|admin.
    通知 assignee(如非自己).
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    is_dispatcher = t.dispatched_by_user_id == auth.user.id
    is_creator = t.created_by_user_id == auth.user.id
    is_admin = await _is_workspace_admin(session, auth.user.id, auth.workspace.id)
    if not (is_dispatcher or is_creator or is_admin):
        raise HTTPException(
            403, "only the dispatcher / creator / workspace admin can approve"
        )
    new_status = transition(TASK_ACTION_APPROVE, t.status)
    t.status = new_status

    await _mirror_status_to_action(session, t)

    if t.assignee_user_id and t.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["approved_by"] = auth.user.name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.assignee_user_id,
            kind="task_approved",
            payload=notify_payload,
        )

    # v22.5: 任务办结后,实时重算主责 + 所有协办的本月评价(真数据覆盖 seed)
    await recompute_for_task_participants(session, t)

    await audit_log(
        session, auth, "task.approve",
        target_type="task", target_id=str(t.id),
        payload={"assignee_user_id": str(t.assignee_user_id) if t.assignee_user_id else None},
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)

    # v24.2 #1: 办结 → KB 沉淀联动(智慧住建文档 §5.2).
    # fire-and-forget — LLM 5-15s 不应阻塞 approve API 响应.
    # 用户在 TaskDetail 重刷或 KB 列表里很快看到「[自动沉淀]」文档.
    import asyncio
    from ..closure_curator import curate_closed_task
    asyncio.create_task(curate_closed_task(t.id))

    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/reject", response_model=MyTaskOut)
async def reject_task(
    task_id: str,
    payload: RejectIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: 领导审核驳回返工. submitted → in_progress.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    is_dispatcher = t.dispatched_by_user_id == auth.user.id
    is_creator = t.created_by_user_id == auth.user.id
    is_admin = await _is_workspace_admin(session, auth.user.id, auth.workspace.id)
    if not (is_dispatcher or is_creator or is_admin):
        raise HTTPException(
            403, "only the dispatcher / creator / workspace admin can reject"
        )
    new_status = transition(TASK_ACTION_REJECT, t.status)
    t.status = new_status

    await _mirror_status_to_action(session, t)

    if t.assignee_user_id and t.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["rejected_by"] = auth.user.name
        if payload.reason:
            notify_payload["reason"] = payload.reason[:500]
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.assignee_user_id,
            kind="task_rejected",
            payload=notify_payload,
        )

    await audit_log(
        session, auth, "task.reject",
        target_type="task", target_id=str(t.id),
        payload={"reason": (payload.reason or "")[:500] or None},
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/archive", response_model=MyTaskOut)
async def archive_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: 手动归档已完成任务. done → archived. 静默,不通知.

    任何能取消的人都能归档(dispatcher / creator / assignee / workspace admin).
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    allowed = {t.assignee_user_id, t.dispatched_by_user_id, t.created_by_user_id}
    if auth.user.id not in allowed and not await _is_workspace_admin(
        session, auth.user.id, auth.workspace.id
    ):
        raise HTTPException(403, "not authorized to archive this task")
    new_status = transition(TASK_ACTION_ARCHIVE, t.status)
    t.status = new_status

    await _mirror_status_to_action(session, t)
    await audit_log(
        session, auth, "task.archive",
        target_type="task", target_id=str(t.id),
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


# v24.2 #3: 公文智能审核 ----------------------------------------------------


class DocumentAuditIn(BaseModel):
    text: str
    # 可选:基于哪个 KB 文档(只用于 audit 写记录,不影响逻辑)
    source_kb_doc_id: Optional[uuid.UUID] = None


class AuditIssueOut(BaseModel):
    severity: str  # high | medium | low
    category: str  # format | wording | policy
    location: str
    issue: str
    suggestion: str


class AuditOut(BaseModel):
    issues: list[AuditIssueOut]
    overall: str
    audited_chars: int
    truncated: bool
    fallback_used: bool
    error: Optional[str] = None


@router.post("/documents/audit", response_model=AuditOut)
async def audit_document_endpoint(
    payload: DocumentAuditIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.2 #3: 公文智能审核(智慧住建文档 §3.3).

    LLM 三维审核(format / wording / policy),返回 issues 列表 + 整体评价.
    任何 workspace 成员都可调,但应当鼓励 leader/admin 用(政务文稿审核场景).

    长文 > 20K 字符截断;LLM 失败兜底返回空 issues + error 字段.
    """
    from ..document_audit import audit_document

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(400, "text required")

    # v24.4 #1: LLM 配额检查 — 防 buggy 客户端 / 攻击 烧 DashScope token
    await check_quota_or_raise(auth.user.id, auth.workspace.id)

    result = await audit_document(session, text)
    await audit_log(
        session, auth, "document.audit",
        target_type="kb_document" if payload.source_kb_doc_id else "ad_hoc_text",
        target_id=str(payload.source_kb_doc_id) if payload.source_kb_doc_id else None,
        payload={
            "audited_chars": result["audited_chars"],
            "truncated": result["truncated"],
            "issue_count": len(result["issues"]),
            "fallback": result["fallback_used"],
        },
        autocommit=False,
    )
    await session.commit()
    return AuditOut(
        issues=[AuditIssueOut(**i) for i in result["issues"]],
        overall=result["overall"],
        audited_chars=result["audited_chars"],
        truncated=result["truncated"],
        fallback_used=result["fallback_used"],
        error=result.get("error"),
    )


# v24.1 #6: AI 辅助起草汇报 ---------------------------------------------------


class DraftSubmissionOut(BaseModel):
    completed: str
    problems: str
    next_steps: str
    error: Optional[str] = None  # LLM 失败时填


@router.post("/tasks/{task_id}/draft-submission", response_model=DraftSubmissionOut)
async def draft_submission_endpoint(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #6: 给 assignee 一个 LLM 起草的阶段汇报草稿(3 段).

    LLM 调用同步 5-15s,前端 SubmitDialog 里点「🤖 AI 起草」触发,拿到后
    填入 3 个 textarea,用户可继续编辑再 submit.
    """
    from ..submission_drafter import draft_submission

    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    # 任何相关人都能起草(不限 assignee — 协办 / dispatcher 也可帮 assignee 起草)
    co_uids = _co_uuids_of(t)
    is_principal = (
        t.assignee_user_id == auth.user.id
        or t.dispatched_by_user_id == auth.user.id
        or t.created_by_user_id == auth.user.id
        or auth.user.id in co_uids
    )
    if not is_principal:
        raise HTTPException(403, "您不是该 task 的相关人,不能调起草助手")

    # v24.4 #1: LLM 配额
    await check_quota_or_raise(auth.user.id, auth.workspace.id)

    drafts, err = await draft_submission(session, workspace_id=auth.workspace.id, task=t)
    if err and not drafts:
        return DraftSubmissionOut(
            completed="", problems="", next_steps="",
            error=err,
        )
    return DraftSubmissionOut(
        completed=drafts.get("completed", "") if drafts else "",
        problems=drafts.get("problems", "") if drafts else "",
        next_steps=drafts.get("next_steps", "") if drafts else "",
        error=None,
    )


# v24.1 #3: 4-维 自动派发路由 -------------------------------------------------


class RouteScoreOut(BaseModel):
    agent_id: uuid.UUID
    agent_name: str
    composite: float
    breakdown: dict  # {keyword, history, load, capability, _hits, _history_count, _candidate_load}
    candidate_user_id: Optional[uuid.UUID] = None
    candidate_user_name: Optional[str] = None
    candidate_user_active_count: int = 0


class RoutePreviewOut(BaseModel):
    """所有候选 Agent 的评分(降序),winner 是第一个 + 是否过阈值."""
    candidates: list[RouteScoreOut]
    threshold: float
    matched: bool  # 最高分是否 >= threshold(可以 auto-dispatch)


class AutoRouteOut(BaseModel):
    """auto-route 结果:matched=True 时已 dispatch,task 字段返回新状态."""
    matched: bool
    threshold: float
    winner: Optional[RouteScoreOut] = None
    task: Optional[MyTaskOut] = None  # 派发后的最新 task 状态
    candidates: list[RouteScoreOut] = []  # 全候选(降序),给 UI 展示「为啥选他」


@router.get("/tasks/{task_id}/route-preview", response_model=RoutePreviewOut)
async def preview_route(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #3: 给某个 Task 跑一遍 4-维评分,**只展示**候选 Agent + 分数,不
    实际派发.用途:
      - leader 派发前先看「系统建议派给谁,凭什么」
      - 客户演示时「让 AI 决策」
    """
    from ..routing import find_best_assignee_for_task, routing_score_to_dict

    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    decision = await find_best_assignee_for_task(
        session, auth.workspace.id, t.content,
        exclude_user_ids={t.created_by_user_id} if t.created_by_user_id else None,
    )
    if decision is None:
        # 没 winner,可能 0 候选或者全低于阈值.我们再单独跑一遍拿全候选(无 threshold)
        from ..routing import _MIN_COMPOSITE_THRESHOLD
        from ..routing import find_best_assignee_for_task as _f
        # 跑一次低阈值的 — 这是「展示」场景,要把所有候选给出来
        all_decision = await _f(
            session, auth.workspace.id, t.content,
            threshold=0.0,
            exclude_user_ids={t.created_by_user_id} if t.created_by_user_id else None,
        )
        candidates = (
            [routing_score_to_dict(c) for c in all_decision.all_candidates]
            if all_decision else []
        )
        return RoutePreviewOut(
            candidates=[RouteScoreOut(**c) for c in candidates],
            threshold=_MIN_COMPOSITE_THRESHOLD,
            matched=False,
        )
    return RoutePreviewOut(
        candidates=[RouteScoreOut(**routing_score_to_dict(c)) for c in decision.all_candidates],
        threshold=decision.threshold,
        matched=True,
    )


@router.post("/tasks/{task_id}/auto-route", response_model=AutoRouteOut)
async def auto_route_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #3: 对某个 open Task,跑 4-维评分,winner > 阈值则**直接 dispatch**
    给 winner Agent 名下负载最轻的 bound user.

    leader/admin only.失败(无 winner / 阈值不达 / Task 已派) → 返回 matched=False
    + 全候选,UI 让用户手动选.
    """
    from ..routing import find_best_assignee_for_task, routing_score_to_dict

    await require_leader_or_admin(session, auth)
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    if t.status != "open":
        raise HTTPException(
            409, f"task 当前状态 {t.status},只能对 open 状态的 task 自动派发"
        )

    decision = await find_best_assignee_for_task(
        session, auth.workspace.id, t.content,
        exclude_user_ids={t.created_by_user_id} if t.created_by_user_id else None,
    )
    if decision is None or decision.winner.candidate_user_id is None:
        # 把所有候选拿出来给 UI(threshold=0 跑一次)
        from ..routing import _MIN_COMPOSITE_THRESHOLD
        all_decision = await find_best_assignee_for_task(
            session, auth.workspace.id, t.content,
            threshold=0.0,
            exclude_user_ids={t.created_by_user_id} if t.created_by_user_id else None,
        )
        candidates_dicts = (
            [routing_score_to_dict(c) for c in all_decision.all_candidates]
            if all_decision else []
        )
        return AutoRouteOut(
            matched=False,
            threshold=_MIN_COMPOSITE_THRESHOLD,
            winner=None,
            task=None,
            candidates=[RouteScoreOut(**c) for c in candidates_dicts],
        )

    # 命中!走 dispatch 流程(复用状态机)
    new_status = transition(TASK_ACTION_DISPATCH, t.status)
    now = datetime.now(timezone.utc)
    t.assignee_user_id = decision.winner.candidate_user_id
    t.status = new_status
    t.dispatched_at = now
    t.dispatched_by_user_id = auth.user.id

    await _mirror_status_to_action(session, t)

    if t.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["due_at"] = t.due_at.isoformat() if t.due_at else None
        notify_payload["dispatched_by"] = auth.user.name
        notify_payload["auto_routed"] = True
        notify_payload["routing_composite"] = decision.winner.composite
        notify_payload["routing_agent"] = decision.winner.agent_name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.assignee_user_id,
            kind="task_dispatched",
            payload=notify_payload,
        )

    await audit_log(
        session, auth, "task.auto_route",
        target_type="task", target_id=str(t.id),
        payload={
            "winner_agent_id": str(decision.winner.agent_id),
            "winner_agent_name": decision.winner.agent_name,
            "winner_user_id": str(decision.winner.candidate_user_id),
            "composite": decision.winner.composite,
            "breakdown": decision.winner.breakdown,
            "threshold": decision.threshold,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)

    candidates = [
        RouteScoreOut(**routing_score_to_dict(c)) for c in decision.all_candidates
    ]
    out_task = await _task_to_my_out_with_lookup(
        session, t, await _meeting_title_for(session, t)
    )
    return AutoRouteOut(
        matched=True,
        threshold=decision.threshold,
        winner=RouteScoreOut(**routing_score_to_dict(decision.winner)),
        task=out_task,
        candidates=candidates,
    )


# v22.5: 多 AI 协作端点 ---------------------------------------------------------


class CoSubmitIn(BaseModel):
    content: Optional[str] = None  # 简短交付说明


class RateIn(BaseModel):
    ratee_user_id: uuid.UUID
    dimension: str  # 'quality' | 'collaboration'
    score: int  # 1-5
    comment: Optional[str] = None


_VALID_DIMENSIONS: frozenset[str] = frozenset({"quality", "collaboration"})


def _co_uuids_of(task: Task) -> list[uuid.UUID]:
    """Parse task.co_assignees JSON list back to UUID list."""
    out: list[uuid.UUID] = []
    if not task.co_assignees:
        return out
    for s in task.co_assignees:
        try:
            out.append(uuid.UUID(s))
        except (TypeError, ValueError):
            continue
    return out


@router.post("/tasks/{task_id}/co-submit", response_model=MyTaskOut)
async def co_submit_task(
    task_id: str,
    payload: CoSubmitIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v22.5: 协办方提交自己的成果.UPSERT 一行 task_co_progress.
    通知主责 task_co_submitted.
    Task.status 不变(只主责能驱动状态机).
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    co_uids = _co_uuids_of(t)
    if auth.user.id not in co_uids:
        raise HTTPException(403, "您不在该任务的协办列表里")

    body = (payload.content or "").strip()[:2000] or None

    # UPSERT: 找现有,有就更新,没有就插
    existing = (
        await session.execute(
            select(TaskCoProgress).where(
                TaskCoProgress.task_id == t.id,
                TaskCoProgress.co_assignee_user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.content = body
        existing.submitted_at = datetime.now(timezone.utc)
    else:
        session.add(
            TaskCoProgress(
                task_id=t.id,
                co_assignee_user_id=auth.user.id,
                content=body,
            )
        )

    # 通知主责
    if t.assignee_user_id and t.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["co_assignee_name"] = auth.user.name
        if body:
            notify_payload["preview"] = body[:80] + ("…" if len(body) > 80 else "")
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.assignee_user_id,
            kind="task_co_submitted",
            payload=notify_payload,
        )

    await audit_log(
        session, auth, "task.co_submit",
        target_type="task", target_id=str(t.id),
        payload={"has_content": bool(body)},
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/co-withdraw", response_model=MyTaskOut)
async def co_withdraw_task(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v22.5 (per Q1): 协办方退出协办.
    - 从 task.co_assignees 数组里移除自己
    - 删除自己的 task_co_progress(若有)
    - 通知主责 task_co_withdrawn
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    co_uids = _co_uuids_of(t)
    if auth.user.id not in co_uids:
        raise HTTPException(403, "您不在该任务的协办列表里")

    # 移除自己
    new_list = [s for s in (t.co_assignees or []) if s != str(auth.user.id)]
    t.co_assignees = new_list if new_list else None

    # 删自己的进度行(若有)
    from sqlalchemy import delete as sql_delete
    await session.execute(
        sql_delete(TaskCoProgress).where(
            TaskCoProgress.task_id == t.id,
            TaskCoProgress.co_assignee_user_id == auth.user.id,
        )
    )

    if t.assignee_user_id and t.assignee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["co_assignee_name"] = auth.user.name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=t.assignee_user_id,
            kind="task_co_withdrawn",
            payload=notify_payload,
        )

    await audit_log(
        session, auth, "task.co_withdraw",
        target_type="task", target_id=str(t.id),
        autocommit=False,
    )
    await session.commit()
    await session.refresh(t)
    return await _task_to_my_out_with_lookup(session, t, await _meeting_title_for(session, t))


@router.post("/tasks/{task_id}/rate")
async def rate_task_collaboration(
    task_id: str,
    payload: RateIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v22.5 (per Q4 双向): 对 Task 上某个相关人打分.

    谁能给谁打:
      - 主责 → 协办们(dimension='collaboration')
      - 协办 → 主责(dimension='collaboration')
      - dispatcher / leader → 主责(dimension='quality')
    score: 1-5;UPSERT 同 (task, rater, ratee, dimension) 唯一.
    每次写都触发 ratee 月度评价重算(真数据覆盖 seed).
    """
    if payload.dimension not in _VALID_DIMENSIONS:
        raise HTTPException(400, f"dimension must be one of {sorted(_VALID_DIMENSIONS)}")
    if not (1 <= payload.score <= 5):
        raise HTTPException(400, "score 必须在 1-5 之间")
    if payload.ratee_user_id == auth.user.id:
        raise HTTPException(400, "不能给自己打分")

    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)
    co_uids = _co_uuids_of(t)
    rater_is_assignee = t.assignee_user_id == auth.user.id
    rater_is_co = auth.user.id in co_uids
    rater_is_dispatcher = t.dispatched_by_user_id == auth.user.id
    rater_is_admin = await is_leader_or_admin(session, auth)

    # 权限矩阵:rater -> 允许 ratee 范围
    allowed_ratees: set[uuid.UUID] = set()
    if rater_is_assignee:
        # 主责给协办打 collaboration
        if payload.dimension == "collaboration":
            allowed_ratees.update(co_uids)
    if rater_is_co:
        # 协办给主责打 collaboration
        if payload.dimension == "collaboration" and t.assignee_user_id:
            allowed_ratees.add(t.assignee_user_id)
    if rater_is_dispatcher or rater_is_admin:
        # dispatcher/admin 给主责打 quality
        if payload.dimension == "quality" and t.assignee_user_id:
            allowed_ratees.add(t.assignee_user_id)
    if payload.ratee_user_id not in allowed_ratees:
        raise HTTPException(
            403,
            f"您没有权限对该用户打 {payload.dimension} 分(角色不匹配)",
        )

    # UPSERT
    existing = (
        await session.execute(
            select(TaskCollaborationRating).where(
                TaskCollaborationRating.task_id == t.id,
                TaskCollaborationRating.rater_user_id == auth.user.id,
                TaskCollaborationRating.ratee_user_id == payload.ratee_user_id,
                TaskCollaborationRating.dimension == payload.dimension,
            )
        )
    ).scalar_one_or_none()
    cmt = (payload.comment or "").strip()[:500] or None
    if existing is not None:
        existing.score = payload.score
        existing.comment = cmt
        existing.created_at = datetime.now(timezone.utc)
    else:
        session.add(
            TaskCollaborationRating(
                task_id=t.id,
                workspace_id=auth.workspace.id,
                rater_user_id=auth.user.id,
                ratee_user_id=payload.ratee_user_id,
                dimension=payload.dimension,
                score=payload.score,
                comment=cmt,
            )
        )

    # 通知 ratee
    if payload.ratee_user_id != auth.user.id:
        notify_payload = _task_to_meeting_payload(t)
        notify_payload["dimension"] = payload.dimension
        notify_payload["score"] = payload.score
        notify_payload["rater_name"] = auth.user.name
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=payload.ratee_user_id,
            kind="task_collaboration_rated",
            payload=notify_payload,
        )

    # 评价重算(只重算被评的人,不动其他人)
    await recompute_user_evaluation(
        session,
        workspace_id=auth.workspace.id,
        user_id=payload.ratee_user_id,
    )

    await audit_log(
        session, auth, "task.rate",
        target_type="task", target_id=str(t.id),
        payload={
            "ratee_user_id": str(payload.ratee_user_id),
            "dimension": payload.dimension,
            "score": payload.score,
        },
        autocommit=False,
    )
    await session.commit()
    return {"ok": True}


# v23.5: 任务详情页一次拉全 ----------------------------------------------------


class TaskTimelineEntry(BaseModel):
    """
    Task 生命周期上的一条事件(由现有时间戳综合出).

    Schema 没有 audit log 表 — 我们只能从 Task 自己的 5 个 timestamp
    + 当前 status 推出时间线;rejected→in_progress→submitted 这种
    来回不会被还原.v24+ 加 TaskAuditLog 表才能精确.
    """
    kind: str  # 'created' | 'dispatched' | 'accepted' | 'started' | 'submitted' | 'done' | 'cancelled' | 'archived'
    at: datetime
    actor_user_id: Optional[uuid.UUID] = None
    actor_name: Optional[str] = None


class TaskCoProgressOut(BaseModel):
    co_assignee_user_id: uuid.UUID
    co_assignee_name: Optional[str] = None
    content: Optional[str] = None
    submitted_at: datetime


class TaskRatingOut(BaseModel):
    id: uuid.UUID
    rater_user_id: uuid.UUID
    rater_name: Optional[str] = None
    ratee_user_id: uuid.UUID
    ratee_name: Optional[str] = None
    dimension: str  # 'quality' | 'collaboration'
    score: int  # 1-5
    comment: Optional[str] = None
    created_at: datetime


class TaskCommentOut(BaseModel):
    """
    会议 action item 评论.Task 详情页顺手把它们带进来,
    避免用户点回会议页才能看到协作历史.
    """
    id: uuid.UUID
    action_item_id: uuid.UUID
    author_user_id: Optional[uuid.UUID] = None
    author_name: Optional[str] = None
    content: str
    created_at: datetime


class TaskDetailOut(MyTaskOut):
    """v23.5 — /task/[id] 页面的唯一数据接口."""
    # 名字预解析(免前端 N+1)
    assignee_name: Optional[str] = None
    dispatched_by_name: Optional[str] = None
    created_by_user_id: Optional[uuid.UUID] = None
    created_by_name: Optional[str] = None
    # uuid 字符串 → name(前端按 co_assignees 顺序渲染)
    co_assignee_names: dict[str, str] = {}
    # 关联数据(都是已按时间排序的 list)
    timeline: list[TaskTimelineEntry] = []
    co_progress: list[TaskCoProgressOut] = []
    ratings: list[TaskRatingOut] = []
    comments: list[TaskCommentOut] = []


@router.get("/tasks/{task_id}/detail", response_model=TaskDetailOut)
async def get_task_detail(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v23.5: Task 详情页一次拉全 — 基本+时间线+协办+评分+评论.

    谁能看:
      - 相关人(assignee / dispatcher / creator / co_assignee)→ 直接放行
      - 其他人 → 走 access_control.can_access(分级 + leader/admin / grant)

    设计哲学:这是 /task/[id] 页面的唯一数据接口.前端拿到就能渲染整页,
    避免 5+ 次串行请求(用户体感慢).批量解析所有 user_id → name,
    确保渲染时不需要二次请求.
    """
    t = await _load_task_in_workspace(session, task_id, auth.workspace.id)

    # ---- 权限 ----
    co_uids = _co_uuids_of(t)
    is_principal = (
        t.assignee_user_id == auth.user.id
        or t.dispatched_by_user_id == auth.user.id
        or t.created_by_user_id == auth.user.id
        or auth.user.id in co_uids
    )
    if not is_principal:
        await can_access_or_raise(
            session,
            auth,
            resource_type="task",
            resource_id=t.id,
            classification=t.data_classification or "general",
            owner_user_id=t.assignee_user_id,
        )

    # ---- 收集所有需要解析名字的 user id(批量取一次) ----
    user_ids: set[uuid.UUID] = set()
    if t.assignee_user_id:
        user_ids.add(t.assignee_user_id)
    if t.dispatched_by_user_id:
        user_ids.add(t.dispatched_by_user_id)
    if t.created_by_user_id:
        user_ids.add(t.created_by_user_id)
    user_ids.update(co_uids)

    # ---- co_progress ----
    cp_rows = (
        await session.execute(
            select(TaskCoProgress)
            .where(TaskCoProgress.task_id == t.id)
            .order_by(TaskCoProgress.submitted_at.desc())
        )
    ).scalars().all()
    for cp in cp_rows:
        user_ids.add(cp.co_assignee_user_id)

    # ---- ratings ----
    rating_rows = (
        await session.execute(
            select(TaskCollaborationRating)
            .where(TaskCollaborationRating.task_id == t.id)
            .order_by(TaskCollaborationRating.created_at.desc())
        )
    ).scalars().all()
    for r in rating_rows:
        user_ids.add(r.rater_user_id)
        user_ids.add(r.ratee_user_id)

    # ---- comments(通过 MeetingActionItem.task_id == t.id 反查) ----
    # 注意:task_id 是 ActionItem 上的 FK,反向找它的 comments.
    # 非 meeting 起源的 Task 自然 0 条 comment.
    comment_rows: list[MeetingActionItemComment] = []
    ai_id = (
        await session.execute(
            select(MeetingActionItem.id)
            .where(MeetingActionItem.task_id == t.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if ai_id:
        comment_rows = (
            await session.execute(
                select(MeetingActionItemComment)
                .where(MeetingActionItemComment.action_item_id == ai_id)
                .order_by(MeetingActionItemComment.created_at)
            )
        ).scalars().all()
        for c in comment_rows:
            if c.author_user_id:
                user_ids.add(c.author_user_id)

    # ---- 批量取所有 user 名字 ----
    name_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        urows = (
            await session.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {u_id: u_name for u_id, u_name in urows}

    # ---- 拼时间线 ----
    timeline: list[TaskTimelineEntry] = [
        TaskTimelineEntry(
            kind="created",
            at=t.created_at,
            actor_user_id=t.created_by_user_id,
            actor_name=name_by_id.get(t.created_by_user_id) if t.created_by_user_id else None,
        )
    ]
    if t.dispatched_at:
        timeline.append(
            TaskTimelineEntry(
                kind="dispatched",
                at=t.dispatched_at,
                actor_user_id=t.dispatched_by_user_id,
                actor_name=name_by_id.get(t.dispatched_by_user_id) if t.dispatched_by_user_id else None,
            )
        )
    if t.accepted_at:
        timeline.append(
            TaskTimelineEntry(
                kind="accepted",
                at=t.accepted_at,
                actor_user_id=t.assignee_user_id,
                actor_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
            )
        )
    if t.started_at:
        timeline.append(
            TaskTimelineEntry(
                kind="started",
                at=t.started_at,
                actor_user_id=t.assignee_user_id,
                actor_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
            )
        )
    # 终态:模型只有 updated_at,不够精确(reject 后再 submit 会覆盖).
    # v23.5 接受这个简化 — 评论 + 协办交付 + 评分能补上下文.
    if t.status in ("submitted", "done", "archived", "cancelled"):
        actor_id: Optional[uuid.UUID] = None
        actor_name: Optional[str] = None
        if t.status == "submitted":
            # submit 必由主责发起
            actor_id = t.assignee_user_id
            actor_name = name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None
        # done/archived/cancelled 可能多种角色发起,留空让前端 fallback「系统」
        timeline.append(
            TaskTimelineEntry(
                kind=t.status,
                at=t.updated_at,
                actor_user_id=actor_id,
                actor_name=actor_name,
            )
        )
    timeline.sort(key=lambda e: e.at)

    # ---- 协办进度 out ----
    cp_out = [
        TaskCoProgressOut(
            co_assignee_user_id=cp.co_assignee_user_id,
            co_assignee_name=name_by_id.get(cp.co_assignee_user_id),
            content=cp.content,
            submitted_at=cp.submitted_at,
        )
        for cp in cp_rows
    ]

    # ---- ratings out ----
    rating_out = [
        TaskRatingOut(
            id=r.id,
            rater_user_id=r.rater_user_id,
            rater_name=name_by_id.get(r.rater_user_id),
            ratee_user_id=r.ratee_user_id,
            ratee_name=name_by_id.get(r.ratee_user_id),
            dimension=r.dimension,
            score=r.score,
            comment=r.comment,
            created_at=r.created_at,
        )
        for r in rating_rows
    ]

    # ---- comments out ----
    comment_out = [
        TaskCommentOut(
            id=c.id,
            action_item_id=c.action_item_id,
            author_user_id=c.author_user_id,
            author_name=name_by_id.get(c.author_user_id) if c.author_user_id else None,
            content=c.content,
            created_at=c.created_at,
        )
        for c in comment_rows
    ]

    # ---- 协办 user_id → name 字典 ----
    co_assignee_names: dict[str, str] = {}
    for cu in co_uids:
        nm = name_by_id.get(cu)
        if nm:
            co_assignee_names[str(cu)] = nm

    # ---- 复用 _task_to_my_out 拼基础部分,然后扩展 ----
    co_submitted_uids = [cp.co_assignee_user_id for cp in cp_rows]
    meeting_pair = await _meeting_title_for(session, t)
    base = _task_to_my_out(t, meeting_pair, co_submitted=co_submitted_uids)

    return TaskDetailOut(
        **base.model_dump(),
        assignee_name=name_by_id.get(t.assignee_user_id) if t.assignee_user_id else None,
        dispatched_by_name=name_by_id.get(t.dispatched_by_user_id) if t.dispatched_by_user_id else None,
        created_by_user_id=t.created_by_user_id,
        created_by_name=name_by_id.get(t.created_by_user_id) if t.created_by_user_id else None,
        co_assignee_names=co_assignee_names,
        timeline=timeline,
        co_progress=cp_out,
        ratings=rating_out,
        comments=comment_out,
    )


# v24.1 #2: 问题上报 触发源 ---------------------------------------------------
#
# 智慧住建文档 §4.1 触发源 6:用户/AI 主动上报「我看到一个问题,请处理」.
# 任何 workspace member 都可以发起,直接生成一个 source_type='report' 的
# Task(status='open',待 leader 派发).审核流留 v25(D 级目前用「leader
# 觉得不靠谱直接 cancel」兜底).
#
# 通知所有 leader/admin/owner,kind='report_submitted'(severity 跟随
# 用户选的 severity 字段:high → red / medium → yellow / low → normal).


_REPORT_SEVERITY_TO_NOTI: dict[str, str] = {
    "low": "normal",
    "medium": "yellow",
    "high": "red",
}


class ReportCreateIn(BaseModel):
    title: Optional[str] = None  # 可选;不填则取 content 前 40 字
    content: str
    severity: str = "medium"  # low | medium | high
    # 可选:这个问题源自哪场会议(让 trace 链路完整)
    source_meeting_id: Optional[uuid.UUID] = None


class ReportCreateOut(BaseModel):
    task_id: uuid.UUID
    notified_leaders: int


@router.post("/reports", response_model=ReportCreateOut)
async def create_report(
    payload: ReportCreateIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.1 #2: 用户主动上报问题 → Task(source_type='report').

    任何 workspace 成员可发起.创建出来的 Task assignee 留空 (status='open'),
    等 leader/admin 在「待我审核 / 待派发」队列里派发给具体 AI 专家或人.

    severity:
      - low    → 通知 normal
      - medium → 通知 yellow
      - high   → 通知 red
    """
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(400, "content required")
    if len(content) < 5:
        # 同前端 ReportPanel 校验:<5 字一般是误操作 / 噪声上报
        raise HTTPException(400, "content too short (min 5 chars)")
    if len(content) > 2000:
        raise HTTPException(400, "content too long (max 2000 chars)")
    if payload.severity not in _REPORT_SEVERITY_TO_NOTI:
        raise HTTPException(
            400,
            f"severity must be one of {sorted(_REPORT_SEVERITY_TO_NOTI.keys())}",
        )

    # 校验 source_meeting_id(若有)同 workspace
    if payload.source_meeting_id:
        m = (
            await session.execute(
                select(Meeting).where(
                    Meeting.id == payload.source_meeting_id,
                    Meeting.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not m:
            raise HTTPException(400, "source_meeting_id 不在本工作空间")

    title = (payload.title or "").strip()[:255] or content[:40]

    source_ref: dict = {
        "reporter_user_id": str(auth.user.id),
        "reporter_name": auth.user.name,
        "severity": payload.severity,
    }
    if payload.source_meeting_id:
        source_ref["meeting_id"] = str(payload.source_meeting_id)

    new_task = Task(
        workspace_id=auth.workspace.id,
        title=title,
        content=content,
        assignee_user_id=None,  # 待 leader 派发
        created_by_user_id=auth.user.id,
        status="open",
        source_type="report",
        source_ref=source_ref,
    )
    session.add(new_task)
    await session.flush()

    # 通知所有 leader/admin/owner(收件方在 workspace_membership 里 role 命中)
    leader_rows = (
        await session.execute(
            select(WorkspaceMembership.user_id).where(
                WorkspaceMembership.workspace_id == auth.workspace.id,
                WorkspaceMembership.role.in_(("owner", "admin", "leader")),
            )
        )
    ).all()
    leader_ids = [r[0] for r in leader_rows if r[0] != auth.user.id]
    severity = _REPORT_SEVERITY_TO_NOTI[payload.severity]
    for lid in leader_ids:
        await emit_notification(
            session,
            workspace_id=auth.workspace.id,
            user_id=lid,
            kind="report_submitted",
            severity=severity,
            payload={
                "task_id": str(new_task.id),
                "title": title,
                "severity": payload.severity,
                "reporter_name": auth.user.name,
                "preview": content[:120] + ("…" if len(content) > 120 else ""),
            },
        )

    await audit_log(
        session, auth, "report.create",
        target_type="task", target_id=str(new_task.id),
        payload={
            "severity": payload.severity,
            "notified_leaders": len(leader_ids),
            "source_meeting_id": str(payload.source_meeting_id) if payload.source_meeting_id else None,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(new_task)
    return ReportCreateOut(
        task_id=new_task.id,
        notified_leaders=len(leader_ids),
    )


# v19: 领导指令(自然语言 → Task 拆解)----------------------------------------


class DirectiveCreateIn(BaseModel):
    content: str


class DirectiveDraftOut(BaseModel):
    content: str
    title: Optional[str] = None
    assignee_name: Optional[str] = None
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[str] = None  # ISO date string


class DirectiveOut(BaseModel):
    id: uuid.UUID
    content: str
    status: str  # draft | committed | discarded
    drafts: list[DirectiveDraftOut]
    committed_task_ids: list[uuid.UUID] = []
    parse_error: Optional[str] = None
    created_at: datetime


def _drafts_from_payload(p: Optional[list]) -> list[DirectiveDraftOut]:
    out: list[DirectiveDraftOut] = []
    if not isinstance(p, list):
        return out
    for d in p:
        if not isinstance(d, dict):
            continue
        try:
            uid_raw = d.get("assignee_user_id")
            uid = uuid.UUID(uid_raw) if isinstance(uid_raw, str) else None
        except ValueError:
            uid = None
        out.append(
            DirectiveDraftOut(
                content=str(d.get("content") or ""),
                title=d.get("title"),
                assignee_name=d.get("assignee_name"),
                assignee_user_id=uid,
                due_at=d.get("due_at"),
            )
        )
    return out


def _directive_to_out(row: LeaderDirective) -> DirectiveOut:
    raw_ids = row.committed_task_ids or []
    ids: list[uuid.UUID] = []
    for s in raw_ids:
        try:
            ids.append(uuid.UUID(s))
        except (TypeError, ValueError):
            continue
    return DirectiveOut(
        id=row.id,
        content=row.content,
        status=row.status,
        drafts=_drafts_from_payload(row.parsed_drafts),
        committed_task_ids=ids,
        parse_error=row.parse_error,
        created_at=row.created_at,
    )


@router.post("/directives", response_model=DirectiveOut)
async def create_directive(
    payload: DirectiveCreateIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: 创建一条领导指令,**同步**触发 LLM 拆解,返回 draft 列表.

    实测 5-15s. 若 LLM 失败,row 仍写入(status='draft', parse_error=...),
    用户可基于错误信息调整文本后重试(下一次创建是新 row).
    """
    text = (payload.content or "").strip()
    if not text:
        raise HTTPException(400, "content required")
    if len(text) > 4000:
        raise HTTPException(400, "content too long (max 4000 chars)")

    # v24.4 #1: LLM 配额
    await check_quota_or_raise(auth.user.id, auth.workspace.id)

    drafts, err = await parse_directive(
        session, workspace_id=auth.workspace.id, content=text
    )
    row = LeaderDirective(
        workspace_id=auth.workspace.id,
        created_by_user_id=auth.user.id,
        content=text[:4000],
        parsed_drafts=drafts,
        status="draft",
        parse_error=err,
    )
    session.add(row)
    await session.flush()
    await audit_log(
        session, auth, "directive.create",
        target_type="leader_directive", target_id=str(row.id),
        payload={
            "draft_count": len(drafts) if drafts else 0,
            "parse_error": err is not None,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(row)
    return _directive_to_out(row)


class DirectiveCommitTaskIn(BaseModel):
    content: str
    title: Optional[str] = None
    assignee_user_id: Optional[uuid.UUID] = None
    due_at: Optional[datetime] = None
    dispatch: bool = False  # if True + assignee set, transition to dispatched immediately
    # v22.5: 一并选协办(只在 dispatch=true 时生效;最多 5 个;不能含主责)
    co_assignees: Optional[list[uuid.UUID]] = None


class DirectiveCommitIn(BaseModel):
    tasks: list[DirectiveCommitTaskIn]


class DirectiveCommitOut(BaseModel):
    directive_id: uuid.UUID
    committed_task_ids: list[uuid.UUID]
    dispatched_count: int


@router.post(
    "/directives/{directive_id}/commit", response_model=DirectiveCommitOut
)
async def commit_directive(
    directive_id: str,
    payload: DirectiveCommitIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v19: 把 draft 列表中用户确认的部分批量入库为 Task.
    每条 task 可选 `dispatch=true` 直接走 open → dispatched 转换 + 通知 assignee.
    """
    try:
        did = uuid.UUID(directive_id)
    except ValueError:
        raise HTTPException(400, "invalid directive id")
    row = (
        await session.execute(
            select(LeaderDirective).where(
                LeaderDirective.id == did,
                LeaderDirective.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "directive not found")
    if row.status == "committed":
        raise HTTPException(409, "directive already committed")
    if row.status == "discarded":
        raise HTTPException(409, "directive was discarded")
    if not payload.tasks:
        raise HTTPException(400, "no tasks to commit")

    now = datetime.now(timezone.utc)
    committed_ids: list[uuid.UUID] = []
    dispatched_count = 0

    # Validate assignees up-front (single workspace check).
    assignee_ids = {
        t.assignee_user_id for t in payload.tasks if t.assignee_user_id
    }
    if assignee_ids:
        valid = (
            await session.execute(
                select(User.id).where(
                    User.id.in_(assignee_ids),
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).all()
        valid_set = {v[0] for v in valid}
        missing = assignee_ids - valid_set
        if missing:
            raise HTTPException(
                400,
                f"assignee_user_id(s) not in workspace: {', '.join(str(x) for x in missing)}",
            )

    for tspec in payload.tasks:
        c = (tspec.content or "").strip()
        if not c:
            continue
        # Default 'open'; if dispatch+assignee, jump to dispatched.
        wants_dispatch = tspec.dispatch and tspec.assignee_user_id is not None

        # v22.5: 协办列表(只在 dispatch 时启用 + 验证)
        co_uuids: list[uuid.UUID] = []
        if wants_dispatch and tspec.co_assignees:
            if len(tspec.co_assignees) > _MAX_CO_ASSIGNEES:
                raise HTTPException(
                    400, f"协办最多 {_MAX_CO_ASSIGNEES} 人"
                )
            seen: set[uuid.UUID] = set()
            for cid in tspec.co_assignees:
                if cid == tspec.assignee_user_id:
                    raise HTTPException(400, "协办不能包含主责自己")
                if cid in seen:
                    continue
                seen.add(cid)
                co_uuids.append(cid)
            # workspace 校验:tspec.co_assignees 是 v22.5 新加,不在前文的批量
            # validation 里;这里单独验证
            valid = (
                await session.execute(
                    select(User.id).where(
                        User.id.in_(co_uuids),
                        User.workspace_id == auth.workspace.id,
                    )
                )
            ).all()
            valid_set = {v[0] for v in valid}
            missing = set(co_uuids) - valid_set
            if missing:
                raise HTTPException(
                    400,
                    f"co_assignee 不在本工作空间:{', '.join(str(x) for x in missing)}",
                )

        new_task = Task(
            workspace_id=auth.workspace.id,
            title=(tspec.title.strip()[:255] if tspec.title else None) or None,
            content=c[:1000],
            assignee_user_id=tspec.assignee_user_id,
            created_by_user_id=auth.user.id,
            due_at=tspec.due_at,
            status="dispatched" if wants_dispatch else "open",
            source_type="leader_directive",
            source_ref={"directive_id": str(row.id)},
            co_assignees=[str(x) for x in co_uuids] if co_uuids else None,
        )
        if wants_dispatch:
            new_task.dispatched_at = now
            new_task.dispatched_by_user_id = auth.user.id
        session.add(new_task)
        await session.flush()
        committed_ids.append(new_task.id)

        if wants_dispatch and tspec.assignee_user_id != auth.user.id:
            notify_payload = {
                "task_id": str(new_task.id),
                "content": new_task.content,
                "due_at": new_task.due_at.isoformat() if new_task.due_at else None,
                "dispatched_by": auth.user.name,
                "directive_id": str(row.id),
            }
            if co_uuids:
                notify_payload["co_assignees_count"] = len(co_uuids)
            await emit_notification(
                session,
                workspace_id=auth.workspace.id,
                user_id=tspec.assignee_user_id,
                kind="task_dispatched",
                payload=notify_payload,
            )
            dispatched_count += 1

        # v22.5: 通知所有协办
        for co_uid in co_uuids:
            if co_uid == auth.user.id:
                continue
            await emit_notification(
                session,
                workspace_id=auth.workspace.id,
                user_id=co_uid,
                kind="task_co_assigned",
                payload={
                    "task_id": str(new_task.id),
                    "content": new_task.content,
                    "due_at": new_task.due_at.isoformat() if new_task.due_at else None,
                    "dispatched_by": auth.user.name,
                    "directive_id": str(row.id),
                    "coordinator_user_id": str(tspec.assignee_user_id) if tspec.assignee_user_id else None,
                },
            )

    row.status = "committed"
    row.committed_task_ids = [str(x) for x in committed_ids]
    await audit_log(
        session, auth, "directive.commit",
        target_type="leader_directive", target_id=str(row.id),
        payload={
            "task_count": len(committed_ids),
            "dispatched_count": dispatched_count,
        },
        autocommit=False,
    )
    await session.commit()

    return DirectiveCommitOut(
        directive_id=row.id,
        committed_task_ids=committed_ids,
        dispatched_count=dispatched_count,
    )


@router.post("/directives/{directive_id}/discard", status_code=204)
async def discard_directive(
    directive_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v19: 丢弃一条未提交的指令(只改状态,不删除行,留 audit)."""
    try:
        did = uuid.UUID(directive_id)
    except ValueError:
        raise HTTPException(400, "invalid directive id")
    row = (
        await session.execute(
            select(LeaderDirective).where(
                LeaderDirective.id == did,
                LeaderDirective.workspace_id == auth.workspace.id,
                LeaderDirective.created_by_user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "directive not found")
    if row.status != "draft":
        raise HTTPException(409, f"cannot discard a {row.status} directive")
    row.status = "discarded"
    await audit_log(
        session, auth, "directive.discard",
        target_type="leader_directive", target_id=str(row.id),
        autocommit=False,
    )
    await session.commit()


@router.get("/directives", response_model=list[DirectiveOut])
async def list_my_directives(
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v19: 当前用户最近的指令列表(history,默认 20 条)."""
    rows = (
        await session.execute(
            select(LeaderDirective)
            .where(
                LeaderDirective.workspace_id == auth.workspace.id,
                LeaderDirective.created_by_user_id == auth.user.id,
            )
            .order_by(LeaderDirective.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [_directive_to_out(r) for r in rows]


# v20: 上级文件触发源 -------------------------------------------------------

# Hard cap on extracted text length sent to the LLM. 上级文件可能很长(20+ 页),
# 但 LLM context + 拆解准确率随 token 增加而下降。20K 字符约 7-10K token,
# 对 Qwen-Plus 等模型友好,且足以覆盖大多数政务文件首部 + 主体。
_UPPER_DOC_MAX_PARSE_CHARS = 20_000
# 上传文件大小上限。10MB 应对大多数 PDF;PDF 是文本 + 矢量图,通常 <5MB。
_UPPER_DOC_MAX_BYTES = 10 * 1024 * 1024


class UpperDocOut(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: Optional[str] = None
    byte_size: Optional[int] = None
    extracted_text_preview: Optional[str] = None  # 前 500 字预览,UI 用于让用户确认抽对了
    extracted_text_truncated: bool = False
    status: str
    drafts: list[DirectiveDraftOut]
    committed_task_ids: list[uuid.UUID] = []
    parse_error: Optional[str] = None
    created_at: datetime


def _upper_doc_to_out(row: UpperDoc) -> UpperDocOut:
    raw_ids = row.committed_task_ids or []
    ids: list[uuid.UUID] = []
    for s in raw_ids:
        try:
            ids.append(uuid.UUID(s))
        except (TypeError, ValueError):
            continue
    text_preview: Optional[str] = None
    truncated = False
    if row.extracted_text:
        text_preview = row.extracted_text[:500]
        truncated = len(row.extracted_text) > 500
    return UpperDocOut(
        id=row.id,
        filename=row.filename,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        extracted_text_preview=text_preview,
        extracted_text_truncated=truncated,
        status=row.status,
        drafts=_drafts_from_payload(row.parsed_drafts),
        committed_task_ids=ids,
        parse_error=row.parse_error,
        created_at=row.created_at,
    )


@router.post("/upper-docs", response_model=UpperDocOut)
async def create_upper_doc(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v20: 上传上级文件 → 文本提取 → LLM 拆解 → 返回 draft.

    文件不入 OSS / 不入知识库:本接口只是个一次性「文件 → 任务」转换器.
    若需长期 KB 召回,走独立的 KB 上传路径.

    v25-2 支持文件类型:PDF(含扫描件 OCR fallback) / DOCX / XLSX /
    TXT / MD / CSV / JSON / YAML / 图片(JPG/PNG/BMP/TIFF/WebP/GIF — Qwen-VL OCR).
    """
    if not file.filename:
        raise HTTPException(400, "filename required")
    kind = kind_from_filename(file.filename)
    if kind is None:
        raise HTTPException(
            400,
            "unsupported file type. allowed: PDF / DOCX / XLSX / TXT / MD / CSV / JSON / YAML / 图片(JPG/PNG/BMP/TIFF/WebP/GIF)",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > _UPPER_DOC_MAX_BYTES:
        raise HTTPException(
            413, f"file too large ({len(raw)} bytes); max {_UPPER_DOC_MAX_BYTES}"
        )

    # 1) 抽文本(v25-2: async + OCR fallback for 扫描件 PDF / 图片)
    extracted = ""
    parse_err: Optional[str] = None
    try:
        extracted = (await extract_text_async(file.filename, raw)).strip()
    except Exception as exc:  # 解析失败仍写入 row + parse_error,便于用户看到失败原因
        parse_err = f"文件解析失败: {exc}"
    if not parse_err and not extracted:
        parse_err = "文件无可提取的文字内容"

    # 2) LLM 拆解(只拿截断后的文本)
    drafts: list[dict[str, Any]] = []
    if not parse_err:
        # v24.4 #1: LLM 配额(放在 LLM 调用前;解析失败的不算配额)
        await check_quota_or_raise(auth.user.id, auth.workspace.id)
        send_text = extracted[:_UPPER_DOC_MAX_PARSE_CHARS]
        drafts, llm_err = await parse_directive(
            session, workspace_id=auth.workspace.id, content=send_text
        )
        if llm_err:
            parse_err = llm_err

    # 3) 落库
    row = UpperDoc(
        workspace_id=auth.workspace.id,
        created_by_user_id=auth.user.id,
        filename=file.filename[:255],
        mime_type=file.content_type,
        byte_size=len(raw),
        extracted_text=extracted[: _UPPER_DOC_MAX_PARSE_CHARS] if extracted else None,
        parsed_drafts=drafts,
        status="failed" if parse_err and not drafts else "draft",
        parse_error=parse_err,
    )
    session.add(row)
    await session.flush()
    await audit_log(
        session, auth, "upper_doc.create",
        target_type="upper_doc", target_id=str(row.id),
        payload={
            "filename": row.filename,
            "byte_size": row.byte_size,
            "draft_count": len(drafts) if drafts else 0,
            "parse_error": parse_err is not None,
        },
        autocommit=False,
    )
    await session.commit()
    await session.refresh(row)
    return _upper_doc_to_out(row)


@router.post(
    "/upper-docs/{upper_doc_id}/commit", response_model=DirectiveCommitOut
)
async def commit_upper_doc(
    upper_doc_id: str,
    payload: DirectiveCommitIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v20: 把上级文件拆出的草稿批量入库为 Task(source_type='upper_doc')."""
    try:
        did = uuid.UUID(upper_doc_id)
    except ValueError:
        raise HTTPException(400, "invalid upper_doc id")
    row = (
        await session.execute(
            select(UpperDoc).where(
                UpperDoc.id == did,
                UpperDoc.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "upper_doc not found")
    if row.status == "committed":
        raise HTTPException(409, "already committed")
    if row.status in ("discarded", "failed"):
        raise HTTPException(409, f"cannot commit a {row.status} upper_doc")
    if not payload.tasks:
        raise HTTPException(400, "no tasks to commit")

    # 复用 directives 的 assignee 校验逻辑
    assignee_ids = {t.assignee_user_id for t in payload.tasks if t.assignee_user_id}
    if assignee_ids:
        valid = (
            await session.execute(
                select(User.id).where(
                    User.id.in_(assignee_ids),
                    User.workspace_id == auth.workspace.id,
                )
            )
        ).all()
        valid_set = {v[0] for v in valid}
        missing = assignee_ids - valid_set
        if missing:
            raise HTTPException(
                400, f"assignee_user_id(s) not in workspace: {', '.join(str(x) for x in missing)}"
            )

    now = datetime.now(timezone.utc)
    committed_ids: list[uuid.UUID] = []
    dispatched_count = 0

    for tspec in payload.tasks:
        c = (tspec.content or "").strip()
        if not c:
            continue
        wants_dispatch = tspec.dispatch and tspec.assignee_user_id is not None
        new_task = Task(
            workspace_id=auth.workspace.id,
            title=(tspec.title.strip()[:255] if tspec.title else None) or None,
            content=c[:1000],
            assignee_user_id=tspec.assignee_user_id,
            created_by_user_id=auth.user.id,
            due_at=tspec.due_at,
            status="dispatched" if wants_dispatch else "open",
            source_type="upper_doc",
            source_ref={
                "upper_doc_id": str(row.id),
                "filename": row.filename,
            },
        )
        if wants_dispatch:
            new_task.dispatched_at = now
            new_task.dispatched_by_user_id = auth.user.id
        session.add(new_task)
        await session.flush()
        committed_ids.append(new_task.id)

        if wants_dispatch and tspec.assignee_user_id != auth.user.id:
            await emit_notification(
                session,
                workspace_id=auth.workspace.id,
                user_id=tspec.assignee_user_id,
                kind="task_dispatched",
                payload={
                    "task_id": str(new_task.id),
                    "content": new_task.content,
                    "due_at": new_task.due_at.isoformat() if new_task.due_at else None,
                    "dispatched_by": auth.user.name,
                    "upper_doc_id": str(row.id),
                    "filename": row.filename,
                },
            )
            dispatched_count += 1

    row.status = "committed"
    row.committed_task_ids = [str(x) for x in committed_ids]
    await audit_log(
        session, auth, "upper_doc.commit",
        target_type="upper_doc", target_id=str(row.id),
        payload={
            "task_count": len(committed_ids),
            "dispatched_count": dispatched_count,
        },
        autocommit=False,
    )
    await session.commit()

    return DirectiveCommitOut(
        directive_id=row.id,
        committed_task_ids=committed_ids,
        dispatched_count=dispatched_count,
    )


@router.post("/upper-docs/{upper_doc_id}/discard", status_code=204)
async def discard_upper_doc(
    upper_doc_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    try:
        did = uuid.UUID(upper_doc_id)
    except ValueError:
        raise HTTPException(400, "invalid upper_doc id")
    row = (
        await session.execute(
            select(UpperDoc).where(
                UpperDoc.id == did,
                UpperDoc.workspace_id == auth.workspace.id,
                UpperDoc.created_by_user_id == auth.user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "upper_doc not found")
    if row.status not in ("draft", "failed"):
        raise HTTPException(409, f"cannot discard a {row.status} upper_doc")
    row.status = "discarded"
    await audit_log(
        session, auth, "upper_doc.discard",
        target_type="upper_doc", target_id=str(row.id),
        autocommit=False,
    )
    await session.commit()


@router.get("/upper-docs", response_model=list[UpperDocOut])
async def list_my_upper_docs(
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(UpperDoc)
            .where(
                UpperDoc.workspace_id == auth.workspace.id,
                UpperDoc.created_by_user_id == auth.user.id,
            )
            .order_by(UpperDoc.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [_upper_doc_to_out(r) for r in rows]


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


async def _co_submitted_for(
    session: AsyncSession, task_id: uuid.UUID
) -> list[uuid.UUID]:
    """返回该 Task 已 co-submit 的协办 user id 列表."""
    rows = (
        await session.execute(
            select(TaskCoProgress.co_assignee_user_id).where(
                TaskCoProgress.task_id == task_id
            )
        )
    ).all()
    return [r[0] for r in rows]


def _parse_co_assignees(t: Task) -> list[uuid.UUID]:
    out: list[uuid.UUID] = []
    if not t.co_assignees:
        return out
    for s in t.co_assignees:
        try:
            out.append(uuid.UUID(s))
        except (TypeError, ValueError):
            continue
    return out


async def _task_to_my_out_with_lookup(
    session: AsyncSession,
    t: Task,
    meeting_pair: Optional[tuple[uuid.UUID, str]],
) -> MyTaskOut:
    """
    Convenience for single-task endpoints (state-machine transitions etc.)
    that always want full hydration including co_submitted_user_ids.
    """
    co_submitted = (
        await _co_submitted_for(session, t.id) if t.co_assignees else []
    )
    return _task_to_my_out(t, meeting_pair, co_submitted=co_submitted)


def _task_to_my_out(
    t: Task,
    meeting_pair: Optional[tuple[uuid.UUID, str]],
    co_submitted: Optional[list[uuid.UUID]] = None,
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
        data_classification=t.data_classification or "general",
        co_assignees=_parse_co_assignees(t),
        co_submitted_user_ids=co_submitted or [],
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


# --------- v24.4 #1: LLM rate limit 自检 / 测试入口 -------------------------


class LlmQuotaStatusOut(BaseModel):
    user_used: int
    user_limit: int
    workspace_used: int
    workspace_limit: int
    window_seconds: int


@router.get("/llm-quota/status", response_model=LlmQuotaStatusOut)
async def llm_quota_status(
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.4 #1: 当前用户 + workspace 的 LLM 配额使用.调试 / 前端提示用.

    不消耗配额(只读).
    """
    from ..llm_quota import get_quota_status

    status = get_quota_status(auth.user.id, auth.workspace.id)
    return LlmQuotaStatusOut(**status)


@router.post("/llm-quota/check", response_model=LlmQuotaStatusOut)
async def llm_quota_check(
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v24.4 #1: 主动消耗一格配额(用 LLM 前 dry-run / Cowork 用例 burn 测试).

    超限直接 429.成功返回新的 status.
    """
    from ..llm_quota import check_quota_or_raise, get_quota_status

    await check_quota_or_raise(auth.user.id, auth.workspace.id)
    status = get_quota_status(auth.user.id, auth.workspace.id)
    return LlmQuotaStatusOut(**status)
