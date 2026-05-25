"use client";

/**
 * Saga · mobile-app-r4-A · today 页 决策列表 row.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:531-562
 *
 * 绿圆勾 + 决策标题 + 拍板人头像 + 来源 + 时间.
 *
 * [TD-NEW: today_decisions backend 字段缺失] — 用 mock data.
 */

import type { ReactElement } from "react";

import { MRHumanAvatar, MOCK_HUMANS } from "@/components/mobile/shared/avatars";
import Icon from "@/components/mobile/shared/Icon";

import type { DecisionT } from "./mock";

export default function DecisionRow({
  d,
  last = false,
}: {
  d: DecisionT;
  last?: boolean;
}): ReactElement {
  const human = MOCK_HUMANS[d.by];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "12px 14px",
        borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(52,199,89,0.14)",
          color: "#1F8A5B",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="check" size={14} color="#1F8A5B" strokeWidth={2.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1C1C1E",
            lineHeight: 1.4,
          }}
        >
          {d.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "#8E8E93",
            marginTop: 3,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {human ? (
            <MRHumanAvatar
              name={human.name}
              color={human.color}
              size={14}
              ring="transparent"
            />
          ) : null}
          <span>{human?.name} 拍板</span>
          <span>·</span>
          <span>{d.source}</span>
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "#C7C7CC",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {d.when}
      </span>
    </div>
  );
}
