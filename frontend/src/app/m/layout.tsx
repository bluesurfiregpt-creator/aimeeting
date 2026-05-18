/**
 * v27.0-mobile · 移动端 子树 root layout.
 *
 * 跟 桌面 layout 完全 隔离 — 桌面 chrome (AppLogo / ManualLink / AuthHeader /
 * VersionBadge) 已 由 ChromeGate 在 root 层 闸 掉, 这 里 装 自己 的:
 *
 *   ┌──────────────────────────┐
 *   │ TopBar (sticky, h-12)    │
 *   ├──────────────────────────┤
 *   │                           │
 *   │ children                  │
 *   │ (overflow-y-auto)         │
 *   │                           │
 *   ├──────────────────────────┤
 *   │ BottomNav (fixed, h-14)   │
 *   └──────────────────────────┘
 *
 * 移动端 仅 dark, 不 提供 light. brief 关键词 "深色 沉浸".
 */

import BottomNav from "@/components/mobile/BottomNav";
import TopBar from "@/components/mobile/TopBar";

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-zinc-100">
      <TopBar />
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
