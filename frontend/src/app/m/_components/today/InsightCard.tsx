"use client";

/**
 * Saga · mobile-app-r4-A · today 页 AI 智囊单条 insight 卡 (浅色).
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:477-528
 *
 * 顶: AI 头像 + 名 + role + 时间 + 高 impact 红 "关键" pill
 * 中: 大字标题 + 灰字 body
 * 底: 灰背景 source + 蓝色 "查看上下文 →"
 *
 * impact mapping: AIInsightFull 没有显式 impact 字段, 我们用 type='风险' / '决策建议'
 * 映射为 high (设计稿 high 加红 "关键" pill + 渐变背景).
 *
 * 接 backend AIInsightFull (todays_insights).
 */

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

import { MRAIAvatar, gradientForAgentColor } from "@/components/mobile/shared/avatars";
import Icon from "@/components/mobile/shared/Icon";
import MAStatusPill from "@/components/mobile/shared/MAStatusPill";
import type { AIInsightFull } from "@/lib/mobile/types";

const HIGH_IMPACT_TYPES = new Set<string>(["风险", "决策建议"]);

function timeAgoLabel(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export default function InsightCard({
  it,
}: {
  it: AIInsightFull;
}): ReactElement {
  const router = useRouter();
  const isHigh = HIGH_IMPACT_TYPES.has(it.type);
  const grad = gradientForAgentColor(null); // backend 暂未给 agent_color in AIInsightFull
  const agentDisplay = it.agent_nickname?.trim() || it.agent_name;
  const role = it.agent_nickname?.trim() ? it.agent_name : it.type;
  const when = timeAgoLabel(it.created_at);
  const where = it.meeting_title || "未知会议";

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        border: "0.5px solid rgba(60,60,67,0.10)",
        position: "relative",
      }}
    >
      <div
        style={{
          padding: "12px 14px 12px",
          background: isHigh
            ? "linear-gradient(135deg, rgba(255,59,48,0.06), rgba(255,159,10,0.05))"
            : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <MRAIAvatar grad={grad} size={26} ring="transparent" />
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
              {agentDisplay}
              <span
                style={{ fontSize: 11, fontWeight: 400, color: "#8E8E93" }}
              >
                {role}
              </span>
            </div>
            <div
              style={{ fontSize: 11, color: "#8E8E93", marginTop: 1 }}
            >
              {when} · {where}
            </div>
          </div>
          {isHigh ? <MAStatusPill kind="overdue">关键</MAStatusPill> : null}
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
          {it.content}
        </div>
        {it.evidence ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "#3C3C43",
              lineHeight: 1.5,
            }}
          >
            {it.evidence}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          background: "#FAFAFC",
          borderTop: "0.5px solid rgba(60,60,67,0.06)",
          fontSize: 12,
        }}
      >
        <span style={{ color: "#8E8E93" }}>来源会议</span>
        <button
          type="button"
          onClick={() => {
            if (it.meeting_id) router.push(`/m/meetings/${it.meeting_id}`);
          }}
          style={{
            background: "none",
            border: "none",
            color: "#007AFF",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: 0,
          }}
        >
          查看上下文
          <Icon name="chev" size={11} color="#007AFF" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
