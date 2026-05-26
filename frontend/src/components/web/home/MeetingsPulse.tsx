"use client";

import Link from "next/link";
import { W_TOKENS } from "../tokens";
import { WAIBadge, WAvatar, WIcon, type WIconName } from "../atoms";

/**
 * 首页 "你的会议" tab 内容 — 3 stats + LIVE 大卡 + (即将开始 / 最近纪要) 双侧栏.
 *
 * R5.A scope: hardcode mock 数据. R5.C 接 workspace stats API.
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
  miraNote: string;
};
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
    miraNote: "Mira 已记录 12 个关键点 · 3 个待你确认",
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

export function MeetingsPulse() {
  const m = HOME_MEETINGS;
  const pct = Math.min(100, (m.live.elapsed / m.live.duration) * 100);

  return (
    <div style={{ marginTop: 18 }}>
      {/* 3 stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <StatTile
          icon="bolt"
          iconColor="#86EFAC"
          label="进行中"
          value={m.totals.live}
          pulseHint="LIVE"
          href="/meeting"
        />
        <StatTile icon="clock" iconColor={W_TOKENS.cyan} label="今日即将开始" value={m.totals.upcoming} href="/workstation/new" />
        <StatTile
          icon="history"
          iconColor="#C4B5FD"
          label="历史会议"
          value={m.totals.history}
          sub="本月"
          href="/workstation/meeting/q3-roadmap"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "5fr 4fr", gap: 14 }}>
        {/* LIVE big card */}
        <Link href="/meeting" style={liveCardStyle as React.CSSProperties}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, #34C759 0%, #34C759 ${pct}%, rgba(52,199,89,0.20) ${pct}%, rgba(52,199,89,0.20) 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -40,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(52,199,89,0.18) 0%, rgba(0,0,0,0) 65%)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", padding: "20px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 5,
                  background: "#34C759",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: 0.5,
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
              <span
                style={{
                  fontSize: 12,
                  color: W_TOKENS.textMuted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                已 {m.live.elapsed} / {m.live.duration} 分钟
              </span>
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: W_TOKENS.textPrimary,
                letterSpacing: -0.5,
                lineHeight: 1.25,
              }}
            >
              {m.live.title}
            </div>
            <div style={{ fontSize: 13, color: W_TOKENS.textMuted, marginTop: 3 }}>
              {m.live.sub} · {m.live.topic}
            </div>

            <div
              style={{
                marginTop: 14,
                padding: "9px 12px",
                borderRadius: 9,
                background: "rgba(124,92,250,0.06)",
                boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.20)",
                display: "flex",
                alignItems: "center",
                gap: 9,
              }}
            >
              <WAIBadge id="MIRA" size={22} radius={6} />
              <span style={{ flex: 1, fontSize: 12.5, color: W_TOKENS.textSecondary }}>
                {m.live.miraNote}
              </span>
            </div>

            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "inline-flex", alignItems: "center" }}>
                {m.live.participants.map((id, i) => (
                  <span key={id} style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 10 - i }}>
                    <WAvatar id={id} size={24} ring={W_TOKENS.surface} />
                  </span>
                ))}
              </div>
              <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>
                {m.live.participants.length} 人 · {m.live.ais.length} AI
              </span>
              <span style={{ flex: 1 }} />
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "8px 14px",
                  borderRadius: 9,
                  background: W_TOKENS.accentGrad,
                  color: "#fff",
                  fontSize: 13.5,
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(124,92,250,0.35)",
                }}
              >
                立即加入
                <WIcon name="arr-r" size={13} color="#fff" stroke={2.4} />
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
