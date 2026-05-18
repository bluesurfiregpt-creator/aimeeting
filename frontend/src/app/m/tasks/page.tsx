"use client";

/**
 * v27.0-mobile · /m/tasks · 任务 闭环 视图.
 *
 * 整 屏 结构:
 *   - Head — 任务 · 我主责 N · +其他参与 stub
 *   - 等 你 处理 (pending, 默认 展开) — 完整 TaskCardFull
 *   - 跟踪 中 (tracking, 默认 折叠) — 紧凑 TaskRowCompact
 *   - 已 完成 (done, 默认 折叠) — 紧凑 TaskRowCompact
 *
 * Phase 1 MVP — CTA 仅 alert 占位, Phase 2 接 真 API:
 *   - 确认 派发 → POST /api/tasks/{id} status=dispatched
 *   - 改 一下 → 进 二级 详情 页 编辑
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
        <p className="text-[15px] text-zinc-300">未 能 加 载</p>
        <p className="text-[13px] text-zinc-600">{error}</p>
        {error?.includes("401") ? (
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-accent-500 px-6 text-[15px] font-medium text-white"
          >
            去 登录
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
          >
            重 试
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
          我 主责 · {data.me_primary_count} 件
          {data.other_participating_count > 0 ? (
            <Link
              href="/m/tasks?view=others"
              className="ml-3 text-accent-400 active:text-accent-300"
            >
              + 其他 参与 ({data.other_participating_count}) →
            </Link>
          ) : null}
        </p>
      </header>

      {/* === 等 你 处理 (pending, 默认 展开, 完整 卡) ========= */}
      {groups.pending.length === 0 && groups.tracking.length === 0 && groups.done.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center">
          <p className="text-[15px] text-zinc-300">还 没 任务</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            会议 结束 后, AI 抽 出 的 待办 会 出现 在 这里
          </p>
        </div>
      ) : null}

      {groups.pending.length > 0 ? (
        <section className="space-y-2">
          <h2 className="px-1 text-[14px] font-medium text-zinc-300">
            等 你 处理
            <span className="ml-1.5 text-zinc-500">· {groups.pending.length}</span>
          </h2>
          <div className="space-y-3">
            {groups.pending.map((it) => (
              <TaskCardFull
                key={`${it.kind}-${it.id}`}
                item={it}
                onPrimary={() =>
                  alert(`Phase 2: ${it.cta_primary} — 接 真 API`)
                }
                onSecondary={() =>
                  alert(`Phase 2: ${it.cta_secondary} — 接 真 API`)
                }
              />
            ))}
          </div>
        </section>
      ) : groups.tracking.length > 0 || groups.done.length > 0 ? (
        <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-4 text-center">
          <p className="text-[14px] text-emerald-300">✓ 待办 全 处理 完</p>
        </section>
      ) : null}

      {/* === 跟踪 中 (默认 折叠, 紧凑 行) ===================== */}
      <GroupSection
        title="跟踪 中"
        items={groups.tracking}
        defaultOpen={false}
        renderItem={(it) => <TaskRowCompact key={`${it.kind}-${it.id}`} item={it} />}
      />

      {/* === 已 完成 (默认 折叠, 紧凑 行) ===================== */}
      <GroupSection
        title="已 完成"
        items={groups.done}
        defaultOpen={false}
        renderItem={(it) => <TaskRowCompact key={`${it.kind}-${it.id}`} item={it} />}
      />
    </div>
  );
}
