"use client";

/**
 * R5.D Web 会议室 — 真接 backend transcript line 的渲染器 (Sprint 3 Web W1).
 *
 * 跟 MRMessages.tsx (mock) 双轨:
 *   - MRMessages.tsx 渲染 mock MRHumanMessage / MRAIMessage / MRHostMessage / MRRoundMessage
 *     (设计稿固定话术, host card + AI 圆桌)
 *   - 本文件 (MRRealMessages.tsx) 渲染 backend `WebTranscriptStreamLine` (user / agent),
 *     用于 auto 模式 orchestrator push 出来的 真实 AI 发言 + ASR 真人句.
 *
 * 抄 mobile Saga E.E pattern (frontend/src/components/mobile/MeetingTranscriptView.tsx
 * AIMessage / HumanMessage):
 *   - 真人: 头像 36px 个人色 + waveform (现 backend 不传 speaking, 留 false)
 *   - AI:   渐变方形 32px + 3px accent bar + body + active speaker pulse
 *   - active speaker pulse: orchestrator 正在发言的 agent_id border 紫 #5E5CE6 +
 *                          mr-aiSpeakingRing 1.4s ease-in-out infinite
 *   - fade-in 动画: mrAiMsgSlideIn 280ms ease-out (mount 时 触发)
 *   - streaming cursor: 紫 #5E5CE6 闪烁 — backend 没流式, 留 false
 *
 * **风格**: 严格 iOS 浅色 (跟 MRMessages.tsx 同 token 集 — MR_TOKENS 浅色 #1C1C1E /
 *           #5E5CE6). 不混 W_TOKENS 暗紫 (会议室永远 light, PM 拍板).
 *
 * **不复用 mobile component** (PM DESIGN_SYSTEM § 0.3.3 Web/Mobile atom 不复用).
 * 但 pattern + 字段映射 1:1 抄 mobile.
 */

import type { ReactElement } from "react";
import type { WebTranscriptStreamLine } from "@/lib/api";
import { MRHumanAvatar, MRAIAvatar, MRWaveform, MRIcon, MRDots } from "./atoms";
import { MR_HUMANS_IN_MEETING, MR_AGENTS_IN_MEETING } from "./data";
import { gradientForAgentColor } from "./agentColor";
import { MR_TOKENS } from "./tokens";

const TRIGGER_LABEL: Record<string, string> = {
  manual: "召唤",
  auto_orchestrator: "自动",
  keyword: "关键词",
  at_mention: "@",
};

function fmtMinute(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h${rem ? rem + "m" : ""}`;
}

/** 名字 → 调色板 hash (backend 不给个人色, 一致 fallback) */
const PERSONAL_COLORS = [
  "#FF9F0A",
  "#34C759",
  "#5E5CE6",
  "#FF375F",
  "#30B0C7",
  "#FF6482",
  "#5856D6",
  "#AF52DE",
];
function humanColorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return PERSONAL_COLORS[h % PERSONAL_COLORS.length];
}

/** 真人发言行 — backend MeetingTranscript */
export function MRRealHumanLine({
  line,
}: {
  line: WebTranscriptStreamLine;
}): ReactElement {
  const name = line.speaker_name || "未识别";
  const color = humanColorForName(name);
  // 检查 mock MR_HUMANS_IN_MEETING 是否有此 key (兼容); 没有则用 hash 色直接渲染
  const mockKey = Object.keys(MR_HUMANS_IN_MEETING).find(
    (k) => MR_HUMANS_IN_MEETING[k]?.name === name,
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 28px",
        animation: "mrFadeIn 280ms ease-out",
      }}
    >
      {mockKey ? (
        <MRHumanAvatar id={mockKey} size={36} />
      ) : (
        // 不在 mock 表 → 用 hash 色渲染 (类似 mobile humanColorForName)
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: color,
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 0 0 1.5px ${MR_TOKENS.bgSurface}`,
          }}
        >
          {name.slice(0, 1)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{name}</span>
          <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>{fmtMinute(line.at_minute)}</span>
        </div>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.55,
            color: MR_TOKENS.fgPrimary,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {line.text}
        </div>
      </div>
    </div>
  );
}

/** AI 发言行 — backend MeetingAgentMessage */
export function MRRealAILine({
  line,
  isActiveSpeaker = false,
}: {
  line: WebTranscriptStreamLine;
  /** Sprint 3 Web W1: orchestrator 当前发言的 agent → border pulse 紫 + sparkle */
  isActiveSpeaker?: boolean;
}): ReactElement {
  const display = line.agent_nickname?.trim() || line.agent_name || "AI";
  const role = line.trigger ? TRIGGER_LABEL[line.trigger] || line.trigger : "";
  // 后端 agent_color → 渐变 hex
  const grad = gradientForAgentColor(line.agent_color);
  // 检查 mock MR_AGENTS_IN_MEETING 是否有此 agent_id; 没有 → 直接用 grad 渲染
  const mockKey = line.agent_id || "";
  const mockAgent = MR_AGENTS_IN_MEETING[mockKey];
  return (
    <div
      style={{
        padding: "8px 28px",
        animation: "mrFadeIn 280ms ease-out",
      }}
    >
      <div
        style={{
          background: MR_TOKENS.bgSurface,
          borderRadius: 12,
          boxShadow: isActiveSpeaker
            ? "0 0 0 2px rgba(94,92,230,0.30), 0 1px 2px rgba(0,0,0,0.04)"
            : MR_TOKENS.shadowSubtle,
          border: isActiveSpeaker
            ? "0.5px solid #5E5CE6"
            : MR_TOKENS.borderHair2Strong,
          maxWidth: 720,
          position: "relative",
          overflow: "hidden",
          transition: "box-shadow 200ms ease, border-color 200ms ease",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: `linear-gradient(180deg, ${grad[0]}, ${grad[1]})`,
          }}
        />
        <div style={{ padding: "14px 18px 14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                borderRadius: 6,
                animation: isActiveSpeaker
                  ? "mrSpeakingPulse 1.4s ease-in-out infinite"
                  : "none",
              }}
            >
              {mockAgent ? (
                <MRAIAvatar id={mockKey} size={32} />
              ) : (
                // 真接 agent 不在 mock → 用 grad 渲染方形头像
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    background: `linear-gradient(135deg, ${grad[0]} 0%, ${grad[1]} 100%)`,
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    boxShadow: `0 0 0 1.5px ${MR_TOKENS.bgSurface}`,
                  }}
                >
                  {(display || "AI").slice(0, 1)}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{display}</span>
                {role && (
                  <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>{role}</span>
                )}
                <span style={{ fontSize: 12, color: MR_TOKENS.fgQuaternary, marginLeft: "auto" }}>
                  {fmtMinute(line.at_minute)}
                </span>
              </div>
              {isActiveSpeaker && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#5E5CE6",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <MRIcon name="sparkle" size={10} color="#5E5CE6" />
                  AI 思考中
                  <MRDots />
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 14,
              lineHeight: 1.55,
              color: MR_TOKENS.fgPrimary,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {line.text}
          </div>

          {line.citations_count > 0 && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: MR_TOKENS.fgTertiary,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <MRIcon name="note" size={11} color={MR_TOKENS.fgTertiary} />
              引用 {line.citations_count} 条 KB
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Speaking now indicator — 仿设计稿 "王俊 正在说话" */
export function MRRealActiveSpeakerHint({
  agentName,
}: {
  agentName: string;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 28px 20px",
        fontSize: 12.5,
        color: "#5E5CE6",
        fontWeight: 600,
      }}
    >
      <MRIcon name="sparkle" size={12} color="#5E5CE6" />
      <span>{agentName} 正在发言</span>
      <MRWaveform active />
    </div>
  );
}
