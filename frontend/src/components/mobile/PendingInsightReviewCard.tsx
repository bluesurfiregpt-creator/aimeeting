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
 */

import { AIInsightCard } from "@/components/mobile/AIInsightCard";
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
      className="rounded-xl bg-ink-900/50"
      data-testid="pending-insight-review-card"
    >
      <AIInsightCard insight={insight} />
      <div className="flex gap-2 px-4 pb-4 pt-1">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-700 text-[14px] text-zinc-300 active:scale-[0.98] active:bg-ink-800 disabled:opacity-50"
          data-testid="insight-reject-btn"
        >
          驳回
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="flex h-10 flex-[1.5] items-center justify-center rounded-lg bg-emerald-500 text-[14px] font-medium text-white active:scale-[0.98] active:bg-emerald-600 disabled:opacity-50"
          data-testid="insight-accept-btn"
        >
          {busy ? "处理中…" : "确认入库"}
        </button>
      </div>
    </div>
  );
}
