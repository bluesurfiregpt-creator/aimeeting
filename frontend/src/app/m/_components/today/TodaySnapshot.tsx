"use client";

/**
 * Saga · mobile-app-r4-A · today 页 4 张统计 snapshot 小卡.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:259-297
 */

import type { ReactElement } from "react";

type Tone = "blue" | "red" | "purple" | "green";

export type SnapshotStat = {
  value: number;
  label: string;
  sub: string;
  tone: Tone;
};

const TONES: Record<Tone, { num: string; accent: string }> = {
  blue: { num: "#007AFF", accent: "rgba(0,122,255,0.10)" },
  red: { num: "#FF3B30", accent: "rgba(255,59,48,0.10)" },
  purple: { num: "#5E5CE6", accent: "rgba(94,92,230,0.12)" },
  green: { num: "#1F8A5B", accent: "rgba(52,199,89,0.12)" },
};

export default function TodaySnapshot({
  stats,
}: {
  stats: SnapshotStat[];
}): ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 8,
      }}
    >
      {stats.map((s, i) => {
        const c = TONES[s.tone];
        return (
          <div
            key={`${s.label}-${i}`}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "10px 8px 10px",
              border: "0.5px solid rgba(60,60,67,0.10)",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 28,
                height: 28,
                background: c.accent,
                borderBottomLeftRadius: 16,
              }}
            />
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: c.num,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: -0.5,
                lineHeight: 1,
                position: "relative",
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#1C1C1E",
                marginTop: 2,
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: 10, color: "#8E8E93", lineHeight: 1.3 }}>
              {s.sub}
            </div>
          </div>
        );
      })}
    </div>
  );
}
