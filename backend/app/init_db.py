"""
Idempotent schema bootstrap.

Phase 1 shortcut: create_all() handles new tables; for existing tables
that gained columns mid-flight we run a small set of additive ALTERs each
startup. Safe to re-run; switches to Alembic when we have prod data we
truly can't afford to lose.

Sprint F migration steps:
  1. create_all() — adds workspace, workspace_membership, audit_log tables
     and any new indexes
  2. ALTER existing tables to add workspace_id (nullable for now)
  3. ALTER user table to add password_hash / is_active / last_login_at
  4. Drop the old `model_provider_config_provider_key` unique-on-provider
     constraint and replace with the per-workspace one
  5. Seed a "默认工作空间" if no workspace exists
  6. Backfill workspace_id on every existing row to point at it
"""

import logging
from sqlalchemy import text

from . import models  # noqa: F401  -- register all mappers before create_all
from .db import engine, Base

logger = logging.getLogger(__name__)


# Each tuple: (table, column, postgres column-spec). Run as ADD COLUMN IF NOT EXISTS.
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    # User auth fields
    ('"user"', "password_hash", "VARCHAR(255)"),
    ('"user"', "is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ('"user"', "last_login_at", "TIMESTAMPTZ"),
    ('"user"', "workspace_id", "UUID"),
    # Workspace scoping on data tables
    ("agent", "workspace_id", "UUID"),
    ("meeting", "workspace_id", "UUID"),
    ("model_provider_config", "workspace_id", "UUID"),
    ("long_term_memory", "workspace_id", "UUID"),
]

# Drop the legacy unique-on-provider constraint so the new
# (workspace_id, provider) composite can take over.
_LEGACY_CONSTRAINTS = [
    ("model_provider_config", "model_provider_config_provider_key"),
]


async def init_db() -> None:
    async with engine.begin() as conn:
        # 1. extension + create_all (creates new tables only)
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)

        # 2. additive ALTERs for existing tables that gained columns
        for table, col, spec in _COLUMN_MIGRATIONS:
            await conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {spec}")
            )

        # 3. drop legacy unique constraints (idempotent — IF EXISTS)
        for table, constraint in _LEGACY_CONSTRAINTS:
            await conn.execute(
                text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
            )

        # 4. seed the default workspace + backfill orphan rows
        existing_ws = (
            await conn.execute(text("SELECT id FROM workspace WHERE slug='default' LIMIT 1"))
        ).scalar_one_or_none()
        if existing_ws is None:
            existing_ws = (
                await conn.execute(
                    text(
                        "INSERT INTO workspace (id, name, slug) "
                        "VALUES (gen_random_uuid(), '默认工作空间', 'default') "
                        "RETURNING id"
                    )
                )
            ).scalar_one()
            logger.info("seeded default workspace %s", existing_ws)

        for table in ("agent", "meeting", "model_provider_config", "long_term_memory"):
            await conn.execute(
                text(
                    f"UPDATE {table} SET workspace_id = :ws "
                    f"WHERE workspace_id IS NULL"
                ),
                {"ws": existing_ws},
            )
        # Pre-existing users (from voiceprint enrollment) also get the
        # default workspace as their primary, so they show up in attendee
        # pickers in the default tenant.
        await conn.execute(
            text(
                'UPDATE "user" SET workspace_id = :ws '
                'WHERE workspace_id IS NULL'
            ),
            {"ws": existing_ws},
        )

        # Sprint F.1: backfill workspace_membership for users that already
        # had a workspace_id but no explicit membership row (e.g. master
        # account created via raw SQL during Sprint F bootstrap). Without
        # this row our get_current_auth membership check would deny them.
        # Skip users whose workspace_id no longer exists (cleaned-up test
        # workspaces); also reset their stale workspace_id to default.
        await conn.execute(
            text(
                """
                UPDATE "user" SET workspace_id = :ws
                WHERE workspace_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM workspace w WHERE w.id = "user".workspace_id)
                """
            ),
            {"ws": existing_ws},
        )
        await conn.execute(
            text(
                """
                INSERT INTO workspace_membership (id, workspace_id, user_id, role)
                SELECT gen_random_uuid(), u.workspace_id, u.id, 'owner'
                FROM "user" u
                WHERE u.workspace_id IS NOT NULL
                  AND u.password_hash IS NOT NULL
                  AND EXISTS (SELECT 1 FROM workspace w WHERE w.id = u.workspace_id)
                  AND NOT EXISTS (
                    SELECT 1 FROM workspace_membership wm
                    WHERE wm.workspace_id = u.workspace_id AND wm.user_id = u.id
                  )
                """
            )
        )

    logger.info("DB schema ensured")
