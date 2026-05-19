"use client";

/**
 * v27.0-mobile · 任务卡 (两形态).
 *
 * - <TaskCardFull />    完整 — pending 组用. 含 AI 智囊紧凑 box + 双 CTA
 * - <TaskRowCompact />  紧凑单行 — tracking / done 组用. 仅状态 + title + age
 */

import { AIInsightChip, AgentLabel, TypeChip } from "./AIInsightCard";
import type { MobileTaskItem, MobileTaskKind } from "@/lib/mobile/types";

// ---------- kind → 视觉配 ------------------------------------------------

type KindStyle = {
  icon: string;
  label: string;
  chipBg: string;
  chipText: string;
  cardBorder: string;
  cardBg: string;
};

const KIND_STYLE: Record<MobileTaskKind, KindStyle> = {
  confirm: {
    icon: "⏳",
    label: "待确认",
    chipBg: "bg-amber-500/15",
    chipText: "text-amber-200",
    cardBorder: "border-amber-500/25",
    cardBg: "bg-ink-900",
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-200",
    cardBorder: "border-accent-500/25",
    cardBg: "bg-ink-900",
  },
  tracking: {
    icon: "·",
    label: "跟踪中",
    chipBg: "bg-zinc-800",
    chipText: "text-zinc-400",
    cardBorder: "border-ink-800",
    cardBg: "bg-ink-900/60",
  },
  done: {
    icon: "✓",
    label: "已完成",
    chipBg: "bg-emerald-500/10",
    chipText: "text-emerald-300/80",
    cardBorder: "border-ink-800",
    cardBg: "bg-ink-900/40",
  },
};

// ---------- 完整卡 (pending 组用) ---------------------------------------

export function TaskCardFull({
  item,
  busy = false,
  onPrimary,
  onSecondary,
}: {
  item: MobileTaskItem;
  busy?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const s = KIND_STYLE[item.kind];
  return (
    <article
      className={`rounded-2xl border ${s.cardBorder} ${s.cardBg} p-4`}
      data-testid={`mobile-task-card-${item.kind}`}
    >
      {/* header — 状态 chip + 来源 */}
      <header className="flex items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium ${s.chipBg} ${s.chipText}`}
        >
          <span>{s.icon}</span>
          <span>{s.label}</span>
        </span>
        {item.source_meeting_title ? (
          <span className="truncate text-[13px] text-zinc-400">
            · {item.source_meeting_title}
          </span>
        ) : null}
        {item.age_days !== null && item.age_days > 0 ? (
          <span className="ml-auto shrink-0 text-[13px] text-zinc-500">
            {item.age_days}天前
          </span>
        ) : null}
      </header>

      {/* title */}
      <p className="mt-2.5 text-[16px] font-medium leading-snug text-zinc-50">
        {item.title}
      </p>

      {/* AI 智囊紧凑 box (仅 action item 有) */}
      {item.insights.length > 0 ? (
        <section className="mt-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-3">
          <p className="mb-2 text-[13px] font-medium text-violet-300">
            💡 AI 智囊 · {item.insights.length} 条
          </p>
          <ul className="space-y-2.5">
            {item.insights.map((ins) => (
              <li key={ins.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AgentLabel
                    nickname={ins.agent_nickname}
                    name={ins.agent_name}
                    className="text-[13px]"
                  />
                  <TypeChip type={ins.type} />
                </div>
                <p className="text-[14px] leading-snug text-zinc-200 line-clamp-2">
                  {ins.content}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* CTA 双按钮 */}
      {(item.cta_primary || item.cta_secondary) ? (
        <footer className="mt-4 flex gap-2">
          {item.cta_secondary ? (
            <button
              type="button"
              disabled={busy}
              onClick={onSecondary}
              className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[15px] text-zinc-200 active:scale-[0.98] active:bg-ink-800 transition disabled:opacity-50"
            >
              {busy ? "…" : item.cta_secondary}
            </button>
          ) : null}
          {item.cta_primary ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPrimary}
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 transition disabled:opacity-50"
            >
              {busy ? "处理中…" : item.cta_primary}
            </button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

// ---------- 紧凑单行 (tracking / done 组用) -----------------------------

export function TaskRowCompact({ item }: { item: MobileTaskItem }) {
  const s = KIND_STYLE[item.kind];
  return (
    <div
      className="flex min-h-[56px] items-center gap-3 rounded-xl bg-ink-900/40 px-4 py-3"
      data-testid={`mobile-task-row-${item.kind}`}
    >
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] ${s.chipBg} ${s.chipText}`}
      >
        {s.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${item.kind === "done" ? "text-zinc-400" : "text-zinc-100"}`}>
          {item.title}
        </p>
        {item.source_meeting_title ? (
          <p className="mt-0.5 truncate text-[13px] text-zinc-500">
            {item.source_meeting_title}
          </p>
        ) : null}
      </div>
      {item.age_days !== null && item.age_days > 0 ? (
        <span className="shrink-0 text-[13px] text-zinc-500">
          {item.age_days}天前
        </span>
      ) : null}
    </div>
  );
}
