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
 *
 * v1.4.0 Saga D · 浅色化 (round-6).
 *   - 跟 Mobile MR_COLORS / round-3 会议室 一致 (iOS 浅色)
 *   - bg ink-950/900 → MR_COLORS.bgGroupedPrimary / bgWhite
 *   - 主蓝 accent → systemBlue (#007AFF); 紫 violet → systemPurple
 *   - chip 色板按 iOS 系统色 重映射
 */

import { useCallback, useEffect, use, useMemo, useState } from "react";
import Link from "next/link";
import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import Toast from "@/components/mobile/Toast";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
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

// 任务 8-state 中文 + 配色 (浅色 iOS — chipBg/chipText 用 rgba/系统色)
const STATUS_MAP: Record<
  string,
  { label: string; chipBg: string; chipText: string }
> = {
  open: {
    label: "待派",
    chipBg: "rgba(255,159,10,0.12)",
    chipText: MR_COLORS.systemOrange,
  },
  dispatched: {
    label: "已派",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  accepted: {
    label: "已接",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  in_progress: {
    label: "进行中",
    chipBg: "rgba(0,122,255,0.10)",
    chipText: MR_COLORS.systemBlue,
  },
  submitted: {
    label: "待审",
    chipBg: "rgba(94,92,230,0.10)",
    chipText: MR_COLORS.systemPurple,
  },
  done: {
    label: "已完成",
    chipBg: "rgba(52,199,89,0.12)",
    chipText: MR_COLORS.systemGreen,
  },
  archived: {
    label: "归档",
    chipBg: MR_COLORS.bgInputFill,
    chipText: MR_COLORS.textSecondary,
  },
  cancelled: {
    label: "已取消",
    chipBg: MR_COLORS.bgInputFill,
    chipText: MR_COLORS.textTertiary,
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

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      background: MR_COLORS.bgGroupedPrimary,
      minHeight: "100%",
    }),
    [],
  );

  if (loading) {
    return (
      <div style={containerStyle} className="space-y-4 p-4">
        <div
          className="h-24 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
        <div
          className="h-32 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
        <div
          className="h-20 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={containerStyle} className="space-y-3 p-6 text-center">
        <p className="text-[16px]" style={{ color: MR_COLORS.textPrimary }}>
          未能加载任务
        </p>
        <p className="text-[14px]" style={{ color: MR_COLORS.textTertiary }}>
          {error}
        </p>
        <Link
          href="/m/tasks"
          className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px]"
          style={{
            border: `0.5px solid ${MR_COLORS.hairline}`,
            background: MR_COLORS.bgWhite,
            color: MR_COLORS.textPrimary,
          }}
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
    <div style={containerStyle} className="flex min-h-full flex-col">
      {/* ===== TopBar ============================================ */}
      <div
        className="sticky top-0 z-30 px-4 pb-3 backdrop-blur"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          background: "rgba(242,242,247,0.92)",
          borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/m/tasks"
            className="-ml-2 flex h-10 w-10 items-center justify-center"
            style={{ color: MR_COLORS.systemBlue }}
            aria-label="返回任务列表"
          >
            <span className="text-2xl leading-none">←</span>
          </Link>
          <h1
            className="flex-1 truncate text-[17px] font-semibold"
            style={{ color: MR_COLORS.textPrimary }}
          >
            任务详情
          </h1>
        </div>
      </div>

      <main className="space-y-5 p-4 pb-6">
        {/* ===== Header: 任务全文 + chip 行 ========================= */}
        <section
          className="rounded-2xl p-4"
          style={{
            background: MR_COLORS.bgWhite,
            border: `0.5px solid ${MR_COLORS.hairline}`,
          }}
          data-testid="mobile-task-detail-header"
        >
          <p
            className="text-[16px] leading-snug"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {data.content}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium"
              style={{ background: status.chipBg, color: status.chipText }}
            >
              {status.label}
            </span>
            {data.due_at ? (
              <span
                className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-medium"
                style={{
                  background: data.is_overdue
                    ? "rgba(255,59,48,0.12)"
                    : MR_COLORS.bgInputFill,
                  color: data.is_overdue
                    ? MR_COLORS.systemRed
                    : MR_COLORS.textSecondary,
                }}
              >
                截止 {fmtDueDate(data.due_at)}
                {data.is_overdue ? " · 超期" : ""}
              </span>
            ) : null}
            {assigneeChip ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
                style={
                  assigneeChip.kind === "ai"
                    ? {
                        background: "rgba(94,92,230,0.10)",
                        color: MR_COLORS.systemPurple,
                      }
                    : assigneeChip.kind === "human"
                    ? {
                        background: "rgba(52,199,89,0.12)",
                        color: MR_COLORS.systemGreen,
                      }
                    : {
                        background: MR_COLORS.bgInputFill,
                        color: MR_COLORS.textTertiary,
                      }
                }
              >
                {assigneeChip.kind === "ai" ? "🤖" : assigneeChip.kind === "human" ? "👤" : "?"}
                {assigneeChip.text}
              </span>
            ) : null}
          </div>
          {data.source_meeting_id && data.source_meeting_title ? (
            <Link
              href={`/m/meetings/${data.source_meeting_id}`}
              className="mt-3 block truncate text-[13px]"
              style={{ color: MR_COLORS.systemBlue }}
            >
              来自 {data.source_meeting_title} →
            </Link>
          ) : null}
        </section>

        {/* ===== AI 智囊依据 ==================================== */}
        {data.insights.length > 0 ? (
          <section>
            <h2
              className="px-1 text-[14px] font-medium"
              style={{ color: MR_COLORS.textSecondary }}
            >
              💡 AI 智囊依据{" "}
              <span
                className="text-[13px]"
                style={{ color: MR_COLORS.textTertiary }}
              >
                · {data.insights.length} 条
              </span>
            </h2>
            <ul className="mt-2 space-y-2">
              {data.insights.map((ins) => (
                <li key={ins.id}>
                  <AIInsightCard insight={ins} light />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ===== 实录依据 ====================================== */}
        {data.evidence_quote || data.evidence_lines.length > 0 ? (
          <section>
            <h2
              className="px-1 text-[14px] font-medium"
              style={{ color: MR_COLORS.textSecondary }}
            >
              📝 实录依据
            </h2>
            <div
              className="mt-2 rounded-2xl p-4"
              style={{
                background: MR_COLORS.bgWhite,
                border: `0.5px solid ${MR_COLORS.hairline}`,
              }}
            >
              {data.evidence_quote ? (
                <blockquote
                  className="pl-3 text-[15px] italic"
                  style={{
                    borderLeft: `3px solid ${MR_COLORS.separator}`,
                    color: MR_COLORS.textSecondary,
                  }}
                >
                  {data.evidence_quote}
                </blockquote>
              ) : null}
              {data.evidence_lines.length > 0 ? (
                <ul
                  className={`${data.evidence_quote ? "mt-3 pt-3" : ""} space-y-2.5`}
                  style={
                    data.evidence_quote
                      ? { borderTop: `0.5px solid ${MR_COLORS.hairline}` }
                      : undefined
                  }
                >
                  {data.evidence_lines.map((l) => (
                    <EvidenceLineRow key={l.line_id} line={l} />
                  ))}
                </ul>
              ) : null}
              {data.source_meeting_id ? (
                <Link
                  href={`/m/meetings/${data.source_meeting_id}`}
                  className="mt-3 block text-[13px] font-medium"
                  style={{ color: MR_COLORS.systemBlue }}
                >
                  → 看完整会议实录
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ===== 评论时间线 ===================================== */}
        <section>
          <h2
            className="px-1 text-[14px] font-medium"
            style={{ color: MR_COLORS.textSecondary }}
          >
            💬 评论{" "}
            <span
              className="text-[13px]"
              style={{ color: MR_COLORS.textTertiary }}
            >
              · {data.comments.length}
            </span>
          </h2>
          {data.comments.length === 0 ? (
            <p
              className="mt-2 rounded-xl px-4 py-6 text-center text-[14px]"
              style={{
                border: `1px dashed ${MR_COLORS.hairlineStrong}`,
                color: MR_COLORS.textTertiary,
              }}
            >
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
          <div
            className="mt-3 rounded-2xl p-3"
            style={{
              background: MR_COLORS.bgWhite,
              border: `0.5px solid ${MR_COLORS.hairline}`,
            }}
          >
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              disabled={posting}
              placeholder="写点进展、问题或反馈..."
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-lg px-3 py-2.5 text-[15px] focus:outline-none disabled:opacity-60"
              style={{
                background: MR_COLORS.bgInputFill,
                color: MR_COLORS.textPrimary,
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span
                className="text-[13px] tabular-nums"
                style={{ color: MR_COLORS.textTertiary }}
              >
                {commentText.length}/2000
              </span>
              <button
                type="button"
                disabled={!commentText.trim() || posting}
                onClick={handlePostComment}
                className="flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-medium text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background: MR_COLORS.systemBlue,
                  boxShadow: "0 2px 8px rgba(0,122,255,0.20)",
                }}
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
      <span
        className="shrink-0 tabular-nums"
        style={{ color: MR_COLORS.textTertiary }}
      >
        {String(line.at_minute).padStart(2, "0")}m
      </span>
      {line.speaker_name ? (
        <span
          className="shrink-0 font-medium"
          style={{ color: MR_COLORS.textSecondary }}
        >
          {line.speaker_name}
        </span>
      ) : (
        <span
          className="shrink-0"
          style={{ color: MR_COLORS.textTertiary }}
        >
          未识别
        </span>
      )}
      <span className="min-w-0" style={{ color: MR_COLORS.textPrimary }}>
        {line.text}
      </span>
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
      className="rounded-xl p-4"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-task-comment"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[14px] font-medium"
            style={{ color: MR_COLORS.textPrimary }}
          >
            {comment.author_name}
          </span>
          <span
            className="text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {fmtDate(comment.created_at)}
          </span>
        </div>
        {comment.can_delete ? (
          <button
            type="button"
            onClick={onDelete}
            className="text-[13px]"
            style={{ color: MR_COLORS.systemRed }}
          >
            删除
          </button>
        ) : null}
      </header>
      <p
        className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed"
        style={{ color: MR_COLORS.textSecondary }}
      >
        {comment.content}
      </p>
    </li>
  );
}
