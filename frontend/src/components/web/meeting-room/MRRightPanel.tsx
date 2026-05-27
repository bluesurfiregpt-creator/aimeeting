"use client";

/**
 * R5.D Web 会议室 右侧栏 (340px):
 *  - MiraLive — Mira 当下 (焦点 / 议程剩余 / 偏离风险 / 正在说) + 问主持人 CTA
 *  - DecisionPool — 3 条决策 (已确认 / 待确认)
 *  - ActionList — 4 项行动项 (含 owner 头像 + 截止)
 *  - ParkingLotPanel — 偏离时记入的待办
 *  - ReferencesPanel — doc / data / mtg 3 类参考
 *
 * 设计源: `meeting-room-web.jsx:719-961`.
 */

import {
  MR_HOST,
  MR_DECISIONS,
  MR_ACTIONS,
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

export function MRRightPanel() {
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
        <MiraLive />
        <div style={{ height: 18 }} />
        <DecisionPool />
        <div style={{ height: 18 }} />
        <ActionList />
        <div style={{ height: 18 }} />
        <ParkingLotPanel />
        <div style={{ height: 18 }} />
        <ReferencesPanel />
      </div>
    </div>
  );
}

// ────────────── Mira Live ──────────────
function MiraLive() {
  return (
    <div>
      <MRSectionLabel>Mira 当下</MRSectionLabel>
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
          <LiveRow label="当前焦点" value="议程 2 · 搜索 A/B" />
          <LiveRow label="议程剩余" value="4 分 30 秒" valueColor="#FF9F0A" />
          <LiveRow label="偏离风险" value="低 ✓" valueColor="#34C759" />
          <LiveRow label="正在说" value="王俊 · 1:24" />
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
}: {
  label: string;
  value: string;
  valueColor?: string;
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
      <span style={{ color: MR_TOKENS.fgTertiary }}>{label}</span>
      <span style={{ color: valueColor ?? MR_TOKENS.fgPrimary, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ────────────── Decision Pool ──────────────
function DecisionPool() {
  return (
    <div>
      <MRSectionLabel right={`${MR_DECISIONS.length} 条`}>决策池</MRSectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {MR_DECISIONS.map((d) => (
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
                  color: d.status === "confirmed" ? "#34C759" : "#FF9F0A",
                  background:
                    d.status === "confirmed"
                      ? "rgba(52,199,89,0.12)"
                      : "rgba(255,159,10,0.12)",
                  padding: "2px 6px",
                  borderRadius: 3,
                }}
              >
                {d.status === "confirmed" ? "已确认" : "待确认"}
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
                {d.tag}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10.5,
                  color: MR_TOKENS.fgQuaternary,
                }}
              >
                {d.t}
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
              {d.title}
            </div>
            <div style={{ fontSize: 11, color: MR_TOKENS.fgTertiary, marginTop: 3 }}>
              来源: {d.source}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────── Action List ──────────────
function ActionList() {
  return (
    <div>
      <MRSectionLabel right={`${MR_ACTIONS.length} 项`}>行动项</MRSectionLabel>
      <div
        style={{
          background: MR_TOKENS.bgSurface,
          borderRadius: 10,
          border: MR_TOKENS.borderHair,
          overflow: "hidden",
        }}
      >
        {MR_ACTIONS.map((a, i) => {
          const isAI = !!MR_AGENTS_IN_MEETING[a.owner];
          const isHuman = !!MR_HUMANS_IN_MEETING[a.owner];
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
              {isAI && <MRAIAvatar id={a.owner} size={22} />}
              {isHuman && <MRHumanAvatar id={a.owner} size={22} />}
              {!isAI && !isHuman && (
                // unknown owner (e.g. HR which isn't currently in MR_HUMANS_IN_MEETING)
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: MR_TOKENS.fgQuaternary,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {a.owner[0]}
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
                  {a.title}
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
                  <span>{a.source}</span>
                  <span>·</span>
                  <span style={{ fontWeight: 600, color: "#FF9F0A" }}>
                    截止 {a.due}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────── Parking Lot ──────────────
function ParkingLotPanel() {
  return (
    <div>
      <MRSectionLabel right={`${MR_PARKING.length} 项`}>Parking Lot</MRSectionLabel>
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

// ────────────── References ──────────────
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
