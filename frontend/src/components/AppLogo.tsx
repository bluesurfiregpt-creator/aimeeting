"use client";

/**
 * v25.12-#1: 全局左上角 logo + 回首页大标签.
 *
 * 出现在所有页面(login/register 除外).点击 → / 首页.
 * 与 AuthHeader (右上角 user/nav 图标) 配对.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

export default function AppLogo() {
  const pathname = usePathname();
  if (pathname && PUBLIC_PATHS.has(pathname)) return null;
  // 在首页时不显示(避免跟 H1 重复)
  if (pathname === "/") return null;

  return (
    <div className="fixed left-4 top-3 z-30">
      <Link
        href="/"
        title="回到首页"
        data-testid="app-logo"
        className="group flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1.5 backdrop-blur transition hover:border-accent-500/40 hover:bg-ink-900"
      >
        {/* 小 logo — 蓝紫色 圆形 + 内部 ai 字样 */}
        <span
          className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-violet-500 text-[10px] font-bold text-white"
          aria-hidden="true"
        >
          ai
        </span>
        <span className="text-xs font-medium text-zinc-200 group-hover:text-white">
          Aimeeting
        </span>
        <span className="hidden text-[10px] text-zinc-500 sm:inline">·</span>
        <span className="hidden text-[10px] text-zinc-500 group-hover:text-accent-400 sm:inline">
          首页
        </span>
      </Link>
    </div>
  );
}
