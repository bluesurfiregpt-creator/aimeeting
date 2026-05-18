"use client";

/**
 * v27.0-mobile · 会议室 顶部 议程 阶段 chip 行 (sticky).
 *
 * 整 屏 视觉 锚 — 任何 时刻 滚到 哪 都 看 到 "现在 在 第 X 项".
 * brief 关键 词 "会议推进感" / "状态优先" 的 落地.
 *
 * 设计 决策:
 *   - 用 议程 实际 项 数 (不 是 固定 5 — 议程 项 不一定 等 于 5 阶段)
 *   - 议程 多 时 横向 滚动, 当前 项 居中
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

  // active 项 自动 居 中
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
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition ${
              active
                ? "border-accent-500/60 bg-accent-500/10 text-accent-200"
                : done
                ? "border-zinc-700 text-zinc-500 line-through"
                : "border-zinc-800 text-zinc-600"
            }`}
          >
            <span className="text-[11px]">
              {done ? "✓" : active ? "●" : "○"}
            </span>
            <span className="max-w-[10em] truncate font-medium">
              {item.title}
            </span>
            {(active || done) && item.elapsed_min !== null ? (
              <span className={`text-[11px] ${active ? "text-accent-400" : "text-zinc-600"}`}>
                {item.elapsed_min}m
              </span>
            ) : null}
          </div>
        );
      })}
      {isComplete ? (
        <div className="flex shrink-0 items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[13px] text-emerald-300">
          议程 全 完成
        </div>
      ) : null}
    </div>
  );
}
