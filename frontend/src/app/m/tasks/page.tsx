"use client";

/**
 * v27.0-mobile · /m/tasks v3.
 *
 * 改动 (跟 v2 比):
 *   - PageHeader 大标题 "任务"
 *   - 顶部 segment 切状态: [等你处理(N)] [跟踪中(N)] [已完成(N)]
 *     去折叠 ▾, 一次只看一组
 *   - 字号 / 间距 升级
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import Toast from "@/components/mobile/Toast";
import { TaskCardFull, TaskRowCompact } from "@/components/mobile/TaskCard";
import { mApi } from "@/lib/mobile/api";
import type { MobileTaskItem, MobileTasksOut } from "@/lib/mobile/types";

type Tab = "pending" | "tracking" | "done";

export default function MobileTasksPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [data, setData] = useState<MobileTasksOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 单条 row 正在调 API 中 — 禁双击, 显 loading
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const reload = useCallback(() => {
    return mApi
      .getTasks()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message || "load failed"));
  }, []);

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

  /** 共用 CTA handler: 调 API → refetch → toast. */
  const runCta = useCallback(
    async (
      item: MobileTaskItem,
      action: "primary" | "secondary",
      okText: string,
    ) => {
      const rowKey = `${item.kind}-${item.id}`;
      if (busyId) return;
      setBusyId(rowKey);
      try {
        if (item.kind === "confirm") {
          if (!item.source_meeting_id) {
            throw new Error("missing source_meeting_id");
          }
          await mApi.patchActionItem(
            item.source_meeting_id,
            item.id,
            action === "primary" ? "done" : "cancelled",
          );
        } else if (item.kind === "approve_draft") {
          if (action === "primary") {
            await mApi.approveMemoryDraft(item.id);
          } else {
            await mApi.rejectMemoryDraft(item.id);
          }
        } else {
          throw new Error(`unsupported kind: ${item.kind}`);
        }
        await reload();
        setToast({ kind: "success", text: okText });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast({ kind: "error", text: `操作失败: ${msg}` });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, reload],
  );

  const groups = useMemo(() => {
    if (!data) return { pending: [], tracking: [], done: [] };
    return {
      pending: data.items.filter((i) => i.group === "pending"),
      tracking: data.items.filter((i) => i.group === "tracking"),
      done: data.items.filter((i) => i.group === "done"),
    };
  }, [data]);

  const current = groups[tab] || [];

  return (
    <div>
      <PageHeader title="任务">
        <SegmentControl<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "pending", label: "等你处理", count: groups.pending.length },
            { value: "tracking", label: "跟踪中", count: groups.tracking.length },
            { value: "done", label: "已完成", count: groups.done.length },
          ]}
        />
      </PageHeader>

      {loading ? (
        <div className="space-y-3 px-4 pb-6">
          <div className="h-48 animate-pulse rounded-2xl bg-ink-900" />
          <div className="h-48 animate-pulse rounded-2xl bg-ink-900" />
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
            {tab === "pending"
              ? "✓ 待办全处理完"
              : tab === "tracking"
              ? "没有跟踪中的任务"
              : "还没有已完成的任务"}
          </p>
          {tab === "pending" ? (
            <p className="mt-2 text-[13px] text-zinc-600">
              会议结束后, AI 抽出的待办会出现在这里
            </p>
          ) : null}
        </div>
      ) : tab === "pending" ? (
        <div className="space-y-3 px-4 pb-6">
          {current.map((it) => {
            const rowKey = `${it.kind}-${it.id}`;
            const isBusy = busyId === rowKey;
            return (
              <TaskCardFull
                key={rowKey}
                item={it}
                busy={isBusy}
                onPrimary={() =>
                  runCta(it, "primary", `已${it.cta_primary || "操作"}`)
                }
                onSecondary={() =>
                  runCta(it, "secondary", `已${it.cta_secondary || "操作"}`)
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 px-4 pb-6">
          {current.map((it) => (
            <TaskRowCompact key={`${it.kind}-${it.id}`} item={it} />
          ))}
        </div>
      )}
      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
