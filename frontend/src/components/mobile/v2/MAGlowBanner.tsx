"use client";

/**
 * v1.4.0 · Saga M1 · 紫渐变 hero banner (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:559-686
 * (MAGlowBanner + Sparkle).
 *
 * 与 v1 (shared/MAGlowBanner.tsx) 区别:
 *   - tone 改名: ai → mira (单设计稿名词) · warn → priority · brief → subtle
 *   - sparkle 渲染优化: 默认 3 层 (top:10/right:50, top:38/right:24, top:64/right:66)
 *     可关闭 (sparkle: false)
 *   - 给 Saga M3 meetings page 用的 56px 大 CTA 风格也由这个组件衍生 (传 children
 *     可自定义 body)
 *
 * tone 映射:
 *   - mira    (设计稿默认 AI 主色): #5E5CE6 → #7A5AF0 → #AF52DE
 *   - priority (紧急/今日优先级):    #6D49E0 → #B340D6 → #FF6482
 *   - subtle   (简报/脉络):          #0A84FF → #5E5CE6 → #7A5AF0
 *
 * v1.4.0 · Saga R (Phase 1 P1 atom 共性) · 新增 3 个 optional prop (向后兼容):
 *   - titleSize: 默认 14, me 页传 17 (A-01)
 *   - customIcon: 覆盖默认 sparkle icon, 让 me 页传 <MAIBadge id="ARIA" /> (A-06)
 *   - indicator: 紫渐变 pulse dot + "Mira 已起草 · 可继续编辑" 灰字 (M7 preview view 用)
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";

import MAIcon, { type V2IconName } from "./MAIcon";

export type V2GlowTone = "mira" | "priority" | "subtle";

export type V2GlowChip = {
  icon?: V2IconName;
  label: string;
  fg?: string;
};

export type V2GlowIndicator = {
  /** 文案 (e.g. "Mira 已起草 · 可继续编辑") */
  label: string;
  /** pulse dot 渐变色 (e.g. "linear-gradient(135deg, #5E5CE6, #AF52DE)") */
  pulseColor: string;
};

type Props = {
  tone?: V2GlowTone;
  icon?: V2IconName;
  eyebrow?: string;
  title?: string;
  body?: string;
  chips?: V2GlowChip[];
  cta?: string;
  onCta?: () => void;
  /** 显示 3 层 sparkle 星光. 默认 true. */
  sparkle?: boolean;
  /** 内部自定义 children (右上角图标 + 标题之外的扩展) */
  children?: ReactNode;
  compact?: boolean;
  style?: CSSProperties;
  /**
   * v1.4.0 Saga R · title 字号 (默认 14, me 页传 17).
   * 设计稿 mobile-screens.jsx:848 大字号 hero (A-01).
   */
  titleSize?: number;
  /**
   * v1.4.0 Saga R · 自定义 icon slot — 覆盖默认 MAIcon (A-06).
   * 传时 不渲染默认 28x28 白半透方框, 直接渲染 customIcon (caller 自定义尺寸).
   */
  customIcon?: ReactNode;
  /**
   * v1.4.0 Saga R · 顶部 inline 指示器 — 紫渐变 pulse dot + 灰字.
   * 用于 M7 preview view "Mira 已起草 · 可继续编辑".
   * 渲染在 eyebrow / title 之上.
   */
  indicator?: V2GlowIndicator;
};

const TONES: Record<
  V2GlowTone,
  { bg: string; glowA: string; glowB: string; shadow: string }
> = {
  mira: {
    bg: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",
    glowA: "rgba(100,210,255,0.34)",
    glowB: "rgba(255,100,130,0.26)",
    shadow: "0 8px 28px rgba(94,92,230,0.32)",
  },
  priority: {
    bg: "linear-gradient(135deg, #6D49E0 0%, #B340D6 50%, #FF6482 110%)",
    glowA: "rgba(255,230,120,0.30)",
    glowB: "rgba(255,80,120,0.34)",
    shadow: "0 8px 28px rgba(160,70,200,0.32)",
  },
  subtle: {
    bg: "linear-gradient(135deg, #0A84FF 0%, #5E5CE6 60%, #7A5AF0 100%)",
    glowA: "rgba(100,210,255,0.42)",
    glowB: "rgba(94,92,230,0.30)",
    shadow: "0 8px 28px rgba(10,132,255,0.32)",
  },
};

function Sparkle({
  top,
  right,
  left,
  size,
  opacity,
}: {
  top?: number;
  right?: number;
  left?: number;
  size: number;
  opacity: number;
}): ReactElement {
  const s: CSSProperties = { position: "absolute", opacity, pointerEvents: "none" };
  if (top !== undefined) s.top = top;
  if (right !== undefined) s.right = right;
  if (left !== undefined) s.left = left;
  return (
    <svg style={s} width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <path d="M12 0l2 9 9 3-9 3-2 9-2-9-9-3 9-3z" />
    </svg>
  );
}

export default function MAGlowBanner({
  tone = "mira",
  icon = "sparkle",
  eyebrow,
  title,
  body,
  chips,
  cta,
  onCta,
  sparkle = true,
  children,
  compact = false,
  style,
  titleSize = 14,
  customIcon,
  indicator,
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
        ...style,
      }}
    >
      {/* glow A — 右上 */}
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
      {/* glow B — 左下 */}
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
      {sparkle ? (
        <>
          <Sparkle top={10} right={50} size={12} opacity={0.85} />
          <Sparkle top={38} right={24} size={7} opacity={0.55} />
          <Sparkle top={64} right={66} size={5} opacity={0.4} />
        </>
      ) : null}

      {/* v1.4.0 Saga R · indicator — 紫渐变 pulse dot + 灰字 (A-06) */}
      {indicator ? (
        <div
          style={{
            position: "relative",
            marginBottom: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13.5,
            color: "rgba(255,255,255,0.92)",
            fontWeight: 600,
          }}
          data-testid="ma-glow-indicator"
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: indicator.pulseColor,
              boxShadow: "0 0 7px rgba(94,92,230,0.55)",
              flexShrink: 0,
            }}
          />
          {indicator.label}
        </div>
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        {customIcon ? (
          <div style={{ flexShrink: 0, display: "inline-flex" }}>
            {customIcon}
          </div>
        ) : icon ? (
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
            <MAIcon name={icon} size={15} color="#fff" strokeWidth={2} />
          </div>
        ) : null}
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
                fontSize: titleSize,
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
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px 4px 7px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.18)",
                color: ch.fg ?? "#fff",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.22)",
              }}
            >
              {ch.icon ? (
                <MAIcon
                  name={ch.icon}
                  size={11}
                  color={ch.fg ?? "#fff"}
                  strokeWidth={2.2}
                />
              ) : null}
              {ch.label}
            </div>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}

/** 单独 export Sparkle 给 MeetingFullCard 等其他卡片可复用. */
export { Sparkle };
