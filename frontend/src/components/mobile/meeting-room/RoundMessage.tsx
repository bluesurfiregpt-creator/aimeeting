"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · AI 圆桌核心卡 (C5).
 *
 * 设计源 1:1: meeting-room.jsx:39-252 (StancePill / StanceDot / MiraSynthesis
 * / ExpertAccordion / RoundMessage).
 *
 * R3 mitigation: header 加紫色 "演示" 角标 (DemoBadge), 让用户清楚这是 mock.
 *
 * 行为:
 *   - 一次只展开一个 expert accordion
 *   - "记入决策" / "详细数据" 按钮 onClick = onDemoAction (父级 toast "demo 后续接入")
 */

import { useState } from "react";
import type { ReactElement } from "react";

import { Dots, DemoBadge } from "../meeting-room/atoms";
import { MOCK_AIS, MOCK_HUMANS, MRAIAvatar, MRHostAvatar } from "../shared/avatars";
import MRIcon from "../shared/Icon";
import { MR_COLORS } from "./styles";
import type {
  MockRoundMessage,
  RoundExpertContribution,
  RoundMiraSummary,
  RoundStance,
} from "./mock/roundtable";

const STANCE_COLOR: Record<RoundStance, string> = {
  support: "#34C759",
  caution: "#FF9F0A",
  block: "#FF3B30",
};
const STANCE_LABEL: Record<RoundStance, string> = {
  support: "支持",
  caution: "注意",
  block: "反对",
};

function StancePill({
  stance,
  small,
}: {
  stance: RoundStance;
  small?: boolean;
}) {
  return (
    <span
      style={{
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        color: "#fff",
        letterSpacing: 0.3,
        background: STANCE_COLOR[stance],
        padding: small ? "1px 5px" : "1.5px 6px",
        borderRadius: 3,
        flexShrink: 0,
        lineHeight: 1.2,
      }}
    >
      {STANCE_LABEL[stance]}
    </span>
  );
}

function StanceDot({
  stance,
  size = 14,
}: {
  stance: RoundStance;
  size?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: STANCE_COLOR[stance],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {stance === "support" && (
        <MRIcon name="check" size={size * 0.65} color="#fff" />
      )}
      {stance === "caution" && (
        <span
          style={{
            color: "#fff",
            fontSize: size * 0.72,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          !
        </span>
      )}
      {stance === "block" && (
        <span
          style={{
            color: "#fff",
            fontSize: size * 0.85,
            lineHeight: 0.7,
          }}
        >
          ×
        </span>
      )}
    </span>
  );
}

function MiraSynthesis({
  summary,
  doneCount,
  total,
}: {
  summary: RoundMiraSummary | null;
  doneCount: number;
  total: number;
}) {
  if (!summary) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.08))",
          borderBottom: "0.5px solid rgba(255,159,10,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <MRHostAvatar size={20} />
        <span style={{ fontSize: 13, color: "#8B6914" }}>
          Mira 等待 {total - doneCount} 位专家完成…
        </span>
        <Dots />
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "12px 14px",
        background:
          "linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.10))",
        borderBottom: "0.5px solid rgba(255,159,10,0.20)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <MRHostAvatar size={22} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: MR_COLORS.textPrimary,
          }}
        >
          Mira 综合
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#8B6914",
            fontWeight: 700,
            background: "rgba(255,159,10,0.15)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          {summary.verdict}
        </span>
        {summary.conflict && (
          <span
            style={{
              fontSize: 10,
              color: "#fff",
              fontWeight: 700,
              background: MR_COLORS.systemRed,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            存在分歧
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {summary.points.map((p, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
          >
            <span style={{ marginTop: 3 }}>
              <StanceDot stance={p.stance} size={14} />
            </span>
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                color: MR_COLORS.textPrimary,
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.tag}:</span>
              <span style={{ color: MR_COLORS.textSecondary }}> {p.text}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 9,
          padding: "8px 10px",
          background: MR_COLORS.bgWhite,
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.5,
          color: MR_COLORS.textPrimary,
          border: "0.5px solid rgba(255,159,10,0.20)",
        }}
      >
        <span style={{ fontWeight: 700, color: MR_COLORS.systemOrange }}>
          → 建议
        </span>
        <span style={{ marginLeft: 5 }}>{summary.recommendation}</span>
      </div>
    </div>
  );
}

function ExpertAccordion({
  expert,
  open,
  onToggle,
  onDemoAction,
}: {
  expert: RoundExpertContribution;
  open: boolean;
  onToggle: () => void;
  onDemoAction?: () => void;
}) {
  const a = MOCK_AIS[expert.who];
  return (
    <div style={{ borderTop: "0.5px solid rgba(60,60,67,0.10)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          background: open ? "#FAFAFA" : MR_COLORS.bgWhite,
          border: "none",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <MRAIAvatar grad={a.grad} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
            <StancePill stance={expert.stance} />
            <span style={{ fontSize: 11, color: MR_COLORS.textTertiary }}>
              {a.role}
            </span>
            {!expert.done && (
              <span
                style={{
                  fontSize: 10,
                  color: MR_COLORS.systemPurple,
                  fontWeight: 600,
                }}
              >
                分析中
                <Dots />
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: MR_COLORS.textSecondary,
              marginTop: 2,
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: open ? "normal" : "nowrap",
            }}
          >
            {expert.headline}
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            color: MR_COLORS.textQuaternary,
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 180ms ease",
          }}
        >
          <MRIcon name="chev" size={16} color={MR_COLORS.textQuaternary} />
        </div>
      </button>

      {open && expert.done ? (
        <div style={{ padding: "2px 14px 14px" }}>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: MR_COLORS.textPrimary,
              marginBottom: 9,
            }}
          >
            {expert.summary}
          </div>
          {expert.data ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${expert.data.length}, 1fr)`,
                gap: 6,
                marginBottom: 9,
              }}
            >
              {expert.data.map((row, i) => (
                <div
                  key={i}
                  style={{
                    background: MR_COLORS.bgInputFill,
                    borderRadius: 8,
                    padding: "7px 9px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: MR_COLORS.textTertiary,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      marginTop: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.v}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {expert.note ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: MR_COLORS.textSecondary,
                padding: "8px 10px",
                borderRadius: 8,
                background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
                border: `0.5px solid ${a.grad[0]}33`,
              }}
            >
              {expert.note}
            </div>
          ) : null}
          {onDemoAction ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onDemoAction}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 8,
                  border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
                  background: MR_COLORS.bgWhite,
                  color: MR_COLORS.systemBlue,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                详细数据
              </button>
              <button
                type="button"
                onClick={onDemoAction}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: MR_COLORS.systemBlue,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                记入决策
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  round: MockRoundMessage;
  /** initialOpen 用于筛选时自动展开命中的 expert */
  initialOpen?: string | null;
  onDemoAction?: () => void;
};

export default function RoundMessage({
  round,
  initialOpen = null,
  onDemoAction,
}: Props): ReactElement {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const doneCount = round.experts.filter((e) => e.done).length;
  const triggerName = MOCK_HUMANS[round.trigger.by]?.name || "User";

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          background: MR_COLORS.bgWhite,
          borderRadius: 14,
          border: `0.5px solid ${MR_COLORS.hairline}`,
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "11px 14px 9px",
            background:
              "linear-gradient(135deg, rgba(94,92,230,0.05), rgba(175,82,222,0.07))",
            borderBottom: "0.5px solid rgba(60,60,67,0.10)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <MRIcon name="sparkle" size={14} color={MR_COLORS.systemPurple} />
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: MR_COLORS.systemPurple,
                letterSpacing: 0.4,
              }}
            >
              AI 圆桌 · {doneCount}/{round.experts.length} 已答
            </span>
            <DemoBadge />
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: MR_COLORS.textTertiary,
              }}
            >
              {triggerName} 发起 · {round.t}
            </span>
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginTop: 4,
              lineHeight: 1.35,
              color: MR_COLORS.textPrimary,
            }}
          >
            “{round.topic}”
          </div>
        </div>

        {/* Mira synthesis */}
        <MiraSynthesis
          summary={round.done ? round.miraSummary : null}
          doneCount={doneCount}
          total={round.experts.length}
        />

        {/* Experts accordion */}
        <div
          style={{
            padding: "7px 14px 6px",
            fontSize: 10.5,
            fontWeight: 700,
            color: MR_COLORS.textTertiary,
            letterSpacing: 0.4,
            background: MR_COLORS.bgWhite,
          }}
        >
          点击展开专家详情 · 一次只展开一位, timeline 不跳动
        </div>
        {round.experts.map((e) => (
          <ExpertAccordion
            key={e.who}
            expert={e}
            open={open === e.who}
            onToggle={() => setOpen(open === e.who ? null : e.who)}
            onDemoAction={onDemoAction}
          />
        ))}
      </div>
    </div>
  );
}
