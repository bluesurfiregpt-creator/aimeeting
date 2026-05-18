"use client";

/**
 * v27.0-mobile · AI 专家工卡 — 专家视角主单元.
 *
 * 用户校准 A+B 合一: 每张工卡含
 *   - Header: ◆ nickname · 专业 + 活跃指示
 *   - 最近 2-3 条产出 (chip + 内容截断)
 *   - Footer: 累计 N 场 · M 条智囊 · 最后活跃
 *
 * 不展示大头像 (避免通讯录感), 用色点 + nickname 区分.
 * 点工卡 → /m/agents/[id] 详情 (Phase 3 真做, 现 alert 占位).
 */

import { TypeChip } from "./AIInsightCard";
import type { AgentWorkCard } from "@/lib/mobile/types";

// agent color → 卡片左边 accent (跟桌面端 agent.color 一致)
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

export default function AgentWorkCard({
  agent,
  onClick,
}: {
  agent: AgentWorkCard;
  onClick?: () => void;
}) {
  const display = agent.nickname?.trim() || agent.name;
  const hasNickname = !!(agent.nickname?.trim() && agent.nickname.trim() !== agent.name);
  const isActive = agent.last_active !== null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full overflow-hidden rounded-2xl bg-ink-900 text-left active:scale-[0.99] transition"
      data-testid="mobile-agent-workcard"
    >
      <div className="flex">
        {/* 左侧色块条 — 跟 agent.color 对应 */}
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

          {/* 最近产出 */}
          {agent.recent_insights.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {agent.recent_insights.map((ins) => (
                <li key={ins.id} className="flex items-start gap-2">
                  <TypeChip type={ins.type} />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-zinc-300">
                    {ins.content}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-zinc-600">
              这个专家还没产出过判断 · 召它进会议试试
            </p>
          )}

          {/* Footer 累计指标 */}
          <footer className="mt-3 flex items-center gap-3 text-[12px] text-zinc-500">
            <span>📅 {agent.meetings_count} 场</span>
            <span>💡 {agent.insights_count} 条智囊</span>
          </footer>
        </div>
      </div>
    </button>
  );
}
