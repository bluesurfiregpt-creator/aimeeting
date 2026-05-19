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
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WorkbenchOngoingMeeting } from "@/lib/mobile/types";

// type 配色 — 跟 AIInsightCard 保持一致
const TYPE_TONE: Record<string, { border: string; text: string; bg: string }> = {
  建议: { border: "border-violet-500/50", text: "text-violet-200", bg: "bg-violet-500/10" },
  决策建议: { border: "border-emerald-500/50", text: "text-emerald-200", bg: "bg-emerald-500/10" },
  风险: { border: "border-rose-500/50", text: "text-rose-200", bg: "bg-rose-500/10" },
  洞察: { border: "border-sky-500/50", text: "text-sky-200", bg: "bg-sky-500/10" },
  思路: { border: "border-amber-500/50", text: "text-amber-200", bg: "bg-amber-500/10" },
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
          return (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                done
                  ? "bg-emerald-400/70"
                  : active
                  ? "bg-accent-400"
                  : "bg-zinc-700/70"
              }`}
            />
          );
        })}
      </div>
      <span className="shrink-0 text-[13px] text-zinc-400">
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
      className="relative overflow-hidden rounded-2xl border border-accent-500/30 bg-gradient-to-br from-accent-500/[0.12] via-violet-500/[0.05] to-ink-900 p-5"
      data-testid="mobile-hero-ongoing"
    >
      {/* 顶部小标 */}
      <p className="text-[14px] font-medium text-zinc-300">你正在推进</p>

      {/* 主标题 */}
      <h1 className="mt-2 text-[22px] font-semibold leading-tight text-zinc-50">
        {m.title}
      </h1>

      {/* 状态行 */}
      <div className="mt-2 flex items-center gap-2 text-[14px] text-zinc-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-emerald-300">进行中</span>
        </span>
        <span className="text-zinc-500">·</span>
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
        <div className={`mt-4 rounded-xl border-l-[3px] ${tone.border} ${tone.bg} px-4 py-3`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] text-zinc-300">◆</span>
            <span className="text-[14px] font-medium text-zinc-100">{agentDisplay}</span>
            {insight.agent_name !== agentDisplay ? (
              <span className="text-[13px] text-zinc-500">· {insight.agent_name}</span>
            ) : null}
            <span className={`rounded px-2 py-0.5 text-[13px] font-medium ${tone.bg} ${tone.text}`}>
              {insight.type}
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-zinc-100">
            {insight.content}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-700/60 px-4 py-3 text-[14px] text-zinc-400">
          这场会 AI 还没给关键判断
        </div>
      )}

      {/* 主 CTA */}
      <Link
        href={`/m/meetings/${m.meeting_id}`}
        className="mt-5 flex h-12 items-center justify-center rounded-xl bg-accent-500 px-4 text-[16px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 transition"
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
            className={`h-1.5 rounded-full transition-all ${
              i === activeIdx ? "w-5 bg-accent-400" : "w-1.5 bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
