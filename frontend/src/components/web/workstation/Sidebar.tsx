"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { WIcon } from "../atoms";
import { WS_SECTIONS } from "./sidebarConfig";

/**
 * Workstation 左 sidebar — 232px sticky, 6 段 12 项.
 *
 * 当前激活态: 由 `usePathname()` 判断 — 比较 sub path vs item.slug.
 *
 * URL pattern (App Router):
 *  - /workstation              → 心智模型 (slug="")
 *  - /workstation/<slug>       → 对应 pane
 *  - /workstation/agent/<id>   → AgentDetail (R5.B)
 *  - /workstation/meeting/<id> → MeetingDetail (R5.B)
 */
export function WorkstationSidebar() {
  const pathname = usePathname() || "/workstation";
  // 提取 sub path: '/workstation' → '', '/workstation/board' → 'board',
  // '/workstation/meeting/q3-roadmap' → 'meeting/q3-roadmap'.
  const sub = pathname.replace(/^\/workstation\/?/, "");

  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        position: "sticky",
        top: 60,
        alignSelf: "flex-start",
        maxHeight: "calc(100vh - 60px)",
        overflowY: "auto",
        padding: "24px 12px 40px 0",
      }}
    >
      {WS_SECTIONS.map((sec, si) => (
        <div
          key={sec.id}
          style={{ marginBottom: si === WS_SECTIONS.length - 1 ? 0 : 18 }}
        >
          <div
            style={{
              padding: "0 10px 7px",
              fontSize: 10.5,
              fontWeight: 700,
              color: W_TOKENS.textFaint,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            {sec.label}
          </div>
          {sec.items.map((it) => {
            // 激活态: 完全匹配 OR (item.slug 有内容 & sub 以它开头 e.g. meeting/q3-roadmap)
            const on =
              it.slug === sub ||
              (it.slug.length > 0 && sub.startsWith(it.slug + "/")) ||
              // root pane (mental): 仅 sub === '' 时激活
              (it.slug === "" && sub === "");
            const href = it.slug ? `/workstation/${it.slug}` : "/workstation";
            return (
              <Link
                key={it.slug}
                href={href}
                style={{
                  display: "flex",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  borderRadius: 8,
                  background: on ? "rgba(124,92,250,0.14)" : "transparent",
                  boxShadow: on
                    ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)"
                    : "none",
                  color: on ? "#C4B5FD" : W_TOKENS.textSecondary,
                  fontSize: 13.5,
                  fontWeight: on ? 600 : 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 2,
                  transition: "all 140ms ease",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => {
                  if (!on) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!on) e.currentTarget.style.background = "transparent";
                }}
              >
                <WIcon
                  name={it.icon}
                  size={15}
                  color={on ? "#C4B5FD" : W_TOKENS.textMuted}
                  stroke={on ? 2 : 1.7}
                />
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.badge && (
                  <span
                    style={{
                      background: W_TOKENS.danger,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "0 5px",
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {it.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
