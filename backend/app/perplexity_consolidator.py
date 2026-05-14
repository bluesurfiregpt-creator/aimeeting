"""
v26.13.2: Perplexity 草稿 → KB 实际沉淀.

manager 在 审批中心 点 "通过" → 调 consolidate_perplexity_draft:
  - 读 KbSedimentationDraft (kind='perplexity_auto')
  - 写 KnowledgeDocument (source_type='perplexity_auto', 完整溯源元数据)
  - chunk + embed → KnowledgeChunk

跟 task_consolidator.consolidate_task_to_agent_kb 平行, 但 不依赖 Task / source_ref.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from .chunker import split_text
from .db import SessionLocal
from .embeddings import EmbeddingError, compute_embeddings
from .models import (
    KbSedimentationDraft,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
)

logger = logging.getLogger(__name__)


class PerplexityConsolidationError(Exception):
    pass


async def consolidate_perplexity_draft(
    draft_id: uuid.UUID,
    *,
    curator_user_id: uuid.UUID,
) -> None:
    """
    Approved 草稿 → KB doc + chunks + embeddings.

    Errors:
      - draft 不存在 / 状态 不对 → raise PerplexityConsolidationError
      - target_kb_id 没设 → raise (草稿创建时 该字段 已确定 — 没 即 bug)
      - embedding 失败 → doc 标 'failed', raise
    """
    async with SessionLocal() as db:
        d = (
            await db.execute(
                select(KbSedimentationDraft).where(
                    KbSedimentationDraft.id == draft_id
                )
            )
        ).scalar_one_or_none()
        if d is None:
            raise PerplexityConsolidationError(f"draft {draft_id} not found")
        if d.kind != "perplexity_auto":
            raise PerplexityConsolidationError(
                f"draft {draft_id} kind={d.kind}, not perplexity_auto"
            )
        if d.target_kb_id is None:
            raise PerplexityConsolidationError(
                f"draft {draft_id} target_kb_id 为空, 无 法 沉淀"
            )

        kb = (
            await db.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == d.target_kb_id)
            )
        ).scalar_one_or_none()
        if kb is None:
            raise PerplexityConsolidationError(
                f"target_kb {d.target_kb_id} not found"
            )

        meta = d.meta or {}
        source_query = (meta.get("source_query") or "")[:1000]
        primary_url = meta.get("primary_url")
        fetched_at_str = meta.get("fetched_at")
        try:
            source_fetched_at = (
                datetime.fromisoformat(fetched_at_str.replace("Z", "+00:00"))
                if fetched_at_str else datetime.now(timezone.utc)
            )
        except Exception:
            source_fetched_at = datetime.now(timezone.utc)

        full_text = d.proposed_summary or ""
        char_count = len(full_text)

        filename = d.proposed_filename or f"Perplexity · {source_query[:40] or 'untitled'}.md"
        # 文件名 安全 截断 ≤ 255
        filename = filename[:255]

        doc = KnowledgeDocument(
            kb_id=kb.id,
            filename=filename,
            mime_type="text/markdown",
            oss_key=None,
            byte_size=len(full_text.encode("utf-8")),
            status="embedding",
            char_count=char_count,
            data_classification="general",
            source_type="perplexity_auto",
            source_agent_id=d.target_agent_id,
            source_url=primary_url,
            source_query=source_query,
            source_fetched_at=source_fetched_at,
            curated_by_user_id=curator_user_id,
            curated_at=datetime.now(timezone.utc),
        )
        db.add(doc)
        await db.flush()
        doc_id = doc.id

        # chunk
        chunks = split_text(full_text)
        if not chunks:
            chunks = [full_text]

        # commit doc 先持久 — 即使 embed 失败 doc 还在
        await db.commit()

    # embed
    try:
        all_vectors: list[list[float]] = []
        EMBED_BATCH = 25
        for i in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[i:i + EMBED_BATCH]
            vecs = await compute_embeddings(batch)
            all_vectors.extend(vecs)
    except EmbeddingError as e:
        async with SessionLocal() as db2:
            await db2.execute(
                update(KnowledgeDocument)
                .where(KnowledgeDocument.id == doc_id)
                .values(status="failed", error_message=f"embed: {e}")
            )
            await db2.commit()
        raise PerplexityConsolidationError(f"embedding failed: {e}") from e

    # write chunks + mark ready
    async with SessionLocal() as db3:
        for idx, (chunk_text, vec) in enumerate(zip(chunks, all_vectors)):
            db3.add(
                KnowledgeChunk(
                    document_id=doc_id,
                    kb_id=kb.id,
                    chunk_index=idx,
                    content=chunk_text,
                    embedding=vec,
                )
            )
        await db3.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == doc_id)
            .values(status="ready", chunk_count=len(chunks), error_message=None)
        )
        await db3.commit()

    logger.info(
        "perplexity consolidated: draft=%s kb=%s doc=%s (%d chunks) query=%r",
        draft_id, kb.id, doc_id, len(chunks), source_query[:60],
    )
