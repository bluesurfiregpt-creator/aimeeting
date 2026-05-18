"use client";

/**
 * v27.0-mobile · 桌面 chrome 闸门.
 *
 * 包裹 AppLogo / ManualLink / AuthHeader / VersionBadge 这 类 桌面 chrome 组件.
 * 当 路径 进 入 移动端 子树 (/m 或 /m/*) 时, 不 渲染 — 让 移动端 layout 自己 做 chrome.
 *
 * 这 比 在 每个 组件 各自 加 if 检查 干净:
 *   - 单点 控制, 加新 chrome 组件 时 一并 受惠
 *   - 移动端 完 全 接 管 自己 的 chrome (sticky TopBar + BottomNav)
 */

import { usePathname } from "next/navigation";

export default function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/m" || pathname?.startsWith("/m/")) return null;
  return <>{children}</>;
}
