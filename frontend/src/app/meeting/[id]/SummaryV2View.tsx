"use client";

/**
 * v1.4.0 Phase A · 4 (NORTH_STAR § 6.1 痛点 3) · SummaryV2View (Web)
 *
 * Web 端 结构化 summary v2 渲染:
 *   - 按 topic 分组 (议题 卡片)
 *   - 每个 topic 列 speakers (人 + AI) + stance pill
 *   - decision + action_items + 任务溯源 chip
 *   - 顶部 overview + key_takeaways + risks + next_steps
 *
 * 注意: Web 会议室是 light theme (跟 mobile 浅色 一致, 不走 W_THEME dark) —
 * 但 SummaryV2View 是 在 /meeting/[id] (会议详情页) 渲染 的, 该页 走 W_THEME.
 * 实际 这里 偏 light 但 用 W_TOKENS — token 自适应 data-theme.
 */

import Link from "next/link";
import { W_TOKENS } from "@/components/web/tokens";
import type {
  WebMeetingSummaryV2,
  WebSummaryV2Speaker,
  WebSummaryV2Stance,
  WebSummaryV2Topic,
} from "@/lib/api";

const STANCE_META: Record<
  WebSummaryV2Stance,
  { label: string; bg: string; fg: string; border: string }
> = {
  support: {
    label: "支持",
    bg: "rgba(34,197,94,0.12)",
    fg: "#22c55e",
    border: "rgba(34,197,94,0.32)",
  },
  caution: {
    label: "顾虑",
    bg: "rgba(245,158,11,0.12)",
    fg: "#f59e0b",
    border: "rgba(245,158,11,0.32)",
  },
  block: {
    label: "反对",
    bg: "rgba(239,68,68,0.12)",
    fg: "#ef4444",
    border: "rgba(239,68,68,0.32)",
  },
  neutral: {
    label: "中立",
    bg: "rgba(150,150,160,0.12)",
    fg: W_TOKENS.textMuted,
    border: "rgba(150,150,160,0.24)",
  },
};

function StancePill({ stance }: { stance: WebSummaryV2Stance }) {
  const m = STANCE_META[stance] || STANCE_META.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: m.bg,
        color: m.fg,
        border: `1px solid ${m.border}`,
      }}
    >
      {m.label}
    </span>
  );
}

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
    // v1.4.0 Phase A · 4: Web meeting page 用 plain int ?focus=<id1>,<id2>...
    // (见 page.tsx focusIds parser, line 271-281). Mobile 用 user-<id> 前缀.
    // 两端 各有 自己 规约, 不强行 统一.
    <Link
      href={`/meeting/${meetingId}?focus=${lineId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        color: W_TOKENS.accent,
        background: W_TOKENS.accentSoft,
        border: `1px solid ${W_TOKENS.borderActive}`,
        textDecoration: "none",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M5 6L6 7L7.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label || "跳实录"}</span>
    </Link>
  );
}

function SpeakerRow({ s }: { s: WebSummaryV2Speaker }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: W_TOKENS.surface,
        border: `1px solid ${W_TOKENS.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {s.speaker_type === "ai" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0 6px",
              height: 16,
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              background: W_TOKENS.accentSoft,
              color: W_TOKENS.accent,
            }}
          >
            AI
          </span>
        ) : null}
        <span style={{ fontSize: 13, fontWeight: 600, color: W_TOKENS.textPrimary }}>
          {s.speaker_name}
        </span>
        <StancePill stance={s.stance} />
      </div>
      {s.points.length > 0 ? (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
          {s.points.map((p, i) => (
            <li
              key={i}
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: W_TOKENS.textSecondary,
                paddingLeft: 12,
                position: "relative",
                marginTop: 2,
              }}
            >
              <span style={{ position: "absolute", left: 0 }}>·</span>
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TopicCard({
  topic,
  meetingId,
}: {
  topic: WebSummaryV2Topic;
  meetingId: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: W_TOKENS.surfaceRaised,
        border: `1px solid ${W_TOKENS.border}`,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: W_TOKENS.textPrimary }}>
        {topic.topic || "(未命名议题)"}
      </h3>
      {topic.summary ? (
        <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55, color: W_TOKENS.textSecondary }}>
          {topic.summary}
        </p>
      ) : null}

      {topic.speakers.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {topic.speakers.map((s, i) => (
            <SpeakerRow key={`${s.speaker_name}-${i}`} s={s} />
          ))}
        </div>
      ) : null}

      {topic.decision ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 8,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "#22c55e" }}>
            ✓ 决定
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5, color: W_TOKENS.textPrimary }}>
            {topic.decision}
          </p>
        </div>
      ) : null}

      {topic.action_items.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: W_TOKENS.textMuted }}>
            📌 待办
          </div>
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {topic.action_items.map((a, i) => (
              <li
                key={i}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: W_TOKENS.surface,
                  border: `1px solid ${W_TOKENS.border}`,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span
                    style={{
                      display: "inline-block",
                      flexShrink: 0,
                      width: 12,
                      height: 12,
                      marginTop: 4,
                      borderRadius: 3,
                      border: `1.5px solid ${W_TOKENS.borderActive}`,
                    }}
                    aria-hidden="true"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: W_TOKENS.textPrimary }}>
                      {a.text}
                    </p>
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        fontSize: 11,
                        color: W_TOKENS.textMuted,
                      }}
                    >
                      {a.owner ? <span>负责: {a.owner}</span> : null}
                      {a.due_date ? <span>截止: {a.due_date}</span> : null}
                      {a.source_line_id ? (
                        <SourceChip meetingId={meetingId} lineId={a.source_line_id} />
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
  data: WebMeetingSummaryV2;
  meetingId: string;
};

export default function SummaryV2View({ data, meetingId }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.title ? (
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: W_TOKENS.textPrimary, lineHeight: 1.3 }}>
            {data.title}
          </h2>
          {data.overview ? (
            <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: W_TOKENS.textSecondary }}>
              {data.overview}
            </p>
          ) : null}
        </div>
      ) : null}

      {data.key_takeaways.length > 0 ? (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: W_TOKENS.accentSoft,
            border: `1px solid ${W_TOKENS.borderActive}`,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: W_TOKENS.accent }}>
            ⭐ 关键要点
          </div>
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
            {data.key_takeaways.map((t, i) => (
              <li
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: W_TOKENS.textPrimary,
                  paddingLeft: 14,
                  position: "relative",
                  marginTop: 2,
                }}
              >
                <span style={{ position: "absolute", left: 0 }}>·</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.topics.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.topics.map((tp, i) => (
            <TopicCard key={i} topic={tp} meetingId={meetingId} />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: W_TOKENS.textMuted }}>没有抽出议题</p>
      )}

      {data.risks.length > 0 ? (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: W_TOKENS.warn }}>
            ⚠ 风险提醒
          </div>
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {data.risks.map((r, i) => (
              <li
                key={i}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: W_TOKENS.surface,
                  border: `1px solid ${W_TOKENS.border}`,
                }}
              >
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: W_TOKENS.textPrimary }}>
                  {r.text}
                </p>
                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                  }}
                >
                  {r.raised_by ? <span>提出: {r.raised_by}</span> : null}
                  {r.source_line_id ? (
                    <SourceChip meetingId={meetingId} lineId={r.source_line_id} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.next_steps.length > 0 ? (
        <div>
          <div style={{ padding: "0 4px", fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: W_TOKENS.textMuted }}>
            ➜ 下一步建议
          </div>
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {data.next_steps.map((n, i) => (
              <li
                key={i}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: W_TOKENS.textPrimary,
                  background: W_TOKENS.surface,
                  border: `1px solid ${W_TOKENS.border}`,
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
