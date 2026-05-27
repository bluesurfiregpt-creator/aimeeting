"use client";

/**
 * v1.4.0 · Saga M1 · AI 专家 头像 atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:275-290 (MAIBadge).
 *
 * 圆角方形 (size * 0.28) + 双色渐变背景 + glyph 居中.
 * 跟 真人 MAvatar (纯圆) 强视觉区分.
 *
 * v1.4.0 · Saga Q (Phase 1 P0 修复) · glyph SVG 化:
 *   - 不再依赖系统字体渲染 Unicode glyph (◎/⌬/§/◐ 在移动 Safari 字体回退会变形)
 *   - 改 inline SVG path, 跟 mobile-shared.jsx:24-34 一一对应
 *   - 10 个设计稿固定 AI (MIRA/ARIA/STRATOS/SAGE/LEX/SCOUT/FALAO/SHU/ZHAOJIE/TALLY)
 *   - 用 glyph 字符 作 key 自动 dispatch (一份代码 跟 backend snake_case 解耦)
 *   - 兜底: 不在 map 里时 fallback 到 Unicode (向前兼容)
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";

type Props = {
  /** AI 名称 (用于 a11y, 不显示) */
  name: string;
  /** 单字符 icon: ◎ / ⌬ / ◆ / § / ✦ ... */
  glyph: string;
  /** 渐变起始色 */
  gradient_from: string;
  /** 渐变结束色 */
  gradient_to: string;
  size?: number;
  ring?: string;
  style?: CSSProperties;
};

/**
 * 10 个设计稿 AI glyph 对应的 inline SVG path.
 *
 * 设计源: mobile-shared.jsx:24-34 — 用 Unicode 字符的标准形状直接画路径.
 * viewBox 统一 0 0 24 24, stroke 用 currentColor (=#fff), 自动跟渐变背景对比.
 */
const GLYPH_SVG: Record<string, ReactNode> = {
  // Mira ◎ — 双圆 (外圈 stroke + 实心内圆)
  "◎": (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </>
  ),
  // Aria ⌬ — 苯环 (六边形 + 内部三横)
  "⌬": (
    <>
      <path
        d="M12 3 L20.5 7.5 L20.5 16.5 L12 21 L3.5 16.5 L3.5 7.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 9.5 L17 9.5 M7 14.5 L17 14.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  // Stratos ◆ — 实心菱形
  "◆": (
    <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="currentColor" />
  ),
  // Sage ✦ — 4-point sparkle
  "✦": (
    <path
      d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z"
      fill="currentColor"
    />
  ),
  // Lex § — section sign (S 形, 简化双弧)
  "§": (
    <path
      d="M16 6.5 C16 4.8 14.4 3.5 12 3.5 C9.6 3.5 8 4.8 8 6.5 C8 8 9 8.8 11 9.5 L13 10.3 C15 11 16 11.8 16 13.5 C16 15.5 14.4 17 12 17 C9.6 17 8 15.5 8 13.5 M12 17 L12 20.5 M12 6.5 L12 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Scout ◈ — 双菱形 (外菱 + 内菱)
  "◈": (
    <>
      <path
        d="M12 3 L21 12 L12 21 L3 12 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 8 L16 12 L12 16 L8 12 Z" fill="currentColor" />
    </>
  ),
  // Falao ⚖ — 天平 (顶杆 + 中柱 + 两侧托盘)
  "⚖": (
    <>
      {/* 顶部横梁 */}
      <path d="M4 7 L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* 中柱 */}
      <path d="M12 3 L12 21 M8 21 L16 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* 左盘 */}
      <path d="M3 7 L1.5 12 L4.5 12 Z" fill="currentColor" />
      {/* 右盘 */}
      <path d="M21 7 L19.5 12 L22.5 12 Z" fill="currentColor" />
    </>
  ),
  // Shu ∑ — 希腊 sigma (求和)
  "∑": (
    <path
      d="M18 4 L6 4 L13 12 L6 20 L18 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Zhaojie ♥ — 心形
  "♥": (
    <path
      d="M12 21 C12 21 3.5 14.5 3.5 8.5 C3.5 6 5.5 4 8 4 C9.8 4 11.4 5 12 6.5 C12.6 5 14.2 4 16 4 C18.5 4 20.5 6 20.5 8.5 C20.5 14.5 12 21 12 21 Z"
      fill="currentColor"
    />
  ),
  // Tally ¥ — 人民币符号
  "¥": (
    <>
      <path
        d="M6 4 L12 12 L18 4 M6 11 L18 11 M6 15 L18 15 M12 12 L12 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
};

export default function MAIBadge({
  name,
  glyph,
  gradient_from,
  gradient_to,
  size = 36,
  ring = "#FFFFFF",
  style,
}: Props): ReactElement {
  const svg = GLYPH_SVG[glyph];
  // SVG 内 stroke / fill 用 currentColor → div color="#fff" 自动继承
  // size scale: badge 36 → svg 24×24 (viewBox 自适应)
  const svgSize = Math.round(size * 0.62);

  return (
    <div
      role="img"
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(135deg, ${gradient_from} 0%, ${gradient_to} 100%)`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.46,
        fontWeight: 700,
        flexShrink: 0,
        boxShadow:
          ring && ring !== "transparent" ? `0 0 0 1.5px ${ring}` : "none",
        letterSpacing: 0.1,
        ...style,
      }}
    >
      {svg ? (
        <svg
          width={svgSize}
          height={svgSize}
          viewBox="0 0 24 24"
          style={{ display: "block" }}
        >
          {svg}
        </svg>
      ) : (
        // fallback — Unicode (向前兼容, 防止后端引入新 glyph 时显空)
        glyph
      )}
    </div>
  );
}
