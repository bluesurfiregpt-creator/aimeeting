"""
v20 — 定期巡检触发源 CRUD 接口.

设计思路:
- workspace 级实体(不绑定到具体 user),所以挂在 /api/cron-rules 而不是 /api/me/...
- 任何 workspace member 都能 CRUD(v20 简化,v21+ 收紧到 admin)
- `force-fire` 端点供测试使用 — 立即 instantiate 一个 Task,绕过 cron 表达式判断
- 删除规则不删除已生成的 Task(那些已经是独立的工单)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..cron_runner import _matches, fire_rule
from ..db import get_session
from ..models import CronRule, User

router = APIRouter(prefix="/api/cron-rules", tags=["cron-rules"])


class CronRuleOut(BaseModel):
    id: uuid.UUID
    name: str
    cron_expr: str
    task_template_content: str
    task_template_title: Optional[str] = None
    task_template_assignee_user_id: Optional[uuid.UUID] = None
    auto_dispatch: bool
    due_days_after: Optional[int] = None
    is_active: bool
    last_fired_at: Optional[datetime] = None
    fire_count: int
    created_at: datetime


class CronRuleIn(BaseModel):
    name: str
    cron_expr: str
    task_template_content: str
    task_template_title: Optional[str] = None
    task_template_assignee_user_id: Optional[uuid.UUID] = None
    auto_dispatch: bool = False
    due_days_after: Optional[int] = None  # 1-365 days, or None for no due_at
    is_active: bool = True


class CronRulePatch(BaseModel):
    name: Optional[str] = None
    cron_expr: Optional[str] = None
    task_template_content: Optional[str] = None
    task_template_title: Optional[str] = None
    task_template_assignee_user_id: Optional[uuid.UUID] = None
    auto_dispatch: Optional[bool] = None
    due_days_after: Optional[int] = None
    is_active: Optional[bool] = None


def _to_out(r: CronRule) -> CronRuleOut:
    return CronRuleOut(
        id=r.id,
        name=r.name,
        cron_expr=r.cron_expr,
        task_template_content=r.task_template_content,
        task_template_title=r.task_template_title,
        task_template_assignee_user_id=r.task_template_assignee_user_id,
        auto_dispatch=r.auto_dispatch,
        due_days_after=r.due_days_after,
        is_active=r.is_active,
        last_fired_at=r.last_fired_at,
        fire_count=r.fire_count or 0,
        created_at=r.created_at,
    )


def _validate_cron_expr(expr: str) -> None:
    """Reuse cron_runner._matches against a known time as a smoke test —
    if the parser would reject the expression, _matches returns False
    consistently. We just check that it doesn't blow up + has 5 segments."""
    parts = (expr or "").strip().split()
    if len(parts) != 5:
        raise HTTPException(400, "cron_expr 必须是 5 段(分 时 日 月 周)")
    try:
        # Sample call against a fixed time;不在乎 True/False,只看会不会 raise
        _matches(expr, datetime(2026, 1, 1, 0, 0, tzinfo=None))
    except Exception as exc:
        raise HTTPException(400, f"cron_expr 解析失败: {exc}")


async def _validate_assignee(
    session: AsyncSession, uid: Optional[uuid.UUID], workspace_id: uuid.UUID
) -> None:
    if uid is None:
        return
    u = (
        await session.execute(
            select(User).where(User.id == uid, User.workspace_id == workspace_id)
        )
    ).scalar_one_or_none()
    if not u:
        raise HTTPException(400, "task_template_assignee_user_id not in this workspace")


@router.get("", response_model=list[CronRuleOut])
async def list_cron_rules(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(CronRule)
            .where(CronRule.workspace_id == auth.workspace.id)
            .order_by(CronRule.created_at.desc())
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=CronRuleOut)
async def create_cron_rule(
    payload: CronRuleIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    if not payload.name.strip() or not payload.cron_expr.strip():
        raise HTTPException(400, "name + cron_expr required")
    if not payload.task_template_content.strip():
        raise HTTPException(400, "task_template_content required")
    _validate_cron_expr(payload.cron_expr)
    await _validate_assignee(session, payload.task_template_assignee_user_id, auth.workspace.id)
    if payload.due_days_after is not None and not (1 <= payload.due_days_after <= 365):
        raise HTTPException(400, "due_days_after 必须在 1-365 之间")
    row = CronRule(
        workspace_id=auth.workspace.id,
        created_by_user_id=auth.user.id,
        name=payload.name.strip()[:128],
        cron_expr=payload.cron_expr.strip()[:64],
        task_template_content=payload.task_template_content.strip(),
        task_template_title=(payload.task_template_title or "").strip()[:255] or None,
        task_template_assignee_user_id=payload.task_template_assignee_user_id,
        auto_dispatch=payload.auto_dispatch,
        due_days_after=payload.due_days_after,
        is_active=payload.is_active,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.patch("/{rule_id}", response_model=CronRuleOut)
async def update_cron_rule(
    rule_id: str,
    payload: CronRulePatch,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    try:
        rid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(400, "invalid rule id")
    row = (
        await session.execute(
            select(CronRule).where(
                CronRule.id == rid,
                CronRule.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "cron rule not found")
    if payload.name is not None:
        row.name = payload.name.strip()[:128]
    if payload.cron_expr is not None:
        _validate_cron_expr(payload.cron_expr)
        row.cron_expr = payload.cron_expr.strip()[:64]
    if payload.task_template_content is not None:
        row.task_template_content = payload.task_template_content.strip()
    if payload.task_template_title is not None:
        row.task_template_title = (payload.task_template_title or "").strip()[:255] or None
    if payload.task_template_assignee_user_id is not None:
        await _validate_assignee(session, payload.task_template_assignee_user_id, auth.workspace.id)
        row.task_template_assignee_user_id = payload.task_template_assignee_user_id
    if payload.auto_dispatch is not None:
        row.auto_dispatch = payload.auto_dispatch
    if payload.due_days_after is not None:
        if not (1 <= payload.due_days_after <= 365):
            raise HTTPException(400, "due_days_after 必须在 1-365 之间")
        row.due_days_after = payload.due_days_after
    if payload.is_active is not None:
        row.is_active = payload.is_active
    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.delete("/{rule_id}", status_code=204)
async def delete_cron_rule(
    rule_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    try:
        rid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(400, "invalid rule id")
    row = (
        await session.execute(
            select(CronRule).where(
                CronRule.id == rid,
                CronRule.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "cron rule not found")
    # Tasks 已经 instantiated 的不动 — 删规则不删历史
    await session.delete(row)
    await session.commit()


class ForceFireOut(BaseModel):
    rule_id: uuid.UUID
    task_id: uuid.UUID


@router.post("/{rule_id}/force-fire", response_model=ForceFireOut)
async def force_fire_cron_rule(
    rule_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v20: 立即触发一次该规则,绕过 cron 表达式时间匹配.
    主要用途:Cowork 测试 + 用户调试时 sanity-check 模板.
    不要求 is_active=true.
    """
    try:
        rid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(400, "invalid rule id")
    row = (
        await session.execute(
            select(CronRule).where(
                CronRule.id == rid,
                CronRule.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "cron rule not found")
    task_id = await fire_rule(session, row)
    await session.commit()
    return ForceFireOut(rule_id=row.id, task_id=task_id)
