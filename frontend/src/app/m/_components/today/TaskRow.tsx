"use client";

/**
 * Saga · mobile-app-r4-A · today 页 等你处理 task mini row.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:376-422
 *
 * 这是 today 页内 list 形态 — 与 /m/tasks 完整 TaskCardFull 不同 (那是 Saga B).
 * 列表行: 空 checkbox + 标题 + 紧急度 chip + AI 头像 + 来源会议 + 截止时间.
 *
 * 接 backend WorkbenchPendingTask. priority 后端没字段, 用 source kind 推:
 *   confirm → high (红 "紧急"), approve_draft → mid (橙 "今日"), 其他 → mid.
 */

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

import { MRAIAvatar } from "@/components/mobile/shared/avatars";
import type {
  WorkbenchPendingTask,
} from "@/lib/mobile/types";

type Priority = "high" | "mid" | "low";

const PRIO: Record<Priority, { bg: string; label: string }> = {
  high: { bg: "#FF3B30", label: "紧急" },
  mid: { bg: "#FF9F0A", label: "今日" },
  low: { bg: "#8E8E93", label: "本周" },
};

function priorityFromKind(kind: string): Priority {
  if (kind === "confirm" || kind === "blocked") return "high";
  if (kind === "approve_draft") return "mid";
  return "mid";
}

type Props = {
  t: WorkbenchPendingTask;
  last?: boolean;
};

export default function TaskRow({ t, last = false }: Props): ReactElement {
  const router = useRouter();
  const prio = PRIO[priorityFromKind(t.kind)];
  const insight = t.insights?.[0]; // 取首个 AI 智囊作为 sourceAI 头像
  const agentLabel = insight
    ? insight.agent_nickname?.trim() || insight.agent_name
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        // confirm = action item, draft = no detail page; 仅 action 跳详情
        if (t.kind !== "approve_draft") {
          router.push(`/m/tasks/${t.id}`);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/m/tasks/${t.id}`);
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "11px 14px",
        borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1.6px solid #C7C7CC",
          marginTop: 1,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "#1C1C1E",
            lineHeight: 1.35,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 5,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "#fff",
              background: prio.bg,
              padding: "1px 5px",
              borderRadius: 4,
              letterSpacing: 0.3,
            }}
          >
            {prio.label}
          </span>
          {insight && agentLabel ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "#8E8E93",
              }}
            >
              <MRAIAvatar size={13} ring="transparent" />
              {agentLabel}
            </span>
          ) : null}
          {t.source_meeting_title ? (
            <>
              <span style={{ fontSize: 11, color: "#C7C7CC" }}>·</span>
              <span style={{ fontSize: 11, color: "#8E8E93" }}>
                {t.source_meeting_title}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "#FF9F0A",
          fontWeight: 600,
          marginTop: 2,
          flexShrink: 0,
        }}
      >
        {t.cta_label}
      </span>
    </div>
  );
}
