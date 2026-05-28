"use client";

/**
 * R5.D Web 会议室 右侧栏 (340px):
 *  - MiraLive — Mira 当下 (焦点 / 议程剩余 / 偏离风险 / 正在说) + 问主持人 CTA
 *  - DecisionPool — 决策 (已确认 / 待确认), 真接 consensus
 *  - ActionList — 行动项 (含 owner 头像 + 截止), 真接 action-items
 *  - ParkingLotPanel — 偏离时记入的待办 (backend 待 ship, 演示数据)
 *  - ReferencesPanel — doc / data / mtg 3 类参考 (backend 待 ship, 演示数据)
 *
 * 设计源: `meeting-room-web.jsx:719-961`.
 *
 * v1.4.0 Sprint S3 真接 (PM 拍 风险阶梯 第一, 客户冲击最大):
 *  - MiraLive 3 row (当前焦点 / 议程剩余 / 偏离风险) 真接 agenda-progress + timeline
 *  - "正在说" 留 mock (需 latest agentMessage 流, V1.5 saga)
 *  - DecisionPool 真接 /api/meetings/<id>/consensus (替 MR_DECISIONS)
 *  - ActionList 真接 /api/meetings/<id>/actions (替 MR_ACTIONS)
 *  - ParkingLot + References 留 mock + fallback pill "演示数据 · 后端待 ship" (反幻觉 § 7.5)
 */

import { useEffect, useState } from "react";
import { api, type AgendaProgress, type TimelineEvent, type MeetingConsensus, type ActionItem } from "@/lib/api";
import {
  MR_HOST,
  MR_PARKING,
  MR_REFS,
  MR_AGENTS_IN_MEETING,
  MR_HUMANS_IN_MEETING,
} from "./data";
import {
  MRHostAvatar,
  MRAIAvatar,
  MRHumanAvatar,
  MRIcon,
  MRSectionLabel,
  type MRIconName,
} from "./atoms";
import { MR_TOKENS } from "./tokens";

export function MRRightPanel({ meetingId }: { meetingId: string }) {
  // v1.4.0 Sprint S3 真接 — 3 useEffect 并行拉 (allSettled, 任一挂不影响别的)
  const [agendaP, setAgendaP] = useState<AgendaProgress | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [consensus, setConsensus] = useState<MeetingConsensus[] | null>(null);
  const [actions, setActions] = useState<ActionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [agendaErr, setAgendaErr] = useState(false);
  const [consensusErr, setConsensusErr] = useState(false);
  const [actionsErr, setActionsErr] = useState(false);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;

    const fetchAll = () => {
      Promise.allSettled([
        api.getAgendaProgress(meetingId),
        api.getMeetingTimeline(meetingId),
        api.listMeetingConsensus(meetingId),
        api.listActionItems(meetingId),
      ]).then(([apR, tlR, csR, acR]) => {
        if (cancelled) return;
        if (apR.status === "fulfilled") setAgendaP(apR.value);
        else setAgendaErr(true);
        if (tlR.status === "fulfilled") setTimeline(tlR.value.events);
        // timeline 挂 不致命 (drift 显默认 "低" 即可)
        if (csR.status === "fulfilled") setConsensus(csR.value);
        else setConsensusErr(true);
        if (acR.status === "fulfilled") setActions(acR.value);
        else setActionsErr(true);
        setLoading(false);
      });
    };

    fetchAll();
    // 跟 R5.D 现有 2.5s 轮询 节奏 一致 (Phase D · #17 才换 WS)
    const id = setInterval(fetchAll, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meetingId]);

  return (
    // v1.4.0 舞台中央 (PM 拍 2026-05-27): 改 #F2F2F7 跟 LeftPanel 对齐, 衬出 center 白岛.
    <div
      style={{
        width: 340,
        background: MR_TOKENS.bgChip,
        borderLeft: MR_TOKENS.borderHair,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div className="mr-scroll" style={{ flex: 1, overflow: "auto", padding: "18px 16px" }}>
        <MiraLive agendaP={agendaP} timeline={timeline} loading={loading} err={agendaErr} />
        <div style={{ height: 18 }} />
        <DecisionPool consensus={consensus} loading={loading} err={consensusErr} />
        <div style={{ height: 18 }} />
        <ActionList actions={actions} loading={loading} err={actionsErr} />
        <div style={{ height: 18 }} />
        <ParkingLotPanel />
        <div style={{ height: 18 }} />
        <ReferencesPanel />
      </div>
    </div>
  );
}

// ────────────── Mira Live ──────────────
/** 议程剩余 = time_budget_min - elapsed_seconds/60. fallback to 默认 5 分. */
function calcRemaining(agendaP: AgendaProgress | null): { text: string; tone: "warn" | "muted" } {
  if (!agendaP || agendaP.current_idx == null) {
    return { text: "—", tone: "muted" };
  }
  const cur = agendaP.items.find((it) => it.idx === agendaP.current_idx);
  if (!cur) return { text: "—", tone: "muted" };
  const budgetSec = (cur.time_budget_min ?? 5) * 60;
  const elapsed = cur.elapsed_seconds ?? 0;
  const remain = Math.max(0, budgetSec - elapsed);
  const m = Math.floor(remain / 60);
  const s = Math.floor(remain % 60);
  return {
    text: `${m} 分 ${s.toString().padStart(2, "0")} 秒`,
    tone: remain < 60 ? "warn" : "muted",
  };
}

/** 偏离风险 — 看 timeline 最近 5 个 event 里 是否含 off_topic / stuck. */
function calcDrift(timeline: TimelineEvent[] | null): { text: string; color: string } {
  if (!timeline) return { text: "低 ✓", color: "#34C759" };
  const recent = timeline.slice(-5);
  const hasDrift = recent.some((e) => e.kind === "off_topic" || e.kind === "stuck");
  if (hasDrift) return { text: "高 ⚠", color: "#FF3B30" };
  return { text: "低 ✓", color: "#34C759" };
}

function MiraLive({
  agendaP,
  timeline,
  loading,
  err,
}: {
  agendaP: AgendaProgress | null;
  timeline: TimelineEvent[] | null;
  loading: boolean;
  err: boolean;
}) {
  const curItem =
    agendaP?.items.find((it) => it.idx === agendaP.current_idx) ?? null;
  const focusText = curItem
    ? `议程 ${curItem.idx + 1} · ${curItem.title}`
    : loading
      ? "加载中…"
      : "—";
  const remain = calcRemaining(agendaP);
  const drift = calcDrift(timeline);

  return (
    <div>
      <MRSectionLabel>Mira 当下</MRSectionLabel>
      {err && (
        <div
          data-testid="mr-mira-fallback-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: "#FF9F0A",
            background: "rgba(255,159,10,0.12)",
            padding: "2px 7px",
            borderRadius: 4,
            marginBottom: 6,
          }}
        >
          API 失败 · 演示数据
        </div>
      )}
      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.13))",
          border: "0.5px solid rgba(255,159,10,0.30)",
          borderRadius: 12,
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 9,
          }}
        >
          <MRHostAvatar size={28} />
          <div style={{ flex: 1, lineHeight: 1.15 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: MR_TOKENS.fgPrimary }}>{MR_HOST.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "#34C759",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#34C759",
                  animation: "mrLivePulse 1.4s ease-in-out infinite",
                }}
              />
              监测中
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <LiveRow label="当前焦点" value={focusText} />
          <LiveRow
            label="议程剩余"
            value={remain.text}
            valueColor={remain.tone === "warn" ? "#FF3B30" : "#FF9F0A"}
          />
          <LiveRow label="偏离风险" value={drift.text} valueColor={drift.color} />
          <LiveRow label="正在说" value="王俊 · 1:24" demoMock />
        </div>
        <button
          type="button"
          style={{
            marginTop: 10,
            width: "100%",
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #FFB340, #FF9F0A)",
            border: "none",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <MRIcon name="compass" size={13} color="#fff" /> 问主持人
        </button>
      </div>
    </div>
  );
}

function LiveRow({
  label,
  value,
  valueColor,
  demoMock,
}: {
  label: string;
  value: string;
  valueColor?: string;
  /** v1.4.0 Sprint S3: 反幻觉 § 7.5 — "正在说" 暂留 mock, 标 "演示" */
  demoMock?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        padding: "3px 0",
      }}
    >
      <span
        style={{
          color: MR_TOKENS.fgTertiary,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {label}
        {demoMock && (
          <span
            data-testid="mr-mira-demo-mock"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "#FF9F0A",
              background: "rgba(255,159,10,0.14)",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            演示
          </span>
        )}
      </span>
      <span style={{ color: valueColor ?? MR_TOKENS.fgPrimary, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ────────────── Decision Pool ──────────────
function DecisionPool({
  consensus,
  loading,
  err,
}: {
  consensus: MeetingConsensus[] | null;
  loading: boolean;
  err: boolean;
}) {
  const items = consensus ?? [];
  const count = items.length;

  return (
    <div>
      <MRSectionLabel right={loading ? "加载中…" : `${count} 条`}>
        决策池
      </MRSectionLabel>
      {err && (
        <div
          data-testid="mr-decision-fallback-pill"
          style={{
            display: "inline-flex",
            fontSize: 10,
            fontWeight: 600,
            color: "#FF9F0A",
            background: "rgba(255,159,10,0.12)",
            padding: "2px 7px",
            borderRadius: 4,
            marginBottom: 6,
          }}
        >
          API 失败 · 演示数据
        </div>
      )}
      {!err && !loading && count === 0 && (
        <div
          data-testid="mr-decision-empty"
          style={{
            background: MR_TOKENS.bgSurface,
            border: MR_TOKENS.borderHair,
            borderRadius: 10,
            padding: "16px 12px",
            textAlign: "center",
            fontSize: 12,
            color: MR_TOKENS.fgTertiary,
          }}
        >
          暂无决策 · AI 圆桌 收敛后 自动 沉淀
        </div>
      )}
      {count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((d) => {
            const status = d.needs_human_review ? "pending" : "confirmed";
            const t = d.reviewed_at
              ? fmtTime(d.reviewed_at)
              : fmtTime(d.created_at);
            return (
              <div
                key={d.id}
                style={{
                  background: MR_TOKENS.bgSurface,
                  borderRadius: 10,
                  border: MR_TOKENS.borderHair,
                  padding: "10px 11px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      color: status === "confirmed" ? "#34C759" : "#FF9F0A",
                      background:
                        status === "confirmed"
                          ? "rgba(52,199,89,0.12)"
                          : "rgba(255,159,10,0.12)",
                      padding: "2px 6px",
                      borderRadius: 3,
                    }}
                  >
                    {status === "confirmed" ? "已确认" : "待确认"}
                  </span>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: "#5E5CE6",
                      background: "rgba(94,92,230,0.10)",
                      padding: "2px 6px",
                      borderRadius: 3,
                    }}
                  >
                    议程 {d.agenda_idx + 1}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10.5,
                      color: MR_TOKENS.fgQuaternary,
                    }}
                  >
                    {t}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: MR_TOKENS.fgPrimary,
                    lineHeight: 1.4,
                  }}
                >
                  {d.consensus_md
                    ? truncate(d.consensus_md, 80)
                    : d.agenda_title ?? "(未填)"}
                </div>
                {d.dissents.length > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#FF9F0A",
                      marginTop: 3,
                    }}
                  >
                    ⚠ {d.dissents.length} 处 分歧
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────── Action List ──────────────
function ActionList({
  actions,
  loading,
  err,
}: {
  actions: ActionItem[] | null;
  loading: boolean;
  err: boolean;
}) {
  const items = actions ?? [];
  const count = items.length;

  return (
    <div>
      <MRSectionLabel right={loading ? "加载中…" : `${count} 项`}>
        行动项
      </MRSectionLabel>
      {err && (
        <div
          data-testid="mr-action-fallback-pill"
          style={{
            display: "inline-flex",
            fontSize: 10,
            fontWeight: 600,
            color: "#FF9F0A",
            background: "rgba(255,159,10,0.12)",
            padding: "2px 7px",
            borderRadius: 4,
            marginBottom: 6,
          }}
        >
          API 失败 · 演示数据
        </div>
      )}
      {!err && !loading && count === 0 && (
        <div
          data-testid="mr-action-empty"
          style={{
            background: MR_TOKENS.bgSurface,
            border: MR_TOKENS.borderHair,
            borderRadius: 10,
            padding: "16px 12px",
            textAlign: "center",
            fontSize: 12,
            color: MR_TOKENS.fgTertiary,
          }}
        >
          暂无行动项 · AI 抽到 任务 后 自动 加入
        </div>
      )}
      {count > 0 && (
        <div
          style={{
            background: MR_TOKENS.bgSurface,
            borderRadius: 10,
            border: MR_TOKENS.borderHair,
            overflow: "hidden",
          }}
        >
          {items.map((a, i) => {
            // 优先 显 agent (NORTH_STAR § 3.4 — agent 是 任务真正的主人), fallback assignee_name
            const ownerName = a.assignee_agent_name ?? a.assignee_name ?? a.assignee_name_hint ?? "(未指派)";
            const ownerKey = a.assignee_agent_id ?? a.assignee_user_id ?? "";
            const isAI = !!ownerKey && !!MR_AGENTS_IN_MEETING[ownerKey];
            const isHuman = !!ownerKey && !!MR_HUMANS_IN_MEETING[ownerKey];
            return (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 11px",
                  borderTop:
                    i === 0 ? "none" : `0.5px solid ${MR_TOKENS.divider}`,
                }}
              >
                {isAI && <MRAIAvatar id={ownerKey} size={22} />}
                {isHuman && <MRHumanAvatar id={ownerKey} size={22} />}
                {!isAI && !isHuman && (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: a.assignee_agent_color ?? MR_TOKENS.fgQuaternary,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {ownerName[0]}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: MR_TOKENS.fgPrimary,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.content}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: MR_TOKENS.fgTertiary,
                      marginTop: 1,
                      display: "flex",
                      gap: 6,
                    }}
                  >
                    <span>{ownerName}</span>
                    {a.due_at && (
                      <>
                        <span>·</span>
                        <span style={{ fontWeight: 600, color: "#FF9F0A" }}>
                          截止 {fmtDateShort(a.due_at)}
                        </span>
                      </>
                    )}
                    {a.status === "done" && (
                      <>
                        <span>·</span>
                        <span style={{ color: "#34C759", fontWeight: 600 }}>
                          已完成
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────── Parking Lot (mock, backend 待 ship) ──────────────
function ParkingLotPanel() {
  return (
    <div>
      <MRSectionLabel right={`${MR_PARKING.length} 项`}>Parking Lot</MRSectionLabel>
      {/* v1.4.0 Sprint S3: backend 无 endpoint, 留 mock + fallback pill (反幻觉 § 7.5) */}
      <div
        data-testid="mr-parking-fallback-pill"
        style={{
          display: "inline-flex",
          fontSize: 10,
          fontWeight: 600,
          color: "#FF9F0A",
          background: "rgba(255,159,10,0.12)",
          padding: "2px 7px",
          borderRadius: 4,
          marginBottom: 6,
        }}
      >
        演示数据 · 后端待 ship
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {MR_PARKING.map((p) => {
          const human = MR_HUMANS_IN_MEETING[p.from];
          const fromName = human ? human.name : p.from;
          return (
            <div
              key={p.id}
              style={{
                background: MR_TOKENS.bgSurface,
                borderRadius: 10,
                border: "0.5px dashed rgba(60,60,67,0.30)",
                padding: "9px 11px",
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  color: MR_TOKENS.fgPrimary,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {p.title}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: MR_TOKENS.fgTertiary,
                  marginTop: 3,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>{fromName}</span>
                <span>·</span>
                <span>{p.at}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    color: "#007AFF",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  立即讨论
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────── References (mock, backend 待 ship) ──────────────
function ReferencesPanel() {
  const iconFor: Record<string, MRIconName> = {
    doc: "note",
    data: "sparkle",
    mtg: "clock",
  };
  const colorFor: Record<string, string> = {
    doc: "#34C759",
    data: "#5E5CE6",
    mtg: "#0A84FF",
  };
  return (
    <div>
      <MRSectionLabel right="管理 →">相关参考</MRSectionLabel>
      {/* v1.4.0 Sprint S3: backend 无 generic refs endpoint, 留 mock + fallback pill */}
      <div
        data-testid="mr-references-fallback-pill"
        style={{
          display: "inline-flex",
          fontSize: 10,
          fontWeight: 600,
          color: "#FF9F0A",
          background: "rgba(255,159,10,0.12)",
          padding: "2px 7px",
          borderRadius: 4,
          marginBottom: 6,
        }}
      >
        演示数据 · 后端待 ship
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {MR_REFS.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 11px",
              borderRadius: 10,
              background: MR_TOKENS.bgSurface,
              border: MR_TOKENS.borderHair,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: colorFor[r.kind] + "18",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MRIcon name={iconFor[r.kind]} size={13} color={colorFor[r.kind]} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: MR_TOKENS.fgPrimary,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.title}
              </div>
              <div
                style={{ fontSize: 10.5, color: MR_TOKENS.fgTertiary, marginTop: 1 }}
              >
                {r.sub}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────── helpers ──────────────
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;  // 秒
    if (diff < 60) return `${Math.floor(diff)} 秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 时前`;
    return d.toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return iso;
  }
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1) + "…";
}
