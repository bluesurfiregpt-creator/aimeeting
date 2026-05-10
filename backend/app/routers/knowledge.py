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
from ..auth import AuthContext, get_current_auth
from ..db import get_session
from ..doc_parser import kind_from_filename
from ..knowledge_processor import process_document
from ..models import KnowledgeBase, KnowledgeChunk, KnowledgeDocument
from ..oss_client import OSSClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge-bases", tags=["knowledge"])

# 50 MiB upload cap — beyond this is usually a scanned PDF or video; reject loudly.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


# ----- schemas ----------------------------------------------------------------

class KBIn(BaseModel):
    name: str
    description: Optional[str] = None


class KBOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    document_count: int = 0
    chunk_count: int = 0
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
    # Aggregate doc / chunk counts in one shot per KB
    out: list[KBOut] = []
    for kb in rows:
        doc_count = (
            await session.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.kb_id == kb.id)
            )
        ).scalars().all()
        n_docs = len(doc_count)
        n_chunks = sum((d.chunk_count or 0) for d in doc_count)
        out.append(KBOut.model_validate({**kb.__dict__, "document_count": n_docs, "chunk_count": n_chunks}))
    return out


@router.post("", response_model=KBOut)
async def create_kb(
    payload: KBIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    if not payload.name.strip():
        raise HTTPException(400, "name required")
    kb = KnowledgeBase(
        name=payload.name.strip(),
        description=payload.description,
        workspace_id=auth.workspace.id,
    )
    session.add(kb)
    await session.commit()
    await session.refresh(kb)
    await audit_log(
        session, auth, "kb.create",
        target_type="knowledge_base", target_id=str(kb.id),
        payload={"name": kb.name},
    )
    return KBOut.model_validate({**kb.__dict__, "document_count": 0, "chunk_count": 0})


@router.delete("/{kb_id}", status_code=204)
async def delete_kb(
    kb_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
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
    kb = await _load_owned_kb(kb_id, session, auth)

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
    await _load_owned_kb(kb_id, session, auth)
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
    await _load_owned_kb(kb_id, session, auth)
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
