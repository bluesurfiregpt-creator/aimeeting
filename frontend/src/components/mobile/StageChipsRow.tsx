"use client";

/**
 * v27.0-mobile · 会议室顶部议程阶段 chip 行 (sticky).
 *
 * 整屏视觉锚 — 任何时刻滚到哪都看到 "现在在第 X 项".
 * brief 关键词 "会议推进感" / "状态优先" 的落地.
 *
 * 设计决策:
 *   - 用议程实际项数 (不是固定 5 — 议程项不一定等于 5 阶段)
 *   - 议程多时横向滚动, 当前项居中
 *   - 已完成 ✓ 灰 / 当前 ● 蓝 / 待开始 ○ 极淡
 */

"use client";

import { useEffect, useRef } from "react";
import type { MobileMeetingAgendaItem } from "@/lib/mobile/types";

export default function StageChipsRow({
  items,
  currentIdx,
  isComplete,
}: {
  items: MobileMeetingAgendaItem[];
  currentIdx: number | null;
  isComplete: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  // active 项自动居中
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const el = activeRef.current;
      const parent = scrollRef.current;
      const left = el.offsetLeft - parent.clientWidth / 2 + el.clientWidth / 2;
      parent.scrollTo({ left, behavior: "smooth" });
    }
  }, [currentIdx]);

  if (items.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto border-b border-ink-800 bg-ink-950/80 px-4 py-2.5 backdrop-blur"
      style={{ scrollbarWidth: "none" }}
      data-testid="mobile-stage-chips"
    >
      {items.map((item) => {
        const done = item.status === "done" || (currentIdx !== null && item.idx < currentIdx);
        const active = item.idx === currentIdx && !isComplete;
        const pending = !done && !active;
        return (
          <div
            key={item.idx}
            ref={active ? activeRef : null}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[14px] transition ${
              active
                ? "border-accent-500/60 bg-accent-500/10 text-accent-200"
                : done
                ? "border-zinc-700 text-zinc-400 line-through"
                : "border-zinc-800 text-zinc-500"
            }`}
          >
            <span className="text-[13px]">
              {done ? "✓" : active ? "●" : "○"}
            </span>
            <span className="max-w-[10em] truncate font-medium">
              {item.title}
            </span>
            {(active || done) && item.elapsed_min !== null ? (
              <span className={`text-[13px] tabular-nums ${active ? "text-accent-400" : "text-zinc-500"}`}>
                {item.elapsed_min}m
              </span>
            ) : null}
          </div>
        );
      })}
      {isComplete ? (
        <div className="flex shrink-0 items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[14px] font-medium text-emerald-300">
          议程全完成
        </div>
      ) : null}
    </div>
  );
}
