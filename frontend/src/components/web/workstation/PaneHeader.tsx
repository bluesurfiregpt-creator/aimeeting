"use client";

import type { ReactNode } from "react";
import { W_TOKENS } from "../tokens";

/**
 * Workstation pane 顶部公共 header.
 * eyebrow + title + sub + 右侧 extra/action.
 */
export function PaneHeader({
  title,
  sub,
  action,
  extra,
  eyebrow,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  extra?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: W_TOKENS.textFaint,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              marginBottom: 5,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: -0.6,
            color: W_TOKENS.textPrimary,
          }}
        >
          {title}
        </h1>
        {sub && (
          <div
            style={{
              marginTop: 6,
              fontSize: 13.5,
              color: W_TOKENS.textSecondary,
              lineHeight: 1.55,
              maxWidth: 720,
            }}
          >
            {sub}
          </div>
        )}
      </div>
      <div
        style={{
          display: "inline-flex",
          gap: 8,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {extra}
        {action}
      </div>
    </div>
  );
}
