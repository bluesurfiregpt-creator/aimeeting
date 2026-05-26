"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { W_USER } from "../data/agents";
import { useWebTheme } from "../useWebTheme";
import { WIcon } from "./WIcon";

/**
 * 固定 blur 顶 nav, Vercel 风.
 * Logo + 5 个 nav item + (cmd+k 搜索) + theme toggle + bell + workspace/user 切换.
 *
 * 当前激活态: 通过 `usePathname()` 自动判断 (无需 prop).
 *  - '/'                 → home
 *  - '/meeting/*'        → meet
 *  - '/workstation/*'    → work (含 work / memo / admin 子段)
 *  - 其他               → 无激活
 *
 * R5.A 只接 home + work, meet/memo/admin 路由后续 Saga 接.
 */
const NAV_ITEMS: { id: string; label: string; href: string; matchPrefix: string }[] = [
  { id: "home", label: "首页",   href: "/",                    matchPrefix: "/__exact_root__" /* 见 isActive */ },
  { id: "meet", label: "会议",   href: "/meeting",             matchPrefix: "/meeting" },
  { id: "work", label: "工作站", href: "/workstation",         matchPrefix: "/workstation" },
  { id: "memo", label: "记忆",   href: "/workstation/memory",  matchPrefix: "/workstation/memory" },
  { id: "admin",label: "管理",   href: "/workstation/admin",   matchPrefix: "/workstation/admin" },
];

const iconBtn = {
  width: 34,
  height: 34,
  borderRadius: 8,
  background: "transparent" as const,
  border: "none" as const,
  cursor: "pointer" as const,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  position: "relative" as const,
};

export function WTopNav({ unreadNotifs = 1 }: { unreadNotifs?: number }) {
  const pathname = usePathname() || "/";
  const [theme, setTheme] = useWebTheme();
  const isHome = pathname === "/";

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.id === "home") return isHome;
    if (item.id === "work" && pathname.startsWith("/workstation")) {
      // memo / admin 子段优先匹配
      if (pathname.startsWith("/workstation/memory")) return false;
      if (pathname.startsWith("/workstation/admin")) return false;
      return true;
    }
    return pathname.startsWith(item.matchPrefix);
  };

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 60,
        background: W_TOKENS.navBg,
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderBottom: `0.5px solid ${W_TOKENS.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 28px",
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          textDecoration: "none",
          color: W_TOKENS.textPrimary,
          marginRight: 28,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: W_TOKENS.accentGrad,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(124,92,250,0.40), inset 0 0 0 0.5px rgba(255,255,255,0.20)",
            flexShrink: 0,
          }}
        >
          <WIcon name="sparkle" size={15} color="#fff" stroke={2.2} />
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>aimeeting</span>
      </Link>

      {/* Nav items */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {NAV_ITEMS.map((it) => {
          const on = isActive(it);
          return (
            <Link
              key={it.id}
              href={it.href}
              style={{
                padding: "7px 12px",
                borderRadius: 7,
                fontSize: 13.5,
                fontWeight: 600,
                color: on ? W_TOKENS.textPrimary : W_TOKENS.textSecondary,
                background: on ? "rgba(255,255,255,0.06)" : "transparent",
                textDecoration: "none",
                transition: "background 140ms ease, color 140ms ease",
              }}
            >
              {it.label}
            </Link>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Cmd+K (R5.A 留 stub, R5.B/C 接) */}
        <button
          type="button"
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
            color: W_TOKENS.textMuted,
            fontSize: 12.5,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <WIcon name="search" size={13} color={W_TOKENS.textMuted} />
          <span>搜索</span>
          <span
            style={{
              padding: "1px 5px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.06)",
              fontSize: 10.5,
              fontWeight: 600,
              color: W_TOKENS.textMuted,
              fontFamily: "inherit",
            }}
          >
            ⌘K
          </span>
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "切换到明亮模式" : "切换到暗夜模式"}
          style={iconBtn}
        >
          <WIcon
            name={theme === "dark" ? "sun" : "moon"}
            size={17}
            color={W_TOKENS.textSecondary}
          />
        </button>

        {/* Bell */}
        <button type="button" style={iconBtn}>
          <WIcon name="bell" size={17} color={W_TOKENS.textSecondary} />
          {unreadNotifs > 0 && (
            <span
              style={{
                position: "absolute",
                top: 7,
                right: 7,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: W_TOKENS.pink,
                boxShadow: `0 0 0 2px ${W_TOKENS.bg}`,
              }}
            />
          )}
        </button>

        {/* Workspace + User */}
        <button
          type="button"
          style={{
            height: 34,
            padding: "0 4px 0 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
            color: W_TOKENS.textPrimary,
            fontSize: 12.5,
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: W_TOKENS.textMuted }}>默认</span>
          <span style={{ width: 1, height: 14, background: W_TOKENS.border }} />
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: W_TOKENS.accentGrad,
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {W_USER.initials}
          </div>
          <WIcon name="chev-d" size={12} color={W_TOKENS.textMuted} />
        </button>
      </div>
    </nav>
  );
}
