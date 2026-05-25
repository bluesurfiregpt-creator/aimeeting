"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 双行 dock (替代 v27.0 单条 sticky bar).
 *
 * 设计源 1:1: meeting-room.jsx:1353-1483 (ActionBar / PrimaryBtn / CtrlBtn).
 *
 * Row 1 (区分号):
 *   - 大紫色 "@ AI 专家" — 唤醒领域专家答复
 *   - 大琥珀色 "问主持人 Mira" — 拆解 · 路由 · 议程
 *
 * Row 2 (6 个圆角灰色按钮):
 *   - 麦克风 (TD5 — 录音状态合并: mute toggle, active=红)
 *   - 摄像头 (off=灰)
 *   - 举手 (active=琥珀)
 *   - 字幕 (active=蓝)
 *   - 更多 → onMore
 *   - 结束 → onEnd (active=红)
 *
 * Props 兼容 v27.0 旧 props (canControl / isAgendaComplete / currentTopicTitle /
 * hasRiskInsight / advancing / onAdvance / onSummonAi / onEndMeeting), 但新版
 * 主区域是 dock; 旧的"风险/推进"按钮逻辑收进 dock 上方的小条 (canAdvance 时
 * 才显, 简化版).
 */

import type { ReactElement } from "react";

import { MRHostAvatar } from "./meeting-room/avatars";
import MRIcon, { type MRIconName } from "./meeting-room/MRIcon";
import { MR_COLORS } from "./meeting-room/styles";

type Props = {
  // ─── 旧 props 兼容 ───
  canControl: boolean;
  isAgendaComplete: boolean;
  currentTopicTitle: string | null;
  hasRiskInsight: boolean;
  advancing?: boolean;
  onAdvance?: () => void;
  /** 弹召唤 sheet (兼容旧 — 走"@ AI 专家"按钮) */
  onSummonAi?: () => void;
  onEndMeeting?: () => void;

  // ─── 新 props ───
  /** 问主持人 sheet */
  onAskHost?: () => void;
  /** 更多 sheet */
  onMore?: () => void;
  /** dock 控制状态 + setter */
  muted?: boolean;
  setMuted?: (v: boolean) => void;
  video?: boolean;
  setVideo?: (v: boolean) => void;
  hand?: boolean;
  setHand?: (v: boolean) => void;
  cc?: boolean;
  setCC?: (v: boolean) => void;
  /** TD5: 录音状态 — true=录音中 (麦克风右下显红点 livePulse) */
  recording?: boolean;
};

export default function StickyActionBar({
  canControl,
  isAgendaComplete,
  advancing = false,
  onAdvance,
  onSummonAi,
  onEndMeeting,
  onAskHost,
  onMore,
  muted = false,
  setMuted,
  video = false,
  setVideo,
  hand = false,
  setHand,
  cc = true,
  setCC,
  recording = false,
}: Props): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        background:
          "linear-gradient(180deg, rgba(242,242,247,0) 0%, rgba(242,242,247,0.85) 22%, #F2F2F7 60%)",
        paddingTop: 18,
        zIndex: 50,
      }}
      data-testid="mobile-sticky-action-bar"
    >
      {/* canAdvance 简化版小条 (议程未完成时显, controller 才显)
          浅色化 — 改成 dock 上方的小条 */}
      {canControl && !isAgendaComplete ? (
        <div
          style={{
            margin: "0 12px 8px",
            padding: "8px 12px",
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            border: `0.5px solid ${MR_COLORS.hairline}`,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: MR_COLORS.textTertiary,
              flex: 1,
            }}
          >
            议程未完, 主持人可一键推进 →
          </span>
          <button
            type="button"
            onClick={onAdvance}
            disabled={advancing}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              border: "none",
              background: MR_COLORS.systemBlue,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: advancing ? "default" : "pointer",
              opacity: advancing ? 0.6 : 1,
            }}
            data-testid="mobile-advance-agenda"
          >
            {advancing ? "推进中…" : "推进议程"}
          </button>
        </div>
      ) : null}
      {isAgendaComplete && canControl ? (
        <div
          style={{
            margin: "0 12px 8px",
            padding: "8px 12px",
            background: "rgba(52,199,89,0.10)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: `0.5px solid rgba(52,199,89,0.30)`,
          }}
        >
          <MRIcon name="check" size={14} color={MR_COLORS.systemGreen} />
          <span
            style={{
              fontSize: 12,
              color: "#1A6B2A",
              flex: 1,
              fontWeight: 500,
            }}
          >
            议程已全完成 — 点结束按钮进入沉淀
          </span>
        </div>
      ) : null}

      <div
        style={{
          margin: "0 12px",
          background: MR_COLORS.bgWhite,
          borderRadius: 20,
          boxShadow:
            "0 6px 22px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(60,60,67,0.12)",
          padding: "10px 10px 12px",
        }}
      >
        {/* Row 1 — AI engagement */}
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryBtn
            icon="sparkle"
            label="@ AI 专家"
            sub="唤醒领域专家答复"
            bg="linear-gradient(135deg, #AF52DE 0%, #5E5CE6 100%)"
            onClick={onSummonAi}
          />
          <PrimaryBtn
            icon="compass"
            label="问主持人"
            sub="拆解 · 路由 · 议程"
            bg="linear-gradient(135deg, #FFB340 0%, #FF9F0A 100%)"
            onClick={onAskHost}
            hostAvatar
          />
        </div>

        {/* Row 2 — controls */}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <CtrlBtn
            icon={muted ? "mic-off" : "mic"}
            label={muted ? "已静音" : "麦克风"}
            active={muted}
            activeBg={MR_COLORS.systemRed}
            onClick={() => setMuted?.(!muted)}
            badge={recording ? "rec" : undefined}
          />
          <CtrlBtn
            icon={video ? "video" : "video-off"}
            label={video ? "摄像头" : "已关闭"}
            active={!video}
            activeBg={MR_COLORS.textTertiary}
            onClick={() => setVideo?.(!video)}
          />
          <CtrlBtn
            icon="hand"
            label={hand ? "举手中" : "举手"}
            active={hand}
            activeBg={MR_COLORS.systemOrange}
            onClick={() => setHand?.(!hand)}
          />
          <CtrlBtn
            icon="cc"
            label="字幕"
            active={cc}
            activeBg={MR_COLORS.systemBlue}
            onClick={() => setCC?.(!cc)}
          />
          <CtrlBtn
            icon="more"
            label="更多"
            active={false}
            onClick={onMore}
          />
          <CtrlBtn
            icon="end"
            label="结束"
            active
            activeBg={MR_COLORS.systemRed}
            onClick={onEndMeeting}
          />
        </div>
      </div>
    </div>
  );
}

function PrimaryBtn({
  icon,
  label,
  sub,
  bg,
  onClick,
  hostAvatar,
}: {
  icon: MRIconName;
  label: string;
  sub: string;
  bg: string;
  onClick?: () => void;
  hostAvatar?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 52,
        borderRadius: 14,
        background: bg,
        border: "none",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 12px",
        fontFamily: "inherit",
        cursor: "pointer",
        textAlign: "left",
        boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.22)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {hostAvatar ? (
          <MRHostAvatar size={20} ring="rgba(255,255,255,0.4)" />
        ) : (
          <MRIcon name={icon} size={17} color="#fff" />
        )}
      </div>
      <div style={{ minWidth: 0, lineHeight: 1.15 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

function CtrlBtn({
  icon,
  label,
  active,
  activeBg = "#1C1C1E",
  onClick,
  badge,
}: {
  icon: MRIconName;
  label: string;
  active: boolean;
  activeBg?: string;
  onClick?: () => void;
  /** 'rec' = 右下红点 livePulse (录音中) */
  badge?: "rec";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 50,
        borderRadius: 12,
        background: active ? activeBg : "#F2F2F7",
        color: active ? "#fff" : "#1C1C1E",
        border: "none",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "background 120ms ease",
        position: "relative",
      }}
    >
      <MRIcon name={icon} size={18} color={active ? "#fff" : "#1C1C1E"} />
      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.92 }}>
        {label}
      </span>
      {badge === "rec" ? (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: MR_COLORS.systemRed,
            border: "1.5px solid #fff",
            animation: "mr-livePulse 1.4s ease-in-out infinite",
          }}
          aria-label="录音中"
        />
      ) : null}
    </button>
  );
}
