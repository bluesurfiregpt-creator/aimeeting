"use client";

/**
 * 注入 R5.D 会议室专属 keyframes + iOS scrollbar (mr* 前缀 / .mr-scroll) — 跟 Web 主体 W_THEME_CSS 不冲突.
 *
 * 用法: 在会议室根组件 useEffect 里调一次, mount 时 inject.
 *
 * **不复用 W_THEME_CSS** — 会议室不挂 W_THEME (浅色单 theme).
 * **不污染 globals.css** — `.mr-scroll` 只作用于 R5.D 内部 5 个滚动区
 * (MRLeftPanel / MRRightPanel / MRLiveView transcript / MRInputBar speaker sheet / MRModals filter).
 */

import { useEffect } from "react";
import { MR_ANIMATIONS_CSS, MR_SCROLLBAR_CSS } from "./tokens";

const STYLE_ID = "mr-keyframes";

export function useMRAnimations() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = MR_ANIMATIONS_CSS + MR_SCROLLBAR_CSS;
    document.head.appendChild(el);
    // 不清除 — 让 keyframes / scrollbar 全局可用 (会议室页面之外不引用 mr* / .mr-scroll 不影响)
  }, []);
}
