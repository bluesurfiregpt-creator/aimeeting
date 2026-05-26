"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { W_TOKENS } from "../tokens";

/**
 * 基础 surface 卡片. hover 时 boxShadow 加亮 + 微上浮.
 */
export function WCard({
  children,
  hover,
  padding = 20,
  onClick,
  style: extra,
}: {
  children: ReactNode;
  hover?: boolean;
  padding?: number;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const usingHover = !!hover;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: W_TOKENS.surface,
        borderRadius: 14,
        boxShadow: `inset 0 0 0 0.5px ${
          hovered && usingHover ? W_TOKENS.borderHover : W_TOKENS.border
        }`,
        padding,
        transition: "box-shadow 200ms ease, transform 200ms ease",
        cursor: onClick ? "pointer" : "default",
        transform: hovered && usingHover ? "translateY(-2px)" : "none",
        ...extra,
      }}
    >
      {children}
    </div>
  );
}
