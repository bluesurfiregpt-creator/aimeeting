"use client";

/**
 * v1.4.0 · Saga P-1 · 底滑全屏 modal portal (M7 新建会议 + 后续半屏弹窗复用).
 *
 * 设计目标: iOS 风格 sheet — 从屏底滑入, 顶部 "取消" iOS 蓝 link, 中间 title.
 *
 * 用法:
 *   <MASheet open={open} onClose={() => setOpen(false)} title="新建会议">
 *     <Content />
 *   </MASheet>
 *
 * 实现:
 *   - React Portal 挂 document.body — 避开父级 stacking context / overflow
 *   - backdrop rgba(0,0,0,0.32) onClick 关
 *   - 面板 transform translateY(100% → 0), transition 300ms cubic-bezier
 *   - 内容区 overflow-y auto, 100vh - header(54px) - safe-area
 *   - z-index 1000 (单一, 不嵌套)
 *   - ESC 键关闭
 *
 * 与 design system: iOS 蓝 link #007AFF · canvas #F2F2F7 · header 17px weight 600.
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** 右上角扩展位 (e.g. "完成" 按钮). 不传则 reserved 空白. */
  rightSlot?: ReactNode;
  /** 左上角文字 — 默认 "取消", 可换 "返回" 等. */
  leftLabel?: string;
};

const HEADER_H = 54;
const ANIM_MS = 300;
// iOS cubic — 滑入 / 滑出 同一条 curve, 避免 jitter
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export default function MASheet({
  open,
  onClose,
  title,
  children,
  rightSlot,
  leftLabel = "取消",
}: Props): ReactElement | null {
  // mounted: 控制 DOM 是否挂载 (portal). false 时 unmount.
  // visible: 控制 transform — open true 后 next frame 翻 true 才触发 transition.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closingTimer = useRef<number | null>(null);

  // open=true → mount + 下一帧 visible=true
  // open=false → visible=false → 等 300ms → unmount
  useEffect(() => {
    if (open) {
      if (closingTimer.current) {
        window.clearTimeout(closingTimer.current);
        closingTimer.current = null;
      }
      setMounted(true);
      // 下一帧 翻 visible — 否则 transform 起始态 / 终态 在同一帧, 不动画
      const id = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(id);
    } else {
      setVisible(false);
      closingTimer.current = window.setTimeout(() => {
        setMounted(false);
        closingTimer.current = null;
      }, ANIM_MS);
      return () => {
        if (closingTimer.current) {
          window.clearTimeout(closingTimer.current);
          closingTimer.current = null;
        }
      };
    }
  }, [open]);

  // ESC 关
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // body scroll 锁 — sheet 打开时禁止背景滚动
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        pointerEvents: open ? "auto" : "none",
      }}
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          opacity: visible ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ${EASE}`,
        }}
      />

      {/* Sheet panel */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          top: 0,
          background: "#F2F2F7",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${ANIM_MS}ms ${EASE}`,
          willChange: "transform",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header — 固定 54px */}
        <div
          style={{
            height: HEADER_H,
            minHeight: HEADER_H,
            paddingTop: "env(safe-area-inset-top, 0px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            background: "rgba(242,242,247,0.96)",
            backdropFilter: "saturate(180%) blur(16px)",
            WebkitBackdropFilter: "saturate(180%) blur(16px)",
            borderBottom: "0.5px solid rgba(60,60,67,0.18)",
            position: "relative",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 4px",
              color: "#007AFF",
              fontSize: 17,
              fontWeight: 400,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              minWidth: 64,
              textAlign: "left",
            }}
          >
            {leftLabel}
          </button>
          {title ? (
            <h2
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: 17,
                fontWeight: 600,
                color: "#000",
                margin: 0,
                maxWidth: "55%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h2>
          ) : null}
          <div
            style={{
              minWidth: 64,
              textAlign: "right",
              fontSize: 17,
            }}
          >
            {rightSlot}
          </div>
        </div>

        {/* Content — overflow-y auto, 100vh - header - safe-area-bottom */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
