"use client";

import { useEffect, type ReactNode } from "react";
import { W_TOKENS } from "../tokens";

/**
 * 居中弹窗 — backdrop blur + scaled card + esc 关闭.
 * 240ms cubic-bezier 入场 (跟设计稿 wModalIn keyframe 对齐).
 */
export function WModal({
  open,
  onClose,
  children,
  maxWidth = 720,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(8,7,18,0.65)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "wFadeIn 200ms ease forwards",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth,
          maxHeight: "90vh",
          overflowY: "auto",
          background: W_TOKENS.surface,
          borderRadius: 18,
          boxShadow:
            "0 24px 60px rgba(0,0,0,0.50), 0 0 0 0.5px rgba(255,255,255,0.10)",
          position: "relative",
          animation: "wModalIn 240ms cubic-bezier(.22,.61,.36,1) forwards",
        }}
      >
        {children}
      </div>
    </div>
  );
}
