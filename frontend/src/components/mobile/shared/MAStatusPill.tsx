"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · iOS 状态 pill.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:391-409
 * (MAStatusPill)
 */

import type { ReactElement, ReactNode } from "react";

export type StatusPillKind =
  | "live"
  | "upcoming"
  | "done"
  | "overdue"
  | "soon";

const MAP: Record<StatusPillKind, { bg: string; text: string }> = {
  live: { bg: "#34C759", text: "#fff" },
  upcoming: { bg: "rgba(0,122,255,0.10)", text: "#007AFF" },
  done: { bg: "rgba(60,60,67,0.10)", text: "#3C3C43" },
  overdue: { bg: "#FF3B30", text: "#fff" },
  soon: { bg: "rgba(255,159,10,0.14)", text: "#B36A00" },
};

export default function MAStatusPill({
  kind,
  children,
}: {
  kind: StatusPillKind;
  children: ReactNode;
}): ReactElement {
  const c = MAP[kind];
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: c.text,
        background: c.bg,
        padding: "2px 6px",
        borderRadius: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
