"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 横滑参会人头像列.
 *
 * 设计源 1:1: meeting-room.jsx:490-549.
 *
 * 真实数据: page.tsx 拿 attending_agents (后端 AgentMini) + mock human 列表
 * (现 backend 没参会真人列表 API, attendee_user_ids 只是 string[], 这里
 * 沿用 mock 真人保持视觉满载 — 实际真人需要 后端补 API 拿到 name/role/avatar).
 *
 * 简化:
 *   - host: 总是显 1 个 Mira
 *   - humans: 显 mock 5 人 (TD9, mock-only)
 *   - ais:    显真实 attending_agents (后端 agent_color → 渐变)
 */

import type { ReactElement } from "react";

import {
  MOCK_HOST,
  MOCK_HUMANS,
  MRAIAvatar,
  MRHostAvatar,
  MRHumanAvatar,
  type MockHumanId,
} from "../shared/avatars";
import { MR_COLORS } from "./styles";

export type StripAgent = {
  agent_id: string;
  display: string;
  role: string;
  color: string | null;
};

type Props = {
  agents: StripAgent[];
};

export default function ParticipantsStrip({ agents }: Props): ReactElement {
  const humanIds = Object.keys(MOCK_HUMANS) as MockHumanId[];
  return (
    <div
      style={{
        background: MR_COLORS.bgWhite,
        padding: "10px 16px 12px",
        borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: MR_COLORS.textTertiary,
            letterSpacing: 0.3,
          }}
        >
          参会 · {humanIds.length} 人 + {agents.length} AI 专家
        </div>
        <div style={{ fontSize: 12, color: MR_COLORS.systemBlue }}>查看全部</div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingBottom: 2,
          scrollbarWidth: "none",
        }}
      >
        {/* host */}
        <Participant
          avatar={<MRHostAvatar size={40} />}
          name={MOCK_HOST.name}
          sub="主持人"
          subColor={MR_COLORS.textTertiary}
        />
        {/* humans (mock) */}
        {humanIds.map((k) => {
          const p = MOCK_HUMANS[k];
          const sub = p.speaking ? "正在说话" : p.muted ? "已静音" : p.role;
          const subColor = p.speaking
            ? MR_COLORS.systemGreen
            : MR_COLORS.textTertiary;
          return (
            <Participant
              key={`h-${k}`}
              avatar={
                <MRHumanAvatar
                  name={p.name}
                  color={p.color}
                  size={40}
                  speaking={p.speaking}
                  muted={p.muted}
                  showStatus
                />
              }
              name={p.name}
              sub={sub}
              subColor={subColor}
            />
          );
        })}
        {/* ais (真实 attending_agents) */}
        {agents.map((a) => (
          <Participant
            key={`a-${a.agent_id}`}
            avatar={<MRAIAvatar agentColor={a.color} size={40} />}
            name={a.display}
            sub={a.role}
            subColor={MR_COLORS.textTertiary}
          />
        ))}
      </div>
    </div>
  );
}

function Participant({
  avatar,
  name,
  sub,
  subColor,
}: {
  avatar: ReactElement;
  name: string;
  sub: string;
  subColor: string;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 56,
        flexShrink: 0,
      }}
    >
      {avatar}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: MR_COLORS.textPrimary,
          marginTop: 4,
          maxWidth: 56,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 10,
          color: subColor,
          lineHeight: 1.1,
          marginTop: 1,
        }}
      >
        {sub}
      </div>
    </div>
  );
}
