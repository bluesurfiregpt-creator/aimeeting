"use client";

import { W_AGENTS } from "../data/agents";

/**
 * AI 渐变方形头像 + glyph.
 * 跟 mobile MR_COLORS 不挂钩 — 这是 web 专用 brand 视觉.
 */
export function WAIBadge({
  id,
  size = 40,
  radius,
}: {
  id: string;
  size?: number;
  radius?: number;
}) {
  const a = W_AGENTS.find((x) => x.id === id);
  if (!a) return null;
  const r = radius !== undefined ? radius : Math.round(size * 0.28);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(135deg, ${a.grad[0]} 0%, ${a.grad[1]} 100%)`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.46,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: 0.1,
        boxShadow: `0 4px 14px ${a.grad[1]}30, 0 0 0 0.5px rgba(255,255,255,0.10)`,
      }}
    >
      {a.glyph}
    </div>
  );
}
