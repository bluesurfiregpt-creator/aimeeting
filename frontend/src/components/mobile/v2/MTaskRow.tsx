"use client";

/**
 * v1.4.0 · Saga O (Phase 1 W3) · Mobile App v2 · MTaskRow.
 *
 * 等你处理 / 跟踪中 / 已完成 任意状态 的 单行任务 atom.
 * 提取自 /m/page.tsx 内联 PendingTaskRow (Saga N 写的), 加 status 处理.
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx
 * (tasks 视角 — 圆 radio + 标题 + urgency pill + AI badge + due_display 右靠).
 *
 * status="done": radio 打勾 + 标题 line-through + 整体灰色.
 *
 * 视觉锚:
 *   - 圆 radio 20×20, 1.6px 灰描边, marginTop 1
 *   - 标题 14px weight 500 #1C1C1E
 *   - 副栏 6px gap, marginTop 5: pill + AI badge(13px) + AI name + meeting
 *   - due_display 右靠 11px weight 600, 颜色按 urgency
 *
 * 颜色 (urgency due):
 *   urgent → #FF3B30  · today → #FF9F0A  · 其他 → #8E8E93
 *   done   → #8E8E93  覆盖
 */

import Link from "next/link";
import type { ReactElement } from "react";

import MAIBadge from "./MAIBadge";
import MAPill from "./MAPill";
import MAIcon from "./MAIcon";
import type { V2Urgency, V2TaskItem, V2TaskStatus } from "./types";
import type { V2PillTone } from "./MAPill";

const URGENCY_TONE: Record<V2Urgency, V2PillTone> = {
  urgent: "urgent",
  today: "today",
  week: "week",
  none: "neutral",
};
const URGENCY_LABEL: Record<V2Urgency, string> = {
  urgent: "紧急",
  today: "今日",
  week: "本周",
  none: "—",
};

function dueColor(urgency: V2Urgency, status: V2TaskStatus): string {
  if (status === "done") return "#8E8E93";
  if (urgency === "urgent") return "#FF3B30";
  if (urgency === "today") return "#FF9F0A";
  return "#8E8E93";
}

type Props = {
  task: V2TaskItem;
  /** 行的尾部分隔线是否隐藏 (list 末尾给 true). */
  last?: boolean;
  /** 用户点击 radio 切换状态. 不传时 radio 不响应. */
  onToggleStatus?: (id: string) => void;
};

export default function MTaskRow({
  task,
  last = false,
  onToggleStatus,
}: Props): ReactElement {
  const done = task.status === "done";
  const dc = dueColor(task.urgency, task.status);
  const titleColor = done ? "#8E8E93" : "#1C1C1E";
  const titleDecoration = done ? "line-through" : "none";

  // radio 圆 — done 时 实心绿 + 白勾, 否则 灰描边 空
  const radioNode = done ? (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#34C759",
        marginTop: 1,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MAIcon name="check" size={12} color="#fff" strokeWidth={2.8} />
    </div>
  ) : (
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
  );

  const radio = onToggleStatus ? (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleStatus(task.id);
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "flex-start",
      }}
      aria-label={done ? "标记未完成" : "标记完成"}
    >
      {radioNode}
    </button>
  ) : (
    radioNode
  );

  const inner = (
    <>
      {radio}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: titleColor,
            lineHeight: 1.35,
            textDecoration: titleDecoration,
          }}
        >
          {task.title}
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
          <MAPill
            tone={URGENCY_TONE[task.urgency]}
            label={URGENCY_LABEL[task.urgency]}
          />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "#8E8E93",
            }}
          >
            <MAIBadge
              name={task.ai_source.name}
              glyph={task.ai_source.glyph}
              gradient_from={task.ai_source.color}
              gradient_to={task.ai_source.color}
              size={13}
              ring="transparent"
            />
            {task.ai_source.name}
          </span>
          {task.source_meeting ? (
            <>
              <span style={{ fontSize: 11, color: "#C7C7CC" }}>·</span>
              <span style={{ fontSize: 11, color: "#8E8E93" }}>
                {task.source_meeting}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: dc,
          fontWeight: 600,
          marginTop: 2,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {task.due_display}
      </span>
    </>
  );

  const rowStyle = {
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
    padding: "11px 14px",
    borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
    textDecoration: "none",
    color: "inherit",
  } as const;

  // 有 source_meeting_id → wrap Link 跳源会议; 否则 静态 div.
  if (task.source_meeting_id) {
    return (
      <Link
        href={`/m/meetings/${task.source_meeting_id}`}
        style={rowStyle}
        data-testid="m-task-row"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div style={rowStyle} data-testid="m-task-row">
      {inner}
    </div>
  );
}
