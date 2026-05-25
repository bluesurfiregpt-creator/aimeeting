"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 结束会议 iOS 居中弹窗.
 *
 * 设计源 1:1: meeting-room.jsx:1486-1524 (EndConfirm).
 *
 * 替代 ConfirmDialog (仅 meeting room scope, 不动 ConfirmDialog 本体).
 */

import type { ReactElement } from "react";

import { MR_COLORS, MR_FONT_FAMILY } from "./styles";

type Props = {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function EndConfirm({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: Props): ReactElement | null {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        fontFamily: MR_FONT_FAMILY,
      }}
      data-testid="mobile-end-confirm"
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
          width: 280,
          maxWidth: "calc(100vw - 32px)",
          zIndex: 91,
          background: "rgba(245,245,247,0.98)",
          borderRadius: 14,
          overflow: "hidden",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          animation: "mr-popIn 200ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        <div
          style={{
            padding: "20px 16px 14px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            结束会议?
          </div>
          <div
            style={{
              fontSize: 13,
              color: MR_COLORS.textSecondary,
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
            主持人 Mira 会自动整理 AI 摘要、决策项与行动项, 完成后发到群里.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            borderTop: `0.5px solid ${MR_COLORS.hairlineStrong}`,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              height: 44,
              background: "none",
              border: "none",
              color: MR_COLORS.systemBlue,
              fontSize: 17,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              borderRight: `0.5px solid ${MR_COLORS.hairlineStrong}`,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="mobile-end-confirm-yes"
            style={{
              flex: 1,
              height: 44,
              background: "none",
              border: "none",
              color: MR_COLORS.systemRed,
              fontSize: 17,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "结束中…" : "结束"}
          </button>
        </div>
      </div>
    </div>
  );
}
