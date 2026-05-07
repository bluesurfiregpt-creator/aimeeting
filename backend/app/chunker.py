"""
Recursive character-based chunker tuned for Chinese + English mixed text.

Why not LangChain's splitter: too heavy a dependency for one function.
Behaviour we need:
- target ~500 chars per chunk; 50 chars overlap
- prefer to split at paragraph boundaries (double newline) > line breaks >
  Chinese sentence terminators (。！？) > English sentence terminators
  (.!?) > Chinese commas (，) > spaces > raw character splits
- never produce empty chunks
"""

from __future__ import annotations

from typing import Sequence


DEFAULT_TARGET_CHARS = 500
DEFAULT_OVERLAP_CHARS = 50

# Ordered from "highest level" to "lowest level" boundary. We try to cut
# at the highest-level boundary that sits within the target window.
_SEPARATORS: Sequence[str] = (
    "\n\n",
    "\n",
    "。", "！", "？",
    ". ", "! ", "? ",
    "；", "; ",
    "，", ", ",
    " ",
    "",  # last resort: hard cut
)


def split_text(
    text: str,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[str]:
    if not text:
        return []
    text = text.strip()
    if len(text) <= target_chars:
        return [text]

    # Walk the string, taking a target-sized window each step, then back
    # off to the highest-level separator inside the window.
    chunks: list[str] = []
    cursor = 0
    n = len(text)

    while cursor < n:
        end = min(n, cursor + target_chars)
        if end >= n:
            chunks.append(text[cursor:end].strip())
            break

        window = text[cursor:end]
        # Find the best split inside `window`
        cut_at = _best_cut(window)
        if cut_at <= 0:
            # No good boundary found — hard cut at target_chars
            cut_at = len(window)

        chunk = window[:cut_at].strip()
        if chunk:
            chunks.append(chunk)

        # Step forward: cursor advances by (cut_at - overlap), but always
        # at least 1 char to avoid infinite loop on pathological inputs.
        step = max(1, cut_at - overlap_chars)
        cursor += step

    # Drop empties (overlap math can occasionally produce a duplicate-empty)
    return [c for c in chunks if c]


def _best_cut(window: str) -> int:
    """
    Return the position where we should cut inside `window`. We look for
    each separator in order from highest-level to lowest, taking the
    last occurrence inside the window so we get a roughly-target-sized
    chunk rather than a tiny one.
    """
    for sep in _SEPARATORS:
        if sep == "":
            return len(window)
        idx = window.rfind(sep)
        if idx > 0:
            # Cut AFTER the separator so the chunk ends naturally.
            return idx + len(sep)
    return len(window)
