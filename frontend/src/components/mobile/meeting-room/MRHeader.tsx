"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 顶栏.
 *
 * 设计源 1:1: meeting-room.jsx:386-446.
 *
 *  - 左: ← 历史 (ongoing 时点 = onBack 弹 LeaveSheet; finished/scheduled 直返)
 *  - 中: 标题 (1 行 truncate) + 实时红点 livePulse + timer
 *  - 右: 章节 button (menu icon) + 筛选 button (filter icon + 激活蓝点)
 *
 * R10: 实时红点替代原 ConnDot, conn 状态收进 livePulse 颜色 (默认红 / 重连琥珀 / 失败灰).
 */

import type { ReactElement } from "react";

import MRIcon from "../shared/Icon";
import { MR_COLORS } from "./styles";

type Props = {
  title: string;
  /** "23:14" 风格 timer (后端给 started_minutes_ago, 父转 mm:ss) */
  timerText: string;
  /** "live" | "reconnecting" | "lost" | "idle" */
  liveState: "live" | "reconnecting" | "lost" | "idle";
  /** 是否显筛选激活角标 */
  filterActive: boolean;
  onBack: () => void;
  onChapters: () => void;
  onFilter: () => void;
};

export default function MRHeader({
  title,
  timerText,
  liveState,
  filterActive,
  onBack,
  onChapters,
  onFilter,
}: Props): ReactElement {
  const liveColor =
    liveState === "live"
      ? MR_COLORS.systemRed
      : liveState === "reconnecting"
        ? MR_COLORS.systemAmber
        : liveState === "lost"
          ? MR_COLORS.textTertiary
          : MR_COLORS.textTertiary;
  const liveLabel =
    liveState === "live"
      ? "实时"
      : liveState === "reconnecting"
        ? "重连中"
        : liveState === "lost"
          ? "已断开"
          : "未连接";
  return (
    <div
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
        background: MR_COLORS.bgWhite,
        borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          padding: "0 4px",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            color: MR_COLORS.systemBlue,
            background: "none",
            border: "none",
            display: "inline-flex",
            alignItems: "center",
            padding: "0 8px",
            height: 44,
            fontSize: 17,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
          aria-label="返回 / 历史"
        >
          <MRIcon name="back" size={22} color={MR_COLORS.systemBlue} />
          <span style={{ marginLeft: 2 }}>历史</span>
        </button>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.1,
              color: MR_COLORS.textPrimary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "0 4px",
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              fontSize: 11,
              color: liveColor,
              marginTop: 2,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: liveColor,
                animation:
                  liveState === "live" || liveState === "reconnecting"
                    ? "mr-livePulse 1.4s ease-in-out infinite"
                    : "none",
              }}
            />
            <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>
              {liveLabel}
            </span>
            <span style={{ color: MR_COLORS.textTertiary }}>· {timerText}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onChapters}
          aria-label="章节"
          style={{
            width: 36,
            height: 44,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: MR_COLORS.systemBlue,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MRIcon name="menu" size={20} color={MR_COLORS.systemBlue} />
        </button>
        <button
          type="button"
          onClick={onFilter}
          aria-label="筛选发言人"
          style={{
            width: 36,
            height: 44,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: MR_COLORS.systemBlue,
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MRIcon name="filter" size={20} color={MR_COLORS.systemBlue} />
          {filterActive ? (
            <span
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: MR_COLORS.systemBlue,
                border: "1.5px solid #fff",
              }}
            />
          ) : null}
        </button>
      </div>
    </div>
  );
}
