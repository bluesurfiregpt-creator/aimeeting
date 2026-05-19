"use client";

/**
 * v27.0-mobile · Phase 5B · 议程事件横幅 (顶部条状提示).
 *
 * 来自 WebSocket 推送, 三类:
 *   - agenda_off_topic   🧭 跑题 (suspected/confirmed/severe 三档轻度差异)
 *   - agenda_time_warning ⏰ 当前议题时间超 80%
 *   - agenda_stuck       🔄 议题卡住 (重复立场, AI 建议召主持人)
 *
 * 简化版 (vs 桌面):
 *   - 不做全屏 modal (severe 也用普通 banner)
 *   - 不做 auto_summon 倒计时 (mobile mvp 用户主动 dismiss 即可)
 *   - 单 banner slot: 同时来多个事件, 新覆盖旧
 *   - 可手动 dismiss (×)
 *   - 自动 60s 消失
 *
 * 顶部 sticky 在 sticky TopBar 下面, 不挡主内容.
 */

import { useEffect } from "react";

export type BannerKind = "off_topic" | "time_warning" | "stuck";

export type BannerData = {
  kind: BannerKind;
  title: string;       // 大字 (12-15 字内, 突出)
  body?: string;       // 副字 (可选)
  severity?: "suspected" | "confirmed" | "severe";  // off_topic 用
};

const TONE: Record<
  BannerKind,
  { emoji: string; bg: string; border: string; text: string }
> = {
  off_topic: {
    emoji: "🧭",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-100",
  },
  time_warning: {
    emoji: "⏰",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-100",
  },
  stuck: {
    emoji: "🔄",
    bg: "bg-orange-500/10",
    border: "border-orange-500/40",
    text: "text-orange-100",
  },
};

export default function AgendaEventBanner({
  data,
  onDismiss,
}: {
  data: BannerData;
  onDismiss: () => void;
}) {
  // 60s 自动消失
  useEffect(() => {
    const t = setTimeout(onDismiss, 60000);
    return () => clearTimeout(t);
  }, [data, onDismiss]);

  const tone = TONE[data.kind];

  return (
    <div
      className={`sticky z-20 mx-4 mt-2 flex items-start gap-3 rounded-xl border px-4 py-3 ${tone.bg} ${tone.border}`}
      style={{ top: 60 }}
      role="status"
      data-testid="mobile-agenda-banner"
    >
      <span className="shrink-0 text-[20px]">{tone.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-medium ${tone.text}`}>{data.title}</p>
        {data.body ? (
          <p className="mt-1 text-[13px] text-zinc-300 leading-snug">
            {data.body}
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
  );
}
