"use client";

/**
 * v27.0-mobile · Phase 4 · 简易 toast.
 *
 * 不引第三方 — 极轻量. 调用方控制显隐 (传 onClose), 自动 2.5s 关.
 * 视觉: 浮于底部, sticky bar 之上.
 */

import { useEffect } from "react";

export default function Toast({
  kind,
  text,
  duration = 2500,
  onClose,
}: {
  kind: "success" | "error";
  text: string;
  duration?: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  const tone =
    kind === "success"
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
      : "border-rose-500/40 bg-rose-500/15 text-rose-100";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="mobile-toast"
    >
      <div
        className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-[14px] font-medium shadow-lg backdrop-blur ${tone}`}
        role="status"
        onClick={onClose}
      >
        {kind === "success" ? "✓ " : "⚠ "}
        {text}
      </div>
    </div>
  );
}
