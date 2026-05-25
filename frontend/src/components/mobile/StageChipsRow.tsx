"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · AgendaStrip (议程 strip + segmented progress bar).
 *
 * 设计源 1:1: meeting-room.jsx:449-487 (AgendaStrip).
 *
 * 旧版 (v27.0): dark chip row 横滑. 新版: 单行 "议程 X/N · title · 剩余分钟" +
 * 下方 segmented progress bar (每段 flex=item.minutes, done=绿 / active=蓝渐变 /
 * pending=灰).
 *
 * props 兼容旧版 (items / currentIdx / isComplete). 不变.
 */

import type { ReactElement } from "react";
import type { MobileMeetingAgendaItem } from "@/lib/mobile/types";

import { MR_COLORS } from "./meeting-room/styles";
import MRIcon from "./shared/Icon";

type Props = {
  items: MobileMeetingAgendaItem[];
  currentIdx: number | null;
  isComplete: boolean;
};

export default function StageChipsRow({
  items,
  currentIdx,
  isComplete,
}: Props): ReactElement | null {
  if (items.length === 0) return null;

  // 当前议程 — 默认拿 currentIdx, 否则用第一个 pending
  const cur = (() => {
    if (isComplete) return null;
    if (currentIdx !== null && items[currentIdx]) return items[currentIdx];
    return items.find((it) => it.status === "active") || items[0];
  })();

  const remaining = (() => {
    if (!cur) return null;
    if (cur.time_budget_min === null) return null;
    const elapsed = cur.elapsed_min || 0;
    return Math.max(0, cur.time_budget_min - elapsed);
  })();

  return (
    <div
      style={{
        background: MR_COLORS.bgWhite,
        padding: "8px 16px 12px",
        borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-stage-chips"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: MR_COLORS.textTertiary,
              letterSpacing: 0.3,
              flexShrink: 0,
            }}
          >
            议程{" "}
            {isComplete
              ? `${items.length}/${items.length}`
              : `${(currentIdx ?? 0) + 1}/${items.length}`}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {isComplete ? "议程已全完成" : cur?.title || "(未指定议题)"}
          </span>
        </div>
        {!isComplete && remaining !== null ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 12,
              color: MR_COLORS.systemOrange,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <MRIcon name="clock" size={13} color={MR_COLORS.systemOrange} />
            剩 {remaining} 分钟
          </div>
        ) : null}
      </div>
      {/* segmented progress bar */}
      <div style={{ display: "flex", gap: 4 }}>
        {items.map((it) => {
          // 旧 status 字段: done / active / pending
          const done =
            it.status === "done" ||
            (currentIdx !== null && it.idx < currentIdx) ||
            isComplete;
          const active = it.idx === currentIdx && !isComplete;
          const flex = it.time_budget_min || 5;
          const bg = done
            ? MR_COLORS.systemGreen
            : active
              ? "linear-gradient(90deg, #007AFF 70%, rgba(0,122,255,0.25) 70%)"
              : MR_COLORS.separatorLight;
          return (
            <div
              key={it.idx}
              style={{
                flex,
                height: 4,
                borderRadius: 2,
                background: bg,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
