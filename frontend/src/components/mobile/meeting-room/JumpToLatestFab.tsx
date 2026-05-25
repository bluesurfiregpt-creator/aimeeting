"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 跳到底 FAB.
 *
 * 设计源 1:1: meeting-room.jsx:1675-1689.
 *
 * 滚离底 80px 时显. 紫色 / 琥珀色 切换 — TD1 mitigation:
 *   - 默认: 蓝色 chev-down (单纯回到底)
 *   - 有新 host card 但用户不在底: 琥珀色脉冲 (提示有新主持人消息)
 */

import type { ReactElement } from "react";

type Props = {
  /** 是否显 */
  visible: boolean;
  /** 是否有 alert (用 amber pulse 强调) */
  alert?: boolean;
  onClick: () => void;
};

export default function JumpToLatestFab({
  visible,
  alert = false,
  onClick,
}: Props): ReactElement | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "absolute",
        right: 14,
        bottom: 178,
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: alert ? "#FF9F0A" : "#fff",
        border: "none",
        boxShadow:
          "0 4px 14px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(60,60,67,0.12)",
        cursor: "pointer",
        zIndex: 60,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        animation: alert
          ? "mr-livePulse 1.4s ease-in-out infinite"
          : "mr-fadeIn 200ms ease",
      }}
      aria-label="回到最新发言"
    >
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path
          d="M12 5v14M6 13l6 6 6-6"
          stroke={alert ? "#fff" : "#007AFF"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}
