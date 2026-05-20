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
  themeColor: "#0a0a0c",
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
