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
    ("user", "password_hash", "VARCHAR(255)"),
    ("user", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("user", "last_login_at", "TIMESTAMPTZ"),
    ("user", "workspace_id", "UUID"),
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
    # v24.3 #1 (RAG 引用溯源 UI 强化):agent message 持久化引用的 KB chunks.
    # 默认 NULL = 老消息没引用信息(只在新消息上有).
    ("meeting_agent_message", "citations", "JSONB"),
    # v24.3 #3 (扣分 + 暂停派单):user.suspended_until.
    # NULL = 未暂停;过去时间 = 已恢复.
    ("user", "suspended_until", "TIMESTAMPTZ"),
    # v24.3 #5 (ABAC 雏形):user.department + attributes JSONB.
    ("user", "department", "VARCHAR(128)"),
    ("user", "attributes", "JSONB"),
    # v25.15: action item 实录依据 — 让 用户看 待办的来源句
    ("meeting_action_item", "evidence_quote", "TEXT"),
    # v25.19: action item 实录锚点(LLM 输出的行号数组,JSON 数组).
    # 配合 evidence_quote 让前端能 跳转到 实录精确位置 高亮上下文.
    ("meeting_action_item", "evidence_anchor_line_ids", "JSON"),
    # v26.0: agent-centric 派发 — 任务派给 AI 专家,真人 user 只是它的科室操作员
    ("agent", "primary_user_id", "UUID"),
    ("task", "assignee_agent_id", "UUID"),
    ("task", "co_agent_ids", "JSON"),
    # v26.2: 任务办结沉淀回 KB — KnowledgeDocument 加 来源元数据
    ("knowledge_document", "source_type", "VARCHAR(16) DEFAULT 'manual'"),
    ("knowledge_document", "source_task_id", "UUID"),
    ("knowledge_document", "source_agent_id", "UUID"),
    ("knowledge_document", "curated_by_user_id", "UUID"),
    ("knowledge_document", "curated_at", "TIMESTAMPTZ"),
    # v26.3: 召集人模式 (全 AI 会议)
    #   mode = human / hybrid / auto;auto_state JSON 存调度状态
    ("meeting", "mode", "VARCHAR(16) DEFAULT 'hybrid'"),
    ("meeting", "auto_state", "JSON"),
    # v26.3: agent message 加线程化 + 议程索引
    ("meeting_agent_message", "reply_to_agent_message_id", "BIGINT"),
    ("meeting_agent_message", "agenda_idx", "INTEGER"),
    # v26.4 Platform Admin: workspace 级 状态 + 活跃度 (跨租户运营管理用)
    #   status: 'active' | 'suspended' | 'archived'
    #   last_active_at: 最近一次 audit_log 行的时间;由 audit_log hook 异步更新
    ("workspace", "status", "VARCHAR(16) NOT NULL DEFAULT 'active'"),
    ("workspace", "last_active_at", "TIMESTAMPTZ"),
    # v26.5-02a P1: KB 归属 AI 专家. nullable — 老 KB 退到 admin-only 写.
    # FK 在 _FK_MIGRATIONS 里加 ON DELETE SET NULL.
    ("knowledge_base", "owner_agent_id", "UUID"),
    # v26.5-02b P1: memory 归属 AI 专家. nullable — NULL = workspace 通用记忆.
    # FK 在 _FK_MIGRATIONS 里加 ON DELETE CASCADE (memory 跟着 AI 走).
    ("long_term_memory", "agent_id", "UUID"),
    # v26.5-Lineage: Memory 显式溯源 — 让 前端血缘图 能 JOIN 出 来源会议.
    ("long_term_memory", "source_meeting_id", "UUID"),
    ("long_term_memory", "source_action_item_id", "UUID"),
    ("long_term_memory", "curated_by_user_id", "UUID"),
    ("long_term_memory", "curated_at", "TIMESTAMPTZ"),
    # v26.7-03: KB document 也显式追溯到 会议 (血缘图直连).
    ("knowledge_document", "source_meeting_id", "UUID"),
    # v26.9-Avatar: AI 专家"数字员工"形象 — 静态全身像 + 动图全身像
    ("agent", "full_body_url", "VARCHAR(512)"),
    ("agent", "full_body_animated_url", "VARCHAR(512)"),
    # v26.11-fix2: 会议 创建人 — 邀请 AI / 关掉 会议 等 房间级别 操作 的 ABAC 判定基.
    # NULL 老数据 (v26.11 前 创建的会议) — ABAC 退化为 仅 leader+ 可改.
    ("meeting", "created_by_user_id", "UUID"),
    # v26.12-Home: AI 调用统计 + 拟人外号
    #   invoke_count — agent_router.invoke_agent_directly() 成功 时 +1.
    #     首页 "热度" 排序 + 卡片 露 "1247 次使用" 社会证明. 老 agent 全部 从 0 起.
    #   nickname — 可选 拟人外号 (e.g. "数妙妙" / "文爆爆"). NULL 时 前端 fallback 全名.
    ("agent", "invoke_count", "INTEGER NOT NULL DEFAULT 0"),
    ("agent", "nickname", "VARCHAR(64)"),
    # v26.13.2: Workspace 级 Perplexity 月配额
    ("workspace", "perplexity_monthly_quota", "INTEGER NOT NULL DEFAULT 100"),
    ("workspace", "perplexity_used_this_month", "INTEGER NOT NULL DEFAULT 0"),
    ("workspace", "perplexity_used_reset_at", "TIMESTAMPTZ"),
    # v26.13.2: KnowledgeDocument 加 Perplexity 抓取 溯源 字段
    ("knowledge_document", "source_url", "VARCHAR(1024)"),
    ("knowledge_document", "source_query", "TEXT"),
    ("knowledge_document", "source_fetched_at", "TIMESTAMPTZ"),
    # v26.13.2: KbSedimentationDraft 加 kind + 改 task_id nullable + 加 meta / filename
    ("kb_sedimentation_draft", "kind", "VARCHAR(32) NOT NULL DEFAULT 'task_sediment'"),
    ("kb_sedimentation_draft", "proposed_filename", "VARCHAR(255)"),
    ("kb_sedimentation_draft", "meta", "JSON"),
    # v26.14-P5.1: 议程 进度 tracking — 让 议程 从 read-only strip 升级 推进式 流程
    #   current_agenda_idx: 当前 进行 到 第几项 (0-based); NULL = 议程 未设置 or 未进入
    #   agenda_progress: 各项 时间戳 [{ idx, started_at, ended_at, advanced_by_user_id, status }]
    ("meeting", "current_agenda_idx", "INTEGER"),
    ("meeting", "agenda_progress", "JSON"),
    # v27.0-mobile P19: 会议 brief (背景 / 目标 / 期望) — auto 模式必填
    ("meeting", "description", "TEXT"),
    # v27.0-mobile P21 (记忆模块金字塔): ai_insight 加沉淀状态字段
    #   worth_remembering: 会议结束时 AI 推荐"值得入记忆"标 true
    #   human_decision:    用户审批 pending/accepted/rejected, NULL = AI 还没推过
    ("ai_insight", "worth_remembering", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("ai_insight", "human_decision", "VARCHAR(16)"),
    # v26.14-P7.3: Memory 出处 链回 — 草稿 + 持久 memory 都加 source_line_ids
    #   行号 = meeting_transcript.id. 让 审批 / 入库 后 都 可 跳 实录 看 上下文.
    ("memory_draft", "source_line_ids", "JSON"),
    ("long_term_memory", "source_line_ids", "JSON"),
    # v26.14-P7.4: 拒绝 子类型 + 给 LLM 的 反馈
    #   rejection_kind: "discard" | "feedback"
    #   rejection_feedback: 用户 写 的 "为什么 这条 不准 / 错在哪"
    ("memory_draft", "rejection_kind", "VARCHAR(16)"),
    ("memory_draft", "rejection_feedback", "TEXT"),
    # v27.1 微信 OAuth: User 加 wx_openid + wx_unionid (一键登录映射).
    # 偏分唯一索引在 init_db 末尾 加 (NULL 允许多个, 非 NULL 唯一).
    ("user", "wx_openid", "VARCHAR(128)"),
    ("user", "wx_unionid", "VARCHAR(128)"),
    # v27.2 手机号 登录: 跟 email 并列, 11 位 CN 手机号 存原值 (无 +86 前缀).
    ("user", "phone", "VARCHAR(16)"),
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

        # 2. additive ALTERs for existing tables that gained columns.
        # v27.2 fix: 始终 "" 引号 包 table name. "user" 是 PG reserved keyword,
        # 不引号 会 ALTER TABLE user ADD ... 语法 错. 其他 表名 (meeting / agent
        # 等) 不是 keyword, 但 引号也 不影响 (PG 接受 mixed-case quoted).
        for table, col, spec in _COLUMN_MIGRATIONS:
            await conn.execute(
                text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS {col} {spec}')
            )

        # 2b. ALTER COLUMN TYPE for capacity extensions (idempotent — PG no-ops
        # when current type matches target).
        for table, col, spec in _COLUMN_TYPE_MIGRATIONS:
            await conn.execute(
                text(f'ALTER TABLE "{table}" ALTER COLUMN {col} TYPE {spec}')
            )

        # 2c. v26.13.2: KbSedimentationDraft.task_id 改 nullable — Perplexity 抓取
        # 草稿 没 关联 task. DROP NOT NULL 是 PG 幂等 op, 已 nullable 时 no-op.
        await conn.execute(text(
            "ALTER TABLE kb_sedimentation_draft ALTER COLUMN task_id DROP NOT NULL"
        ))

        # 3. drop legacy unique constraints (idempotent — IF EXISTS)
        for table, constraint in _LEGACY_CONSTRAINTS:
            await conn.execute(
                text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
            )

        # 3b-pre. v26.5 C7 follow-up:user.workspace_id 应当 SET NULL,不是 CASCADE.
        # 设计意图:user 是 跨 workspace 的 全局账号(可同时是 多个 ws 的 member),
        # 删 一个 workspace 时,该 ws 内 demo user 应该 user.workspace_id 设 null,
        # user 行保留;真正 删 user 走 scorched-earth Step 3 显式 delete.
        # 如果 v26.5 C7 第一版 错误加成了 CASCADE,这里 DROP + ADD SET NULL 校正.
        # (idempotent: 已经是 SET NULL 则 skip)
        await conn.execute(text("""
            DO $$
            DECLARE
                cn TEXT;
                current_rule TEXT;
            BEGIN
                SELECT tc.constraint_name, rc.delete_rule
                  INTO cn, current_rule
                  FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                       AND tc.constraint_schema = kcu.constraint_schema
                  JOIN information_schema.referential_constraints rc
                    ON tc.constraint_name = rc.constraint_name
                       AND tc.constraint_schema = rc.constraint_schema
                 WHERE kcu.table_name = 'user'
                   AND kcu.column_name = 'workspace_id'
                   AND tc.constraint_type = 'FOREIGN KEY'
                   AND tc.table_schema = 'public'
                 LIMIT 1;

                IF FOUND AND current_rule != 'SET NULL' THEN
                    EXECUTE format('ALTER TABLE "user" DROP CONSTRAINT %I', cn);
                    EXECUTE 'ALTER TABLE "user" ADD CONSTRAINT user_workspace_id_fk_set_null '
                            'FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE SET NULL';
                    RAISE NOTICE '[v26.5 C7 fix] user.workspace_id FK: % → SET NULL', current_rule;
                END IF;
            END $$;
        """))

        # 3b. v26.5 C7: 给 workspace_id 列 自动 补 FK + ON DELETE CASCADE.
        #
        # 背景: 早期 ALTER TABLE ADD COLUMN 加 workspace_id 列时, init_db 的
        # _COLUMN_MIGRATIONS 列表 只写了 列类型 (UUID), 没写 FK 约束.
        # 虽然 SQLAlchemy model 定义 了 ForeignKey + ondelete CASCADE,
        # 但 ALTER 加列 不会回填这个约束到 DB. 后果:
        #   - 删 workspace 时, 子表行 (meeting/agent/task/...) 不会 CASCADE 删
        #   - 产生 dangling 数据 + 应用层手工 cleanup + 合规风险 (GDPR 删除即删除)
        # v26.4 清空时实际暴露过: 删 40 个 workspace 后 84 行孤儿 (13 meeting +
        # 7 long_term_memory + 64 agent) 需手工 DELETE 才清掉.
        #
        # 本 migration idempotent + safe:
        #   1) 找所有 含 workspace_id 列且 缺 FK 的表
        #   2) 0 孤儿 → 自动 加 FK ON DELETE CASCADE
        #   3) 有 孤儿 → RAISE WARNING + skip (避免 DB 加 FK 时 报错让 backend 起不来)
        #      运维 看到 warning 后 手工 清孤儿 + 重启 backend 即自动补 FK
        await conn.execute(text("""
            DO $$
            DECLARE
                r RECORD;
                fk_exists BOOLEAN;
                orphan_count BIGINT;
            BEGIN
                FOR r IN
                    SELECT c.table_name
                      FROM information_schema.columns c
                     WHERE c.column_name = 'workspace_id'
                       AND c.table_schema = 'public'
                       AND c.table_name != 'workspace'
                       -- user 表特殊处理:由 step 3b-pre 加 SET NULL,不走 CASCADE
                       AND c.table_name != 'user'
                LOOP
                    -- 已有 FK constraint?
                    SELECT EXISTS(
                        SELECT 1
                          FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage kcu
                            ON tc.constraint_name = kcu.constraint_name
                               AND tc.constraint_schema = kcu.constraint_schema
                         WHERE tc.table_name = r.table_name
                           AND tc.constraint_type = 'FOREIGN KEY'
                           AND kcu.column_name = 'workspace_id'
                           AND tc.table_schema = 'public'
                    ) INTO fk_exists;

                    IF fk_exists THEN
                        CONTINUE;  -- 已有 FK 跳过
                    END IF;

                    -- 检查孤儿数量
                    EXECUTE format(
                        'SELECT COUNT(*) FROM %I WHERE workspace_id IS NOT NULL '
                        'AND workspace_id NOT IN (SELECT id FROM workspace)',
                        r.table_name
                    ) INTO orphan_count;

                    IF orphan_count > 0 THEN
                        RAISE WARNING
                            '[v26.5 C7] 表 % 有 % 行 workspace_id 孤儿, 跳过加 FK. '
                            '运维需手工清: DELETE FROM % WHERE workspace_id IS NOT NULL '
                            'AND workspace_id NOT IN (SELECT id FROM workspace);',
                            r.table_name, orphan_count, r.table_name;
                        CONTINUE;
                    END IF;

                    -- 加 FK ON DELETE CASCADE
                    EXECUTE format(
                        'ALTER TABLE %I ADD CONSTRAINT %I '
                        'FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE',
                        r.table_name,
                        r.table_name || '_workspace_id_fk_v26_5'
                    );
                    RAISE NOTICE '[v26.5 C7] 加 FK ON DELETE CASCADE → %.workspace_id', r.table_name;
                END LOOP;
            END $$;
        """))

        # 3c. v26.5 角色重设计:WorkspaceMembership.role 'expert' → 'manager'.
        # v21 expert 概念 (= 绑一个 AI 的科员) v26.5 升级成 manager (= 部门 AI 维护人,
        # 可管 1+ 个 AI, 通过 Agent.primary_user_id 反向查).
        # idempotent: 已 migrated 时 UPDATE 0 行,无副作用.
        res = await conn.execute(text("""
            UPDATE workspace_membership SET role = 'manager' WHERE role = 'expert'
        """))
        if res.rowcount and res.rowcount > 0:
            logger.info("[v26.5] 迁移 workspace_membership.role 'expert' → 'manager': %d 行", res.rowcount)

        # 3d. v26.5-02 P1: KB.owner_agent_id + LTM.agent_id 加 FK 约束.
        # 同样的理由 — ALTER ADD COLUMN 不会回填 FK, 需要这里显式补.
        # 都是 idempotent — 已有 FK 跳过.
        await conn.execute(text("""
            DO $$
            BEGIN
                -- KB.owner_agent_id → agent.id  ON DELETE SET NULL
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'knowledge_base'
                       AND kcu.column_name = 'owner_agent_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    -- 先清理孤儿 owner_agent_id (指向已删的 agent)
                    UPDATE knowledge_base SET owner_agent_id = NULL
                     WHERE owner_agent_id IS NOT NULL
                       AND owner_agent_id NOT IN (SELECT id FROM agent);
                    ALTER TABLE knowledge_base
                       ADD CONSTRAINT knowledge_base_owner_agent_fk_v26_5
                       FOREIGN KEY (owner_agent_id) REFERENCES agent(id)
                       ON DELETE SET NULL;
                    RAISE NOTICE '[v26.5-02a] 加 FK knowledge_base.owner_agent_id → agent ON DELETE SET NULL';
                END IF;

                -- LTM.agent_id → agent.id  ON DELETE CASCADE
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'long_term_memory'
                       AND kcu.column_name = 'agent_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    -- 清孤儿
                    DELETE FROM long_term_memory
                     WHERE agent_id IS NOT NULL
                       AND agent_id NOT IN (SELECT id FROM agent);
                    ALTER TABLE long_term_memory
                       ADD CONSTRAINT long_term_memory_agent_fk_v26_5
                       FOREIGN KEY (agent_id) REFERENCES agent(id)
                       ON DELETE CASCADE;
                    RAISE NOTICE '[v26.5-02b] 加 FK long_term_memory.agent_id → agent ON DELETE CASCADE';
                END IF;

                -- v26.5-Lineage: LTM.source_meeting_id → meeting.id  ON DELETE SET NULL
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'long_term_memory'
                       AND kcu.column_name = 'source_meeting_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    UPDATE long_term_memory SET source_meeting_id = NULL
                     WHERE source_meeting_id IS NOT NULL
                       AND source_meeting_id NOT IN (SELECT id FROM meeting);
                    ALTER TABLE long_term_memory
                       ADD CONSTRAINT long_term_memory_source_meeting_fk
                       FOREIGN KEY (source_meeting_id) REFERENCES meeting(id)
                       ON DELETE SET NULL;
                    RAISE NOTICE '[v26.5-Lineage] 加 FK long_term_memory.source_meeting_id';
                END IF;

                -- v26.5-Lineage: LTM.curated_by_user_id → user.id  ON DELETE SET NULL
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'long_term_memory'
                       AND kcu.column_name = 'curated_by_user_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    UPDATE long_term_memory SET curated_by_user_id = NULL
                     WHERE curated_by_user_id IS NOT NULL
                       AND curated_by_user_id NOT IN (SELECT id FROM "user");
                    ALTER TABLE long_term_memory
                       ADD CONSTRAINT long_term_memory_curated_by_fk
                       FOREIGN KEY (curated_by_user_id) REFERENCES "user"(id)
                       ON DELETE SET NULL;
                    RAISE NOTICE '[v26.5-Lineage] 加 FK long_term_memory.curated_by_user_id';
                END IF;

                -- v26.7-03: KnowledgeDocument.source_meeting_id → meeting.id  ON DELETE SET NULL
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'knowledge_document'
                       AND kcu.column_name = 'source_meeting_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    UPDATE knowledge_document SET source_meeting_id = NULL
                     WHERE source_meeting_id IS NOT NULL
                       AND source_meeting_id NOT IN (SELECT id FROM meeting);
                    ALTER TABLE knowledge_document
                       ADD CONSTRAINT knowledge_document_source_meeting_fk
                       FOREIGN KEY (source_meeting_id) REFERENCES meeting(id)
                       ON DELETE SET NULL;
                    RAISE NOTICE '[v26.7-03] 加 FK knowledge_document.source_meeting_id';
                END IF;

                -- v26.13.2-fix2: Agent.primary_user_id → user.id  ON DELETE SET NULL
                -- 早期 (v26.0) 加 primary_user_id 列 用 raw ALTER UUID, 没 加 FK.
                -- 历史 上 删 user 时 agent 没 自动 NULL, 导致 现在 创建 KbSedimentationDraft
                -- (primary_user_id=agent.primary_user_id) 时 FK violation 500.
                -- 修: 一次性 cleanup stale + 加 FK ON DELETE SET NULL, 一劳永逸.
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                           AND tc.constraint_schema = kcu.constraint_schema
                     WHERE tc.table_name = 'agent'
                       AND kcu.column_name = 'primary_user_id'
                       AND tc.constraint_type = 'FOREIGN KEY'
                       AND tc.table_schema = 'public'
                ) THEN
                    -- 清 stale primary_user_id (指向 不存在 user)
                    UPDATE agent SET primary_user_id = NULL
                     WHERE primary_user_id IS NOT NULL
                       AND primary_user_id NOT IN (SELECT id FROM "user");
                    ALTER TABLE agent
                       ADD CONSTRAINT agent_primary_user_fk_v26_13_2
                       FOREIGN KEY (primary_user_id) REFERENCES "user"(id)
                       ON DELETE SET NULL;
                    RAISE NOTICE '[v26.13.2-fix2] 加 FK agent.primary_user_id → user ON DELETE SET NULL';
                END IF;
            END $$;
        """))

        # 3e. v26.5-Lineage: 老 long_term_memory.agent_id 数据 → memory_agent_link
        # (Base.metadata.create_all 已经把 memory_agent_link 表建好了, 这里 一次性
        # 把老的单 agent_id 数据 写进 link 表 (is_primary=TRUE), 完事再 idempotent
        # — 已 link 过的 (memory_id, agent_id) 用 ON CONFLICT 跳过.
        await conn.execute(text("""
            INSERT INTO memory_agent_link (memory_id, agent_id, is_primary, created_at)
            SELECT id, agent_id, TRUE, created_at
              FROM long_term_memory
             WHERE agent_id IS NOT NULL
            ON CONFLICT (memory_id, agent_id) DO NOTHING
        """))

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

    # v27.0-mobile P8: 加索引 (idempotent CREATE INDEX IF NOT EXISTS)
    # MeetingAttendee.meeting_id / agent_id 之前只有 (meeting_id, user_id)
    # unique constraint, 对 group by agent_id 等查询 缺索引 → 全表扫.
    # mobile /api/m/agents/workboard 实测 3.4s, 这是根因之一.
    async with engine.begin() as conn:
        for sql in [
            "CREATE INDEX IF NOT EXISTS ix_meeting_attendee_agent_id ON meeting_attendee (agent_id) WHERE agent_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS ix_meeting_attendee_meeting_id ON meeting_attendee (meeting_id)",
            "CREATE INDEX IF NOT EXISTS ix_meeting_attendee_user_id ON meeting_attendee (user_id) WHERE user_id IS NOT NULL",
            # v27.1 微信 OAuth: wx_openid 偏分 unique index (NULL 多, 非 NULL 唯一).
            # 用 WHERE 子句 partial index, 避免 NULL 触发 unique violation.
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_wx_openid ON "user" (wx_openid) WHERE wx_openid IS NOT NULL',
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_wx_unionid ON "user" (wx_unionid) WHERE wx_unionid IS NOT NULL',
            # v27.2 phone 登录: phone 偏分 unique index (同 wx_openid 模式).
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_phone ON "user" (phone) WHERE phone IS NOT NULL',
        ]:
            try:
                await conn.execute(text(sql))
            except Exception:
                logger.exception("create index failed: %s", sql)

    logger.info("DB schema ensured")
