"use client";

/**
 * v27.0-mobile P21 · 待审 insight 卡片.
 *
 * 用于「记忆」模块的「待审」tab. 数据是 AI 推过 worth_remembering=true 但
 * 用户还没决策的 insight. 提供两个操作:
 *   - 确认入库 → 同步写 long_term_memory, insight.human_decision='accepted'
 *   - 驳回    → 仅标 insight.human_decision='rejected', insight 保留 (快照 tab 仍可见)
 *
 * 跟 AIInsightCard 的差异: 多了 footer 区的双按钮.
 *
 * v1.4.0 Saga K · 浅色化 — AIInsightCard 走 light 变体, 按钮浅 iOS 色.
 */

import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type { AIInsightFull } from "@/lib/mobile/types";

export default function PendingInsightReviewCard({
  insight,
  busy,
  onAccept,
  onReject,
}: {
  insight: AIInsightFull;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      className="rounded-2xl"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid="pending-insight-review-card"
    >
      <AIInsightCard insight={insight} light />
      <div className="flex gap-2 px-4 pb-4 pt-1">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="flex h-10 flex-1 items-center justify-center rounded-lg text-[14px] active:scale-[0.98] disabled:opacity-50"
          style={{
            background: MR_COLORS.bgWhite,
            border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            color: MR_COLORS.textSecondary,
          }}
          data-testid="insight-reject-btn"
        >
          驳回
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="flex h-10 flex-[1.5] items-center justify-center rounded-lg text-[14px] font-medium text-white active:scale-[0.98] disabled:opacity-50"
          style={{
            background: MR_COLORS.systemGreen,
          }}
          data-testid="insight-accept-btn"
        >
          {busy ? "处理中…" : "确认入库"}
        </button>
      </div>
    </div>
  );
}
