"""
Process a freshly-uploaded KnowledgeDocument: parse → chunk → embed → save.

Status lifecycle written to KnowledgeDocument.status:
    uploading → parsing → embedding → ready
                              ↘ failed

The pipeline is async and runs as a FastAPI BackgroundTask. If anything
throws we record `error_message` so the user can see why on the admin
page and decide whether to delete + retry.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from .chunker import split_text
from .db import SessionLocal
from .doc_parser import extract_text
from .embeddings import EmbeddingError, compute_embeddings
from .models import KnowledgeChunk, KnowledgeDocument
from .oss_client import OSSClient
from sqlalchemy import select

logger = logging.getLogger(__name__)


EMBED_BATCH_SIZE = 25


async def process_document(document_id: uuid.UUID) -> None:
    """Run the full pipeline. Idempotent on `ready` status (returns early)."""
    async with SessionLocal() as db:
        doc = (
            await db.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
            )
        ).scalar_one_or_none()
        if not doc:
            logger.warning("process_document: %s not found", document_id)
            return
        if doc.status == "ready":
            return
        oss_key = doc.oss_key
        filename = doc.filename
    if not oss_key:
        await _mark_failed(document_id, "no oss_key")
        return

    # 1) parse
    await _set_status(document_id, "parsing")
    try:
        oss = OSSClient()
        if not oss.configured:
            raise RuntimeError("OSS not configured")
        # Pull the object's bytes back from OSS via signed URL.
        import urllib.request
        url = oss.signed_url(oss_key, expires_seconds=300)
        raw = urllib.request.urlopen(url).read()
        text = extract_text(filename, raw)
    except Exception as e:
        logger.exception("parse failed for %s", document_id)
        await _mark_failed(document_id, f"parse: {e}")
        return

    text = (text or "").strip()
    if not text:
        await _mark_failed(document_id, "extracted empty text")
        return

    # 2) chunk
    chunks = split_text(text)
    if not chunks:
        await _mark_failed(document_id, "no chunks produced")
        return

    # 3) embed (batched)
    await _set_status(document_id, "embedding", char_count=len(text), chunk_count=len(chunks))
    try:
        all_vectors: list[list[float]] = []
        for i in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[i : i + EMBED_BATCH_SIZE]
            vecs = await compute_embeddings(batch)
            all_vectors.extend(vecs)
    except EmbeddingError as e:
        logger.exception("embedding failed for %s", document_id)
        await _mark_failed(document_id, f"embed: {e}")
        return
    except Exception as e:
        logger.exception("embedding unexpected error for %s", document_id)
        await _mark_failed(document_id, f"embed: {e}")
        return

    # 4) persist chunks; mark ready
    async with SessionLocal() as db:
        # Refetch kb_id (rare race: doc deleted while we worked)
        doc = (
            await db.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
            )
        ).scalar_one_or_none()
        if not doc:
            return
        # Wipe any pre-existing chunks (safety for re-process)
        await db.execute(
            KnowledgeChunk.__table__.delete().where(
                KnowledgeChunk.document_id == document_id
            )
        )
        for idx, (text_chunk, vec) in enumerate(zip(chunks, all_vectors)):
            db.add(
                KnowledgeChunk(
                    document_id=document_id,
                    kb_id=doc.kb_id,
                    chunk_index=idx,
                    content=text_chunk,
                    embedding=vec,
                )
            )
        await db.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(status="ready", chunk_count=len(chunks), error_message=None)
        )
        await db.commit()
    logger.info("kb document %s processed: %d chunks", document_id, len(chunks))


async def _set_status(
    document_id: uuid.UUID, status: str, **extra
) -> None:
    async with SessionLocal() as db:
        await db.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(status=status, **extra)
        )
        await db.commit()


async def _mark_failed(document_id: uuid.UUID, msg: str) -> None:
    async with SessionLocal() as db:
        await db.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(status="failed", error_message=msg[:1000])
        )
        await db.commit()
