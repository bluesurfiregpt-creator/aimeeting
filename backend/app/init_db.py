"""
Idempotent schema bootstrap.

Phase 1 shortcut: we run create_all() on startup so we can iterate fast before
real prod data exists. As soon as we have any data we care about preserving,
we'll switch to Alembic migrations.
"""

import logging
from sqlalchemy import text

from .db import engine, Base
from . import models  # noqa: F401  -- register all mappers before create_all

logger = logging.getLogger(__name__)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("DB schema ensured")
