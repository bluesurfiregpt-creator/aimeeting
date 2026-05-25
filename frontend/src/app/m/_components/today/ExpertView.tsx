"use client";

/**
 * Saga · mobile-app-r4-A · today 页 专家视角 — 手风琴.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:565-702
 *
 * 6+ ExpertCard 列表, 默认展开 SHU (数小妙) — 反映本地化 AI 专家.
 * 一次只展开一个 (locked accordion), timeline 不跳.
 *
 * [TD-NEW: ExpertView 暂用 hardcode 6 专家]
 * 设计稿是固定 SHU/FALAO/ZHAOJIE + ARIA/STRATOS/SAGE 6 个. 当前 backend
 * agents 是 workspace 可自定义 (AgentsWorkboardOut.agents). 决策按 changelist R6:
 * "保留现有动态 agent (backend), 仅用新视觉" — 但 Saga A 范围是 today 大重写,
 * 不动 backend. 这里短期用 mock (设计稿固定 6+3); Saga B 重写 /m/agents 时再接
 * backend AgentsWorkboardOut, 这部分用 dynamic 数据.
 *
 * 视觉:
 *   - 卡左 4px 渐变 accent 竖条 (基于 expert.grad)
 *   - 36px 渐变头像 (用 expert.glyph)
 *   - 名 + sub + 活跃时间 + chevron 旋转
 *   - 展开: 最近 N 场会议 + N 项任务
 */

import { useState } from "react";
import type { ReactElement } from "react";

import Icon from "@/components/mobile/shared/Icon";

import { MA_EXPERTS, type ExpertEntry } from "./mock";

export default function ExpertView(): ReactElement {
  const [openId, setOpenId] = useState<string | null>("SHU");

  return (
    <>
      <div
        style={{
          padding: "14px 16px 0",
          fontSize: 12,
          color: "#8E8E93",
        }}
      >
        共 {MA_EXPERTS.length} 位 AI 专家 · 按最近活跃排序
      </div>
      <div
        style={{
          padding: "8px 16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {MA_EXPERTS.map((e) => (
          <ExpertCard
            key={e.id}
            e={e}
            open={openId === e.id}
            onToggle={() => setOpenId(openId === e.id ? null : e.id)}
          />
        ))}
      </div>
    </>
  );
}

function ExpertCard({
  e,
  open,
  onToggle,
}: {
  e: ExpertEntry;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        border: "0.5px solid rgba(60,60,67,0.10)",
        display: "flex",
      }}
    >
      <div
        style={{
          width: 4,
          background: `linear-gradient(180deg, ${e.grad[0]}, ${e.grad[1]})`,
        }}
      />
      <div style={{ flex: 1 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 11,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {/* AI badge — 渐变方形 + glyph */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 36 * 0.28,
              background: `linear-gradient(135deg, ${e.grad[0]} 0%, ${e.grad[1]} 100%)`,
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36 * 0.46,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {e.glyph}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}
            >
              {e.name}
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
              {e.sub}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: "#8E8E93" }}>{e.activity}</div>
            <div
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#F2F2F7",
                transform: open ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 200ms ease",
              }}
            >
              <Icon
                name="chev-down"
                size={13}
                color="#8E8E93"
                strokeWidth={2.3}
              />
            </div>
          </div>
        </button>
        {open ? (
          <div
            style={{
              padding: "4px 14px 14px",
              borderTop: "0.5px solid rgba(60,60,67,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                marginTop: 8,
                fontSize: 12,
                fontWeight: 700,
                color: "#3C3C43",
              }}
            >
              <Icon name="cal" size={12} color="#3C3C43" strokeWidth={2} />
              最近会议
              <span
                style={{
                  marginLeft: "auto",
                  color: "#8E8E93",
                  fontWeight: 400,
                }}
              >
                {e.meetingCount} 场
              </span>
            </div>
            <ul
              style={{
                margin: "6px 0 0",
                padding: 0,
                listStyle: "none",
                fontSize: 13,
                color: "#1C1C1E",
                lineHeight: 1.7,
              }}
            >
              {e.recent.map((r, i) => (
                <li
                  key={`${e.id}-recent-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "#C7C7CC" }}>•</span>
                  {r}
                </li>
              ))}
            </ul>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                marginTop: 12,
                fontSize: 12,
                fontWeight: 700,
                color: "#3C3C43",
              }}
            >
              <Icon name="task" size={12} color="#3C3C43" strokeWidth={2} />
              任务
              <span
                style={{
                  marginLeft: "auto",
                  color: "#8E8E93",
                  fontWeight: 400,
                }}
              >
                {e.taskCount} 项
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: e.taskCount ? "#3C3C43" : "#C7C7CC",
              }}
            >
              {e.taskCount ? `${e.taskCount} 项待处理` : "未分配"}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
