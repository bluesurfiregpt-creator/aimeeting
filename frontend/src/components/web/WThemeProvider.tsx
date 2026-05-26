"use client";

import { useEffect } from "react";
import { W_THEME_CSS } from "./tokens";

/**
 * 把 W_THEME_CSS 一次性注入 <head> (而非写到 globals.css).
 *
 * 为什么不写 globals.css:
 * - globals.css 被 Mobile (/m/*) 和 Web 共享.
 * - 把 web 暗紫 CSS variables 写进去会污染 mobile (虽然 mobile 不用 var(--w-*),
 *   但 light/dark data-theme attr 容易引起 Mobile 端 onboarding 类 hook 误判).
 * - 所以 在 web 页面挂载时才注入 — 卸载时不删除 (theme 已切, 用户离开后
 *   下次访问 web 还需要, 而且 attr 残留不影响 mobile).
 *
 * 用法: 在 web 页面顶级 (page.tsx, layout.tsx of /workstation) 包一层.
 */
export function WThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 已经注入过 (router 切页) — 跳过
    if (document.getElementById("w-theme-css")) return;
    const style = document.createElement("style");
    style.id = "w-theme-css";
    style.textContent = W_THEME_CSS;
    document.head.appendChild(style);
    // 不在 cleanup 里删 — 见上方注释
  }, []);

  return <>{children}</>;
}
