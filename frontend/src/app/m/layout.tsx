/**
 * v27.0-mobile · 移动端子树 root layout.
 *
 * 跟桌面 layout 完全隔离 — 桌面 chrome (AppLogo / ManualLink / AuthHeader /
 * VersionBadge) 已由 ChromeGate 在 root 层闸掉, 这里装自己的:
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
 * 移动端仅 dark, 不提供 light. brief 关键词 "深色沉浸".
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
