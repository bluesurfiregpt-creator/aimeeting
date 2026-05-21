"""
cleanup_demo_data.py — 客户演示前清场.

清:
  - 所有业务数据 (会议 / 转录 / AI 发言 / 待办 / 任务 / 附件 /
    insight / memory / 草稿 / 声纹 / 通知 / 审计日志 / 访问申请)
  - OSS 上对应的录音 / 附件 / 声纹样本

保留:
  - 用户账号 (user 表)
  - 工作区 + 角色 (workspace / workspace_membership)
  - AI 专家配置 (agent) + 头像 (OSS agents/ 前缀)
  - 知识库 + 文档 + chunks (knowledge_base / knowledge_document / knowledge_chunk)
  - LLM provider 配置 (model_provider_config)
  - ASR 词典 (asr_vocabulary)

用法 (在 生产服务器 上 跑):
  # 1. dry-run 看会清多少 (推荐先跑这个)
  python3 -m backend.scripts.cleanup_demo_data --dry-run

  # 2. 实际清, 必须显式 --confirm-i-mean-it
  python3 -m backend.scripts.cleanup_demo_data --confirm-i-mean-it

  # 跳过 OSS (只清 DB)
  python3 -m backend.scripts.cleanup_demo_data --confirm-i-mean-it --skip-oss

警告:
  本脚本不可逆. 跑前必做 pg_dump 备份.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 引项目根 (cleanup 这个脚本可能被 docker exec 跑或本地直跑)
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.app.db import SessionLocal  # noqa: E402
from backend.app.oss_client import OSSClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logger = logging.getLogger('cleanup')


# 清的表 (按依赖顺序, 子表在前 父表在后 — 即使有 ON DELETE CASCADE 也显式删)
TABLES_TO_TRUNCATE = [
    # 会议产物 — 最底层 子表
    "meeting_consensus",
    "meeting_speaker_segment",
    "meeting_agent_message",
    "meeting_transcript",
    "meeting_attachment",
    "meeting_attendee",
    "meeting_action_item",

    # 记忆 / 智囊产物
    "ai_insight",
    "memory_agent_link",
    "memory_draft",
    "long_term_memory",
    "kb_sedimentation_draft",

    # 任务
    "task",

    # 会议主表 (放在 meeting_* 子表之后)
    "meeting",

    # 声纹 (用户的, 但用户重新录即可)
    "voiceprint",

    # 通知 + 审计
    "notification",
    "audit_log",

    # 数据访问申请
    "data_access_request",
]


OSS_PREFIXES_TO_DELETE = [
    "meetings/",            # 会议录音
    "meeting-attachments/", # 会议附件
    "voiceprints/",         # 声纹样本
    # 注意: agents/ 不在这里 — AI 头像保留
]


async def count_table(db: AsyncSession, tbl: str) -> int:
    """SELECT COUNT(*) FROM <tbl>. 表不存在时返 -1."""
    try:
        res = await db.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
        return res.scalar_one()
    except Exception as e:
        logger.warning("  count %s failed: %s", tbl, e)
        return -1


async def truncate_table(db: AsyncSession, tbl: str) -> int:
    """实际清表. 用 TRUNCATE (比 DELETE 快, 自动重置 sequence).
    返回 truncate 前的行数."""
    n = await count_table(db, tbl)
    if n <= 0:
        return n
    await db.execute(text(f"TRUNCATE TABLE {tbl} RESTART IDENTITY CASCADE"))
    return n


async def clean_db(dry_run: bool):
    total_rows = 0
    async with SessionLocal() as db:
        if dry_run:
            logger.info("=== DB Dry-Run (不真清, 仅 报 行数) ===")
            for tbl in TABLES_TO_TRUNCATE:
                n = await count_table(db, tbl)
                if n >= 0:
                    logger.info("  %-30s %d 行", tbl, n)
                    total_rows += n
            logger.info("DB 总计 %d 行 待清", total_rows)
        else:
            logger.info("=== DB 实际清场 ===")
            for tbl in TABLES_TO_TRUNCATE:
                n = await truncate_table(db, tbl)
                if n > 0:
                    logger.info("  ✓ %-30s 清 %d 行", tbl, n)
                    total_rows += n
                elif n == 0:
                    logger.info("  · %-30s 空表, 跳过", tbl)
            await db.commit()
            logger.info("DB 总计 清 %d 行", total_rows)
    return total_rows


def list_oss_keys_by_prefix(oss: OSSClient, prefix: str) -> Iterable[str]:
    """列 OSS 上某前缀下所有 object key."""
    if not oss.configured:
        return []
    import oss2
    for o in oss2.ObjectIterator(oss._bucket, prefix=prefix):
        yield o.key


def clean_oss(dry_run: bool):
    oss = OSSClient()
    if not oss.configured:
        logger.warning("=== OSS 未配置, 跳过 OSS 清场 ===")
        return 0

    total_objs = 0
    for prefix in OSS_PREFIXES_TO_DELETE:
        if dry_run:
            logger.info("=== OSS Dry-Run: %s ===", prefix)
            count = 0
            for key in list_oss_keys_by_prefix(oss, prefix):
                count += 1
                if count <= 3:
                    logger.info("  (example) %s", key)
            logger.info("  共 %d 个对象 待清", count)
            total_objs += count
        else:
            logger.info("=== OSS 清场: %s ===", prefix)
            # 批量删 — OSS SDK 一次最多 1000 个
            BATCH = 500
            keys_batch: list[str] = []
            count = 0
            for key in list_oss_keys_by_prefix(oss, prefix):
                keys_batch.append(key)
                if len(keys_batch) >= BATCH:
                    oss._bucket.batch_delete_objects(keys_batch)
                    count += len(keys_batch)
                    logger.info("  ✓ 已删 %d (累计 %d)", len(keys_batch), count)
                    keys_batch = []
            if keys_batch:
                oss._bucket.batch_delete_objects(keys_batch)
                count += len(keys_batch)
                logger.info("  ✓ 已删 %d (累计 %d)", len(keys_batch), count)
            total_objs += count
    return total_objs


async def main():
    parser = argparse.ArgumentParser(description='演示前清场 — 业务数据 + OSS')
    parser.add_argument('--dry-run', action='store_true',
                       help='仅报会清多少, 不真清')
    parser.add_argument('--confirm-i-mean-it', action='store_true',
                       help='跳过最后确认 (不可恢复操作), 直接执行')
    parser.add_argument('--skip-oss', action='store_true',
                       help='只清 DB, 不清 OSS')
    args = parser.parse_args()

    if not args.dry_run and not args.confirm_i_mean_it:
        logger.error("不允许直接清. 加 --dry-run 看一眼, 或 --confirm-i-mean-it 真清.")
        sys.exit(1)

    if not args.dry_run:
        logger.warning("⚠️  本次将真删数据库 + OSS 对象, 不可恢复!")
        logger.warning("请确认已 pg_dump 备份. 5 秒后开始, Ctrl+C 中止.")
        import time
        time.sleep(5)

    logger.info("开始: dry_run=%s, skip_oss=%s", args.dry_run, args.skip_oss)
    db_rows = await clean_db(args.dry_run)
    oss_objs = 0
    if not args.skip_oss:
        oss_objs = clean_oss(args.dry_run)

    logger.info("=" * 60)
    logger.info("汇总: DB %d 行 + OSS %d 对象 %s",
               db_rows, oss_objs,
               '(dry-run, 未执行)' if args.dry_run else '已清')


if __name__ == '__main__':
    asyncio.run(main())
