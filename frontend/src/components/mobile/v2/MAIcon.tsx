"use client";

/**
 * v1.4.0 · Saga M1 · 通用 icon wrapper (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:324-388 (MAIcon).
 *
 * 简单 re-export shared Icon — v2 想要的 20+ 常用 icon 在 shared/Icon.tsx 都已经有.
 * 单独这个 file 的意义:
 *   - 给 v2 atoms barrel export 一个统一入口 (Saga N/O/P 直接 import "@/components/mobile/v2/MAIcon")
 *   - 类型重定向 (避免业务代码触到 v1 shared/Icon 的命名)
 *
 * 如果未来需要 v2 独有 icon (设计稿新增的, shared 没有的), 单独在这里加 case 即可.
 */

import type { ReactElement } from "react";

import Icon, { type MRIconName } from "@/components/mobile/shared/Icon";

export type V2IconName = MRIconName;

type Props = {
  name: V2IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export default function MAIcon({
  name,
  size = 18,
  color = "currentColor",
  strokeWidth,
}: Props): ReactElement | null {
  return (
    <Icon name={name} size={size} color={color} strokeWidth={strokeWidth} />
  );
}
