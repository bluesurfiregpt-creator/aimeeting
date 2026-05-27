"use client";

import { useState, type CSSProperties } from "react";
import { W_TOKENS } from "../tokens";
import { WIcon, WSparkle, type WIconName } from "../atoms";

/**
 * 首页 横向 tab 卡 — "你的会议" vs "AI 专家" (round-6 重写).
 *
 * R6 关键变化 (跟 R5.A 对比):
 *  - 数据 schema 从 `hot/count` 改 `hotLabel + stats[]` (3 段数字卡, 26px 数字优先)
 *  - 激活态: 单 surface + 描边 → **全 bleed 渐变** (深绿/紫 saturated gradient) + shadow + inset 白边
 *  - 字号: 标题 17 → 19/800, 数字 13/700 → 26/800
 *  - minHeight 116, 浮起 translateY(-2px)
 *  - 加 240×240 白光晕 (active) + 2 颗白 sparkle
 *  - 加右上 28×28 玻璃白方块 + 白箭头 (只 active 显示)
 *  - hover 浮起 -1px
 *
 * PM chat 决策: "首页的「你的会议」与「AI 专家」应该是横向的并列关系" → 1x2 grid.
 */
export type HomeTab = "meet" | "ai";

type StatEntry = { num: number; label: string; color: string };
type TabSpec = {
  id: HomeTab;
  label: string;
  icon: WIconName;
  /** 激活态全 bleed 渐变 */
  grad: string;
  /** 激活态 shadow (跟 grad 调性匹配) */
  shadow: string;
  /** 激活态 accent (sparkle / dot 光) */
  accent: string;
  hotLabel: string;
  hotColor: string;
  /** 激活态边框 hover (inactive→active hover 用) — 取渐变主色 */
  hoverEdge: string;
  stats: StatEntry[];
};

const TABS: TabSpec[] = [
  {
    id: "meet",
    label: "你的会议",
    icon: "cal",
    grad: "linear-gradient(135deg, #16A34A 0%, #15803D 100%)",
    shadow: "0 8px 24px rgba(22,163,74,0.35)",
    accent: "#86EFAC",
    hotLabel: "LIVE",
    hotColor: "#86EFAC",
    hoverEdge: "#16A34A",
    stats: [
      { num: 1, label: "进行中", color: "#86EFAC" },
      { num: 2, label: "即将开始", color: "#fff" },
      { num: 24, label: "已开过", color: "rgba(255,255,255,0.75)" },
    ],
  },
  {
    id: "ai",
    label: "AI 专家",
    icon: "sparkle",
    grad: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 50%, #AF52DE 100%)",
    shadow: "0 8px 24px rgba(124,92,250,0.40)",
    accent: "#C4B5FD",
    hotLabel: "32 位",
    hotColor: "#fff",
    hoverEdge: "#7C5CFA",
    stats: [
      { num: 32, label: "专家库", color: "#fff" },
      { num: 16, label: "活跃中", color: "#fff" },
      { num: 9, label: "个领域", color: "rgba(255,255,255,0.75)" },
    ],
  },
];

export function HomeFeedTabs({
  tab,
  onChange,
  meetingsToday = null,
}: {
  tab: HomeTab;
  onChange: (next: HomeTab) => void;
  /** Sprint 3 Web W1: /api/v2/today/snapshot.meetings_today. null = fallback to mock 24. */
  meetingsToday?: number | null;
}) {
  // Sprint 3 Web W1: 替换 "你的会议" tab 第 3 个 stat 的 hardcode 24 → 真接 snapshot.meetings_today.
  // null = fallback to mock (workspace 无数据时 视觉不空盘).
  const liveTabs = TABS.map((t) => {
    if (t.id !== "meet" || meetingsToday == null) return t;
    return {
      ...t,
      stats: t.stats.map((s, i) =>
        i === 2 ? { ...s, num: meetingsToday, label: "今日会议" } : s,
      ),
    };
  });

  return (
    <section style={{ marginTop: 56 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {liveTabs.map((t) => (
          <TabButton key={t.id} t={t} on={tab === t.id} onClick={() => onChange(t.id)} />
        ))}
      </div>
    </section>
  );
}

function TabButton({
  t,
  on,
  onClick,
}: {
  t: TabSpec;
  on: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const baseStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    padding: "20px 22px",
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "all 240ms cubic-bezier(.22,.61,.36,1)",
    minHeight: 116,
    background: on ? t.grad : W_TOKENS.surface,
  };

  const inactiveShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}, 0 1px 2px rgba(0,0,0,0.04)`;
  const inactiveHoverShadow = `inset 0 0 0 1px ${t.hoverEdge}80, 0 4px 14px rgba(0,0,0,0.08)`;
  const activeShadow = `${t.shadow}, inset 0 0 0 1px rgba(255,255,255,0.18)`;

  const computedShadow = on
    ? activeShadow
    : hovered
      ? inactiveHoverShadow
      : inactiveShadow;

  const transform = on ? "translateY(-2px)" : hovered ? "translateY(-1px)" : "none";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...baseStyle, boxShadow: computedShadow, transform }}
    >
      {/* sparkle glow on active */}
      {on && (
        <>
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -50,
              width: 240,
              height: 240,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 65%)",
              pointerEvents: "none",
            }}
          />
          <WSparkle x="80%" y={22} size={9} opacity={0.85} color="#fff" />
          <WSparkle x="68%" y={50} size={5} opacity={0.5} color="#fff" />
        </>
      )}

      {/* TOP ROW: icon + title + hot pill + arrow */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            flexShrink: 0,
            background: on ? "rgba(255,255,255,0.18)" : "rgba(124,92,250,0.10)",
            boxShadow: on
              ? "inset 0 0 0 0.5px rgba(255,255,255,0.30)"
              : "inset 0 0 0 0.5px rgba(124,92,250,0.25)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <WIcon name={t.icon} size={19} color={on ? "#fff" : "#7C5CFA"} stroke={2.1} />
          {t.id === "meet" && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: on ? "#86EFAC" : "#22c55e",
                boxShadow: on ? "0 0 10px #86EFAC" : "0 0 8px rgba(34,197,94,0.5)",
                animation: "wPulse 1.4s ease-in-out infinite",
              }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 19,
                fontWeight: 800,
                color: on ? "#fff" : W_TOKENS.textPrimary,
                letterSpacing: -0.4,
              }}
            >
              {t.label}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: on ? t.hotColor : W_TOKENS.textMuted,
                background: on ? "rgba(255,255,255,0.18)" : "transparent",
                padding: on ? "2px 8px" : "0",
                borderRadius: 5,
                letterSpacing: 0.5,
                boxShadow: on ? "inset 0 0 0 0.5px rgba(255,255,255,0.20)" : "none",
              }}
            >
              {t.hotLabel}
            </span>
          </div>
        </div>

        {on && (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              flexShrink: 0,
              background: "rgba(255,255,255,0.18)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
            }}
          >
            <WIcon name="arr-r" size={14} color="#fff" stroke={2.4} />
          </div>
        )}
      </div>

      {/* BOTTOM ROW: 3 inline stats — 26px number-first */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 22,
        }}
      >
        {t.stats.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: on ? s.color : W_TOKENS.textPrimary,
                letterSpacing: -0.7,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {s.num}
            </span>
            <span
              style={{
                fontSize: 12,
                color: on ? "rgba(255,255,255,0.85)" : W_TOKENS.textMuted,
                fontWeight: 500,
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </button>
  );
}
