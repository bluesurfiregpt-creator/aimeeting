"use client";

/**
 * v1.4.0 · Saga M1 · Mira 本周脉络 inline notice (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx:1012-1090
 * (MiraPulseNotice).
 *
 * 白卡 + 左侧 2.5px 紫渐变细条 (vertical) + 小 18×18 紫渐变 sparkle 角标 +
 * eyebrow ("MIRA · 本周脉络") + title + body + chips + 关闭 ×.
 *
 * 不是 hero — 是 "passive 周报 reminder", 不与紫色 CTA 抢视觉.
 * 用 schema WeekPulseResponse 喂入: meeting_count / summary_text /
 * decision_recommendation / chips[].
 *
 * Schema 偏离备忘: design 设计 chips 字段 = `{icon: string, label: string}`,
 * 但 schema §2.1 chips 是 `{label, count, icon}`. 这里把 chip 渲染为
 * "今日决策 1 项" 即合并 label + count, icon 是 emoji 直接显示.
 */

import { useState } from "react";
import type { ReactElement } from "react";

import MAIcon from "./MAIcon";
import type { V2WeekPulseResponse } from "./types";

type Props = {
  data: V2WeekPulseResponse;
  /** dismiss 回调, 不传时本地 state 隐藏 */
  onDismiss?: () => void;
};

export default function MiraPulseNotice({
  data,
  onDismiss,
}: Props): ReactElement | null {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 13,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: "11px 12px",
        position: "relative",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
      data-testid="mira-pulse-notice"
    >
      {/* 左侧 紫渐变 细条 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 2.5,
          borderRadius: 2,
          background: "linear-gradient(180deg, #5E5CE6 0%, #AF52DE 100%)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          paddingLeft: 6,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "linear-gradient(135deg, #5E5CE6, #AF52DE)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          <MAIcon name="sparkle" size={10} color="#fff" strokeWidth={2.4} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "#5E5CE6",
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            MIRA · 本周脉络
          </div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#1C1C1E",
              marginTop: 2,
              lineHeight: 1.4,
              letterSpacing: -0.1,
            }}
          >
            {data.summary_text}
          </div>
          {data.decision_recommendation ? (
            <div
              style={{
                fontSize: 12,
                color: "#8E8E93",
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              {data.decision_recommendation}
            </div>
          ) : null}
          {data.chips && data.chips.length > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {data.chips.map((c, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 7px 2px 5px",
                    borderRadius: 5,
                    background: "#F2F2F7",
                    color: "#3C3C43",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 10 }}>
                    {c.icon}
                  </span>
                  {c.label} {c.count} 项
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          aria-label="忽略"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            color: "#C7C7CC",
            fontSize: 16,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: -2,
            marginRight: -2,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
