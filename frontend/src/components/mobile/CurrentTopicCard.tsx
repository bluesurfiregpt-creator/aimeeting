"use client";

/**
 * @deprecated v1.2.0 Saga · meeting-room-v2: 已被新 MeetingTranscriptView + Dock
 *   替代. page.tsx 不再 import 这个文件. 保留作为 dead code 不删 (TD6 —
 *   PM 决策保守 scope, 下个 Saga 一并清).
 *
 * v27.0-mobile · 会议室当前议题主卡 (历史).
 *
 * 整屏最重信息块. 三段视觉:
 *   1. 议题 header — title + 时长
 *   2. AI 智囊 block — 突出紫色 box (按用户 Q1 校准: AI 单独视觉块, 跟真人区分)
 *   3. 真人表态 list — 极简, 项符圆点, 视觉弱化
 *
 * 不在卡内放 sticky CTA — 那是 StickyActionBar 的活, 整屏共用.
 */

import {
  AgentLabel,
  AIInsightChip,
  TypeChip,
} from "./AIInsightCard";
import type {
  AIInsightFull,
  MobileMeetingHumanLine,
} from "@/lib/mobile/types";

export default function CurrentTopicCard({
  topicTitle,
  elapsedMin,
  insights,
  recentLines,
}: {
  topicTitle: string;
  elapsedMin: number | null;
  insights: AIInsightFull[];
  recentLines: MobileMeetingHumanLine[];
}) {
  return (
    <article
      className="rounded-2xl border border-zinc-800 bg-ink-900 p-5"
      data-testid="mobile-current-topic"
    >
      {/* ===== Header ============================================ */}
      <header>
        <p className="text-[14px] font-medium text-zinc-400">当前议题</p>
        <h2 className="mt-1 text-[20px] font-semibold leading-snug text-zinc-50">
          {topicTitle}
        </h2>
        {elapsedMin !== null ? (
          <p className="mt-2 text-[14px] text-zinc-400">
            已议 <span className="font-medium text-zinc-100 tabular-nums">{elapsedMin}</span> min
            {recentLines.length > 0 ? (
              <>
                {" · "}
                <span className="font-medium text-zinc-100 tabular-nums">
                  {new Set(recentLines.map((l) => l.speaker_name)).size}
                </span>{" "}
                人表态
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      {/* ===== AI 智囊块 (突出紫色 box) ======================= */}
      <section className="mt-4 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.08] to-violet-500/[0.02] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-medium text-violet-200">
            💡 AI 智囊 · {insights.length} 条
          </h3>
        </header>
        {insights.length === 0 ? (
          <p className="text-[14px] text-zinc-400">
            AI 还没给这议题判断.
            <span className="ml-1 text-zinc-500">召一个加视角 →</span>
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.map((ins) => (
              <li key={ins.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <AgentLabel
                    nickname={ins.agent_nickname}
                    name={ins.agent_name}
                    className="text-[14px]"
                  />
                  <TypeChip type={ins.type} />
                </div>
                <p className="mt-1.5 text-[16px] leading-snug text-zinc-50">
                  {ins.content}
                </p>
                {ins.evidence ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
                    <span className="text-zinc-500">▸</span> {ins.evidence}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== 真人表态 list (极简, 视觉弱化) ================ */}
      {recentLines.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-2 text-[14px] font-medium text-zinc-400">真人表态</h3>
          <ul className="space-y-2.5">
            {recentLines.map((line, i) => (
              <li
                key={i}
                className="flex items-baseline gap-2 text-[15px] leading-snug"
              >
                <span className="shrink-0 text-zinc-500">·</span>
                <span className="shrink-0 font-medium text-zinc-300">
                  {line.speaker_name}
                </span>
                <span className="min-w-0 text-zinc-200">{line.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
