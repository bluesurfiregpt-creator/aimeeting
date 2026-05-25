"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-2 · 单行 dock (替代 双行).
 *
 * 设计源 1:1: round-2 design bundle (PM 在 Claude Design 优化的 round-2 -
 *   `/tmp/claude-design-round2/aimeeting/project/meeting-room.jsx:1508-1616`
 *   `ActionBar / AIPill / UtilBtn`).
 *
 * 累计高度: 双行 ~150px → 单行 ~85px (释放 ~65px 给 transcript).
 *
 * 单行结构:
 *   [AI 专家 pill][Mira pill] [麦克风][摄像头][更多]  · GAP · [结束 (大红)]
 *
 * PM round-2 末尾要求:
 *   - 「更多」 和 「结束」 不应该是同等优先级
 *   - 「结束」 独立 (面积更大 + 红色) 突出
 *   - 「更多」 整合进左侧工具区
 *   - 举手 / 字幕 toggle 移到 MoreSheet 里 (PM round-2 设定)
 *
 * Props 兼容 v27.0 旧 props (canControl / isAgendaComplete / currentTopicTitle /
 *   hasRiskInsight / advancing / onAdvance / onSummonAi / onEndMeeting). 维持
 *   旧 controller 推进议程 小条 不动 — 在 dock 上方.
 */

import type { ReactElement } from "react";

import { MRHostAvatar } from "./shared/avatars";
import MRIcon, { type MRIconName } from "./shared/Icon";
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

  // ─── 新 props (v2 引入, round-2 保留) ───
  /** 问主持人 sheet */
  onAskHost?: () => void;
  /** 更多 sheet */
  onMore?: () => void;
  /** dock 控制状态 + setter */
  muted?: boolean;
  setMuted?: (v: boolean) => void;
  video?: boolean;
  setVideo?: (v: boolean) => void;
  /** round-2: hand/cc 不在 dock 显示 (移到 MoreSheet), 但仍透过 props 维持单一
   *  状态源 — 父组件传 + MoreSheet 切换. 此处仅用 hand 控制更多按钮上的红点. */
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
  recording = false,
}: Props): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
        background:
          "linear-gradient(180deg, rgba(242,242,247,0) 0%, rgba(242,242,247,0.94) 38%, #F2F2F7 72%)",
        paddingTop: 10,
        zIndex: 50,
      }}
      data-testid="mobile-sticky-action-bar"
    >
      {/* canAdvance 简化版小条 — 维持 v2 行为 (旧 props 兼容) */}
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

      {/* 单行 dock — 6 个按钮 + 结束独立放大 */}
      <div
        style={{
          margin: "0 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* 工具卡 — AI pill + Mira pill + mic + video + more */}
        <div
          style={{
            flex: 1,
            background: MR_COLORS.bgWhite,
            borderRadius: 18,
            boxShadow:
              "0 4px 16px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(60,60,67,0.10)",
            padding: 7,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <AIPill
            icon="sparkle"
            label="AI 专家"
            bg="linear-gradient(135deg, #AF52DE 0%, #5E5CE6 100%)"
            onClick={onSummonAi}
            testid="mobile-dock-summon"
          />
          <AIPill
            icon="host"
            label="Mira"
            bg="linear-gradient(135deg, #FFB340 0%, #FF9F0A 100%)"
            onClick={onAskHost}
            testid="mobile-dock-ask-host"
          />
          <UtilBtn
            icon={muted ? "mic-off" : "mic"}
            label={muted ? "静音" : "麦"}
            active={muted}
            activeBg={MR_COLORS.systemRed}
            onClick={() => setMuted?.(!muted)}
            testid="mobile-dock-mic"
            badge={recording ? "rec" : undefined}
          />
          <UtilBtn
            icon={video ? "video" : "video-off"}
            label={video ? "视频" : "未开"}
            active={!video}
            activeBg={MR_COLORS.textTertiary}
            onClick={() => setVideo?.(!video)}
            testid="mobile-dock-video"
          />
          <UtilBtn
            icon="more"
            label="更多"
            dot={hand}
            onClick={onMore}
            testid="mobile-dock-more"
          />
        </div>

        {/* 结束 — 独立大红按钮 (PM round-2 末: 面积大 + 红色突出) */}
        <button
          type="button"
          onClick={onEndMeeting}
          data-testid="mobile-dock-end"
          aria-label="结束会议"
          style={{
            width: 64,
            height: 60,
            borderRadius: 16,
            border: "none",
            background: MR_COLORS.systemRed,
            color: "#fff",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            fontFamily: "inherit",
            cursor: "pointer",
            boxShadow:
              "0 4px 14px rgba(255,59,48,0.32), 0 0 0 0.5px rgba(255,59,48,0.40)",
            flexShrink: 0,
          }}
        >
          <MRIcon name="end" size={22} color="#fff" />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              marginTop: 1,
            }}
          >
            结束
          </span>
        </button>
      </div>
    </div>
  );
}

function AIPill({
  icon,
  label,
  bg,
  onClick,
  testid,
}: {
  icon: MRIconName | "host";
  label: string;
  bg: string;
  onClick?: () => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      style={{
        flex: 1.55,
        height: 46,
        borderRadius: 12,
        background: bg,
        border: "none",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        padding: "0 6px",
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
        whiteSpace: "nowrap",
      }}
    >
      {icon === "host" ? (
        <MRHostAvatar size={20} ring="rgba(255,255,255,0.45)" />
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
          }}
        >
          <MRIcon name={icon as MRIconName} size={17} color="#fff" />
        </span>
      )}
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </span>
    </button>
  );
}

function UtilBtn({
  icon,
  label,
  active,
  activeBg = "#1C1C1E",
  onClick,
  dot,
  badge,
  testid,
}: {
  icon: MRIconName;
  label: string;
  active?: boolean;
  activeBg?: string;
  onClick?: () => void;
  /** 橙色提示点 (举手时显, 提示更多里挂着 toggle). */
  dot?: boolean;
  /** 'rec' = 右下红点 livePulse (录音中). */
  badge?: "rec";
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      style={{
        flex: 1,
        height: 46,
        borderRadius: 12,
        background: active ? activeBg : MR_COLORS.bgGroupedPrimary,
        color: active ? "#fff" : MR_COLORS.textPrimary,
        border: "none",
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      <MRIcon
        name={icon}
        size={16}
        color={active ? "#fff" : MR_COLORS.textPrimary}
      />
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          marginTop: 1,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </span>
      {dot ? (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: MR_COLORS.systemOrange,
            border: `1.5px solid ${MR_COLORS.bgWhite}`,
          }}
          aria-label="举手中"
        />
      ) : null}
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
            border: `1.5px solid ${MR_COLORS.bgWhite}`,
            animation: "mr-livePulse 1.4s ease-in-out infinite",
          }}
          aria-label="录音中"
        />
      ) : null}
    </button>
  );
}
