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
 * v1.4.0 Saga D · 新增 `light` 变体 — 二级页 (tasks/[id], agents/[id]).
 * v1.4.0 Saga L · 默认改浅 — 整站浅色化收官. `light` prop 保留兼容老调用,
 * 不传 也按 light 渲染 (无 dark 路径).
 */

import Link from "next/link";
import type { AIInsightBrief, AIInsightFull, AIInsightType } from "@/lib/mobile/types";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

// ---------- type → 颜色配 (仅 light 一套, 跟 MR_COLORS 对齐) -------------

type ColorSet = {
  chipText: string;
  chipBg: string;
  border: string;
};

const TYPE_COLORS: Record<AIInsightType, ColorSet> = {
  建议: {
    chipText: MR_COLORS.systemPurple,
    chipBg: "rgba(94,92,230,0.10)",
    border: "rgba(94,92,230,0.30)",
  },
  决策建议: {
    chipText: MR_COLORS.systemGreen,
    chipBg: "rgba(52,199,89,0.12)",
    border: "rgba(52,199,89,0.30)",
  },
  风险: {
    chipText: MR_COLORS.systemRed,
    chipBg: "rgba(255,59,48,0.10)",
    border: "rgba(255,59,48,0.30)",
  },
  洞察: {
    chipText: MR_COLORS.systemBlue,
    chipBg: "rgba(0,122,255,0.10)",
    border: "rgba(0,122,255,0.30)",
  },
  思路: {
    chipText: MR_COLORS.systemOrange,
    chipBg: "rgba(255,159,10,0.12)",
    border: "rgba(255,159,10,0.30)",
  },
};

function colorFor(type: AIInsightType | string): ColorSet {
  return TYPE_COLORS[type as AIInsightType] || TYPE_COLORS["建议"];
}

// ---------- 公共子件 -----------------------------------------------------

/** ◆ nickname · professional — 严肃工作台风格, 不卖萌, 不头像.
 *  `light` prop 保留兼容, 但不影响视觉 (始终浅色). */
export function AgentLabel({
  nickname,
  name,
  className = "",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  light: _light = false,
}: {
  nickname: string | null;
  name: string;
  className?: string;
  /** @deprecated v1.4.0 Saga L: 已无 dark 版本, 此 prop 不影响渲染. 保留兼容老调用. */
  light?: boolean;
}) {
  const display = nickname?.trim() || name;
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

/** type chip 紧凑色块, 跟 type 配颜色. `light` prop 保留兼容. */
export function TypeChip({
  type,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  light: _light = false,
}: {
  type: AIInsightType | string;
  /** @deprecated v1.4.0 Saga L: 已无 dark 版本, 此 prop 不影响渲染. */
  light?: boolean;
}) {
  const c = colorFor(type);
  return (
    <span
      className="shrink-0 rounded px-2 py-0.5 text-[13px] font-medium"
      style={{ background: c.chipBg, color: c.chipText }}
    >
      {type}
    </span>
  );
}

// ---------- 紧凑 chip — 一行 -----------------------------------------------

export function AIInsightChip({ insight }: { insight: AIInsightBrief }) {
  const c = colorFor(insight.type);
  return (
    <div
      className="flex items-start gap-2 pl-3 py-1"
      style={{ borderLeft: `2px solid ${c.border}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <AgentLabel nickname={insight.agent_nickname} name={insight.agent_name} />
          <TypeChip type={insight.type} />
        </div>
        <p
          className="mt-1 text-[14px] leading-snug line-clamp-2"
          style={{ color: MR_COLORS.textSecondary }}
        >
          {insight.content}
        </p>
      </div>
    </div>
  );
}

// ---------- 完整卡 — 含依据 + 来源 ----------------------------------------

export function AIInsightCard({
  insight,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  light: _light = false,
}: {
  insight: AIInsightFull;
  /** @deprecated v1.4.0 Saga L: 已无 dark 版本, 此 prop 不影响渲染. */
  light?: boolean;
}) {
  const c = colorFor(insight.type);
  const timeStr = new Date(insight.created_at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <article
      className="rounded-xl p-4"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${c.border}`,
      }}
      data-testid="ai-insight-card"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentLabel
            nickname={insight.agent_nickname}
            name={insight.agent_name}
          />
          <TypeChip type={insight.type} />
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
        /* v27.0-mobile P21: footer 可点跳到 会议详情 + 自动定位 那条 agent message.
           focus_message query 让详情页 滚到对应位置 + 高亮 (Phase 3 接). */
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
