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
 *
 * v1.4.0 Saga L · 浅色化 (虽 deprecated, 保持 0 dark token 收官).
 */

import {
  AgentLabel,
  TypeChip,
} from "./AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
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
      className="rounded-2xl p-5"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-current-topic"
    >
      {/* ===== Header ============================================ */}
      <header>
        <p
          className="text-[14px] font-medium"
          style={{ color: MR_COLORS.textTertiary }}
        >
          当前议题
        </p>
        <h2
          className="mt-1 text-[20px] font-semibold leading-snug"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {topicTitle}
        </h2>
        {elapsedMin !== null ? (
          <p
            className="mt-2 text-[14px]"
            style={{ color: MR_COLORS.textSecondary }}
          >
            已议{" "}
            <span
              className="font-medium tabular-nums"
              style={{ color: MR_COLORS.textPrimary }}
            >
              {elapsedMin}
            </span>{" "}
            min
            {recentLines.length > 0 ? (
              <>
                {" · "}
                <span
                  className="font-medium tabular-nums"
                  style={{ color: MR_COLORS.textPrimary }}
                >
                  {new Set(recentLines.map((l) => l.speaker_name)).size}
                </span>{" "}
                人表态
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      {/* ===== AI 智囊块 (浅色紫调 box) ======================= */}
      <section
        className="mt-4 rounded-xl p-4"
        style={{
          background: "rgba(94,92,230,0.06)",
          border: "0.5px solid rgba(94,92,230,0.30)",
        }}
      >
        <header className="mb-3 flex items-center justify-between">
          <h3
            className="text-[15px] font-medium"
            style={{ color: MR_COLORS.systemPurple }}
          >
            💡 AI 智囊 · {insights.length} 条
          </h3>
        </header>
        {insights.length === 0 ? (
          <p
            className="text-[14px]"
            style={{ color: MR_COLORS.textSecondary }}
          >
            AI 还没给这议题判断.
            <span
              className="ml-1"
              style={{ color: MR_COLORS.textTertiary }}
            >
              召一个加视角 →
            </span>
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
                <p
                  className="mt-1.5 text-[16px] leading-snug"
                  style={{ color: MR_COLORS.textPrimary }}
                >
                  {ins.content}
                </p>
                {ins.evidence ? (
                  <p
                    className="mt-1.5 text-[13px] leading-relaxed"
                    style={{ color: MR_COLORS.textSecondary }}
                  >
                    <span style={{ color: MR_COLORS.textTertiary }}>▸</span>{" "}
                    {ins.evidence}
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
          <h3
            className="mb-2 text-[14px] font-medium"
            style={{ color: MR_COLORS.textTertiary }}
          >
            真人表态
          </h3>
          <ul className="space-y-2.5">
            {recentLines.map((line, i) => (
              <li
                key={i}
                className="flex items-baseline gap-2 text-[15px] leading-snug"
              >
                <span
                  className="shrink-0"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  ·
                </span>
                <span
                  className="shrink-0 font-medium"
                  style={{ color: MR_COLORS.textSecondary }}
                >
                  {line.speaker_name}
                </span>
                <span
                  className="min-w-0"
                  style={{ color: MR_COLORS.textPrimary }}
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
