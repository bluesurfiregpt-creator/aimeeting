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
    # Sprint I: knowledge base bindings on agent
    ("agent", "knowledge_base_ids", "UUID[]"),
    # M3.0 Multi-Agent V2:
    #   - agent.role distinguishes built-in moderator from user-configured experts
    #   - meeting.agenda holds {title, time_budget_min?, note?} list for the
    #     agenda_monitor LLM watcher
    ("agent", "role", "VARCHAR(16) NOT NULL DEFAULT 'expert'"),
    ("meeting", "agenda", "JSONB"),
    # v17 (Theme 1 → 智慧住建 翻译层):
    #   - workspace.preset selects subsystem behavior (general / smart_construction / ...)
    #   - meeting_action_item.task_id links every ActionItem to its 1:1 Task row.
    #     Backfilled below for existing rows.
    ("workspace", "preset", "JSONB"),
    ("meeting_action_item", "task_id", "UUID"),
    # v18 (Task 状态机 + 三级催办):
    #   - task.{dispatched_at, dispatched_by_user_id, accepted_at, started_at}
    #     stamp transitions through the 6-state machine (audit trail; never
    #     cleared once set)
    #   - notification.severity = normal | yellow | red | purple drives bell
    #     coloring + (future) channel routing for catch-up reminders
    ("task", "dispatched_at", "TIMESTAMPTZ"),
    ("task", "dispatched_by_user_id", "UUID"),
    ("task", "accepted_at", "TIMESTAMPTZ"),
    ("task", "started_at", "TIMESTAMPTZ"),
    ("notification", "severity", "VARCHAR(16) NOT NULL DEFAULT 'normal'"),
    # v21 (角色二分 + 数据 5 级分级):
    #   - workspace_membership.bound_agent_id (expert role 必填,其他 NULL)
    #   - task / knowledge_document / long_term_memory 加 data_classification
    #     默认 'general',现有数据全部归入「中度敏感」
    ("workspace_membership", "bound_agent_id", "UUID"),
    ("task", "data_classification", "VARCHAR(16) NOT NULL DEFAULT 'general'"),
    ("knowledge_document", "data_classification", "VARCHAR(16) NOT NULL DEFAULT 'general'"),
    ("long_term_memory", "data_classification", "VARCHAR(16) NOT NULL DEFAULT 'general'"),
    # v22.5 (多 AI 协作):task.co_assignees JSONB 数组(协办列表,UUID strings).
    # 默认 NULL = 退化为单 assignee 流程.
    ("task", "co_assignees", "JSONB"),
]

# v23.5+: 列类型扩容(idempotent — 同类型时 PG 当 no-op).
# 用一个单独的列表是因为 ADD COLUMN 和 ALTER COLUMN TYPE 是不同 SQL.
_COLUMN_TYPE_MIGRATIONS: list[tuple[str, str, str]] = [
    # KnowledgeDocument.mime_type 64 太短:.docx mime 'application/vnd.
    # openxmlformats-officedocument.wordprocessingml.document' = 70 chars,
    # .pptx 73, .xlsx 67 都会撞 → 上传 500.扩到 128.
    ("knowledge_document", "mime_type", "VARCHAR(128)"),
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

        # 2b. ALTER COLUMN TYPE for capacity extensions (idempotent — PG no-ops
        # when current type matches target).
        for table, col, spec in _COLUMN_TYPE_MIGRATIONS:
            await conn.execute(
                text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE {spec}")
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

        # v17: backfill Task rows 1:1 for every existing meeting_action_item that
        # doesn't yet have a task_id. Idempotent: skipped on subsequent boots.
        # We do this in raw SQL (not ORM) because:
        #   - it's a one-shot migration, not in the request hot path
        #   - we want the same created_at/updated_at as the source ActionItem
        #     so analytics on Task creation rate aren't artificially spiked
        #     by the migration
        # source_ref carries {meeting_id, action_item_id} so anyone reading
        # the Task can trace back to the originating meeting.
        await conn.execute(
            text(
                """
                INSERT INTO task (
                    id, workspace_id, title, content, assignee_user_id,
                    created_by_user_id, due_at, status, source_type,
                    source_ref, created_at, updated_at
                )
                SELECT
                    gen_random_uuid(),
                    ai.workspace_id,
                    NULL,
                    ai.content,
                    ai.assignee_user_id,
                    NULL,
                    ai.due_at,
                    ai.status,
                    'meeting',
                    jsonb_build_object(
                        'meeting_id', ai.meeting_id::text,
                        'action_item_id', ai.id::text,
                        'action_source_type', ai.source_type
                    ),
                    ai.created_at,
                    ai.updated_at
                FROM meeting_action_item ai
                WHERE ai.task_id IS NULL
                """
            )
        )
        # Now point each newly-orphaned ActionItem at its freshly-created
        # Task by matching on the source_ref → action_item_id we just wrote.
        await conn.execute(
            text(
                """
                UPDATE meeting_action_item ai
                SET task_id = t.id
                FROM task t
                WHERE ai.task_id IS NULL
                  AND t.source_type = 'meeting'
                  AND (t.source_ref->>'action_item_id')::uuid = ai.id
                """
            )
        )

        # M3.0: ensure every workspace has exactly one built-in moderator Agent.
        # The moderator drives the agenda-watcher / off-topic / time-warning /
        # stuck banners. Idempotent: skips workspaces that already have one.
        await conn.execute(
            text(
                """
                INSERT INTO agent (
                    id, workspace_id, name, domain, persona, color, role,
                    is_active, dify_app_type, version, stage, created_at
                )
                SELECT
                    gen_random_uuid(),
                    w.id,
                    '主持人',
                    '会议主持',
                    $persona$你是这场会议中立的主持人。你的职责:
- 当讨论偏离议程时,简短提醒大家回到议题(不超过 30 字)
- 当讨论陷入僵局,综合双方观点提出折中方案
- 当时间预算告急,提醒缩短发言并推进议程
- 不要表达个人立场,只服务于让会议高效收尾
- 一次发言不超过 80 字,语气温和但坚定$persona$,
                    'amber',
                    'moderator',
                    TRUE,
                    'chatflow',
                    1,
                    'prod',
                    NOW()
                FROM workspace w
                WHERE NOT EXISTS (
                    SELECT 1 FROM agent a
                    WHERE a.workspace_id = w.id AND a.role = 'moderator'
                )
                """
            )
        )

    logger.info("DB schema ensured")
