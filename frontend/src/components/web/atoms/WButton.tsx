"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { W_TOKENS } from "../tokens";
import { WIcon, type WIconName } from "./WIcon";

/**
 * Web button — 4 variants × 3 sizes.
 *
 * primary  — 紫渐变 (主 CTA)
 * secondary — 提升 surface
 * ghost    — 透明 + 1px outline
 * danger   — 红
 */
export type WButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type WButtonSize = "sm" | "md" | "lg";

export function WButton({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  onClick,
  full,
  disabled,
  style: extra,
  type = "button",
}: {
  children: ReactNode;
  variant?: WButtonVariant;
  size?: WButtonSize;
  icon?: WIconName;
  iconRight?: WIconName;
  onClick?: () => void;
  full?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  type?: "button" | "submit" | "reset";
}) {
  const [hovered, setHovered] = useState(false);
  const h = size === "sm" ? 32 : size === "lg" ? 44 : 36;
  const fs = size === "sm" ? 13 : size === "lg" ? 15 : 14;
  const pad = size === "sm" ? "0 12px" : size === "lg" ? "0 18px" : "0 14px";

  const variants: Record<WButtonVariant, CSSProperties> = {
    primary: {
      background: W_TOKENS.accentGrad,
      color: "#fff",
      boxShadow: "0 4px 14px rgba(124,92,250,0.35), 0 0 0 0.5px rgba(255,255,255,0.10)",
    },
    secondary: {
      background: W_TOKENS.surfaceRaised,
      color: W_TOKENS.textPrimary,
      boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}`,
    },
    ghost: {
      background: "transparent",
      color: W_TOKENS.textSecondary,
      boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
    },
    danger: {
      background: "rgba(239,68,68,0.10)",
      color: "#FCA5A5",
      boxShadow: "inset 0 0 0 0.5px rgba(239,68,68,0.30)",
    },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: h,
        padding: pad,
        borderRadius: 9,
        border: "none",
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: 0.1,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: full ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: full ? "100%" : "auto",
        filter: hovered && !disabled ? "brightness(1.10)" : "brightness(1)",
        transition: "filter 120ms ease, transform 120ms ease",
        ...variants[variant],
        ...extra,
      }}
    >
      {icon && <WIcon name={icon} size={fs + 1} stroke={2} />}
      {children}
      {iconRight && <WIcon name={iconRight} size={fs + 1} stroke={2} />}
    </button>
  );
}
