"use client";

/**
 * v27.0-mobile · 等我处理单卡.
 *
 * 三种 kind 用不同状态 chip + 跳转:
 *   confirm        ⏳ 待确认 (任务) — orange chip, 跳 /m/tasks/[id]
 *   approve_draft  📝 待审 (Memory 草稿) — blue chip, 跳 /m/insights (待审 tab)
 *   blocked        🚨 阻塞 — red chip, 跳 /m/tasks/[id]
 *
 * Phase 1 不做内嵌 CTA 操作 (那是 Phase 2 — sheet 弹起配决策).
 * 卡整个点跳二级页. CTA 文字是 hint.
 *
 * v1.4.0 Saga L · 浅色化 (iOS 浅色, 跟 TaskCard 一致).
 */

import Link from "next/link";
import { AIInsightChip } from "./AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
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
    chipBg: "rgba(255,159,10,0.12)",
    chipText: MR_COLORS.systemOrange,
    href: (id) => `/m/tasks/${id}`,
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
    href: () => `/m/insights`,
  },
  blocked: {
    icon: "🚨",
    label: "阻塞",
    chipBg: "rgba(255,59,48,0.10)",
    chipText: MR_COLORS.systemRed,
    href: (id) => `/m/tasks/${id}`,
  },
};

export default function PendingItemCard({ item }: { item: WorkbenchPendingTask }) {
  const s = STYLES[item.kind];
  return (
    <Link
      href={s.href(item.id)}
      className="block rounded-xl p-4 transition active:scale-[0.99]"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid={`mobile-pending-card-${item.kind}`}
    >
      <header className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
          style={{ background: s.chipBg, color: s.chipText }}
        >
          <span>{s.icon}</span>
          <span>{s.label}</span>
        </span>
        {item.source_meeting_title ? (
          <span
            className="truncate text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            · {item.source_meeting_title}
          </span>
        ) : null}
      </header>

      <p
        className="mt-2 text-[16px] font-medium leading-snug"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {item.title}
      </p>

      {item.insights.length > 0 ? (
        <div
          className="mt-3 space-y-2 rounded-xl p-3"
          style={{
            background: "rgba(94,92,230,0.06)",
            border: "0.5px solid rgba(94,92,230,0.25)",
          }}
        >
          <p
            className="text-[13px] font-medium"
            style={{ color: MR_COLORS.systemPurple }}
          >
            💡 AI 智囊 · {item.insights.length} 条
          </p>
          {item.insights.map((ins) => (
            <AIInsightChip key={ins.id} insight={ins} />
          ))}
        </div>
      ) : null}

      <footer className="mt-3 text-right">
        <span
          className="text-[14px] font-medium"
          style={{ color: MR_COLORS.systemBlue }}
        >
          {item.cta_label} →
        </span>
      </footer>
    </Link>
  );
}
