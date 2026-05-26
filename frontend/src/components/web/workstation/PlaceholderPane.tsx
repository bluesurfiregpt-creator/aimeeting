"use client";

import { W_TOKENS } from "../tokens";
import { WCard, WIcon, type WIconName } from "../atoms";
import { PaneHeader } from "./PaneHeader";

/**
 * R5.A 占位 pane — 给还没实施的 panes 用.
 *
 * 后续 R5.B / R5.C / R5.D 逐步替换为真实 pane 组件.
 *
 * 显示: header (title + sub) + 居中大 icon + "下一轮迭代" 文案.
 */
export function PlaceholderPane({
  title,
  sub,
  icon = "sparkle",
  hint = "已在路线图中 · 当前优先级低于核心三件套",
}: {
  title: string;
  sub?: string;
  icon?: WIconName;
  hint?: string;
}) {
  return (
    <>
      <PaneHeader title={title} sub={sub} />
      <WCard padding={0}>
        <div style={{ padding: "60px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              margin: "0 auto 16px",
              background: "rgba(124,92,250,0.10)",
              boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WIcon name={icon} size={26} color="#C4B5FD" stroke={1.6} />
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
            }}
          >
            该模块下一轮迭代
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: W_TOKENS.textMuted,
            }}
          >
            {hint}
          </div>
        </div>
      </WCard>
    </>
  );
}
