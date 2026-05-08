"""
One-off cleanup: consolidate duplicate speaker users created by the pre-v9
enroll endpoint.

Background: before v9, `POST /api/users` would unconditionally INSERT a new
row when called without an email. Every voiceprint enrollment hit that
path → ended up with 286 user rows named "hefan" in the default workspace,
each linked to its own voiceprint / attendee / transcript references.

The v9 fix made `POST /api/users` find-or-create by (workspace, name) when
email is empty, so this stops growing. But existing duplicates need to be
merged. That's this script.

Algorithm (atomic, idempotent):
  1. Group user rows by (workspace_id, lower(name)) where email IS NULL.
  2. For each cluster with >1 row:
     - Pick the OLDEST row as canonical.
     - Re-point every known user_id FK column from siblings → canonical.
     - DELETE sibling user rows.
  3. Commit at the end (or rollback the entire pass on any error).

What gets re-pointed:
  - voiceprint.user_id
  - meeting_attendee.user_id
  - meeting_transcript.speaker_user_id
  - meeting_speaker_segment.user_id
  - workspace_membership.user_id        (rare for speaker-only users)
  - workspace_invitation.created_by_user_id, accepted_by_user_id
  - password_reset_token.user_id        (rare for speaker-only users)
  - audit_log.user_id                   (rare for speaker-only users)

Usage:
    # Inside the backend container (or with the venv active locally):
    python -m scripts.dedup_users           # dry run (default; nothing committed)
    python -m scripts.dedup_users --apply   # actually merge + delete

Run more than once safely — second run will find zero clusters.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict

from sqlalchemy import select, update, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import (
    AuditLog,
    MeetingAttendee,
    MeetingSpeakerSegment,
    MeetingTranscript,
    PasswordResetToken,
    User,
    Voiceprint,
    WorkspaceInvitation,
    WorkspaceMembership,
)


# (model, FK column) tuples to repoint. Order matters only for
# readability — we update them all in one transaction.
FK_REPOINT = [
    (Voiceprint, Voiceprint.user_id),
    (MeetingAttendee, MeetingAttendee.user_id),
    (MeetingTranscript, MeetingTranscript.speaker_user_id),
    (MeetingSpeakerSegment, MeetingSpeakerSegment.user_id),
    (WorkspaceMembership, WorkspaceMembership.user_id),
    (WorkspaceInvitation, WorkspaceInvitation.created_by_user_id),
    (WorkspaceInvitation, WorkspaceInvitation.accepted_by_user_id),
    (PasswordResetToken, PasswordResetToken.user_id),
    (AuditLog, AuditLog.user_id),
]


async def consolidate(session: AsyncSession, apply: bool) -> dict[str, int]:
    """Merge duplicates. Returns counts so callers / CI can assert results."""
    rows = (
        await session.execute(
            select(User.id, User.name, User.workspace_id, User.email, User.created_at)
            .where(User.email.is_(None))
            .order_by(User.workspace_id, User.name, User.created_at)
        )
    ).all()

    # Group by (workspace_id, lower(name))
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        key = (r.workspace_id, (r.name or "").strip().lower())
        groups[key].append(r)

    clusters = [(k, v) for k, v in groups.items() if len(v) > 1]
    total_dups = sum(len(v) - 1 for _, v in clusters)

    print(f"\nFound {len(clusters)} duplicate cluster(s), {total_dups} total siblings to merge.")
    if not clusters:
        return {"clusters": 0, "siblings_merged": 0, "rows_repointed": 0, "users_deleted": 0}

    # Show the top 5 clusters
    for (ws, name_lc), rs in sorted(clusters, key=lambda x: -len(x[1]))[:5]:
        print(f"  - workspace={ws} name='{rs[0].name}' → {len(rs)} rows (canonical id={rs[0].id})")

    rows_repointed = 0
    users_deleted = 0

    for (ws, name_lc), rs in clusters:
        canonical = rs[0]  # oldest by created_at
        sibling_ids = [r.id for r in rs[1:]]
        if not sibling_ids:
            continue

        # Re-point every FK column
        for model, col in FK_REPOINT:
            stmt = (
                update(model)
                .where(col.in_(sibling_ids))
                .values({col.key: canonical.id})
                .execution_options(synchronize_session=False)
            )
            r = await session.execute(stmt)
            rows_repointed += r.rowcount or 0

        # Now delete the orphaned User rows
        del_stmt = delete(User).where(User.id.in_(sibling_ids))
        r = await session.execute(del_stmt)
        users_deleted += r.rowcount or 0

    if apply:
        await session.commit()
        print(f"\n✅ Committed: repointed {rows_repointed} FK rows, deleted {users_deleted} user rows.")
    else:
        await session.rollback()
        print(
            f"\n⚠️ DRY RUN — rolled back. Would have repointed "
            f"{rows_repointed} FK rows, deleted {users_deleted} user rows."
            f"\n   Re-run with --apply to commit."
        )

    return {
        "clusters": len(clusters),
        "siblings_merged": total_dups,
        "rows_repointed": rows_repointed,
        "users_deleted": users_deleted,
    }


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually commit the merge (default is dry-run)")
    args = parser.parse_args()

    async with SessionLocal() as session:
        # Print before-stats from a quick raw SQL count grouped by name
        before = (
            await session.execute(
                text(
                    "SELECT COUNT(*) AS total, "
                    "COUNT(DISTINCT (workspace_id, lower(name))) AS distinct_clusters "
                    'FROM "user" WHERE email IS NULL'
                )
            )
        ).one()
        print(f"BEFORE: {before.total} email-less user rows in {before.distinct_clusters} (workspace,name) clusters.")

        await consolidate(session, args.apply)

        if args.apply:
            after = (
                await session.execute(
                    text(
                        "SELECT COUNT(*) AS total, "
                        "COUNT(DISTINCT (workspace_id, lower(name))) AS distinct_clusters "
                        'FROM "user" WHERE email IS NULL'
                    )
                )
            ).one()
            print(f"AFTER:  {after.total} rows in {after.distinct_clusters} clusters.")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
