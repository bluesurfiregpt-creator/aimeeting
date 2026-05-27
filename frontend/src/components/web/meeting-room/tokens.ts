/**
 * Web 会议室 (in-meeting) — 双 theme (浅色 default + 深色 opt-in).
 *
 * **v1.4.0 升级 (NORTH_STAR § 7.1.1, PM 2026-05-28 拍板 override § 7.1)**:
 *  - 浅色 (default) 跟 round-3 落地的 iOS 风一致
 *  - 深色 (opt-in) 走设计稿 `Meeting Room (Web).html` 深邃星空 + 紫色 aurora
 *  - 用户 通过 顶 nav `ThemeToggle` 切换, localStorage 持久化 (跟 workstation W_THEME 同源)
 *  - default 仍浅色, 保 § 7.1 主精神
 *
 * **结构**:
 *  - 受 theme 影响 的 token (bg / fg / divider / shadow) → CSS var (`var(--mr-*)`)
 *    具体 light / dark 值 在 `MR_THEME_CSS` 注入到 :root + :root[data-theme="dark"]
 *  - 跨 theme 一致 的 token (iOS 系统色 / 品牌渐变) → 仍 literal hex
 *
 * **跟 `frontend/src/components/web/tokens.ts` (W_TOKENS) 关系**:
 *  - W_TOKENS 是 workstation / home 用的, 暗紫双 theme
 *  - MR_TOKENS 是 会议室专用, 浅色 default + 深色 opt-in (走 同一个 data-theme attr)
 *  - 两套 token 引用 同一个 `data-theme` (workstation 切 dark 时, 会议室也跟着)
 *
 * **跟 Mobile MR_COLORS 概念呼应, 但不复用** — Mobile 永远浅色单 theme.
 *
 * 设计源 (浅色): `/tmp/claude-design-round6-web/aimeeting/project/meeting-room-web.jsx`
 * 设计源 (深色): `https://api.anthropic.com/v1/design/h/S3TK_UXeBzGF0V_jQr4hLg`
 */

// ────────────────── Colors (跨 theme) ──────────────────
// 受 theme 影响 的 token 用 CSS var, 跨 theme 一致 的 token 用 literal.
export const MR_TOKENS = {
  // 背景 (theme-aware, 见 MR_THEME_CSS)
  bgCanvas: "var(--mr-bg-canvas)", // 主体, transcript 区
  bgSurface: "var(--mr-bg-surface)",
  bgRaised: "var(--mr-bg-raised)", // sidebar 区 / 一些卡内
  bgSubtle: "var(--mr-bg-subtle)", // 数据块 inset
  bgChip: "var(--mr-bg-chip)", // chip / pill / inputbar inset
  bgHoverChip: "var(--mr-bg-hover-chip)",

  // 文字 (theme-aware)
  fgPrimary: "var(--mr-fg-primary)",
  fgSecondary: "var(--mr-fg-secondary)",
  fgTertiary: "var(--mr-fg-tertiary)",
  fgQuaternary: "var(--mr-fg-quaternary)",

  // 描边 (theme-aware)
  divider: "var(--mr-divider)",
  dividerStrong: "var(--mr-divider-strong)",
  borderHair: "var(--mr-border-hair)",
  borderHair2: "var(--mr-border-hair2)",
  borderHair2Strong: "var(--mr-border-hair2-strong)",

  // 系统色
  iosBlue: "#007AFF",
  iosGreen: "#34C759",
  iosRed: "#FF3B30",
  iosRedAlt: "#FF453A",
  iosOrange: "#FF9F0A",
  iosAmber: "#FFB340",
  iosDarkAmber: "#B8860B",
  iosAmberText: "#8B6914",
  iosPurple: "#5E5CE6",
  iosViolet: "#AF52DE",
  iosPink: "#FF6482",
  iosTeal: "#30B0C7",
  iosCyan: "#64D2FF",
  iosGray4: "#E5E5EA",

  // 渐变
  miraGrad: "linear-gradient(135deg, #FFB340, #FF9F0A)",
  miraGradBgSoft: "linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.09))",
  miraGradBg: "linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.13))",
  miraGradBorder: "0.5px solid rgba(255,159,10,0.30)",
  aimeetingLogoGrad: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",

  // 数据块 / 状态色软背景
  greenSoft: "rgba(52,199,89,0.12)",
  redSoft: "rgba(255,59,48,0.10)",
  orangeSoft: "rgba(255,159,10,0.12)",
  purpleSoft: "rgba(94,92,230,0.10)",
  blueSoft: "rgba(0,122,255,0.06)",
  blueBorder: "0.5px solid rgba(0,122,255,0.20)",

  // shadow (theme-aware — 深色 时 紫色 glow)
  shadowSubtle: "var(--mr-shadow-subtle)",
  shadowCard: "var(--mr-shadow-card)",
  shadowModal: "var(--mr-shadow-modal)",
  shadowMenu: "var(--mr-shadow-menu)",
  shadowFab: "var(--mr-shadow-fab)",

  // ── 深色专属 (light theme 时 fallback 到 nothing / 兼容) ──
  // 中心 stage 渐变 (light = 纯白, dark = 深邃星空)
  bgStage: "var(--mr-bg-stage)",
  // top bar bg 渐变
  bgTopBar: "var(--mr-bg-topbar)",
  // accent glow border (top bar / panel 紫边)
  accentGlowBorder: "var(--mr-accent-glow-border)",
  // 议程 playhead leading edge (dark 时 紫亮 #B9A0FF, light 时 蓝 #007AFF)
  accentPlayhead: "var(--mr-accent-playhead)",
} as const;

// ────────────────── Theme CSS (注入到 head, 跟 W_THEME 同源) ──────────────────
// :root 是 light default (跟 R5.D round-3 浅色完全一致, 0 视觉回归)
// :root[data-theme="dark"] 是 PM 设计稿 S3TK 深色 (深邃星空 + 紫 aurora)
export const MR_THEME_CSS = `
:root {
  /* light (default) — round-3 R5.D iOS 浅色 */
  --mr-bg-canvas: #ffffff;
  --mr-bg-surface: #ffffff;
  --mr-bg-raised: #FAFAFA;
  --mr-bg-subtle: #F7F7F9;
  --mr-bg-chip: #F2F2F7;
  --mr-bg-hover-chip: #E8E8ED;
  --mr-fg-primary: #1C1C1E;
  --mr-fg-secondary: #3C3C43;
  --mr-fg-tertiary: #8E8E93;
  --mr-fg-quaternary: #C7C7CC;
  --mr-divider: rgba(60,60,67,0.10);
  --mr-divider-strong: rgba(60,60,67,0.14);
  --mr-border-hair: 0.5px solid #E5E5EA;
  --mr-border-hair2: 0.5px solid rgba(60,60,67,0.10);
  --mr-border-hair2-strong: 0.5px solid rgba(60,60,67,0.14);
  --mr-shadow-subtle: 0 1px 2px rgba(0,0,0,0.03);
  --mr-shadow-card: 0 2px 8px rgba(0,0,0,0.04);
  --mr-shadow-modal: 0 24px 60px rgba(0,0,0,0.30);
  --mr-shadow-menu: 0 8px 28px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12);
  --mr-shadow-fab: 0 4px 14px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(60,60,67,0.12);
  /* 深色专属 token 在 light 时 fallback */
  --mr-bg-stage: #ffffff;
  --mr-bg-topbar: #ffffff;
  --mr-accent-glow-border: rgba(60,60,67,0.10);
  --mr-accent-playhead: #007AFF;
}
:root[data-theme="dark"] {
  /* dark — PM 设计稿 S3TK 深邃星空 + 紫 aurora */
  --mr-bg-canvas: #05071A;
  --mr-bg-surface: #0A0E22;
  --mr-bg-raised: #060818;
  --mr-bg-subtle: #0B0F26;
  --mr-bg-chip: rgba(124,92,250,0.10);
  --mr-bg-hover-chip: rgba(124,92,250,0.18);
  --mr-fg-primary: #F5F5F7;
  --mr-fg-secondary: #9090A0;
  --mr-fg-tertiary: #5A5A6B;
  --mr-fg-quaternary: #3A3A4B;
  --mr-divider: rgba(255,255,255,0.06);
  --mr-divider-strong: rgba(255,255,255,0.10);
  --mr-border-hair: 0.5px solid rgba(124,92,250,0.18);
  --mr-border-hair2: 0.5px solid rgba(255,255,255,0.06);
  --mr-border-hair2-strong: 0.5px solid rgba(255,255,255,0.10);
  --mr-shadow-subtle: 0 1px 2px rgba(0,0,0,0.30);
  --mr-shadow-card: 0 2px 8px rgba(0,0,0,0.30), 0 0 0 0.5px rgba(124,92,250,0.10);
  --mr-shadow-modal: 0 24px 60px rgba(0,0,0,0.60), 0 0 0 0.5px rgba(124,92,250,0.18);
  --mr-shadow-menu: 0 8px 28px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(124,92,250,0.18);
  --mr-shadow-fab: 0 4px 14px rgba(94,92,230,0.40), 0 0 0 0.5px rgba(124,92,250,0.30);
  /* dark 专属 */
  --mr-bg-stage: linear-gradient(180deg, #060818 0%, #0A0E22 50%, #060818 100%);
  --mr-bg-topbar: linear-gradient(180deg, #0B0F26 0%, #080B1F 100%);
  --mr-accent-glow-border: rgba(124,92,250,0.18);
  --mr-accent-playhead: #B9A0FF;
}
`;

// ────────────────── Font ──────────────────
export const MR_FONT_FAMILY =
  '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", Helvetica, "Segoe UI", system-ui, sans-serif';

// ────────────────── Layout ──────────────────
export const MR_LAYOUT = {
  leftPanelWidth: 280,
  rightPanelWidth: 340,
  topBarHeight: 48,
  bottomBarHeight: 72,
  expertDockHeight: 68,
  agendaTimelineHeight: 60,
  gutter: 28, // transcript 区横向 padding
  maxBubbleWidth: 720,
} as const;

// ────────────────── CSS keyframes (注入到 head) ──────────────────
export const MR_ANIMATIONS_CSS = `
@keyframes mrFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes mrWfBar {
  0%   { transform: scaleY(0.3); }
  100% { transform: scaleY(1); }
}
@keyframes mrDotBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-3px); opacity: 1; }
}
@keyframes mrLivePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.15); }
}
@keyframes mrUrgentPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.20); }
  50%      { box-shadow: 0 0 0 4px rgba(255,59,48,0.10); }
}
@keyframes mrSpeakingPulse {
  0%, 100% { box-shadow: 0 0 0 2px #34C759, 0 0 0 4px rgba(52,199,89,0.30); }
  50%      { box-shadow: 0 0 0 2px #34C759, 0 0 0 8px rgba(52,199,89,0); }
}
@keyframes mrPopIn {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
`;

// ────────────────── iOS 风 scrollbar (page-scoped, .mr-scroll) ──────────────────
// 浅色 iOS 系统风 — 6px 细条 / 透明 track / 半透明灰 thumb / hover 加深.
// 仅作用于 R5.D 会议室加了 `className="mr-scroll"` 的元素, 不污染 globals.css.
// 取色 对应 MR_TOKENS.divider / dividerStrong (rgba(60,60,67,0.10/0.14)) 的更浓变体.
export const MR_SCROLLBAR_CSS = `
.mr-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.mr-scroll::-webkit-scrollbar-track { background: transparent; }
.mr-scroll::-webkit-scrollbar-thumb {
  background: rgba(60,60,67,0.30);
  border-radius: 3px;
}
.mr-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(60,60,67,0.50);
}
.mr-scroll::-webkit-scrollbar-corner { background: transparent; }
.mr-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(60,60,67,0.30) transparent;
}
`;

// ────────────────── Theme bootstrap (zero-flash) ──────────────────
/**
 * 会议室专用 bootstrap — hydrate 前 set data-theme.
 *
 * **跟 W_THEME_BOOTSTRAP 区别**: 会议室 default 浅色 (符合 NORTH_STAR § 7.1.1
 * 例外 第 2 条 "default 仍浅色"). Workstation 走 W_THEME_BOOTSTRAP, 默认 dark.
 *
 * 用法: `/meeting/[id]/live/layout.tsx` 顶部 `<Script beforeInteractive>` 注入.
 *
 * **共享 storage key** (`w-theme`) — 用户 在 会议室 切 dark, 出 会议室 进
 * workstation 也是 dark. 符合 § 7.1.1 第 1 条 (复用 W_THEME 机制).
 */
export const MR_THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('w-theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
