"use client";

/**
 * v27.0-mobile · Phase 3 · /m/agents/[id] — 单 AI 专家详情页.
 *
 * 来源: 用户校准 (2026-05-18)
 *   工卡 (列表) = 摘要 (3 场会议 + 任务三数字)
 *   详情 (本页) = 展开和详细 (全部会议 + 全部任务 + 全部智囊产出)
 *
 * 结构 (上 → 下):
 *   TopBar    ← 返回 / 专家名 / 累计 chip
 *   档案区    色块条 + nickname + name + domain + 累计统计
 *   Segment   会议 / 任务 / 智囊  (三 tab 切, 一次显一段)
 *   主区域    按 tab 渲对应列表
 */

import { useEffect, useState, use, useMemo } from "react";
import Link from "next/link";
import SegmentControl from "@/components/mobile/SegmentControl";
import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import { mApi } from "@/lib/mobile/api";
import type {
  AgentDetailMeetingItem,
  AgentDetailOut,
  AgentDetailTaskItem,
} from "@/lib/mobile/types";

type Tab = "meetings" | "tasks" | "insights";

// agent.color → 色块条
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

function meetingDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ===== 主组件 ============================================================

export default function MobileAgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("meetings");
  const [data, setData] = useState<AgentDetailOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    mApi
      .getAgentDetail(id)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message || "load failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-24 animate-pulse rounded-2xl bg-ink-900" />
        <div className="h-12 animate-pulse rounded-xl bg-ink-900" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-900" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 px-6 py-10 text-center">
        <p className="text-[16px] text-zinc-200">未能加载专家详情</p>
        <p className="text-[14px] text-zinc-500">{error}</p>
        <Link
          href="/m"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
        >
          返回今日
        </Link>
      </div>
    );
  }

  const display = data.nickname?.trim() || data.name;
  const hasNickname = !!(
    data.nickname?.trim() && data.nickname.trim() !== data.name
  );

  return (
    <div>
      {/* ===== TopBar — 返回 / 专家名 ====================================== */}
      <div
        className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/m"
            className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
            aria-label="返回"
          >
            <span className="text-2xl leading-none">←</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold text-zinc-50">
              {display}
            </h1>
            {data.domain ? (
              <p className="mt-0.5 truncate text-[13px] text-zinc-400">
                {data.domain}
                {hasNickname ? (
                  <span className="text-zinc-500"> · {data.name}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <main className="space-y-4 p-4 pb-6">
        {/* ===== 档案区 — 色块条 + 累计 ================================== */}
        <section
          className="overflow-hidden rounded-2xl bg-ink-900"
          data-testid="agent-profile"
        >
          <div className="flex">
            <div className={`w-1 ${colorBar(data.color)}`} />
            <div className="flex-1 p-4">
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[20px] font-semibold text-zinc-100 tabular-nums">
                    {data.total_meetings}
                  </span>
                  <span className="text-[14px] text-zinc-400">场会议</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[20px] font-semibold text-zinc-100 tabular-nums">
                    {data.total_insights}
                  </span>
                  <span className="text-[14px] text-zinc-400">条智囊</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[20px] font-semibold text-zinc-100 tabular-nums">
                    {data.tasks.length}
                  </span>
                  <span className="text-[14px] text-zinc-400">项任务</span>
                </div>
              </div>
              <p className="mt-2 text-[13px] text-zinc-500">
                {data.last_active
                  ? `最近活跃 ${timeAgo(data.last_active)}`
                  : "暂未激活"}
              </p>
            </div>
          </div>
        </section>

        {/* ===== Segment 切换 =========================================== */}
        <SegmentControl<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "meetings", label: "会议", count: data.meetings.length },
            { value: "tasks", label: "任务", count: data.tasks.length },
            { value: "insights", label: "智囊", count: data.insights.length },
          ]}
        />

        {/* ===== Tab 内容 =============================================== */}
        {tab === "meetings" ? (
          <MeetingsTab items={data.meetings} />
        ) : tab === "tasks" ? (
          <TasksTab items={data.tasks} />
        ) : (
          <InsightsTab items={data.insights} />
        )}
      </main>
    </div>
  );
}

// ===== 三 tab 子组件 =====================================================

function MeetingsTab({ items }: { items: AgentDetailMeetingItem[] }) {
  if (items.length === 0) {
    return <EmptyHint text="该专家还没参加过会议" />;
  }
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.meeting_id}>
          <Link
            href={`/m/meetings/${m.meeting_id}`}
            className="block rounded-xl bg-ink-900 p-4 transition active:scale-[0.99]"
            data-testid="agent-detail-meeting-row"
          >
            <header className="flex items-baseline gap-2">
              <StatusChipMeeting status={m.status} />
              {m.started_at ? (
                <span className="text-[13px] text-zinc-500 tabular-nums">
                  {meetingDate(m.started_at)} · {timeAgo(m.started_at)}
                </span>
              ) : null}
            </header>
            <p className="mt-2 text-[16px] font-medium leading-snug text-zinc-50">
              {m.title}
            </p>
            {m.insights_count > 0 ? (
              <p className="mt-2 text-[13px] text-violet-300">
                💡 该专家在此会产出 {m.insights_count} 条智囊
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TasksTab({ items }: { items: AgentDetailTaskItem[] }) {
  // 按 状态 分组: 进行中 / 已完成 / 已取消
  const groups = useMemo(() => {
    const OPEN = new Set([
      "open",
      "dispatched",
      "accepted",
      "in_progress",
      "submitted",
    ]);
    const DONE = new Set(["done", "archived"]);
    const open = items.filter((t) => OPEN.has(t.status));
    const done = items.filter((t) => DONE.has(t.status));
    const cancelled = items.filter((t) => t.status === "cancelled");
    return { open, done, cancelled };
  }, [items]);

  if (items.length === 0) {
    return <EmptyHint text="该专家还没分配任务" />;
  }

  return (
    <div className="space-y-5">
      {groups.open.length > 0 ? (
        <TaskGroup title="进行中" items={groups.open} highlight />
      ) : null}
      {groups.done.length > 0 ? (
        <TaskGroup title="已完成" items={groups.done} />
      ) : null}
      {groups.cancelled.length > 0 ? (
        <TaskGroup title="已取消" items={groups.cancelled} muted />
      ) : null}
    </div>
  );
}

function TaskGroup({
  title,
  items,
  highlight = false,
  muted = false,
}: {
  title: string;
  items: AgentDetailTaskItem[];
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <section>
      <h3 className="px-1 text-[14px] font-medium text-zinc-300">
        {title}{" "}
        <span className="text-[13px] text-zinc-500">· {items.length}</span>
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((t) => {
          const inner = (
            <>
              <header className="flex items-baseline gap-2">
                <StatusChipTask status={t.status} />
                {t.is_overdue ? (
                  <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[13px] font-medium text-rose-300">
                    超期
                  </span>
                ) : null}
                {t.due_at ? (
                  <span
                    className={`text-[13px] tabular-nums ${
                      t.is_overdue ? "text-rose-300" : "text-zinc-500"
                    }`}
                  >
                    截止 {meetingDate(t.due_at)}
                  </span>
                ) : null}
                {t.action_item_id ? (
                  <span className="ml-auto shrink-0 text-[16px] text-zinc-500">›</span>
                ) : null}
              </header>
              <p
                className={`mt-2 text-[15px] leading-snug ${
                  muted ? "text-zinc-400 line-through" : "text-zinc-100"
                }`}
              >
                {t.title}
              </p>
              {t.source_meeting_title ? (
                <p className="mt-1.5 truncate text-[13px] text-zinc-500">
                  来自 {t.source_meeting_title}
                </p>
              ) : null}
            </>
          );
          const cls = `block rounded-xl bg-ink-900 p-4 ${
            muted ? "opacity-60" : ""
          } ${highlight && t.is_overdue ? "border border-rose-500/40" : ""}`;
          return (
            <li key={t.task_id}>
              {t.action_item_id ? (
                <Link
                  href={`/m/tasks/${t.action_item_id}`}
                  className={`${cls} transition active:scale-[0.99]`}
                  data-testid="agent-detail-task-row"
                >
                  {inner}
                </Link>
              ) : (
                <div className={cls} data-testid="agent-detail-task-row">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function InsightsTab({
  items,
}: {
  items: AgentDetailOut["insights"];
}) {
  if (items.length === 0) {
    return <EmptyHint text="该专家暂无智囊产出" />;
  }
  return (
    <ul className="space-y-2">
      {items.map((ins) => (
        <li key={ins.id}>
          <AIInsightCard insight={ins} />
        </li>
      ))}
    </ul>
  );
}

// ===== atoms =============================================================

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-[14px] text-zinc-400">
      {text}
    </div>
  );
}

const MEETING_STATUS: Record<
  string,
  { label: string; chipBg: string; chipText: string }
> = {
  ongoing: {
    label: "进行中",
    chipBg: "bg-emerald-500/15",
    chipText: "text-emerald-300",
  },
  scheduled: {
    label: "未开始",
    chipBg: "bg-sky-500/15",
    chipText: "text-sky-300",
  },
  finished: {
    label: "已结束",
    chipBg: "bg-zinc-700",
    chipText: "text-zinc-300",
  },
  processed: {
    label: "已沉淀",
    chipBg: "bg-violet-500/15",
    chipText: "text-violet-300",
  },
};

function StatusChipMeeting({ status }: { status: string }) {
  const s = MEETING_STATUS[status] || MEETING_STATUS.finished;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium ${s.chipBg} ${s.chipText}`}
    >
      {s.label}
    </span>
  );
}

const TASK_STATUS: Record<
  string,
  { label: string; chipBg: string; chipText: string }
> = {
  open: {
    label: "待派",
    chipBg: "bg-amber-500/15",
    chipText: "text-amber-300",
  },
  dispatched: {
    label: "已派",
    chipBg: "bg-sky-500/15",
    chipText: "text-sky-300",
  },
  accepted: {
    label: "已接",
    chipBg: "bg-sky-500/15",
    chipText: "text-sky-300",
  },
  in_progress: {
    label: "进行中",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-300",
  },
  submitted: {
    label: "待审",
    chipBg: "bg-violet-500/15",
    chipText: "text-violet-300",
  },
  done: {
    label: "完成",
    chipBg: "bg-emerald-500/15",
    chipText: "text-emerald-300",
  },
  archived: {
    label: "归档",
    chipBg: "bg-zinc-700",
    chipText: "text-zinc-300",
  },
  cancelled: {
    label: "已取消",
    chipBg: "bg-zinc-800",
    chipText: "text-zinc-400",
  },
};

function StatusChipTask({ status }: { status: string }) {
  const s = TASK_STATUS[status] || TASK_STATUS.open;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium ${s.chipBg} ${s.chipText}`}
    >
      {s.label}
    </span>
  );
}
