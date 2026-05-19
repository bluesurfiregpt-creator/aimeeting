"use client";

/**
 * v27.0-mobile · Phase 4.3 · /m/tasks/[id] — 单任务详情页.
 *
 * 入口:
 *   - /m/tasks 列表卡点击 (pending/tracking/done 三组都可点)
 *   - /m/agents/[id] 任务 tab 卡点击
 *
 * 设计原则:
 *   - 只 "查看 + 评论". 不做确认/驳回 — 那些 CTA 在 list 上做.
 *   - 一次聚合拉数据 (减 round-trip), 评论后局部 reload.
 *   - 长内容截不截看场景: title 不截 (用户进来就为看全), insight content 不截.
 *
 * 结构:
 *   TopBar     ← 返回 · 任务详情
 *   Header     任务全文 (16-17px) + 状态 chip + due_at + assignee chip
 *   来源       来源会议 link →
 *   AI 智囊    insights 列表 (AIInsightCard)
 *   实录依据   evidence_quote 灰块 + 几条 transcript 原文行
 *   评论       时间线 + 底部 textarea + 发送
 */

import { useCallback, useEffect, use, useMemo, useState } from "react";
import Link from "next/link";
import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import type {
  TaskDetailComment,
  TaskDetailEvidenceLine,
  TaskDetailOut,
} from "@/lib/mobile/types";

// 时间格式化
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function fmtDueDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 任务 8-state 中文 + 配色
const STATUS_MAP: Record<
  string,
  { label: string; chipBg: string; chipText: string }
> = {
  open: { label: "待派", chipBg: "bg-amber-500/15", chipText: "text-amber-300" },
  dispatched: {
    label: "已派",
    chipBg: "bg-sky-500/15",
    chipText: "text-sky-300",
  },
  accepted: {
    label: "已接",
    chipBg: "bg-sky-500/15",
    chipText: "text-sky-300",
  },
  in_progress: {
    label: "进行中",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-300",
  },
  submitted: {
    label: "待审",
    chipBg: "bg-violet-500/15",
    chipText: "text-violet-300",
  },
  done: {
    label: "已完成",
    chipBg: "bg-emerald-500/15",
    chipText: "text-emerald-300",
  },
  archived: {
    label: "归档",
    chipBg: "bg-zinc-700",
    chipText: "text-zinc-300",
  },
  cancelled: {
    label: "已取消",
    chipBg: "bg-zinc-800",
    chipText: "text-zinc-400",
  },
};

export default function MobileTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<TaskDetailOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 评论 box
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await mApi.getTaskDetail(id);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    mApi
      .getTaskDetail(id)
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
  }, [id]);

  const handlePostComment = useCallback(async () => {
    if (!data || !data.source_meeting_id) {
      setToast({ kind: "error", text: "找不到源会议, 无法评论" });
      return;
    }
    const txt = commentText.trim();
    if (!txt || posting) return;
    setPosting(true);
    try {
      await mApi.postTaskComment(data.source_meeting_id, data.action_item_id, txt);
      setCommentText("");
      await reload();
      setToast({ kind: "success", text: "评论已发布" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `评论失败: ${msg}` });
    } finally {
      setPosting(false);
    }
  }, [data, commentText, posting, reload]);

  const handleDeleteComment = useCallback(
    async (c: TaskDetailComment) => {
      if (!data || !data.source_meeting_id || !c.can_delete) return;
      try {
        await mApi.deleteTaskComment(data.source_meeting_id, data.action_item_id, c.id);
        await reload();
        setToast({ kind: "success", text: "已删除评论" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast({ kind: "error", text: `删除失败: ${msg}` });
      }
    },
    [data, reload],
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-24 animate-pulse rounded-2xl bg-ink-900" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-900" />
        <div className="h-20 animate-pulse rounded-2xl bg-ink-900" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-[16px] text-zinc-200">未能加载任务</p>
        <p className="text-[14px] text-zinc-500">{error}</p>
        <Link
          href="/m/tasks"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-700 px-6 text-[15px] text-zinc-200"
        >
          回任务列表
        </Link>
      </div>
    );
  }

  const status = STATUS_MAP[data.status] || STATUS_MAP.open;
  const assigneeChip = data.assignee_agent_id
    ? {
        kind: "ai" as const,
        text: data.assignee_agent_nickname || data.assignee_agent_name || "",
      }
    : data.assignee_user_id
    ? { kind: "human" as const, text: data.assignee_user_name || "" }
    : data.assignee_name_hint
    ? { kind: "hint" as const, text: data.assignee_name_hint }
    : null;

  return (
    <div className="flex min-h-full flex-col">
      {/* ===== TopBar ============================================ */}
      <div
        className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/m/tasks"
            className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
            aria-label="返回任务列表"
          >
            <span className="text-2xl leading-none">←</span>
          </Link>
          <h1 className="flex-1 truncate text-[17px] font-semibold text-zinc-50">
            任务详情
          </h1>
        </div>
      </div>

      <main className="space-y-5 p-4 pb-6">
        {/* ===== Header: 任务全文 + chip 行 ========================= */}
        <section
          className="rounded-2xl bg-ink-900 p-4"
          data-testid="mobile-task-detail-header"
        >
          <p className="text-[16px] leading-snug text-zinc-50">
            {data.content}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium ${status.chipBg} ${status.chipText}`}
            >
              {status.label}
            </span>
            {data.due_at ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium ${
                  data.is_overdue
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-zinc-800 text-zinc-300"
                }`}
              >
                截止 {fmtDueDate(data.due_at)}
                {data.is_overdue ? " · 超期" : ""}
              </span>
            ) : null}
            {assigneeChip ? (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium ${
                  assigneeChip.kind === "ai"
                    ? "bg-violet-500/15 text-violet-300"
                    : assigneeChip.kind === "human"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {assigneeChip.kind === "ai" ? "🤖" : assigneeChip.kind === "human" ? "👤" : "?"}
                {assigneeChip.text}
              </span>
            ) : null}
          </div>
          {data.source_meeting_id && data.source_meeting_title ? (
            <Link
              href={`/m/meetings/${data.source_meeting_id}`}
              className="mt-3 block truncate text-[13px] text-accent-400 active:text-accent-300"
            >
              来自 {data.source_meeting_title} →
            </Link>
          ) : null}
        </section>

        {/* ===== AI 智囊依据 ==================================== */}
        {data.insights.length > 0 ? (
          <section>
            <h2 className="px-1 text-[14px] font-medium text-zinc-300">
              💡 AI 智囊依据{" "}
              <span className="text-[13px] text-zinc-500">
                · {data.insights.length} 条
              </span>
            </h2>
            <ul className="mt-2 space-y-2">
              {data.insights.map((ins) => (
                <li key={ins.id}>
                  <AIInsightCard insight={ins} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ===== 实录依据 ====================================== */}
        {data.evidence_quote || data.evidence_lines.length > 0 ? (
          <section>
            <h2 className="px-1 text-[14px] font-medium text-zinc-300">
              📝 实录依据
            </h2>
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-ink-900 p-4">
              {data.evidence_quote ? (
                <blockquote className="border-l-[3px] border-zinc-600 pl-3 text-[15px] italic text-zinc-200">
                  {data.evidence_quote}
                </blockquote>
              ) : null}
              {data.evidence_lines.length > 0 ? (
                <ul
                  className={`${
                    data.evidence_quote ? "mt-3 border-t border-ink-800 pt-3" : ""
                  } space-y-2.5`}
                >
                  {data.evidence_lines.map((l) => (
                    <EvidenceLineRow key={l.line_id} line={l} />
                  ))}
                </ul>
              ) : null}
              {data.source_meeting_id ? (
                <Link
                  href={`/m/meetings/${data.source_meeting_id}`}
                  className="mt-3 block text-[13px] font-medium text-accent-400 active:text-accent-300"
                >
                  → 看完整会议实录
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ===== 评论时间线 ===================================== */}
        <section>
          <h2 className="px-1 text-[14px] font-medium text-zinc-300">
            💬 评论{" "}
            <span className="text-[13px] text-zinc-500">
              · {data.comments.length}
            </span>
          </h2>
          {data.comments.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-[14px] text-zinc-400">
              还没人评论, 你来开个头
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  onDelete={() => handleDeleteComment(c)}
                />
              ))}
            </ul>
          )}

          {/* 发评论 box */}
          <div className="mt-3 rounded-2xl border border-ink-800 bg-ink-900 p-3">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              disabled={posting}
              placeholder="写点进展、问题或反馈..."
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-lg bg-ink-950 px-3 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent-500/40 disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-zinc-500 tabular-nums">
                {commentText.length}/2000
              </span>
              <button
                type="button"
                disabled={!commentText.trim() || posting}
                onClick={handlePostComment}
                className="flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-[14px] font-medium text-white shadow-md shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {posting ? "发送中…" : "发送"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

// ===== 子组件 =============================================================

function EvidenceLineRow({ line }: { line: TaskDetailEvidenceLine }) {
  return (
    <li className="flex items-baseline gap-2 text-[14px] leading-snug">
      <span className="shrink-0 text-zinc-500 tabular-nums">
        {String(line.at_minute).padStart(2, "0")}m
      </span>
      {line.speaker_name ? (
        <span className="shrink-0 font-medium text-zinc-300">
          {line.speaker_name}
        </span>
      ) : (
        <span className="shrink-0 text-zinc-500">未识别</span>
      )}
      <span className="min-w-0 text-zinc-200">{line.text}</span>
    </li>
  );
}

function CommentRow({
  comment,
  onDelete,
}: {
  comment: TaskDetailComment;
  onDelete: () => void;
}) {
  return (
    <li
      className="rounded-xl bg-ink-900 p-4"
      data-testid="mobile-task-comment"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-medium text-zinc-100">
            {comment.author_name}
          </span>
          <span className="text-[13px] text-zinc-500">
            {fmtDate(comment.created_at)}
          </span>
        </div>
        {comment.can_delete ? (
          <button
            type="button"
            onClick={onDelete}
            className="text-[13px] text-zinc-500 active:text-rose-400"
          >
            删除
          </button>
        ) : null}
      </header>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
        {comment.content}
      </p>
    </li>
  );
}
