"use client";

/**
 * v27.0-mobile P18 · 移动端 shell — 控制 BottomNav 留位 + 主内容 scroll.
 *
 * 拆出来当 client 是因为 next.js layout 要 server (export viewport),
 * 这里 用 usePathname 动态决定 pb.
 *
 * 二三级页 (详情 / 表单 / 我的 / 通知 / 总结 等) 不显 BottomNav, 也不留 pb.
 * 主 tab 4 个 path 才显 BottomNav + pb-20.
 */

import { usePathname } from "next/navigation";
import BottomNav from "@/components/mobile/BottomNav";

const TOP_LEVEL = new Set([
  "/m",
  "/m/meetings",
  "/m/tasks",
  "/m/insights",
]);

export default function MobileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/m";
  const isTopLevel = TOP_LEVEL.has(pathname);
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-zinc-100">
      <main className={`flex-1 overflow-y-auto ${isTopLevel ? "pb-20" : ""}`}>
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
