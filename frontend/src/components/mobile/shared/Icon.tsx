"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · 共享 inline SVG icon set.
 *
 * 提层自: components/mobile/meeting-room/MRIcon.tsx (round-3 实施)
 * 设计源 1:1:
 *   - 会议室原有 (round-3): docs/design/handoffs/2026-05-25-meeting-room/project/meeting-room-shared.jsx:241-269
 *   - round-4 新增: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:324-388
 *
 * 命名约定:
 *   - 保留旧名兼容现有调用 (back/more/mic/...)
 *   - round-4 加: target / cal / task / brain / bell / sun / flag / arrow-right /
 *                 play / pin / archive / history / today / logout / sparkle (已存) /
 *                 bolt / doc / search / check-circle / circle / plus
 *
 * 注意: 旧 default export `MRIcon` 也保留 (re-export from old path is via this).
 */

import type { ReactElement } from "react";

export type MRIconName =
  // ─── 会议室 round-3 已有 ───
  | "back"
  | "more"
  | "mic"
  | "mic-off"
  | "mic-fill"
  | "hand"
  | "sparkle"
  | "chat"
  | "end"
  | "video"
  | "video-off"
  | "cc"
  | "share"
  | "invite"
  | "note"
  | "gear"
  | "feedback"
  | "wechat"
  | "compass"
  | "clock"
  | "route"
  | "check"
  | "chev"
  | "chev-down"
  | "live"
  | "filter"
  | "close"
  | "menu"
  // ─── round-4 新增 ───
  | "target"
  | "cal"
  | "task"
  | "brain"
  | "bell"
  | "sun"
  | "flag"
  | "arrow-right"
  | "play"
  | "pin"
  | "archive"
  | "history"
  | "today"
  | "logout"
  | "bolt"
  | "doc"
  | "search"
  | "check-circle"
  | "circle"
  | "plus";

type Props = {
  name: MRIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export default function Icon({
  name,
  size = 17,
  color = "currentColor",
  strokeWidth,
}: Props): ReactElement | null {
  const sw = strokeWidth ?? 1.6;
  const strokeProps = {
    stroke: color,
    strokeWidth: sw,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    // ─── 会议室 round-3 已有 (1:1 保留) ───
    case "back":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M15 6l-6 6 6 6" {...strokeProps} strokeWidth={2} />
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
          <rect x="9" y="3" width="6" height="12" rx="3" {...strokeProps} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...strokeProps} />
        </svg>
      );
    case "mic-off":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 5a3 3 0 0 1 6 0v6" {...strokeProps} />
          <path
            d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"
            {...strokeProps}
          />
        </svg>
      );
    case "mic-fill":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="9" y="3" width="6" height="12" rx="3" fill={color} />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...strokeProps} />
        </svg>
      );
    case "hand":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M7 11V6a1.5 1.5 0 1 1 3 0v5M10 11V5a1.5 1.5 0 1 1 3 0v6M13 11V6a1.5 1.5 0 1 1 3 0v8M16 9a1.5 1.5 0 1 1 3 0v6a5 5 0 0 1-10 0"
            {...strokeProps}
          />
        </svg>
      );
    case "sparkle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
            fill={color}
          />
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
            {...strokeProps}
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
          <rect x="3" y="6" width="13" height="12" rx="2.5" {...strokeProps} />
          <path d="M16 10l5-2.5v9L16 14" {...strokeProps} />
        </svg>
      );
    case "video-off":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M3 6.5C3 6 3.4 5.5 4 5.5h12c.6 0 1 .5 1 1V14M16 17H4c-.6 0-1-.5-1-1V8"
            {...strokeProps}
          />
          <path d="M17 10l4-2v9l-4-2M3 3l18 18" {...strokeProps} />
        </svg>
      );
    case "cc":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2.5" {...strokeProps} />
          <path
            d="M10 10.5c-.6-.6-1.4-1-2.3-1A2.7 2.7 0 0 0 5 12.2c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1M17 10.5c-.6-.6-1.4-1-2.3-1a2.7 2.7 0 0 0-2.7 2.7c0 1.5 1.2 2.7 2.7 2.7.9 0 1.7-.4 2.3-1"
            {...strokeProps}
          />
        </svg>
      );
    case "share":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="12" rx="2" {...strokeProps} />
          <path d="M12 9v5M9.5 11.5L12 9l2.5 2.5M8 20h8" {...strokeProps} />
        </svg>
      );
    case "invite":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="10" cy="9" r="3.2" {...strokeProps} />
          <path
            d="M4 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M18 5v6M15 8h6"
            {...strokeProps}
          />
        </svg>
      );
    case "note":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
            {...strokeProps}
          />
          <path d="M14 4v5h5M8 13h8M8 17h6" {...strokeProps} />
        </svg>
      );
    case "gear":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" {...strokeProps} />
          <path
            d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 0 0-3-1.7L13 2h-2l-.5 2.7a7 7 0 0 0-3 1.7l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-1c.9.8 1.9 1.3 3 1.7L11 22h2l.5-2.7a7 7 0 0 0 3-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7z"
            {...strokeProps}
          />
        </svg>
      );
    case "feedback":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H10l-4 4v-4H5.5c-.8 0-1.5-.7-1.5-1.5z"
            {...strokeProps}
          />
          <path d="M9 9h6M9 12h4" {...strokeProps} />
        </svg>
      );
    case "wechat":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M14.5 9c-3 0-5.5 2-5.5 4.5 0 1.5.9 2.7 2.2 3.5L11 19l2-1.2c.5.1 1 .2 1.5.2 3 0 5.5-2 5.5-4.5S17.5 9 14.5 9z"
            {...strokeProps}
          />
          <circle cx="13" cy="13" r=".9" fill={color} />
          <circle cx="16" cy="13" r=".9" fill={color} />
        </svg>
      );
    case "compass":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...strokeProps} />
          <path d="M15.5 8.5L13 13l-4.5 2.5L11 11l4.5-2.5z" fill={color} />
        </svg>
      );
    case "clock":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...strokeProps} />
          <path d="M12 7v5l3 2" {...strokeProps} />
        </svg>
      );
    case "route":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="6" cy="6" r="2.5" {...strokeProps} />
          <circle cx="18" cy="18" r="2.5" {...strokeProps} />
          <path
            d="M8.5 6h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-7a3 3 0 0 0-3 3"
            {...strokeProps}
          />
        </svg>
      );
    case "check":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" {...strokeProps} strokeWidth={2.4} />
        </svg>
      );
    case "chev":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" {...strokeProps} />
        </svg>
      );
    case "chev-down":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" {...strokeProps} strokeWidth={2} />
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
          <path
            d="M4 6h16M7 12h10M10 18h4"
            {...strokeProps}
            strokeWidth={1.8}
          />
        </svg>
      );
    case "close":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" {...strokeProps} strokeWidth={2} />
        </svg>
      );
    case "menu":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M5 6h14M5 12h14M5 18h14"
            {...strokeProps}
            strokeWidth={1.6}
          />
          <circle cx="3" cy="6" r="1" fill={color} />
          <circle cx="3" cy="12" r="1" fill={color} />
          <circle cx="3" cy="18" r="1" fill={color} />
        </svg>
      );
    // ─── round-4 新增 ───
    case "target":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...strokeProps} />
          <circle cx="12" cy="12" r="5" {...strokeProps} />
          <circle cx="12" cy="12" r="1.4" fill={color} />
        </svg>
      );
    case "cal":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="16" rx="2" {...strokeProps} />
          <path d="M16 3v4M8 3v4M3 11h18" {...strokeProps} />
        </svg>
      );
    case "task":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M9 11l3 3 8-8" {...strokeProps} />
          <path
            d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"
            {...strokeProps}
          />
        </svg>
      );
    case "brain":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M12 5a3 3 0 1 0-6 0 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 4 3 3 0 0 0 6 0 3 3 0 0 0 4-4 3 3 0 0 0 1-5 3 3 0 0 0-2-5 3 3 0 1 0-6 0z"
            {...strokeProps}
          />
          <path d="M12 5v14" {...strokeProps} />
        </svg>
      );
    case "bell":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...strokeProps} />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" {...strokeProps} />
        </svg>
      );
    case "sun":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" {...strokeProps} />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            {...strokeProps}
          />
        </svg>
      );
    case "flag":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M4 21V4h12l-2 4 2 4H4" {...strokeProps} />
        </svg>
      );
    case "arrow-right":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M5 12h14M13 5l7 7-7 7" {...strokeProps} />
        </svg>
      );
    case "play":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={color}
          stroke="none"
        >
          <path d="M7 4v16l13-8z" />
        </svg>
      );
    case "pin":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 22v-7M9 11l3-7 3 7-3 4-3-4z" {...strokeProps} />
        </svg>
      );
    case "archive":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="5" rx="1" {...strokeProps} />
          <path
            d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 13h4"
            {...strokeProps}
          />
        </svg>
      );
    case "history":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" {...strokeProps} />
          <path d="M3 3v5h5M12 7v5l3 2" {...strokeProps} />
        </svg>
      );
    case "today":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="16" rx="2" {...strokeProps} />
          <path d="M16 3v4M8 3v4M3 11h18" {...strokeProps} />
          <circle cx="12" cy="15" r="1.5" fill={color} />
        </svg>
      );
    case "logout":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" {...strokeProps} />
          <path d="M10 17l-5-5 5-5M5 12h12" {...strokeProps} />
        </svg>
      );
    case "bolt":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...strokeProps} />
        </svg>
      );
    case "doc":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M7 3 H15 L20 8 V20 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1z"
            {...strokeProps}
          />
          <path d="M15 3 V8 H20" {...strokeProps} />
        </svg>
      );
    case "search":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" {...strokeProps} />
          <path d="M21 21l-4-4" {...strokeProps} />
        </svg>
      );
    case "check-circle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...strokeProps} />
          <path d="M8 12l3 3 5-6" {...strokeProps} />
        </svg>
      );
    case "circle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" {...strokeProps} />
        </svg>
      );
    case "plus":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" {...strokeProps} />
        </svg>
      );
    default:
      return null;
  }
}
