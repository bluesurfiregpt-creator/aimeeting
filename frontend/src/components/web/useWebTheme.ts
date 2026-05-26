"use client";

import { useEffect, useState } from "react";
import { W_THEME_STORAGE_KEY, type WTheme } from "./tokens";

/**
 * Web 端主题 hook — light/dark 切换, 持久化到 localStorage.
 *
 * 注意:
 * - SSR 时 默认 dark (跟 W_THEME_BOOTSTRAP inline 脚本对齐, 避免 flash)
 * - 客户端 mount 后 读 localStorage, 同步到 <html data-theme=...>
 * - 仅在 Web 页面 (非 /m/*) 使用. Mobile 路径自己用 MR_COLORS, 不参与.
 */
export function useWebTheme(): [WTheme, (next: WTheme) => void] {
  // SSR 默认 dark, 避免 hydration mismatch — bootstrap script 已经 在 head 里
  // 把 data-theme 设好了, 客户端读到的 attr 跟 storage 一致.
  const [theme, setThemeState] = useState<WTheme>("dark");

  // 客户端 mount 时一次性读 storage
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(W_THEME_STORAGE_KEY) as WTheme | null;
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
        document.documentElement.setAttribute("data-theme", stored);
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch {
      // localStorage disabled — 保留默认
    }
  }, []);

  const setTheme = (next: WTheme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(W_THEME_STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
    } catch {
      // ignore
    }
  };

  return [theme, setTheme];
}
