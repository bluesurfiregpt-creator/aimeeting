"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · 浅色 section header.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:411-443
 * (MASection)
 *
 * 结构:
 *   左: <title (17/700 #1C1C1E -0.2 letter)>  <count(13 #8E8E93 tabular)>
 *   右: <action 13/500 #007AFF>
 *   下: <sub (12 #8E8E93)?
 *   children: 卡内容
 */

import type { ReactElement, ReactNode } from "react";

type Props = {
  title: string;
  count?: number;
  action?: string;
  onAction?: () => void;
  sub?: string;
  children: ReactNode;
  /** 顶部 marginTop (默认 24, 首段可以传 16 / 0). */
  marginTop?: number;
};

export default function MASection({
  title,
  count,
  action,
  onAction,
  sub,
  children,
  marginTop = 24,
}: Props): ReactElement {
  return (
    <div style={{ marginTop }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 16px 8px",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 7 }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 700,
              color: "#1C1C1E",
              letterSpacing: -0.2,
            }}
          >
            {title}
          </h2>
          {count !== undefined ? (
            <span
              style={{
                fontSize: 13,
                color: "#8E8E93",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count}
            </span>
          ) : null}
        </div>
        {action ? (
          <button
            type="button"
            onClick={onAction}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "#007AFF",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {action}
          </button>
        ) : null}
      </div>
      {sub ? (
        <div
          style={{
            padding: "0 16px 8px",
            fontSize: 12,
            color: "#8E8E93",
            marginTop: -4,
          }}
        >
          {sub}
        </div>
      ) : null}
      {children}
    </div>
  );
}
