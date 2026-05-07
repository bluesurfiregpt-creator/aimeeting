"""
Knowledge-base chunk retrieval for AI experts.

Given a query (typically the recent meeting context + user query) and a
list of KB ids the agent is allowed to cite, returns the top-k chunks by
cosine distance. Each chunk carries its document filename + index so the
caller can show citations in the response.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .embeddings import EmbeddingError, compute_embedding
from .models import KnowledgeChunk, KnowledgeDocument

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    document_filename: str
    chunk_index: int
    content: str
    distance: float


async def retrieve_chunks(
    db: AsyncSession,
    *,
    query_text: str,
    kb_ids: Sequence[uuid.UUID],
    k: int = 4,
    max_distance: float = 0.55,
) -> list[RetrievedChunk]:
    """
    Top-k chunks by cosine distance, scoped to the supplied KBs only.

    `max_distance` is a hard cutoff: anything farther is treated as
    irrelevant noise and not returned. Tuned to 0.55 — at our
    DashScope text-embedding-v2 dim, that's roughly "topically
    related" without being "exact".
    """
    if not query_text.strip() or not kb_ids:
        return []
    try:
        qvec = await compute_embedding(query_text)
    except EmbeddingError:
        logger.exception("retrieve_chunks: embedding failed; returning []")
        return []

    distance_expr = KnowledgeChunk.embedding.cosine_distance(qvec).label("distance")
    stmt = (
        select(KnowledgeChunk, KnowledgeDocument.filename, distance_expr)
        .join(
            KnowledgeDocument,
            KnowledgeDocument.id == KnowledgeChunk.document_id,
        )
        .where(KnowledgeChunk.kb_id.in_(list(kb_ids)))
        .order_by(distance_expr)
        .limit(k * 2)  # over-fetch then filter by max_distance
    )

    rows = (await db.execute(stmt)).all()
    out: list[RetrievedChunk] = []
    for chunk, filename, dist in rows:
        d = float(dist)
        if d > max_distance:
            continue
        out.append(
            RetrievedChunk(
                chunk_id=str(chunk.id),
                document_id=str(chunk.document_id),
                document_filename=filename,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                distance=d,
            )
        )
        if len(out) >= k:
            break
    return out
