"use client";

/**
 * v27.0-mobile P16 · 严重跑题全屏 modal.
 *
 * agenda_off_topic 含 severity="severe" 时显这个 (而不是普通 banner) —
 * 不操作 5-30 秒后会自动召主持人. modal 强提示, 让用户必须决策.
 *
 * 跟桌面端 severe modal 对齐:
 *   - 全屏覆盖 (z-50, 比 sticky banner 高)
 *   - 紫色/红色 严重感配色
 *   - 倒计时显示
 *   - 两个按钮:
 *     - "召唤 X" — 立即召唤主持人 (主操作)
 *     - "我知道了" — dismiss, 取消倒计时
 */

import { useEffect, useRef, useState } from "react";

export type SevereData = {
  offTopicSummary: string;
  currentAgendaItem: string | null;
  suggestedAgendaItem: string | null;
  moderatorAgentId: string;
  moderatorAgentName: string;
  invokeQuery: string;
  autoSummonAfterSec: number;
};

export default function SevereOffTopicModal({
  data,
  onSummon,
  onDismiss,
}: {
  data: SevereData | null;
  onSummon: (agentId: string, query: string) => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState<number>(
    data?.autoSummonAfterSec ?? 0,
  );
  const summonRef = useRef(onSummon);
  summonRef.current = onSummon;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!data) return;
    setRemaining(data.autoSummonAfterSec);
    const startedAt = Date.now();
    const totalMs = data.autoSummonAfterSec * 1000;
    const it = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, (totalMs - elapsed) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(it);
        summonRef.current(data.moderatorAgentId, data.invokeQuery);
        dismissRef.current();
      }
    }, 250);
    return () => clearInterval(it);
  }, [data]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      data-testid="mobile-severe-offtopic-modal"
    >
      {/* 遮罩 — 不允许点击关 (强制决策) */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />

      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-rose-500/40 bg-ink-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部 emoji + 警示 */}
        <div className="bg-gradient-to-br from-rose-500/20 to-amber-500/10 px-6 pt-6 pb-4 text-center">
          <div className="text-4xl">🚨</div>
          <h2 className="mt-3 text-[18px] font-semibold text-rose-100">
            议题严重偏离
          </h2>
          <p className="mt-2 text-[13px] text-zinc-300">
            AI 检测到讨论已远离当前议程
          </p>
        </div>

        {/* 内容 */}
        <div className="space-y-3 px-6 py-4">
          <div>
            <p className="text-[12px] font-medium text-zinc-500">
              当前议程
            </p>
            <p className="mt-1 text-[14px] text-zinc-100">
              {data.currentAgendaItem || "(未指定)"}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-zinc-500">
              讨论方向
            </p>
            <p className="mt-1 text-[14px] text-zinc-200">
              {data.offTopicSummary}
            </p>
          </div>
          {data.suggestedAgendaItem ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
              <p className="text-[12px] font-medium text-amber-300">
                建议跳转议程
              </p>
              <p className="mt-1 text-[14px] text-amber-100">
                {data.suggestedAgendaItem}
              </p>
            </div>
          ) : null}
        </div>

        {/* 倒计时 + 按钮 */}
        <div className="space-y-2 border-t border-ink-800 bg-ink-950 px-4 py-4">
          <p className="text-center text-[13px] text-zinc-400 tabular-nums">
            {remaining > 0 ? (
              <>
                <span className="font-semibold text-rose-300">
                  {Math.ceil(remaining)}
                </span>{" "}
                秒后自动召唤 {data.moderatorAgentName}
              </>
            ) : (
              "正在召唤…"
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                dismissRef.current();
              }}
              className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[14px] text-zinc-200 active:scale-[0.98] active:bg-ink-800"
            >
              我知道了
            </button>
            <button
              type="button"
              onClick={() => {
                summonRef.current(data.moderatorAgentId, data.invokeQuery);
                dismissRef.current();
              }}
              className="flex h-12 flex-[1.5] items-center justify-center rounded-xl bg-rose-500 px-4 text-[14px] font-medium text-white shadow-lg shadow-rose-500/30 active:scale-[0.98] active:bg-rose-600"
              data-testid="mobile-severe-summon"
            >
              立刻召唤 {data.moderatorAgentName}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
