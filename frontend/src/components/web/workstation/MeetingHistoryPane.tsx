"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { WIcon, WPill, WAvatar, WAIBadge } from "../atoms";
import { W_HISTORY_MEETINGS, type WMeetingHistory } from "../data/history";
import { PaneHeader } from "./PaneHeader";
import { api, type V2MeetingItem } from "@/lib/api";

/**
 * 会议历史 pane — R6.X (round-6, R5.A 漏建 + round-6 新).
 *
 * 内容:
 *  - 6 张 mini-stat 卡 (决策 / 行动项 / AI 引用 / 新记忆)
 *  - iOS segmented (全部 / 今日 / 本周)
 *  - 搜索框 (标题 / 议题 / 类型)
 *  - 网格 grid (auto-fill, minmax(440px, 1fr))
 *  - 每张 HistoryMeetingCard:
 *     - 左 3px accent stripe (live=绿 / done=紫渐变)
 *     - LIVE pill / 已结束 chip + 日期
 *     - 标题 + 副标题 · 议题
 *     - 4 mini-stat (决策 / 行动项 / AI 引用 / 新记忆)
 *     - 参会人 + AI + "查看纪要 →"
 *
 * 数据源 (Sprint 3 Web W2): /api/v2/meetings (ws-scoped). actions/citations/mems
 * 暂走 0 (backend V2MeetingItem 仅 decision_count 真接, 其他 3 字段 V1.5 推迟).
 *
 * Fallback (PM 反幻觉, NORTH_STAR § 7.5): 拉失败或 workspace 没真会议 → fallback mock
 * + "演示数据" pill, 让客户清楚这是 demo.
 *
 * 点击卡 → 跳 /workstation/meeting/<id> (R5.B-meeting MeetingDetail).
 */

// ─── adapter: V2MeetingItem → WMeetingHistory ───
// backend 给的字段比 mock 少 — actions/citations/mems 暂 0 (V1.5 后端补)
// date/time 从 started_at / scheduled_for 推
function adaptV2MeetingToHistory(m: V2MeetingItem): WMeetingHistory {
  const isLive = m.status === "live";
  const tsRaw = m.started_at || m.scheduled_for;
  const ts = tsRaw ? new Date(tsRaw) : null;
  const now = new Date();
  let date = "—";
  if (ts && !isNaN(ts.getTime())) {
    const dayDiff = Math.floor(
      (now.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) /
        86_400_000,
    );
    if (dayDiff === 0) date = "今天";
    else if (dayDiff === 1) date = "昨天";
    else date = `${ts.getMonth() + 1}/${ts.getDate()}`;
  }
  const time = ts && !isNaN(ts.getTime())
    ? `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`
    : "—";

  return {
    id: m.id,
    title: m.title || "未命名会议",
    sub: m.topic_summary || "",
    date,
    time,
    topic: m.topic_summary || "",
    state: isLive ? "live" : "done",
    participants: m.attendees
      .filter((a) => a.type === "human")
      .slice(0, 5)
      .map((a) => a.id),
    ais: m.ai_badges.slice(0, 5).map((b) => b.id),
    decisions: m.decision_count || 0,
    // backend V2MeetingItem 暂没这 3 个字段 (V1.5 推迟新加). 暂 0.
    actions: 0,
    citations: 0,
    mems: 0,
  };
}

export function MeetingHistoryPane() {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "today" | "week">("all");
  const [q, setQ] = useState("");

  // Sprint 3 Web W2: 拉 /api/v2/meetings, fallback mock W_HISTORY_MEETINGS.
  const [meetings, setMeetings] = useState<WMeetingHistory[]>(W_HISTORY_MEETINGS);
  const [usingFallback, setUsingFallback] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await api.getV2Meetings({ limit: 50 });
        if (cancelled) return;
        if (!out.items.length) {
          console.warn(
            "[MeetingHistoryPane] /api/v2/meetings 返回空 (workspace 无会议), 渲染 mock",
          );
          // 维持 fallback mock
          return;
        }
        const adapted = out.items.map(adaptV2MeetingToHistory);
        setMeetings(adapted);
        setUsingFallback(false);
      } catch (e) {
        console.warn(
          "[MeetingHistoryPane] /api/v2/meetings 拉取失败, 渲染 mock:",
          e,
        );
        // 维持 fallback mock
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return meetings.filter((m) => {
      if (q.trim()) {
        const lq = q.toLowerCase();
        if (
          !m.title.toLowerCase().includes(lq) &&
          !m.topic.toLowerCase().includes(lq) &&
          !m.sub.toLowerCase().includes(lq)
        ) {
          return false;
        }
      }
      if (tab === "today") return m.date === "今天" || m.date === "昨天";
      if (tab === "week")
        return ["今天", "昨天"].includes(m.date) ||
          /^\d+\/\d+$/.test(m.date); // 数字日期视为本周
      return true;
    });
  }, [tab, q, meetings]);

  const todayCount = meetings.filter(
    (m) => m.date === "今天" || m.date === "昨天",
  ).length;
  const weekCount = meetings.filter(
    (m) => ["今天", "昨天"].includes(m.date) || /^\d+\/\d+$/.test(m.date),
  ).length;

  // Sprint 3 Web W2: 反幻觉 pill (NORTH_STAR § 7.5) — 走 fallback mock 时清楚标 demo
  const demoBadge = usingFallback ? (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: "#C4B5FD",
        background: "rgba(124,92,250,0.10)",
        padding: "2px 8px",
        borderRadius: 5,
        letterSpacing: 0.3,
        boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
      }}
    >
      演示数据
    </span>
  ) : null;

  return (
    <>
      <PaneHeader
        title="会议历史"
        sub="所有过往的会议纪要 — 决策、行动项、AI 引用、长期记忆,一站式回溯。"
        extra={demoBadge}
      />

      {/* segmented + search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: W_TOKENS.surface,
            borderRadius: 10,
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          }}
        >
          {[
            { id: "all" as const, label: "全部", count: W_HISTORY_MEETINGS.length },
            { id: "today" as const, label: "今日", count: todayCount },
            { id: "week" as const, label: "本周", count: weekCount },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                height: 30,
                padding: "0 14px",
                borderRadius: 7,
                border: "none",
                background: tab === t.id ? "rgba(124,92,250,0.16)" : "transparent",
                boxShadow: tab === t.id ? "inset 0 0 0 0.5px rgba(124,92,250,0.30)" : "none",
                color: tab === t.id ? "#C4B5FD" : W_TOKENS.textSecondary,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.label}
              <span style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            flex: 1,
            maxWidth: 360,
            background: W_TOKENS.surface,
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          }}
        >
          <WIcon name="search" size={13} color={W_TOKENS.textMuted} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 标题 / 议题 / 类型"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: W_TOKENS.textPrimary,
              fontFamily: "inherit",
              fontSize: 13,
              flex: 1,
            }}
          />
        </div>

        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>
          共 <strong style={{ color: W_TOKENS.textPrimary }}>{filtered.length}</strong> 场
        </span>
      </div>

      {/* meeting cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))",
          gap: 14,
        }}
      >
        {filtered.map((m) => (
          <HistoryMeetingCard
            key={m.id}
            m={m}
            onOpen={() => router.push(`/workstation/meeting/${m.id}`)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            color: W_TOKENS.textMuted,
            fontSize: 14,
          }}
        >
          <WIcon name="search" size={32} color={W_TOKENS.textFaint} stroke={1.4} />
          <div style={{ marginTop: 12 }}>没有匹配的会议</div>
        </div>
      )}
    </>
  );
}

function HistoryMeetingCard({ m, onOpen }: { m: WMeetingHistory; onOpen: () => void }) {
  const isLive = m.state === "live";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        position: "relative",
        overflow: "hidden",
        background: W_TOKENS.surface,
        borderRadius: 14,
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}, 0 1px 2px rgba(0,0,0,0.04)`,
        padding: 0,
        textAlign: "left",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${
          isLive ? "rgba(34,197,94,0.40)" : "rgba(124,92,250,0.30)"
        }, 0 8px 22px rgba(0,0,0,0.08)`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 0 0 0.5px ${W_TOKENS.border}, 0 1px 2px rgba(0,0,0,0.04)`;
        e.currentTarget.style.transform = "none";
      }}
    >
      {/* 左 3px accent stripe */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 3,
          background: isLive
            ? "linear-gradient(180deg, #22c55e 0%, #16A34A 100%)"
            : W_TOKENS.accentGrad,
        }}
      />

      <div style={{ padding: "16px 18px 14px" }}>
        {/* top row: state + date */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
          {isLive ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 5,
                background: "#22c55e",
                color: "#fff",
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: 0.5,
                boxShadow: "0 0 10px rgba(34,197,94,0.40)",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#fff",
                  animation: "wPulse 1.4s ease-in-out infinite",
                }}
              />
              LIVE
            </span>
          ) : (
            <WPill tone="neutral">已结束</WPill>
          )}
          <span
            style={{
              fontSize: 12,
              color: W_TOKENS.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {m.date} · {m.time}
          </span>
        </div>

        {/* title */}
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: W_TOKENS.textPrimary,
            letterSpacing: -0.3,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {m.title}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: W_TOKENS.textMuted,
            marginTop: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {m.sub} · {m.topic}
        </div>

        {/* 4 mini-stat */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
            marginTop: 12,
          }}
        >
          {[
            { v: m.decisions, l: "决策", c: "#16A34A" },
            { v: m.actions, l: "行动项", c: "#D97706" },
            { v: m.citations, l: "AI 引用", c: "#7C5CFA" },
            { v: m.mems, l: "新记忆", c: "#DB2777" },
          ].map((s) => (
            <div
              key={s.l}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                background: `${s.c}0F`,
                boxShadow: `inset 0 0 0 0.5px ${s.c}26`,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: s.c,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: -0.3,
                  lineHeight: 1,
                }}
              >
                {s.v}
              </div>
              <div style={{ fontSize: 10, color: W_TOKENS.textMuted, marginTop: 3 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `0.5px solid ${W_TOKENS.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            {m.participants.slice(0, 4).map((id, i) => (
              <span key={id} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i }}>
                <WAvatar id={id} size={20} ring={W_TOKENS.surface} />
              </span>
            ))}
            {m.participants.length > 4 && (
              <span
                style={{
                  marginLeft: -6,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: W_TOKENS.surfaceRaised,
                  color: W_TOKENS.textMuted,
                  fontSize: 10,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 0 0 1.5px ${W_TOKENS.surface}`,
                }}
              >
                +{m.participants.length - 4}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: W_TOKENS.textMuted }}>{m.participants.length} 人</span>
          <span style={{ color: W_TOKENS.textFaint }}>·</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {m.ais.map((aid) => (
              <WAIBadge key={aid} id={aid} size={16} radius={5} />
            ))}
            <span style={{ fontSize: 11, color: W_TOKENS.textMuted, marginLeft: 3 }}>
              {m.ais.length} AI
            </span>
          </div>
          <span style={{ flex: 1 }} />
          <span
            style={{
              color: "#7C5CFA",
              fontSize: 12,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            查看纪要 <WIcon name="arr-r" size={12} color="#7C5CFA" stroke={2.4} />
          </span>
        </div>
      </div>
    </button>
  );
}
