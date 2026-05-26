"use client";

/**
 * v1.4.0 · Saga M1 · Section header atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:412-443
 * (MASection).
 *
 * 17px weight 700 letter -0.2 标题 + 可选 count (13px 灰) + 可选 action (13px 蓝).
 * 可选 subtitle (12px 灰, 在标题下方).
 *
 * 边距: 0 16px 8px (跟设计稿一致), 上面留 24px 间距.
 */

import type { ReactElement, ReactNode } from "react";

type Props = {
  title: string;
  count?: number;
  action?: string;
  onAction?: () => void;
  subtitle?: string;
  /** 顶部 margin, 默认 24 (跟设计稿). 0 时无 margin. */
  topMargin?: number;
  children?: ReactNode;
};

export default function MASection({
  title,
  count,
  action,
  onAction,
  subtitle,
  topMargin = 24,
  children,
}: Props): ReactElement {
  return (
    <div style={{ marginTop: topMargin }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 16px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
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
      {subtitle ? (
        <div
          style={{
            padding: "0 16px 8px",
            fontSize: 12,
            color: "#8E8E93",
            marginTop: -4,
          }}
        >
          {subtitle}
        </div>
      ) : null}
      {children}
    </div>
  );
}
