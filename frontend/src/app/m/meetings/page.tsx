"use client";

/**
 * v27.0-mobile · /m/meetings · 会议列表.
 *
 * 三分组:
 *   - 进行中 (默认展开)
 *   - 即将开始 (默认展开)
 *   - 最近 30 天 (默认折叠)
 *
 * 每行: 状态 chip + title + 时间/进度 + 计数 (insights/actions).
 * 点行 → /m/meetings/[id].
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { mApi } from "@/lib/mobile/api";
import type { MobileMeetingListRow, MobileMeetingsListOut } from "@/lib/mobile/types";

// ---------- 状态视觉 ----------------------------------------------------

const STATUS_STYLE: Record<string, { label: string; chipBg: string; chipText: string }> = {
  ongoing: { label: "进行中", chipBg: "bg-emerald-500/15", chipText: "text-emerald-300" },
  scheduled: { label: "未开始", chipBg: "bg-accent-500/15", chipText: "text-accent-200" },
  finished: { label: "已结束", chipBg: "bg-zinc-800", chipText: "text-zinc-400" },
  processed: { label: "已沉淀", chipBg: "bg-zinc-800", chipText: "text-zinc-400" },
};

// 进度小条 — 跟 hero 同套但更紧凑
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
            className={`h-1 w-2.5 rounded-full ${
              done ? "bg-emerald-500/70" : active ? "bg-accent-400" : "bg-zinc-700"
            }`}
          />
        );
      })}
      {total > 6 ? <span className="text-[10px] text-zinc-600">+{total - 6}</span> : null}
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

  // 副信息行
  let subInfo = "";
  if (isOngoing && m.minutes_total !== null) {
    subInfo = `已 ${m.minutes_total} min`;
  } else if (m.status === "scheduled" && m.started_at) {
    subInfo = timeAgo(m.started_at);
  } else if (m.ended_at) {
    subInfo = `${timeAgo(m.ended_at)} · 用时 ${m.minutes_total ?? "-"} min`;
  }

  return (
    <Link
      href={`/m/meetings/${m.meeting_id}`}
      className="block rounded-xl border border-ink-800 bg-ink-900 p-3 active:scale-[0.99] transition"
      data-testid="mobile-meeting-row"
    >
      <header className="flex items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${s.chipBg} ${s.chipText}`}
        >
          {isOngoing ? (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          ) : null}
          <span>{s.label}</span>
        </span>
        {subInfo ? (
          <span className="truncate text-[11px] text-zinc-500">· {subInfo}</span>
        ) : null}
      </header>
      <p className="mt-2 text-[15px] leading-snug text-zinc-100 line-clamp-2">{m.title}</p>

      <footer className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
        {m.agenda_total > 0 ? (
          <span className="flex items-center gap-1">
            <MiniProgress cur={m.current_agenda_idx} total={m.agenda_total} />
            {isOngoing && m.current_agenda_idx !== null ? (
              <span className="ml-1">议程 {m.current_agenda_idx + 1}/{m.agenda_total}</span>
            ) : (
              <span className="ml-1">{m.agenda_total} 议题</span>
            )}
          </span>
        ) : null}
        {m.insights_count > 0 ? (
          <span className="text-violet-300/70">💡 {m.insights_count}</span>
        ) : null}
        {m.actions_count > 0 ? (
          <span>📌 {m.actions_count}</span>
        ) : null}
      </footer>
    </Link>
  );
}

function GroupSection({
  title,
  items,
  defaultOpen,
}: {
  title: string;
  items: MobileMeetingListRow[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 py-1"
      >
        <span className="text-[14px] font-medium text-zinc-300">
          {title}
          <span className="ml-1.5 text-zinc-500">· {items.length}</span>
        </span>
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="space-y-2">
          {items.map((m) => (
            <MeetingRow key={m.meeting_id} m={m} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function MobileMeetingsPage() {
  const [data, setData] = useState<MobileMeetingsListOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    mApi
      .getMeetingsList()
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
  }, []);

  const groups = useMemo(() => {
    if (!data) return { ongoing: [], upcoming: [], finished: [] };
    return {
      ongoing: data.items.filter((m) => m.status === "ongoing"),
      upcoming: data.items.filter((m) => m.status === "scheduled"),
      finished: data.items.filter((m) => m.status === "finished" || m.status === "processed"),
    };
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-900" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-[15px] text-zinc-300">未能加载</p>
        <p className="text-[13px] text-zinc-600">{error}</p>
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
    );
  }

  const total = data.items.length;

  return (
    <div className="space-y-5 p-4 pb-6">
      <header>
        <h1 className="text-[20px] font-medium text-zinc-100">会议</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          共 {total} 场 · 含进行中 + 近 30 天
        </p>
      </header>

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center">
          <p className="text-[15px] text-zinc-300">最近没有会议</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            从桌面端新建一场会议, 这里就会出现
          </p>
        </div>
      ) : (
        <>
          <GroupSection title="进行中" items={groups.ongoing} defaultOpen={true} />
          <GroupSection title="即将开始" items={groups.upcoming} defaultOpen={true} />
          <GroupSection title="最近 30 天" items={groups.finished} defaultOpen={false} />
        </>
      )}
    </div>
  );
}
