"use client";

/**
 * v27.0-mobile · /m/meetings v3.
 *
 * 改动 (跟 v2 比):
 *   - PageHeader 大标题 "会议"
 *   - 顶部 segment 切状态: [进行中(N)] [即将开始(N)] [已结束(N)]
 *     一次只看一组, 去折叠 ▾
 *   - 字号 / 间距 升级
 */

import { useMemo, useState } from "react";
import { useCachedFetch } from "@/lib/mobile/swrCache";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import { mApi } from "@/lib/mobile/api";
import type {
  MobileMeetingListRow,
  MobileMeetingsListOut,
} from "@/lib/mobile/types";

type Tab = "ongoing" | "upcoming" | "finished";

// ----- 状态视觉 ---------------------------------------------------------

const STATUS_STYLE: Record<string, { label: string; chipBg: string; chipText: string }> = {
  ongoing: { label: "进行中", chipBg: "bg-emerald-500/15", chipText: "text-emerald-300" },
  scheduled: { label: "未开始", chipBg: "bg-accent-500/15", chipText: "text-accent-200" },
  finished: { label: "已结束", chipBg: "bg-zinc-800", chipText: "text-zinc-400" },
  processed: { label: "已沉淀", chipBg: "bg-zinc-800", chipText: "text-zinc-400" },
};

function MiniProgress({ cur, total }: { cur: number | null; total: number }) {
  if (total === 0) return null;
  const idx = cur ?? 0;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: Math.min(total, 6) }).map((_, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <span
            key={i}
            className={`h-1 w-3 rounded-full ${
              done ? "bg-emerald-500/70" : active ? "bg-accent-400" : "bg-zinc-700"
            }`}
          />
        );
      })}
      {total > 6 ? <span className="text-[13px] text-zinc-500">+{total - 6}</span> : null}
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function MeetingRow({ m }: { m: MobileMeetingListRow }) {
  const s = STATUS_STYLE[m.status] || STATUS_STYLE.finished;
  const isOngoing = m.status === "ongoing";

  // 时长展示: 实际 / 计划 — overshoot 时实际数飘红
  const planned = m.planned_minutes;
  const actual = m.minutes_total;
  let timeText = "";
  let timeOver = false;
  if (isOngoing && actual !== null) {
    if (planned !== null) {
      timeOver = actual > planned;
      timeText = `已 ${actual} / 计划 ${planned} min`;
    } else {
      timeText = `已 ${actual} min`;
    }
  } else if (m.status === "scheduled") {
    if (planned !== null) timeText = `计划 ${planned} min`;
    else if (m.started_at) timeText = timeAgo(m.started_at);
  } else if (m.ended_at) {
    const base = `${timeAgo(m.ended_at)} · 用时 ${actual ?? "-"} min`;
    if (planned !== null && actual !== null) {
      timeOver = actual > planned;
      timeText = `${base} / 计划 ${planned}`;
    } else {
      timeText = base;
    }
  }

  return (
    <Link
      href={`/m/meetings/${m.meeting_id}`}
      className="block rounded-2xl bg-ink-900 p-4 active:scale-[0.99] transition"
      data-testid="mobile-meeting-row"
    >
      <header className="flex items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium ${s.chipBg} ${s.chipText}`}
        >
          {isOngoing ? (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          ) : null}
          <span>{s.label}</span>
        </span>
        {timeText ? (
          <span
            className={`truncate text-[14px] ${
              timeOver ? "text-amber-300/90" : "text-zinc-400"
            }`}
          >
            · {timeText}
          </span>
        ) : null}
      </header>
      <p className="mt-2.5 text-[17px] font-semibold leading-snug text-zinc-50 line-clamp-2">
        {m.title}
      </p>

      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-zinc-400">
        {m.agenda_total > 0 ? (
          <span className="flex items-center gap-1.5">
            <MiniProgress cur={m.current_agenda_idx} total={m.agenda_total} />
            {isOngoing && m.current_agenda_idx !== null ? (
              <span>议程 {m.current_agenda_idx + 1}/{m.agenda_total}</span>
            ) : (
              <span>{m.agenda_total} 议题</span>
            )}
          </span>
        ) : null}
        {m.users_count > 0 ? (
          <span className="flex items-center gap-1">
            <span>👤</span>
            <span className="tabular-nums">{m.users_count}</span>
          </span>
        ) : null}
        {m.agents_count > 0 ? (
          <span className="flex items-center gap-1 text-violet-300/80">
            <span>🤖</span>
            <span className="tabular-nums">{m.agents_count}</span>
          </span>
        ) : null}
        {m.insights_count > 0 ? (
          <span className="text-violet-300/80">💡 {m.insights_count}</span>
        ) : null}
        {m.actions_count > 0 ? <span>📌 {m.actions_count}</span> : null}
      </footer>
    </Link>
  );
}

export default function MobileMeetingsPage() {
  const [tab, setTab] = useState<Tab>("ongoing");
  // P8 SWR cache: 切回 立即显 stale 数据 + 后台 refresh
  const { data, error, isRefreshing } = useCachedFetch<MobileMeetingsListOut>(
    "m:meetings",
    () => mApi.getMeetingsList(),
  );
  const loading = !data && isRefreshing;

  const groups = useMemo(() => {
    if (!data) return { ongoing: [], upcoming: [], finished: [] };
    return {
      ongoing: data.items.filter((m) => m.status === "ongoing"),
      upcoming: data.items.filter((m) => m.status === "scheduled"),
      finished: data.items.filter(
        (m) => m.status === "finished" || m.status === "processed",
      ),
    };
  }, [data]);

  const current = groups[tab] || [];

  return (
    <div>
      <PageHeader title="会议">
        <SegmentControl<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "ongoing", label: "进行中", count: groups.ongoing.length },
            { value: "upcoming", label: "即将开始", count: groups.upcoming.length },
            { value: "finished", label: "已结束", count: groups.finished.length },
          ]}
        />
      </PageHeader>

      {loading ? (
        <div className="space-y-3 px-4 pb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-ink-900" />
          ))}
        </div>
      ) : error || !data ? (
        <div className="space-y-3 px-6 py-10 text-center">
          <p className="text-[16px] text-zinc-200">未能加载</p>
          <p className="text-[14px] text-zinc-600">{error}</p>
          {error?.includes("401") ? (
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-accent-500 px-6 text-[15px] font-medium text-white"
            >
              去登录
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
            >
              重试
            </button>
          )}
        </div>
      ) : current.length === 0 ? (
        <div className="mx-4 mt-2 rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">
          <p className="text-[16px] text-zinc-300">
            {tab === "ongoing"
              ? "现在没有进行中的会议"
              : tab === "upcoming"
              ? "近期没有计划中的会议"
              : "最近 30 天没有已结束的会议"}
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-4 pb-6">
          {current.map((m) => (
            <MeetingRow key={m.meeting_id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
