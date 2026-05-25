"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · 紫色 glow banner — 跨页 "灵光一现" 品牌组件.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:559-686
 * (MAGlowBanner + Sparkle)
 *
 * Saga A 只在 today 页用 (MiraDailyBrief 是 custom 但同语言).
 * Saga B 会在 /m/meetings (brief tone) / /m/tasks (warn) / /m/me (ai) 都注入.
 * Saga B 之后 NotificationsSheet compact 模式也用.
 *
 * 3 个 tone:
 *   - ai    (默认): 蓝 #5E5CE6 → 紫 #AF52DE — 通用 AI 智囊
 *   - warn       : 紫 #6D49E0 → 粉 #FF6482 — 紧急/今日优先级
 *   - brief      : 蓝 #0A84FF → 紫 #5E5CE6 — 简报/脉络
 */

import type { CSSProperties, ReactElement } from "react";

import Icon, { type MRIconName } from "./Icon";

export type GlowTone = "ai" | "warn" | "brief";

export type GlowBannerChip = {
  icon?: MRIconName;
  label: string;
  fg?: string;
};

type Props = {
  tone?: GlowTone;
  icon?: MRIconName;
  eyebrow?: string;
  title?: string;
  body?: string;
  chips?: GlowBannerChip[];
  cta?: string;
  onCta?: () => void;
  compact?: boolean;
};

const TONES: Record<
  GlowTone,
  { bg: string; glowA: string; glowB: string; shadow: string }
> = {
  ai: {
    bg: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",
    glowA: "rgba(100,210,255,0.34)",
    glowB: "rgba(255,100,130,0.26)",
    shadow: "0 6px 22px rgba(94,92,230,0.30)",
  },
  warn: {
    bg: "linear-gradient(135deg, #6D49E0 0%, #B340D6 50%, #FF6482 110%)",
    glowA: "rgba(255,230,120,0.30)",
    glowB: "rgba(255,80,120,0.34)",
    shadow: "0 6px 22px rgba(160,70,200,0.30)",
  },
  brief: {
    bg: "linear-gradient(135deg, #0A84FF 0%, #5E5CE6 60%, #7A5AF0 100%)",
    glowA: "rgba(100,210,255,0.42)",
    glowB: "rgba(94,92,230,0.30)",
    shadow: "0 6px 22px rgba(10,132,255,0.28)",
  },
};

export default function MAGlowBanner({
  tone = "ai",
  icon = "sparkle",
  eyebrow,
  title,
  body,
  chips,
  cta,
  onCta,
  compact = false,
}: Props): ReactElement {
  const c = TONES[tone];
  const pad = compact ? "11px 12px" : "14px 14px 14px";

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        background: c.bg,
        padding: pad,
        boxShadow: `${c.shadow}, 0 0 0 0.5px rgba(255,255,255,0.10)`,
      }}
    >
      {/* glows */}
      <div
        style={{
          position: "absolute",
          top: -50,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${c.glowA} 0%, rgba(0,0,0,0) 65%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -40,
          width: 160,
          height: 160,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${c.glowB} 0%, rgba(0,0,0,0) 70%)`,
          pointerEvents: "none",
        }}
      />
      {/* sparkles */}
      <Sparkle top={10} right={50} size={12} opacity={0.85} />
      <Sparkle top={38} right={24} size={7} opacity={0.55} />
      <Sparkle top={64} right={66} size={5} opacity={0.4} />

      {/* header row */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "rgba(255,255,255,0.18)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
          }}
        >
          <Icon name={icon} size={15} color="#fff" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "rgba(255,255,255,0.75)",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          {title ? (
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                marginTop: eyebrow ? 1 : 0,
                lineHeight: 1.35,
                letterSpacing: 0.1,
              }}
            >
              {title}
            </div>
          ) : null}
        </div>
        {cta ? (
          <button
            type="button"
            onClick={onCta}
            style={{
              background: "rgba(255,255,255,0.18)",
              border: "none",
              borderRadius: 8,
              padding: "5px 10px",
              color: "#fff",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
            }}
          >
            {cta}
          </button>
        ) : null}
      </div>

      {body ? (
        <div
          style={{
            position: "relative",
            marginTop: 10,
            fontSize: 13,
            color: "rgba(255,255,255,0.92)",
            lineHeight: 1.55,
          }}
        >
          {body}
        </div>
      ) : null}

      {chips && chips.length > 0 ? (
        <div
          style={{
            position: "relative",
            marginTop: 10,
            display: "flex",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          {chips.map((ch, i) => (
            <div
              key={`${ch.label}-${i}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px 4px 7px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.18)",
                color: ch.fg || "#fff",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.22)",
              }}
            >
              {ch.icon ? (
                <Icon
                  name={ch.icon}
                  size={11}
                  color={ch.fg || "#fff"}
                  strokeWidth={2.2}
                />
              ) : null}
              {ch.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 5-pointed sparkle star, absolutely positioned. */
export function Sparkle({
  top,
  right,
  left,
  bottom,
  size,
  opacity,
}: {
  top?: number;
  right?: number;
  left?: number;
  bottom?: number;
  size: number;
  opacity: number;
}): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    opacity,
    pointerEvents: "none",
  };
  if (top !== undefined) style.top = top;
  if (right !== undefined) style.right = right;
  if (left !== undefined) style.left = left;
  if (bottom !== undefined) style.bottom = bottom;
  return (
    <svg
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#fff"
    >
      <path d="M12 0l2 9 9 3-9 3-2 9-2-9-9-3 9-3z" />
    </svg>
  );
}
