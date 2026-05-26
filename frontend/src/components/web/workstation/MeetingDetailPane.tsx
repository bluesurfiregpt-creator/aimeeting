"use client";

/**
 * MeetingDetail pane — R5.B (round-6, "AI 引用闭环").
 *
 * 6 tabs:
 *  1. 概览 — Mira 简报 + 议程进度 + 决策/行动项/引用 quick list
 *  2. 字幕 — timeline + 发言人头像 + 时间戳, AI 引用内嵌
 *  3. 决策 — list + 拍板人 + 时间 + 引用来源
 *  4. 行动项 — list + 负责人 + 截止 + 状态
 *  5. 资料 — 上传材料卡 + AI 引用次数
 *  6. AI 引用 — 完整引用列表 (AI 当时说 ↔ 引用了什么)
 *
 * 数据源:
 *  - q3-roadmap 走 W_MEETING_DETAIL (完整 mock)
 *  - 其他 id 走 fallback (会议存在但无 detail mock 时, 显示骨架信息)
 *
 * 跨 pane 链接: AI badge → /workstation/agent/<id>
 *
 * **R5.B scope**: UI 优先, mock 数据. 后端契约见 SAGA-E-ai-capabilities-changelist.md.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { W_TOKENS } from "../tokens";
import {
  WCard,
  WButton,
  WIcon,
  WPill,
  WAIBadge,
  WAvatar,
  WSparkle,
} from "../atoms";
import { W_AGENTS, W_HUMANS } from "../data/agents";
import {
  W_MEETING_DETAIL,
  getMeetingCitations,
  type WMeetingDetail,
  type MCaption,
  type MDecision,
  type MAction,
  type MMaterial,
  type MAgenda,
  type MCitation,
} from "../data/meetings";
import { W_HISTORY_MEETINGS } from "../data/history";

// ════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════
export function MeetingDetailPane({ meetingId }: { meetingId: string }) {
  // q3-roadmap 是唯一有完整 mock 的; 其他用历史 list 里的元信息 + 空详情
  const m = useMemo<WMeetingDetail>(() => {
    if (meetingId === W_MEETING_DETAIL.id) return W_MEETING_DETAIL;
    // Build a sparse detail from W_HISTORY_MEETINGS (fallback)
    const h = W_HISTORY_MEETINGS.find((x) => x.id === meetingId);
    if (!h) {
      return {
        ...W_MEETING_DETAIL,
        id: meetingId,
        title: meetingId,
        sub: "",
        topic: "",
        summary: "本场会议详情尚未生成,稍后再来。",
        captions: [],
        decisions: [],
        actions: [],
        materials: [],
        agenda: [],
        summaryStats: { decisions: 0, actions: 0, citations: 0, memoriesCreated: 0 },
      };
    }
    return {
      id: h.id,
      title: h.title,
      sub: h.sub,
      date: h.date,
      time: h.time,
      duration: "—",
      status: h.state,
      topic: h.topic,
      agenda: [],
      participants: h.participants,
      ais: h.ais,
      summary: `${h.title} — 详细字幕、决策、引用闭环将在 Saga E 接通真实数据后展示。当前页面骨架已就绪。`,
      summaryStats: {
        decisions: h.decisions,
        actions: h.actions,
        citations: h.citations,
        memoriesCreated: h.mems,
      },
      decisions: [],
      actions: [],
      materials: [],
      captions: [],
    };
  }, [meetingId]);

  const citations = useMemo(() => getMeetingCitations(m), [m]);

  const [tab, setTab] = useState<TabId>("overview");

  const counts: TabCounts = {
    captions: m.captions.length,
    decisions: m.decisions.length,
    actions: m.actions.length,
    materials: m.materials.length,
    citations: citations.length,
  };

  return (
    <div>
      <MeetingDetailHeader m={m} />
      <MeetingTabs tab={tab} onChange={setTab} counts={counts} />
      {tab === "overview" && (
        <OverviewPane m={m} citations={citations} onJumpTab={setTab} />
      )}
      {tab === "caption" && <CaptionsPane m={m} />}
      {tab === "decision" && <DecisionsPane m={m} />}
      {tab === "action" && <ActionsPane m={m} />}
      {tab === "material" && <MaterialsPane m={m} />}
      {tab === "cite" && <CitationsPane citations={citations} />}
    </div>
  );
}

type TabId =
  | "overview"
  | "caption"
  | "decision"
  | "action"
  | "material"
  | "cite";

type TabCounts = {
  captions: number;
  decisions: number;
  actions: number;
  materials: number;
  citations: number;
};

// ════════════════════════════════════════════
// HEADER
// ════════════════════════════════════════════
function MeetingDetailHeader({ m }: { m: WMeetingDetail }) {
  const router = useRouter();
  const isLive = m.status === "live";
  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/workstation/history")}
        style={backLink}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = W_TOKENS.textPrimary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = W_TOKENS.textMuted;
        }}
      >
        <WIcon name="back" size={13} /> 返回 会议历史
      </button>

      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: W_TOKENS.surface,
          borderRadius: 16,
          padding: "20px 24px",
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: isLive
              ? "linear-gradient(90deg, rgba(239,68,68,0.0), rgba(239,68,68,0.8), rgba(239,68,68,0.0))"
              : "linear-gradient(90deg, rgba(34,197,94,0.0), rgba(34,197,94,0.8), rgba(34,197,94,0.0))",
          }}
        />

        <div
          style={{ display: "flex", alignItems: "flex-start", gap: 18 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              {isLive ? (
                <WPill tone="danger">
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#FCA5A5",
                      boxShadow: "0 0 6px rgba(239,68,68,0.6)",
                      animation: "wPulse 1.4s ease-in-out infinite",
                    }}
                  />
                  LIVE
                </WPill>
              ) : (
                <WPill tone="success">
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#86EFAC",
                      boxShadow: "0 0 6px rgba(34,197,94,0.6)",
                    }}
                  />
                  已结束
                </WPill>
              )}
              <span style={{ fontSize: 12.5, color: W_TOKENS.textMuted }}>
                {m.date} · {m.time} · {m.duration}
              </span>
            </div>
            <h1
              style={{
                margin: "10px 0 0",
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: -0.6,
                color: W_TOKENS.textPrimary,
              }}
            >
              {m.title}
            </h1>
            <div
              style={{
                fontSize: 13.5,
                color: W_TOKENS.textSecondary,
                marginTop: 4,
              }}
            >
              {m.sub}
              {m.topic && ` · ${m.topic}`}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  参会人
                </span>
                <div style={{ display: "inline-flex", alignItems: "center" }}>
                  {m.participants.map((id, i) => (
                    <span
                      key={id}
                      style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 10 - i }}
                    >
                      <WAvatar id={id} size={28} ring={W_TOKENS.surface} />
                    </span>
                  ))}
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: W_TOKENS.textMuted,
                    marginLeft: 4,
                  }}
                >
                  {m.participants.length} 人
                </span>
              </div>
              <div
                style={{ width: 1, height: 16, background: W_TOKENS.border }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  AI
                </span>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {m.ais.map((id) => {
                    const a = W_AGENTS.find((x) => x.id === id);
                    if (!a) return null;
                    return (
                      <Link
                        key={id}
                        href={`/workstation/agent/${id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 9px 2px 3px",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.04)",
                          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                          textDecoration: "none",
                          color: W_TOKENS.textPrimary,
                          transition: "background 140ms ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "rgba(124,92,250,0.10)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            "rgba(255,255,255,0.04)";
                        }}
                      >
                        <WAIBadge id={id} size={18} radius={5} />
                        <span style={{ fontSize: 11.5, fontWeight: 500 }}>
                          {a.name}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <WButton variant="ghost" size="md" icon="doc">
              导出纪要
            </WButton>
            <WButton
              variant="primary"
              size="md"
              icon="sparkle"
              iconRight="arr-r"
              onClick={() => router.push("/workstation/new")}
            >
              再开同款
            </WButton>
          </div>
        </div>
      </div>
    </>
  );
}

const backLink = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  color: W_TOKENS.textMuted,
  fontSize: 13,
  padding: "4px 0",
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 5,
  marginBottom: 12,
};

// ════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════
function MeetingTabs({
  tab,
  onChange,
  counts,
}: {
  tab: TabId;
  onChange: (t: TabId) => void;
  counts: TabCounts;
}) {
  const TABS: { id: TabId; label: string; count?: number; tone?: string }[] = [
    { id: "overview", label: "概览" },
    { id: "caption", label: "字幕", count: counts.captions },
    { id: "decision", label: "决策", count: counts.decisions, tone: "#86EFAC" },
    { id: "action", label: "行动项", count: counts.actions, tone: "#FCD34D" },
    { id: "material", label: "资料", count: counts.materials },
    { id: "cite", label: "AI 引用", count: counts.citations, tone: "#C4B5FD" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 22,
        borderBottom: `0.5px solid ${W_TOKENS.border}`,
        paddingBottom: 0,
        flexWrap: "wrap",
      }}
    >
      {TABS.map((t) => {
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "10px 14px",
              position: "relative",
              color: on ? W_TOKENS.textPrimary : W_TOKENS.textMuted,
              fontSize: 14,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "color 140ms ease",
            }}
            onMouseEnter={(e) => {
              if (!on) e.currentTarget.style.color = W_TOKENS.textSecondary;
            }}
            onMouseLeave={(e) => {
              if (!on) e.currentTarget.style.color = W_TOKENS.textMuted;
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                style={{
                  fontSize: 11,
                  color: t.tone || W_TOKENS.textMuted,
                  background: t.tone
                    ? `${t.tone}1A`
                    : "rgba(255,255,255,0.06)",
                  padding: "0 6px",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: "17px",
                }}
              >
                {t.count}
              </span>
            )}
            {on && (
              <span
                style={{
                  position: "absolute",
                  left: 6,
                  right: 6,
                  bottom: -1,
                  height: 2,
                  background: W_TOKENS.accent,
                  borderRadius: 2,
                  boxShadow: "0 0 8px rgba(124,92,250,0.50)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════
// OVERVIEW PANE
// ════════════════════════════════════════════
function OverviewPane({
  m,
  citations,
  onJumpTab,
}: {
  m: WMeetingDetail;
  citations: MCitation[];
  onJumpTab: (t: TabId) => void;
}) {
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}
    >
      <div>
        {/* Mira summary card */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 14,
            background:
              "linear-gradient(135deg, #15102f 0%, #1c1538 50%, #251a40 100%)",
            boxShadow:
              "0 8px 22px rgba(124,92,250,0.16), inset 0 0 0 0.5px rgba(124,92,250,0.20)",
            padding: "18px 20px",
            marginBottom: 14,
          }}
        >
          <WSparkle x={26} y={14} size={10} opacity={0.85} />
          <WSparkle x={62} y={38} size={6} opacity={0.55} />
          <WSparkle x="85%" y={26} size={9} opacity={0.7} />

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 12,
            }}
          >
            <WAIBadge id="MIRA" size={26} radius={7} />
            <div>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.65)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Mira · 会议简报
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  marginTop: 1,
                }}
              >
                这场会做了什么 · 60s 读完
              </div>
            </div>
          </div>
          <div
            style={{
              position: "relative",
              fontSize: 13.5,
              color: "rgba(255,255,255,0.90)",
              lineHeight: 1.65,
            }}
          >
            {m.summary}
          </div>
          <div
            style={{
              position: "relative",
              marginTop: 14,
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            {[
              { v: m.summaryStats.decisions, l: "决策", tone: "#86EFAC" },
              { v: m.summaryStats.actions, l: "行动项", tone: "#FCD34D" },
              { v: m.summaryStats.citations, l: "AI 引用", tone: "#C4B5FD" },
              { v: m.summaryStats.memoriesCreated, l: "新记忆", tone: "#FF99B6" },
            ].map((s, i) => (
              <div key={i}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: s.tone,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: -0.5,
                    lineHeight: 1,
                  }}
                >
                  {s.v}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.55)",
                    marginTop: 4,
                  }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agenda timeline */}
        {m.agenda.length > 0 && (
          <>
            <h3 style={paneTitle}>议程进度</h3>
            <WCard padding={16}>
              {m.agenda.map((a, i) => (
                <AgendaStep
                  key={a.id}
                  a={a}
                  last={i === m.agenda.length - 1}
                />
              ))}
            </WCard>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <QuickList
          icon="check"
          iconColor="#86EFAC"
          title="决策"
          count={m.decisions.length}
          onMore={() => onJumpTab("decision")}
        >
          {m.decisions.slice(0, 3).map((d) => (
            <div key={d.id} style={listRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: W_TOKENS.textPrimary,
                    lineHeight: 1.4,
                  }}
                >
                  {d.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                    marginTop: 3,
                  }}
                >
                  {d.when} · {W_HUMANS[d.by]?.name || d.by} 拍板
                </div>
              </div>
            </div>
          ))}
          {m.decisions.length === 0 && <EmptyHintRow text="本场无决策记录" />}
        </QuickList>

        <QuickList
          icon="task"
          iconColor="#FCD34D"
          title="行动项"
          count={m.actions.length}
          onMore={() => onJumpTab("action")}
        >
          {m.actions.map((a) => (
            <div key={a.id} style={listRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: W_TOKENS.textPrimary,
                    lineHeight: 1.4,
                  }}
                >
                  {a.text}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textMuted,
                    marginTop: 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <WAvatar id={a.assignee} size={13} />
                  {W_HUMANS[a.assignee]?.name || a.assignee} · 截止 {a.due}
                </div>
              </div>
            </div>
          ))}
          {m.actions.length === 0 && <EmptyHintRow text="本场无行动项" />}
        </QuickList>

        <QuickList
          icon="sparkle"
          iconColor="#C4B5FD"
          title="AI 引用"
          count={citations.length}
          onMore={() => onJumpTab("cite")}
        >
          {citations.slice(0, 3).map((c, i) => {
            const ai = W_AGENTS.find((x) => x.id === c.ai);
            return (
              <div key={i} style={listRow}>
                <WAIBadge id={c.ai} size={20} radius={6} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ fontSize: 12, color: W_TOKENS.textPrimary }}
                  >
                    {ai?.name || c.ai} 引用了
                    <span
                      style={{
                        color:
                          c.source.kind === "kb"
                            ? W_TOKENS.cyan
                            : "#C4B5FD",
                        marginLeft: 4,
                      }}
                    >
                      {c.source.kind === "kb" ? "书架" : "记忆"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: W_TOKENS.textMuted,
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.t} · {c.source.text}
                  </div>
                </div>
              </div>
            );
          })}
          {citations.length === 0 && <EmptyHintRow text="本场无 AI 引用" />}
        </QuickList>
      </div>
    </div>
  );
}

function EmptyHintRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        fontSize: 12,
        color: W_TOKENS.textFaint,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function QuickList({
  icon,
  iconColor,
  title,
  count,
  onMore,
  children,
}: {
  icon: "check" | "task" | "sparkle";
  iconColor: string;
  title: string;
  count: number;
  onMore: () => void;
  children: React.ReactNode;
}) {
  return (
    <WCard padding={0}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "12px 14px",
          borderBottom: `0.5px solid ${W_TOKENS.border}`,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: `${iconColor}15`,
            boxShadow: `inset 0 0 0 0.5px ${iconColor}40`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <WIcon name={icon} size={13} color={iconColor} />
        </div>
        <span
          style={{ fontSize: 13, fontWeight: 700, color: W_TOKENS.textPrimary }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11,
            color: W_TOKENS.textMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onMore}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            color: "#C4B5FD",
            fontSize: 11.5,
            fontWeight: 600,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          查看 <WIcon name="chev" size={11} stroke={2.2} />
        </button>
      </div>
      <div>{children}</div>
    </WCard>
  );
}

const listRow = {
  display: "flex" as const,
  alignItems: "flex-start" as const,
  gap: 9,
  padding: "10px 14px",
  borderBottom: `0.5px solid ${W_TOKENS.border}`,
};

const paneTitle = {
  margin: "0 0 12px",
  fontSize: 15,
  fontWeight: 700,
  color: W_TOKENS.textPrimary,
  letterSpacing: -0.2,
};

function AgendaStep({ a, last }: { a: MAgenda; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        paddingBottom: last ? 0 : 12,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 20,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: a.done ? "#22c55e" : "transparent",
            boxShadow: a.done
              ? "none"
              : `inset 0 0 0 1.5px ${W_TOKENS.borderHover}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
          }}
        >
          {a.done && <WIcon name="check" size={11} color="#fff" stroke={3} />}
        </div>
        {!last && (
          <div
            style={{
              flex: 1,
              width: 2,
              marginTop: 2,
              background: "#22c55e44",
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, paddingTop: 2 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: W_TOKENS.textPrimary,
          }}
        >
          {a.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 2,
          }}
        >
          已完成 · {a.minutes} 分钟
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// CAPTIONS
// ════════════════════════════════════════════
function CaptionsPane({ m }: { m: WMeetingDetail }) {
  const [filter, setFilter] = useState<"all" | "human" | "ai">("all");
  const captions = m.captions.filter((c) => {
    if (filter === "all") return true;
    if (filter === "human") return c.kind === "human";
    return c.kind === "ai" || c.kind === "ai-host";
  });

  const humanCount = m.captions.filter((c) => c.kind === "human").length;
  const aiCount = m.captions.filter(
    (c) => c.kind === "ai" || c.kind === "ai-host",
  ).length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: W_TOKENS.surface,
            borderRadius: 9,
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          }}
        >
          {[
            { id: "all" as const, label: "全部 " + m.captions.length },
            { id: "human" as const, label: "人类 " + humanCount },
            { id: "ai" as const, label: "AI " + aiCount },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              style={{
                height: 28,
                padding: "0 11px",
                borderRadius: 6,
                border: "none",
                background:
                  filter === t.id ? "rgba(124,92,250,0.14)" : "transparent",
                color:
                  filter === t.id ? "#C4B5FD" : W_TOKENS.textSecondary,
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <WButton variant="ghost" size="sm" icon="doc">
          下载逐字稿
        </WButton>
      </div>

      <WCard padding={0}>
        {captions.map((c, i) => (
          <CaptionRow key={i} c={c} last={i === captions.length - 1} />
        ))}
        {captions.length === 0 && (
          <div
            style={{
              padding: 24,
              color: W_TOKENS.textMuted,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            本场会议字幕尚未生成
          </div>
        )}
      </WCard>
    </div>
  );
}

function CaptionRow({ c, last }: { c: MCaption; last: boolean }) {
  const isAI = c.kind === "ai" || c.kind === "ai-host";
  const speaker = isAI
    ? W_AGENTS.find((x) => x.id === c.who)
    : W_HUMANS[c.who];
  return (
    <div
      style={{
        display: "flex",
        gap: 13,
        padding: "14px 18px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <span
        style={{
          flex: "0 0 64px",
          fontSize: 11.5,
          color: W_TOKENS.textFaint,
          fontFamily: "monospace",
          fontVariantNumeric: "tabular-nums",
          paddingTop: 5,
        }}
      >
        {c.t.slice(0, 8)}
      </span>

      <div style={{ flexShrink: 0 }}>
        {isAI ? (
          <Link href={`/workstation/agent/${c.who}`}>
            <WAIBadge id={c.who} size={26} radius={7} />
          </Link>
        ) : (
          <WAvatar id={c.who} size={26} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: W_TOKENS.textPrimary,
            }}
          >
            {speaker?.name || c.who}
          </span>
          {c.kind === "ai-host" && <WPill tone="warn">主持人</WPill>}
          {c.kind === "ai" && <WPill tone="accent">AI</WPill>}
          {c.agenda && <WPill tone="neutral">议程 {c.agenda}</WPill>}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 13.5,
            color: W_TOKENS.textPrimary,
            lineHeight: 1.55,
          }}
        >
          {c.text}
        </div>
        {c.cites && c.cites.length > 0 && (
          <div
            style={{
              marginTop: 9,
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            {c.cites.map((src, i) => (
              <CitePreview key={i} aiId={c.who} src={src} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitePreview({
  aiId,
  src,
}: {
  aiId: string;
  src: { kind: "kb" | "memory"; label: string; text: string };
}) {
  const isKB = src.kind === "kb";
  const color = isKB ? W_TOKENS.cyan : "#C4B5FD";
  return (
    <Link
      href={`/workstation/agent/${aiId}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 11px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}, inset 2px 0 0 ${color}`,
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      <WIcon name={isKB ? "doc" : "brain"} size={13} color={color} stroke={2} />
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: W_TOKENS.textSecondary,
          lineHeight: 1.5,
        }}
      >
        <span style={{ color, fontWeight: 600, marginRight: 5 }}>
          引用 · {src.label}
        </span>
        {src.text}
      </span>
    </Link>
  );
}

// ════════════════════════════════════════════
// DECISIONS
// ════════════════════════════════════════════
function DecisionsPane({ m }: { m: WMeetingDetail }) {
  return (
    <div>
      <div
        style={{
          marginBottom: 14,
          padding: "11px 14px",
          borderRadius: 10,
          background: "rgba(34,197,94,0.06)",
          boxShadow: "inset 0 0 0 0.5px rgba(34,197,94,0.25)",
          fontSize: 12.5,
          color: "#86EFAC",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <WIcon name="check" size={13} stroke={2.2} color="#86EFAC" />
        会议产生{" "}
        <strong style={{ color: W_TOKENS.textPrimary, margin: "0 4px" }}>
          {m.decisions.length}
        </strong>{" "}
        个决策 · 全部已记入长期记忆
      </div>
      <WCard padding={0}>
        {m.decisions.map((d, i) => (
          <DecisionRow
            key={d.id}
            d={d}
            last={i === m.decisions.length - 1}
          />
        ))}
        {m.decisions.length === 0 && (
          <div
            style={{
              padding: 24,
              color: W_TOKENS.textMuted,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            本场无决策记录
          </div>
        )}
      </WCard>
    </div>
  );
}

function DecisionRow({ d, last }: { d: MDecision; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 13,
        padding: "14px 18px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(34,197,94,0.16)",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "inset 0 0 0 1px rgba(34,197,94,0.40)",
        }}
      >
        <WIcon name="check" size={14} stroke={2.6} color="#86EFAC" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 600,
            color: W_TOKENS.textPrimary,
            lineHeight: 1.4,
          }}
        >
          {d.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <WAvatar id={d.by} size={14} />
            {W_HUMANS[d.by]?.name || d.by} 拍板
          </span>
          <span>· {d.when}</span>
          {d.from && (
            <>
              <span>·</span>
              <span style={{ color: "#C4B5FD" }}>{d.from}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════
function ActionsPane({ m }: { m: WMeetingDetail }) {
  return (
    <WCard padding={0}>
      {m.actions.map((a, i) => (
        <ActionRow key={a.id} a={a} last={i === m.actions.length - 1} />
      ))}
      {m.actions.length === 0 && (
        <div
          style={{
            padding: 24,
            color: W_TOKENS.textMuted,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          本场无行动项
        </div>
      )}
    </WCard>
  );
}

function ActionRow({ a, last }: { a: MAction; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 18px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          boxShadow: `inset 0 0 0 1.5px ${W_TOKENS.borderHover}`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: W_TOKENS.textPrimary,
            fontWeight: 500,
          }}
        >
          {a.text}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <WAvatar id={a.assignee} size={13} />
          <span>{W_HUMANS[a.assignee]?.name || a.assignee}</span>
          <span>· 截止 {a.due}</span>
          {a.from && (
            <>
              <span>·</span>
              <span style={{ color: "#86EFAC" }}>来自决策</span>
            </>
          )}
        </div>
      </div>
      <WPill tone="warn">进行中</WPill>
    </div>
  );
}

// ════════════════════════════════════════════
// MATERIALS
// ════════════════════════════════════════════
function MaterialsPane({ m }: { m: WMeetingDetail }) {
  if (m.materials.length === 0) {
    return (
      <WCard>
        <div
          style={{
            padding: 24,
            color: W_TOKENS.textMuted,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          本场无资料上传
        </div>
      </WCard>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {m.materials.map((f) => (
        <MatCard key={f.id} f={f} />
      ))}
    </div>
  );
}

function MatCard({ f }: { f: MMaterial }) {
  const TYPE_COLOR: Record<string, string> = {
    pdf: "#E5453A",
    word: "#2B579A",
    md: "#71717a",
    excel: "#1F7244",
    ppt: "#D24726",
  };
  const TYPE_LABEL: Record<string, string> = {
    pdf: "PDF",
    word: "Word",
    md: "MD",
    excel: "Excel",
    ppt: "PPT",
  };
  return (
    <WCard hover padding={14}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <div
          style={{
            width: 42,
            height: 50,
            borderRadius: 6,
            flexShrink: 0,
            background: TYPE_COLOR[f.type] + "20",
            boxShadow: `inset 0 0 0 1px ${TYPE_COLOR[f.type]}40`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <WIcon name="doc" size={17} color={TYPE_COLOR[f.type]} stroke={1.6} />
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: TYPE_COLOR[f.type],
              letterSpacing: 0.3,
            }}
          >
            {TYPE_LABEL[f.type]}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: W_TOKENS.textPrimary,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </span>
            {!f.pre && <WPill tone="warn">会中</WPill>}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: W_TOKENS.textMuted,
              marginTop: 4,
            }}
          >
            {f.size} · {f.pages ? f.pages + " 页" : (f.rows || 0).toLocaleString() + " 行"}
          </div>
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `0.5px solid ${W_TOKENS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: W_TOKENS.textMuted,
              }}
            >
              <WAvatar id={f.by} size={13} />
              {W_HUMANS[f.by]?.name || f.by} · {f.when}
            </span>
            <WPill tone="cyan">被 AI 引用 {f.cited}</WPill>
          </div>
        </div>
      </div>
    </WCard>
  );
}

// ════════════════════════════════════════════
// CITATIONS (AI 引用闭环)
// ════════════════════════════════════════════
function CitationsPane({
  citations,
}: {
  citations: MCitation[];
}) {
  const kbCount = citations.filter((c) => c.source.kind === "kb").length;
  const memCount = citations.filter((c) => c.source.kind === "memory").length;

  return (
    <div>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 12,
          marginBottom: 18,
          background:
            "linear-gradient(135deg, #15102f 0%, #1a1335 50%, #221940 100%)",
          boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.20)",
          padding: "13px 16px",
          display: "flex",
          alignItems: "center",
          gap: 11,
        }}
      >
        <WSparkle x={42} y={12} size={9} opacity={0.85} />
        <WSparkle x={86} y={32} size={5} opacity={0.55} />
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "rgba(255,255,255,0.10)",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
          }}
        >
          <WIcon name="link" size={15} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            AI 引用追溯
          </div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            本场会议 AI 共引用{" "}
            <strong style={{ color: "#C4B5FD" }}>{citations.length}</strong> 次 ·
            涉及{" "}
            <strong style={{ color: W_TOKENS.cyan }}>{kbCount}</strong>{" "}
            条书架资料 +
            <strong style={{ color: "#C4B5FD" }}> {memCount}</strong>{" "}
            条长期记忆
          </div>
        </div>
      </div>

      {citations.length === 0 ? (
        <WCard>
          <div
            style={{
              padding: 24,
              color: W_TOKENS.textMuted,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            本场无 AI 引用
          </div>
        </WCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {citations.map((c, i) => (
            <CitationCard key={i} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CitationCard({ c }: { c: MCitation }) {
  const ai = W_AGENTS.find((x) => x.id === c.ai);
  const isKB = c.source.kind === "kb";
  const color = isKB ? W_TOKENS.cyan : "#C4B5FD";
  return (
    <WCard padding={0}>
      <div
        style={{
          padding: "12px 16px",
          background: `linear-gradient(90deg, ${color}0A, transparent)`,
          borderBottom: `0.5px solid ${W_TOKENS.border}`,
          display: "flex",
          alignItems: "center",
          gap: 11,
        }}
      >
        <Link
          href={`/workstation/agent/${c.ai}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            textDecoration: "none",
          }}
        >
          <WAIBadge id={c.ai} size={28} radius={7} />
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
            }}
          >
            {ai?.name || c.ai}
          </span>
        </Link>
        <WPill tone={isKB ? "cyan" : "accent"}>
          {isKB ? "引用书架" : "引用记忆"}
        </WPill>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            fontFamily: "monospace",
          }}
        >
          {c.t}
        </span>
        {c.agenda && (
          <span
            style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}
          >
            · 议程 {c.agenda}
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderRight: `0.5px solid ${W_TOKENS.border}`,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: W_TOKENS.textMuted,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 7,
            }}
          >
            AI 当时说
          </div>
          <div
            style={{
              fontSize: 13,
              color: W_TOKENS.textPrimary,
              lineHeight: 1.55,
            }}
          >
            &ldquo;{c.said}&rdquo;
          </div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 7,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color,
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {isKB ? "引用书架" : "引用长期记忆"}
            </div>
            <Link
              href={`/workstation/agent/${c.ai}`}
              style={{
                color,
                fontSize: 11.5,
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              查看原文
              <WIcon name="arr-r" size={11} stroke={2.2} color={color} />
            </Link>
          </div>
          <div
            style={{
              fontSize: 13,
              color: W_TOKENS.textPrimary,
              lineHeight: 1.55,
              padding: "8px 11px",
              borderRadius: 7,
              background: `${color}0A`,
              boxShadow: `inset 0 0 0 0.5px ${color}30, inset 2px 0 0 ${color}`,
            }}
          >
            {c.source.text}
          </div>
        </div>
      </div>
    </WCard>
  );
}
