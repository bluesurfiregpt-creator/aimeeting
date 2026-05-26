"use client";

import type { CSSProperties } from "react";

/**
 * Lucide-style stroke SVG icons — round-5 设计稿 30+ icons.
 *
 * 用 currentColor 默认, 调用方可以 override color prop.
 *
 * 新增 icon 在 SWITCH 里加 case, 不要分散到别处.
 */
export type WIconName =
  | "home"
  | "cal"
  | "brain"
  | "sparkle"
  | "bell"
  | "bolt"
  | "plus"
  | "search"
  | "chev"
  | "chev-d"
  | "arr-r"
  | "check"
  | "gear"
  | "book"
  | "users"
  | "mic"
  | "doc"
  | "task"
  | "target"
  | "arrow-up"
  | "cmd"
  | "logout"
  | "compass"
  | "link"
  | "admin"
  | "clock"
  | "history"
  | "moon"
  | "sun"
  | "x"
  | "menu";

export function WIcon({
  name,
  size = 16,
  color = "currentColor",
  stroke = 1.7,
  style,
}: {
  name: WIconName;
  size?: number;
  color?: string;
  stroke?: number;
  style?: CSSProperties;
}) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
  };
  switch (name) {
    case "home":     return <svg {...p}><path d="M3 12l9-9 9 9M5 10v10h14V10"/></svg>;
    case "cal":      return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>;
    case "brain":    return <svg {...p}><path d="M12 5a3 3 0 1 0-6 0 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 4 3 3 0 0 0 6 0 3 3 0 0 0 4-4 3 3 0 0 0 1-5 3 3 0 0 0-2-5 3 3 0 1 0-6 0z"/><path d="M12 5v14"/></svg>;
    case "sparkle":  return <svg {...p}><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z"/></svg>;
    case "bell":     return <svg {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>;
    case "bolt":     return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case "plus":     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "search":   return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>;
    case "chev":     return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case "chev-d":   return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case "arr-r":    return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "check":    return <svg {...p}><path d="M5 12l5 5 9-11"/></svg>;
    case "gear":     return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case "book":     return <svg {...p}><path d="M4 4a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2V4z"/><path d="M4 19a2 2 0 0 0 2 2h12"/></svg>;
    case "users":    return <svg {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19c.7-2.5 3-4 6-4s5.3 1.5 6 4M14 18c.5-1.6 2-2.7 4-2.7s3.5 1.1 4 2.7"/></svg>;
    case "mic":      return <svg {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>;
    case "doc":      return <svg {...p}><path d="M7 3 H15 L20 8 V20 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1z"/><path d="M15 3 V8 H20"/></svg>;
    case "task":     return <svg {...p}><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/></svg>;
    case "target":   return <svg {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill={color} stroke="none"/></svg>;
    case "arrow-up": return <svg {...p}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case "cmd":      return <svg {...p}><path d="M6 9V6a3 3 0 0 1 3-3v0a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3v0a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3v0a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3v0a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/></svg>;
    case "logout":   return <svg {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5M5 12h12"/></svg>;
    case "compass":  return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M16 8l-3 7-5 1 3-7z"/></svg>;
    case "link":     return <svg {...p}><path d="M10 14a4 4 0 0 1 0-5l3-3a4 4 0 0 1 6 6l-1.5 1.5M14 10a4 4 0 0 1 0 5l-3 3a4 4 0 0 1-6-6l1.5-1.5"/></svg>;
    case "admin":    return <svg {...p}><path d="M12 2L4 6v5c0 5 3.5 9 8 11 4.5-2 8-6 8-11V6l-8-4z"/></svg>;
    case "clock":    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "history":  return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>;
    case "moon":     return <svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
    case "sun":      return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>;
    case "x":        return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "menu":     return <svg {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    default:         return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
  }
}
