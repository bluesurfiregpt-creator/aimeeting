"""Agent CRUD: persona + Dify connection per agent."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    is_active: bool
    has_dify_key: bool = False  # don't echo the key itself
    created_at: datetime


def _to_out(a: Agent) -> AgentOut:
    d = {**a.__dict__, "has_dify_key": bool(a.dify_api_key)}
    return AgentOut.model_validate(d)


@router.get("", response_model=list[AgentOut])
async def list_agents(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Agent).order_by(Agent.created_at.desc()))).scalars().all()
    return [_to_out(a) for a in rows]


@router.post("", response_model=AgentOut)
async def create_agent(payload: AgentIn, session: AsyncSession = Depends(get_session)):
    a = Agent(**payload.model_dump())
    session.add(a)
    await session.commit()
    await session.refresh(a)
    return _to_out(a)


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    a = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    return _to_out(a)


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: str, payload: AgentIn, session: AsyncSession = Depends(get_session)
):
    a = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    await session.commit()
    await session.refresh(a)
    return _to_out(a)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    a = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "agent not found")
    await session.delete(a)
    await session.commit()
