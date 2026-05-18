"use client";

/**
 * v27.0-mobile · 首页 Hero — 进行中 会议 主卡.
 *
 * 占 屏 ~45%. 整 屏 视觉 锚 — 用户 进 首页 立 刻 知 道 "现 在 在 推 啥".
 *
 * 设计 约束:
 *   - 一 张 主卡 占 屏 顶部 大段 (会议 多 时 carousel 切, 一次 仅 显 一张)
 *   - 标题 大字 (22-24px), 状态 副字 (14px), AI 关键判断 callout
 *   - 唯 一 主 CTA: [立即 进入] 全宽 大按钮, touch 48px+
 *   - 不 是 "卡 列表" 中 的 一张, 是 真正 的 信息 主角
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WorkbenchOngoingMeeting } from "@/lib/mobile/types";

// type 配色 — 跟 AIInsightCard 保持 一致
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
      {/* 顶 部 小 标 */}
      <p className="text-[13px] text-zinc-400">你 正 在 推 进</p>

      {/* 主 标题 */}
      <h1 className="mt-2 text-[22px] font-medium leading-tight text-zinc-50">
        {m.title}
      </h1>

      {/* 状态 行 */}
      <div className="mt-2 flex items-center gap-2 text-[13px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-emerald-300">进行中</span>
        </span>
        <span className="text-zinc-600">·</span>
        <span>{m.started_minutes_ago} min</span>
      </div>

      {/* 议程 进度 */}
      {m.total_agenda_items > 0 ? (
        <div className="mt-4">
          <StageBar cur={m.current_agenda_idx} total={m.total_agenda_items} />
        </div>
      ) : null}

      {/* AI 关键 判断 callout */}
      {insight && tone ? (
        <div className={`mt-4 rounded-xl border-l-[3px] ${tone.border} ${tone.bg} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-zinc-300">◆</span>
            <span className="text-[13px] font-medium text-zinc-100">{agentDisplay}</span>
            <span className="text-[11px] text-zinc-500">· {insight.agent_name === agentDisplay ? "" : insight.agent_name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.text}`}>
              {insight.type}
            </span>
          </div>
          <p className="mt-1.5 text-[15px] leading-snug text-zinc-100">
            {insight.content}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-700/60 px-4 py-3 text-[13px] text-zinc-500">
          这场 会 AI 还 没 给 关键 判断
        </div>
      )}

      {/* 主 CTA */}
      <Link
        href={`/m/meetings/${m.meeting_id}`}
        className="mt-5 flex h-12 items-center justify-center rounded-xl bg-accent-500 px-4 text-[16px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 transition"
        data-testid="hero-enter-meeting"
      >
        立即 进入 →
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

  // 单 场 — 直接 渲, 不滑
  if (meetings.length === 1) {
    return <HeroSingle m={meetings[0]} />;
  }

  // 多 场 — snap 横向, 一次 显 一张 整 屏
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
