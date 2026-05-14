"""
v26.13.2: 检索 / 搜索 API 后台 CRUD.

跟 model_providers.py 平行结构, 但 这管 检索 API (Perplexity 等), 不是 LLM.
故意 拆 两个 router — UI 上 在 /me/profile/models 同一页 但 分两个 section.

支持的 provider:
  - perplexity (v26.13.2 唯一)
  - 未来: tavily / serper / brave / ...

ABAC: leader / admin / owner 才 能 CRUD (检索 API 影响 全 workspace 成本).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth, require_leader_or_admin
from ..db import get_session
from ..models import SearchProviderConfig
from ..perplexity_client import test_credentials as test_perplexity_creds

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/search-providers", tags=["search-providers"])


# ---------------------------------------------------------------------------
# Supported providers catalog (static for now; v26.13.2 only Perplexity)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SearchProviderSpec:
    name: str
    label: str
    default_base_url: str
    api_key_help: str
    docs_url: str


SUPPORTED_SEARCH_PROVIDERS: list[SearchProviderSpec] = [
    SearchProviderSpec(
        name="perplexity",
        label="Perplexity (sonar)",
        default_base_url="https://api.perplexity.ai",
        api_key_help="Perplexity API key",
        docs_url="https://docs.perplexity.ai/guides/getting-started",
    ),
]


def _get_spec(name: str) -> Optional[SearchProviderSpec]:
    for s in SUPPORTED_SEARCH_PROVIDERS:
        if s.name == name:
            return s
    return None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SearchProviderCatalogEntry(BaseModel):
    name: str
    label: str
    default_base_url: str
    api_key_help: str
    docs_url: str


class SearchProviderIn(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    provider: str
    api_key: Optional[str] = None  # v26.12-fix6 同套 — 留空 保留 现 key
    base_url: Optional[str] = None
    is_active: bool = False
    note: Optional[str] = None


class SearchProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())
    id: uuid.UUID
    provider: str
    base_url: Optional[str] = None
    is_active: bool
    note: Optional[str] = None
    masked_key: str
    created_at: datetime
    updated_at: datetime


class TestCredsOut(BaseModel):
    ok: bool
    msg: str


def _mask(key: str) -> str:
    if not key:
        return ""
    return key[:4] + "****" if len(key) >= 8 else "****"


def _to_out(row: SearchProviderConfig) -> SearchProviderOut:
    # 显式 字段 构造 — 同 v26.12-fix5
    return SearchProviderOut(
        id=row.id,
        provider=row.provider,
        base_url=row.base_url,
        is_active=row.is_active,
        note=row.note,
        masked_key=_mask(row.api_key or ""),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/catalog", response_model=list[SearchProviderCatalogEntry])
async def catalog():
    """Static catalog — what search providers we support."""
    return [
        SearchProviderCatalogEntry(
            name=s.name,
            label=s.label,
            default_base_url=s.default_base_url,
            api_key_help=s.api_key_help,
            docs_url=s.docs_url,
        )
        for s in SUPPORTED_SEARCH_PROVIDERS
    ]


@router.get("", response_model=list[SearchProviderOut])
async def list_configs(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """List 本 workspace 的 搜索 API 配置."""
    rows = (
        await session.execute(
            select(SearchProviderConfig)
            .where(SearchProviderConfig.workspace_id == auth.workspace.id)
            .order_by(SearchProviderConfig.provider)
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.put("/{provider}", response_model=SearchProviderOut)
async def upsert_config(
    provider: str,
    payload: SearchProviderIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """配置/更新 — 复用 model_providers v26.12-fix6 的 留空 保留 原 key 模式."""
    await require_leader_or_admin(session, auth)
    spec = _get_spec(provider)
    if spec is None:
        raise HTTPException(400, f"unknown search provider: {provider}")
    if payload.provider != provider:
        raise HTTPException(400, "path provider != body provider")

    # Raw body log — 便于 v26.12-fix5 同款 调试 (留 防御性)
    try:
        raw = await request.body()
        logger.info(
            "search_providers.upsert provider=%s raw=%r parsed=%r",
            provider, raw[:300], payload.model_dump(),
        )
    except Exception:
        pass

    existing = (
        await session.execute(
            select(SearchProviderConfig).where(
                SearchProviderConfig.provider == provider,
                SearchProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        if not (payload.api_key and payload.api_key.strip()):
            raise HTTPException(400, "首次保存需填写 API Key")
        existing = SearchProviderConfig(
            provider=provider,
            api_key=payload.api_key.strip(),
            workspace_id=auth.workspace.id,
        )
        session.add(existing)

    # 留空 → 保留 现 key (跟 model_providers v26.12-fix6 一致)
    new_key = (payload.api_key or "").strip()
    if new_key:
        existing.api_key = new_key
    existing.base_url = (payload.base_url or "").strip() or spec.default_base_url
    existing.is_active = payload.is_active
    existing.note = payload.note

    # 仅 一个 active per workspace
    if payload.is_active:
        await session.flush()
        await session.execute(
            update(SearchProviderConfig)
            .where(
                SearchProviderConfig.id != existing.id,
                SearchProviderConfig.workspace_id == auth.workspace.id,
                SearchProviderConfig.is_active.is_(True),
            )
            .values(is_active=False)
        )

    await session.commit()
    await session.refresh(existing)
    await audit_log(
        session, auth, "search_provider.upsert",
        target_type="search_provider", target_id=str(existing.id),
        payload={"provider": provider, "is_active": existing.is_active},
    )
    return _to_out(existing)


@router.post("/{provider}/activate", response_model=SearchProviderOut)
async def activate(
    provider: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await require_leader_or_admin(session, auth)
    row = (
        await session.execute(
            select(SearchProviderConfig).where(
                SearchProviderConfig.provider == provider,
                SearchProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.execute(
        update(SearchProviderConfig)
        .where(
            SearchProviderConfig.id != row.id,
            SearchProviderConfig.workspace_id == auth.workspace.id,
        )
        .values(is_active=False)
    )
    row.is_active = True
    await session.commit()
    await session.refresh(row)
    return _to_out(row)


@router.delete("/{provider}")
async def delete_config(
    provider: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await require_leader_or_admin(session, auth)
    row = (
        await session.execute(
            select(SearchProviderConfig).where(
                SearchProviderConfig.provider == provider,
                SearchProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "config not found")
    await session.delete(row)
    await session.commit()
    return {"ok": True}


@router.post("/{provider}/test", response_model=TestCredsOut)
async def test_creds(
    provider: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """用 已保存 的 key 调 一次 极小 query 验证."""
    await require_leader_or_admin(session, auth)
    if provider != "perplexity":
        raise HTTPException(400, f"test 暂仅 支持 perplexity, 给的: {provider}")
    row = (
        await session.execute(
            select(SearchProviderConfig).where(
                SearchProviderConfig.provider == provider,
                SearchProviderConfig.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "请先保存配置再测试")
    ok, msg = await test_perplexity_creds(
        api_key=row.api_key,
        base_url=row.base_url,
    )
    return TestCredsOut(ok=ok, msg=msg)
