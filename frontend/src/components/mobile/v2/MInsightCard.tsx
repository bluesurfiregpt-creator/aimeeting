"use client";

/**
 * v1.4.0 · Saga O (Phase 1 W3) · Mobile App v2 · MInsightCard.
 *
 * AI 智囊·今日 单卡 atom — 提取自 /m/page.tsx InsightCard (Saga N 写的).
 *
 * 视觉:
 *   - 圆角 14 白卡, 0.5px hairline, soft shadow
 *   - 上排: 26 AI badge + AI name (13 bold) + type chip (10.5 bold 着色) + 来源会议 (11 灰)
 *   - 中: 标题 14.5 weight 600 letter -0.1, marginTop 9
 *   - 下: body 13 line-clamp 1 (compact) or 2 (default)
 *
 * Props:
 *   - insight: V2InsightItem
 *   - compact?: boolean (true → body 不显示)
 */

import Link from "next/link";
import type { ReactElement } from "react";

import MAIBadge from "./MAIBadge";
import type { V2InsightItem, V2InsightType } from "./types";

const INSIGHT_TYPE_COLOR: Record<V2InsightType, { fg: string; bg: string }> = {
  突破: { fg: "#34C759", bg: "rgba(52,199,89,0.12)" },
  决策: { fg: "#5E5CE6", bg: "rgba(94,92,230,0.12)" },
  风险: { fg: "#FF3B30", bg: "rgba(255,59,48,0.12)" },
  洞察: { fg: "#0A84FF", bg: "rgba(10,132,255,0.12)" },
  思路: { fg: "#AF52DE", bg: "rgba(175,82,222,0.12)" },
};

type Props = {
  insight: V2InsightItem;
  /** compact 模式不渲染 body. 默认 false. */
  compact?: boolean;
};

export default function MInsightCard({
  insight,
  compact = false,
}: Props): ReactElement {
  const it = insight;
  const tc = INSIGHT_TYPE_COLOR[it.type];
  return (
    <Link
      href={`/m/meetings/${it.source_meeting_id}`}
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        border: "0.5px solid rgba(60,60,67,0.10)",
        display: "block",
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
      data-testid="m-insight-card"
    >
      <div style={{ padding: "12px 14px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <MAIBadge
            name={it.ai_source.name}
            glyph={it.ai_source.glyph}
            gradient_from={it.ai_source.color}
            gradient_to={it.ai_source.color}
            size={26}
            ring="transparent"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1C1C1E",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {it.ai_source.name}
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  color: tc.fg,
                  background: tc.bg,
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {it.type}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 1 }}>
              {it.source_meeting}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 14.5,
            fontWeight: 600,
            color: "#1C1C1E",
            lineHeight: 1.35,
            letterSpacing: -0.1,
          }}
        >
          {it.title}
        </div>
        {compact ? null : (
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "#3C3C43",
              lineHeight: 1.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
            }}
          >
            {it.body}
          </div>
        )}
      </div>
    </Link>
  );
}
