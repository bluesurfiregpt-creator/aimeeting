"use client";

/**
 * v27.0-mobile · Phase 5A · 会议完整转录视图.
 *
 * 替代旧 details 占位 "Phase 2 — 完整转录视图". 静态版:
 *   - 进页面拉一次 GET /api/m/meetings/{id}/transcript
 *   - 顶部一行 meta: "共 N 句真人 · M 条 AI 发言" + 右上 "刷新" 按钮
 *   - 滚动列表渲染合并流 (按 created_at 正序):
 *       user line: 时间 + 说话人名字 + 文本
 *       agent line: 头像色块 + nickname + trigger chip + 文本 + (可选) 引用数
 *   - 不接 WS (那是 P5B). 用户手动点刷新拿最新.
 *
 * 不在 meeting 详情页主区域直接展开 — 它在 details 折叠区里 (避免一进会议页就拉一大坨数据).
 * 用户主动展开 details 时 lazy load.
 */

import { useCallback, useEffect, useState } from "react";
import { mApi } from "@/lib/mobile/api";
import type { MobileTranscriptOut, TranscriptStreamLine } from "@/lib/mobile/types";

const AGENT_COLOR_BG: Record<string, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
};

function agentColorBg(c: string | null): string {
  if (!c) return "bg-zinc-700";
  return AGENT_COLOR_BG[c] || "bg-zinc-700";
}

// trigger 字段 → 中文标签
const TRIGGER_LABEL: Record<string, string> = {
  manual: "召唤",
  auto_orchestrator: "自动",
  keyword: "关键词",
  at_mention: "@",
};

function fmtMinute(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h${rem ? rem + "m" : ""}`;
}

export default function MeetingTranscriptView({
  meetingId,
}: {
  meetingId: string;
}) {
  const [data, setData] = useState<MobileTranscriptOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const d = await mApi.getMeetingTranscript(meetingId);
        setData(d);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isRefresh) setRefreshing(false);
        setLoading(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-ink-900" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4 text-center">
        <p className="text-[14px] text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => load(true)}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-[14px] text-zinc-200"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="px-4 pt-3 pb-4">
      {/* meta 行 — 计数 + 刷新按钮 */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[13px] text-zinc-400">
          共 <span className="font-medium text-zinc-200 tabular-nums">{data.total_user_lines}</span> 句真人 ·{" "}
          <span className="font-medium text-zinc-200 tabular-nums">{data.total_agent_lines}</span> 条 AI 发言
        </p>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 px-3 text-[13px] font-medium text-zinc-200 active:scale-[0.97] active:bg-ink-800 disabled:opacity-60"
        >
          {refreshing ? "刷新中…" : "↻ 刷新"}
        </button>
      </div>

      {/* 主列表 */}
      {data.lines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-[14px] text-zinc-500">
          这场会议还没有任何发言
        </p>
      ) : (
        <ol className="space-y-2.5" data-testid="mobile-transcript-list">
          {data.lines.map((l) => (
            <li key={`${l.kind}-${l.id}`}>
              {l.kind === "user" ? <UserLine line={l} /> : <AgentLine line={l} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ===== 子组件 =============================================================

function UserLine({ line }: { line: TranscriptStreamLine }) {
  return (
    <div className="flex items-baseline gap-2.5 rounded-lg bg-ink-900/40 px-3 py-2.5" data-testid="transcript-user-line">
      <span className="shrink-0 text-[13px] tabular-nums text-zinc-500">
        {fmtMinute(line.at_minute)}
      </span>
      {line.speaker_name ? (
        <span className="shrink-0 text-[14px] font-medium text-zinc-300">
          {line.speaker_name}
        </span>
      ) : (
        <span className="shrink-0 text-[14px] text-zinc-500">未识别</span>
      )}
      <p className="min-w-0 flex-1 text-[15px] leading-snug text-zinc-100 whitespace-pre-wrap">
        {line.text}
      </p>
    </div>
  );
}

function AgentLine({ line }: { line: TranscriptStreamLine }) {
  const display = line.agent_nickname?.trim() || line.agent_name || "AI";
  const triggerLabel = line.trigger ? TRIGGER_LABEL[line.trigger] : null;
  return (
    <div
      className="rounded-lg border border-violet-500/25 bg-violet-500/[0.05] p-3"
      data-testid="transcript-agent-line"
    >
      <header className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium text-white ${agentColorBg(line.agent_color)}`}
        >
          ◆
        </span>
        <span className="min-w-0 truncate text-[14px] font-medium text-zinc-100">
          {display}
        </span>
        {triggerLabel ? (
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[12px] text-zinc-400">
            {triggerLabel}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[13px] tabular-nums text-zinc-500">
          {fmtMinute(line.at_minute)}
        </span>
      </header>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap">
        {line.text}
      </p>
      {line.citations_count > 0 ? (
        <p className="mt-2 text-[12px] text-zinc-500">
          📎 引用 {line.citations_count} 条 KB
        </p>
      ) : null}
    </div>
  );
}
