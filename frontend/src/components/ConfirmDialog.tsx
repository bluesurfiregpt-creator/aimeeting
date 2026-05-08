"use client";

import { useEffect } from "react";

/**
 * Generic in-app confirmation dialog. Replaces `window.confirm()`, which:
 *   - blocks Chrome MCP / Playwright / any automation runner (the native
 *     dialog isn't reachable through the page DOM)
 *   - looks ugly and can't be branded / localized cleanly
 *   - was inconsistently used (some delete flows already had custom modals)
 *
 * Usage:
 *
 *   const [confirming, setConfirming] = useState<{ id: string } | null>(null);
 *   ...
 *   <ConfirmDialog
 *     open={confirming !== null}
 *     title="确认删除"
 *     body="这条记录会立刻消失，且不可恢复。"
 *     confirmLabel="删除"
 *     danger
 *     onConfirm={() => { actuallyDelete(confirming!.id); setConfirming(null); }}
 *     onCancel={() => setConfirming(null)}
 *   />
 *
 * The dialog renders only when `open` is true and traps Escape to dismiss.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="text-base font-medium text-white"
        >
          {title}
        </h2>
        <div className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="confirm-dialog-cancel"
            className="rounded-lg border border-ink-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-ink-800 transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            data-testid="confirm-dialog-confirm"
            className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white shadow transition ${
              danger
                ? "bg-rose-500 hover:bg-rose-400"
                : "bg-accent-500 hover:bg-accent-400"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
