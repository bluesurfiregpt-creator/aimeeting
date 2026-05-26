"use client";

import type { ReactNode } from "react";
import { WIcon, type WIconName } from "./WIcon";

/**
 * Pill / chip / tag — 7 tone × 2 size.
 * 颜色是 brand 色, 不走 CSS variable (跨 theme 视觉一致).
 */
export type WPillTone = "neutral" | "accent" | "cyan" | "pink" | "success" | "warn" | "danger";
export type WPillSize = "sm" | "md";

const TONES: Record<WPillTone, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "rgba(255,255,255,0.06)", fg: "#a1a1aa", bd: "rgba(255,255,255,0.08)" },
  accent:  { bg: "rgba(124,92,250,0.14)",  fg: "#C4B5FD", bd: "rgba(124,92,250,0.30)" },
  cyan:    { bg: "rgba(100,210,255,0.12)", fg: "#7DDEFF", bd: "rgba(100,210,255,0.26)" },
  pink:    { bg: "rgba(255,100,130,0.12)", fg: "#FF99B6", bd: "rgba(255,100,130,0.26)" },
  success: { bg: "rgba(34,197,94,0.14)",   fg: "#86EFAC", bd: "rgba(34,197,94,0.30)" },
  warn:    { bg: "rgba(245,158,11,0.14)",  fg: "#FCD34D", bd: "rgba(245,158,11,0.30)" },
  danger:  { bg: "rgba(239,68,68,0.14)",   fg: "#FCA5A5", bd: "rgba(239,68,68,0.30)" },
};

export function WPill({
  children,
  tone = "neutral",
  size = "sm",
  icon,
}: {
  children: ReactNode;
  tone?: WPillTone;
  size?: WPillSize;
  icon?: WIconName;
}) {
  const c = TONES[tone];
  const padding = size === "sm" ? "2px 7px" : "4px 10px";
  const fontSize = size === "sm" ? 11 : 12;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding,
        borderRadius: 5,
        background: c.bg,
        color: c.fg,
        fontSize,
        fontWeight: 600,
        letterSpacing: 0.3,
        boxShadow: `inset 0 0 0 0.5px ${c.bd}`,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
      }}
    >
      {icon && <WIcon name={icon} size={fontSize - 1} color={c.fg} stroke={2} />}
      {children}
    </span>
  );
}
