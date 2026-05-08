"""Per-provider LLM key/model configuration."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..list_models import ListModelsError, list_models
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


class ListModelsIn(BaseModel):
    # Optional: when empty, the route falls back to the workspace's saved
    # api_key for this provider. This lets users hit "拉取模型列表" without
    # re-typing a key they've already configured (the admin form never
    # echoes saved keys back, so the form field is always blank on load).
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ModelEntryOut(BaseModel):
    id: str
    label: Optional[str] = None


class ListModelsOut(BaseModel):
    models: list[ModelEntryOut]


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
async def list_configs(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(ModelProviderConfig)
            .where(ModelProviderConfig.workspace_id == auth.workspace.id)
            .order_by(ModelProviderConfig.provider)
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.put("/{provider}", response_model=ProviderConfigOut)
async def upsert_config(
    provider: str,
    payload: ProviderConfigIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    if get_spec(provider) is None:
        raise HTTPException(400, f"unknown provider {provider}")
    if payload.provider != provider:
        raise HTTPException(400, "path provider != body provider")

    existing = (
        await session.execute(
            select(ModelProviderConfig).where(
                ModelProviderConfig.provider == provider,
                ModelProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = ModelProviderConfig(
            provider=provider,
            api_key=payload.api_key,
            workspace_id=auth.workspace.id,
        )
        session.add(existing)

    spec = get_spec(provider)
    existing.api_key = payload.api_key
    existing.base_url = payload.base_url or (spec.default_base_url if spec else None)
    existing.model_id = payload.model_id or (spec.default_model if spec else None)
    existing.is_active = payload.is_active
    existing.note = payload.note

    # Enforce: at most one active per workspace.
    if payload.is_active:
        await session.flush()
        await session.execute(
            update(ModelProviderConfig)
            .where(
                ModelProviderConfig.id != existing.id,
                ModelProviderConfig.workspace_id == auth.workspace.id,
                ModelProviderConfig.is_active.is_(True),
            )
            .values(is_active=False)
        )

    await session.commit()
    await session.refresh(existing)
    return _to_out(existing)


@router.post("/{provider}/activate", response_model=ProviderConfigOut)
async def activate(
    provider: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    row = (
        await session.execute(
            select(ModelProviderConfig).where(
                ModelProviderConfig.provider == provider,
                ModelProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.execute(
        update(ModelProviderConfig)
        .where(
            ModelProviderConfig.id != row.id,
            ModelProviderConfig.workspace_id == auth.workspace.id,
        )
        .values(is_active=False)
    )
    row.is_active = True
    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.post("/{provider}/list-models", response_model=ListModelsOut)
async def list_provider_models(
    provider: str,
    payload: ListModelsIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    Fetch the live model catalog from the provider's /models endpoint
    so the admin form can show a dropdown instead of forcing the user
    to remember model IDs.

    Resolution order for the API key:
    1. payload.api_key if non-empty (user is testing a new key before saving)
    2. fall back to the workspace's saved key for this provider (user
       just clicked the button without re-typing — most common case)

    Same for base_url. The key is NOT persisted by this call.
    """
    if get_spec(provider) is None:
        raise HTTPException(400, f"unknown provider {provider}")

    api_key = (payload.api_key or "").strip()
    base_url = (payload.base_url or "").strip() or None

    if not api_key or not base_url:
        saved = (
            await session.execute(
                select(ModelProviderConfig).where(
                    ModelProviderConfig.provider == provider,
                    ModelProviderConfig.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if not api_key:
            if saved is None or not saved.api_key:
                raise HTTPException(400, "no API key on form and none saved — paste a key first")
            api_key = saved.api_key
        if not base_url and saved is not None:
            base_url = saved.base_url

    try:
        models = await list_models(provider, api_key, base_url)
    except ListModelsError as exc:
        # Surface as 400 with the provider's message so the UI can
        # display "your key was rejected" or "endpoint unreachable".
        raise HTTPException(400, f"list models failed: {exc}")
    return ListModelsOut(
        models=[ModelEntryOut(id=m.id, label=m.label) for m in models]
    )


@router.delete("/{provider}", status_code=204)
async def delete_config(
    provider: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    row = (
        await session.execute(
            select(ModelProviderConfig).where(
                ModelProviderConfig.provider == provider,
                ModelProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.delete(row)
    await session.commit()
