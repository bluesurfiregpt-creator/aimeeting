"""Knowledge base + document CRUD. Workspace-scoped."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import (
    AuthContext,
    can_write_kb,
    get_current_auth,
    is_leader_or_admin,
    require_kb_writer,
    require_leader_or_admin,
)
from ..db import get_session
from ..doc_parser import kind_from_filename
from ..knowledge_processor import process_document
from ..models import Agent, KnowledgeBase, KnowledgeChunk, KnowledgeDocument
from ..oss_client import OSSClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge-bases", tags=["knowledge"])

# 50 MiB upload cap — beyond this is usually a scanned PDF or video; reject loudly.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


# ----- schemas ----------------------------------------------------------------

class KBIn(BaseModel):
    name: str
    description: Optional[str] = None
    # v26.5-02a: KB 归属 AI 专家 (可空 — 不填则 仅 admin 可写, 老行为兼容)
    owner_agent_id: Optional[uuid.UUID] = None


class KBPatchIn(BaseModel):
    """v26.5-02a: PATCH KB — 改名 / 描述 / 重指 owner_agent_id."""
    name: Optional[str] = None
    description: Optional[str] = None
    owner_agent_id: Optional[uuid.UUID] = None  # 显式传 None 也算改 (清空 owner)


class KBOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    document_count: int = 0
    chunk_count: int = 0
    # v26.5-02a: 归属 AI 信息 (前端 展示徽章 + 决定可写)
    owner_agent_id: Optional[uuid.UUID] = None
    owner_agent_name: Optional[str] = None  # 展示用 (后端 resolve 一次)
    # caller 视角是否可写 (前端用来 决定 显示 ✏️ 还是 🔒)
    can_write: bool = False
    # v26.5-Lineage P2: 反向查 — 哪些 AI 引用了这个 KB
    # (任何 Agent.knowledge_base_ids 包含 this kb.id 的 agent)
    referenced_by_agent_ids: list[uuid.UUID] = []
    referenced_by_agent_names: list[str] = []
    created_at: datetime


class DocOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kb_id: uuid.UUID
    filename: str
    mime_type: Optional[str] = None
    byte_size: Optional[int] = None
    status: str
    char_count: Optional[int] = None
    chunk_count: Optional[int] = None
    error_message: Optional[str] = None
    # v21: 数据分级
    data_classification: str = "general"
    # v26.2: 沉淀来源元数据 — UI 可显示 "来源:任务《xxx》by AI 专家"
    source_type: str = "manual"
    source_task_id: Optional[uuid.UUID] = None
    source_agent_id: Optional[uuid.UUID] = None
    curated_by_user_id: Optional[uuid.UUID] = None
    curated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


# ----- helpers ----------------------------------------------------------------

async def _load_owned_kb(
    kb_id: str, session: AsyncSession, auth: AuthContext
) -> KnowledgeBase:
    kb = (
        await session.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.id == kb_id,
                KnowledgeBase.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not kb:
        raise HTTPException(404, "knowledge base not found")
    return kb


# ----- KB CRUD ---------------------------------------------------------------

async def _resolve_agent_names(
    session: AsyncSession, agent_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """v26.5-02a: 批量 resolve agent.id → agent.name 给 KB 列表用."""
    if not agent_ids:
        return {}
    rows = (
        await session.execute(
            select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))
        )
    ).all()
    return {r[0]: r[1] for r in rows}


@router.get("", response_model=list[KBOut])
async def list_kbs(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    rows = (
        await session.execute(
            select(KnowledgeBase)
            .where(KnowledgeBase.workspace_id == auth.workspace.id)
            .order_by(KnowledgeBase.created_at.desc())
        )
    ).scalars().all()
    if not rows:
        return []
    # v26.5-02a: 批量 resolve owner_agent_id → name
    owner_ids = {kb.owner_agent_id for kb in rows if kb.owner_agent_id}
    name_by_id = await _resolve_agent_names(session, owner_ids)
    # caller 是否 全局 admin (一次性 cache, 避免 N 次查 membership)
    is_admin = await is_leader_or_admin(session, auth)
    # caller 维护的 agent 集合 (用来判 can_write)
    if is_admin:
        my_agent_ids: set[uuid.UUID] = set()  # 不需要 — 直接全过
    else:
        my_agent_ids = {
            r[0] for r in (
                await session.execute(
                    select(Agent.id).where(
                        Agent.workspace_id == auth.workspace.id,
                        Agent.primary_user_id == auth.user.id,
                    )
                )
            ).all()
        }
    # v26.5-Lineage P2: 反向查每个 KB 被哪些 agent 引用 (Agent.knowledge_base_ids 数组)
    all_ws_agents = list((
        await session.execute(
            select(Agent.id, Agent.name, Agent.knowledge_base_ids).where(
                Agent.workspace_id == auth.workspace.id
            )
        )
    ).all())
    # kb_id → [(agent_id, agent_name)]
    kb_to_agents: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {}
    for ag_row in all_ws_agents:
        aid, aname, kbids = ag_row[0], ag_row[1], ag_row[2] or []
        for kid in kbids:
            kb_to_agents.setdefault(kid, []).append((aid, aname))

    out: list[KBOut] = []
    for kb in rows:
        doc_count = (
            await session.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.kb_id == kb.id)
            )
        ).scalars().all()
        n_docs = len(doc_count)
        n_chunks = sum((d.chunk_count or 0) for d in doc_count)
        can_write_this = is_admin or (
            kb.owner_agent_id is not None and kb.owner_agent_id in my_agent_ids
        )
        refed = kb_to_agents.get(kb.id, [])
        out.append(KBOut.model_validate({
            **kb.__dict__,
            "document_count": n_docs,
            "chunk_count": n_chunks,
            "owner_agent_name": name_by_id.get(kb.owner_agent_id) if kb.owner_agent_id else None,
            "can_write": can_write_this,
            "referenced_by_agent_ids": [r[0] for r in refed],
            "referenced_by_agent_names": [r[1] for r in refed],
        }))
    return out


@router.post("", response_model=KBOut)
async def create_kb(
    payload: KBIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-01c: 创建 KB 需 owner/admin/leader. manager 不能裸创 KB,需要 admin 先建,
    # 再 admin 在 P1 给该 KB 指 owner_agent (然后 manager 才能写入).
    await require_leader_or_admin(session, auth)
    if not payload.name.strip():
        raise HTTPException(400, "name required")
    # v26.5-02a: 校验 owner_agent_id 同 workspace
    if payload.owner_agent_id:
        ag = (
            await session.execute(
                select(Agent).where(
                    Agent.id == payload.owner_agent_id,
                    Agent.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if ag is None:
            raise HTTPException(400, "owner_agent_id 必须是 同 workspace 的 agent")
    kb = KnowledgeBase(
        name=payload.name.strip(),
        description=payload.description,
        owner_agent_id=payload.owner_agent_id,
        workspace_id=auth.workspace.id,
    )
    session.add(kb)
    await session.commit()
    await session.refresh(kb)
    await audit_log(
        session, auth, "kb.create",
        target_type="knowledge_base", target_id=str(kb.id),
        payload={"name": kb.name, "owner_agent_id": str(payload.owner_agent_id) if payload.owner_agent_id else None},
    )
    name_by_id = await _resolve_agent_names(
        session, {kb.owner_agent_id} if kb.owner_agent_id else set()
    )
    return KBOut.model_validate({
        **kb.__dict__,
        "document_count": 0,
        "chunk_count": 0,
        "owner_agent_name": name_by_id.get(kb.owner_agent_id) if kb.owner_agent_id else None,
        "can_write": True,  # 创建者 leader+ 必能写
    })


@router.patch("/{kb_id}", response_model=KBOut)
async def update_kb(
    kb_id: str,
    payload: KBPatchIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v26.5-02a: 改 KB name/description/owner_agent_id.
    name/description: 该 KB 的 manager 也能改 (用 can_write_kb 判).
    owner_agent_id: 仅 leader+ 可改 (跨人转移 KB 归属).
    """
    kb = await _load_owned_kb(kb_id, session, auth)
    data = payload.model_dump(exclude_unset=True)
    # 改 owner_agent_id 算 转移 — 仅 leader+
    if "owner_agent_id" in data and data["owner_agent_id"] != kb.owner_agent_id:
        if not await is_leader_or_admin(session, auth):
            raise HTTPException(
                403,
                "[权限不足] 仅 owner / admin / leader 可指派 / 转移 KB 归属的 AI"
            )
        # 校验新 agent 同 ws
        if data["owner_agent_id"]:
            ag = (
                await session.execute(
                    select(Agent).where(
                        Agent.id == data["owner_agent_id"],
                        Agent.workspace_id == auth.workspace.id,
                    )
                )
            ).scalar_one_or_none()
            if ag is None:
                raise HTTPException(400, "owner_agent_id 必须是 同 workspace 的 agent")
    # 改 name/description: 走 can_write_kb (admin OR owner agent 的 primary_user)
    if any(k in data for k in ("name", "description")):
        await require_kb_writer(session, auth, kb.id)
    if "name" in data and data["name"]:
        kb.name = data["name"].strip()
    if "description" in data:
        kb.description = data["description"]
    if "owner_agent_id" in data:
        kb.owner_agent_id = data["owner_agent_id"]
    await session.commit()
    await session.refresh(kb)
    await audit_log(
        session, auth, "kb.update",
        target_type="knowledge_base", target_id=str(kb.id),
        payload={"name": kb.name, "fields": list(data.keys())},
    )
    # 重新 计算 doc/chunk counts + can_write 返回
    doc_count = (
        await session.execute(
            select(KnowledgeDocument).where(KnowledgeDocument.kb_id == kb.id)
        )
    ).scalars().all()
    name_by_id = await _resolve_agent_names(
        session, {kb.owner_agent_id} if kb.owner_agent_id else set()
    )
    can_write_now = await can_write_kb(session, auth, kb.id)
    return KBOut.model_validate({
        **kb.__dict__,
        "document_count": len(doc_count),
        "chunk_count": sum((d.chunk_count or 0) for d in doc_count),
        "owner_agent_name": name_by_id.get(kb.owner_agent_id) if kb.owner_agent_id else None,
        "can_write": can_write_now,
    })


@router.delete("/{kb_id}", status_code=204)
async def delete_kb(
    kb_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-01c: 删 整个 KB 仅 owner/admin/leader 可操作 (manager 即使是 owner agent 的 primary,
    # 也不能 直接删 整个 KB — 需要 admin 显式 操作以防误删).
    await require_leader_or_admin(session, auth)
    kb = await _load_owned_kb(kb_id, session, auth)
    name = kb.name
    await session.delete(kb)
    await session.commit()
    await audit_log(
        session, auth, "kb.delete",
        target_type="knowledge_base", target_id=kb_id, payload={"name": name},
    )


# ----- documents -------------------------------------------------------------

@router.get("/{kb_id}/documents", response_model=list[DocOut])
async def list_documents(
    kb_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _load_owned_kb(kb_id, session, auth)
    rows = (
        await session.execute(
            select(KnowledgeDocument)
            .where(KnowledgeDocument.kb_id == kb_id)
            .order_by(KnowledgeDocument.created_at.desc())
        )
    ).scalars().all()
    return [DocOut.model_validate(d) for d in rows]


@router.post("/{kb_id}/documents", response_model=DocOut)
async def upload_document(
    kb_id: str,
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-02a P1: 上传 KB 文档 — 走 can_write_kb:
    # - leader+ 可写任何 KB
    # - manager 可写 自己 primary 的 agent 归属的 KB (KB.owner_agent_id 指向其管的 agent)
    # - 别人一律 403
    kb = await _load_owned_kb(kb_id, session, auth)
    await require_kb_writer(session, auth, kb.id)

    if not file.filename:
        raise HTTPException(400, "filename required")
    kind = kind_from_filename(file.filename)
    if kind is None:
        raise HTTPException(
            400,
            "unsupported file type. allowed: PDF(含扫描件 OCR) / DOCX / XLSX / TXT / MD / CSV / JSON / YAML / 图片(JPG/PNG/BMP/TIFF/WebP/GIF)",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413, f"file too large ({len(raw)} bytes); max {MAX_UPLOAD_BYTES}"
        )

    oss = OSSClient()
    if not oss.configured:
        raise HTTPException(503, "OSS not configured")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe_name = file.filename.replace("/", "_")
    oss_key = f"kb/{auth.workspace.id}/{kb.id}/{ts}-{safe_name}"
    oss.put_bytes(oss_key, raw, content_type=file.content_type or "application/octet-stream")

    doc = KnowledgeDocument(
        kb_id=kb.id,
        filename=file.filename,
        mime_type=file.content_type,
        oss_key=oss_key,
        byte_size=len(raw),
        status="parsing",  # we'll bump immediately when the bg task starts
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    bg.add_task(process_document, doc.id)
    await audit_log(
        session, auth, "kb.upload",
        target_type="knowledge_document", target_id=str(doc.id),
        payload={"kb_id": str(kb.id), "filename": doc.filename, "byte_size": doc.byte_size},
    )
    return DocOut.model_validate(doc)


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    kb_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.5-02a P1: 删 KB 文档 — 同 上传, 走 can_write_kb
    await _load_owned_kb(kb_id, session, auth)
    await require_kb_writer(session, auth, kb_id)
    doc = (
        await session.execute(
            select(KnowledgeDocument).where(
                KnowledgeDocument.id == doc_id, KnowledgeDocument.kb_id == kb_id
            )
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "document not found")
    fname = doc.filename
    oss_key = doc.oss_key
    await session.delete(doc)
    await session.commit()
    if oss_key:
        try:
            OSSClient().delete(oss_key)
        except Exception:
            logger.exception("oss delete failed for %s", oss_key)
    await audit_log(
        session, auth, "kb.delete_document",
        target_type="knowledge_document", target_id=doc_id, payload={"filename": fname},
    )


@router.post("/{kb_id}/documents/{doc_id}/reprocess", response_model=DocOut)
async def reprocess_document(
    kb_id: str,
    doc_id: str,
    bg: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """Re-run parse + chunk + embed for an existing document. Useful when
    parsing failed or chunking strategy changed."""
    # v26.5-02a P1: reprocess 走 can_write_kb (跟 上传同等级)
    await _load_owned_kb(kb_id, session, auth)
    await require_kb_writer(session, auth, kb_id)
    doc = (
        await session.execute(
            select(KnowledgeDocument).where(
                KnowledgeDocument.id == doc_id, KnowledgeDocument.kb_id == kb_id
            )
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "document not found")
    doc.status = "parsing"
    doc.error_message = None
    await session.commit()
    await session.refresh(doc)
    bg.add_task(process_document, doc.id)
    return DocOut.model_validate(doc)
