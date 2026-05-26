"use client";

/**
 * v27.0-mobile · /m/meetings v3.
 *
 * 改动 (跟 v2 比):
 *   - PageHeader 大标题 "会议"
 *   - 顶部 segment 切状态: [进行中(N)] [即将开始(N)] [已结束(N)]
 *     一次只看一组, 去折叠 ▾
 *   - 字号 / 间距 升级
 *
 * v1.4.0 Saga K · 浅色化 (跟 /m today + /m/me 一致, iOS 浅色).
 */

import { useMemo, useState } from "react";
import { useCachedFetch } from "@/lib/mobile/swrCache";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import { mApi } from "@/lib/mobile/api";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import type {
  MobileMeetingListRow,
  MobileMeetingsListOut,
} from "@/lib/mobile/types";

type Tab = "ongoing" | "upcoming" | "finished";

// ----- 状态视觉 ---------------------------------------------------------

const STATUS_STYLE: Record<
  string,
  { label: string; chipBg: string; chipFg: string }
> = {
  ongoing: {
    label: "进行中",
    chipBg: "rgba(52,199,89,0.12)",
    chipFg: MR_COLORS.systemGreen,
  },
  scheduled: {
    label: "未开始",
    chipBg: "rgba(0,122,255,0.10)",
    chipFg: MR_COLORS.systemBlue,
  },
  finished: {
    label: "已结束",
    chipBg: "rgba(60,60,67,0.08)",
    chipFg: MR_COLORS.textTertiary,
  },
  processed: {
    label: "已沉淀",
    chipBg: "rgba(60,60,67,0.08)",
    chipFg: MR_COLORS.textTertiary,
  },
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
            className="h-1 w-3 rounded-full"
            style={{
              background: done
                ? MR_COLORS.systemGreen
                : active
                ? MR_COLORS.systemBlue
                : MR_COLORS.separatorLight,
            }}
          />
        );
      })}
      {total > 6 ? (
        <span
          className="text-[13px]"
          style={{ color: MR_COLORS.textTertiary }}
        >
          +{total - 6}
        </span>
      ) : null}
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
      className="block rounded-2xl p-4 active:scale-[0.99] transition"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      data-testid="mobile-meeting-row"
    >
      <header className="flex items-center gap-2">
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
          style={{ background: s.chipBg, color: s.chipFg }}
        >
          {isOngoing ? (
            <span
              className="inline-flex h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: MR_COLORS.systemGreen }}
            />
          ) : null}
          <span>{s.label}</span>
        </span>
        {timeText ? (
          <span
            className="truncate text-[14px]"
            style={{
              color: timeOver
                ? MR_COLORS.systemOrange
                : MR_COLORS.textTertiary,
            }}
          >
            · {timeText}
          </span>
        ) : null}
      </header>
      <p
        className="mt-2.5 text-[17px] font-semibold leading-snug line-clamp-2"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {m.title}
      </p>

      <footer
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px]"
        style={{ color: MR_COLORS.textTertiary }}
      >
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
          <span
            className="flex items-center gap-1"
            style={{ color: MR_COLORS.systemPurple }}
          >
            <span>🤖</span>
            <span className="tabular-nums">{m.agents_count}</span>
          </span>
        ) : null}
        {m.insights_count > 0 ? (
          <span style={{ color: MR_COLORS.systemPurple }}>
            💡 {m.insights_count}
          </span>
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

      {/* P9: 新建会议入口 — sticky 在列表上方, 始终能点 */}
      <div className="px-4 pt-2">
        <Link
          href="/m/meetings/new"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-medium active:scale-[0.99]"
          style={{
            background: "rgba(0,122,255,0.08)",
            border: "0.5px solid rgba(0,122,255,0.30)",
            color: MR_COLORS.systemBlue,
          }}
          data-testid="mobile-new-meeting-link"
        >
          <span className="text-[18px]">+</span>
          <span>新建会议</span>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3 px-4 pb-6 pt-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl"
              style={{ background: "rgba(60,60,67,0.04)" }}
            />
          ))}
        </div>
      ) : error || !data ? (
        <div className="space-y-3 px-6 py-10 text-center">
          <p
            className="text-[16px]"
            style={{ color: MR_COLORS.textPrimary }}
          >
            未能加载
          </p>
          <p
            className="text-[14px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {error}
          </p>
          {error?.includes("401") ? (
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-medium text-white"
              style={{ background: MR_COLORS.systemBlue }}
            >
              去登录
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px]"
              style={{
                background: MR_COLORS.bgWhite,
                border: `0.5px solid ${MR_COLORS.hairlineStrong}`,
                color: MR_COLORS.textPrimary,
              }}
            >
              重试
            </button>
          )}
        </div>
      ) : current.length === 0 ? (
        <div
          className="mx-4 mt-3 rounded-2xl px-6 py-12 text-center"
          style={{
            background: MR_COLORS.bgWhite,
            border: `0.5px dashed ${MR_COLORS.hairlineStrong}`,
          }}
        >
          <p
            className="text-[16px]"
            style={{ color: MR_COLORS.textSecondary }}
          >
            {tab === "ongoing"
              ? "现在没有进行中的会议"
              : tab === "upcoming"
              ? "近期没有计划中的会议"
              : "最近 30 天没有已结束的会议"}
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-4 pb-6 pt-3">
          {current.map((m) => (
            <MeetingRow key={m.meeting_id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
