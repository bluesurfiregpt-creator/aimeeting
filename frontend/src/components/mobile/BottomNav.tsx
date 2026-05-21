"use client";

/**
 * v27.0-mobile · 底部 nav · 4 个入口.
 *
 * 严按 brief: 按 "用户当下任务" 组织, 不按系统模块.
 *   🎯 今日   📅 会议   ✓ 任务   🧠 记忆
 *
 * 设计注意:
 *   - 4 个 = 移动端 nav 紧凑上限. 不加第 5 个 (记忆一项涵盖快照 + 待审 + 记忆库金字塔)
 *   - 当前 tab 高亮 — 仅 active 用实色, 其他用灰
 *   - 不用大 emoji 卖萌, 用 lucide 风格 stroke icon 配短 label
 *   - sticky bottom, safe-area 适配 iOS 底部 home bar
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  matcher: (path: string) => boolean;
};

const ITEMS: NavItem[] = [
  {
    href: "/m",
    label: "今日",
    icon: "🎯",
    matcher: (p) => p === "/m",
  },
  {
    href: "/m/meetings",
    label: "会议",
    icon: "📅",
    matcher: (p) => p.startsWith("/m/meetings"),
  },
  {
    href: "/m/tasks",
    label: "任务",
    icon: "✓",
    matcher: (p) => p.startsWith("/m/tasks"),
  },
  {
    href: "/m/insights",
    label: "记忆",
    icon: "🧠",
    matcher: (p) => p.startsWith("/m/insights"),
  },
];

// P18 audit: 二三级页 (详情页 / 表单 / 我的 / 通知 / 总结 等) 全不渲
// BottomNav — 避免挡按钮 / 减视觉干扰. 仅 4 个主 tab path 显.
const TOP_LEVEL_PATHS = new Set([
  "/m",
  "/m/meetings",
  "/m/tasks",
  "/m/insights",
]);

export default function BottomNav() {
  const pathname = usePathname() || "/m";
  if (!TOP_LEVEL_PATHS.has(pathname)) {
    return null;
  }
  return (
    <nav
      data-testid="mobile-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = item.matcher(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex h-14 flex-col items-center justify-center gap-1 transition ${
                  active ? "text-accent-300" : "text-zinc-500"
                } active:scale-95`}
              >
                <span className={`text-xl leading-none ${active ? "" : "opacity-70"}`}>
                  {item.icon}
                </span>
                <span className="text-[11px] font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
