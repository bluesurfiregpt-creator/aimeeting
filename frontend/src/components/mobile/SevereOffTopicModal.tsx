"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 严重跑题 iOS 居中弹窗.
 *
 * 设计源: meeting-room.jsx:1486-1524 (EndConfirm 同形) 红色变体 + 倒计时.
 *
 * 改造 (TD4): 280px iOS 居中 modal + 浅色 #F5F5F7 + backdrop blur + hairline
 * 分隔. 行为保留: 倒计时 + 自动召唤主持人. 视觉换.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import {
  MRAIAvatar,
  gradientForAgentColor,
} from "./meeting-room/avatars";
import MRIcon from "./meeting-room/MRIcon";
import { MR_COLORS, MR_FONT_FAMILY } from "./meeting-room/styles";

export type SevereData = {
  offTopicSummary: string;
  currentAgendaItem: string | null;
  suggestedAgendaItem: string | null;
  moderatorAgentId: string;
  moderatorAgentName: string;
  moderatorAgentColor?: string | null;
  invokeQuery: string;
  autoSummonAfterSec: number;
};

type Props = {
  data: SevereData | null;
  onSummon: (agentId: string, query: string) => void;
  onDismiss: () => void;
};

export default function SevereOffTopicModal({
  data,
  onSummon,
  onDismiss,
}: Props): ReactElement | null {
  const [remaining, setRemaining] = useState<number>(
    data?.autoSummonAfterSec ?? 0,
  );
  const summonRef = useRef(onSummon);
  summonRef.current = onSummon;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!data) return;
    setRemaining(data.autoSummonAfterSec);
    const startedAt = Date.now();
    const totalMs = data.autoSummonAfterSec * 1000;
    const it = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, (totalMs - elapsed) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(it);
        summonRef.current(data.moderatorAgentId, data.invokeQuery);
        dismissRef.current();
      }
    }, 250);
    return () => clearInterval(it);
  }, [data]);

  if (!data) return null;
  const grad = gradientForAgentColor(data.moderatorAgentColor);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        fontFamily: MR_FONT_FAMILY,
      }}
      data-testid="mobile-severe-offtopic-modal"
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          animation: "mr-fadeIn 180ms ease",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 300,
          maxWidth: "calc(100vw - 32px)",
          zIndex: 91,
          background: "rgba(245,245,247,0.98)",
          borderRadius: 14,
          overflow: "hidden",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          animation: "mr-popIn 200ms cubic-bezier(.22,.61,.36,1)",
          border: `1px solid ${MR_COLORS.urgentBorder}`,
        }}
      >
        {/* 顶部 — 红色脉冲 + 标题 */}
        <div
          style={{
            padding: "18px 16px 12px",
            textAlign: "center",
            background: MR_COLORS.urgentBg,
            borderBottom: `0.5px solid ${MR_COLORS.urgentBorder}`,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              color: MR_COLORS.systemRed,
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: MR_COLORS.systemRed,
                animation: "mr-livePulse 1.2s ease-in-out infinite",
              }}
            />
            强提醒 · 议题严重偏离
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            讨论已远离当前议程
          </div>
        </div>

        {/* 内容 */}
        <div style={{ padding: "14px 16px 8px" }}>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: MR_COLORS.textTertiary,
                letterSpacing: 0.3,
              }}
            >
              当前议程
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: MR_COLORS.textPrimary,
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {data.currentAgendaItem || "(未指定)"}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: MR_COLORS.textTertiary,
                letterSpacing: 0.3,
              }}
            >
              讨论方向
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: MR_COLORS.textSecondary,
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {data.offTopicSummary}
            </div>
          </div>
          {data.suggestedAgendaItem ? (
            <div
              style={{
                background: MR_COLORS.hostBg,
                border: `0.5px solid ${MR_COLORS.hostBorder}`,
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: MR_COLORS.systemOrange,
                  letterSpacing: 0.3,
                }}
              >
                建议跳转议程
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  color: MR_COLORS.textPrimary,
                  marginTop: 2,
                  lineHeight: 1.4,
                }}
              >
                {data.suggestedAgendaItem}
              </div>
            </div>
          ) : null}

          {/* 倒计时 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 12,
              color: MR_COLORS.textTertiary,
              padding: "8px 0 0",
            }}
          >
            <MRIcon name="clock" size={12} color={MR_COLORS.textTertiary} />
            {remaining > 0 ? (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: MR_COLORS.systemRed,
                  }}
                >
                  {Math.ceil(remaining)}
                </span>{" "}
                秒后自动召唤{" "}
                <span style={{ fontWeight: 500 }}>
                  {data.moderatorAgentName}
                </span>
              </span>
            ) : (
              <span>正在召唤…</span>
            )}
          </div>
        </div>

        {/* 双按钮 — iOS 风 hairline 分隔 */}
        <div
          style={{
            display: "flex",
            borderTop: `0.5px solid ${MR_COLORS.hairlineStrong}`,
          }}
        >
          <button
            type="button"
            onClick={() => dismissRef.current()}
            style={{
              flex: 1,
              height: 44,
              background: "none",
              border: "none",
              color: MR_COLORS.systemBlue,
              fontSize: 16,
              fontFamily: "inherit",
              cursor: "pointer",
              borderRight: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            }}
          >
            我知道了
          </button>
          <button
            type="button"
            onClick={() => {
              summonRef.current(data.moderatorAgentId, data.invokeQuery);
              dismissRef.current();
            }}
            data-testid="mobile-severe-summon"
            style={{
              flex: 1.4,
              height: 44,
              background: "none",
              border: "none",
              color: MR_COLORS.systemRed,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <MRAIAvatar grad={grad} size={18} ring="transparent" />
            召唤 {data.moderatorAgentName}
          </button>
        </div>
      </div>
    </div>
  );
}
