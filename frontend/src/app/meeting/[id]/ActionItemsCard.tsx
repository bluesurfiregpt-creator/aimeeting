"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type ActionComment,
  type ActionItem,
  type User,
} from "@/lib/api";
import { toast } from "@/lib/toast";

// v25.14: 行动项 卡 同时展示 task 流转 状态(合并 TraceCard 功能)
const TASK_STATUS_LABEL: Record<string, string> = {
  open: "未派发",
  dispatched: "待签收",
  accepted: "已签收",
  in_progress: "办理中",
  submitted: "待审核",
  done: "已完成",
  archived: "已归档",
  cancelled: "已取消",
};
const TASK_STATUS_TONE: Record<string, string> = {
  open: "bg-zinc-700/40 text-zinc-300",
  dispatched: "bg-amber-500/15 text-amber-300",
  accepted: "bg-cyan-500/15 text-cyan-300",
  in_progress: "bg-sky-500/15 text-sky-300",
  submitted: "bg-violet-500/15 text-violet-300",
  done: "bg-emerald-500/15 text-emerald-300",
  archived: "bg-zinc-800 text-zinc-500",
  cancelled: "bg-zinc-800 text-zinc-500",
};

/**
 * M3.0 Action Items panel — displayed under SummaryCard on `processed` meetings.
 *
 * Shows the auto-extracted TODO list (source_type='summary'), plus any
 * manually-added items, with checkbox toggles for done/open. Polls until
 * the action_extractor finishes (which runs after summary generation).
 *
 * Theme 1 (P0): each row has an expandable comment thread. Clicking the
 * 💬 button toggles the thread; expanding fetches comments lazily so we
 * don't pay N round trips on the initial render. Adding a comment fires
 * `action_comment` notifications to the assignee + prior commenters
 * (server-side), and deleting a comment is author-only.
 */

type CommentState = {
  loaded: boolean;
  loading: boolean;
  items: ActionComment[];
  count: number;
  draft: string;
  posting: boolean;
};

const INITIAL_COMMENT_STATE: CommentState = {
  loaded: false,
  loading: false,
  items: [],
  count: 0,
  draft: "",
  posting: false,
};

export default function ActionItemsCard({ meetingId }: { meetingId: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("");
  const [adding, setAdding] = useState(false);
  // Per-action comment state, keyed by action.id. Expansion is sticky (we
  // keep the loaded items around even when the user collapses the thread)
  // so re-expanding is instant.
  const [comments, setComments] = useState<Record<string, CommentState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // v25.23 + v25.24: 「⚠️ 重置并重跑」期间的进度条状态.
  // null = idle;非 null = 跑中,UI 显进度条 + 禁用所有写按钮.
  //
  // 双阶段:
  //   summaryReady=false → 阶段 A:等 LLM 生成 summary (~15-25s)
  //   summaryReady=true  → 阶段 B:summary 好了,等 action_extractor (~5-15s)
  //                       此时即使 summary 已 ready 也不能立即标 completed,
  //                       要等 action items 实际出现 (避免 v25.23 的 race).
  type ResetState = {
    startedAt: number;
    expectedMs: number;     // 估算 60s
    completed: boolean;
    failed?: string;        // 失败原因
    summaryReady?: boolean; // 阶段 B 标志位
    summaryReadyAt?: number;// 进入阶段 B 的时间戳 (Date.now)
  };
  const [resetState, setResetState] = useState<ResetState | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  // 跑中 → busy=true,所有按钮 + 输入框 disabled
  const busy = !!resetState && !resetState.completed && !resetState.failed;

  const refresh = useCallback(async () => {
    try {
      const r = await api.listActionItems(meetingId);
      setItems(r);
    } catch (e) {
      console.warn("listActionItems failed", e);
    } finally {
      setLoaded(true);
    }
  }, [meetingId]);

  useEffect(() => {
    void refresh();
    // Poll once at 5s and 15s — covers the gap between summary generation
    // finishing and action_extractor finishing (each is its own LLM call).
    const t1 = window.setTimeout(refresh, 5000);
    const t2 = window.setTimeout(refresh, 15000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [refresh]);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  // v25.23: 重置 跑中 → 每 0.5s tick 进度条
  useEffect(() => {
    if (!resetState || resetState.completed || resetState.failed) return;
    const h = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(h);
  }, [resetState]);

  // v25.23 → v25.24 (fix race): 重置跑中 → 双阶段轮询
  //
  // 之前 race 现象:
  //   summary.status='ready' 时立即标 completed → 但 action_extractor 是
  //   asyncio.create_task fire-and-forget,还在跑.refresh 拿到的是空 items.
  //   用户看到进度条 100% 但列表空,刷新页面才出来.
  //
  // 修复:双阶段
  //   阶段 A: 4s 间隔 polling summary.status,等 'ready'
  //   阶段 B: summary ready 后,2s 间隔 polling action items,直到
  //          a) items.length > 0 (action_extractor 写入了),或
  //          b) 距 summary ready 已过 20s (留够时间,且实录可能本来就没 actions)
  //   两者任一满足 → setItems(r) + completed=true.
  //
  // 依赖只放 startedAt — summaryReadyAt / completed / failed 用 setState
  // 触发其他 effect,本 effect 不重启.summaryReadyAt 用 useEffect 局部变量,
  // 不进 state,避免 setState 触发 effect 重启 清掉自己.
  useEffect(() => {
    if (!resetState || resetState.completed || resetState.failed) return;
    let alive = true;
    let attempts = 0;
    let summaryReadyAt: number | null = null;
    let pendingTimeout: number | null = null;

    const poll = async () => {
      if (!alive) return;
      attempts++;
      try {
        if (summaryReadyAt === null) {
          // 阶段 A: 等 summary ready
          const r = await api.getMeetingSummary(meetingId);
          if (!alive) return;
          if (r.status === "ready") {
            summaryReadyAt = Date.now();
            // 通知 UI 已进入 阶段 B — 进度条 + 文案 切换
            setResetState((s) =>
              s ? { ...s, summaryReady: true, summaryReadyAt: summaryReadyAt! } : s,
            );
            // 不 return — 阶段 B 接着继续轮询 action items
          } else if (r.status === "failed") {
            setResetState((s) =>
              s ? { ...s, failed: "LLM 生成失败" } : s,
            );
            return;
          } else if (r.status === "skipped") {
            setResetState((s) =>
              s ? { ...s, failed: "实录过短,跳过" } : s,
            );
            return;
          }
          // status === 'pending' / 'loading' / 'unconfigured' — 继续等
        } else {
          // 阶段 B: 等 action_extractor 写入(或 20s 后 give up)
          const r = await api.listActionItems(meetingId);
          if (!alive) return;
          const elapsedSinceReady = Date.now() - summaryReadyAt;
          if (r.length > 0 || elapsedSinceReady >= 20_000) {
            setItems(r);
            setResetState((s) => (s ? { ...s, completed: true } : s));
            return;
          }
          // 还没出 items 且 < 20s → 继续轮询
        }
      } catch {
        /* 网络错误 不结束,下一轮再试 */
      }
      if (attempts > 90) return; // 兜底:summary 阶段 4s × 60 + actions 2s × 10 = ~280s
      // 阶段 A 4s / 阶段 B 2s — 阶段 B 短一些,因为 action_extractor 通常 5-15s
      const interval = summaryReadyAt === null ? 4000 : 2000;
      pendingTimeout = window.setTimeout(poll, interval);
    };

    void poll();
    return () => {
      alive = false;
      if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
    };
  }, [resetState?.startedAt, meetingId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // v25.23: 完成 / 失败 → 4 秒后自动收起进度条
  useEffect(() => {
    if (!resetState) return;
    if (!resetState.completed && !resetState.failed) return;
    const h = window.setTimeout(() => setResetState(null), 4000);
    return () => window.clearTimeout(h);
  }, [resetState]);

  // 进度算法:
  //   阶段 A (summary 还没好): 0..80% 按 elapsed / expected
  //   阶段 B (summary ready,等 actions): 80..95%(锁在这,避免冲过 100% 但 actions 没出)
  //   completed=100; failed=80(红色满到此)
  const resetProgress = (() => {
    if (!resetState) return 0;
    if (resetState.completed) return 100;
    if (resetState.failed) return 80;
    if (resetState.summaryReady && resetState.summaryReadyAt) {
      // 阶段 B: 80% 起步,基于阶段 B 内的 elapsed 增长,每秒 +0.75% 直到 95%
      // 20 秒后封顶 95%,正好对应 action_extractor 20s 兜底 timeout
      const elapsedBSec = (nowTick - resetState.summaryReadyAt) / 1000;
      return Math.min(95, 80 + elapsedBSec * 0.75);
    }
    // 阶段 A: 0..80% 按 elapsed / expected
    const elapsed = nowTick - resetState.startedAt;
    return Math.min(80, Math.max(2, (elapsed / resetState.expectedMs) * 80));
  })();
  const resetElapsedSec = resetState
    ? Math.floor((nowTick - resetState.startedAt) / 1000)
    : 0;
  // 阶段文案 — 让用户知道现在在跑哪一步
  const resetStagePhrase = (() => {
    if (!resetState) return "";
    if (resetState.failed) return resetState.failed;
    if (resetState.completed) return "新纪要 + 行动项 已生成 — 滚动查看 ↑↓";
    // 阶段 B: summary 已出,正在抽行动项
    if (resetState.summaryReady) {
      return "📋 纪要已生成 — 正在抽取行动项 + 实录锚点 evidence…";
    }
    // 阶段 A: 还在跑 summary
    const pct = resetProgress;
    if (pct < 12) return "🧹 清干净老数据(纪要 / 行动项 / 任务 / 通知 / AI 发言)…";
    if (pct < 35) return "🔍 LLM 重新分析实录(qwen-max + 反幻觉 prompt)…";
    if (pct < 60) return "📝 生成新纪要中…";
    return "📝 LLM 收尾纪要,马上轮到行动项…";
  })();

  const toggleStatus = useCallback(
    async (item: ActionItem) => {
      const nextStatus = item.status === "done" ? "open" : "done";
      // Optimistic update — server-side is single PATCH, fast.
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: nextStatus } : p)),
      );
      try {
        await api.patchActionItem(meetingId, item.id, { status: nextStatus });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新失败");
        await refresh();
      }
    },
    [meetingId, refresh],
  );

  const remove = useCallback(
    async (item: ActionItem) => {
      const before = items;
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      try {
        await api.deleteActionItem(meetingId, item.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
        setItems(before);
      }
    },
    [items, meetingId],
  );

  const addItem = useCallback(async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      await api.createActionItem(meetingId, {
        content,
        assignee_user_id: newAssignee || null,
      });
      setNewContent("");
      setNewAssignee("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }, [newContent, newAssignee, adding, meetingId, refresh]);

  // Lazy-load comments for an action when first expanded.
  const ensureComments = useCallback(
    async (actionId: string) => {
      const existing = comments[actionId];
      if (existing && existing.loaded) return;
      setComments((c) => ({
        ...c,
        [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), loading: true },
      }));
      try {
        const r = await api.listActionComments(meetingId, actionId);
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            loaded: true,
            loading: false,
            items: r,
            count: r.length,
          },
        }));
      } catch {
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            loading: false,
          },
        }));
      }
    },
    [comments, meetingId],
  );

  const toggleThread = useCallback(
    (actionId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(actionId)) {
          next.delete(actionId);
        } else {
          next.add(actionId);
          void ensureComments(actionId);
        }
        return next;
      });
    },
    [ensureComments],
  );

  const setDraft = useCallback((actionId: string, value: string) => {
    setComments((c) => ({
      ...c,
      [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), draft: value },
    }));
  }, []);

  const submitComment = useCallback(
    async (actionId: string) => {
      const cur = comments[actionId] ?? INITIAL_COMMENT_STATE;
      const body = cur.draft.trim();
      if (!body || cur.posting) return;
      setComments((c) => ({
        ...c,
        [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), posting: true },
      }));
      try {
        const created = await api.createActionComment(meetingId, actionId, body);
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            items: [...(c[actionId]?.items ?? []), created],
            count: (c[actionId]?.count ?? 0) + 1,
            draft: "",
            posting: false,
          },
        }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "发送失败");
        setComments((c) => ({
          ...c,
          [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), posting: false },
        }));
      }
    },
    [comments, meetingId],
  );

  const deleteComment = useCallback(
    async (actionId: string, commentId: string) => {
      const before = comments[actionId];
      setComments((c) => ({
        ...c,
        [actionId]: {
          ...(c[actionId] ?? INITIAL_COMMENT_STATE),
          items: (c[actionId]?.items ?? []).filter((x) => x.id !== commentId),
          count: Math.max(0, (c[actionId]?.count ?? 0) - 1),
        },
      }));
      try {
        await api.deleteActionComment(meetingId, actionId, commentId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
        if (before) {
          setComments((c) => ({ ...c, [actionId]: before }));
        }
      }
    },
    [comments, meetingId],
  );

  if (!loaded) return null;

  const openCount = items.filter((i) => i.status === "open").length;

  return (
    <section
      data-testid="action-items-card"
      className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📌</span>
          <h2 className="text-base font-medium text-white">待办与流转</h2>
          <span className="ml-1 rounded-full bg-ink-800 px-2 py-0.5 text-xs text-zinc-400">
            {items.length} 项 · {openCount} 待办
          </span>
          <span className="text-[10px] text-zinc-600" title="本次会议形成的待办清单 + 当前流转状态">
            (会议中讨论形成 · AI 自动抽取 + 手动添加)
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* v25.11: 清掉 LLM 自动提取的(hallucination 一键清) */}
          <button
            disabled={busy}
            onClick={async () => {
              if (!confirm("清掉本会议 所有 LLM 自动提取的 行动项 + 对应任务?\n\n手动添加的不删.")) return;
              try {
                const r = await api.wipeAutoActions(meetingId);
                toast.success(`✅ 已清 ${r.deleted_actions} 行动项 + ${r.deleted_tasks} 任务`);
                const r2 = await api.listActionItems(meetingId);
                setItems(r2);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "清除失败");
              }
            }}
            className="text-xs text-zinc-500 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
            title="清掉 LLM 自动提取的行动项(如果发现幻觉错误)— 手动添加的不删"
          >
            🗑️ 清自动提取
          </button>
          {/* v25.18 + v25.23: ⚠️ 完整重置派生数据 — busy 期间禁用 + 进度条 */}
          <button
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "⚠️ 危险:重置本场会议的【全部派生数据】并重跑?\n\n" +
                    "会清:\n" +
                    "  • 会议纪要(summary_md)\n" +
                    "  • 所有行动项 + 任务 + 评论(含手动添加)\n" +
                    "  • AI 专家在会议中的发言\n" +
                    "  • pyannote 声纹切片\n" +
                    "  • 本场会议产生的全部通知(工作台'逾期 X 天'也会消失)\n\n" +
                    "保留:\n" +
                    "  • 实录原文 + 参会名单 + 议程\n\n" +
                    "之后自动重跑 纪要 + 行动项 抽取.约 30-60 秒.\n" +
                    "执行期间会显示进度条 + 禁用 写操作 — 请不要刷新或切走."
                )
              )
                return;
              // v25.23: 立刻启动进度条 — 用户看到反馈,期间禁用所有写按钮
              setResetState({
                startedAt: Date.now(),
                expectedMs: 60_000,
                completed: false,
              });
              setNowTick(Date.now());
              try {
                const r = await api.resetMeetingDerived(meetingId);
                toast.success(
                  `✅ 已清 ${r.deleted_actions} 行动项 / ${r.deleted_tasks} 任务 / ${r.deleted_notifications} 通知`,
                  {
                    detail: `LLM 重新生成 纪要 + 行动项 中,约 30-60 秒.无需操作.`,
                  }
                );
                const r2 = await api.listActionItems(meetingId);
                setItems(r2);
                // 不 setResetState completed — 等下面 useEffect 轮询 summary status
                // 拿到 ready 后再标完成(那时 action_extractor 也跑完了).
              } catch (e) {
                setResetState((s) =>
                  s ? { ...s, failed: e instanceof Error ? e.message : "重置失败" } : s
                );
                toast.error(e instanceof Error ? e.message : "重置失败");
              }
            }}
            className="text-xs text-zinc-500 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            title="重置本场会议的全部派生数据(纪要 / 行动项 / 任务 / 通知 / AI 发言),然后从实录重跑.约 60 秒."
          >
            ⚠️ 重置并重跑
          </button>
        </div>
      </header>

      {/* v25.23: 「重置并重跑」进度条 — busy / completed / failed 都显示.
          让用户看到明显的等待心理预期 + 阻止 无效干扰操作. */}
      {resetState && (
        <div
          className={
            "mt-3 rounded-lg border p-3 transition " +
            (resetState.failed
              ? "border-rose-500/40 bg-rose-500/5"
              : resetState.completed
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5")
          }
          data-testid="action-items-reset-progress"
        >
          <div className="flex items-center justify-between text-xs">
            <span
              className={
                "font-medium " +
                (resetState.failed
                  ? "text-rose-300"
                  : resetState.completed
                  ? "text-emerald-300"
                  : "text-amber-300")
              }
            >
              {resetState.failed
                ? `❌ 重置失败`
                : resetState.completed
                ? `✅ 重置并重跑 完成`
                : `⚠️ 重置并重跑 进行中… 请勿做其他操作`}
            </span>
            {(resetState.completed || resetState.failed) && (
              <button
                onClick={() => setResetState(null)}
                className="text-zinc-500 hover:text-zinc-200"
                title="收起"
              >
                ✕
              </button>
            )}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className={
                "h-full rounded-full transition-all duration-500 " +
                (resetState.failed
                  ? "bg-rose-400"
                  : resetState.completed
                  ? "bg-emerald-400"
                  : "bg-amber-400")
              }
              style={{ width: `${resetProgress}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px]">
            <span className="text-zinc-400">{resetStagePhrase}</span>
            <span className="shrink-0 text-zinc-500">
              {resetState.completed
                ? "100%"
                : resetState.failed
                ? "失败"
                : `已用 ${resetElapsedSec} 秒 / 预计 60 秒 · ${Math.round(resetProgress)}%`}
            </span>
          </div>
          {!resetState.completed && !resetState.failed && resetProgress >= 95 && (
            <div className="mt-2 rounded-md bg-ink-950/60 px-2 py-1.5 text-[11px] text-amber-200">
              💡 LLM 偶尔会慢一点,再等 10-30 秒.页面会自动检测完成 — 不用刷新.
            </div>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          这场会议没有自动抽取出明确的行动项。可以手动添加 ↓
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-800">
          {items.map((item) => {
            const checked = item.status === "done";
            const assignee = item.assignee_name || item.assignee_name_hint;
            const cstate = comments[item.id] ?? INITIAL_COMMENT_STATE;
            const isOpen = expanded.has(item.id);
            return (
              <li
                key={item.id}
                data-testid={`action-item-${item.id}`}
                className="py-2"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    data-testid={`action-checkbox-${item.id}`}
                    checked={checked}
                    onChange={() => toggleStatus(item)}
                    disabled={busy}
                    className="h-4 w-4 shrink-0 accent-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={
                        checked
                          ? "line-through text-zinc-500 text-sm"
                          : "text-zinc-100 text-sm"
                      }
                    >
                      {item.content}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      {/* v25.14: 任务流转状态 — 第一优先级显示(用户视角先关心"现在到哪步了") */}
                      {item.task_status && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            TASK_STATUS_TONE[item.task_status] || TASK_STATUS_TONE.open
                          }`}
                        >
                          {TASK_STATUS_LABEL[item.task_status] || item.task_status}
                        </span>
                      )}
                      {/* 优先用 task 上的 assignee(可能被 leader 重派过),退到 action 的 */}
                      {(item.task_assignee_name || assignee) ? (
                        <span title={(item.task_id || item.assignee_user_id) ? "已绑定用户" : "仅记录姓名,未绑定"}>
                          👤 {item.task_assignee_name || assignee}
                          {item.task_co_assignees_count && item.task_co_assignees_count > 0
                            ? ` + ${item.task_co_assignees_count} 协办`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-zinc-600">⚠️ 未指定负责人</span>
                      )}
                      {item.due_at ? (
                        <span>📅 {new Date(item.due_at).toLocaleDateString("zh-CN")}</span>
                      ) : null}
                      <span className="text-zinc-700">
                        {item.source_type === "summary" ? "AI 自动抽取" : "手动添加"}
                      </span>
                      {/* v25.14: 一键 进 任务详情(派发 / 审核 / 沉淀 等) */}
                      {item.task_id && (
                        <Link
                          href={`/task/${item.task_id}?from=meeting&mid=${meetingId}`}
                          className="ml-auto text-[10px] text-accent-400 hover:text-accent-300"
                          title="进入任务详情 — 派发 / 签收 / 评分 / 沉淀"
                        >
                          → 任务详情
                        </Link>
                      )}
                    </div>

                    {/* v25.15 + v25.19: 实录依据 — 缩略 + "查看实录上下文 →" 可点 */}
                    {(item.evidence_quote || (item.evidence_anchor_line_ids?.length ?? 0) > 0) && (
                      <div
                        className="mt-1.5 rounded-lg border-l-2 border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-zinc-400"
                        title="实录依据 — LLM 抽这条待办时引用的真人对话片段"
                      >
                        <div className="flex items-start gap-1">
                          <span className="shrink-0 text-amber-400">📜 依据:</span>
                          <span className="italic">
                            {item.evidence_quote
                              ? (item.evidence_quote.length > 80
                                  ? "「" + item.evidence_quote.slice(0, 80) + "…」"
                                  : "「" + item.evidence_quote + "」")
                              : "(LLM 未提供文本摘要)"}
                          </span>
                        </div>
                        {(item.evidence_anchor_line_ids?.length ?? 0) > 0 && (
                          <Link
                            href={`/meeting/${meetingId}?focus=${item.evidence_anchor_line_ids!.join(",")}`}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
                            title={`跳转到实录中 ${item.evidence_anchor_line_ids!.length} 句锚点对话(高亮 + 上下文)`}
                          >
                            🔗 查看实录原文上下文（{item.evidence_anchor_line_ids!.length} 句锚点）→
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggleThread(item.id)}
                    data-testid={`action-comments-toggle-${item.id}`}
                    data-expanded={isOpen ? "1" : "0"}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                      isOpen
                        ? "bg-ink-800 text-zinc-200"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                    title="评论"
                  >
                    💬{cstate.count > 0 ? ` ${cstate.count}` : ""}
                  </button>
                  <button
                    onClick={() => remove(item)}
                    disabled={busy}
                    className="shrink-0 text-xs text-zinc-600 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>

                {isOpen ? (
                  <div
                    className="mt-2 ml-7 rounded-lg border border-ink-800 bg-ink-950/60 p-3"
                    data-testid={`action-comments-thread-${item.id}`}
                  >
                    {cstate.loading && !cstate.loaded ? (
                      <p className="text-xs text-zinc-500">加载评论…</p>
                    ) : cstate.items.length === 0 ? (
                      <p className="text-xs text-zinc-500">还没有评论</p>
                    ) : (
                      <ul className="space-y-2">
                        {cstate.items.map((c) => (
                          <li
                            key={c.id}
                            data-testid={`action-comment-${c.id}`}
                            className="text-xs"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-zinc-300">
                                {c.author_name || "已删除用户"}
                              </span>
                              <span className="text-[10px] text-zinc-600">
                                {new Date(c.created_at).toLocaleString("zh-CN")}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-start gap-2">
                              <p className="flex-1 whitespace-pre-wrap text-zinc-200">
                                {c.content}
                              </p>
                              {c.can_delete ? (
                                <button
                                  type="button"
                                  data-testid={`action-comment-delete-${c.id}`}
                                  onClick={() => deleteComment(item.id, c.id)}
                                  className="shrink-0 text-[10px] text-zinc-600 hover:text-rose-400"
                                  title="删除我的留言"
                                >
                                  删除
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex items-end gap-2">
                      <textarea
                        rows={2}
                        value={cstate.draft}
                        onChange={(e) => setDraft(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            (e.metaKey || e.ctrlKey) &&
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            void submitComment(item.id);
                          }
                        }}
                        data-testid={`action-comment-input-${item.id}`}
                        placeholder="写一条进展或反馈，⌘/Ctrl + ↵ 发送…"
                        className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        data-testid={`action-comment-submit-${item.id}`}
                        onClick={() => void submitComment(item.id)}
                        disabled={!cstate.draft.trim() || cstate.posting}
                        className="shrink-0 rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                      >
                        {cstate.posting ? "发送…" : "发送"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Manual add row — v25.23: busy 期间 disabled */}
      <div className="mt-4 flex items-center gap-2">
        <select
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
          data-testid="action-add-assignee"
          disabled={busy}
          className="shrink-0 rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <option value="">未指定</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          data-testid="action-add-content"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy) void addItem();
            }
          }}
          placeholder={busy ? "重置并重跑 进行中,请稍后…" : "添加一项行动项,回车保存…"}
          disabled={busy}
          className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          data-testid="action-add-submit"
          onClick={() => void addItem()}
          disabled={busy || !newContent.trim() || adding}
          className="shrink-0 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {adding ? "添加中…" : "添加"}
        </button>
      </div>
    </section>
  );
}
