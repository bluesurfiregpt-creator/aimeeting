/**
 * Web 端 (桌面) design tokens — round-5 暗紫系统.
 *
 * 跟 Mobile MR_COLORS (浅 iOS 系统) **严格分离**:
 * - Mobile 浅 iOS (#F2F2F7 / #007AFF) — 见 frontend/src/components/mobile/meeting-room/styles.ts
 * - Web 暗紫 (#0a0a12 / #7C5CFA) — 本文件
 * - 会议室 Web 永远 light, **不**走 W_THEME (PM 在 chat 明确"会议室不需要暗色")
 *
 * 双 theme 通过 CSS variable + `:root[data-theme="light"]` 实现.
 * `WThemeProvider` 在客户端挂载时:
 *  1. 读 localStorage.w-theme (默认 dark)
 *  2. 给 <html> 加 data-theme attr
 *  3. inject <style> 定义 --w-* variables (这样 不污染 globals.css)
 *  4. inject zero-flash inline script (在 React mount 前 先 set data-theme)
 *
 * 业务代码用 W_TOKENS.bg 等 (literal: 'var(--w-bg)'), 渲染时浏览器自动按 data-theme 解析.
 */

// ────────────────── Theme-dependent token references (CSS variables) ──────────────────
// 业务代码使用这些 — 真实值由 W_THEME_CSS 在浏览器里按 data-theme 决定.
export const W_TOKENS = {
  // 背景层级
  bg: 'var(--w-bg)',
  bgGlow: 'var(--w-bgglow)',
  surface: 'var(--w-surface)',
  surfaceRaised: 'var(--w-surface-raised)',
  surfaceHover: 'var(--w-surface-hover)',

  // 边框
  border: 'var(--w-border)',
  borderHover: 'var(--w-border-hover)',
  borderActive: 'rgba(124,92,250,0.40)', // 主紫激活态, 双 theme 一致

  // 文字
  textPrimary: 'var(--w-text)',
  textSecondary: 'var(--w-text-2)',
  textMuted: 'var(--w-text-muted)',
  textFaint: 'var(--w-text-faint)',

  // 顶 nav 背景 (blur)
  navBg: 'var(--w-nav-bg)',

  // 滚动条
  scrollThumb: 'var(--w-scroll-thumb)',
  scrollThumbHover: 'var(--w-scroll-thumb-hover)',

  // ── Brand 色 (跨 theme 一致) ──
  accent: '#7C5CFA',
  accentSoft: 'rgba(124,92,250,0.16)',
  accentGrad: 'linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)',
  cyan: '#64D2FF',
  pink: '#FF6482',
  success: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
} as const;

// ────────────────── Typography ──────────────────
export const W_FONT_FAMILY =
  '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", Helvetica, "Segoe UI", system-ui, sans-serif';

export const W_FONT_SIZE = {
  xs: 11,
  sm: 12,
  base: 13.5,
  md: 14,
  lg: 15,
  xl: 17,
  '2xl': 22,
  '3xl': 26,
  '4xl': 30,
  hero: 56,
} as const;

// ────────────────── Spacing (8px scale) ──────────────────
export const W_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 14,
  lg: 18,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

// ────────────────── Radius ──────────────────
export const W_RADIUS = {
  sm: 6,
  md: 8,
  lg: 11,
  xl: 14,
  '2xl': 18,
  pill: 99,
} as const;

// ────────────────── Shadow ──────────────────
export const W_SHADOW = {
  hairline: (color: string = 'var(--w-border)') => `inset 0 0 0 0.5px ${color}`,
  card: '0 6px 22px rgba(0,0,0,0.25)',
  cardRaised: '0 16px 40px rgba(94,92,230,0.16)',
  accent: '0 4px 14px rgba(124,92,250,0.35)',
  modal: '0 24px 60px rgba(0,0,0,0.50)',
} as const;

// ────────────────── CSS variable bundle ──────────────────
// 这段 CSS 在 WThemeProvider 挂载时通过 <style> 注入到 <head>.
// 不写到 globals.css 是为了避免污染 Mobile (`/m/*`).
//
// dark 是 default, light 通过 `:root[data-theme="light"]` override.
//
// 注意: `body` 背景**没**强制 — globals.css 里 `body { background: #0b0d12 }` 仍然生效,
// 但 web 页面用 `WPage` 包裹时, WPage 自己拿 W_TOKENS.bg 设了 background,
// 所以视觉上是 web 暗紫 (而非 globals 的 #0b0d12).
//
// /m/* 不会挂载 WThemeProvider, 所以 不影响 mobile.
export const W_THEME_CSS = `
:root {
  --w-bg: #0a0a12;
  --w-bgglow: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(94,92,230,0.10) 0%, rgba(10,10,18,0) 60%);
  --w-surface: #13131c;
  --w-surface-raised: #1c1c27;
  --w-surface-hover: #22222e;
  --w-border: rgba(255,255,255,0.07);
  --w-border-hover: rgba(255,255,255,0.16);
  --w-text: #fafafc;
  --w-text-2: #a1a1aa;
  --w-text-muted: #71717a;
  --w-text-faint: #52525b;
  --w-nav-bg: rgba(10,10,18,0.78);
  --w-scroll-thumb: rgba(255,255,255,0.10);
  --w-scroll-thumb-hover: rgba(255,255,255,0.18);
}
:root[data-theme="light"] {
  --w-bg: #f4f4f8;
  --w-bgglow: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(94,92,230,0.06) 0%, rgba(244,244,248,0) 60%);
  --w-surface: #ffffff;
  --w-surface-raised: #fafafc;
  --w-surface-hover: #f0f0f5;
  /* round-6 加深 — PM 引语 "饱和度太低的色调只能用于小字和说明" */
  --w-border: rgba(0,0,0,0.10);
  --w-border-hover: rgba(0,0,0,0.18);
  --w-text: #0a0a0e;
  --w-text-2: #1f1f2b;
  --w-text-muted: #4b4b58;
  --w-text-faint: #8a8a98;
  --w-nav-bg: rgba(244,244,248,0.86);
  --w-scroll-thumb: rgba(0,0,0,0.18);
  --w-scroll-thumb-hover: rgba(0,0,0,0.28);
}
@keyframes wPulse {
  0%, 100% { opacity: 0.5; transform: scale(0.85); }
  50%      { opacity: 1; transform: scale(1.15); }
}
@keyframes wFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wModalIn {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wMoveRight {
  0%   { transform: translateX(0); opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateX(calc(100% - 0px)); opacity: 0; }
}
`;

// zero-flash inline script — 在 React hydrate 前 set data-theme.
// 在 page 的 <head> 里以 <script dangerouslySetInnerHTML> 注入.
export const W_THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('w-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// localStorage key 常量, 不要硬编码字符串
export const W_THEME_STORAGE_KEY = 'w-theme';
export type WTheme = 'dark' | 'light';
