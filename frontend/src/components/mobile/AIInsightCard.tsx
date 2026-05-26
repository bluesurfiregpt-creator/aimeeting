"use client";

/**
 * v27.0-mobile · AI 智囊卡片 — 多处复用核心组件.
 *
 * 两个形态:
 *   - <AIInsightChip />  紧凑版 — 一行一条, 仅 ◆ nickname·professional + 内容头40字
 *                        用于等我处理卡内 + 进行中会议卡内
 *   - <AIInsightCard />  完整版 — 含依据 + 类型 chip + 来源 footer
 *                        用于今日产出主段 + 智囊列表页
 *
 * 颜色 by type (跟 brief 一致 — AI 视角区分, 但整体仍克制):
 *   建议       violet (默认)
 *   决策建议   emerald  (主推, 偏推进)
 *   风险       rose     (警示, 顶部优先)
 *   洞察       sky      (数据 / 现象)
 *   思路       amber    (创新 / 拆分)
 *
 * v1.4.0 Saga D · 新增 `light` 变体 — 二级页 (tasks/[id], agents/[id]) 用 浅色 iOS 风.
 * 默认 dark, 不传 prop 不影响 老调用 (主 tab + /m/insights 仍 dark).
 */

import Link from "next/link";
import type { AIInsightBrief, AIInsightFull, AIInsightType } from "@/lib/mobile/types";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

// ---------- type → 颜色配 -----------------------------------------------

type ColorSet = {
  // dark 模式 (老) — Tailwind class
  chipText: string;
  chipBg: string;
  border: string;
  // 浅色 light 模式 — inline style values
  lightChipText: string;
  lightChipBg: string;
  lightBorder: string;
};

const TYPE_COLORS: Record<AIInsightType, ColorSet> = {
  建议: {
    chipText: "text-violet-200",
    chipBg: "bg-violet-500/15",
    border: "border-violet-500/40",
    lightChipText: MR_COLORS.systemPurple,
    lightChipBg: "rgba(94,92,230,0.10)",
    lightBorder: "rgba(94,92,230,0.30)",
  },
  决策建议: {
    chipText: "text-emerald-200",
    chipBg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
    lightChipText: MR_COLORS.systemGreen,
    lightChipBg: "rgba(52,199,89,0.12)",
    lightBorder: "rgba(52,199,89,0.30)",
  },
  风险: {
    chipText: "text-rose-200",
    chipBg: "bg-rose-500/15",
    border: "border-rose-500/40",
    lightChipText: MR_COLORS.systemRed,
    lightChipBg: "rgba(255,59,48,0.10)",
    lightBorder: "rgba(255,59,48,0.30)",
  },
  洞察: {
    chipText: "text-sky-200",
    chipBg: "bg-sky-500/15",
    border: "border-sky-500/40",
    lightChipText: MR_COLORS.systemBlue,
    lightChipBg: "rgba(0,122,255,0.10)",
    lightBorder: "rgba(0,122,255,0.30)",
  },
  思路: {
    chipText: "text-amber-200",
    chipBg: "bg-amber-500/15",
    border: "border-amber-500/40",
    lightChipText: MR_COLORS.systemOrange,
    lightChipBg: "rgba(255,159,10,0.12)",
    lightBorder: "rgba(255,159,10,0.30)",
  },
};

function colorFor(type: AIInsightType | string): ColorSet {
  return TYPE_COLORS[type as AIInsightType] || TYPE_COLORS["建议"];
}

// ---------- 公共子件 -----------------------------------------------------

/** ◆ nickname · professional — 严肃工作台风格, 不卖萌, 不头像 */
export function AgentLabel({
  nickname,
  name,
  className = "",
  light = false,
}: {
  nickname: string | null;
  name: string;
  className?: string;
  light?: boolean;
}) {
  const display = nickname?.trim() || name;
  // 有 nickname 时 「nickname · name」, 无时仅 name
  if (light) {
    return (
      <span className={`inline-flex items-center gap-1 text-[13px] ${className}`}>
        <span style={{ color: MR_COLORS.textTertiary }}>◆</span>
        <span
          className="font-medium"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {display}
        </span>
        {nickname?.trim() && nickname.trim() !== name && (
          <span style={{ color: MR_COLORS.textTertiary }}>· {name}</span>
        )}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] ${className}`}>
      <span className="text-zinc-400">◆</span>
      <span className="font-medium text-zinc-100">{display}</span>
      {nickname?.trim() && nickname.trim() !== name && (
        <span className="text-zinc-500">· {name}</span>
      )}
    </span>
  );
}

/** type chip 紧凑色块, 跟 type 配颜色 */
export function TypeChip({
  type,
  light = false,
}: {
  type: AIInsightType | string;
  light?: boolean;
}) {
  const c = colorFor(type);
  if (light) {
    return (
      <span
        className="shrink-0 rounded px-2 py-0.5 text-[13px] font-medium"
        style={{ background: c.lightChipBg, color: c.lightChipText }}
      >
        {type}
      </span>
    );
  }
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-[13px] font-medium ${c.chipBg} ${c.chipText}`}>
      {type}
    </span>
  );
}

// ---------- 紧凑 chip — 一行 -----------------------------------------------

export function AIInsightChip({ insight }: { insight: AIInsightBrief }) {
  const c = colorFor(insight.type);
  return (
    <div className={`flex items-start gap-2 border-l-2 ${c.border} pl-3 py-1`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <AgentLabel nickname={insight.agent_nickname} name={insight.agent_name} />
          <TypeChip type={insight.type} />
        </div>
        <p className="mt-1 text-[14px] text-zinc-200 leading-snug line-clamp-2">
          {insight.content}
        </p>
      </div>
    </div>
  );
}

// ---------- 完整卡 — 含依据 + 来源 ----------------------------------------

export function AIInsightCard({
  insight,
  light = false,
}: {
  insight: AIInsightFull;
  /** v1.4.0 Saga D: 浅色 iOS 风变体, 二级页用. 默认 dark 兼容老调用. */
  light?: boolean;
}) {
  const c = colorFor(insight.type);
  const timeStr = new Date(insight.created_at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (light) {
    return (
      <article
        className="rounded-xl p-4"
        style={{
          background: MR_COLORS.bgWhite,
          border: `0.5px solid ${c.lightBorder}`,
        }}
        data-testid="ai-insight-card"
      >
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <AgentLabel
              nickname={insight.agent_nickname}
              name={insight.agent_name}
              light
            />
            <TypeChip type={insight.type} light />
          </div>
          <span
            className="shrink-0 text-[13px] tabular-nums"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {timeStr}
          </span>
        </header>
        <p
          className="mt-2 text-[15px] leading-relaxed"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {insight.content}
        </p>
        {insight.evidence ? (
          <p
            className="mt-2 text-[13px] leading-relaxed"
            style={{ color: MR_COLORS.textSecondary }}
          >
            <span style={{ color: MR_COLORS.textTertiary }}>▸</span>{" "}
            {insight.evidence}
          </p>
        ) : null}
        {insight.meeting_title ? (
          <Link
            href={
              insight.source_message_id
                ? `/m/meetings/${insight.meeting_id}?focus_message=${insight.source_message_id}`
                : `/m/meetings/${insight.meeting_id}`
            }
            className="mt-3 flex items-center gap-1 text-[13px]"
            style={{ color: MR_COLORS.systemBlue }}
            data-testid="insight-card-source-link"
          >
            <span style={{ color: MR_COLORS.textTertiary }}>来自</span>
            <span
              className="truncate underline-offset-2 hover:underline"
              style={{ color: MR_COLORS.systemBlue }}
            >
              {insight.meeting_title}
            </span>
            <span style={{ color: MR_COLORS.textTertiary }}>›</span>
          </Link>
        ) : null}
      </article>
    );
  }
  return (
    <article
      className={`rounded-xl border ${c.border} bg-ink-900 p-4`}
      data-testid="ai-insight-card"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentLabel nickname={insight.agent_nickname} name={insight.agent_name} />
          <TypeChip type={insight.type} />
        </div>
        <span className="shrink-0 text-[13px] text-zinc-500 tabular-nums">{timeStr}</span>
      </header>
      <p className="mt-2 text-[15px] text-zinc-50 leading-relaxed">{insight.content}</p>
      {insight.evidence ? (
        <p className="mt-2 text-[13px] text-zinc-400 leading-relaxed">
          <span className="text-zinc-500">▸</span> {insight.evidence}
        </p>
      ) : null}
      {insight.meeting_title ? (
        /* v27.0-mobile P21: footer 可点跳到 会议详情 + 自动定位 那条 agent message.
           focus_message query 让详情页 滚到对应位置 + 高亮 (Phase 3 接). */
        <Link
          href={
            insight.source_message_id
              ? `/m/meetings/${insight.meeting_id}?focus_message=${insight.source_message_id}`
              : `/m/meetings/${insight.meeting_id}`
          }
          className="mt-3 flex items-center gap-1 text-[13px] text-zinc-500 active:text-zinc-300"
          data-testid="insight-card-source-link"
        >
          <span>来自</span>
          <span className="truncate text-zinc-400 underline-offset-2 hover:underline">
            {insight.meeting_title}
          </span>
          <span className="text-zinc-500">›</span>
        </Link>
      ) : null}
    </article>
  );
}
