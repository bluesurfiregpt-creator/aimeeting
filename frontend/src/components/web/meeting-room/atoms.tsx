"use client";

/**
 * R5.D Web 会议室 atoms.
 *
 * - MRHumanAvatar — 真人圆头像 + speaking/muted indicator
 * - MRAIAvatar    — AI 渐变方形头像 + sparkle 火花
 * - MRHostAvatar  — Mira 同心环头像 (跟 domain AI 区分)
 * - MRIcon        — 18 个 icon (mic / video / hand / cc / sparkle / 等)
 * - MRWaveform    — 真人 speaking 时音波小动画
 * - MRDots        — partial / loading 三点动画
 *
 * **跟 mobile meeting-room/atoms.tsx 不复用**:
 *  PM 拍板"Web/Mobile 不能共用 atom" (DESIGN_SYSTEM § 0.3.3).
 *
 * 设计源: `meeting-room-shared.jsx:168-270`.
 */

import type { CSSProperties, ReactNode } from "react";
import { MR_HUMANS_IN_MEETING, MR_AGENTS_IN_MEETING, MR_HOST } from "./data";

// ────────────────── Human Avatar ──────────────────
export function MRHumanAvatar({
  id,
  size = 28,
  ring = "#fff",
  showStatus = false,
}: {
  id: string;
  size?: number;
  ring?: string;
  showStatus?: boolean;
}) {
  const p = MR_HUMANS_IN_MEETING[id];
  if (!p) return null;
  return (
    <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: p.color,
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.44,
          fontWeight: 600,
          boxShadow: `0 0 0 1.5px ${ring}`,
        }}
      >
        {p.initials}
      </div>
      {showStatus && p.speaking && (
        <span
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            boxShadow: "0 0 0 2px #34C759",
            animation: "mrSpeakingPulse 1.2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}
      {showStatus && p.muted && (
        <span
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: "50%",
            background: "#FF453A",
            border: "1.5px solid #fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={size * 0.24} height={size * 0.24} viewBox="0 0 24 24" fill="none">
            <path d="M4 4l16 16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path
              d="M9 5a3 3 0 0 1 6 0v6M9 11v0a3 3 0 0 0 .8 2.05"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
    </div>
  );
}

// ────────────────── AI Avatar ──────────────────
export function MRAIAvatar({
  id,
  size = 28,
  ring = "#fff",
}: {
  id: string;
  size?: number;
  ring?: string;
}) {
  const a = MR_AGENTS_IN_MEETING[id];
  if (!a) return null;
  const r = Math.max(6, size * 0.28);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(135deg, ${a.grad[0]} 0%, ${a.grad[1]} 100%)`,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 0 1.5px ${ring}`,
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="#fff" />
        <path
          d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
          fill="#fff"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

// ────────────────── Host (Mira) Avatar ──────────────────
export function MRHostAvatar({ size = 28, ring = "#fff" }: { size?: number; ring?: string }) {
  const g = MR_HOST.grad;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 50% 50%, ${g[0]} 0%, ${g[0]} 28%, #fff 28%, #fff 36%, ${g[1]} 36%, ${g[1]} 60%, #fff 60%, #fff 68%, ${g[0]} 68%)`,
        boxShadow: `0 0 0 1.5px ${ring}, inset 0 0 0 0.5px rgba(0,0,0,0.08)`,
        flexShrink: 0,
      }}
    />
  );
}

// ────────────────── Speaker avatar (universal) ──────────────────
export function MRSpeakerAvatar({ k, size = 28 }: { k: string; size?: number }) {
  if (k === "host") return <MRHostAvatar size={size} />;
  if (MR_HUMANS_IN_MEETING[k]) return <MRHumanAvatar id={k} size={size} />;
  if (MR_AGENTS_IN_MEETING[k]) return <MRAIAvatar id={k} size={size} />;
  return null;
}

// ────────────────── Icon set ──────────────────
export type MRIconName =
  | "back" | "more" | "mic" | "mic-off" | "mic-fill" | "hand" | "sparkle" | "chat"
  | "end" | "video" | "video-off" | "cc" | "share" | "invite" | "note" | "gear"
  | "feedback" | "wechat" | "compass" | "clock" | "route" | "check" | "chev"
  | "live" | "filter" | "plus" | "send" | "close";

export function MRIcon({
  name,
  size = 17,
  color = "currentColor",
}: {
  name: MRIconName;
  size?: number;
  color?: string;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.6,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "back":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2" />
        </svg>
      );
    case "more":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.6" fill={color} />
          <circle cx="12" cy="12" r="1.6" fill={color} />
          <circle cx="19" cy="12" r="1.6" fill={color} />
        </svg>
      );
    case "mic":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="9" y="3" width="6" height="12" rx="3" {...stroke} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} />
        </svg>
      );
    case "mic-off":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 5a3 3 0 0 1 6 0v6" {...stroke} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" {...stroke} />
        </svg>
      );
    case "mic-fill":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="9" y="3" width="6" height="12" rx="3" fill={color} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} />
        </svg>
      );
    case "hand":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M7 11V6a1.5 1.5 0 1 1 3 0v5M10 11V5a1.5 1.5 0 1 1 3 0v6M13 11V6a1.5 1.5 0 1 1 3 0v8M16 9a1.5 1.5 0 1 1 3 0v6a5 5 0 0 1-10 0"
            {...stroke}
          />
        </svg>
      );
    case "sparkle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill={color} />
          <path
            d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14z"
            fill={color}
          />
        </svg>
      );
    case "chat":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M4 6.5C4 5.7 4.7 5 5.5 5h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H9l-4 3v-3H5.5c-.8 0-1.5-.7-1.5-1.5v-9z"
            {...stroke}
          />
        </svg>
      );
    case "end":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M3 14c0-3 4-5 9-5s9 2 9 5v1.5c0 .8-1 1.5-1.8 1.4l-2.7-.4c-.7-.1-1.3-.6-1.4-1.3l-.3-1.6c0-.5-.4-1-.9-1.1A14 14 0 0 0 12 12c-1.2 0-2.3.2-3.4.4-.5.1-.9.6-.9 1.1l-.3 1.6c-.1.7-.7 1.2-1.4 1.3l-2.7.4C2.5 17 1.5 16.3 1.5 15.5z"
            fill={color}
          />
        </svg>
      );
    case "video":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="6" width="13" height="12" rx="2.5" {...stroke} />
          <path d="M16 10l5-2.5v9L16 14" {...stroke} />
        </svg>
      );
    case "video-off":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M3 6.5C3 6 3.4 5.5 4 5.5h12c.6 0 1 .5 1 1V14M16 17H4c-.6 0-1-.5-1-1V8"
            {...stroke}
          />
          <path d="M17 10l4-2v9l-4-2M3 3l18 18" {...stroke} />
        </svg>
      );
    case "cc":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2.5" {...stroke} />
          <path
            d="M10 10.5c-.6-.6-1.4-1-2.3-1A2.7 2.7 0 0 0 5 12.2c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1M17 10.5c-.6-.6-1.4-1-2.3-1a2.7 2.7 0 0 0-2.7 2.7c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1"
            {...stroke}
          />
        </svg>
      );
    case "share":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="12" rx="2" {...stroke} />
          <path d="M12 9v5M9.5 11.5L12 9l2.5 2.5M8 20h8" {...stroke} />
        </svg>
      );
    case "invite":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="10" cy="9" r="3.2" {...stroke} />
          <path d="M4 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M18 5v6M15 8h6" {...stroke} />
        </svg>
      );
    case "note":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
            {...stroke}
          />
          <path d="M14 4v5h5M8 13h8M8 17h6" {...stroke} />
        </svg>
      );
    case "gear":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" {...stroke} />
          <path
            d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 0 0-3-1.7L13 2h-2l-.5 2.7a7 7 0 0 0-3 1.7l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-1c.9.8 1.9 1.3 3 1.7L11 22h2l.5-2.7a7 7 0 0 0 3-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7z"
            {...stroke}
          />
        </svg>
      );
    case "feedback":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H10l-4 4v-4H5.5c-.8 0-1.5-.7-1.5-1.5z"
            {...stroke}
          />
          <path d="M9 9h6M9 12h4" {...stroke} />
        </svg>
      );
    case "wechat":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M14.5 9c-3 0-5.5 2-5.5 4.5 0 1.5.9 2.7 2.2 3.5L11 19l2-1.2c.5.1 1 .2 1.5.2 3 0 5.5-2 5.5-4.5S17.5 9 14.5 9z"
            {...stroke}
          />
          <circle cx="13" cy="13" r=".9" fill={color} />
          <circle cx="16" cy="13" r=".9" fill={color} />
        </svg>
      );
    case "compass":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M15.5 8.5L13 13l-4.5 2.5L11 11l4.5-2.5z" fill={color} />
        </svg>
      );
    case "clock":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M12 7v5l3 2" {...stroke} />
        </svg>
      );
    case "route":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="6" cy="6" r="2.5" {...stroke} />
          <circle cx="18" cy="18" r="2.5" {...stroke} />
          <path
            d="M8.5 6h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-7a3 3 0 0 0-3 3"
            {...stroke}
          />
        </svg>
      );
    case "check":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth="2.4" />
        </svg>
      );
    case "chev":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" {...stroke} />
        </svg>
      );
    case "live":
      return (
        <svg width={size} height={size} viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="4" fill={color} />
        </svg>
      );
    case "filter":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M4 6h16M7 12h10M10 18h4" {...stroke} strokeWidth="1.8" />
        </svg>
      );
    case "plus":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" {...stroke} strokeWidth="2" />
        </svg>
      );
    case "send":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M4 12L20 4L13 20L11 13L4 12Z"
            fill={color}
          />
        </svg>
      );
    case "close":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

// ────────────────── Waveform (真人 speaking 时) ──────────────────
export function MRWaveform({
  active = true,
  color = "#34C759",
  bars = 4,
}: {
  active?: boolean;
  color?: string;
  bars?: number;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 14 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            borderRadius: 2,
            background: color,
            height: active ? 14 : 4,
            animation: active ? `mrWfBar 900ms ease-in-out ${i * 110}ms infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

// ────────────────── Dots (partial / loading) ──────────────────
export function MRDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, marginLeft: 4 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#8E8E93",
            animation: `mrDotBounce 1.1s ease-in-out ${i * 180}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ────────────────── Section label (small caps eyebrow) ──────────────────
export function MRSectionLabel({
  children,
  right,
  style: extra,
}: {
  children: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 2px 10px",
        ...extra,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#8E8E93",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {children}
      </div>
      {right && <div style={{ fontSize: 11, color: "#007AFF" }}>{right}</div>}
    </div>
  );
}

// ────────────────── Mention rendering — @ 后续紫色 ──────────────────
export function renderMRMentions(text: string): ReactNode[] {
  return text.split(/(@\S+)/).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} style={{ color: "#5E5CE6", fontWeight: 500 }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
