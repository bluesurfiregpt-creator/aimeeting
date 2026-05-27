"use client";

/**
 * R5.D Web 会议室 — orchestrate 状态横条 (Sprint 3 Web W1).
 *
 * 显示 当前 phase / 议程进度 / 当前发言 — 跟 mobile 同基础架构,
 * 但 web 版用 R5.D iOS 浅色 + 三栏 desktop 布局 (高度紧凑).
 *
 * **数据源**: `/api/m/meetings/{id}` (复用 mobile.py MobileMeetingDetailOut
 * 的 5 个 orchestrate 字段). hybrid / human 会议 phase=null → 不渲染.
 *
 * **风格** 严格 MR (iOS 浅色) — 不混 W_TOKENS 暗紫. 见 MR_TOKENS § purple #5E5CE6.
 */

import type { ReactElement } from "react";
import type { WebMeetingDetailOut } from "@/lib/api";
import { MR_TOKENS } from "./tokens";

type Props = {
  detail: WebMeetingDetailOut | null;
};

const PHASE_LABEL: Record<string, { label: string; tone: "running" | "paused" | "done" | "idle" | "failed" }> = {
  idle: { label: "等待开始", tone: "idle" },
  running: { label: "正在自主推进", tone: "running" },
  paused: { label: "暂停中", tone: "paused" },
  done: { label: "已完成", tone: "done" },
  failed: { label: "执行失败", tone: "failed" },
  cancelled: { label: "已取消", tone: "idle" },
};

const TONE_COLOR: Record<string, string> = {
  running: "#5E5CE6", // 紫
  paused: "#FF9F0A", // 橙
  done: "#34C759", // 绿
  idle: "#8E8E93",
  failed: "#FF3B30",
};

export function OrchestrateStatusBanner({ detail }: Props): ReactElement | null {
  // hybrid / human 模式 phase = null → 不展示 banner (避免 占顶部空间)
  if (!detail || !detail.orchestrate_phase) return null;
  // mode 必须 auto 才有 orchestrate (mobile.py 严格按这个条件填字段)
  if ((detail.mode || "").toLowerCase() !== "auto") return null;

  const meta = PHASE_LABEL[detail.orchestrate_phase] || {
    label: detail.orchestrate_phase,
    tone: "idle" as const,
  };
  const accent = TONE_COLOR[meta.tone];
  const totalAgenda = detail.agenda_items?.length ?? 0;
  const completed = detail.orchestrate_completed_agenda_count;
  const turnCount = detail.orchestrate_turn_count;
  const speakerAgentId = detail.current_speaker_agent_id;
  const speakerName = speakerAgentId
    ? detail.attending_agents.find((a) => a.agent_id === speakerAgentId)?.nickname ||
      detail.attending_agents.find((a) => a.agent_id === speakerAgentId)?.name ||
      null
    : null;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(94,92,230,0.06), rgba(175,82,222,0.08))",
        borderBottom: "0.5px solid rgba(94,92,230,0.18)",
        padding: "10px 28px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 13,
        color: MR_TOKENS.fgPrimary,
        animation: "mrFadeIn 280ms ease-out",
      }}
      data-testid="web-orchestrate-banner"
    >
      {/* Phase pill */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 6,
          background: `${accent}1A`,
          boxShadow: `inset 0 0 0 0.5px ${accent}66`,
          color: accent,
          fontWeight: 700,
          fontSize: 11.5,
          letterSpacing: 0.3,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: accent,
            animation: meta.tone === "running" ? "mrLivePulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        AI 圆桌 · {meta.label}
      </div>

      {/* 议程进度 */}
      {totalAgenda > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: MR_TOKENS.fgTertiary, fontSize: 11.5 }}>议程</span>
          <span
            style={{
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: MR_TOKENS.fgPrimary,
            }}
          >
            {completed}
            <span style={{ color: MR_TOKENS.fgQuaternary }}> / {totalAgenda}</span>
          </span>
          {/* 横向 progress */}
          <span
            style={{
              display: "inline-block",
              width: 64,
              height: 4,
              borderRadius: 2,
              background: MR_TOKENS.divider,
              overflow: "hidden",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${Math.min(100, (completed / Math.max(1, totalAgenda)) * 100)}%`,
                background: accent,
                transition: "width 600ms ease",
              }}
            />
          </span>
        </span>
      )}

      {/* 轮次 */}
      <span style={{ color: MR_TOKENS.fgTertiary, fontSize: 11.5 }}>
        轮次 <strong style={{ color: MR_TOKENS.fgPrimary, fontVariantNumeric: "tabular-nums" }}>{turnCount}</strong>
      </span>

      {/* 当前发言 */}
      {speakerName && meta.tone === "running" && (
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: accent,
            fontWeight: 600,
            fontSize: 12.5,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accent,
              animation: "mrLivePulse 1.2s ease-in-out infinite",
            }}
          />
          {speakerName} 正在发言
        </span>
      )}
      {!speakerName && meta.tone === "running" && (
        <span style={{ marginLeft: "auto", color: MR_TOKENS.fgTertiary, fontSize: 12.5 }}>
          等待 AI 接龙…
        </span>
      )}
    </div>
  );
}
