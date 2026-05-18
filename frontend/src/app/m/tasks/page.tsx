"use client";

/**
 * v27.0-mobile · /m/tasks · 任务闭环视图.
 *
 * 整屏结构:
 *   - Head — 任务 · 我主责 N · +其他参与 stub
 *   - 等你处理 (pending, 默认展开) — 完整 TaskCardFull
 *   - 跟踪中 (tracking, 默认折叠) — 紧凑 TaskRowCompact
 *   - 已完成 (done, 默认折叠) — 紧凑 TaskRowCompact
 *
 * Phase 1 MVP — CTA 仅 alert 占位, Phase 2 接真 API:
 *   - 确认派发 → POST /api/tasks/{id} status=dispatched
 *   - 改一下 → 进二级详情页编辑
 *   - 通过 / 驳回 → POST /api/memory-drafts/{id}/approve|reject
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TaskCardFull, TaskRowCompact } from "@/components/mobile/TaskCard";
import { mApi } from "@/lib/mobile/api";
import type { MobileTaskItem, MobileTasksOut } from "@/lib/mobile/types";

function SkeletonCard() {
  return <div className="h-44 animate-pulse rounded-2xl bg-ink-900" />;
}

function GroupSection({
  title,
  items,
  defaultOpen,
  renderItem,
}: {
  title: string;
  items: MobileTaskItem[];
  defaultOpen: boolean;
  renderItem: (item: MobileTaskItem) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 py-2"
      >
        <span className="text-[14px] font-medium text-zinc-300">
          {title}
          <span className="ml-1.5 text-zinc-500">· {items.length}</span>
        </span>
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="space-y-2">
          {items.map((it) => renderItem(it))}
        </div>
      ) : null}
    </section>
  );
}

export default function MobileTasksPage() {
  const [data, setData] = useState<MobileTasksOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    mApi
      .getTasks()
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
    if (!data) return { pending: [], tracking: [], done: [] };
    return {
      pending: data.items.filter((i) => i.group === "pending"),
      tracking: data.items.filter((i) => i.group === "tracking"),
      done: data.items.filter((i) => i.group === "done"),
    };
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <SkeletonCard />
        <SkeletonCard />
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

  return (
    <div className="space-y-5 p-4 pb-6">
      {/* === Head ============================================== */}
      <header>
        <h1 className="text-[20px] font-medium text-zinc-100">任务</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          我主责 · {data.me_primary_count} 件
          {data.other_participating_count > 0 ? (
            <Link
              href="/m/tasks?view=others"
              className="ml-3 text-accent-400 active:text-accent-300"
            >
              + 其他参与 ({data.other_participating_count}) →
            </Link>
          ) : null}
        </p>
      </header>

      {/* === 等你处理 (pending, 默认展开, 完整卡) ========= */}
      {groups.pending.length === 0 && groups.tracking.length === 0 && groups.done.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center">
          <p className="text-[15px] text-zinc-300">还没任务</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            会议结束后, AI 抽出的待办会出现在这里
          </p>
        </div>
      ) : null}

      {groups.pending.length > 0 ? (
        <section className="space-y-2">
          <h2 className="px-1 text-[14px] font-medium text-zinc-300">
            等你处理
            <span className="ml-1.5 text-zinc-500">· {groups.pending.length}</span>
          </h2>
          <div className="space-y-3">
            {groups.pending.map((it) => (
              <TaskCardFull
                key={`${it.kind}-${it.id}`}
                item={it}
                onPrimary={() =>
                  alert(`Phase 2: ${it.cta_primary} — 接真 API`)
                }
                onSecondary={() =>
                  alert(`Phase 2: ${it.cta_secondary} — 接真 API`)
                }
              />
            ))}
          </div>
        </section>
      ) : groups.tracking.length > 0 || groups.done.length > 0 ? (
        <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-4 text-center">
          <p className="text-[14px] text-emerald-300">✓ 待办全处理完</p>
        </section>
      ) : null}

      {/* === 跟踪中 (默认折叠, 紧凑行) ===================== */}
      <GroupSection
        title="跟踪中"
        items={groups.tracking}
        defaultOpen={false}
        renderItem={(it) => <TaskRowCompact key={`${it.kind}-${it.id}`} item={it} />}
      />

      {/* === 已完成 (默认折叠, 紧凑行) ===================== */}
      <GroupSection
        title="已完成"
        items={groups.done}
        defaultOpen={false}
        renderItem={(it) => <TaskRowCompact key={`${it.kind}-${it.id}`} item={it} />}
      />
    </div>
  );
}
