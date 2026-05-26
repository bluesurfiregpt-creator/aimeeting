"use client";

/**
 * v27.0-mobile · v3 AI 专家工卡 — 按 design-tokens.md 重做.
 *
 * 旧版用 grid-cols-2 两张子卡, 字号被挤到 11/12px, 手机看不清.
 * 新版纵向堆叠, 直接全宽展示, 每条 ≥ 14px.
 *
 * v27.0-mobile P19.1: 默认 折叠 — 仅显头部 (名 + 领域 + 时间).
 *   31 个 专家 + 每个 含 3-5 场 最近会议 + 任务 分项, 不折叠 一页 滑不完.
 *   交互:
 *     - 点 卡片任意 空白 / 文字 → 导航 进 专家详情 (跟之前 行为 一致)
 *     - 点 右上角 ▼ chevron button → 仅 toggle 本卡 展开 (不导航)
 *   状态 local useState, 跨刷新 全部 折叠 (无持久化, mvp 不必).
 *
 * 结构 (展开 时):
 *   Header: name (17px medium) + domain (14px) | 时间戳 + ▼ chevron
 *   行 1: 📅 最近会议 (label 14px) | 数字 (caption 13px)
 *         · MM/DD 会议标题 (15px x 最多 3 条)
 *   行 2: 📋 任务 (label 14px) + 横向数字: 3 进行中 · 1 已完成 · 1 超期
 *
 * v1.4.0 Saga L · 浅色化 (跟 today 主 tab + TaskCard 一致).
 */

import { useState } from "react";
import Link from "next/link";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type { AgentWorkCard } from "@/lib/mobile/types";

// 色条用 iOS 系统色 (浅色卡左侧 1px 色条)
const COLOR_BAR: Record<string, string> = {
  violet: "#5E5CE6",
  emerald: "#34C759",
  amber: "#FF9F0A",
  sky: "#5AC8FA",
  rose: "#FF3B30",
  teal: "#30B0C7",
  blue: "#007AFF",
  indigo: "#5856D6",
};

function colorBar(color: string | null): string {
  if (!color) return MR_COLORS.separator;
  return COLOR_BAR[color] || MR_COLORS.separator;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 月前`;
}

function meetingShortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AgentWorkCard({
  agent,
  href,
  onClick,
  defaultExpanded = false,
}: {
  agent: AgentWorkCard;
  /** 给 href 渲染为 Link (推荐). 不给 href 则渲染 div, 配合外层 Link 用. */
  href?: string;
  onClick?: () => void;
  /** P19.1: 默认折叠 (false). 调用方 可显式 true 强制展开 (例 单卡详情场景). */
  defaultExpanded?: boolean;
}) {
  const display = agent.nickname?.trim() || agent.name;
  const hasNickname = !!(
    agent.nickname?.trim() && agent.nickname.trim() !== agent.name
  );
  const isActive = agent.last_active !== null;
  const tasks = agent.tasks;
  const hasTasks = tasks.total > 0;
  const meetings = agent.recent_meetings;

  // v27.0-mobile P19.1: 折叠状态. 跨卡 独立, 跨刷新 全部 折叠.
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 数字摘要 — 折叠态 给用户 一眼能看到 "有内容可展开".
  const summaryBits: string[] = [];
  if (meetings.length > 0) summaryBits.push(`${meetings.length} 场会议`);
  if (tasks.open_count > 0) summaryBits.push(`${tasks.open_count} 进行中`);
  if (tasks.overdue_count > 0)
    summaryBits.push(`${tasks.overdue_count} 超期`);
  if (summaryBits.length === 0 && hasTasks)
    summaryBits.push(`${tasks.total} 任务`);

  const rootCls =
    "block w-full overflow-hidden rounded-2xl text-left transition active:scale-[0.99]";
  const rootStyle: React.CSSProperties = {
    background: MR_COLORS.bgWhite,
    border: `0.5px solid ${MR_COLORS.hairline}`,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    href ? (
      <Link
        href={href}
        className={rootCls}
        style={rootStyle}
        data-testid="mobile-agent-workcard"
      >
        {children}
      </Link>
    ) : (
      <div
        onClick={onClick}
        className={rootCls}
        style={rootStyle}
        data-testid="mobile-agent-workcard"
        role={onClick ? "button" : undefined}
      >
        {children}
      </div>
    );

  return (
    <Wrapper>
      <div className="flex">
        {/* 左侧色块条 */}
        <div className="w-1" style={{ background: colorBar(agent.color) }} />

        <div className="min-w-0 flex-1 p-4">
          {/* === Header === */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-[17px] font-semibold leading-tight"
                style={{ color: MR_COLORS.textPrimary }}
              >
                {display}
              </h3>
              {agent.domain ? (
                <p
                  className="mt-1 truncate text-[14px]"
                  style={{ color: MR_COLORS.textSecondary }}
                >
                  {agent.domain}
                  {hasNickname ? (
                    <span style={{ color: MR_COLORS.textTertiary }}>
                      {" "}
                      · {agent.name}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {/* v27.0-mobile P19.1: 折叠态 显 数字摘要 — 让 用户 一眼 看到
                  有几场会议 / 几条任务, 不必展开 也能 大致判断 是否相关. */}
              {!expanded && summaryBits.length > 0 ? (
                <p
                  className="mt-1.5 truncate text-[13px]"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  {summaryBits.join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isActive ? (
                <span
                  className="text-[13px]"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  {timeAgo(agent.last_active)}
                </span>
              ) : (
                <span
                  className="rounded-full px-2.5 py-1 text-[13px]"
                  style={{
                    background: MR_COLORS.separatorLight,
                    color: MR_COLORS.textSecondary,
                  }}
                >
                  未激活
                </span>
              )}
              {/* P19.1: 展开/折叠 chevron — stopPropagation + preventDefault
                  防止 触发 外层 Link 跳详情. role=button + aria-expanded 给
                  屏幕阅读器. */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full active:scale-[0.9]"
                style={{
                  background: MR_COLORS.separatorLight,
                  color: MR_COLORS.textSecondary,
                }}
                aria-expanded={expanded}
                aria-label={expanded ? "折叠" : "展开"}
                data-testid="mobile-agent-card-toggle"
              >
                <span
                  className={`inline-block text-[12px] transition-transform ${
                    expanded ? "rotate-180" : ""
                  }`}
                >
                  ▼
                </span>
              </button>
            </div>
          </div>

          {/* === 详细 内容 — 仅 展开 时 渲染 === */}
          {expanded ? (
          <>
          {/* === 最近会议 === */}
          <section className="mt-4">
            <div className="flex items-baseline justify-between">
              <h4
                className="text-[14px] font-medium"
                style={{ color: MR_COLORS.textSecondary }}
              >
                📅 最近会议
              </h4>
              {meetings.length > 0 ? (
                <span
                  className="text-[13px]"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  {meetings.length} 场
                </span>
              ) : null}
            </div>
            {meetings.length === 0 ? (
              <p
                className="mt-2 text-[14px]"
                style={{ color: MR_COLORS.textTertiary }}
              >
                未参会
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {meetings.slice(0, 3).map((m) => (
                  <li key={m.meeting_id} className="flex items-baseline gap-2">
                    {m.started_at ? (
                      <span
                        className="shrink-0 text-[14px] tabular-nums"
                        style={{ color: MR_COLORS.textTertiary }}
                      >
                        {meetingShortDate(m.started_at)}
                      </span>
                    ) : null}
                    <span
                      className="min-w-0 flex-1 truncate text-[15px]"
                      style={{ color: MR_COLORS.textPrimary }}
                    >
                      {m.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* === 任务 === */}
          <section
            className="mt-4 pt-3"
            style={{ borderTop: `0.5px solid ${MR_COLORS.hairline}` }}
          >
            <div className="flex items-baseline justify-between">
              <h4
                className="text-[14px] font-medium"
                style={{ color: MR_COLORS.textSecondary }}
              >
                📋 任务
              </h4>
              {hasTasks ? (
                <span
                  className="text-[13px]"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  共 {tasks.total}
                </span>
              ) : null}
            </div>
            {!hasTasks ? (
              <p
                className="mt-2 text-[14px]"
                style={{ color: MR_COLORS.textTertiary }}
              >
                未分配
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                {tasks.open_count > 0 ? (
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[17px] font-semibold tabular-nums"
                      style={{ color: MR_COLORS.textPrimary }}
                    >
                      {tasks.open_count}
                    </span>
                    <span
                      className="text-[14px]"
                      style={{ color: MR_COLORS.textSecondary }}
                    >
                      进行中
                    </span>
                  </div>
                ) : null}
                {tasks.done_count > 0 ? (
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[17px] font-semibold tabular-nums"
                      style={{ color: MR_COLORS.systemGreen }}
                    >
                      {tasks.done_count}
                    </span>
                    <span
                      className="text-[14px]"
                      style={{ color: MR_COLORS.textSecondary }}
                    >
                      已完成
                    </span>
                  </div>
                ) : null}
                {tasks.overdue_count > 0 ? (
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[17px] font-semibold tabular-nums"
                      style={{ color: MR_COLORS.systemRed }}
                    >
                      {tasks.overdue_count}
                    </span>
                    <span
                      className="text-[14px]"
                      style={{ color: MR_COLORS.systemRed }}
                    >
                      超期
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </section>
          </>
          ) : null}
        </div>
      </div>
    </Wrapper>
  );
}
