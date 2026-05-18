"use client";

/**
 * v27.0-mobile · AI 智囊 卡片 — 多 处 复用 核心 组件.
 *
 * 两 个 形态:
 *   - <AIInsightChip />  紧凑版 — 一行 一条, 仅 ◆ nickname·professional + 内容 头40字
 *                        用 于 等我处理卡 内 + 进行中会议卡 内
 *   - <AIInsightCard />  完整版 — 含 依据 + 类型 chip + 来源 footer
 *                        用 于 今日产出 主段 + 智囊 列表 页
 *
 * 颜色 by type (跟 brief 一致 — AI 视角 区分, 但 整 体 仍 克制):
 *   建议       violet (默认)
 *   决策建议   emerald  (主推, 偏 推进)
 *   风险       rose     (警示, 顶部 优先)
 *   洞察       sky      (数据 / 现象)
 *   思路       amber    (创新 / 拆分)
 */

import type { AIInsightBrief, AIInsightFull, AIInsightType } from "@/lib/mobile/types";

// ---------- type → 颜色 配 -----------------------------------------------

type ColorSet = {
  // border-l border + 文字 chip
  chipText: string;
  chipBg: string;
  border: string;
};

const TYPE_COLORS: Record<AIInsightType, ColorSet> = {
  建议: {
    chipText: "text-violet-200",
    chipBg: "bg-violet-500/15",
    border: "border-violet-500/40",
  },
  决策建议: {
    chipText: "text-emerald-200",
    chipBg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  风险: {
    chipText: "text-rose-200",
    chipBg: "bg-rose-500/15",
    border: "border-rose-500/40",
  },
  洞察: {
    chipText: "text-sky-200",
    chipBg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  思路: {
    chipText: "text-amber-200",
    chipBg: "bg-amber-500/15",
    border: "border-amber-500/40",
  },
};

function colorFor(type: AIInsightType | string): ColorSet {
  return TYPE_COLORS[type as AIInsightType] || TYPE_COLORS["建议"];
}

// ---------- 公共 子件 -----------------------------------------------------

/** ◆ nickname · professional — 严肃 工作台 风格, 不卖萌, 不头像 */
export function AgentLabel({
  nickname,
  name,
  className = "",
}: {
  nickname: string | null;
  name: string;
  className?: string;
}) {
  const display = nickname?.trim() || name;
  // 有 nickname 时 「nickname · name」, 无 时 仅 name
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <span className="text-zinc-500">◆</span>
      <span className="font-medium text-zinc-200">{display}</span>
      {nickname?.trim() && nickname.trim() !== name && (
        <span className="text-zinc-500">· {name}</span>
      )}
    </span>
  );
}

/** type chip 紧凑色块, 跟 type 配 颜色 */
export function TypeChip({ type }: { type: AIInsightType | string }) {
  const c = colorFor(type);
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${c.chipBg} ${c.chipText}`}>
      {type}
    </span>
  );
}

// ---------- 紧凑 chip — 一行 -----------------------------------------------

export function AIInsightChip({ insight }: { insight: AIInsightBrief }) {
  const c = colorFor(insight.type);
  return (
    <div className={`flex items-start gap-2 border-l-2 ${c.border} pl-2 py-0.5`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <AgentLabel nickname={insight.agent_nickname} name={insight.agent_name} />
          <TypeChip type={insight.type} />
        </div>
        <p className="mt-0.5 text-xs text-zinc-300 leading-snug line-clamp-2">
          {insight.content}
        </p>
      </div>
    </div>
  );
}

// ---------- 完整 卡 — 含 依据 + 来源 ----------------------------------------

export function AIInsightCard({ insight }: { insight: AIInsightFull }) {
  const c = colorFor(insight.type);
  const timeStr = new Date(insight.created_at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <article
      className={`rounded-lg border ${c.border} bg-ink-900 p-3`}
      data-testid="ai-insight-card"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentLabel nickname={insight.agent_nickname} name={insight.agent_name} />
          <TypeChip type={insight.type} />
        </div>
        <span className="shrink-0 text-[10px] text-zinc-600">{timeStr}</span>
      </header>
      <p className="mt-1.5 text-sm text-zinc-100 leading-relaxed">{insight.content}</p>
      {insight.evidence ? (
        <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
          <span className="text-zinc-600">▸</span> {insight.evidence}
        </p>
      ) : null}
      {insight.meeting_title ? (
        <footer className="mt-2 flex items-center gap-1 text-[10px] text-zinc-600">
          <span>来自</span>
          <span className="text-zinc-500">{insight.meeting_title}</span>
        </footer>
      ) : null}
    </article>
  );
}
