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
 *
 * v1.4.0 Saga D · 浅色化 (round-6).
 *   - bg ink-950/900 → MR_COLORS.bgGroupedPrimary / bgWhite
 *   - chip 色: tailwind dark-emerald/sky/violet/amber → 浅色 iOS 系统色
 *   - AIInsightCard 走 light prop
 */

import { useEffect, useState, use, useMemo } from "react";
import Link from "next/link";
import SegmentControl from "@/components/mobile/SegmentControl";
import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import { mApi } from "@/lib/mobile/api";
import type {
  AgentDetailMeetingItem,
  AgentDetailOut,
  AgentDetailTaskItem,
} from "@/lib/mobile/types";

type Tab = "meetings" | "tasks" | "insights";

// agent.color → 色块条 (基础 tailwind 色不依赖深浅 theme)
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
  if (!color) return "bg-zinc-400";
  return COLOR_BAR[color] || "bg-zinc-400";
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

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      background: MR_COLORS.bgGroupedPrimary,
      minHeight: "100%",
    }),
    [],
  );

  if (loading) {
    return (
      <div style={containerStyle} className="space-y-4 p-4">
        <div
          className="h-24 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
        <div
          className="h-12 animate-pulse rounded-xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
        <div
          className="h-32 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={containerStyle} className="space-y-3 px-6 py-10 text-center">
        <p className="text-[16px]" style={{ color: MR_COLORS.textPrimary }}>
          未能加载专家详情
        </p>
        <p className="text-[14px]" style={{ color: MR_COLORS.textTertiary }}>
          {error}
        </p>
        <Link
          href="/m"
          className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px]"
          style={{
            border: `0.5px solid ${MR_COLORS.hairline}`,
            background: MR_COLORS.bgWhite,
            color: MR_COLORS.textPrimary,
          }}
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
    <div style={containerStyle}>
      {/* ===== TopBar — 返回 / 专家名 ====================================== */}
      <div
        className="sticky top-0 z-30 px-4 pb-3 backdrop-blur"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          background: "rgba(242,242,247,0.92)",
          borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/m"
            className="-ml-2 flex h-10 w-10 items-center justify-center"
            style={{ color: MR_COLORS.systemBlue }}
            aria-label="返回"
          >
            <span className="text-2xl leading-none">←</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[18px] font-semibold"
              style={{ color: MR_COLORS.textPrimary }}
            >
              {display}
            </h1>
            {data.domain ? (
              <p
                className="mt-0.5 truncate text-[13px]"
                style={{ color: MR_COLORS.textSecondary }}
              >
                {data.domain}
                {hasNickname ? (
                  <span style={{ color: MR_COLORS.textTertiary }}>
                    {" "}
                    · {data.name}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <main className="space-y-4 p-4 pb-6">
        {/* ===== 档案区 — 色块条 + 累计 ================================== */}
        <section
          className="overflow-hidden rounded-2xl"
          style={{
            background: MR_COLORS.bgWhite,
            border: `0.5px solid ${MR_COLORS.hairline}`,
          }}
          data-testid="agent-profile"
        >
          <div className="flex">
            <div className={`w-1 ${colorBar(data.color)}`} />
            <div className="flex-1 p-4">
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[20px] font-semibold tabular-nums"
                    style={{ color: MR_COLORS.textPrimary }}
                  >
                    {data.total_meetings}
                  </span>
                  <span
                    className="text-[14px]"
                    style={{ color: MR_COLORS.textSecondary }}
                  >
                    场会议
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[20px] font-semibold tabular-nums"
                    style={{ color: MR_COLORS.textPrimary }}
                  >
                    {data.total_insights}
                  </span>
                  <span
                    className="text-[14px]"
                    style={{ color: MR_COLORS.textSecondary }}
                  >
                    条智囊
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[20px] font-semibold tabular-nums"
                    style={{ color: MR_COLORS.textPrimary }}
                  >
                    {data.tasks.length}
                  </span>
                  <span
                    className="text-[14px]"
                    style={{ color: MR_COLORS.textSecondary }}
                  >
                    项任务
                  </span>
                </div>
              </div>
              <p
                className="mt-2 text-[13px]"
                style={{ color: MR_COLORS.textTertiary }}
              >
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
            className="block rounded-xl p-4 transition active:scale-[0.99]"
            style={{
              background: MR_COLORS.bgWhite,
              border: `0.5px solid ${MR_COLORS.hairline}`,
            }}
            data-testid="agent-detail-meeting-row"
          >
            <header className="flex items-baseline gap-2">
              <StatusChipMeeting status={m.status} />
              {m.started_at ? (
                <span
                  className="text-[13px] tabular-nums"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  {meetingDate(m.started_at)} · {timeAgo(m.started_at)}
                </span>
              ) : null}
            </header>
            <p
              className="mt-2 text-[16px] font-medium leading-snug"
              style={{ color: MR_COLORS.textPrimary }}
            >
              {m.title}
            </p>
            {m.insights_count > 0 ? (
              <p
                className="mt-2 text-[13px]"
                style={{ color: MR_COLORS.systemPurple }}
              >
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
      <h3
        className="px-1 text-[14px] font-medium"
        style={{ color: MR_COLORS.textSecondary }}
      >
        {title}{" "}
        <span
          className="text-[13px]"
          style={{ color: MR_COLORS.textTertiary }}
        >
          · {items.length}
        </span>
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((t) => {
          const inner = (
            <>
              <header className="flex items-baseline gap-2">
                <StatusChipTask status={t.status} />
                {t.is_overdue ? (
                  <span
                    className="rounded px-2 py-0.5 text-[13px] font-medium"
                    style={{
                      background: "rgba(255,59,48,0.12)",
                      color: MR_COLORS.systemRed,
                    }}
                  >
                    超期
                  </span>
                ) : null}
                {t.due_at ? (
                  <span
                    className="text-[13px] tabular-nums"
                    style={{
                      color: t.is_overdue
                        ? MR_COLORS.systemRed
                        : MR_COLORS.textTertiary,
                    }}
                  >
                    截止 {meetingDate(t.due_at)}
                  </span>
                ) : null}
                {t.action_item_id ? (
                  <span
                    className="ml-auto shrink-0 text-[16px]"
                    style={{ color: MR_COLORS.textTertiary }}
                  >
                    ›
                  </span>
                ) : null}
              </header>
              <p
                className="mt-2 text-[15px] leading-snug"
                style={{
                  color: muted ? MR_COLORS.textTertiary : MR_COLORS.textPrimary,
                  textDecoration: muted ? "line-through" : undefined,
                }}
              >
                {t.title}
              </p>
              {t.source_meeting_title ? (
                <p
                  className="mt-1.5 truncate text-[13px]"
                  style={{ color: MR_COLORS.textTertiary }}
                >
                  来自 {t.source_meeting_title}
                </p>
              ) : null}
            </>
          );
          const cardStyle: React.CSSProperties = {
            background: MR_COLORS.bgWhite,
            border:
              highlight && t.is_overdue
                ? `0.5px solid ${MR_COLORS.urgentBorder}`
                : `0.5px solid ${MR_COLORS.hairline}`,
            opacity: muted ? 0.6 : 1,
          };
          return (
            <li key={t.task_id}>
              {t.action_item_id ? (
                <Link
                  href={`/m/tasks/${t.action_item_id}`}
                  className="block rounded-xl p-4 transition active:scale-[0.99]"
                  style={cardStyle}
                  data-testid="agent-detail-task-row"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  className="block rounded-xl p-4"
                  style={cardStyle}
                  data-testid="agent-detail-task-row"
                >
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
          <AIInsightCard insight={ins} light />
        </li>
      ))}
    </ul>
  );
}

// ===== atoms =============================================================

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      className="rounded-xl px-4 py-8 text-center text-[14px]"
      style={{
        border: `1px dashed ${MR_COLORS.hairlineStrong}`,
        color: MR_COLORS.textTertiary,
      }}
    >
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
    chipBg: "rgba(52,199,89,0.12)",
    chipText: MR_COLORS.systemGreen,
  },
  scheduled: {
    label: "未开始",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  finished: {
    label: "已结束",
    chipBg: MR_COLORS.bgInputFill,
    chipText: MR_COLORS.textSecondary,
  },
  processed: {
    label: "已沉淀",
    chipBg: "rgba(94,92,230,0.10)",
    chipText: MR_COLORS.systemPurple,
  },
};

function StatusChipMeeting({ status }: { status: string }) {
  const s = MEETING_STATUS[status] || MEETING_STATUS.finished;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium"
      style={{ background: s.chipBg, color: s.chipText }}
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
    chipBg: "rgba(255,159,10,0.12)",
    chipText: MR_COLORS.systemOrange,
  },
  dispatched: {
    label: "已派",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  accepted: {
    label: "已接",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  in_progress: {
    label: "进行中",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  submitted: {
    label: "待审",
    chipBg: "rgba(94,92,230,0.10)",
    chipText: MR_COLORS.systemPurple,
  },
  done: {
    label: "完成",
    chipBg: "rgba(52,199,89,0.12)",
    chipText: MR_COLORS.systemGreen,
  },
  archived: {
    label: "归档",
    chipBg: MR_COLORS.bgInputFill,
    chipText: MR_COLORS.textSecondary,
  },
  cancelled: {
    label: "已取消",
    chipBg: MR_COLORS.bgInputFill,
    chipText: MR_COLORS.textTertiary,
  },
};

function StatusChipTask({ status }: { status: string }) {
  const s = TASK_STATUS[status] || TASK_STATUS.open;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium"
      style={{ background: s.chipBg, color: s.chipText }}
    >
      {s.label}
    </span>
  );
}
