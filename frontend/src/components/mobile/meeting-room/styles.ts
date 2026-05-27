"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2
 *
 * 共享视觉常量 + 动画 keyframes inject 工具.
 *
 * 设计源: docs/design/handoffs/2026-05-25-meeting-room/project/meeting-room.jsx
 *
 * 浅色 iOS 风骨架. 仅这一页用 — 不污染 globals.css. keyframes 通过
 * useEffect 注入一个 <style> tag, 卸载页面时清掉.
 *
 * z-index 规划 (跟 changelist R7 一致):
 *   0     base
 *   30    transcript content / dock (fixed inset)
 *   60    FAB / FilterBanner sticky
 *   80    sheet 遮罩
 *   81    sheet 主体
 *   90    Modal 遮罩 (EndConfirm / SevereOffTopic / LeaveSheet)
 *   91    Modal 主体
 *   100   Toast (最顶层, 兼容现有 Toast.tsx 的 z-index)
 */

import { useEffect } from "react";

/** iOS 系统色 / 中性灰 — 跟 bundle 1:1. */
export const MR_COLORS = {
  // 背景
  bgGroupedPrimary: "#F2F2F7",     // iOS systemGroupedBackground
  bgWhite: "#FFFFFF",
  bgInputFill: "#F7F7F9",          // data 块 / 输入填充
  // 文字
  textPrimary: "#1C1C1E",
  textSecondary: "#3C3C43",
  textTertiary: "#8E8E93",
  textQuaternary: "#C7C7CC",
  // 系统色
  systemBlue: "#007AFF",
  systemRed: "#FF3B30",
  systemOrange: "#FF9F0A",
  systemAmber: "#FFB340",          // host 主题
  systemGreen: "#34C759",
  systemPurple: "#5E5CE6",
  systemPink: "#FF375F",
  // hairline / border
  hairline: "rgba(60,60,67,0.12)",
  hairlineStrong: "rgba(60,60,67,0.18)",
  // separator
  separator: "#D1D1D6",
  separatorLight: "#E5E5EA",
  // wechat 绿 (转发到微信)
  wechatGreen: "#07C160",
  // host 强调 (Mira)
  hostBg: "rgba(255,159,10,0.07)",
  hostBgStrong: "rgba(255,179,64,0.10)",
  hostBorder: "rgba(255,159,10,0.30)",
  // 红色强提醒
  urgentBg: "rgba(255,59,48,0.08)",
  urgentBorder: "rgba(255,59,48,0.45)",
};

/** SF Pro 字体栈 — 仅整页内联, 不动 globals.css (TD7). */
export const MR_FONT_FAMILY =
  "-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif";

/** iOS 头像 / 卡片 默认 ring 颜色. */
export const MR_RING = "#FFFFFF";

const ANIMATION_KEYFRAMES = `
@keyframes mr-fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes mr-slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes mr-wfBar {
  0%   { transform: scaleY(0.3); }
  100% { transform: scaleY(1); }
}
@keyframes mr-dotBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-3px); opacity: 1; }
}
@keyframes mr-livePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.15); }
}
@keyframes mr-speakingPulse {
  0%, 100% { box-shadow: 0 0 0 2px #34C759, 0 0 0 4px rgba(52,199,89,0.30); }
  50%      { box-shadow: 0 0 0 2px #34C759, 0 0 0 8px rgba(52,199,89,0); }
}
@keyframes mr-urgentPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.20); }
  50%      { box-shadow: 0 0 0 4px rgba(255,59,48,0.10); }
}
@keyframes mr-popIn {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
/* v1.4.0 Saga E.E (Sprint 2-3): AI 圆桌 — 新 agent_message 渐入. */
@keyframes mr-aiMsgSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* v1.4.0 Saga E.E: AI 头像 ring pulse (current_speaker_agent_id). */
@keyframes mr-aiSpeakingRing {
  0%, 100% { box-shadow: 0 0 0 2px rgba(94,92,230,0.30), 0 0 0 4px rgba(94,92,230,0.15); }
  50%      { box-shadow: 0 0 0 2px rgba(94,92,230,0.55), 0 0 0 8px rgba(94,92,230,0); }
}
/* v1.4.0 Sprint 3 Mobile Part 2 (NORTH_STAR § 3.1 v1.1): 记忆出处链回 高亮 3 秒.
   URL ?focus=<key>&highlight=1 → 滚到锚点 + add 'mr-focus-highlight' class →
   触发本 keyframe 闪 3 次 紫→黄→紫 → 3050ms 后 移除 class.
   背景脉冲 + outline 双层, 既显眼 又 不破坏 list 颜色契约. */
@keyframes mr-focusHighlight {
  0%   { background-color: rgba(94,92,230,0.00); outline: 0 solid rgba(255,159,10,0); outline-offset: 0; }
  10%  { background-color: rgba(255,159,10,0.18); outline: 3px solid rgba(255,159,10,0.55); outline-offset: 0; }
  35%  { background-color: rgba(94,92,230,0.16); outline: 3px solid rgba(94,92,230,0.55); outline-offset: 0; }
  60%  { background-color: rgba(255,159,10,0.18); outline: 3px solid rgba(255,159,10,0.55); outline-offset: 0; }
  85%  { background-color: rgba(94,92,230,0.12); outline: 2px solid rgba(94,92,230,0.30); outline-offset: 0; }
  100% { background-color: rgba(94,92,230,0.00); outline: 0 solid rgba(255,159,10,0); outline-offset: 0; }
}
.mr-focus-highlight {
  animation: mr-focusHighlight 3000ms ease-in-out 1 forwards;
  border-radius: 12px;
  scroll-margin-top: 80px;
  scroll-margin-bottom: 120px;
}
`;

const STYLE_TAG_ID = "mr-v2-keyframes";

/** 把本 Saga 的动画 keyframes 注入 <head>. 仅会议室页 useEffect 调.
 *  返回 cleanup. 多组件 mount 不重复注入 (用 id 防重). */
export function useInjectAnimations(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    let created = false;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_TAG_ID;
      style.textContent = ANIMATION_KEYFRAMES;
      document.head.appendChild(style);
      created = true;
    }
    return () => {
      // 仅本组件 mount 期间创建的才清, 避免别处共用时被误删
      if (created && style && style.parentNode) {
        style.parentNode.removeChild(style);
      }
    };
  }, []);
}
