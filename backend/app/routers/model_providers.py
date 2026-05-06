"""Per-provider LLM key/model configuration."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..llm_providers import SUPPORTED_PROVIDERS, get_spec
from ..models import ModelProviderConfig

router = APIRouter(prefix="/api/model-providers", tags=["model-providers"])


class ProviderCatalogEntry(BaseModel):
    name: str
    label: str
    default_base_url: str
    default_model: str
    api_key_help: str
    docs_url: str


class ProviderConfigIn(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = None
    model_id: Optional[str] = None
    is_active: bool = False
    note: Optional[str] = None


class ProviderConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    provider: str
    base_url: Optional[str] = None
    model_id: Optional[str] = None
    is_active: bool
    note: Optional[str] = None
    masked_key: str  # first 4 + ****
    created_at: datetime
    updated_at: datetime


def _mask(key: str) -> str:
    if not key:
        return ""
    return key[:4] + "****" if len(key) >= 8 else "****"


def _to_out(row: ModelProviderConfig) -> ProviderConfigOut:
    return ProviderConfigOut.model_validate(
        {**row.__dict__, "masked_key": _mask(row.api_key or "")}
    )


@router.get("/catalog", response_model=list[ProviderCatalogEntry])
async def catalog():
    """Static metadata for the provider picker on the admin page."""
    return [
        ProviderCatalogEntry(
            name=s.name,
            label=s.label,
            default_base_url=s.default_base_url,
            default_model=s.default_model,
            api_key_help=s.api_key_help,
            docs_url=s.docs_url,
        )
        for s in SUPPORTED_PROVIDERS
    ]


@router.get("", response_model=list[ProviderConfigOut])
async def list_configs(session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            select(ModelProviderConfig).order_by(ModelProviderConfig.provider)
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.put("/{provider}", response_model=ProviderConfigOut)
async def upsert_config(
    provider: str,
    payload: ProviderConfigIn,
    session: AsyncSession = Depends(get_session),
):
    if get_spec(provider) is None:
        raise HTTPException(400, f"unknown provider {provider}")
    if payload.provider != provider:
        raise HTTPException(400, "path provider != body provider")

    existing = (
        await session.execute(
            select(ModelProviderConfig).where(ModelProviderConfig.provider == provider)
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = ModelProviderConfig(provider=provider, api_key=payload.api_key)
        session.add(existing)

    spec = get_spec(provider)
    existing.api_key = payload.api_key
    existing.base_url = payload.base_url or (spec.default_base_url if spec else None)
    existing.model_id = payload.model_id or (spec.default_model if spec else None)
    existing.is_active = payload.is_active
    existing.note = payload.note

    # Enforce: at most one active.
    if payload.is_active:
        await session.flush()
        await session.execute(
            update(ModelProviderConfig)
            .where(
                ModelProviderConfig.id != existing.id,
                ModelProviderConfig.is_active.is_(True),
            )
            .values(is_active=False)
        )

    await session.commit()
    await session.refresh(existing)
    return _to_out(existing)


@router.post("/{provider}/activate", response_model=ProviderConfigOut)
async def activate(provider: str, session: AsyncSession = Depends(get_session)):
    row = (
        await session.execute(
            select(ModelProviderConfig).where(ModelProviderConfig.provider == provider)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.execute(
        update(ModelProviderConfig)
        .where(ModelProviderConfig.id != row.id)
        .values(is_active=False)
    )
    row.is_active = True
    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.delete("/{provider}", status_code=204)
async def delete_config(provider: str, session: AsyncSession = Depends(get_session)):
    row = (
        await session.execute(
            select(ModelProviderConfig).where(ModelProviderConfig.provider == provider)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.delete(row)
    await session.commit()
