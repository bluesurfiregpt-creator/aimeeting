"use client";

/**
 * 注入 R5.D 会议室专属 keyframes + iOS scrollbar + theme CSS (mr* 前缀 / .mr-scroll).
 *
 * v1.4.0 升级 (NORTH_STAR § 7.1.1): 加 MR_THEME_CSS 含 :root (light default) +
 * :root[data-theme="dark"] (PM 设计稿 S3TK 深邃星空 + 紫 aurora). 跟 W_THEME 共用
 * data-theme attr, workstation 切 dark 时 会议室也跟着.
 *
 * 用法: 在会议室根组件 useEffect 里调一次, mount 时 inject.
 *
 * **不污染 globals.css** — `.mr-scroll` + `:root --mr-*` 只在 head <style id="mr-keyframes">
 * 注入, 卸载 SPA 时跟着 React lifecycle.
 */

import { useEffect } from "react";
import { MR_ANIMATIONS_CSS, MR_SCROLLBAR_CSS, MR_THEME_CSS } from "./tokens";

const STYLE_ID = "mr-keyframes";

export function useMRAnimations() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = MR_ANIMATIONS_CSS + MR_SCROLLBAR_CSS + MR_THEME_CSS;
    document.head.appendChild(el);
    // 不清除 — 让 keyframes / scrollbar / theme var 全局可用
  }, []);
}
