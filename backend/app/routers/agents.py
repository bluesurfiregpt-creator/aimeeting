"""Agent CRUD: persona + Dify connection per agent. Workspace-scoped."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..models import Agent

router = APIRouter(prefix="/api/agents", tags=["agents"])


class AgentIn(BaseModel):
    name: str
    avatar_url: Optional[str] = None
    domain: Optional[str] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    boundary: Optional[str] = None
    keywords: Optional[list[str]] = None
    color: Optional[str] = None
    dify_app_type: str = "chatflow"
    dify_base_url: Optional[str] = "https://api.dify.ai"
    dify_api_key: Optional[str] = None
    dify_workflow_id: Optional[str] = None
    knowledge_base_ids: Optional[list[uuid.UUID]] = None
    is_active: bool = True


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    avatar_url: Optional[str] = None
    domain: Optional[str] = None
    persona: Optional[str] = None
    tone: Optional[str] = None
    boundary: Optional[str] = None
    keywords: Optional[list[str]] = None
    color: Optional[str] = None
    dify_app_type: str
    dify_base_url: Optional[str] = None
    dify_workflow_id: Optional[str] = None
    knowledge_base_ids: Optional[list[uuid.UUID]] = None
    is_active: bool
    has_dify_key: bool = False  # don't echo the key itself
    created_at: datetime


def _to_out(a: Agent) -> AgentOut:
    d = {**a.__dict__, "has_dify_key": bool(a.dify_api_key)}
    return AgentOut.model_validate(d)


@router.get("", response_model=list[AgentOut])
async def list_agents(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(Agent)
            .where(Agent.workspace_id == auth.workspace.id)
            .order_by(Agent.created_at.desc())
        )
    ).scalars().all()
    return [_to_out(a) for a in rows]


@router.post("", response_model=AgentOut)
async def create_agent(
    payload: AgentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    a = Agent(**payload.model_dump(), workspace_id=auth.workspace.id)
    session.add(a)
    await session.commit()
    await session.refresh(a)
    await audit_log(
        session, auth, "agent.create",
        target_type="agent", target_id=str(a.id),
        payload={"name": a.name, "domain": a.domain},
    )
    return _to_out(a)


async def _load_owned_agent(
    agent_id: str, session: AsyncSession, auth: AuthContext
) -> Agent:
    a = (
        await session.execute(
            select(Agent).where(
                Agent.id == agent_id, Agent.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    return a


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    return _to_out(await _load_owned_agent(agent_id, session, auth))


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: str,
    payload: AgentIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    a = await _load_owned_agent(agent_id, session, auth)
    changed = list(payload.model_dump(exclude_unset=True).keys())
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    await session.commit()
    await session.refresh(a)
    await audit_log(
        session, auth, "agent.update",
        target_type="agent", target_id=str(a.id),
        payload={"name": a.name, "fields_changed": changed},
    )
    return _to_out(a)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    a = await _load_owned_agent(agent_id, session, auth)
    name = a.name
    await session.delete(a)
    await session.commit()
    await audit_log(
        session, auth, "agent.delete",
        target_type="agent", target_id=str(agent_id),
        payload={"name": name},
    )
