"use client";

/**
 * v27.0-mobile P14.2 · 退出会议室确认 sheet.
 *
 * 触发: 用户点会议室左上角 ← 返回按钮 (当 status=ongoing 时).
 *
 * 三个选项:
 *   - "仅离开 (会议继续)" — 退到 /m, 会议状态 ongoing 不变, 别人能继续开
 *   - "结束会议" — 调 finalize, 会议状态 → finished, 跑 AI 纪要 + 抽待办
 *   - "取消" — sheet 收, 留在会议室
 *
 * 设计选用 sheet 而不是 ConfirmDialog 因为后者只 2 按钮.
 */

import { useEffect } from "react";

export default function LeaveMeetingSheet({
  open,
  meetingTitle,
  endingMeeting = false,
  onJustLeave,
  onEndMeeting,
  onCancel,
}: {
  open: boolean;
  meetingTitle: string;
  /** 用户点了结束会议, finalize API 进行中 */
  endingMeeting?: boolean;
  onJustLeave: () => void;
  onEndMeeting: () => void;
  onCancel: () => void;
}) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !endingMeeting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, endingMeeting, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" data-testid="mobile-leave-sheet">
      {/* 背景遮罩 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={() => !endingMeeting && onCancel()}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* sheet 主体 */}
      <div
        className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-3xl border-t border-ink-800 bg-ink-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* 顶部把手 + 标题 */}
        <div className="flex flex-col items-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-zinc-700" />
          <h2 className="mt-3 px-6 text-center text-[17px] font-semibold text-zinc-50">
            退出会议室
          </h2>
          <p className="mt-1 px-6 text-center text-[13px] text-zinc-400 truncate max-w-full">
            {meetingTitle}
          </p>
        </div>

        {/* 按钮组 */}
        <div className="space-y-2 px-4 pt-2 pb-4">
          {/* 仅离开 — 默认主操作, 风险低 */}
          <button
            type="button"
            onClick={onJustLeave}
            disabled={endingMeeting}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-ink-900 px-4 text-[15px] font-medium text-zinc-100 active:scale-[0.98] active:bg-ink-800 disabled:opacity-50"
            data-testid="mobile-leave-just-leave"
          >
            <div className="flex flex-col items-center">
              <span>仅离开会议室</span>
              <span className="mt-0.5 text-[12px] font-normal text-zinc-500">
                会议继续, 之后可重新进入
              </span>
            </div>
          </button>

          {/* 结束会议 — 不可逆 + 跑 AI 后处理 */}
          <button
            type="button"
            onClick={onEndMeeting}
            disabled={endingMeeting}
            className="flex h-14 w-full items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] px-4 text-[15px] font-medium text-rose-300 active:scale-[0.98] active:bg-rose-500/[0.12] disabled:opacity-50"
            data-testid="mobile-leave-end-meeting"
          >
            <div className="flex flex-col items-center">
              <span>{endingMeeting ? "结束中…" : "结束会议"}</span>
              <span className="mt-0.5 text-[12px] font-normal text-rose-400/70">
                AI 自动生成纪要 + 抽待办. 不可撤销
              </span>
            </div>
          </button>

          {/* 取消 */}
          <button
            type="button"
            onClick={onCancel}
            disabled={endingMeeting}
            className="flex h-12 w-full items-center justify-center rounded-2xl text-[15px] text-zinc-400 active:bg-ink-900 disabled:opacity-50"
            data-testid="mobile-leave-cancel"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
