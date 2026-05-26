/**
 * v27.0-mobile · 移动端子树 root layout (server component).
 *
 * 必须是 server component, 因为 Next.js 要求 viewport export 在 server 端.
 * 真正的 layout 逻辑 (pathname 判断 / BottomNav) 在 MobileShell.client.tsx.
 */

import type { Viewport } from "next";
import MobileShell from "./MobileShell";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 让 H5 内容延伸至 iPhone 全面屏的 notch / home indicator 区域,
  // 配合 env(safe-area-inset-*) padding 在各元素上避免被遮挡.
  viewportFit: "cover",
  // v1.4.0 Saga F 配套: H5 内容已全浅色, 顶部状态栏 (Safari / 微信 webview / Android)
  // 必须跟 page bg 一致 (#F2F2F7 = iOS 系统灰), 否则用户感觉 "顶部黑底" 误以为没变.
  themeColor: "#F2F2F7",
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
