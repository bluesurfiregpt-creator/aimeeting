"use client";

/**
 * v1.4.0 · Saga M1 · AI 专家 头像 atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:275-290 (MAIBadge).
 *
 * 圆角方形 (size * 0.28) + 双色渐变背景 + glyph 居中.
 * 跟 真人 MAvatar (纯圆) 强视觉区分.
 *
 * 与 v1 (shared/avatars.tsx::MRAIAvatar) 区别:
 *   - v2 用 glyph 字符 (◎/⌬/◆/§) 替代固定 sparkle svg
 *   - 完全从 props 渲染 (走 V2AIBadge schema 喂入 glyph + 双色)
 *   - 单独 file (跟 MAvatar 对称)
 */

import type { CSSProperties, ReactElement } from "react";

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

export default function MAIBadge({
  name,
  glyph,
  gradient_from,
  gradient_to,
  size = 36,
  ring = "#FFFFFF",
  style,
}: Props): ReactElement {
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
      {glyph}
    </div>
  );
}
