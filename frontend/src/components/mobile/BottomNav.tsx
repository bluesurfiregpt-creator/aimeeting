"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · 底部 nav · 浅色化 + stroke icon.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:689-726
 * (MABottomTabs)
 *
 * 改动 (vs v27.0):
 *   - emoji icon → lucide stroke SVG (target / cal / task=check / brain)
 *   - dark bg-ink-950/95 → light frosted rgba(255,255,255,0.88) + blur(24px) saturate(180%)
 *   - active color: accent-300 蓝 → #007AFF (iOS blue)
 *   - inactive color: zinc-500 → #8E8E93 (iOS systemGray)
 *   - label font 11px → 10.5px, letterSpacing 0.3
 *
 * 保留:
 *   - 4 个 tab + matcher 逻辑
 *   - TOP_LEVEL_PATHS 限制 (二三级页不显)
 *   - safe area padding
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import Icon, { type MRIconName } from "@/components/mobile/shared/Icon";

type NavItem = {
  href: string;
  label: string;
  icon: MRIconName;
  matcher: (path: string) => boolean;
};

const ITEMS: NavItem[] = [
  {
    href: "/m",
    label: "今日",
    icon: "target",
    matcher: (p) => p === "/m",
  },
  {
    href: "/m/meetings",
    label: "会议",
    icon: "cal",
    matcher: (p) => p.startsWith("/m/meetings"),
  },
  {
    href: "/m/tasks",
    label: "任务",
    icon: "task",
    matcher: (p) => p.startsWith("/m/tasks"),
  },
  {
    href: "/m/insights",
    label: "记忆",
    icon: "brain",
    matcher: (p) => p.startsWith("/m/insights"),
  },
];

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
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderTop: "0.5px solid rgba(60,60,67,0.20)",
        paddingBottom: "env(safe-area-inset-bottom, 0)",
      }}
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = item.matcher(pathname);
          const color = active ? "#007AFF" : "#8E8E93";
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-14 flex-col items-center justify-center gap-0.5 transition active:scale-95"
                style={{ color }}
              >
                <Icon
                  name={item.icon}
                  size={22}
                  color={color}
                  strokeWidth={active ? 2.1 : 1.7}
                />
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: 0.3,
                    color,
                  }}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
