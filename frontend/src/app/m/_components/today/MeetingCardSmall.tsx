"use client";

/**
 * Saga · mobile-app-r4-A · today 页 今天的会议 横滑小卡.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:425-474
 *
 * 横滑 240px 宽小卡 (scroll-snap), state pill + 时间 + 标题 + topic + 头像 + meta.
 *
 * mock data 接 today/mock.ts MockMeetingT.
 */

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

import { MAvatarStack } from "@/components/mobile/shared/avatars";
import MAStatusPill from "@/components/mobile/shared/MAStatusPill";

import type { MockMeetingT } from "./mock";

const STATE_LABEL: Record<
  MockMeetingT["state"],
  { kind: "live" | "upcoming" | "done"; text: string }
> = {
  live: { kind: "live", text: "进行中" },
  upcoming: { kind: "upcoming", text: "即将开始" },
  done: { kind: "done", text: "已结束" },
};

export default function MeetingCardSmall({
  m,
}: {
  m: MockMeetingT;
}): ReactElement {
  const router = useRouter();
  const s = STATE_LABEL[m.state];

  return (
    <button
      type="button"
      onClick={() => router.push(`/m/meetings/${m.id}`)}
      style={{
        flexShrink: 0,
        width: 240,
        scrollSnapAlign: "start",
        background: "#fff",
        borderRadius: 14,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: "11px 12px",
        textAlign: "left",
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <MAStatusPill kind={s.kind}>{s.text}</MAStatusPill>
        <span
          style={{
            fontSize: 11,
            color: "#8E8E93",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {m.time}
        </span>
      </div>
      <div
        style={{
          marginTop: 7,
          fontSize: 14,
          fontWeight: 700,
          color: "#1C1C1E",
          lineHeight: 1.3,
          letterSpacing: -0.1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {m.title}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "#8E8E93",
          marginTop: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {m.topic}
      </div>
      <div
        style={{
          marginTop: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MAvatarStack
          humans={m.participants}
          ais={m.ais}
          size={20}
          maxShown={5}
        />
        {m.state === "done" && m.decisionCount ? (
          <span style={{ fontSize: 11, color: "#1F8A5B", fontWeight: 600 }}>
            {m.decisionCount} 决策
          </span>
        ) : null}
        {m.state === "upcoming" && m.startsIn ? (
          <span style={{ fontSize: 11, color: "#FF9F0A", fontWeight: 600 }}>
            ⏱ {m.startsIn}
          </span>
        ) : null}
      </div>
    </button>
  );
}
