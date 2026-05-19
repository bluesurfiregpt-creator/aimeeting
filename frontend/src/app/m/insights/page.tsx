"use client";

/**
 * v27.0-mobile · Phase 4.4 · /m/insights 三 tab 真做.
 *
 * 替代旧占位页 (Phase 2-next 写的 dashed 框).
 *
 * 结构:
 *   PageHeader "智囊"
 *   SegmentControl  [AI 产出 (N)] [待我审 (M)] [已入库 (K)]
 *   按 tab 渲三种数据:
 *     AI 产出 → groupInsightsByTopic + InsightTopicGroupRow (议题聚合视图)
 *     待我审 → mApi.getTasks() 过滤 source_kind=draft & group=pending,
 *              用 TaskCardFull 渲, 通过/驳回 跟 /m/tasks 完全一致
 *     已入库 → mApi.getMemories() 长期记忆库列表, MemoryRow 渲
 *
 * 三 tab 数据各自 lazy load (切到才拉, 避免一进页就发 3 个请求).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import MemoryRow from "@/components/mobile/MemoryRow";
import { TaskCardFull } from "@/components/mobile/TaskCard";
import {
  InsightTopicGroupRow,
  groupInsightsByTopic,
} from "@/components/mobile/MiniListRows";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import type {
  AIInsightFull,
  MemoryOut,
  MobileTaskItem,
  MobileTasksOut,
} from "@/lib/mobile/types";

type Tab = "ai" | "review" | "library";

export default function MobileInsightsPage() {
  const [tab, setTab] = useState<Tab>("ai");

  // Tab 1: AI 产出
  const [insights, setInsights] = useState<AIInsightFull[] | null>(null);
  const [insightsErr, setInsightsErr] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Tab 2: 待我审 (拉 /m/tasks, 过滤 draft+pending)
  const [tasks, setTasks] = useState<MobileTasksOut | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Tab 3: 已入库
  const [memories, setMemories] = useState<MemoryOut[] | null>(null);
  const [memoriesErr, setMemoriesErr] = useState<string | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // 切到对应 tab 时 lazy load (只拉一次)
  useEffect(() => {
    let alive = true;
    if (tab === "ai" && insights === null && !insightsLoading) {
      setInsightsLoading(true);
      mApi
        .getInsights({ limit: 50 })
        .then((d) => {
          if (alive) {
            setInsights(d);
            setInsightsErr(null);
          }
        })
        .catch((e) => alive && setInsightsErr(e.message))
        .finally(() => alive && setInsightsLoading(false));
    } else if (tab === "review" && tasks === null && !tasksLoading) {
      setTasksLoading(true);
      mApi
        .getTasks()
        .then((d) => {
          if (alive) {
            setTasks(d);
            setTasksErr(null);
          }
        })
        .catch((e) => alive && setTasksErr(e.message))
        .finally(() => alive && setTasksLoading(false));
    } else if (tab === "library" && memories === null && !memoriesLoading) {
      setMemoriesLoading(true);
      mApi
        .getMemories({ limit: 100 })
        .then((d) => {
          if (alive) {
            setMemories(d);
            setMemoriesErr(null);
          }
        })
        .catch((e) => alive && setMemoriesErr(e.message))
        .finally(() => alive && setMemoriesLoading(false));
    }
    return () => {
      alive = false;
    };
  }, [tab, insights, tasks, memories, insightsLoading, tasksLoading, memoriesLoading]);

  // 议题聚合 (Tab 1)
  const insightTopics = useMemo(() => {
    if (!insights) return [];
    return groupInsightsByTopic(insights);
  }, [insights]);

  // Tab 2: 过滤出 draft+pending 项
  const drafts = useMemo(() => {
    if (!tasks) return [];
    return tasks.items.filter(
      (i) => i.source_kind === "draft" && i.group === "pending",
    );
  }, [tasks]);

  // 草稿通过/驳回 → reload + toast
  const runDraftCta = useCallback(
    async (item: MobileTaskItem, action: "primary" | "secondary") => {
      if (busyId) return;
      const rowKey = `${item.kind}-${item.id}`;
      setBusyId(rowKey);
      try {
        if (action === "primary") {
          await mApi.approveMemoryDraft(item.id);
        } else {
          await mApi.rejectMemoryDraft(item.id);
        }
        // refetch tasks
        const fresh = await mApi.getTasks();
        setTasks(fresh);
        setToast({
          kind: "success",
          text: action === "primary" ? "已通过, 已入库" : "已驳回",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast({ kind: "error", text: `操作失败: ${msg}` });
      } finally {
        setBusyId(null);
      }
    },
    [busyId],
  );

  // 三 tab count (右上角小数字)
  const count_ai = insights?.length ?? null;
  const count_review = drafts.length;
  const count_library = memories?.length ?? null;

  return (
    <div>
      <PageHeader title="智囊">
        <SegmentControl<Tab>
          value={tab}
          onChange={setTab}
          items={[
            {
              value: "ai",
              label: "AI 产出",
              count: count_ai ?? undefined,
            },
            {
              value: "review",
              label: "待我审",
              count: count_review || undefined,
            },
            {
              value: "library",
              label: "已入库",
              count: count_library ?? undefined,
            },
          ]}
        />
      </PageHeader>

      <main className="px-4 pb-6">
        {tab === "ai" ? (
          <AITab
            insights={insights}
            topics={insightTopics}
            loading={insightsLoading}
            error={insightsErr}
          />
        ) : tab === "review" ? (
          <ReviewTab
            drafts={drafts}
            loading={tasksLoading}
            error={tasksErr}
            busyId={busyId}
            onPrimary={(it) => runDraftCta(it, "primary")}
            onSecondary={(it) => runDraftCta(it, "secondary")}
          />
        ) : (
          <LibraryTab
            memories={memories}
            loading={memoriesLoading}
            error={memoriesErr}
          />
        )}
      </main>

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

// ===== Tab 1: AI 产出 ====================================================

function AITab({
  insights,
  topics,
  loading,
  error,
}: {
  insights: AIInsightFull[] | null;
  topics: ReturnType<typeof groupInsightsByTopic>;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !insights) return <SkeletonList />;
  if (error && !insights) return <ErrorState text={error} />;
  if (!insights || topics.length === 0) {
    return (
      <EmptyState
        emoji="💡"
        title="还没 AI 产出"
        body="进一场会议召 AI 加视角, 立刻有产出"
      />
    );
  }
  return (
    <div className="space-y-2 pt-1">
      <p className="px-1 text-[13px] text-zinc-500">
        {topics.length} 议题 · {insights.length} 条
      </p>
      {topics.map((t) => (
        <InsightTopicGroupRow key={t.key} topic={t} />
      ))}
    </div>
  );
}

// ===== Tab 2: 待我审 ====================================================

function ReviewTab({
  drafts,
  loading,
  error,
  busyId,
  onPrimary,
  onSecondary,
}: {
  drafts: MobileTaskItem[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onPrimary: (item: MobileTaskItem) => void;
  onSecondary: (item: MobileTaskItem) => void;
}) {
  if (loading && drafts.length === 0) return <SkeletonList />;
  if (error) return <ErrorState text={error} />;
  if (drafts.length === 0) {
    return (
      <EmptyState
        emoji="✓"
        title="你这里没草稿等审"
        body="AI 从会议抽出来的候选记忆都审完了"
      />
    );
  }
  return (
    <div className="space-y-3 pt-1">
      <p className="px-1 text-[13px] text-zinc-500">
        {drafts.length} 条草稿等你判断
      </p>
      {drafts.map((it) => {
        const rowKey = `${it.kind}-${it.id}`;
        const isBusy = busyId === rowKey;
        return (
          <TaskCardFull
            key={rowKey}
            item={it}
            busy={isBusy}
            onPrimary={() => onPrimary(it)}
            onSecondary={() => onSecondary(it)}
          />
        );
      })}
    </div>
  );
}

// ===== Tab 3: 已入库 ====================================================

function LibraryTab({
  memories,
  loading,
  error,
}: {
  memories: MemoryOut[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !memories) return <SkeletonList />;
  if (error && !memories) return <ErrorState text={error} />;
  if (!memories || memories.length === 0) {
    return (
      <EmptyState
        emoji="📚"
        title="长期记忆库还空"
        body="审通过几条草稿就有了 — 入库后未来会议 AI 会自动调用"
      />
    );
  }
  return (
    <div className="space-y-3 pt-1">
      <p className="px-1 text-[13px] text-zinc-500">
        {memories.length} 条已入库记忆
      </p>
      {memories.map((m) => (
        <MemoryRow key={m.id} memory={m} />
      ))}
    </div>
  );
}

// ===== atoms =============================================================

function SkeletonList() {
  return (
    <div className="space-y-2 pt-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-ink-900" />
      ))}
    </div>
  );
}

function ErrorState({ text }: { text: string }) {
  return (
    <div className="space-y-3 px-6 py-10 text-center">
      <p className="text-[16px] text-zinc-200">未能加载</p>
      <p className="text-[14px] text-zinc-500">{text}</p>
      {text.includes("401") ? (
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
          className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-700 px-6 text-[15px] text-zinc-200"
        >
          重试
        </button>
      )}
    </div>
  );
}

function EmptyState({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-1 mt-4 rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">
      <div className="text-3xl">{emoji}</div>
      <p className="mt-4 text-[16px] text-zinc-200">{title}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}
