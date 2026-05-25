"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 章节 / 重要时刻 sheet.
 *
 * 设计源 1:1: meeting-room.jsx:315-383 (HighlightsSheet).
 *
 * TD8: 仅 mock (本 Saga 不接后端 timeline 提取). 父级把 highlights
 * (从 mock + host card + round 提取) 推下来.
 */

import type { ReactElement } from "react";

import MRIcon, { type MRIconName } from "../shared/Icon";
import Sheet from "./Sheet";
import { MR_COLORS } from "./styles";

export type HighlightItem = {
  /** 跳转 key (data-mr-key, e.g. "agent-12" / "host-banner-1") */
  jumpKey: string;
  type: "agenda" | "drift" | "strong" | "route" | "round" | "decision";
  icon: MRIconName;
  color: string;
  label: string;
  title: string;
  t: string;
};

type Props = {
  open: boolean;
  highlights: HighlightItem[];
  onClose: () => void;
  onJump: (jumpKey: string) => void;
};

export default function HighlightsSheet({
  open,
  highlights,
  onClose,
  onJump,
}: Props): ReactElement | null {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="章节 · 重要时刻"
      maxHeight="76%"
      testid="mobile-highlights-sheet"
    >
      <div
        style={{
          fontSize: 12,
          color: MR_COLORS.textTertiary,
          padding: "0 4px 10px",
          lineHeight: 1.5,
        }}
      >
        本场会议自动提取的 {highlights.length} 个关键节点 · 点击跳转
      </div>
      {highlights.length === 0 ? (
        <div
          style={{
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            padding: "24px 16px",
            textAlign: "center",
            fontSize: 13,
            color: MR_COLORS.textTertiary,
          }}
        >
          还没有提取到关键节点
        </div>
      ) : (
        <div
          style={{
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {highlights.map((h, i) => (
            <button
              type="button"
              key={`${h.jumpKey}-${i}`}
              onClick={() => {
                onJump(h.jumpKey);
                onClose();
              }}
              data-testid="mobile-highlight-item"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderTop:
                  i === 0
                    ? "none"
                    : `0.5px solid ${MR_COLORS.hairline}`,
                cursor: "pointer",
                background: "transparent",
                border: "none",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: h.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <MRIcon name={h.icon} size={15} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: h.color,
                      letterSpacing: 0.3,
                    }}
                  >
                    {h.label}
                  </span>
                  <span
                    style={{ fontSize: 11, color: MR_COLORS.textTertiary }}
                  >
                    · {h.t}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: MR_COLORS.textPrimary,
                    marginTop: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.title}
                </div>
              </div>
              <MRIcon
                name="chev"
                size={16}
                color={MR_COLORS.textQuaternary}
              />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
