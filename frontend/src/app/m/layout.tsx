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
 */

import BottomNav from "@/components/mobile/BottomNav";

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
