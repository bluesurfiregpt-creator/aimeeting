"use client";

import { useEffect, useState } from "react";
import { toast, type ToastEntry } from "@/lib/toast";

const TONE: Record<ToastEntry["kind"], { bg: string; ring: string; icon: string }> = {
  info:    { bg: "bg-ink-900",        ring: "border-ink-700",         icon: "ℹ️" },
  success: { bg: "bg-emerald-500/10", ring: "border-emerald-500/40",  icon: "✅" },
  warn:    { bg: "bg-amber-500/10",   ring: "border-amber-500/40",    icon: "⚠️" },
  error:   { bg: "bg-rose-500/10",    ring: "border-rose-500/40",     icon: "❌" },
};

export default function Toaster() {
  const [items, setItems] = useState<ToastEntry[]>([]);
  useEffect(() => toast.subscribe(setItems), []);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => {
        const tone = TONE[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border ${tone.ring} ${tone.bg} px-3 py-2 shadow-lg backdrop-blur`}
          >
            <span className="text-base leading-none">{tone.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-zinc-100">{t.message}</div>
              {t.detail && (
                <div className="mt-1 break-words text-xs text-zinc-400">{t.detail}</div>
              )}
            </div>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-xs text-zinc-500 hover:text-white"
              title="关闭"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
