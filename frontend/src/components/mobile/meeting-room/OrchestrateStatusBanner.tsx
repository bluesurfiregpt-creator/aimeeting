"use client";

/**
 * v1.4.0 Saga E.E (Sprint 2-3) AI 圆桌真协同 · mobile orchestrator 状态 横幅.
 *
 * 仅 mode='auto' 会议 显. 展示:
 *   - phase (idle / running / paused / done / failed / cancelled)
 *   - 议程进度 (current_agenda_idx / total)
 *   - 当前发言 agent (running 时 pulse 紫色)
 *   - 已用时间 (从 status started_minutes_ago 推, paused 不再细化)
 *
 * 不破坏 round-3 视觉 token — 用 浅色 iOS 风骨架 + MR_COLORS 既有 token.
 * 不引入 框架 — 用 既有 mr-livePulse / mr-aiSpeakingRing keyframes (styles.ts 注入).
 */

import type { ReactElement } from "react";

import { MR_COLORS } from "./styles";
import type { AgentMini } from "@/lib/mobile/types";

type Phase =
  | "idle"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "cancelled"
  | string;

const PHASE_LABEL: Record<string, string> = {
  idle: "未启动",
  running: "AI 圆桌进行中",
  paused: "已暂停",
  done: "已结束",
  failed: "失败",
  cancelled: "已取消",
};

const PHASE_DOT_COLOR: Record<string, string> = {
  idle: "#8E8E93",
  running: "#34C759",
  paused: "#FF9F0A",
  done: "#5E5CE6",
  failed: "#FF3B30",
  cancelled: "#8E8E93",
};

type Props = {
  phase: Phase | null;
  /** 已完成议程 / 总议程数 */
  completedAgenda: number;
  totalAgenda: number;
  currentAgendaIdx: number | null;
  currentAgendaTitle: string | null;
  /** 当前 orchestrator running 的 speaker (running 时 显发言中) */
  activeSpeakerAgentId: string | null;
  /** 跟父级 attending_agents 同名 resolve. */
  attendingAgents: AgentMini[];
};

export default function OrchestrateStatusBanner({
  phase,
  completedAgenda,
  totalAgenda,
  currentAgendaIdx,
  currentAgendaTitle,
  activeSpeakerAgentId,
  attendingAgents,
}: Props): ReactElement | null {
  if (!phase) return null;

  const label = PHASE_LABEL[phase] || phase;
  const dot = PHASE_DOT_COLOR[phase] || MR_COLORS.textTertiary;
  const isRunning = phase === "running";
  const isFinal = phase === "done" || phase === "failed" || phase === "cancelled";

  // resolve 当前发言 agent
  const activeAgent = activeSpeakerAgentId
    ? attendingAgents.find((a) => a.agent_id === activeSpeakerAgentId)
    : null;

  return (
    <div
      data-testid="orch-status-banner"
      style={{
        margin: "0 16px 8px",
        padding: "10px 12px",
        borderRadius: 12,
        background: isRunning
          ? "linear-gradient(135deg, rgba(94,92,230,0.06), rgba(94,92,230,0.02))"
          : MR_COLORS.bgWhite,
        border: `0.5px solid ${isRunning ? "rgba(94,92,230,0.30)" : MR_COLORS.hairline}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {/* 顶部一行: phase dot + label + 议程进度 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: currentAgendaTitle || activeAgent ? 6 : 0,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dot,
            animation: isRunning ? "mr-livePulse 1.4s ease-in-out infinite" : "none",
            flexShrink: 0,
          }}
          aria-hidden
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: MR_COLORS.textPrimary,
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: MR_COLORS.textTertiary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          议程 {completedAgenda}/{totalAgenda}
        </span>
      </div>

      {/* 当前议程 + 发言 agent (running / paused 才显). 终态 不显 — 已结束没意义. */}
      {!isFinal && currentAgendaTitle ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: MR_COLORS.textSecondary,
          }}
        >
          <span style={{ flexShrink: 0 }}>
            议程{" "}
            {currentAgendaIdx !== null ? currentAgendaIdx + 1 : "?"} ·
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: MR_COLORS.textPrimary,
            }}
          >
            {currentAgendaTitle}
          </span>
        </div>
      ) : null}

      {isRunning && activeAgent ? (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: MR_COLORS.systemPurple,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: MR_COLORS.systemPurple,
              animation: "mr-livePulse 1.0s ease-in-out infinite",
            }}
            aria-hidden
          />
          <span>
            {activeAgent.nickname?.trim() || activeAgent.name} 正在发言…
          </span>
        </div>
      ) : null}

      {phase === "done" ? (
        <div
          style={{
            fontSize: 11,
            color: MR_COLORS.textTertiary,
            marginTop: 2,
          }}
        >
          AI 圆桌已 收敛, 摘要 + 共识 + 行动项 已 生成.
        </div>
      ) : null}

      {phase === "paused" ? (
        <div
          style={{
            fontSize: 11,
            color: MR_COLORS.systemAmber,
            marginTop: 2,
          }}
        >
          召集人 已 暂停 — 等 恢复 中.
        </div>
      ) : null}

      {phase === "failed" || phase === "cancelled" ? (
        <div
          style={{
            fontSize: 11,
            color: MR_COLORS.systemRed,
            marginTop: 2,
          }}
        >
          {phase === "failed" ? "运行 失败" : "已取消"} · 看 desktop 控制台 查 错误.
        </div>
      ) : null}
    </div>
  );
}
