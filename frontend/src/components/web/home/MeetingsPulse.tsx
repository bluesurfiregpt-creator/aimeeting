"use client";

import Link from "next/link";
import type { V2TodaySnapshotResponse } from "@/lib/api";
import { W_TOKENS } from "../tokens";
import { WAIBadge, WAvatar, WIcon, WSparkle, type WIconName } from "../atoms";

/**
 * 首页 "你的会议" tab 内容 — round-6 重写.
 *
 * R6 关键变化 (跟 R5.A 对比):
 *  - LIVE 大卡: 加 64×64 环形 SVG 计时器 (替代旧 LIVE pill + 文字进度)
 *  - LIVE 大卡: 加 4 张 MiniStat (关键点 / 待确认 / 资料 / AI 引用)
 *  - LIVE 大卡: 加 Mira 频谱 (11 根 SVG `<rect>` 带 SMIL `<animate>`) — "正在记录关键点…"
 *  - LIVE 大卡: 加 280px 大绿光晕 + 22×22 点阵 SVG `<pattern>` + 3 颗绿 sparkle 装饰
 *  - LIVE 大卡: 顶部 LIVE pill 加 12px 绿光, fontWeight 700 → 800
 *  - LIVE 大卡: 底部 CTA 8×14px / 13.5 → 10×18px / 14/800 + 6px 18px 绿光 + inset 白边
 *  - 字号整体上调, 复用双 token (light/dark 自动适配)
 *
 * **Scope**: hardcode mock 数据 (来自 round-6 设计稿 web-home.jsx 第 720 行 HOME_MEETINGS).
 *
 * **Sprint 3 Web W1 (Saga T1-T2 真接)**:
 *   parent WebHome 拉 /api/v2/today/live-meeting + /api/v2/today/snapshot
 *   传给本组件; 没数据 时 fallback to mock HOME_MEETINGS (workspace 还没沉淀
 *   真实 meeting 时 视觉不空盘, 加 "演示数据" pill 反幻觉).
 */
type LiveMeeting = {
  id: string;
  title: string;
  sub: string;
  topic: string;
  elapsed: number;
  duration: number;
  participants: string[];
  ais: string[];
  miraNote?: string;
};

/** Sprint 3 Web W1: 父级 WebHome 传入. backend 数据 normalize 过, 字段跟
 *  内部 LiveMeeting 几乎一致 (额外加 miraNote). */
export type MeetingsPulseLiveData = LiveMeeting;
type UpcomingMeeting = {
  id: string;
  title: string;
  when: string;
  startsIn: string;
  ais: string[];
};
type HistoryMeeting = {
  id: string;
  title: string;
  when: string;
  decisions: number;
  actions: number;
  ais: string[];
};

const HOME_MEETINGS = {
  live: {
    id: "q3-roadmap",
    title: "Q3 路线图对齐",
    sub: "产品组周会",
    topic: "Q3 重点路线 · 协作功能取舍",
    elapsed: 23,
    duration: 60,
    participants: ["ZK", "LM", "WJ", "CY", "SL"],
    ais: ["MIRA", "STRATOS", "ARIA"],
  } as LiveMeeting,
  upcoming: [
    { id: "m2", title: "搜索体验评审 #4", when: "14:00", startsIn: "2h 18m", ais: ["MIRA", "SAGE"] },
    { id: "m3", title: "与客户 · Hummingbird 反馈", when: "16:30", startsIn: "4h 48m", ais: ["MIRA", "SCOUT", "SHU"] },
  ] as UpcomingMeeting[],
  history: [
    { id: "h1", title: "早间 Standup",         when: "今天 09:00", decisions: 2, actions: 3, ais: ["MIRA", "ARIA"] },
    { id: "h2", title: "数据安全合规风评会",    when: "昨天 15:00", decisions: 3, actions: 4, ais: ["MIRA", "LEX", "SHU"] },
    { id: "h3", title: "摘要模型 A/B 复盘",     when: "5/22",      decisions: 1, actions: 2, ais: ["ARIA", "TALLY"] },
    { id: "h4", title: "产品组周会 · 上周",     when: "5/19",      decisions: 2, actions: 5, ais: ["MIRA", "STRATOS", "SAGE"] },
  ] as HistoryMeeting[],
  totals: { live: 1, upcoming: 2, history: 24 },
};

const liveCardStyle = {
  position: "relative" as const,
  overflow: "hidden" as const,
  background: W_TOKENS.surface,
  borderRadius: 14,
  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 6px 22px rgba(52,199,89,0.10)`,
  border: "none" as const,
  cursor: "pointer" as const,
  fontFamily: "inherit",
  textAlign: "left" as const,
  padding: 0,
  color: W_TOKENS.textPrimary,
  width: "100%" as const,
  textDecoration: "none" as const,
  display: "block" as const,
};

const miniHeader = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 5,
  fontSize: 10.5,
  fontWeight: 700,
  color: W_TOKENS.textMuted,
  letterSpacing: 0.4,
  textTransform: "uppercase" as const,
  padding: "0 4px 7px",
  width: "100%" as const,
};

const miniLink = {
  color: "#C4B5FD",
  fontSize: 11,
  fontWeight: 600,
  textDecoration: "none" as const,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 2,
};

export type MeetingsPulseProps = {
  /** Sprint 3 Web W1: 真接 /api/v2/today/live-meeting 后 父级传; null = 后端没 live, 用 mock 数据 + 演示 pill */
  liveData?: MeetingsPulseLiveData | null;
  /** /api/v2/today/snapshot, 用于 3 stat tile (今日/即将/历史 数). null = fallback mock */
  snapshot?: V2TodaySnapshotResponse | null;
  /** 至少 1 个 today API 通 — 别 demoPill, 否则 加 "演示数据" 反幻觉 pill */
  usingRealData?: boolean;
};

export function MeetingsPulse({
  liveData = null,
  snapshot = null,
  usingRealData = false,
}: MeetingsPulseProps = {}) {
  // 真接成功用 backend, 否则 fallback to mock HOME_MEETINGS.live
  const live: LiveMeeting = liveData ?? HOME_MEETINGS.live;
  const m = HOME_MEETINGS; // upcoming + history 列仍 mock (Saga T6 续接)
  const totals = {
    live: liveData ? 1 : HOME_MEETINGS.totals.live,
    upcoming: HOME_MEETINGS.totals.upcoming,
    // /api/v2/today/snapshot 没直接给 历史会议数, 用 meetings_today fallback (含历史 + live)
    history: snapshot?.meetings_today ?? HOME_MEETINGS.totals.history,
  };
  const isDemo = !usingRealData;
  const pct = Math.min(100, (live.elapsed / Math.max(1, live.duration)) * 100);
  const ringCircumference = 2 * Math.PI * 28;

  return (
    <div style={{ marginTop: 18 }}>
      {isDemo && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(124,92,250,0.10)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
            color: "#C4B5FD",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            marginBottom: 10,
          }}
        >
          演示数据 · workspace 还没沉淀真实会议
        </div>
      )}
      {/* 3 stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <StatTile
          icon="bolt"
          iconColor="#86EFAC"
          label="进行中"
          value={totals.live}
          pulseHint="LIVE"
          href="/meeting"
        />
        <StatTile
          icon="clock"
          iconColor={W_TOKENS.cyan}
          label="今日即将开始"
          value={totals.upcoming}
          href="/workstation/new"
        />
        <StatTile
          icon="history"
          iconColor="#C4B5FD"
          label="历史会议"
          value={totals.history}
          sub="本月"
          href="/workstation/meeting/q3-roadmap"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "5fr 4fr", gap: 14 }}>
        {/* LIVE big card — packed, decorative, info-rich */}
        <Link
          href={live.id ? `/meeting/${live.id}/live` : "/meeting"}
          style={liveCardStyle as React.CSSProperties}
        >
          {/* live progress ribbon at top */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, #34C759 0%, #34C759 ${pct}%, rgba(52,199,89,0.20) ${pct}%, rgba(52,199,89,0.20) 100%)`,
              zIndex: 2,
            }}
          />

          {/* DECORATIVE: large green glow (280×280) */}
          <div
            style={{
              position: "absolute",
              top: -80,
              right: -60,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(52,199,89,0.20) 0%, rgba(0,0,0,0) 65%)",
              pointerEvents: "none",
            }}
          />

          {/* DECORATIVE: subtle dot grid */}
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              opacity: 0.45,
            }}
          >
            <defs>
              <pattern id="lc-dots" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.7" fill="rgba(52,199,89,0.25)" />
              </pattern>
              <linearGradient id="lc-mask" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#000" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#000" stopOpacity="0" />
              </linearGradient>
              <mask id="lc-dotmask">
                <rect width="100%" height="100%" fill="url(#lc-mask)" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="url(#lc-dots)" mask="url(#lc-dotmask)" />
          </svg>

          {/* DECORATIVE: 3 sparkles */}
          <WSparkle x="62%" y={22} size={10} opacity={0.7} color="#86EFAC" />
          <WSparkle x="78%" y={50} size={6} opacity={0.5} color="#86EFAC" />
          <WSparkle x="86%" y={88} size={8} opacity={0.6} color="#86EFAC" />

          <div style={{ position: "relative", padding: "18px 20px 16px" }}>
            {/* HEAD: 64px circular ring timer + title block — 2 column */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              {/* circular ring timer */}
              <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
                <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(52,199,89,0.15)" strokeWidth="4" />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="4"
                    strokeDasharray={`${(pct / 100) * ringCircumference} ${ringCircumference}`}
                    strokeLinecap="round"
                    style={{ filter: "drop-shadow(0 0 6px rgba(34,197,94,0.50))" }}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: "#16A34A",
                      letterSpacing: -0.4,
                      lineHeight: 1,
                    }}
                  >
                    {live.elapsed}
                  </span>
                  <span style={{ fontSize: 9, color: W_TOKENS.textMuted, marginTop: 2 }}>
                    / {live.duration} 分
                  </span>
                </div>
              </div>

              {/* title block */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 9px",
                      borderRadius: 5,
                      background: "#22c55e",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 10.5,
                      letterSpacing: 0.6,
                      boxShadow: "0 0 12px rgba(34,197,94,0.50)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#fff",
                        animation: "wPulse 1.4s ease-in-out infinite",
                      }}
                    />
                    LIVE
                  </span>
                  <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>{live.sub}</span>
                </div>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    color: W_TOKENS.textPrimary,
                    letterSpacing: -0.5,
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {live.title}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: W_TOKENS.textSecondary,
                    marginTop: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#22c55e" }} />
                  正在讨论 · {live.topic}
                </div>
              </div>
            </div>

            {/* 4 mini stats — packed inline */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                marginTop: 14,
              }}
            >
              <MiniStat icon="bolt" label="关键点" value={12} color="#22c55e" />
              <MiniStat icon="task" label="待确认" value={3} color="#F59E0B" />
              <MiniStat icon="doc" label="资料" value={3} color="#0EA5E9" />
              <MiniStat icon="sparkle" label="AI 引用" value={4} color="#A855F7" />
            </div>

            {/* Mira voice spectrum ribbon */}
            <div
              style={{
                marginTop: 12,
                padding: "8px 11px",
                borderRadius: 9,
                background:
                  "linear-gradient(90deg, rgba(255,179,64,0.10) 0%, rgba(255,255,255,0) 100%)",
                boxShadow: "inset 0 0 0 0.5px rgba(255,179,64,0.25)",
                display: "flex",
                alignItems: "center",
                gap: 9,
              }}
            >
              <WAIBadge id="MIRA" size={22} radius={6} />
              {/* fake voice waveform — 11 bars SMIL animate */}
              <svg width="44" height="14" style={{ flexShrink: 0 }}>
                {[3, 7, 5, 9, 11, 6, 8, 4, 10, 7, 5].map((h, i) => (
                  <rect
                    key={i}
                    x={i * 4}
                    y={(14 - h) / 2}
                    width="2"
                    height={h}
                    rx="1"
                    fill="#FFB340"
                    opacity={0.5 + (i % 3) * 0.15}
                  >
                    <animate
                      attributeName="height"
                      values={`${h};${h * 0.4};${h}`}
                      dur={`${0.6 + (i % 3) * 0.2}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="y"
                      values={`${(14 - h) / 2};${(14 - h * 0.4) / 2};${(14 - h) / 2}`}
                      dur={`${0.6 + (i % 3) * 0.2}s`}
                      repeatCount="indefinite"
                    />
                  </rect>
                ))}
              </svg>
              <span
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  color: W_TOKENS.textPrimary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <strong style={{ color: "#FFB340" }}>Mira</strong>{" "}
                {live.miraNote ?? "正在记录关键点…"}
              </span>
            </div>

            {/* Bottom: participants + big green CTA */}
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                {live.participants.map((id, i) => (
                  <span key={id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}>
                    <WAvatar id={id} size={26} ring={W_TOKENS.surface} />
                  </span>
                ))}
                <span style={{ marginLeft: -8, zIndex: 1 }}>
                  {live.ais.map((aid, i) => (
                    <span key={aid} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                      <WAIBadge id={aid} size={22} radius={6} />
                    </span>
                  ))}
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted, lineHeight: 1.3 }}>
                <strong style={{ color: W_TOKENS.textPrimary, fontWeight: 700 }}>
                  {live.participants.length} 人
                </strong>
                {" · "}
                <strong style={{ color: "#C4B5FD", fontWeight: 700 }}>
                  {live.ais.length} 位 AI
                </strong>
                {" 正参会"}
              </span>
              <span style={{ flex: 1 }} />
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: "linear-gradient(135deg, #22c55e 0%, #16A34A 100%)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  boxShadow:
                    "0 6px 18px rgba(34,197,94,0.45), inset 0 0 0 1px rgba(255,255,255,0.18)",
                }}
              >
                立即加入
                <WIcon name="arr-r" size={14} color="#fff" stroke={2.6} />
              </div>
            </div>
          </div>
        </Link>

        {/* Right column — upcoming + recent */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={miniHeader}>
              <WIcon name="clock" size={12} color={W_TOKENS.cyan} stroke={2} />
              <span>今日即将开始</span>
            </div>
            {m.upcoming.map((u) => (
              <UpcomingRow key={u.id} u={u} />
            ))}
          </div>
          <div>
            <div style={miniHeader}>
              <WIcon name="history" size={12} color="#C4B5FD" stroke={2} />
              <span>最近的纪要</span>
              <span style={{ flex: 1 }} />
              <Link href="/workstation/meeting/q3-roadmap" style={miniLink}>
                更多 <WIcon name="chev" size={10} color="#C4B5FD" stroke={2.4} />
              </Link>
            </div>
            {m.history.slice(0, 3).map((h) => (
              <HistoryRow key={h.id} h={h} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  color,
}: {
  icon: WIconName;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 9,
        background: "rgba(255,255,255,0.04)",
        boxShadow: `inset 0 0 0 0.5px ${color}26`,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          flexShrink: 0,
          background: `${color}1A`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WIcon name={icon} size={12} color={color} stroke={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: W_TOKENS.textPrimary,
            letterSpacing: -0.4,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 10.5, color: W_TOKENS.textMuted, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  iconColor,
  label,
  value,
  sub,
  pulseHint,
  href,
}: {
  icon: WIconName;
  iconColor: string;
  label: string;
  value: number;
  sub?: string;
  pulseHint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        background: W_TOKENS.surface,
        borderRadius: 12,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        padding: "13px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 160ms ease",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 8px 22px rgba(0,0,0,0.25)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}`;
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          flexShrink: 0,
          background: `${iconColor}15`,
          boxShadow: `inset 0 0 0 0.5px ${iconColor}40`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <WIcon name={icon} size={18} color={iconColor} />
        {pulseHint && (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#86EFAC",
              boxShadow: "0 0 6px rgba(134,239,172,0.80)",
              animation: "wPulse 1.4s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: W_TOKENS.textMuted, letterSpacing: 0.3 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <span
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: iconColor,
              letterSpacing: -0.7,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {value}
          </span>
          {sub && <span style={{ fontSize: 11, color: W_TOKENS.textMuted }}>{sub}</span>}
        </div>
      </div>
      <WIcon name="arr-r" size={14} color={W_TOKENS.textMuted} stroke={1.8} />
    </Link>
  );
}

function UpcomingRow({ u }: { u: UpcomingMeeting }) {
  return (
    <div
      style={{
        background: W_TOKENS.surface,
        borderRadius: 10,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 11,
        marginBottom: 8,
        cursor: "pointer",
        transition: "box-shadow 160ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.borderHover}`)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}`)
      }
    >
      <div
        style={{
          flex: "0 0 44px",
          textAlign: "center",
          padding: "3px 0",
          background: "rgba(100,210,255,0.08)",
          borderRadius: 7,
          boxShadow: "inset 0 0 0 0.5px rgba(100,210,255,0.20)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: W_TOKENS.cyan,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {u.when}
        </div>
        <div style={{ fontSize: 9.5, color: W_TOKENS.textMuted, marginTop: 1 }}>开始</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: W_TOKENS.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {u.title}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 3 }}>
          {u.ais.map((id) => (
            <WAIBadge key={id} id={id} size={14} radius={4} />
          ))}
          <span style={{ fontSize: 11, color: W_TOKENS.textMuted, marginLeft: 3 }}>
            · 还有 {u.startsIn}
          </span>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ h }: { h: HistoryMeeting }) {
  return (
    <Link
      href={"/workstation/meeting/" + h.id}
      style={{
        textDecoration: "none",
        background: W_TOKENS.surface,
        borderRadius: 10,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 11,
        marginBottom: 8,
        transition: "box-shadow 160ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.borderHover}`)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}`)
      }
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          flexShrink: 0,
          background: "rgba(196,181,253,0.10)",
          boxShadow: "inset 0 0 0 0.5px rgba(196,181,253,0.25)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WIcon name="check" size={15} color="#C4B5FD" stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: W_TOKENS.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {h.title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: W_TOKENS.textMuted,
            marginTop: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span>{h.when}</span>
          <span style={{ color: "#86EFAC" }}>{h.decisions} 决策</span>
          <span style={{ color: "#FCD34D" }}>{h.actions} 行动</span>
        </div>
      </div>
      <WIcon name="arr-r" size={13} color={W_TOKENS.textFaint} />
    </Link>
  );
}
