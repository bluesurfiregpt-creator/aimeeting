"use client";

/**
 * v27.0-mobile · 等我处理单卡.
 *
 * 三种 kind 用不同状态 chip + 跳转:
 *   confirm        ⏳ 待确认 (任务) — amber chip, 跳 /m/tasks/[id]
 *   approve_draft  📝 待审 (Memory 草稿) — accent chip, 跳 /m/insights (待审 tab)
 *   blocked        🚨 阻塞 — rose chip, 跳 /m/tasks/[id]
 *
 * Phase 1 不做内嵌 CTA 操作 (那是 Phase 2 — sheet 弹起配决策).
 * 卡整个点跳二级页. CTA 文字是 hint.
 */

import Link from "next/link";
import { AIInsightChip } from "./AIInsightCard";
import type { WorkbenchPendingTask } from "@/lib/mobile/types";

type StatusStyle = {
  icon: string;
  label: string;
  chipBg: string;
  chipText: string;
  href: (id: string) => string;
};

const STYLES: Record<WorkbenchPendingTask["kind"], StatusStyle> = {
  confirm: {
    icon: "⏳",
    label: "待确认",
    chipBg: "bg-amber-500/15",
    chipText: "text-amber-200",
    href: (id) => `/m/tasks/${id}`,
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-200",
    href: () => `/m/insights`,
  },
  blocked: {
    icon: "🚨",
    label: "阻塞",
    chipBg: "bg-rose-500/15",
    chipText: "text-rose-200",
    href: (id) => `/m/tasks/${id}`,
  },
};

export default function PendingItemCard({ item }: { item: WorkbenchPendingTask }) {
  const s = STYLES[item.kind];
  return (
    <Link
      href={s.href(item.id)}
      className="block rounded-xl border border-ink-700 bg-ink-900 p-4 transition active:scale-[0.99]"
      data-testid={`mobile-pending-card-${item.kind}`}
    >
      <header className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium ${s.chipBg} ${s.chipText}`}>
          <span>{s.icon}</span>
          <span>{s.label}</span>
        </span>
        {item.source_meeting_title ? (
          <span className="truncate text-[13px] text-zinc-400">
            · {item.source_meeting_title}
          </span>
        ) : null}
      </header>

      <p className="mt-2 text-[16px] font-medium text-zinc-50 leading-snug">{item.title}</p>

      {item.insights.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3">
          <p className="text-[13px] font-medium text-violet-300">
            💡 AI 智囊 · {item.insights.length} 条
          </p>
          {item.insights.map((ins) => (
            <AIInsightChip key={ins.id} insight={ins} />
          ))}
        </div>
      ) : null}

      <footer className="mt-3 text-right">
        <span className="text-[14px] font-medium text-accent-300">{item.cta_label} →</span>
      </footer>
    </Link>
  );
}
