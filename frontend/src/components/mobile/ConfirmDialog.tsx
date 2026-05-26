"use client";

/**
 * v27.0-mobile · 极简确认对话框 — 用于结束会议等不可逆操作.
 *
 * 不依赖第三方 — 居中浮窗 + 遮罩.
 *
 * v1.4.0 Saga L · 浅色化 (跟 PrivacyConsent / TaskCard 一致 iOS 浅色).
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

  // iOS 系统色: danger=红 #FF3B30, default=蓝 #007AFF
  const confirmBg = danger ? "#FF3B30" : "#007AFF";
  const confirmActiveBg = danger ? "#D32F2A" : "#0051D5";
  const confirmShadow = danger
    ? "0 4px 12px rgba(255,59,48,0.30)"
    : "0 4px 12px rgba(0,122,255,0.30)";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" data-testid="mobile-confirm-dialog">
      <button
        type="button"
        aria-label="关闭"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white"
        role="dialog"
        aria-modal="true"
        style={{
          border: "0.5px solid rgba(60,60,67,0.12)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
        }}
      >
        <div className="p-5">
          <h2 className="text-[18px] font-semibold text-[#1C1C1E]">{title}</h2>
          {body ? (
            <p className="mt-2 text-[14px] leading-relaxed text-[#3C3C43]">{body}</p>
          ) : null}
        </div>
        <div
          className="flex gap-2 px-4 py-3"
          style={{ borderTop: "0.5px solid rgba(60,60,67,0.12)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white px-4 text-[15px] text-[#1C1C1E] active:scale-[0.98] active:bg-[#F2F2F7] disabled:opacity-50"
            style={{ border: "0.5px solid rgba(60,60,67,0.18)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-[15px] font-medium text-white active:scale-[0.98] disabled:opacity-60"
            style={{
              background: confirmBg,
              boxShadow: confirmShadow,
              transition: "background 120ms",
            }}
            onMouseDown={(e) => {
              if (!busy) e.currentTarget.style.background = confirmActiveBg;
            }}
            onMouseUp={(e) => {
              if (!busy) e.currentTarget.style.background = confirmBg;
            }}
            onMouseLeave={(e) => {
              if (!busy) e.currentTarget.style.background = confirmBg;
            }}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
