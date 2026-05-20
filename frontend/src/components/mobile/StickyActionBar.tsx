"use client";

/**
 * v27.0-mobile · 会议室 sticky 底部 next action 卡.
 *
 * 按用户 Q2 校准: "救命卡 — 任何时刻都知道该干啥".
 * 滚到哪都看得见, 紧贴在 BottomNav 上方.
 *
 * 内容优先级:
 *   1. controller (leader+ / 创建人) + 当前议题有风险 insight
 *      → "⚠ <agent> 提了风险 — [处理] [推进议程] [继续]"  (Phase 2 in-card decision)
 *   2. controller + 没风险
 *      → "[推进议程 →]"
 *   3. 非 controller
 *      → "[💬 召 AI 加视角]"
 *   4. 议程全完成
 *      → "[结束会议]" (controller) / 灰 hint (非)
 *
 * Phase 1 MVP — 仅实现 2/3/4, 风险 in-card decision 留 Phase 2.
 */

import type { AIInsightFull } from "@/lib/mobile/types";

type Props = {
  canControl: boolean;
  isAgendaComplete: boolean;
  currentTopicTitle: string | null;
  hasRiskInsight: boolean;
  /** 推进议程 API 调用中 — 主按钮 disabled + 显 loading */
  advancing?: boolean;
  onAdvance?: () => void;
  onSummonAi?: () => void;
  onEndMeeting?: () => void;
};

export default function StickyActionBar({
  canControl,
  isAgendaComplete,
  currentTopicTitle,
  hasRiskInsight,
  advancing = false,
  onAdvance,
  onSummonAi,
  onEndMeeting,
}: Props) {
  // 案例 1: 议程完成
  if (isAgendaComplete) {
    return (
      <Bar>
        {canControl ? (
          <Primary onClick={onEndMeeting}>结束会议</Primary>
        ) : (
          <Hint>议程已全完成, 等主持人结束</Hint>
        )}
      </Bar>
    );
  }

  // 案例 2: 有风险 — 突出显示 (controller 见双选 — phase 1 用单推进)
  if (hasRiskInsight && currentTopicTitle) {
    return (
      <Bar tone="warn">
        <div className="flex-1 px-1">
          <p className="text-[14px] font-medium text-amber-200">⚠ 当前议题有风险</p>
          <p className="truncate text-[13px] text-zinc-400">
            {currentTopicTitle}
          </p>
        </div>
        {canControl ? (
          <Primary onClick={onAdvance} busy={advancing}>
            {advancing ? "推进中…" : "推进议程"}
          </Primary>
        ) : (
          <Primary onClick={onSummonAi}>召唤专家</Primary>
        )}
      </Bar>
    );
  }

  // 案例 3: 默认
  return (
    <Bar>
      {canControl ? (
        <>
          <Secondary onClick={onSummonAi} disabled={advancing}>
            💬 召唤专家
          </Secondary>
          <Primary onClick={onAdvance} busy={advancing}>
            {advancing ? "推进中…" : "推进议程 →"}
          </Primary>
        </>
      ) : (
        <Primary onClick={onSummonAi}>💬 召唤专家加视角</Primary>
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
  busy = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-12 min-w-[7em] flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 transition disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Secondary({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[15px] text-zinc-200 active:scale-[0.98] active:bg-ink-800 transition disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex-1 px-2 text-center text-[14px] text-zinc-400">
      {children}
    </p>
  );
}
