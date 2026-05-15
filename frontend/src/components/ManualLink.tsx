"use client";

/**
 * v26.14 推广: 「📖 系统介绍」 全局 入口.
 *
 * 跳 /manual/index.html (独立 静态 站, 由 Next.js serve from public/).
 * target="_blank" — 不打断 用户 当前 操作.
 *
 * 位置:
 *   - auth 页 (login/register/forgot/reset) 隐藏
 *   - 其他 所有 页面 显示
 *   - 跟 AppLogo 错开:
 *     · AppLogo 隐藏 的 路径 (/ 主页, /meeting/<id> 会议室) → 自己 占 top-3 left-4
 *     · AppLogo 可见 路径 → 自己 移 到 AppLogo 右边 (top-3 left-44)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDDEN_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

function isMeetingRoomPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/meeting\/[^/]+/.test(pathname);
}

// 跟 AppLogo 内部 hide 规则 一致 — AppLogo 在 / + /meeting/<id> 隐藏
function isAppLogoHidden(pathname: string | null): boolean {
  if (!pathname) return true;
  if (HIDDEN_PATHS.has(pathname)) return true;  // auth 页 — 两个 都 不显
  if (pathname === "/") return true;
  if (isMeetingRoomPath(pathname)) return true;
  return false;
}

export default function ManualLink() {
  const pathname = usePathname();
  if (pathname && HIDDEN_PATHS.has(pathname)) return null;  // 跟 AppLogo 一致 不显 在 auth 页

  // AppLogo 当前 是否 在 显 — 决定 我 自己 的 左边 位置
  const appLogoVisible = !isAppLogoHidden(pathname);

  return (
    <div
      className={`fixed top-3 z-30 ${appLogoVisible ? "left-44" : "left-4"}`}
      data-testid="manual-link"
    >
      <Link
        href="/manual/index.html"
        target="_blank"
        rel="noopener noreferrer"
        title="打开 系统 使用 介绍 (新 窗口)"
        className="group flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 backdrop-blur transition hover:border-violet-400 hover:bg-violet-500/20"
      >
        <span className="text-sm leading-none" aria-hidden="true">
          📖
        </span>
        <span className="text-xs font-medium text-violet-200 group-hover:text-white">
          系统 介绍
        </span>
        <span
          className="text-[9px] text-violet-400/70 group-hover:text-violet-300"
          aria-hidden="true"
          title="新窗口 打开"
        >
          ↗
        </span>
      </Link>
    </div>
  );
}
