"use client";

/**
 * v1.4.0 Phase A · 4 (NORTH_STAR § 6.1 痛点 3) · MSummaryV2
 *
 * Mobile 结构化 summary v2 渲染:
 *   - 按 topic 分组 (议题 卡片)
 *   - 每个 topic 下 列 speakers (真人 + AI) + 立场 pill (support / caution / block / neutral)
 *   - decision 强调显示
 *   - action_items 卡, 含 任务溯源 chip — 点击 跳 ?focus=line-<id> 实录 高亮
 *   - 顶部 overview + key_takeaways + risks + next_steps
 *
 * 老会议 (summary_json 是 null) → parent 走 ReactMarkdown(summary_md) fallback.
 *
 * 设计原则 (DESIGN_SYSTEM.md):
 *   - 浅色 iOS 配色 (MR_COLORS)
 *   - stance 用 颜色 + 文字 双重 表达 (色盲可读)
 *   - 任务溯源 chip 用 链接 样式 + 下划线 hover
 */

import Link from "next/link";
import type {
  MeetingSummaryV2,
  SummaryV2Speaker,
  SummaryV2Stance,
  SummaryV2Topic,
} from "@/lib/mobile/types";
import { MR_COLORS } from "./meeting-room/styles";

const STANCE_META: Record<
  SummaryV2Stance,
  { label: string; bg: string; fg: string; border: string }
> = {
  support: {
    label: "支持",
    bg: "rgba(52,199,89,0.10)",
    fg: "#34C759",
    border: "rgba(52,199,89,0.30)",
  },
  caution: {
    label: "顾虑",
    bg: "rgba(255,159,10,0.10)",
    fg: "#FF9F0A",
    border: "rgba(255,159,10,0.30)",
  },
  block: {
    label: "反对",
    bg: "rgba(255,59,48,0.10)",
    fg: "#FF3B30",
    border: "rgba(255,59,48,0.30)",
  },
  neutral: {
    label: "中立",
    bg: "rgba(142,142,147,0.10)",
    fg: "#8E8E93",
    border: "rgba(142,142,147,0.30)",
  },
};

function StancePill({ stance }: { stance: SummaryV2Stance }) {
  const m = STANCE_META[stance] || STANCE_META.neutral;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: m.bg,
        color: m.fg,
        border: `0.5px solid ${m.border}`,
      }}
    >
      {m.label}
    </span>
  );
}

function SpeakerRow({ s }: { s: SummaryV2Speaker }) {
  return (
    <div className="rounded-lg bg-white p-2.5" style={{ border: `0.5px solid rgba(60,60,67,0.10)` }}>
      <div className="flex items-center gap-2">
        {s.speaker_type === "ai" ? (
          <span
            className="inline-flex h-4 items-center rounded px-1 text-[10px] font-bold"
            style={{
              background: "rgba(88,86,214,0.12)",
              color: "#5856D6",
              letterSpacing: 0.4,
            }}
          >
            AI
          </span>
        ) : null}
        <span
          className="text-[13px] font-semibold"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {s.speaker_name}
        </span>
        <StancePill stance={s.stance} />
      </div>
      {s.points.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {s.points.map((p, i) => (
            <li
              key={i}
              className="text-[12.5px] leading-snug"
              style={{ color: MR_COLORS.textSecondary }}
            >
              · {p}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 任务溯源 chip: 点击 跳 /m/meetings/<id>?focus=line-<line_id> */
function SourceChip({
  meetingId,
  lineId,
  label,
}: {
  meetingId: string;
  lineId: number;
  label?: string;
}) {
  return (
    <Link
      href={`/m/meetings/${meetingId}?focus=user-${lineId}`}
      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] active:scale-[0.97]"
      style={{
        border: `0.5px solid rgba(0,122,255,0.30)`,
        color: "#007AFF",
        textDecoration: "none",
      }}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 6L6 7L7.5 5.5"
          stroke="#007AFF"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="6"
          cy="6"
          r="4.5"
          stroke="#007AFF"
          strokeWidth="1"
          fill="none"
        />
      </svg>
      <span>{label || "跳实录"}</span>
    </Link>
  );
}

function TopicCard({
  topic,
  meetingId,
}: {
  topic: SummaryV2Topic;
  meetingId: string;
}) {
  return (
    <div
      className="rounded-2xl bg-white p-3.5"
      style={{ border: `0.5px solid rgba(60,60,67,0.12)` }}
    >
      {/* topic header */}
      <h3
        className="text-[15px] font-semibold"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {topic.topic || "(未命名议题)"}
      </h3>
      {topic.summary ? (
        <p
          className="mt-1 text-[12.5px] leading-relaxed"
          style={{ color: MR_COLORS.textSecondary }}
        >
          {topic.summary}
        </p>
      ) : null}

      {/* speakers */}
      {topic.speakers.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {topic.speakers.map((s, i) => (
            <SpeakerRow key={`${s.speaker_name}-${i}`} s={s} />
          ))}
        </div>
      ) : null}

      {/* decision */}
      {topic.decision ? (
        <div
          className="mt-3 rounded-lg p-2.5"
          style={{
            background: "rgba(52,199,89,0.08)",
            border: "0.5px solid rgba(52,199,89,0.25)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold" style={{ color: "#34C759", letterSpacing: 0.4 }}>
              ✓ 决定
            </span>
          </div>
          <p
            className="mt-1 text-[13px] leading-snug"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {topic.decision}
          </p>
        </div>
      ) : null}

      {/* action items */}
      {topic.action_items.length > 0 ? (
        <div className="mt-3">
          <p
            className="text-[11.5px] font-medium"
            style={{ color: MR_COLORS.textTertiary, letterSpacing: 0.3 }}
          >
            📌 待办
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {topic.action_items.map((a, i) => (
              <li
                key={i}
                className="rounded-lg bg-white p-2"
                style={{ border: `0.5px solid rgba(60,60,67,0.10)` }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-[3px]"
                    style={{ border: `1.5px solid rgba(0,122,255,0.40)` }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[12.5px] leading-snug"
                      style={{ color: MR_COLORS.textPrimary }}
                    >
                      {a.text}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {a.owner ? (
                        <span style={{ color: MR_COLORS.textTertiary }}>
                          负责: {a.owner}
                        </span>
                      ) : null}
                      {a.due_date ? (
                        <span style={{ color: MR_COLORS.textTertiary }}>
                          截止: {a.due_date}
                        </span>
                      ) : null}
                      {a.source_line_id ? (
                        <SourceChip
                          meetingId={meetingId}
                          lineId={a.source_line_id}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  data: MeetingSummaryV2;
  meetingId: string;
};

export default function MSummaryV2({ data, meetingId }: Props) {
  return (
    <div className="space-y-3.5">
      {/* === 顶部: title + overview === */}
      {data.title ? (
        <div>
          <h2
            className="text-[18px] font-semibold leading-tight"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {data.title}
          </h2>
          {data.overview ? (
            <p
              className="mt-1.5 text-[13px] leading-relaxed"
              style={{ color: MR_COLORS.textSecondary }}
            >
              {data.overview}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* === key takeaways === */}
      {data.key_takeaways.length > 0 ? (
        <div
          className="rounded-2xl p-3.5"
          style={{
            background: "rgba(0,122,255,0.05)",
            border: "0.5px solid rgba(0,122,255,0.20)",
          }}
        >
          <p
            className="text-[11.5px] font-bold"
            style={{ color: "#007AFF", letterSpacing: 0.4 }}
          >
            ⭐ 关键要点
          </p>
          <ul className="mt-1.5 space-y-1">
            {data.key_takeaways.map((t, i) => (
              <li
                key={i}
                className="text-[13px] leading-snug"
                style={{ color: MR_COLORS.textPrimary }}
              >
                · {t}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* === topics === */}
      {data.topics.length > 0 ? (
        <div className="space-y-3">
          {data.topics.map((tp, i) => (
            <TopicCard key={i} topic={tp} meetingId={meetingId} />
          ))}
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: MR_COLORS.textTertiary }}>
          没有抽出议题
        </p>
      )}

      {/* === risks === */}
      {data.risks.length > 0 ? (
        <div
          className="rounded-2xl p-3.5"
          style={{
            background: "rgba(255,159,10,0.06)",
            border: "0.5px solid rgba(255,159,10,0.25)",
          }}
        >
          <p
            className="text-[11.5px] font-bold"
            style={{ color: "#FF9F0A", letterSpacing: 0.4 }}
          >
            ⚠ 风险提醒
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {data.risks.map((r, i) => (
              <li
                key={i}
                className="rounded-lg bg-white p-2"
                style={{ border: `0.5px solid rgba(60,60,67,0.10)` }}
              >
                <p
                  className="text-[12.5px] leading-snug"
                  style={{ color: MR_COLORS.textPrimary }}
                >
                  {r.text}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {r.raised_by ? (
                    <span style={{ color: MR_COLORS.textTertiary }}>
                      提出: {r.raised_by}
                    </span>
                  ) : null}
                  {r.source_line_id ? (
                    <SourceChip
                      meetingId={meetingId}
                      lineId={r.source_line_id}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* === next steps === */}
      {data.next_steps.length > 0 ? (
        <div>
          <p
            className="px-1 text-[11.5px] font-bold"
            style={{ color: MR_COLORS.textTertiary, letterSpacing: 0.4 }}
          >
            ➜ 下一步建议
          </p>
          <ul className="mt-1.5 space-y-1">
            {data.next_steps.map((n, i) => (
              <li
                key={i}
                className="rounded-lg bg-white px-3 py-2 text-[12.5px] leading-snug"
                style={{
                  color: MR_COLORS.textPrimary,
                  border: `0.5px solid rgba(60,60,67,0.10)`,
                }}
              >
                {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
