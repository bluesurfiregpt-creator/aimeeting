"use client";

/**
 * v27.0-mobile P16 · 议程事件横幅 (方案 C: 全套主持人).
 *
 * 来自 WebSocket 推送 6 种事件:
 *   - agenda_off_topic     (suspected/confirmed/severe 三档)
 *     - severe 在外层用 SevereOffTopicModal 全屏渲, 不走这个组件
 *   - agenda_time_warning  ⏰ 议程时间超 80%
 *   - agenda_stuck         🔄 议题卡住 (含 auto_summon_after_s 倒计时)
 *   - dissent_detected     🆚 检测到争议
 *   - agenda_decision_summary 🎯 该决策时主持人收口 (倒计时)
 *   - agenda_advance_suggested 🚀 建议推进议程 (controller-only)
 *
 * 设计:
 *   - 单 slot, 新覆盖旧
 *   - 主操作按钮: 召唤主持人 / 推进议程 等, 跟事件 kind 相关
 *   - 含 auto_summon_after_s 的事件: 倒计时显示, 0 时自动召
 *   - 可手动 × dismiss
 *   - 自动 60s 消失 (除非含倒计时)
 */

import { useEffect, useRef, useState } from "react";

export type BannerKind =
  | "off_topic"
  | "time_warning"
  | "stuck"
  | "dissent"
  | "decision_summary"
  | "advance_suggested";

export type BannerData = {
  kind: BannerKind;
  title: string;
  body?: string;
  /** 召唤目标 agent. moderator 类事件 = moderator id. dissent = suggested expert. */
  agentId: string;
  agentName: string;
  /** 召唤 LLM 时传的 prompt — backend agenda_monitor 已生成 */
  invokeQuery?: string;
  /** 倒计时秒数 (stuck / decision_summary 有). null = 无倒计时 */
  autoSummonSec?: number | null;
  /** advance_suggested 专用: 推进议程的目标 idx, controller 一键确认 */
  advanceTargetIdx?: number | null;
  /** advance_suggested 专用: 当前 user 是否 controller */
  canAdvance?: boolean;
};

const TONE: Record<
  BannerKind,
  { emoji: string; bg: string; border: string; text: string; ctaColor: string }
> = {
  off_topic: {
    emoji: "🧭",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-100",
    ctaColor: "bg-amber-500 active:bg-amber-600",
  },
  time_warning: {
    emoji: "⏰",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-100",
    ctaColor: "bg-amber-500 active:bg-amber-600",
  },
  stuck: {
    emoji: "🔄",
    bg: "bg-orange-500/10",
    border: "border-orange-500/40",
    text: "text-orange-100",
    ctaColor: "bg-orange-500 active:bg-orange-600",
  },
  dissent: {
    emoji: "🆚",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    text: "text-rose-100",
    ctaColor: "bg-rose-500 active:bg-rose-600",
  },
  decision_summary: {
    emoji: "🎯",
    bg: "bg-violet-500/10",
    border: "border-violet-500/40",
    text: "text-violet-100",
    ctaColor: "bg-violet-500 active:bg-violet-600",
  },
  advance_suggested: {
    emoji: "🚀",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    text: "text-emerald-100",
    ctaColor: "bg-emerald-500 active:bg-emerald-600",
  },
};

export default function AgendaEventBanner({
  data,
  onDismiss,
  onSummonAgent,
  onAdvanceAgenda,
}: {
  data: BannerData;
  onDismiss: () => void;
  onSummonAgent: (agentId: string, query?: string) => void;
  /** advance_suggested 专用 */
  onAdvanceAgenda?: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(
    data.autoSummonSec ?? null,
  );
  // 防 onSummonAgent / onDismiss 闭包不稳导致 effect re-run
  const summonRef = useRef(onSummonAgent);
  summonRef.current = onSummonAgent;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // 含倒计时: 每 250ms tick, 0 时自动召唤
  useEffect(() => {
    if (data.autoSummonSec === null || data.autoSummonSec === undefined) {
      // 无倒计时, 60s 自动消失
      const t = setTimeout(() => dismissRef.current(), 60000);
      return () => clearTimeout(t);
    }
    setRemaining(data.autoSummonSec);
    const startedAt = Date.now();
    const totalMs = data.autoSummonSec * 1000;
    const it = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, (totalMs - elapsed) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(it);
        // 自动召唤 + dismiss
        summonRef.current(data.agentId, data.invokeQuery);
        dismissRef.current();
      }
    }, 250);
    return () => clearInterval(it);
  }, [data.autoSummonSec, data.agentId, data.invokeQuery]);

  const tone = TONE[data.kind];

  // CTA 文案: advance_suggested 是推进议程, 其他都是召唤主持人
  const isAdvance = data.kind === "advance_suggested";
  const cta = isAdvance ? "立刻推进 →" : `召唤 ${data.agentName}`;
  const ctaHidden = isAdvance && !data.canAdvance;

  const handleCta = () => {
    if (isAdvance && onAdvanceAgenda) {
      onAdvanceAgenda();
      dismissRef.current();
    } else {
      summonRef.current(data.agentId, data.invokeQuery);
      dismissRef.current();
    }
  };

  return (
    <div
      className={`sticky z-20 mx-4 mt-2 rounded-xl border ${tone.bg} ${tone.border}`}
      style={{ top: 60 }}
      role="status"
      data-testid="mobile-agenda-banner"
      data-banner-kind={data.kind}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="shrink-0 text-[20px]">{tone.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-medium ${tone.text}`}>{data.title}</p>
          {data.body ? (
            <p className="mt-1 text-[13px] leading-snug text-zinc-300">
              {data.body}
            </p>
          ) : null}
          {remaining !== null && remaining > 0 ? (
            <p className="mt-2 text-[12px] text-zinc-400 tabular-nums">
              {Math.ceil(remaining)} 秒后自动召唤 {data.agentName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭横幅"
          className="-mr-1 -mt-1 shrink-0 px-1 text-[20px] text-zinc-400 active:text-zinc-200"
        >
          ×
        </button>
      </div>
      {/* CTA 按钮区 (advance + canAdvance 否则隐) */}
      {!ctaHidden ? (
        <div className="border-t border-white/5 px-4 py-2">
          <button
            type="button"
            onClick={handleCta}
            className={`flex h-10 w-full items-center justify-center rounded-lg px-4 text-[14px] font-medium text-white shadow ${tone.ctaColor} active:scale-[0.98]`}
            data-testid="mobile-banner-cta"
          >
            {cta}
          </button>
        </div>
      ) : null}
    </div>
  );
}
