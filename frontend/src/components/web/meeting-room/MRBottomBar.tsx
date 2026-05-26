"use client";

/**
 * R5.D Web 会议室 底部控制条 (72px):
 *  mic / video / hand / cc / share / note / more
 *
 * Toggle only — UI mock 不接 backend (跟 Mobile dock 一致).
 *
 * 设计源: `meeting-room-web.jsx:1225-1263`.
 */

import { MRIcon, type MRIconName } from "./atoms";

export type MRBottomBarProps = {
  muted: boolean;
  setMuted: (v: boolean) => void;
  video: boolean;
  setVideo: (v: boolean) => void;
  hand: boolean;
  setHand: (v: boolean) => void;
  cc: boolean;
  setCC: (v: boolean) => void;
  onMore?: () => void;
};

export function MRBottomBar({
  muted,
  setMuted,
  video,
  setVideo,
  hand,
  setHand,
  cc,
  setCC,
  onMore,
}: MRBottomBarProps) {
  return (
    <div
      style={{
        height: 72,
        background: "#fff",
        borderTop: "0.5px solid #E5E5EA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "0 24px",
        flexShrink: 0,
      }}
    >
      <CtrlPill
        icon={muted ? "mic-off" : "mic"}
        label={muted ? "已静音" : "麦克风"}
        active={muted}
        activeBg="#FF3B30"
        onClick={() => setMuted(!muted)}
      />
      <CtrlPill
        icon={video ? "video" : "video-off"}
        label={video ? "摄像头" : "已关闭"}
        active={!video}
        activeBg="#8E8E93"
        onClick={() => setVideo(!video)}
      />
      <CtrlPill
        icon="hand"
        label={hand ? "举手中" : "举手"}
        active={hand}
        activeBg="#FF9F0A"
        onClick={() => setHand(!hand)}
      />
      <CtrlPill
        icon="cc"
        label="字幕"
        active={cc}
        activeBg="#007AFF"
        onClick={() => setCC(!cc)}
      />
      <div style={{ width: 1, height: 32, background: "#E5E5EA", margin: "0 4px" }} />
      <CtrlPill icon="share" label="屏幕共享" />
      <CtrlPill icon="note" label="纪要" />
      <CtrlPill icon="more" label="更多" onClick={onMore} />
    </div>
  );
}

function CtrlPill({
  icon,
  label,
  active,
  activeBg = "#1C1C1E",
  onClick,
}: {
  icon: MRIconName;
  label: string;
  active?: boolean;
  activeBg?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 48,
        padding: "0 16px",
        borderRadius: 12,
        background: active ? activeBg : "#F2F2F7",
        color: active ? "#fff" : "#1C1C1E",
        border: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "background 140ms ease",
      }}
    >
      <MRIcon name={icon} size={18} color={active ? "#fff" : "#1C1C1E"} />
      <span>{label}</span>
    </button>
  );
}
