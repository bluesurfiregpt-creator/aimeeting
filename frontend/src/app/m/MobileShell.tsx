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
import PrivacyConsent from "@/components/mobile/PrivacyConsent";

const TOP_LEVEL = new Set([
  "/m",
  "/m/meetings",
  "/m/tasks",
  "/m/insights",
]);

// v27.0-mobile P20: 隐私协议 同意 弹窗 不应 在 这些 路径 挡道:
//   - /m/privacy 自身 (用户来读全文, 不能 被弹窗 挡住)
//   - /login 之类的 鉴权页 (路径上是 /login, 不在 /m 下, 实际 不会被 shell 包,
//     此处仅 防御性 列举)
const SKIP_PRIVACY_PATHS = new Set(["/m/privacy"]);

export default function MobileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/m";
  const isTopLevel = TOP_LEVEL.has(pathname);
  const showPrivacy = !SKIP_PRIVACY_PATHS.has(pathname);
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-zinc-100">
      <main className={`flex-1 overflow-y-auto ${isTopLevel ? "pb-20" : ""}`}>
        {children}
      </main>
      <BottomNav />
      {showPrivacy ? <PrivacyConsent /> : null}
    </div>
  );
}
