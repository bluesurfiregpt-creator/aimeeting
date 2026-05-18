"use client";

/**
 * v27.0-mobile · v2 AI 专家工卡 — 用户校准.
 *
 * 不再展示「最近 AI 智囊产出」, 改展示
 *   1. 最近参加的几次会议 (小卡片列表)
 *   2. 归属任务汇总 (进行中 / 已完成 / 超期)
 *
 * 点工卡 → /m/agents/[id] 展开两部分详细列表 (Phase 3).
 */

import type { AgentWorkCard } from "@/lib/mobile/types";

const COLOR_BAR: Record<string, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
};

function colorBar(color: string | null): string {
  if (!color) return "bg-zinc-700";
  return COLOR_BAR[color] || "bg-zinc-700";
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
  onClick,
}: {
  agent: AgentWorkCard;
  onClick?: () => void;
}) {
  const display = agent.nickname?.trim() || agent.name;
  const hasNickname = !!(
    agent.nickname?.trim() && agent.nickname.trim() !== agent.name
  );
  const isActive = agent.last_active !== null;
  const tasks = agent.tasks;
  const hasTasks = tasks.total > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full overflow-hidden rounded-2xl bg-ink-900 text-left transition active:scale-[0.99]"
      data-testid="mobile-agent-workcard"
    >
      <div className="flex">
        {/* 左侧色块条 */}
        <div className={`w-1 ${colorBar(agent.color)}`} />

        <div className="min-w-0 flex-1 p-4">
          {/* Header */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[17px] font-medium text-zinc-50">
                {display}
              </h3>
              {agent.domain ? (
                <p className="mt-0.5 truncate text-[13px] text-zinc-500">
                  {agent.domain}
                  {hasNickname ? (
                    <span className="text-zinc-700"> · {agent.name}</span>
                  ) : null}
                </p>
              ) : null}
            </div>
            {isActive ? (
              <span className="shrink-0 text-[11px] text-zinc-600">
                {timeAgo(agent.last_active)}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500">
                未激活
              </span>
            )}
          </div>

          {/* 两个小卡 — 最近会议 + 任务汇总 */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {/* ---- 最近会议 小卡 ------------------------------------------- */}
            <div className="rounded-xl bg-ink-800 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-zinc-500">最近会议</span>
                {agent.recent_meetings.length > 0 ? (
                  <span className="text-[11px] text-zinc-600">
                    {agent.recent_meetings.length} 场
                  </span>
                ) : null}
              </div>
              {agent.recent_meetings.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-zinc-600">未参会</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {agent.recent_meetings.slice(0, 3).map((m) => (
                    <li
                      key={m.meeting_id}
                      className="flex items-baseline gap-1.5"
                    >
                      {m.started_at ? (
                        <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums">
                          {meetingShortDate(m.started_at)}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">
                        {m.title}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---- 任务汇总 小卡 ------------------------------------------- */}
            <div className="rounded-xl bg-ink-800 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-zinc-500">任务</span>
                {hasTasks ? (
                  <span className="text-[11px] text-zinc-600">
                    共 {tasks.total}
                  </span>
                ) : null}
              </div>
              {!hasTasks ? (
                <p className="mt-1.5 text-[12px] text-zinc-600">未分配</p>
              ) : (
                <div className="mt-1.5 space-y-1">
                  {tasks.open_count > 0 ? (
                    <p className="text-[12px] text-zinc-300">
                      <span className="tabular-nums">{tasks.open_count}</span>
                      <span className="ml-1 text-zinc-500">进行中</span>
                    </p>
                  ) : null}
                  {tasks.done_count > 0 ? (
                    <p className="text-[12px] text-zinc-300">
                      <span className="tabular-nums">{tasks.done_count}</span>
                      <span className="ml-1 text-zinc-500">已完成</span>
                    </p>
                  ) : null}
                  {tasks.overdue_count > 0 ? (
                    <p className="text-[12px] text-rose-300">
                      <span className="tabular-nums">
                        {tasks.overdue_count}
                      </span>
                      <span className="ml-1 text-rose-400/80">超期</span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
