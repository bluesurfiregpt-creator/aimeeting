"use client";

/**
 * Saga · mobile-app-r4-A · today 页 进行中会议 hero (浅色).
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:187-256
 *
 * 替代旧 HeroOngoingCard. 关键差:
 *   - 白底 + 顶部绿 LIVE 渐变进度条 (按 elapsed/duration 填充)
 *   - LIVE pill 脉冲
 *   - Mira note 灰底嵌套
 *   - 蓝色 "立即进入" 渐变按钮 + arrow
 *
 * 接 backend WorkbenchOngoingMeeting (current ongoing). 若拿到 minutes_total + planned
 * 可算 elapsed/duration; 若无 fall back 平铺 LIVE 行.
 */

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

import { MRHostAvatar, MAvatarStack } from "@/components/mobile/shared/avatars";
import type { MockHumanId, MockAiId } from "@/components/mobile/shared/avatars";
import Icon from "@/components/mobile/shared/Icon";

type Props = {
  meetingId: string;
  title: string;
  sub: string;
  topic: string;
  /** 已运行 分钟. */
  elapsedMin: number;
  /** 计划 总分钟; 无则不画进度条. */
  durationMin?: number;
  miraNote?: string;
  participants?: MockHumanId[];
  ais?: MockAiId[];
};

export default function LiveMeetingCard({
  meetingId,
  title,
  sub,
  topic,
  elapsedMin,
  durationMin,
  miraNote,
  participants = [],
  ais = [],
}: Props): ReactElement {
  const router = useRouter();
  const pct =
    durationMin && durationMin > 0
      ? Math.min(100, (elapsedMin / durationMin) * 100)
      : 30;

  return (
    <button
      type="button"
      onClick={() => router.push(`/m/meetings/${meetingId}`)}
      style={{
        width: "100%",
        textAlign: "left",
        background: "#fff",
        borderRadius: 18,
        border: "0.5px solid rgba(60,60,67,0.10)",
        boxShadow:
          "0 1px 0 rgba(60,60,67,0.04), 0 6px 18px rgba(0,0,0,0.06)",
        padding: "14px 14px 14px",
        fontFamily: "inherit",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
      data-testid="today-live-meeting"
    >
      {/* live ribbon */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, #34C759 0%, #34C759 ${pct}%, rgba(52,199,89,0.20) ${pct}%, rgba(52,199,89,0.20) 100%)`,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 4,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10.5,
            fontWeight: 700,
            color: "#fff",
            background: "#34C759",
            padding: "2px 6px",
            borderRadius: 4,
            letterSpacing: 0.4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#fff",
              animation: "maPulse 1.4s ease-in-out infinite",
            }}
          />
          LIVE
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#8E8E93",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {durationMin
            ? `已 ${elapsedMin} 分 / ${durationMin} 分钟`
            : `已 ${elapsedMin} 分`}
        </span>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 18,
          fontWeight: 700,
          color: "#1C1C1E",
          letterSpacing: -0.2,
          lineHeight: 1.25,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: "#8E8E93", marginTop: 2 }}>
        {sub} · {topic}
      </div>

      {miraNote ? (
        <div
          style={{
            marginTop: 10,
            background: "#F2F2F7",
            borderRadius: 10,
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <MRHostAvatar size={20} ring="transparent" />
          <span
            style={{ fontSize: 12, color: "#3C3C43", flex: 1, minWidth: 0 }}
          >
            {miraNote}
          </span>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 11,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <MAvatarStack
          humans={participants}
          ais={ais}
          size={22}
          maxShown={6}
        />
        <span style={{ flex: 1 }} />
        <div
          style={{
            height: 38,
            paddingLeft: 14,
            paddingRight: 12,
            borderRadius: 10,
            background: "linear-gradient(135deg, #007AFF, #0A84FF)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 2px 6px rgba(0,122,255,0.30)",
          }}
        >
          立即进入
          <Icon
            name="arrow-right"
            size={15}
            color="#fff"
            strokeWidth={2.4}
          />
        </div>
      </div>
    </button>
  );
}
