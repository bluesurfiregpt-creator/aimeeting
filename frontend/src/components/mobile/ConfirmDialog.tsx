"use client";

/**
 * v27.0-mobile · 极简确认对话框 — 用于结束会议等不可逆操作.
 *
 * 不依赖第三方 — 居中浮窗 + 遮罩.
 */

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger=true → confirm 按钮变红色, 暗示破坏性操作. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const confirmCls = danger
    ? "bg-rose-500 active:bg-rose-600 shadow-rose-500/20"
    : "bg-accent-500 active:bg-accent-600 shadow-accent-500/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" data-testid="mobile-confirm-dialog">
      <button
        type="button"
        aria-label="关闭"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-ink-800 bg-ink-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5">
          <h2 className="text-[18px] font-semibold text-zinc-50">{title}</h2>
          {body ? (
            <p className="mt-2 text-[14px] leading-relaxed text-zinc-300">{body}</p>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-ink-800 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[15px] text-zinc-200 active:scale-[0.98] active:bg-ink-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-[15px] font-medium text-white shadow-lg active:scale-[0.98] disabled:opacity-60 ${confirmCls}`}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
