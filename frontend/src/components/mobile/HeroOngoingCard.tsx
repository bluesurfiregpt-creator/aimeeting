"use client";

/**
 * v27.0-mobile · 首页 Hero — 进行中会议主卡.
 *
 * 占屏 ~45%. 整屏视觉锚 — 用户进首页立刻知道 "现在在推啥".
 *
 * 设计约束:
 *   - 一张主卡占屏顶部大段 (会议多时 carousel 切, 一次仅显一张)
 *   - 标题大字 (22-24px), 状态副字 (14px), AI 关键判断 callout
 *   - 唯一主 CTA: [立即进入] 全宽大按钮, touch 48px+
 *   - 不是 "卡列表" 中的一张, 是真正的信息主角
 *
 * v1.4.0 Saga L · 浅色化 (today 页已迁 LiveMeetingCard, 本组件 dead code
 * 兼收尾保持 0 dark token).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type { WorkbenchOngoingMeeting } from "@/lib/mobile/types";

// type 配色 — 跟 AIInsightCard 保持一致 (浅色)
const TYPE_TONE: Record<string, { border: string; text: string; bg: string }> = {
  建议: {
    border: "rgba(94,92,230,0.40)",
    text: MR_COLORS.systemPurple,
    bg: "rgba(94,92,230,0.08)",
  },
  决策建议: {
    border: "rgba(52,199,89,0.40)",
    text: MR_COLORS.systemGreen,
    bg: "rgba(52,199,89,0.08)",
  },
  风险: {
    border: "rgba(255,59,48,0.40)",
    text: MR_COLORS.systemRed,
    bg: "rgba(255,59,48,0.08)",
  },
  洞察: {
    border: "rgba(0,122,255,0.40)",
    text: MR_COLORS.systemBlue,
    bg: "rgba(0,122,255,0.08)",
  },
  思路: {
    border: "rgba(255,159,10,0.40)",
    text: MR_COLORS.systemOrange,
    bg: "rgba(255,159,10,0.08)",
  },
};

function StageBar({ cur, total }: { cur: number | null; total: number }) {
  if (total === 0) return null;
  const idx = cur ?? 0;
  const isComplete = idx >= total;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < idx;
          const active = i === idx && !isComplete;
          const bg = done
            ? MR_COLORS.systemGreen
            : active
            ? MR_COLORS.systemBlue
            : MR_COLORS.separator;
          return (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: bg }}
            />
          );
        })}
      </div>
      <span
        className="shrink-0 text-[13px]"
        style={{ color: MR_COLORS.textTertiary }}
      >
        {isComplete ? `${total}/${total}` : `议程 ${idx + 1}/${total}`}
      </span>
    </div>
  );
}

function HeroSingle({ m }: { m: WorkbenchOngoingMeeting }) {
  const insight = m.latest_insight;
  const tone = insight ? TYPE_TONE[insight.type] || TYPE_TONE["建议"] : null;
  const agentDisplay = insight
    ? insight.agent_nickname?.trim() || insight.agent_name
    : "";

  return (
    <article
      className="relative overflow-hidden rounded-2xl p-5"
      style={{
        background: MR_COLORS.bgWhite,
        border: "0.5px solid rgba(0,122,255,0.30)",
        boxShadow: "0 4px 12px rgba(0,122,255,0.08)",
      }}
      data-testid="mobile-hero-ongoing"
    >
      {/* 顶部小标 */}
      <p
        className="text-[14px] font-medium"
        style={{ color: MR_COLORS.textSecondary }}
      >
        你正在推进
      </p>

      {/* 主标题 */}
      <h1
        className="mt-2 text-[22px] font-semibold leading-tight"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {m.title}
      </h1>

      {/* 状态行 */}
      <div
        className="mt-2 flex items-center gap-2 text-[14px]"
        style={{ color: MR_COLORS.textSecondary }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex h-2 w-2 animate-pulse rounded-full"
            style={{ background: MR_COLORS.systemGreen }}
          />
          <span style={{ color: MR_COLORS.systemGreen }}>进行中</span>
        </span>
        <span style={{ color: MR_COLORS.textTertiary }}>·</span>
        <span>{m.started_minutes_ago} min</span>
      </div>

      {/* 议程进度 */}
      {m.total_agenda_items > 0 ? (
        <div className="mt-4">
          <StageBar cur={m.current_agenda_idx} total={m.total_agenda_items} />
        </div>
      ) : null}

      {/* AI 关键判断 callout */}
      {insight && tone ? (
        <div
          className="mt-4 rounded-xl px-4 py-3"
          style={{
            background: tone.bg,
            borderLeft: `3px solid ${tone.border}`,
          }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="text-[14px]"
              style={{ color: MR_COLORS.textTertiary }}
            >
              ◆
            </span>
            <span
              className="text-[14px] font-medium"
              style={{ color: MR_COLORS.textPrimary }}
            >
              {agentDisplay}
            </span>
            {insight.agent_name !== agentDisplay ? (
              <span
                className="text-[13px]"
                style={{ color: MR_COLORS.textTertiary }}
              >
                · {insight.agent_name}
              </span>
            ) : null}
            <span
              className="rounded px-2 py-0.5 text-[13px] font-medium"
              style={{ background: tone.bg, color: tone.text }}
            >
              {insight.type}
            </span>
          </div>
          <p
            className="mt-2 text-[15px] leading-snug"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {insight.content}
          </p>
        </div>
      ) : (
        <div
          className="mt-4 rounded-xl px-4 py-3 text-[14px]"
          style={{
            border: `0.5px dashed ${MR_COLORS.hairlineStrong}`,
            color: MR_COLORS.textTertiary,
          }}
        >
          这场会 AI 还没给关键判断
        </div>
      )}

      {/* 主 CTA */}
      <Link
        href={`/m/meetings/${m.meeting_id}`}
        className="mt-5 flex h-12 items-center justify-center rounded-xl px-4 text-[16px] font-medium text-white active:scale-[0.98] transition"
        style={{
          background: MR_COLORS.systemBlue,
          boxShadow: "0 4px 12px rgba(0,122,255,0.20)",
        }}
        data-testid="hero-enter-meeting"
      >
        立即进入 →
      </Link>
    </article>
  );
}

export default function HeroOngoingCard({
  meetings,
}: {
  meetings: WorkbenchOngoingMeeting[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || meetings.length <= 1) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        const idx = Math.round(el.scrollLeft / w);
        setActiveIdx(Math.max(0, Math.min(meetings.length - 1, idx)));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [meetings.length]);

  if (meetings.length === 0) return null;

  // 单场 — 直接渲, 不滑
  if (meetings.length === 1) {
    return <HeroSingle m={meetings[0]} />;
  }

  // 多场 — snap 横向, 一次显一张整屏
  return (
    <div>
      <div
        ref={scrollRef}
        className="-mx-4 flex snap-x snap-mandatory overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {meetings.map((m) => (
          <div key={m.meeting_id} className="w-full shrink-0 snap-center px-4">
            <HeroSingle m={m} />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5">
        {meetings.map((_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === activeIdx ? 20 : 6,
              background:
                i === activeIdx ? MR_COLORS.systemBlue : MR_COLORS.separator,
            }}
          />
        ))}
      </div>
    </div>
  );
}
