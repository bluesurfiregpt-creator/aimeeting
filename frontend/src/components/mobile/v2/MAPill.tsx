"use client";

/**
 * v1.4.0 · Saga M1 · 状态 pill atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:391-409
 * (MAStatusPill, 扩展到 8 tone).
 *
 * 8 个 tone:
 *   - live      绿底白字 (LIVE pulse 配合 pulse 圆点)
 *   - upcoming  浅蓝底蓝字 (即将开始)
 *   - done      浅灰底灰字 (已结束)
 *   - urgent    红底白字 (紧急 / 今日必做)
 *   - today     浅橙底深橙字 (今日)
 *   - week      浅灰底中灰字 (本周)
 *   - info      浅紫底紫字 (信息)
 *   - neutral   浅灰底灰字 (默认)
 *
 * pulse=true 时左侧加 6×6 白圆 + maPulse 动画 (LIVE 用).
 *
 * 注: pulse 动画 keyframe `maPulse` 需要在挂载页面 inject, 见
 * `frontend/src/app/m/meetings/page.tsx` (Saga M3 注入).
 */

import type { ReactElement } from "react";

export type V2PillTone =
  | "live"
  | "upcoming"
  | "done"
  | "urgent"
  | "today"
  | "week"
  | "info"
  | "neutral";

const TONES: Record<V2PillTone, { bg: string; fg: string }> = {
  live: { bg: "#34C759", fg: "#fff" },
  upcoming: { bg: "rgba(0,122,255,0.10)", fg: "#007AFF" },
  done: { bg: "rgba(60,60,67,0.10)", fg: "#3C3C43" },
  urgent: { bg: "#FF3B30", fg: "#fff" },
  today: { bg: "rgba(255,159,10,0.14)", fg: "#B36A00" },
  week: { bg: "rgba(60,60,67,0.08)", fg: "#3C3C43" },
  info: { bg: "rgba(94,92,230,0.10)", fg: "#5E5CE6" },
  neutral: { bg: "rgba(60,60,67,0.10)", fg: "#3C3C43" },
};

type Props = {
  tone: V2PillTone;
  label: string;
  /** 是否显示 LIVE 脉冲 (6px 白圆 + animation) */
  pulse?: boolean;
};

export default function MAPill({
  tone,
  label,
  pulse = false,
}: Props): ReactElement {
  const c = TONES[tone];
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: c.fg,
        background: c.bg,
        padding: "2px 6px",
        borderRadius: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {pulse ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: c.fg === "#fff" ? "#fff" : c.fg,
            animation: "v2Pulse 1.4s ease-in-out infinite",
          }}
        />
      ) : null}
      {label}
    </span>
  );
}
