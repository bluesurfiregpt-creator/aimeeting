"use client";

/**
 * v27.0-mobile P17 · 会议总结页 — 结束会议后跳的页.
 *
 * 用户反馈: 结束会议直接回首页太迷茫. 应该到一个总结页, 看到:
 *   - AI 生成的会议纪要 (markdown)
 *   - AI 抽出的待办列表, 含 [确认 / 驳回] 操作
 *
 * 行为:
 *   - 进页 ping /api/meetings/{id}/summary
 *     - status="pending" → 轮询 (5s 间隔, 最多 60 次 = 5 min)
 *     - status="ready" → 显 markdown
 *     - status="skipped" → 显 message
 *     - status="failed" → 显 message + retry 按钮
 *   - 同时拉 /api/meetings/{id}/actions, 显待办列表
 *   - 每个待办 [确认 / 驳回] 调 PATCH (跟 /m/tasks confirm CTA 一致)
 *   - 底部 [回首页] / [看完整会议]
 */

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AttachmentsSection from "@/components/mobile/AttachmentsSection";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import { invalidateCache } from "@/lib/mobile/swrCache";
import type {
  MeetingActionItemBrief,
  MeetingSummaryOut,
} from "@/lib/mobile/types";

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60; // 5 分钟超时

export default function MeetingSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [summary, setSummary] = useState<MeetingSummaryOut | null>(null);
  const [actions, setActions] = useState<MeetingActionItemBrief[] | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const pollCountRef = useRef(0);

  // 拉 actions 一次 + 之后用户操作后 reload
  const loadActions = useCallback(async () => {
    try {
      const acts = await mApi.getMeetingActions(id);
      setActions(acts);
    } catch (e) {
      setToast({
        kind: "error",
        text: `加载待办失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }, [id]);

  // 拉 summary, 含轮询
  const loadSummary = useCallback(async () => {
    try {
      const s = await mApi.getMeetingSummary(id);
      setSummary(s);
      return s.status;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummary({ summary_md: null, status: "failed", message: msg });
      return "failed";
    }
  }, [id]);

  // 初次 + 轮询
  useEffect(() => {
    let cancelled = false;
    pollCountRef.current = 0;

    const tick = async () => {
      if (cancelled) return;
      const status = await loadSummary();
      // terminal: ready / skipped / failed → 停轮询
      if (
        cancelled ||
        status === "ready" ||
        status === "skipped" ||
        status === "failed"
      ) {
        return;
      }
      // pending → 继续
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLLS) {
        setSummary({
          summary_md: null,
          status: "failed",
          message: "超时未生成 (5 分钟), 请稍后刷新页面",
        });
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  // actions 初次拉 + 30s 重拉一次 (action_extractor 是 summary 之后跑的, 可能晚)
  useEffect(() => {
    void loadActions();
    const t = setTimeout(() => void loadActions(), 30_000);
    return () => clearTimeout(t);
  }, [loadActions]);

  const handleConfirmAction = useCallback(
    async (action: MeetingActionItemBrief) => {
      if (busyActionId) return;
      setBusyActionId(action.id);
      try {
        await mApi.patchActionItem(action.meeting_id, action.id, "done");
        await loadActions();
        // 让 /m/tasks 等 cache 下次切到时重拉
        invalidateCache("m:tasks");
        invalidateCache("m:workbench");
        setToast({ kind: "success", text: "已确认" });
      } catch (e) {
        setToast({
          kind: "error",
          text: `操作失败: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, loadActions],
  );

  const handleRejectAction = useCallback(
    async (action: MeetingActionItemBrief) => {
      if (busyActionId) return;
      setBusyActionId(action.id);
      try {
        await mApi.patchActionItem(action.meeting_id, action.id, "cancelled");
        await loadActions();
        invalidateCache("m:tasks");
        invalidateCache("m:workbench");
        setToast({ kind: "success", text: "已驳回" });
      } catch (e) {
        setToast({
          kind: "error",
          text: `操作失败: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, loadActions],
  );

  // pending action items (待用户确认), cancelled / done 不在此页操作 (显灰)
  const pendingActions = (actions || []).filter((a) => a.status === "open");
  const decidedActions = (actions || []).filter((a) => a.status !== "open");

  return (
    /* P18: min-h-screen + flex column → mt-auto 把底部按钮推到 viewport 底.
       不能用 min-h-full — % 需要 parent 有显式高度, layout main 是 flex-1
       撑剩高度但 % 算不准, 底部不贴底. 100vh 直接对齐 viewport. */
    <div className="flex min-h-screen flex-col bg-ink-950">
      {/* TopBar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link
          href="/m"
          className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
          aria-label="回工作台"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-semibold text-zinc-50">
          会议总结
        </h1>
      </div>

      <main className="flex flex-1 flex-col space-y-5 p-4 pb-8">
        {/* === 会议状态概览 === */}
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <p className="text-[16px] font-medium text-emerald-200">
            ✓ 会议已结束
          </p>
          <p className="mt-1 text-[13px] text-zinc-400">
            AI 正在生成纪要 + 抽待办. 你可以现在查看, 也可以稍后回来.
          </p>
        </section>

        {/* === AI 纪要 === */}
        <section>
          <h2 className="px-1 text-[14px] font-medium text-zinc-300">
            📝 会议纪要
          </h2>
          <div className="mt-2 rounded-2xl bg-ink-900 p-4">
            {summary === null ? (
              <SummarySkeleton />
            ) : summary.status === "pending" ? (
              <div className="py-6 text-center text-[14px] text-zinc-400">
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-400" />
                  AI 正在生成纪要…
                </div>
                <p className="mt-2 text-[12px] text-zinc-500">
                  通常需要 1-3 分钟. 这页会自动刷新.
                </p>
              </div>
            ) : summary.status === "skipped" ? (
              <p className="text-[14px] text-zinc-400">
                ⏭ {summary.message || "纪要已跳过 (转录内容太薄)"}
              </p>
            ) : summary.status === "failed" ? (
              <div>
                <p className="text-[14px] text-rose-300">
                  ⚠ 生成失败: {summary.message || "未知错误"}
                </p>
                <button
                  type="button"
                  onClick={() => loadSummary()}
                  className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 px-3 text-[13px] text-zinc-200 active:scale-[0.98]"
                >
                  ↻ 重试
                </button>
              </div>
            ) : summary.summary_md ? (
              <div className="markdown-body text-[14px] leading-relaxed text-zinc-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {summary.summary_md}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-[14px] text-zinc-500">(空)</p>
            )}
          </div>
        </section>

        {/* === v27.0-mobile P19.1 / Phase B.3: 会议参考资料 ===
            总结页 只读 — 让 用户 回看 时 知道 AI 基于哪些资料. 0 附件时 不显. */}
        <AttachmentsSection meetingId={id} readOnly />

        {/* === 待办列表 — pending === */}
        {pendingActions.length > 0 ? (
          <section>
            <h2 className="px-1 text-[14px] font-medium text-zinc-300">
              📌 AI 抽出的待办 ({pendingActions.length})
            </h2>
            <p className="mt-1 px-1 text-[12px] text-zinc-500">
              确认入库或驳回. 后续在 任务页 / 任务详情 也能操作.
            </p>
            <ul className="mt-2 space-y-2">
              {pendingActions.map((act) => (
                <ActionRow
                  key={act.id}
                  action={act}
                  busy={busyActionId === act.id}
                  onConfirm={() => handleConfirmAction(act)}
                  onReject={() => handleRejectAction(act)}
                />
              ))}
            </ul>
          </section>
        ) : actions !== null && summary?.status === "ready" ? (
          <section className="rounded-2xl border border-dashed border-zinc-800 px-4 py-6 text-center">
            <p className="text-[14px] text-zinc-400">
              AI 没抽出明显的待办
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              这场会主要是信息同步 / 讨论
            </p>
          </section>
        ) : null}

        {/* === 已处理过的 action — folded === */}
        {decidedActions.length > 0 ? (
          <section>
            <h2 className="px-1 text-[14px] font-medium text-zinc-400">
              已处理 ({decidedActions.length})
            </h2>
            <ul className="mt-2 space-y-1.5">
              {decidedActions.map((act) => (
                <li
                  key={act.id}
                  className="rounded-lg bg-ink-900/40 px-3 py-2 text-[13px]"
                >
                  <span
                    className={
                      act.status === "done"
                        ? "text-emerald-300"
                        : "text-zinc-500 line-through"
                    }
                  >
                    {act.status === "done" ? "✓" : "✗"} {act.content}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* === 底部导航 — mt-auto 让按钮即使内容少也贴底 === */}
        <section className="mt-auto flex gap-2 pt-4">
          <Link
            href={`/m/meetings/${id}`}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[14px] text-zinc-200 active:scale-[0.98] active:bg-ink-800"
          >
            看完整会议
          </Link>
          <Link
            href="/m"
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-accent-500 px-4 text-[14px] font-medium text-white active:scale-[0.98] active:bg-accent-600"
          >
            回工作台
          </Link>
        </section>
      </main>

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 animate-pulse rounded bg-ink-800" />
      <div className="h-4 w-full animate-pulse rounded bg-ink-800" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-ink-800" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-ink-800" />
    </div>
  );
}

function ActionRow({
  action,
  busy,
  onConfirm,
  onReject,
}: {
  action: MeetingActionItemBrief;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const assignee =
    action.assignee_agent_name ||
    action.assignee_name ||
    action.assignee_name_hint ||
    "未指定";
  return (
    <li
      className="rounded-xl bg-ink-900 p-4"
      data-testid="mobile-summary-action-row"
    >
      <p className="text-[15px] leading-snug text-zinc-100">{action.content}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-400">
        <span>归属: {assignee}</span>
        {action.due_at ? (
          <span>截止: {new Date(action.due_at).toLocaleDateString("zh-CN")}</span>
        ) : null}
      </div>
      {action.evidence_quote ? (
        <p className="mt-2 border-l-2 border-zinc-700 pl-3 text-[12px] italic text-zinc-500 line-clamp-2">
          ▸ {action.evidence_quote}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-700 px-3 text-[14px] text-zinc-200 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : "驳回"}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex h-10 flex-1 items-center justify-center rounded-lg bg-accent-500 px-3 text-[14px] font-medium text-white active:scale-[0.98] active:bg-accent-600 disabled:opacity-50"
        >
          {busy ? "处理中…" : "确认"}
        </button>
      </div>
    </li>
  );
}
