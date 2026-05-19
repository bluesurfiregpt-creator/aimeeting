/**
 * v27.0-mobile · 移动端子树 root layout.
 *
 * 桌面 chrome (AppLogo / ManualLink / AuthHeader / VersionBadge) 已由 ChromeGate
 * 闸掉.
 *
 * v27.0-P2 改动: 删掉 TopBar (问候+图标 那种桌面残留),
 * 每个页面自己用 PageHeader 渲染顶部 (iOS 大标题风).
 *
 * 仅留:
 *   - 主内容区 (overflow-y-auto)
 *   - 底部 BottomNav (sticky)
 *
 * v27.0-mobile P6 (小程序预设):
 *   - viewport-fit=cover 让背景延伸进 iPhone 全面屏 notch / home indicator 区
 *   - 所有 top/bottom 触边的 fixed/sticky 元素已写 env(safe-area-inset-*)
 *     padding (PageHeader/BottomNav/StickyActionBar/Toast/各 sheet),
 *     viewport-fit=cover 让那些 env() 值才真生效
 */

import type { Viewport } from "next";
import BottomNav from "@/components/mobile/BottomNav";

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
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-zinc-100">
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      <BottomNav />
    </div>
  );
}
