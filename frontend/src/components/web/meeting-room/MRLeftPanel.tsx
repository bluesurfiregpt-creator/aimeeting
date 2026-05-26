"use client";

/**
 * R5.D Web 会议室 左侧栏 (280px):
 *  - ExpertsPanel — 4 个 AI 专家卡 (点击 → 筛选 timeline)
 *  - TimelineHighlights — agenda 切换 / drift / round 高光锚点
 *
 * 设计源: `meeting-room-web.jsx:378-532`.
 */

import { useMemo } from "react";
import {
  MR_AI_IDS,
  MR_AGENTS_IN_MEETING,
  getAIUsage,
  getMRHighlights,
} from "./data";
import { MRAIAvatar, MRIcon, MRSectionLabel } from "./atoms";

export type MRLeftPanelProps = {
  selected: Set<string>;
  onToggleSpeaker: (k: string) => void;
  onJumpToMessage: (idx: number) => void;
};

export function MRLeftPanel({
  selected,
  onToggleSpeaker,
  onJumpToMessage,
}: MRLeftPanelProps) {
  return (
    <div
      style={{
        width: 280,
        background: "#FAFAFA",
        borderRight: "0.5px solid #E5E5EA",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, overflow: "auto", padding: "18px 14px 16px" }}>
        <ExpertsPanel selected={selected} onToggle={onToggleSpeaker} />
        <div style={{ height: 22 }} />
        <TimelineHighlights onJump={onJumpToMessage} />
      </div>
    </div>
  );
}

// ────────────── ExpertsPanel ──────────────
function ExpertsPanel({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (k: string) => void;
}) {
  const usage = useMemo(() => getAIUsage(), []);
  const selectedCount = MR_AI_IDS.filter((k) => selected.has(k)).length;
  return (
    <div>
      <MRSectionLabel
        right={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {selectedCount > 0 && (
              <span style={{ color: "#007AFF", fontWeight: 600 }}>
                已选 {selectedCount}
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                cursor: "pointer",
              }}
            >
              <MRIcon name="plus" size={10} color="#007AFF" />
              添加
            </span>
          </span>
        }
      >
        AI 专家 · {MR_AI_IDS.length}
      </MRSectionLabel>
      <div
        style={{
          fontSize: 11,
          color: "#8E8E93",
          padding: "0 2px 8px",
          lineHeight: 1.5,
        }}
      >
        点击卡片选中专家 · 选中后 timeline 仅显示其发言
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {MR_AI_IDS.map((k) => (
          <ExpertCard
            key={k}
            id={k}
            selected={selected.has(k)}
            onClick={() => onToggle(k)}
            count={usage[k]?.count ?? 0}
            last={usage[k]?.last ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function ExpertCard({
  id,
  selected,
  onClick,
  count,
  last,
}: {
  id: string;
  selected: boolean;
  onClick: () => void;
  count: number;
  last: string | null;
}) {
  const a = MR_AGENTS_IN_MEETING[id];
  if (!a) return null;
  const active = count > 0;
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? "rgba(0,122,255,0.06)" : "#fff",
        borderRadius: 11,
        border: selected ? "1.5px solid #007AFF" : "0.5px solid #E5E5EA",
        padding: selected ? "8.5px 10.5px" : "9.5px 11.5px",
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        transition: "background 140ms ease",
        boxShadow: selected ? "0 1px 6px rgba(0,122,255,0.10)" : "none",
      }}
    >
      {!selected && (
        <div
          style={{
            position: "absolute",
            top: -16,
            right: -16,
            width: 52,
            height: 52,
            borderRadius: "50%",
            opacity: 0.1,
            background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
            pointerEvents: "none",
          }}
        />
      )}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 16,
            height: 16,
            borderRadius: 4,
            background: "#007AFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MRIcon name="check" size={11} color="#fff" />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          position: "relative",
        }}
      >
        <MRAIAvatar id={id} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
              {a.name}
            </span>
            {active && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: "#34C759",
                  background: "rgba(52,199,89,0.12)",
                  padding: "1.5px 5px",
                  borderRadius: 3,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "#34C759",
                    animation: "mrLivePulse 1.4s ease-in-out infinite",
                  }}
                />
                已答 {count}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 1 }}>
            {a.roleShort}
          </div>
        </div>
      </div>
      {last && (
        <div
          style={{
            marginTop: 7,
            fontSize: 11,
            color: "#8E8E93",
            lineHeight: 1.4,
            paddingLeft: 8,
            borderLeft: `2px solid ${selected ? "#007AFF55" : a.grad[0] + "55"}`,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          “{last}”
        </div>
      )}
    </div>
  );
}

// ────────────── TimelineHighlights ──────────────
function TimelineHighlights({ onJump }: { onJump: (idx: number) => void }) {
  const hl = useMemo(() => getMRHighlights(), []);
  return (
    <div>
      <MRSectionLabel right={`${hl.length} 个`}>时间线高光</MRSectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {hl.map((h, i) => (
          <div
            key={i}
            onClick={() => onJump(h.idx)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#fff",
              border: "0.5px solid #E5E5EA",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: h.color,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              <MRIcon
                name={
                  h.icon === "check"
                    ? "check"
                    : h.icon === "compass"
                      ? "compass"
                      : h.icon === "route"
                        ? "route"
                        : "sparkle"
                }
                size={11}
                color="#fff"
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: h.color,
                  letterSpacing: 0.3,
                }}
              >
                {h.label}{" "}
                <span style={{ color: "#C7C7CC", fontWeight: 400 }}>
                  · {h.t}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#1C1C1E",
                  marginTop: 1,
                  lineHeight: 1.35,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {h.title}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
