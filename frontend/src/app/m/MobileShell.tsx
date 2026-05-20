"use client";

/**
 * v27.0-mobile P18 · 移动端 shell — 控制 BottomNav 留位 + 主内容 scroll.
 *
 * 拆出来当 client 是因为 next.js layout 要 server (export viewport),
 * 这里 用 usePathname 动态决定 pb.
 *
 * 二三级页 (详情 / 表单 / 我的 / 通知 / 总结 等) 不显 BottomNav, 也不留 pb.
 * 主 tab 4 个 path 才显 BottomNav + pb-20.
 *
 * v27.0-mobile P20.3: 在 mount/unmount 给 html 加/移 .mobile-viewport-locked
 * class — 锁住 iOS WKWebView 弹性滚动, 防止 整页 被随意拖动. CSS 在 globals.css.
 * 用 root div fixed inset-0 + overflow-hidden 替代 之前 flex min-h-screen,
 * 让 滚动 仅在 内部 main 发生.
 */

import { useEffect } from "react";
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

  // P20.3: 锁 viewport — 给 html 加 class, 禁 iOS 弹性滚动. unmount 时 移除
  // 让 用户 退到 桌面端 (/login 之类) 时 恢复 默认 滚动 行为.
  useEffect(() => {
    document.documentElement.classList.add("mobile-viewport-locked");
    return () => {
      document.documentElement.classList.remove("mobile-viewport-locked");
    };
  }, []);

  return (
    /* fixed inset-0 + overflow-hidden — 跟 html 的 fixed 一起 把 viewport 钉死.
       内部 main flex-1 overflow-y-auto 才滚 — overscroll-behavior:contain 防
       滚到 边时 反馈 弹到 父级 (双保险, html 已经 锁了 但 防御性 加一道). */
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-ink-950 text-zinc-100">
      <main
        className={`mobile-scroll-area flex-1 overflow-y-auto ${
          isTopLevel ? "pb-20" : ""
        }`}
      >
        {children}
      </main>
      <BottomNav />
      {showPrivacy ? <PrivacyConsent /> : null}
    </div>
  );
}
