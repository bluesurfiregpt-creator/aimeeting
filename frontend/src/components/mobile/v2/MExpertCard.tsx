"use client";

/**
 * v1.4.0 · Saga N · AI 专家折叠卡 (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-today.jsx:622-702
 * (ExpertCard).
 *
 * 白卡 14px 圆角 + 0.5px hairline + 左侧 4px 渐变色带 (vertical, full-height)
 *   + 36px MAIBadge 头像 + 名字 15px weight 700 + role 11.5px 灰 (truncate)
 *   + 右侧 last_active 文字 + 22x22 圆形 chev-down (展开时旋 180deg)
 * 展开后:
 *   - "最近会议 N 场" header (12px weight 700 灰 + cal icon)
 *   - bullet list (• title) 13px black 1.7 lh
 *   - "任务 N 项" header (12px weight 700 灰 + task icon)
 *   - "N 项待处理" / "未分配" 12px 灰
 *
 * 走 V2Expert schema 喂入 (from types.ts).
 */

import { useState, type ReactElement } from "react";
import Link from "next/link";

import MAIBadge from "./MAIBadge";
import MAIcon from "./MAIcon";
import type { V2Expert } from "./types";

type Props = {
  expert: V2Expert;
  defaultExpanded?: boolean;
};

export default function MExpertCard({
  expert,
  defaultExpanded = false,
}: Props): ReactElement {
  const [open, setOpen] = useState<boolean>(defaultExpanded);
  const e = expert;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        border: "0.5px solid rgba(60,60,67,0.10)",
        display: "flex",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
      data-testid="m-expert-card"
      data-expert-id={e.id}
    >
      {/* 左侧 4px 渐变色带 (vertical) */}
      <div
        style={{
          width: 4,
          background: `linear-gradient(180deg, ${e.gradient_from}, ${e.gradient_to})`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
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
          aria-expanded={open}
        >
          <MAIBadge
            name={e.name}
            glyph={e.glyph}
            gradient_from={e.gradient_from}
            gradient_to={e.gradient_to}
            size={36}
            ring="transparent"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>
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
              {e.role_short}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: "#8E8E93" }}>
              {e.last_active_display}
            </div>
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
              <MAIcon
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
              <MAIcon name="cal" size={12} color="#3C3C43" strokeWidth={2} />
              最近会议
              <span
                style={{
                  marginLeft: "auto",
                  color: "#8E8E93",
                  fontWeight: 400,
                }}
              >
                {e.recent_meetings.length} 场
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
              {e.recent_meetings.map((m) => (
                <li
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "#C7C7CC" }}>•</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {m.title}
                  </span>
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
              <MAIcon name="task" size={12} color="#3C3C43" strokeWidth={2} />
              任务
              <span
                style={{
                  marginLeft: "auto",
                  color: "#8E8E93",
                  fontWeight: 400,
                }}
              >
                {e.task_count} 项
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: e.task_count > 0 ? "#3C3C43" : "#C7C7CC",
              }}
            >
              {e.task_count > 0 ? `${e.task_count} 项待处理` : "未分配"}
            </div>

            {/* v1.4.0 Phase B · 8 (NORTH_STAR § 6.2 痛点 7): NEW-C 1-on-1 chat 入口.
              * 跳 /m/chat/<agent_id> 触发 backend invoke_agent_for_chat (v26.13.1).
              * sessionStorage 持久化, 关闭即清. */}
            <Link
              href={`/m/chat/${e.id}`}
              data-testid="m-expert-chat-cta"
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                height: 36,
                borderRadius: 18,
                background: "rgba(0,122,255,0.08)",
                border: "0.5px solid rgba(0,122,255,0.30)",
                color: "#007AFF",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                fontFamily: "inherit",
              }}
            >
              <span>💬</span>
              <span>跟 {e.name} 聊聊</span>
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
