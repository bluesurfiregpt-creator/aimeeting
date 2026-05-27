"use client";

/**
 * v1.4.0 · Saga N · 4 格 snapshot stat tile (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-today.jsx:261-297
 * (TodaySnapshot 内 stat tile).
 *
 * 单格: 白卡 12px 圆角 + 0.5px hairline + 右上角彩色角斑 (28×28 圆角内嵌) +
 *       大 24px weight 800 数字 (tabular-nums, letter -0.5) + 11px 标签 + 10px 副标.
 *
 * 用 4 个 tile 一行 grid (display: grid, gridTemplateColumns: repeat(4, 1fr), gap: 8).
 *
 * 4 色 tone:
 *   - blue   场会议  num #007AFF · accent rgba(0,122,255,0.10)
 *   - red    待处理  num #FF3B30 · accent rgba(255,59,48,0.10)
 *   - purple AI 洞察 num #5E5CE6 · accent rgba(94,92,230,0.12)
 *   - green  已决策  num #1F8A5B · accent rgba(52,199,89,0.12)
 *
 * 跟 SCHEMA §3.3 snapshot 字段 (meetings_today / pending_tasks /
 * ai_insights_today / decisions_today) 配套.
 */

import type { ReactElement } from "react";

export type V2StatTone = "blue" | "red" | "purple" | "green";

const TONES: Record<V2StatTone, { num: string; accent: string }> = {
  blue: { num: "#007AFF", accent: "rgba(0,122,255,0.10)" },
  red: { num: "#FF3B30", accent: "rgba(255,59,48,0.10)" },
  purple: { num: "#5E5CE6", accent: "rgba(94,92,230,0.12)" },
  green: { num: "#1F8A5B", accent: "rgba(52,199,89,0.12)" },
};

type Props = {
  label: string;
  value: number;
  sublabel?: string;
  tone?: V2StatTone;
};

export default function MStatTile({
  label,
  value,
  sublabel,
  tone = "blue",
}: Props): ReactElement {
  const c = TONES[tone];
  return (
    <div
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
      data-testid="m-stat-tile"
      data-tone={tone}
    >
      {/* 右上角彩色角斑 */}
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
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#1C1C1E",
          marginTop: 2,
        }}
      >
        {label}
      </div>
      {sublabel ? (
        <div
          style={{
            fontSize: 10,
            color: "#8E8E93",
            lineHeight: 1.3,
          }}
        >
          {sublabel}
        </div>
      ) : null}
    </div>
  );
}
