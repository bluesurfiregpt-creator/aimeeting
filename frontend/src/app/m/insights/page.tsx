"use client";

/**
 * v27.0-mobile P21 · /m/insights · 「记忆」模块 (前称「智囊」).
 *
 * 金字塔模型:
 *   会议中 AI 发言 (agent_message)
 *     ↓ 浓缩 (LLM 抽快照,会议结束触发)
 *   快照 (ai_insight, 全量, 只读, 可点跳回原文)
 *     ↓ AI 筛 worth_remembering=true
 *   待审 (人工判断要不要进记忆库)
 *     ↓ 用户 accepted
 *   记忆库 (long_term_memory, 长期保留, 未来 AI 检索调用)
 *
 * 三个 tab 对应金字塔三层:
 *   快照 tab    → mApi.getInsights()                     全量 insight
 *   待审 tab    → mApi.getInsights({ for_review: true }) worth_remembering+pending
 *   记忆库 tab  → mApi.getMemories()                     long_term_memory
 *
 * task draft (任务草稿) 不再在本模块出现 — 移到会议总结页 /m/meetings/[id]/summary.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import MemoryRow from "@/components/mobile/MemoryRow";
import PendingInsightReviewCard from "@/components/mobile/PendingInsightReviewCard";
import {
  InsightTopicGroupRow,
  groupInsightsByTopic,
} from "@/components/mobile/MiniListRows";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import type { AIInsightFull, MemoryOut } from "@/lib/mobile/types";

type Tab = "snapshots" | "review" | "library";

export default function MobileInsightsPage() {
  const [tab, setTab] = useState<Tab>("snapshots");

  // Tab 1: 快照 (全量 insight)
  const [insights, setInsights] = useState<AIInsightFull[] | null>(null);
  const [insightsErr, setInsightsErr] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Tab 2: 待审 (worth_remembering=true AND human_decision IS NULL)
  const [pending, setPending] = useState<AIInsightFull[] | null>(null);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [busyInsightId, setBusyInsightId] = useState<string | null>(null);

  // Tab 3: 记忆库 (long_term_memory)
  const [memories, setMemories] = useState<MemoryOut[] | null>(null);
  const [memoriesErr, setMemoriesErr] = useState<string | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // 切到对应 tab 时 lazy load (只拉一次, 走 ref 避免 deps 抖动).
  const fetchedRef = useRef<{
    snapshots: boolean;
    review: boolean;
    library: boolean;
  }>({
    snapshots: false,
    review: false,
    library: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (tab === "snapshots") {
        if (fetchedRef.current.snapshots) return;
        fetchedRef.current.snapshots = true;
        setInsightsLoading(true);
        try {
          const d = await mApi.getInsights({ limit: 50 });
          if (!cancelled) {
            setInsights(d);
            setInsightsErr(null);
          }
        } catch (e) {
          if (!cancelled) {
            setInsightsErr(e instanceof Error ? e.message : String(e));
            fetchedRef.current.snapshots = false;
          }
        } finally {
          if (!cancelled) setInsightsLoading(false);
        }
      } else if (tab === "review") {
        if (fetchedRef.current.review) return;
        fetchedRef.current.review = true;
        setPendingLoading(true);
        try {
          const d = await mApi.getInsights({
            limit: 100,
            for_review: true,
          });
          if (!cancelled) {
            setPending(d);
            setPendingErr(null);
          }
        } catch (e) {
          if (!cancelled) {
            setPendingErr(e instanceof Error ? e.message : String(e));
            fetchedRef.current.review = false;
          }
        } finally {
          if (!cancelled) setPendingLoading(false);
        }
      } else if (tab === "library") {
        if (fetchedRef.current.library) return;
        fetchedRef.current.library = true;
        setMemoriesLoading(true);
        try {
          const d = await mApi.getMemories({ limit: 100 });
          if (!cancelled) {
            setMemories(d);
            setMemoriesErr(null);
          }
        } catch (e) {
          if (!cancelled) {
            setMemoriesErr(e instanceof Error ? e.message : String(e));
            fetchedRef.current.library = false;
          }
        } finally {
          if (!cancelled) setMemoriesLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // 议题聚合 (快照 tab)
  const insightTopics = useMemo(() => {
    if (!insights) return [];
    return groupInsightsByTopic(insights);
  }, [insights]);

  /** 待审 → accepted: 同步写 long_term_memory, insight.human_decision='accepted' */
  const handleAccept = useCallback(
    async (insight: AIInsightFull) => {
      if (busyInsightId) return;
      setBusyInsightId(insight.id);
      try {
        await mApi.patchInsightDecision(insight.id, "accepted");
        // 从待审列表移除
        setPending((prev) =>
          prev ? prev.filter((p) => p.id !== insight.id) : prev,
        );
        // 让记忆库 tab 下次切过去重新拉
        setMemories(null);
        fetchedRef.current.library = false;
        setToast({ kind: "success", text: "已入库,记忆库可见" });
      } catch (e) {
        setToast({
          kind: "error",
          text: `入库失败: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        setBusyInsightId(null);
      }
    },
    [busyInsightId],
  );

  /** 待审 → rejected: 仅标记, insight 保留在快照 tab 仍可见 */
  const handleReject = useCallback(
    async (insight: AIInsightFull) => {
      if (busyInsightId) return;
      setBusyInsightId(insight.id);
      try {
        await mApi.patchInsightDecision(insight.id, "rejected");
        setPending((prev) =>
          prev ? prev.filter((p) => p.id !== insight.id) : prev,
        );
        setToast({ kind: "success", text: "已驳回" });
      } catch (e) {
        setToast({
          kind: "error",
          text: `驳回失败: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        setBusyInsightId(null);
      }
    },
    [busyInsightId],
  );

  // tab 右上角 count
  const count_snapshots = insights?.length ?? null;
  const count_review = pending?.length ?? null;
  const count_library = memories?.length ?? null;

  return (
    <div>
      <PageHeader title="记忆">
        <SegmentControl<Tab>
          value={tab}
          onChange={setTab}
          items={[
            {
              value: "snapshots",
              label: "快照",
              count: count_snapshots ?? undefined,
            },
            {
              value: "review",
              label: "待审",
              count: count_review || undefined,
            },
            {
              value: "library",
              label: "记忆库",
              count: count_library ?? undefined,
            },
          ]}
        />
      </PageHeader>

      <main className="px-4 pb-6">
        {tab === "snapshots" ? (
          <SnapshotsTab
            insights={insights}
            topics={insightTopics}
            loading={insightsLoading}
            error={insightsErr}
          />
        ) : tab === "review" ? (
          <ReviewTab
            pending={pending}
            loading={pendingLoading}
            error={pendingErr}
            busyId={busyInsightId}
            onAccept={handleAccept}
            onReject={handleReject}
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

// ===== Tab 1: 快照 (全量, 议题聚合) =====================================

function SnapshotsTab({
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
        title="还没有 AI 快照"
        body="进一场会议召唤专家加视角,会议结束后这里会有快照"
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

// ===== Tab 2: 待审 ======================================================

function ReviewTab({
  pending,
  loading,
  error,
  busyId,
  onAccept,
  onReject,
}: {
  pending: AIInsightFull[] | null;
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onAccept: (insight: AIInsightFull) => void;
  onReject: (insight: AIInsightFull) => void;
}) {
  if (loading && !pending) return <SkeletonList />;
  if (error && !pending) return <ErrorState text={error} />;
  if (!pending || pending.length === 0) {
    return (
      <EmptyState
        emoji="✓"
        title="没有待审快照"
        body="AI 还没从会议里挑出值得沉淀的内容,或你都审完了"
      />
    );
  }
  return (
    <div className="space-y-3 pt-1">
      <p className="px-1 text-[13px] text-zinc-500">
        {pending.length} 条 AI 推荐入记忆 · 你来拍板
      </p>
      {pending.map((insight) => (
        <PendingInsightReviewCard
          key={insight.id}
          insight={insight}
          busy={busyId === insight.id}
          onAccept={() => onAccept(insight)}
          onReject={() => onReject(insight)}
        />
      ))}
    </div>
  );
}

// ===== Tab 3: 记忆库 ====================================================

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
        title="记忆库还空"
        body="审通过几条待审就有了 — 入库后未来会议 AI 会自动检索调用"
      />
    );
  }
  return (
    <div className="space-y-3 pt-1">
      <p className="px-1 text-[13px] text-zinc-500">
        {memories.length} 条 长期记忆
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
