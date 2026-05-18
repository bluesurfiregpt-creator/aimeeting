"use client";

/**
 * v27.0-mobile · 会议室 sticky 底部 next action 卡.
 *
 * 按 用户 Q2 校 准: "救命卡 — 任何 时刻 都 知道 该 干啥".
 * 滚 到 哪 都 看 得 见, 紧 贴 在 BottomNav 上方.
 *
 * 内 容 优先级:
 *   1. controller (leader+ / 创建人) + 当前 议题 有 风险 insight
 *      → "⚠ <agent> 提了 风险 — [处理] [推进 议程] [继续]"  (Phase 2 in-card decision)
 *   2. controller + 没风险
 *      → "[推进 议程 →]"
 *   3. 非 controller
 *      → "[💬 召 AI 加 视角]"
 *   4. 议程 全完成
 *      → "[结束 会议]" (controller) / 灰 hint (非)
 *
 * Phase 1 MVP — 仅 实现 2/3/4, 风险 in-card decision 留 Phase 2.
 */

import type { AIInsightFull } from "@/lib/mobile/types";

type Props = {
  canControl: boolean;
  isAgendaComplete: boolean;
  currentTopicTitle: string | null;
  hasRiskInsight: boolean;
  onAdvance?: () => void;
  onSummonAi?: () => void;
  onEndMeeting?: () => void;
};

export default function StickyActionBar({
  canControl,
  isAgendaComplete,
  currentTopicTitle,
  hasRiskInsight,
  onAdvance,
  onSummonAi,
  onEndMeeting,
}: Props) {
  // 案 例 1: 议程 完成
  if (isAgendaComplete) {
    return (
      <Bar>
        {canControl ? (
          <Primary onClick={onEndMeeting}>结束 会议</Primary>
        ) : (
          <Hint>议程 已 全 完成, 等 主持人 结束</Hint>
        )}
      </Bar>
    );
  }

  // 案 例 2: 有 风险 — 突出 显示 (controller 见 双 选 — phase 1 用 单 推进)
  if (hasRiskInsight && currentTopicTitle) {
    return (
      <Bar tone="warn">
        <div className="flex-1 px-1">
          <p className="text-[12px] text-amber-200/90">⚠ 当前 议题 有 风险</p>
          <p className="truncate text-[11px] text-zinc-500">
            {currentTopicTitle}
          </p>
        </div>
        {canControl ? (
          <Primary onClick={onAdvance}>推进 议程</Primary>
        ) : (
          <Primary onClick={onSummonAi}>召 AI</Primary>
        )}
      </Bar>
    );
  }

  // 案 例 3: 默 认
  return (
    <Bar>
      {canControl ? (
        <>
          <Secondary onClick={onSummonAi}>💬 召 AI</Secondary>
          <Primary onClick={onAdvance}>推进 议程 →</Primary>
        </>
      ) : (
        <Primary onClick={onSummonAi}>💬 召 AI 加 视角</Primary>
      )}
    </Bar>
  );
}

// ---------- atoms ---------------------------------------------------------

function Bar({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  const bg =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/[0.06]"
      : "border-ink-800 bg-ink-950/95";
  return (
    <div
      className={`sticky bottom-0 z-20 flex items-center gap-2 border-t ${bg} px-4 py-3 backdrop-blur`}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 12px)" }}
      data-testid="mobile-sticky-action-bar"
    >
      {children}
    </div>
  );
}

function Primary({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 min-w-[7em] flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 transition"
    >
      {children}
    </button>
  );
}

function Secondary({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[14px] text-zinc-300 active:scale-[0.98] active:bg-ink-800 transition"
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex-1 px-2 text-center text-[13px] text-zinc-500">
      {children}
    </p>
  );
}
