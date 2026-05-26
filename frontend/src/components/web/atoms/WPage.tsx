"use client";

import type { CSSProperties, ReactNode } from "react";
import { W_FONT_FAMILY, W_TOKENS } from "../tokens";
import { WThemeProvider } from "../WThemeProvider";
import { WTopNav } from "./WTopNav";

/**
 * 顶级 web 页面壳 — WThemeProvider + WTopNav + WGlowBackground + 内容容器.
 *
 * 任何 web 页面 (非 /m/*) 都用这个壳, 确保:
 * - CSS variables 在 head 里就位
 * - 顶 nav 一致
 * - 暗紫背景生效 (不被 globals.css 的 #0b0d12 覆盖)
 *
 * `fluid` 让内容占满宽度 (工作站用), 否则限制 maxWidth.
 */
export function WPage({
  children,
  maxWidth = 1280,
  fluid,
  innerStyle,
}: {
  children: ReactNode;
  maxWidth?: number;
  fluid?: boolean;
  innerStyle?: CSSProperties;
}) {
  return (
    <WThemeProvider>
      <div
        style={{
          minHeight: "100vh",
          background: W_TOKENS.bg,
          color: W_TOKENS.textPrimary,
          fontFamily: W_FONT_FAMILY,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <WGlowBackground />
        <WTopNav />
        <main
          style={{
            position: "relative",
            zIndex: 1,
            padding: fluid ? "0" : "0 28px 80px",
          }}
        >
          <div
            style={{
              maxWidth: fluid ? "none" : maxWidth,
              margin: "0 auto",
              ...innerStyle,
            }}
          >
            {children}
          </div>
        </main>
      </div>
    </WThemeProvider>
  );
}

/** 顶部紫色光晕 + 中心 radial halo. 固定定位, 不影响内容 */
function WGlowBackground() {
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 600,
          background: W_TOKENS.bgGlow,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 100,
          left: "50%",
          transform: "translateX(-50%)",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(124,92,250,0.18) 0%, rgba(0,0,0,0) 55%)",
          pointerEvents: "none",
          zIndex: 0,
          filter: "blur(20px)",
        }}
      />
    </>
  );
}

/**
 * 装饰用紫闪点 (Hero 区飘浮星点).
 * x 可以是数字 (px) 或字符串 (e.g. "48%").
 */
export function WSparkle({
  x,
  y,
  size = 10,
  opacity = 0.7,
  color = "#fff",
}: {
  x: number | string;
  y: number | string;
  size?: number;
  opacity?: number;
  color?: string;
}) {
  return (
    <svg
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        pointerEvents: "none",
      }}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
    >
      <path d="M12 0l2 9 9 3-9 3-2 9-2-9-9-3 9-3z" />
    </svg>
  );
}
