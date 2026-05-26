"use client";

/**
 * R5.D Web 会议室 顶 nav (2 行):
 *  Row 1: logo + 面包屑 + LIVE + timer | people-micro-strip | filter / invite / settings / END
 *  Row 2: AgendaTimeline — 4 段, 进行中段有进度填充, 点击跳 transcript
 *
 * 设计源: `meeting-room-web.jsx:7-196`.
 */

import Link from "next/link";
import {
  MR_AGENDA,
  MR_HUMANS_IN_MEETING,
  type MRAgendaItem,
} from "./data";
import { MRHumanAvatar, MRIcon, type MRIconName } from "./atoms";

export type MRTopBarProps = {
  timer: string;
  filterActive: boolean;
  filterCount: number;
  selected: Set<string>;
  onFilter: () => void;
  onEnd: () => void;
  onToggleSpeaker: (k: string) => void;
  onJumpToAgenda: (agendaId: number) => void;
  meetingTitle?: string;
};

export function MRTopBar({
  timer,
  filterActive,
  filterCount,
  selected,
  onFilter,
  onEnd,
  onToggleSpeaker,
  onJumpToAgenda,
  meetingTitle = "Q3 路线图对齐",
}: MRTopBarProps) {
  return (
    <div
      style={{
        background: "#fff",
        borderBottom: "0.5px solid #E5E5EA",
        flexShrink: 0,
      }}
    >
      {/* Row 1 — chrome */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 14,
        }}
      >
        {/* Logo + 面包屑 */}
        <Link
          href="/"
          style={{
            color: "#1C1C1E",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 10px 0 6px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: "#F2F2F7",
            transition: "background 140ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#E8E8ED";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#F2F2F7";
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(124,92,250,0.30)",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z" />
            </svg>
          </div>
          aimeeting
        </Link>

        <div style={{ width: 1, height: 22, background: "#E5E5EA" }} />

        {/* Breadcrumb */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 13,
            color: "#8E8E93",
          }}
        >
          <span>会议室</span>
          <span style={{ color: "#C7C7CC" }}>/</span>
          <span style={{ color: "#1C1C1E", fontWeight: 700, fontSize: 15 }}>
            {meetingTitle}
          </span>
        </div>

        {/* LIVE 红 chip */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 13,
            background: "rgba(255,59,48,0.10)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#FF3B30",
              animation: "mrLivePulse 1.4s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#FF3B30",
              letterSpacing: 0.4,
            }}
          >
            实时
          </span>
          <span
            style={{
              fontSize: 12,
              color: "#FF3B30",
              opacity: 0.8,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {timer}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* People micro strip */}
        <PeopleMicroStrip selected={selected} onToggleSpeaker={onToggleSpeaker} />

        <div style={{ width: 1, height: 22, background: "#E5E5EA" }} />

        <TopBarBtn
          icon="filter"
          label={filterActive ? `已筛选 ${filterCount}` : "筛选"}
          onClick={onFilter}
          active={filterActive}
        />
        <TopBarBtn icon="invite" label="邀请" />
        <TopBarBtn icon="gear" label="设置" />

        <button
          type="button"
          onClick={onEnd}
          style={{
            height: 34,
            padding: "0 16px",
            borderRadius: 8,
            background: "#FF3B30",
            color: "#fff",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 1px 2px rgba(255,59,48,0.30)",
          }}
        >
          <MRIcon name="end" size={14} color="#fff" />
          结束会议
        </button>
      </div>

      {/* Row 2 — Agenda timeline */}
      <AgendaTimeline onJumpToAgenda={onJumpToAgenda} />
    </div>
  );
}

// ──────────────── PeopleMicroStrip ────────────────
function PeopleMicroStrip({
  selected,
  onToggleSpeaker,
}: {
  selected: Set<string>;
  onToggleSpeaker: (k: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#8E8E93",
          letterSpacing: 0.4,
        }}
      >
        在场
      </span>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {Object.keys(MR_HUMANS_IN_MEETING).map((k) => {
          const p = MR_HUMANS_IN_MEETING[k];
          const active = selected.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggleSpeaker(k)}
              title={`${p.name} · ${p.role}${p.speaking ? " · 正在说话" : ""}`}
              style={{
                width: 30,
                height: 30,
                padding: 0,
                background: "none",
                border: active ? "2px solid #007AFF" : "2px solid transparent",
                borderRadius: "50%",
                cursor: "pointer",
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MRHumanAvatar id={k} size={26} showStatus />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────── TopBarBtn ────────────────
function TopBarBtn({
  icon,
  label,
  onClick,
  active,
}: {
  icon: MRIconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        background: active ? "rgba(0,122,255,0.12)" : "transparent",
        color: active ? "#007AFF" : "#1C1C1E",
        border: active ? "none" : "0.5px solid #E5E5EA",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <MRIcon name={icon} size={14} color={active ? "#007AFF" : "#1C1C1E"} />
      {label}
    </button>
  );
}

// ──────────────── AgendaTimeline (Row 2) ────────────────
function AgendaTimeline({
  onJumpToAgenda,
}: {
  onJumpToAgenda: (id: number) => void;
}) {
  const totalMin = MR_AGENDA.reduce((s, a) => s + a.minutes, 0);
  const usedMin = MR_AGENDA.filter((a) => a.state === "done").reduce(
    (s, a) => s + a.minutes,
    0,
  );
  const activeRemaining =
    MR_AGENDA.find((a) => a.state === "active")?.remaining ?? 0;
  const usedSoFar =
    usedMin +
    (MR_AGENDA.find((a) => a.state === "active")?.minutes ?? 0) -
    activeRemaining;
  return (
    <div
      style={{
        borderTop: "0.5px solid #E5E5EA",
        background: "#FAFAFA",
        padding: "8px 20px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#8E8E93",
            letterSpacing: 0.4,
          }}
        >
          议程时间线
        </span>
        <span style={{ fontSize: 11, color: "#C7C7CC" }}>
          总 {totalMin} 分钟 · 点击段落跳转
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#8E8E93" }}>
          已用 {usedSoFar} 分钟 · 剩 {totalMin - usedSoFar} 分钟
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, height: 44 }}>
        {MR_AGENDA.map((a) => (
          <AgendaSegment key={a.id} a={a} onJump={() => onJumpToAgenda(a.id)} />
        ))}
      </div>
    </div>
  );
}

function AgendaSegment({
  a,
  onJump,
}: {
  a: MRAgendaItem;
  onJump: () => void;
}) {
  const isActive = a.state === "active";
  const isDone = a.state === "done";
  const fillPct =
    isActive && a.remaining !== undefined
      ? ((a.minutes - a.remaining) / a.minutes) * 100
      : 0;

  const bg = isDone
    ? "linear-gradient(135deg, rgba(52,199,89,0.10), rgba(52,199,89,0.18))"
    : "#fff";
  const border = isDone
    ? "0.5px solid rgba(52,199,89,0.45)"
    : isActive
      ? "1px solid #007AFF"
      : "0.5px solid #E5E5EA";
  const shadow = isActive ? "0 2px 6px rgba(0,122,255,0.18)" : "none";

  return (
    <div
      onClick={onJump}
      title="跳转到该议程"
      style={{
        flex: a.minutes,
        background: bg,
        border,
        borderRadius: 8,
        boxShadow: shadow,
        padding: "6px 10px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        opacity: !isDone && !isActive ? 0.65 : 1,
      }}
    >
      {isActive && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${fillPct}%`,
            background:
              "linear-gradient(90deg, rgba(0,122,255,0.10), rgba(94,92,230,0.06))",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1.15,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.3,
            color: isDone ? "#34C759" : isActive ? "#007AFF" : "#8E8E93",
          }}
        >
          议程 {a.id}
        </span>
        {isDone && <MRIcon name="check" size={12} color="#34C759" />}
        {isActive && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#007AFF",
              animation: "mrLivePulse 1.4s ease-in-out infinite",
            }}
          />
        )}
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#1C1C1E",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          {a.title}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          marginTop: 4,
          fontSize: 11,
          color: "#8E8E93",
          display: "flex",
          alignItems: "center",
          gap: 5,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {isActive && a.remaining !== undefined ? (
          <>
            <span style={{ color: "#FF9F0A", fontWeight: 600 }}>
              剩 {a.remaining} 分
            </span>
            <span>·</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {a.minutes - a.remaining}/{a.minutes} min
            </span>
          </>
        ) : isDone ? (
          <>
            <span style={{ color: "#34C759", fontWeight: 600 }}>完成</span>
            <span>·</span>
            <span>{a.minutes} min</span>
          </>
        ) : (
          <>
            <span>{a.minutes} min</span>
            <span>·</span>
            <span>待开始</span>
          </>
        )}
      </div>
    </div>
  );
}
