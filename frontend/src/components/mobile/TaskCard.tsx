"use client";

/**
 * v27.0-mobile · 任务卡 (两形态).
 *
 * - <TaskCardFull />    完整 — pending 组用. 含 AI 智囊紧凑 box + 双 CTA
 * - <TaskRowCompact />  紧凑单行 — tracking / done 组用. 仅状态 + title + age
 *
 * v1.4.0 Saga K · 浅色化 (跟 /m today + /m/me 一致, iOS 浅色).
 */

import Link from "next/link";
import { AgentLabel, TypeChip } from "./AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type { MobileTaskItem, MobileTaskKind } from "@/lib/mobile/types";

// ---------- kind → 视觉配 ------------------------------------------------

type KindStyle = {
  icon: string;
  label: string;
  chipBg: string;
  chipFg: string;
  cardBg: string;
  cardBorder: string;
};

const KIND_STYLE: Record<MobileTaskKind, KindStyle> = {
  confirm: {
    icon: "⏳",
    label: "待确认",
    chipBg: "rgba(255,159,10,0.12)",
    chipFg: MR_COLORS.systemOrange,
    cardBg: MR_COLORS.bgWhite,
    cardBorder: "rgba(255,159,10,0.25)",
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "rgba(0,122,255,0.10)",
    chipFg: MR_COLORS.systemBlue,
    cardBg: MR_COLORS.bgWhite,
    cardBorder: "rgba(0,122,255,0.25)",
  },
  tracking: {
    icon: "·",
    label: "跟踪中",
    chipBg: "rgba(60,60,67,0.08)",
    chipFg: MR_COLORS.textSecondary,
    cardBg: MR_COLORS.bgWhite,
    cardBorder: MR_COLORS.hairline,
  },
  done: {
    icon: "✓",
    label: "已完成",
    chipBg: "rgba(52,199,89,0.12)",
    chipFg: MR_COLORS.systemGreen,
    cardBg: MR_COLORS.bgWhite,
    cardBorder: MR_COLORS.hairline,
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
      className="rounded-2xl p-4"
      style={{
        background: s.cardBg,
        border: `0.5px solid ${s.cardBorder}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid={`mobile-task-card-${item.kind}`}
    >
      {/* header — 状态 chip + 来源 */}
      <header className="flex items-center gap-2">
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
          style={{ background: s.chipBg, color: s.chipFg }}
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
        {item.age_days !== null && item.age_days > 0 ? (
          <span
            className="ml-auto shrink-0 text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {item.age_days}天前
          </span>
        ) : null}
      </header>

      {/* P4.3: action 类挂"查看详情"链接 (draft 无详情页) */}
      {item.source_kind === "action" ? (
        <Link
          href={`/m/tasks/${item.id}`}
          className="mt-2 inline-block text-[13px]"
          style={{ color: MR_COLORS.systemBlue }}
          data-testid="mobile-task-detail-link"
        >
          查看任务详情 →
        </Link>
      ) : null}

      {/* title */}
      <p
        className="mt-2.5 text-[16px] font-medium leading-snug"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {item.title}
      </p>

      {/* AI 智囊紧凑 box (仅 action item 有) */}
      {item.insights.length > 0 ? (
        <section
          className="mt-3 rounded-xl p-3"
          style={{
            background: "rgba(94,92,230,0.06)",
            border: "0.5px solid rgba(94,92,230,0.25)",
          }}
        >
          <p
            className="mb-2 text-[13px] font-medium"
            style={{ color: MR_COLORS.systemPurple }}
          >
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
                    light
                  />
                  <TypeChip type={ins.type} light />
                </div>
                <p
                  className="text-[14px] leading-snug line-clamp-2"
                  style={{ color: MR_COLORS.textSecondary }}
                >
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
              className="flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-[15px] active:scale-[0.98] transition disabled:opacity-50"
              style={{
                background: MR_COLORS.bgWhite,
                border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
                color: MR_COLORS.textSecondary,
              }}
            >
              {busy ? "…" : item.cta_secondary}
            </button>
          ) : null}
          {item.cta_primary ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPrimary}
              className="flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-[15px] font-medium text-white active:scale-[0.98] transition disabled:opacity-50"
              style={{
                background: MR_COLORS.systemBlue,
                boxShadow: "0 2px 6px rgba(0,122,255,0.30)",
              }}
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
  const clickable = item.source_kind === "action";

  const inner = (
    <>
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px]"
        style={{ background: s.chipBg, color: s.chipFg }}
      >
        {s.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[15px]"
          style={{
            color:
              item.kind === "done"
                ? MR_COLORS.textTertiary
                : MR_COLORS.textPrimary,
          }}
        >
          {item.title}
        </p>
        {item.source_meeting_title ? (
          <p
            className="mt-0.5 truncate text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {item.source_meeting_title}
          </p>
        ) : null}
      </div>
      {item.age_days !== null && item.age_days > 0 ? (
        <span
          className="shrink-0 text-[13px]"
          style={{ color: MR_COLORS.textTertiary }}
        >
          {item.age_days}天前
        </span>
      ) : null}
      {clickable ? (
        <span
          className="shrink-0 text-[16px]"
          style={{ color: MR_COLORS.textQuaternary }}
        >
          ›
        </span>
      ) : null}
    </>
  );

  const rowStyle: React.CSSProperties = {
    background: MR_COLORS.bgWhite,
    border: `0.5px solid ${MR_COLORS.hairline}`,
  };

  if (clickable) {
    return (
      <Link
        href={`/m/tasks/${item.id}`}
        className="flex min-h-[56px] items-center gap-3 rounded-xl px-4 py-3 transition active:scale-[0.99]"
        style={rowStyle}
        data-testid={`mobile-task-row-${item.kind}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className="flex min-h-[56px] items-center gap-3 rounded-xl px-4 py-3"
      style={rowStyle}
      data-testid={`mobile-task-row-${item.kind}`}
    >
      {inner}
    </div>
  );
}
