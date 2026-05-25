"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-2 · 紧凑上下文条 (40px 折叠态).
 *
 * 设计源 1:1: round-2 design bundle
 *   `docs/design/handoffs/2026-05-25-meeting-room-r2/` (未落盘 — 见 PM 在
 *    Claude Design 给的 handoff: meeting-room.jsx:490-588 `CompactContextBar`).
 *
 * 单条 40px 信息密度: 一行同时承载
 *   • 绿色脉冲点 (有人说话时跳)
 *   • 议程编号 + 标题 (truncate) + 剩余分钟 (橙)
 *   • 资料数量图标 (新文件时挂红点)
 *   • 3 头像叠加 + "+N · X AI" 后缀
 *   • chevron (180deg 旋转)
 *
 * 用法: 父组件管 expanded state. 这个组件只渲染那 40px 触发条 (按钮),
 * 父组件负责把下方真正的 strips (AgendaStrip / MaterialsStrip /
 * ParticipantsStrip) 包在 max-height collapsible div 里. 这样不跟原 strip
 * 内部逻辑耦合.
 *
 * round-3 (2026-05-25, PM 最满意版本): materials 用 MaterialsStrip 接入,
 * 跟议程 / 参与人 一起折叠 (旧版 AttachmentsSection 仅在 创建页 / 总结页 用).
 *
 * R2 peek-then-tuck (在父组件 useEffect 里):
 *   - mount 后默认 expanded = true
 *   - 2.5s 后自动 collapse (除非 user 手动 toggle 过)
 *   - 滚动 transcript > 24px 时 自动 collapse
 */

import type { ReactElement } from "react";

import type { MobileMeetingAgendaItem } from "@/lib/mobile/types";

import { MRHumanAvatar } from "./avatars";
import type { MockHumanId } from "./avatars";
import { MOCK_HUMANS } from "./avatars";
import { MR_COLORS } from "./styles";

type Props = {
  /** 议程列表 (用于算 X/N + 取当前 title + 剩余分钟). */
  agendaItems: MobileMeetingAgendaItem[];
  /** 当前激活议程 idx (后端). 不存在 → 用 active status fallback. */
  currentAgendaIdx: number | null;
  /** 是否全议程完成 (从 backend is_agenda_complete). */
  isAgendaComplete: boolean;
  /** 资料数量 (来自 页面层 materials state). */
  materialsCount: number;
  /** 有 "新" 文件 (会中上传的) → 资料图标右上挂红点. R3 — 暂用 boolean,
   *  后续接 backend uploaded_at vs meeting started_at 推断. */
  materialsHasNew: boolean;
  /** 真人 + AI 头像列表 (前 3 个真人渲染, 加 "+N · X AI" 计数). */
  participantHumans: { id: MockHumanId; color: string; name: string }[];
  /** AI 数量 (用于后缀 "X AI"). */
  aiCount: number;
  /** 当前是否有人正在说话 (用于 livePulse 动画). */
  isLive: boolean;
  /** 展开状态. */
  expanded: boolean;
  /** 点击触发 toggle. */
  onToggle: () => void;
};

export default function CompactContextBar({
  agendaItems,
  currentAgendaIdx,
  isAgendaComplete,
  materialsCount,
  materialsHasNew,
  participantHumans,
  aiCount,
  isLive,
  expanded,
  onToggle,
}: Props): ReactElement {
  // 当前议程 (跟 StageChipsRow 同算法)
  const cur = (() => {
    if (isAgendaComplete) return null;
    if (
      currentAgendaIdx !== null &&
      currentAgendaIdx >= 0 &&
      agendaItems[currentAgendaIdx]
    )
      return agendaItems[currentAgendaIdx];
    return agendaItems.find((it) => it.status === "active") || agendaItems[0];
  })();

  const totalAgenda = agendaItems.length;
  const curIdx = cur
    ? agendaItems.indexOf(cur) + 1
    : Math.max(1, totalAgenda);
  const remainingMin = (() => {
    if (!cur) return null;
    // backend 给的字段: time_budget_min (议程预算) + 暂没 elapsed.
    // R3: 简化 — 直接用 time_budget_min 当 "剩余分钟" 显示, 后续接
    // backend agenda_elapsed_min 时再扣 (跟 StageChipsRow 同处理).
    return cur.time_budget_min || null;
  })();

  const humansSlice = participantHumans.slice(0, 3);
  const extraHumans = Math.max(0, participantHumans.length - 3);

  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="mobile-compact-context-bar"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 12px 0 14px",
        height: 40,
        background: MR_COLORS.bgWhite,
        border: "none",
        borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        fontFamily: "inherit",
        cursor: "pointer",
        textAlign: "left",
        flexShrink: 0,
      }}
      aria-expanded={expanded}
      aria-label={expanded ? "收起会议上下文" : "展开会议上下文"}
    >
      {/* live dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: MR_COLORS.systemGreen,
          flexShrink: 0,
          boxShadow: `0 0 0 2px rgba(52,199,89,0.18)`,
          animation: isLive
            ? "mr-livePulse 1.4s ease-in-out infinite"
            : "none",
        }}
      />

      {/* agenda label + title + remaining */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 5,
          minWidth: 0,
          flex: 1,
        }}
      >
        {totalAgenda > 0 && cur ? (
          <>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: MR_COLORS.textTertiary,
                letterSpacing: 0.4,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              议程 {curIdx}/{totalAgenda}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: MR_COLORS.textPrimary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {cur.title}
            </span>
            {remainingMin !== null ? (
              <span
                style={{
                  fontSize: 11,
                  color: MR_COLORS.systemOrange,
                  fontWeight: 600,
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                · 剩 {remainingMin}m
              </span>
            ) : null}
          </>
        ) : (
          <span
            style={{
              fontSize: 12,
              color: MR_COLORS.textTertiary,
              whiteSpace: "nowrap",
            }}
          >
            {isAgendaComplete ? "议程已全部完成" : "暂无议程"}
          </span>
        )}
      </div>

      {/* divider */}
      <span
        style={{
          width: 0.5,
          height: 16,
          background: MR_COLORS.separatorLight,
          flexShrink: 0,
        }}
      />

      {/* materials count + new dot */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          style={{ display: "block" }}
          aria-hidden="true"
        >
          <path
            d="M7 3 H15 L20 8 V20 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1z"
            stroke={MR_COLORS.textSecondary}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M15 3 V8 H20"
            stroke={MR_COLORS.textSecondary}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: MR_COLORS.textPrimary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {materialsCount}
        </span>
        {materialsHasNew ? (
          <span
            style={{
              position: "absolute",
              top: -3,
              left: 8,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: MR_COLORS.systemRed,
              boxShadow: `0 0 0 1.5px ${MR_COLORS.bgWhite}`,
            }}
            aria-label="有新上传"
          />
        ) : null}
      </div>

      {/* people stack */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          marginLeft: 2,
        }}
      >
        {humansSlice.map((p, i) => (
          <span
            key={p.id}
            style={{
              marginLeft: i === 0 ? 0 : -6,
              zIndex: 5 - i,
            }}
          >
            <MRHumanAvatar
              name={p.name}
              color={p.color}
              size={18}
              ring={MR_COLORS.bgWhite}
            />
          </span>
        ))}
        {extraHumans > 0 || aiCount > 0 ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: MR_COLORS.textTertiary,
              marginLeft: 5,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {extraHumans > 0 ? `+${extraHumans}` : ""}
            {extraHumans > 0 && aiCount > 0 ? "·" : ""}
            {aiCount > 0 ? `${aiCount}AI` : ""}
          </span>
        ) : null}
      </div>

      {/* chevron */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        style={{
          transform: expanded ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 240ms ease",
          flexShrink: 0,
          marginLeft: 2,
        }}
        aria-hidden="true"
      >
        <path
          d="M6 9l6 6 6-6"
          stroke={MR_COLORS.textTertiary}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}

/**
 * 父组件用. 把传入的 children 包到一个 max-height collapsible 容器里.
 * 跟 CompactContextBar 配对使用 — 父组件管 expanded state, 同时传给两者.
 *
 * R2 设计源: meeting-room.jsx:1787-1801 (round-2).
 */
export function CompactContextExpandable({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        // round-3: 加 MaterialsStrip 后 内容 略增 (~56px), 400 给安全余量
        maxHeight: expanded ? 400 : 0,
        opacity: expanded ? 1 : 0,
        overflow: "hidden",
        transition:
          "max-height 320ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease",
        background: MR_COLORS.bgWhite,
        flexShrink: 0,
      }}
      data-testid="mobile-compact-context-expandable"
      aria-hidden={!expanded}
    >
      {children}
    </div>
  );
}

/** Re-export helper for 真人列表 (供页面层组装 participantHumans 用). */
export { MOCK_HUMANS };
