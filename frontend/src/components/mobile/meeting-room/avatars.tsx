"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 3 型头像.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room/project/meeting-room-shared.jsx:169-239.
 *
 *  - MRHumanAvatar: 圆形 个人色 + 首字 (speaking 脉冲 + muted 角标)
 *  - MRAIAvatar:    渐变 圆角方形 + 白色 sparkle SVG
 *  - MRHostAvatar:  同心圆 amber 渐变 (Mira 主持人专属, 区别于 domain AI)
 *
 * R5 mitigation: backend `agent_color` 不是渐变, 这里内置 `COLOR_TO_GRADIENT`
 * 映射 (8 个 Tailwind 色名 → hex 渐变). 后端不给 / 名字不在表里 → fallback
 * 紫色单色, 仍是 渐变方形, 视觉一致.
 *
 * mock 圆桌 走 bundle 固定 6 名 (Aria/Stratos/Lex/Sage/Tally/Scout), 真实
 * transcript 走后端 agent_color → 映射. 命名空间分离 (TD9).
 */

import type { ReactElement } from "react";

// ─────── Mock-only AI 名册 (bundle 6 名, TD9) ───────

export type MockAiId = "ARIA" | "STRATOS" | "LEX" | "SAGE" | "TALLY" | "SCOUT";

export type MockAi = {
  name: string;
  role: string;
  grad: [string, string];
};

export const MOCK_AIS: Record<MockAiId, MockAi> = {
  ARIA: { name: "Aria", role: "数据分析师", grad: ["#0A84FF", "#5E5CE6"] },
  STRATOS: { name: "Stratos", role: "产品策略", grad: ["#AF52DE", "#FF375F"] },
  LEX: { name: "Lex", role: "法务合规", grad: ["#FF9F0A", "#FF6482"] },
  SAGE: { name: "Sage", role: "UX 顾问", grad: ["#FF2D55", "#AF52DE"] },
  TALLY: { name: "Tally", role: "财务建模", grad: ["#34C759", "#30B0C7"] },
  SCOUT: { name: "Scout", role: "市场洞察", grad: ["#5856D6", "#0A84FF"] },
};

// ─────── 后端 agent_color → 渐变 hex 映射 (R5) ───────

export const COLOR_TO_GRADIENT: Record<string, [string, string]> = {
  violet: ["#AF52DE", "#5E5CE6"],
  emerald: ["#34C759", "#30B0C7"],
  amber: ["#FFB340", "#FF9F0A"],
  sky: ["#0A84FF", "#5E5CE6"],
  rose: ["#FF2D55", "#AF52DE"],
  teal: ["#30B0C7", "#5E5CE6"],
  blue: ["#0A84FF", "#5E5CE6"],
  indigo: ["#5856D6", "#5E5CE6"],
};

const FALLBACK_GRADIENT: [string, string] = ["#5E5CE6", "#AF52DE"];

/** 后端 agent_color (语义色名) → 一对 hex 渐变. */
export function gradientForAgentColor(
  color: string | null | undefined,
): [string, string] {
  if (!color) return FALLBACK_GRADIENT;
  return COLOR_TO_GRADIENT[color] || FALLBACK_GRADIENT;
}

// ─────── 真人列表 (mock, 用于 ParticipantsStrip / FilterSheet / mock round) ───────

export type MockHumanId = "ZK" | "LM" | "WJ" | "CY" | "SL";

export type MockHuman = {
  name: string;
  role: string;
  color: string;
  speaking?: boolean;
  muted?: boolean;
};

export const MOCK_HUMANS: Record<MockHumanId, MockHuman> = {
  ZK: { name: "周凯", role: "PM", color: "#FF9F0A" },
  LM: { name: "林敏", role: "设计", color: "#34C759" },
  WJ: { name: "王俊", role: "工程", color: "#5E5CE6", speaking: true },
  CY: { name: "陈宇", role: "工程", color: "#FF375F" },
  SL: { name: "苏蕾", role: "研究", color: "#30B0C7", muted: true },
};

export const MOCK_HOST = {
  name: "Mira",
  role: "会议主持人",
  grad: ["#FFB340", "#FF9F0A"] as [string, string],
  desc: "管议程 · 提醒走神 · 拆问题转给 AI 专家",
};

// ─────── 头像组件 ───────

type HumanAvatarProps = {
  /** 显示名 — 用第一个字符 */
  name: string;
  /** 个人色 (背景填色) */
  color: string;
  size?: number;
  ring?: string;
  speaking?: boolean;
  muted?: boolean;
  showStatus?: boolean;
};

export function MRHumanAvatar({
  name,
  color,
  size = 28,
  ring = "#fff",
  speaking = false,
  muted = false,
  showStatus = false,
}: HumanAvatarProps): ReactElement {
  const ch = name?.[0] || "?";
  const initial = /[A-Za-z]/.test(ch) ? ch.toUpperCase() : ch;
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexShrink: 0,
        width: size,
        height: size,
      }}
    >
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
          fontSize: size * 0.44,
          fontWeight: 600,
          boxShadow: `0 0 0 1.5px ${ring}`,
        }}
      >
        {initial}
      </div>
      {showStatus && speaking ? (
        <span
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            boxShadow: "0 0 0 2px #34C759",
            animation: "mr-speakingPulse 1.2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      ) : null}
      {showStatus && muted ? (
        <span
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: "50%",
            background: "#FF453A",
            border: "1.5px solid #fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width={size * 0.24}
            height={size * 0.24}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M4 4l16 16"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M9 5a3 3 0 0 1 6 0v6M9 11v0a3 3 0 0 0 .8 2.05"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

type AiAvatarProps = {
  /** 渐变颜色对; 若不给可传 agent_color 走 fallback. */
  grad?: [string, string];
  /** 后端 agent_color 语义色名 (与 grad 二选一) */
  agentColor?: string | null;
  size?: number;
  ring?: string;
};

export function MRAIAvatar({
  grad,
  agentColor,
  size = 28,
  ring = "#fff",
}: AiAvatarProps): ReactElement {
  const g = grad || gradientForAgentColor(agentColor);
  const r = Math.max(6, size * 0.28);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(135deg, ${g[0]} 0%, ${g[1]} 100%)`,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 0 1.5px ${ring}`,
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
        <path
          d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
          fill="#fff"
        />
        <path
          d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
          fill="#fff"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

type HostAvatarProps = {
  size?: number;
  ring?: string;
};

/** Host (Mira) = concentric-ring avatar, 区分 domain AI. */
export function MRHostAvatar({
  size = 28,
  ring = "#fff",
}: HostAvatarProps): ReactElement {
  const g = MOCK_HOST.grad;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 50% 50%, ${g[0]} 0%, ${g[0]} 28%, #fff 28%, #fff 36%, ${g[1]} 36%, ${g[1]} 60%, #fff 60%, #fff 68%, ${g[0]} 68%)`,
        boxShadow: `0 0 0 1.5px ${ring}, inset 0 0 0 0.5px rgba(0,0,0,0.08)`,
        flexShrink: 0,
      }}
    />
  );
}
