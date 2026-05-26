"use client";

/**
 * v27.0-mobile · 进行中会议横向 carousel.
 *
 * 用户 Q3 选 — 一卡一屏滑切. 不是 list 平铺.
 *
 * 设计锚:
 *   - snap-x mandatory + 每卡占 85% 宽 (留一点 peek 给下一卡, 暗示可滑)
 *   - 卡内含: 标题 / 推进阶段 progress / 最新 AI 判断 (chip) / CTA "立即进入"
 *   - pagination dots 在 carousel 下方, 仅多卡时显
 *   - 单卡时不滑动 (overflow-hidden), dots 隐
 *   - 空状态 — "你现在没进行中会议" + 引导跳 /m/meetings
 *
 * v1.4.0 Saga L · 浅色化 (iOS 浅色).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AIInsightChip } from "./AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type { WorkbenchOngoingMeeting } from "@/lib/mobile/types";

// 5 阶段 chip 行 (会议推进 5 步)
function StageProgress({ currentIdx, total }: { currentIdx: number | null; total: number }) {
  // total 来自 agenda 项数 (不一定是 5 — brief 是概念 5 阶段, 实际议程项数可不同)
  if (total === 0) {
    return (
      <span className="text-[13px]" style={{ color: MR_COLORS.textTertiary }}>
        未设议程
      </span>
    );
  }
  const cur = currentIdx ?? 0;
  const isComplete = cur >= total;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px]" style={{ color: MR_COLORS.textSecondary }}>
        阶段
      </span>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < cur;
          const active = i === cur && !isComplete;
          const bg = done
            ? MR_COLORS.systemGreen
            : active
            ? MR_COLORS.systemBlue
            : MR_COLORS.separator;
          return (
            <span
              key={i}
              className="h-1.5 w-3 rounded-full"
              style={{ background: bg }}
            />
          );
        })}
      </div>
      <span
        className="text-[13px] tabular-nums"
        style={{ color: MR_COLORS.textSecondary }}
      >
        {isComplete ? `${total}/${total} 完成` : `${cur + 1}/${total}`}
      </span>
    </div>
  );
}

function MeetingCard({ m }: { m: WorkbenchOngoingMeeting }) {
  return (
    <Link
      href={`/m/meetings/${m.meeting_id}`}
      className="flex w-[85%] shrink-0 snap-center flex-col gap-2.5 rounded-2xl p-4 transition active:scale-[0.98]"
      style={{
        background: MR_COLORS.bgWhite,
        border: "0.5px solid rgba(0,122,255,0.30)",
        boxShadow: "0 2px 6px rgba(0,122,255,0.06)",
      }}
      data-testid="mobile-meeting-card"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="truncate text-[16px] font-semibold"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {m.title}
          </h3>
          <p
            className="mt-1 text-[13px]"
            style={{ color: MR_COLORS.textSecondary }}
          >
            <span
              className="inline-flex h-1.5 w-1.5 rounded-full align-middle animate-pulse"
              style={{ background: MR_COLORS.systemGreen }}
            />
            <span className="ml-1.5">进行中 · 已 {m.started_minutes_ago} 分钟</span>
          </p>
        </div>
      </header>

      <StageProgress currentIdx={m.current_agenda_idx} total={m.total_agenda_items} />

      {m.latest_insight ? (
        <div className="mt-1">
          <AIInsightChip insight={m.latest_insight} />
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: MR_COLORS.textTertiary }}>
          还没 AI 判断产出
        </p>
      )}

      <div className="mt-auto text-right">
        <span
          className="text-[14px] font-medium"
          style={{ color: MR_COLORS.systemBlue }}
        >
          立即进入 →
        </span>
      </div>
    </Link>
  );
}

export default function MeetingCarousel({
  meetings,
}: {
  meetings: WorkbenchOngoingMeeting[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // 滑完后知道当前哪张 — 用于 dots
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || meetings.length <= 1) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cardW = el.scrollWidth / meetings.length;
        const idx = Math.round(el.scrollLeft / cardW);
        setActiveIdx(Math.max(0, Math.min(meetings.length - 1, idx)));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [meetings.length]);

  if (meetings.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-center text-[14px]"
        style={{
          background: MR_COLORS.bgWhite,
          border: `0.5px dashed ${MR_COLORS.hairlineStrong}`,
          color: MR_COLORS.textSecondary,
        }}
      >
        现在没进行中的会议
        <Link
          href="/m/meetings"
          className="mt-2 block text-[14px] font-medium"
          style={{ color: MR_COLORS.systemBlue }}
        >
          → 看全部会议
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={scrollRef}
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin"
        style={{ scrollbarWidth: "none" }}
      >
        {meetings.map((m) => (
          <MeetingCard key={m.meeting_id} m={m} />
        ))}
      </div>
      {meetings.length > 1 ? (
        <div className="mt-1.5 flex justify-center gap-1">
          {meetings.map((_, i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all"
              style={{
                width: i === activeIdx ? 16 : 4,
                background:
                  i === activeIdx ? MR_COLORS.systemBlue : MR_COLORS.separator,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
