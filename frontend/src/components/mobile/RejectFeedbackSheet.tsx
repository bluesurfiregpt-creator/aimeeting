"use client";

/**
 * v27.0-mobile · Phase 4.5 · 驳回 + 可选 feedback 文本 sheet.
 *
 * 用在 memory draft 驳回路径上. 让用户把 "为什么不该入库" 告诉 AI,
 * 形成 AI → 用户 → AI 的反馈循环. 后端 reject endpoint 接受
 * `kind="discard" | "feedback"` + 可选 `feedback_text`.
 *
 * 设计:
 *   - 底部弹起 sheet (跟 SummonAgentSheet 同风格)
 *   - 顶部把手 + 标题 "驳回 — 可选告诉 AI 哪不对"
 *   - 副标题展示 草稿 title 截断 (~60 字)
 *   - 中间 textarea (rows=4, 上限 500 字)
 *   - 两按钮:
 *     - "仅驳回" (灰边)        → onSubmit("")
 *     - "驳回并反馈" (蓝主)     → onSubmit(text); 没文字时此按钮 disabled
 *   - busy 时全部 disabled, 主按钮显 "处理中…"
 */

import { useEffect, useState } from "react";

export default function RejectFeedbackSheet({
  open,
  draftTitle,
  busy = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 草稿标题, 顶部展示给用户确认在驳哪条 */
  draftTitle: string;
  busy?: boolean;
  onClose: () => void;
  /** feedback 空串 = kind=discard, 非空 = kind=feedback */
  onSubmit: (feedback: string) => void;
}) {
  const [text, setText] = useState("");

  // 关闭时清空
  useEffect(() => {
    if (!open) {
      setText("");
    }
  }, [open]);

  if (!open) return null;

  const trimmed = text.trim();
  const hasFeedback = trimmed.length > 0;

  return (
    <div className="fixed inset-0 z-50" data-testid="mobile-reject-sheet">
      {/* 背景 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* sheet 主体 */}
      <div
        className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-hidden rounded-t-3xl border-t border-ink-800 bg-ink-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* 顶部把手 + 标题 */}
        <div className="flex flex-col items-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-zinc-700" />
          <h2 className="mt-3 text-[17px] font-semibold text-zinc-50">
            驳回 — 可选告诉 AI 哪不对
          </h2>
          <p className="mt-1 px-6 text-center text-[13px] text-zinc-400">
            写了 AI 下次会更准. 不写也行, 直接丢弃.
          </p>
        </div>

        {/* 草稿引用块 */}
        <div className="px-4 pb-2">
          <div className="rounded-xl border border-zinc-800 bg-ink-900 px-3 py-2.5">
            <p className="text-[14px] leading-snug text-zinc-300 line-clamp-3">
              {draftTitle}
            </p>
          </div>
        </div>

        {/* feedback 输入 */}
        <div className="px-4 pb-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder="例: 这条不该入个人库, 应该是项目库 / AI 抽错重点 / 重复了已有记忆..."
            rows={4}
            maxLength={500}
            className="w-full resize-none rounded-xl border border-ink-800 bg-ink-900 px-3 py-2.5 text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/60 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-1 text-right text-[12px] text-zinc-500 tabular-nums">
            {text.length}/500
          </div>
        </div>

        {/* 底部 actions */}
        <div className="flex gap-2 border-t border-ink-800 bg-ink-950 px-4 pt-3 pb-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit("")}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700 px-4 text-[15px] text-zinc-200 active:scale-[0.98] disabled:opacity-50"
          >
            {busy && !hasFeedback ? "处理中…" : "仅驳回"}
          </button>
          <button
            type="button"
            disabled={!hasFeedback || busy}
            onClick={() => onSubmit(trimmed)}
            className="flex h-12 flex-[1.4] items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy && hasFeedback ? "处理中…" : "驳回并反馈"}
          </button>
        </div>
      </div>
    </div>
  );
}
