"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 小 atoms.
 *
 * 仅本 Saga 内组件 import — 不导出到全局.
 */

import type { ReactElement } from "react";

/** 5 段绿色 waveform — 用户 speaking 时显. */
export function Waveform({
  active,
  color = "#34C759",
  bars = 5,
}: {
  active: boolean;
  color?: string;
  bars?: number;
}): ReactElement {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 14,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            borderRadius: 2,
            background: color,
            height: active ? 14 : 4,
            animation: active
              ? `mr-wfBar 900ms ease-in-out ${i * 110}ms infinite alternate`
              : "none",
          }}
        />
      ))}
    </div>
  );
}

/** 3 个 bouncing dots — AI 正在思考 / 流式打字. */
export function Dots(): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 3,
        marginLeft: 4,
        alignItems: "center",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#8E8E93",
            animation: `mr-dotBounce 1.1s ease-in-out ${i * 180}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

/** "演示" 紫色角标 (R3 mitigation — mock 圆桌强提示 demo 性质). */
export function DemoBadge(): ReactElement {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: "#fff",
        background: "linear-gradient(135deg, #AF52DE, #5E5CE6)",
        padding: "1px 5px",
        borderRadius: 4,
      }}
    >
      演示
    </span>
  );
}
