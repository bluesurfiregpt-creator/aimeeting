"use client";

/**
 * v1.4.0 · Saga M1 · 真人头像 atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:257-272 (MAvatar).
 *
 * 取 name 第一个字符 (中文姓氏 / 英文首字母大写), 背景填 color, 白色字, 圆形.
 * size 默认 36 (设计稿 avatar stack 用 22-28, 单独显示用 36).
 * ring 默认白色 (在卡片上叠加时显出 stack 效果).
 *
 * 与 v1 (shared/avatars.tsx::MRHumanAvatar) 区别:
 *   - v2 完全从 props 渲染 (走 V2Attendee schema 喂入 name / color)
 *   - 无 speaking / muted 状态 (那是会议室专用)
 */

import type { CSSProperties, ReactElement } from "react";

type Props = {
  /** 显示名 — 第一个字符做 initial */
  name: string;
  /** 个人色 (背景填色) */
  color: string;
  size?: number;
  /** 描边色, 默认白. 传 "transparent" 不画 ring. */
  ring?: string;
  style?: CSSProperties;
};

export default function MAvatar({
  name,
  color,
  size = 36,
  ring = "#FFFFFF",
  style,
}: Props): ReactElement {
  const ch = name?.[0] ?? "?";
  const initial = /[A-Za-z]/.test(ch) ? ch.toUpperCase() : ch;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        flexShrink: 0,
        boxShadow:
          ring && ring !== "transparent" ? `0 0 0 1.5px ${ring}` : "none",
        letterSpacing: 0.1,
        ...style,
      }}
    >
      {initial}
    </div>
  );
}
