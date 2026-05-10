"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type MeetingTrace, type MeetingTraceTask } from "@/lib/api";

/**
 * v23.5 — 会议追溯链.
 *
 * 这次会议沉淀了哪些 Task + 它们现在的状态.每行点开跳到 /task/[id].
 *
 * 只展示「meeting → task」一层(被引用关系如「该 task 又被 X 任务引用」
 * 留 v24+).默认 collapsed,点击「展开」按需 fetch — 复用 ActionItems
 * 折叠思路.
 */

const STATUS_LABEL: Record<string, string> = {
  open: "未派发",
  dispatched: "待签收",
  accepted: "已签收",
  in_progress: "办理中",
  submitted: "待审核",
  done: "已完成",
  archived: "已归档",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-zinc-700 text-zinc-300",
  dispatched: "bg-amber-500/20 text-amber-300",
  accepted: "bg-cyan-500/20 text-cyan-300",
  in_progress: "bg-sky-500/20 text-sky-300",
  submitted: "bg-violet-500/20 text-violet-300",
  done: "bg-emerald-500/20 text-emerald-300",
  archived: "bg-zinc-800 text-zinc-500",
  cancelled: "bg-zinc-800 text-zinc-500 line-through",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

function TraceTaskRow({ t }: { t: MeetingTraceTask }) {
  const overdue =
    t.due_at &&
    new Date(t.due_at).getTime() < Date.now() &&
    t.status !== "done" &&
    t.status !== "archived" &&
    t.status !== "cancelled";
  return (
    <Link
      href={`/task/${t.task_id}`}
      className="block"
      data-testid="trace-task-row"
      data-status={t.status}
    >
      <div className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 hover:bg-ink-800">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_COLOR[t.status] || STATUS_COLOR.open}`}
          >
            {STATUS_LABEL[t.status] || t.status}
          </span>
          {t.assignee_name && (
            <span className="text-[10px] text-zinc-500">
              主责 {t.assignee_name}
            </span>
          )}
          {t.co_assignees.length > 0 && (
            <span className="text-[10px] text-zinc-500">
              ·协办 {t.co_assignees.length} 人
            </span>
          )}
          {t.due_at && (
            <span
              className={`text-[10px] ${overdue ? "font-medium text-rose-400" : "text-zinc-500"}`}
            >
              · 截止 {fmtDate(t.due_at)}
              {overdue && " (已逾期)"}
            </span>
          )}
        </div>
        <div className="mt-1.5 line-clamp-2 text-xs text-zinc-200">
          {t.title || t.content}
        </div>
      </div>
    </Link>
  );
}

export default function TraceCard({ meetingId }: { meetingId: string }) {
  const [trace, setTrace] = useState<MeetingTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getMeetingTrace(meetingId);
      setTrace(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

  // 没有 task 就不显示这个 card(节省空间)
  if (!loading && trace && trace.total === 0) return null;

  return (
    <div
      className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5"
      data-testid="meeting-trace-card"
      data-meeting-id={meetingId}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🔗</span>
          <h2 className="text-sm font-semibold text-zinc-200">追溯</h2>
          {trace && trace.total > 0 && (
            <span
              data-testid="meeting-trace-total"
              className="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] text-accent-200"
            >
              {trace.total} 个任务
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        本次会议沉淀的任务 — 点击行进入详情
      </p>

      {/* 状态分布徽章 */}
      {trace && trace.total > 0 && (
        <div
          className="mt-3 flex flex-wrap gap-1"
          data-testid="meeting-trace-status-summary"
        >
          {Object.entries(trace.by_status).map(([status, count]) => (
            <span
              key={status}
              className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_COLOR[status] || STATUS_COLOR.open}`}
            >
              {STATUS_LABEL[status] || status} {count}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <div className="text-xs text-zinc-500">加载中…</div>
        ) : error ? (
          <div className="text-xs text-rose-400">{error}</div>
        ) : trace && trace.tasks.length > 0 ? (
          <div className="space-y-2" data-testid="meeting-trace-task-list">
            {trace.tasks.map((t) => (
              <TraceTaskRow key={t.task_id} t={t} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">暂无沉淀任务</div>
        )}
      </div>
    </div>
  );
}
