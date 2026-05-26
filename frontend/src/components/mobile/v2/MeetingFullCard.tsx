"use client";

/**
 * v1.4.0 · Saga M1 · 会议大卡 (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx:107-185
 * (MeetingFullCard).
 *
 * 白卡 14px 圆角 + 0.5px hairline + 1px shadow.
 * 状态变体 (来自 schema §2.2 status enum):
 *   - live      : 绿色 LIVE pill (pulse) + 左侧 3px 绿色 ribbon + "已 23 分" + "立即进入 →"
 *   - upcoming  : 浅蓝 "即将" pill + "⏱ 倒计时" + "时间 开始"
 *   - finished  : 灰 "已结束" pill + "N 决策" + "看完整 →"
 *   - processed : 灰 "已沉淀" pill (跟 finished 视觉一致)
 *
 * 字号:
 *   - title       16px weight 700 letter -0.2
 *   - topic 副标  12.5px #8E8E93
 *   - count       11px #8E8E93
 *   - 状态后缀    12px (颜色按状态)
 *
 * Avatar stack 走 V2Attendee[] 喂入, size 22, max 6.
 */

import Link from "next/link";
import type { ReactElement } from "react";

import MAIcon from "./MAIcon";
import MAPill, { type V2PillTone } from "./MAPill";
import MAvatarStack from "./MAvatarStack";
import type { V2MeetingItem } from "./types";

type Props = {
  meeting: V2MeetingItem;
  /** 点击跳转, 不传时不可点 */
  href?: string;
  onClick?: () => void;
};

type StateMeta = {
  pillTone: V2PillTone;
  pillLabel: string;
  pulse: boolean;
  accent: string;
};

const STATE_MAP: Record<V2MeetingItem["status"], StateMeta> = {
  live: {
    pillTone: "live",
    pillLabel: "进行中",
    pulse: true,
    accent: "#34C759",
  },
  upcoming: {
    pillTone: "upcoming",
    pillLabel: "即将开始",
    pulse: false,
    accent: "#007AFF",
  },
  finished: {
    pillTone: "done",
    pillLabel: "已结束",
    pulse: false,
    accent: "#8E8E93",
  },
  processed: {
    pillTone: "done",
    pillLabel: "已沉淀",
    pulse: false,
    accent: "#8E8E93",
  },
};

/** elapsed_minutes → "已 23 分" / "已 4 小时 12 分" 文案. */
function formatElapsed(minutes: number | null): string {
  if (minutes == null) return "";
  if (minutes < 60) return `已 ${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `已 ${h} 小时`;
  return `已 ${h} 小时 ${m} 分`;
}

/** countdown_seconds → "2h 18m" 倒计时. */
function formatCountdown(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} 分`;
}

/** scheduled_for ISO → "14:00 开始" 文案. */
function formatStartTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} 开始`;
}

/** ended_at ISO → "昨天" / "5/22" 相对时间. */
function formatEndedTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfTarget = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const diffDays = Math.round((startOfToday - startOfTarget) / dayMs);
  if (diffDays === 0) return `今天 · 已结束`;
  if (diffDays === 1) return `昨天 · 已结束`;
  if (diffDays > 1 && diffDays <= 7) return `${diffDays} 天前 · 已结束`;
  return `${d.getMonth() + 1}/${d.getDate()} · 已结束`;
}

export default function MeetingFullCard({
  meeting,
  href,
  onClick,
}: Props): ReactElement {
  const m = meeting;
  const meta = STATE_MAP[m.status];

  // 时间 label
  let timeLabel = "";
  if (m.status === "live") {
    timeLabel = formatElapsed(m.elapsed_minutes);
  } else if (m.status === "upcoming") {
    const cd = formatCountdown(m.countdown_seconds);
    timeLabel = cd ? `${formatStartTime(m.scheduled_for)} · 还有 ${cd}` : formatStartTime(m.scheduled_for);
  } else if (m.ended_at) {
    timeLabel = formatEndedTime(m.ended_at);
  }

  const inner = (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        background: "#fff",
        borderRadius: 14,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: "12px 14px",
        fontFamily: "inherit",
        cursor: href || onClick ? "pointer" : "default",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
        position: "relative",
        overflow: "hidden",
      }}
      data-testid="meeting-full-card"
      data-status={m.status}
    >
      {/* live ribbon — 左侧 3px 绿色 */}
      {m.status === "live" ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: meta.accent,
          }}
        />
      ) : null}

      {/* 顶 — pill + 时间 */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <MAPill tone={meta.pillTone} label={meta.pillLabel} pulse={meta.pulse} />
        {timeLabel ? (
          <span
            style={{
              fontSize: 12,
              color: "#8E8E93",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            · {timeLabel}
          </span>
        ) : null}
      </div>

      {/* 标题 */}
      <div
        style={{
          marginTop: 8,
          fontSize: 16,
          fontWeight: 700,
          color: "#1C1C1E",
          lineHeight: 1.3,
          letterSpacing: -0.2,
        }}
      >
        {m.title}
      </div>

      {/* topic 副标 */}
      {m.topic_summary ? (
        <div style={{ fontSize: 12.5, color: "#8E8E93", marginTop: 1 }}>
          {m.topic_summary}
        </div>
      ) : null}

      {/* 底 — avatar stack + 人数 + 状态后缀 */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <MAvatarStack attendees={m.attendees} size={22} max={6} ring="#fff" />
        <span
          style={{
            fontSize: 11,
            color: "#8E8E93",
            whiteSpace: "nowrap",
          }}
        >
          {m.human_count} 人 · {m.ai_count} AI
        </span>
        <span style={{ flex: 1 }} />
        {m.status === "finished" || m.status === "processed" ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
            }}
          >
            {m.decision_count > 0 ? (
              <span style={{ color: "#1F8A5B", fontWeight: 600 }}>
                {m.decision_count} 决策
              </span>
            ) : null}
            <span
              style={{
                color: "#8E8E93",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              看完整
              <MAIcon
                name="arrow-right"
                size={12}
                color="#8E8E93"
                strokeWidth={2.4}
              />
            </span>
          </div>
        ) : null}
        {m.status === "live" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "#34C759",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            立即进入
            <MAIcon
              name="arrow-right"
              size={12}
              color="#34C759"
              strokeWidth={2.4}
            />
          </span>
        ) : null}
        {m.status === "upcoming" ? (
          <span
            style={{
              color: "#8E8E93",
              fontSize: 12,
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <MAIcon name="clock" size={11} color="#8E8E93" />
            {formatCountdown(m.countdown_seconds) || "稍后开始"}
          </span>
        ) : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        style={{ display: "block", textDecoration: "none", color: "inherit" }}
      >
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          all: "unset",
          display: "block",
          cursor: "pointer",
          width: "100%",
        }}
      >
        {inner}
      </button>
    );
  }
  return inner;
}
