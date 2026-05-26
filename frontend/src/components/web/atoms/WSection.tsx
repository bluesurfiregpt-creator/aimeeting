"use client";

import type { ReactNode } from "react";
import { W_TOKENS } from "../tokens";
import { WButton } from "./WButton";

/**
 * Section header. title + optional count + sub + extra controls + action arrow.
 */
export function WSection({
  title,
  sub,
  count,
  countUnit = "位",
  action,
  onAction,
  children,
  extra,
}: {
  title: string;
  sub?: string;
  count?: number;
  countUnit?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section style={{ marginTop: 48 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: W_TOKENS.textPrimary,
                letterSpacing: -0.5,
              }}
            >
              {title}
            </h2>
            {count !== undefined && (
              <span
                style={{
                  fontSize: 14,
                  color: W_TOKENS.textMuted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count} {countUnit}
              </span>
            )}
          </div>
          {sub && (
            <div style={{ marginTop: 4, fontSize: 13.5, color: W_TOKENS.textMuted }}>{sub}</div>
          )}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {extra}
          {action && (
            <WButton variant="ghost" size="sm" onClick={onAction} iconRight="arr-r">
              {action}
            </WButton>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
