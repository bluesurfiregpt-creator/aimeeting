"use client";

import { W_TOKENS } from "../tokens";
import { WIcon, type WIconName } from "../atoms";

/**
 * 首页 横向 tab 卡 — "你的会议" vs "AI 专家".
 *
 * PM chat 决策: "首页的「你的会议」与「AI 专家」应该是横向的并列关系,
 * 或者说切换关系。而不是上下关系" — 所以是 1x2 grid, 不是 stack.
 */
export type HomeTab = "meet" | "ai";

type TabSpec = {
  id: HomeTab;
  label: string;
  icon: WIconName;
  accent: string;
  hot: string;
  count: string;
};

const TABS: TabSpec[] = [
  {
    id: "meet",
    label: "你的会议",
    icon: "cal",
    accent: "#86EFAC",
    hot: "LIVE",
    count: "1 进行 · 2 即将 · 24 已开",
  },
  {
    id: "ai",
    label: "AI 专家",
    icon: "sparkle",
    accent: "#C4B5FD",
    hot: "32",
    count: "16 活跃 · 9 个领域",
  },
];

export function HomeFeedTabs({
  tab,
  onChange,
}: {
  tab: HomeTab;
  onChange: (next: HomeTab) => void;
}) {
  return (
    <section style={{ marginTop: 56 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              style={{
                position: "relative",
                overflow: "hidden",
                padding: "16px 20px",
                borderRadius: 14,
                border: "none",
                background: on ? W_TOKENS.surface : "transparent",
                boxShadow: on
                  ? `inset 0 0 0 1px ${t.accent}50, 0 6px 18px ${t.accent}12`
                  : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "all 220ms ease",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.borderHover}`;
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}`;
              }}
            >
              {on && (
                <div
                  style={{
                    position: "absolute",
                    top: -50,
                    right: -40,
                    width: 200,
                    height: 200,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, ${t.accent}20 0%, rgba(0,0,0,0) 65%)`,
                    pointerEvents: "none",
                  }}
                />
              )}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 11,
                  flexShrink: 0,
                  background: on ? `${t.accent}20` : "rgba(255,255,255,0.04)",
                  boxShadow: on
                    ? `inset 0 0 0 0.5px ${t.accent}50`
                    : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  zIndex: 1,
                  transition: "all 200ms ease",
                }}
              >
                <WIcon name={t.icon} size={20} color={on ? t.accent : W_TOKENS.textMuted} />
                {on && t.hot === "LIVE" && (
                  <span
                    style={{
                      position: "absolute",
                      top: -2,
                      right: -2,
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: t.accent,
                      boxShadow: `0 0 8px ${t.accent}`,
                      animation: "wPulse 1.4s ease-in-out infinite",
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: on ? W_TOKENS.textPrimary : W_TOKENS.textSecondary,
                      letterSpacing: -0.3,
                    }}
                  >
                    {t.label}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: on ? t.accent : W_TOKENS.textMuted,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {t.hot}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: W_TOKENS.textMuted,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.count}
                </div>
              </div>
              {on && <WIcon name="arr-r" size={14} color={t.accent} stroke={2.2} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
