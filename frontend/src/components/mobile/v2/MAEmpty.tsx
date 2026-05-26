"use client";

/**
 * v1.4.0 · Saga M1 · 空态卡 atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx:983-1005
 * (MAEmpty).
 *
 * 中心 56×56 圆角方 (radius 16) + 浅描边 + 中灰 icon · 灰文字 title · 副标小灰.
 * 不是 dashed border (那是 list 空态), 而是有 icon 的居中提示.
 */

import type { ReactElement } from "react";

import MAIcon, { type V2IconName } from "./MAIcon";

type Props = {
  icon?: V2IconName;
  title: string;
  body?: string;
};

export default function MAEmpty({
  icon = "today",
  title,
  body,
}: Props): ReactElement {
  return (
    <div
      style={{
        padding: "60px 24px 30px",
        textAlign: "center",
      }}
      data-testid="ma-empty"
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          margin: "0 auto",
          background: "#fff",
          border: "0.5px solid rgba(60,60,67,0.10)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MAIcon name={icon} size={26} color="#C7C7CC" strokeWidth={1.6} />
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 15,
          fontWeight: 600,
          color: "#1C1C1E",
        }}
      >
        {title}
      </div>
      {body ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: "#8E8E93",
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
