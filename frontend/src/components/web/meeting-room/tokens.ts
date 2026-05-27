/**
 * Web 会议室 (in-meeting) iOS 浅色 token — R5.D.
 *
 * **跟 `frontend/src/components/web/tokens.ts` 严格分离**:
 *  - Web 主体 (首页 / workstation) — `W_TOKENS` 暗紫双 theme
 *  - Web 会议室 (本文件) — **iOS 浅色单 theme**, PM 拍板 "会议室永远浅色 iOS 风"
 *    (见 docs/design/system/DESIGN_SYSTEM.md § 0.3.1)
 *
 * **不导出 ThemeProvider** — 会议室不挂 W_THEME, 不切 data-theme.
 * 走 `next/script` 直接 mount iOS light style.
 *
 * **跟 Mobile MR_COLORS 概念呼应, 但不复用** — Mobile 浅色用于手机端密度,
 * Web 会议室用于桌面 1440 + 三栏布局, 字号 / spacing / shadow 都不同.
 *
 * 设计源: `/tmp/claude-design-round6-web/aimeeting/project/meeting-room-web.jsx`
 */

// ────────────────── Colors (iOS 浅色) ──────────────────
export const MR_TOKENS = {
  // 背景
  bgCanvas: "#fff", // 主体, transcript 区
  bgSurface: "#fff",
  bgRaised: "#FAFAFA", // sidebar 区 / 一些卡内的浅灰
  bgSubtle: "#F7F7F9", // 数据块 inset
  bgChip: "#F2F2F7", // chip / pill 浅灰 / inputbar inset
  bgHoverChip: "#E8E8ED",

  // 文字
  fgPrimary: "#1C1C1E",
  fgSecondary: "#3C3C43",
  fgTertiary: "#8E8E93",
  fgQuaternary: "#C7C7CC",

  // 描边
  divider: "rgba(60,60,67,0.10)",
  dividerStrong: "rgba(60,60,67,0.14)",
  borderHair: "0.5px solid #E5E5EA",
  borderHair2: "0.5px solid rgba(60,60,67,0.10)",
  borderHair2Strong: "0.5px solid rgba(60,60,67,0.14)",

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

  // shadow
  shadowSubtle: "0 1px 2px rgba(0,0,0,0.03)",
  shadowCard: "0 2px 8px rgba(0,0,0,0.04)",
  shadowModal: "0 24px 60px rgba(0,0,0,0.30)",
  shadowMenu: "0 8px 28px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12)",
  shadowFab: "0 4px 14px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(60,60,67,0.12)",
} as const;

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
