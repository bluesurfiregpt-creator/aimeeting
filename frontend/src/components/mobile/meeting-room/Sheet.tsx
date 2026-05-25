"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 浅色 iOS sheet 通用壳.
 *
 * 内部用 — 不导出到全局. 给 Highlights / Filter / AskHost / More 复用.
 */

import type { ReactElement, ReactNode } from "react";

import { MR_COLORS, MR_FONT_FAMILY } from "./styles";

type Props = {
  open: boolean;
  title: ReactNode;
  /** 顶部左侧文字按钮 (e.g. "清空") — 空则占位平衡布局 */
  leftAction?: { label: string; onClick: () => void; disabled?: boolean } | null;
  /** 顶部右侧文字按钮 (默认 "完成") */
  rightAction?: { label: string; onClick: () => void };
  onClose: () => void;
  /** 最大高度比例 (默认 78%) */
  maxHeight?: string;
  children: ReactNode;
  testid?: string;
};

export default function Sheet({
  open,
  title,
  leftAction = null,
  rightAction,
  onClose,
  maxHeight = "78%",
  children,
  testid,
}: Props): ReactElement | null {
  if (!open) return null;
  const right = rightAction || { label: "完成", onClick: onClose };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        fontFamily: MR_FONT_FAMILY,
      }}
      data-testid={testid}
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          border: "none",
          padding: 0,
          cursor: "pointer",
          animation: "mr-fadeIn 180ms ease",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: MR_COLORS.bgGroupedPrimary,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          zIndex: 81,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          animation: "mr-slideUp 240ms cubic-bezier(.22,.61,.36,1)",
          maxHeight,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "center", paddingTop: 6 }}
        >
          <div
            style={{
              width: 36,
              height: 5,
              borderRadius: 3,
              background: MR_COLORS.separator,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 6px",
            minHeight: 30,
            gap: 8,
          }}
        >
          {leftAction ? (
            <button
              type="button"
              onClick={leftAction.onClick}
              disabled={leftAction.disabled}
              style={{
                background: "none",
                border: "none",
                color: leftAction.disabled
                  ? MR_COLORS.textQuaternary
                  : MR_COLORS.systemBlue,
                fontSize: 16,
                fontFamily: "inherit",
                cursor: leftAction.disabled ? "default" : "pointer",
                minWidth: 50,
                textAlign: "left",
                padding: 0,
              }}
            >
              {leftAction.label}
            </button>
          ) : (
            <div style={{ minWidth: 50 }} />
          )}
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
              flex: 1,
              textAlign: "center",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          <button
            type="button"
            onClick={right.onClick}
            style={{
              background: "none",
              border: "none",
              color: MR_COLORS.systemBlue,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              minWidth: 50,
              textAlign: "right",
              padding: 0,
            }}
          >
            {right.label}
          </button>
        </div>
        <div
          style={{
            padding: "4px 16px 0",
            overflow: "auto",
            minHeight: 0,
            flex: 1,
          }}
        >
          {children}
          <div style={{ height: 12 }} />
        </div>
      </div>
    </div>
  );
}
