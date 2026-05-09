"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { KanbanCard, KanbanOut } from "@/lib/api";

/**
 * v23 — 共享 Kanban 视图组件.
 *
 * 由 /dashboard/kanban-agents 和 /dashboard/kanban-users 复用,只是
 * data fetcher 和标题不同.卡片 UI / 列容器 / 加载-空-错误三态都封装
 * 在这里,确保两个 Kanban 视觉一致.
 *
 * 设计:
 *   - 横向滚动列容器(每列宽度固定,水平 scroll)
 *   - 卡片精品 polish:状态色边 / 截止日色 / 协办进度 chip / hover lift
 *   - 列头:列名 + summary(N 项 · M 逾期)
 *   - 顶部:scope label + 角色 + 「显示已完成」开关 + 刷新按钮
 *
 * 不实装拖拽改 status (per Q2 决策) — Kanban 是「看清局面」,改 status
 * 走原按钮入口避免权限误判.
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
  open: "bg-zinc-700/60 text-zinc-300",
  dispatched: "bg-amber-500/20 text-amber-300 border-l-amber-500/60",
  accepted: "bg-cyan-500/20 text-cyan-300 border-l-cyan-500/60",
  in_progress: "bg-sky-500/20 text-sky-300 border-l-sky-500/60",
  submitted: "bg-violet-500/20 text-violet-300 border-l-violet-500/60",
  done: "bg-emerald-500/20 text-emerald-300 border-l-emerald-500/60",
  archived: "bg-zinc-800 text-zinc-500",
  cancelled: "bg-zinc-800 text-zinc-500",
};

const STATUS_BORDER: Record<string, string> = {
  open: "border-l-zinc-600",
  dispatched: "border-l-amber-500",
  accepted: "border-l-cyan-500",
  in_progress: "border-l-sky-500",
  submitted: "border-l-violet-500",
  done: "border-l-emerald-500",
  archived: "border-l-zinc-700",
  cancelled: "border-l-zinc-700",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return iso;
  }
}

function CardView({ card }: { card: KanbanCard }) {
  const overdueCls = card.is_overdue ? "text-rose-400 font-medium" : "text-zinc-500";
  return (
    <div
      className={`rounded-md border-l-4 ${STATUS_BORDER[card.status] ?? "border-l-zinc-700"} bg-ink-950 px-3 py-2 hover:bg-ink-900 transition shadow-sm`}
      data-testid={`kanban-card-${card.task_id}`}
      data-status={card.status}
    >
      <div className="text-xs text-zinc-100 break-words leading-snug">
        {card.content.length > 80 ? `${card.content.slice(0, 80)}…` : card.content}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
        <span
          className={`rounded px-1.5 py-0.5 ${
            STATUS_COLOR[card.status] ?? "bg-zinc-700 text-zinc-300"
          }`}
        >
          {STATUS_LABEL[card.status] ?? card.status}
        </span>
        {card.assignee_name ? (
          <span className="truncate max-w-[80px]">👤 {card.assignee_name}</span>
        ) : null}
        {card.due_at ? (
          <span className={overdueCls}>
            📅 {fmtDate(card.due_at)}
            {card.is_overdue ? "(逾期)" : ""}
          </span>
        ) : null}
        {card.co_assignee_count > 0 ? (
          <span className="text-cyan-400/80">
            👥 {card.co_submitted_count}/{card.co_assignee_count}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function KanbanView({
  title,
  hint,
  fetcher,
  testIdPrefix,
}: {
  title: string;
  hint: string;
  fetcher: (includeClosed: boolean) => Promise<KanbanOut>;
  testIdPrefix: string;
}) {
  const [data, setData] = useState<KanbanOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetcher(includeClosed);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [fetcher, includeClosed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-12 pt-20">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              ← 看板
            </Link>
            <span className="text-zinc-700">·</span>
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
          </div>
          {data ? (
            <p className="mt-1 text-sm text-zinc-500">
              {data.scope_label}
              <span className="mx-2 text-zinc-700">·</span>
              {data.period_label}
              <span className="mx-2 text-zinc-700">·</span>
              <span className="text-zinc-600">{hint}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-xs text-zinc-400"
            data-testid={`${testIdPrefix}-toggle-closed-label`}
          >
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
              data-testid={`${testIdPrefix}-toggle-closed`}
              className="h-3 w-3 accent-accent-500"
            />
            <span>显示已完成 / 已归档</span>
          </label>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            data-testid={`${testIdPrefix}-refresh`}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800 disabled:opacity-50"
          >
            {loading ? "刷新中…" : "↻ 刷新"}
          </button>
        </div>
      </header>

      {loading && !data ? (
        <div
          className="rounded-xl border border-ink-700 bg-ink-900 p-12 text-center text-sm text-zinc-500"
          data-testid={`${testIdPrefix}-loading`}
        >
          看板加载中…
        </div>
      ) : err ? (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300"
          data-testid={`${testIdPrefix}-error`}
        >
          {err}
        </div>
      ) : data && data.columns.length === 0 ? (
        <div
          className="rounded-xl border border-ink-700 bg-ink-900 p-12 text-center text-sm text-zinc-500"
          data-testid={`${testIdPrefix}-empty`}
        >
          暂无任务
        </div>
      ) : data ? (
        <div
          className="flex gap-3 overflow-x-auto pb-4"
          data-testid={`${testIdPrefix}-columns`}
        >
          {data.columns.map((col) => (
            <section
              key={col.column_id}
              className="flex flex-col min-w-[260px] max-w-[300px] rounded-xl border border-ink-700 bg-ink-900"
              data-testid={`kanban-column-${col.column_id}`}
            >
              <header className="border-b border-ink-800 px-3 py-2.5">
                <div className="text-sm font-medium text-zinc-100 truncate">
                  {col.column_label}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {col.summary}
                </div>
              </header>
              <div className="flex-1 space-y-2 p-2 max-h-[70vh] overflow-y-auto">
                {col.cards.length === 0 ? (
                  <p className="py-8 text-center text-[10px] text-zinc-700">
                    {includeClosed ? "无任务" : "无活跃任务"}
                  </p>
                ) : (
                  col.cards.map((c) => <CardView key={c.task_id} card={c} />)
                )}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
