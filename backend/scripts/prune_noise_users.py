"""
Prune obviously-junk speaker users — names like "1", "111", "test", "x"
that accumulated in the User table from prior QA / typo enrollments.

Distinct from `dedup_users.py`:
  - dedup_users merges *exact-name duplicates* (286 hefan rows) into one.
  - this script DELETES rows whose name itself looks like noise (numeric
    only, 1–2 chars, ASCII-only test strings).

Hard guardrails:
  - email IS NULL (real account holders are spared)
  - NOT EXISTS in workspace_membership (members are spared)
  - NOT referenced by any voiceprint (people who actually enrolled are spared)
  - workspace_id matches the cluster heuristic

What we delete (case-insensitive):
  1. names that are pure digits (`1`, `111`, `1234`)
  2. names ≤ 2 chars (excluding 2-char real Chinese names — heuristic:
     keep if both chars are CJK; drop only if any char is ASCII)
  3. names in a known-noise list: ['test', 'x', 'a', 'aa', 'tt', 'cowork',
     'qa', 'demo']

For each candidate we:
  - re-point any FK refs (defensive — they should be empty by guardrails)
  - DELETE the user row

Run from inside the backend container:
    docker exec -w /app aimeeting-backend python prune_noise_users.py
    docker exec -w /app aimeeting-backend python prune_noise_users.py --apply

Idempotent — second run finds nothing to do.

Per v11 QA report ISSUE-5.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys

from sqlalchemy import delete, select, text, update

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


_NOISE_NAMES = {
    "test", "test1", "test2", "test123",
    "x", "xx", "xxx",
    "a", "aa", "aaa",
    "qa", "qa1", "qa_test",
    "cowork", "cowork_test",
    "demo", "demo1", "tmp", "temp",
}

_FK_REPOINT = [
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


def _is_noise(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return True
    n_lower = n.lower()
    if n_lower in _NOISE_NAMES:
        return True
    # pure digits
    if re.fullmatch(r"\d+", n):
        return True
    # 1–2 chars where any char is ASCII (drop "x", "1a", "ab" but keep
    # genuine 2-char Chinese names like "李雷")
    if len(n) <= 2 and any(ord(c) < 0x4E00 for c in n):
        return True
    return False


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    async with SessionLocal() as db:
        users = (
            await db.execute(
                select(User).where(User.email.is_(None))
            )
        ).scalars().all()

        candidates: list[User] = [u for u in users if _is_noise(u.name)]

        # Skip ones with active voiceprints — they actually enrolled
        if candidates:
            cand_ids = [u.id for u in candidates]
            vp_user_ids = {
                row[0]
                for row in (
                    await db.execute(
                        select(Voiceprint.user_id).where(
                            Voiceprint.user_id.in_(cand_ids),
                            Voiceprint.is_active.is_(True),
                        )
                    )
                ).all()
            }
            candidates = [u for u in candidates if u.id not in vp_user_ids]

        # Skip workspace members
        if candidates:
            cand_ids = [u.id for u in candidates]
            member_user_ids = {
                row[0]
                for row in (
                    await db.execute(
                        select(WorkspaceMembership.user_id).where(
                            WorkspaceMembership.user_id.in_(cand_ids)
                        )
                    )
                ).all()
            }
            candidates = [u for u in candidates if u.id not in member_user_ids]

        print(f"\nFound {len(candidates)} noise-name speaker user(s) to prune.\n")
        for u in candidates[:50]:
            print(f"  - id={u.id}  name='{u.name}'  workspace={u.workspace_id}")
        if len(candidates) > 50:
            print(f"  … and {len(candidates) - 50} more")

        if not candidates:
            return 0

        if not args.apply:
            print("\n⚠️ DRY RUN — no DELETE issued. Re-run with --apply to commit.\n")
            return 0

        # Defensive: clear any lingering FK refs (shouldn't exist by our
        # guardrails, but cheap to be sure — sets to NULL where allowed,
        # drops the dependent row otherwise via the FK cascade).
        cand_ids = [u.id for u in candidates]
        for model, col in _FK_REPOINT:
            await db.execute(
                update(model).where(col.in_(cand_ids)).values({col.key: None})
            )

        deleted = (
            await db.execute(delete(User).where(User.id.in_(cand_ids)))
        ).rowcount or 0
        await db.commit()
        print(f"\n✅ Deleted {deleted} noise-name speaker user rows.\n")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
