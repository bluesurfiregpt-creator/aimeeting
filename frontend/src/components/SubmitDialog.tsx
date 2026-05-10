"use client";

import { useEffect, useState } from "react";
import { api, type MyTask } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v24.1 #5 — 阶段性上报模板(智慧住建文档 §4.3).
 *
 * 4 段结构化(都可选,但鼓励填全):
 *   - 已完成工作
 *   - 当前问题
 *   - 下一步计划
 *   - 佐证材料链接(每行一个,max 10 条)
 *
 * 可与 v22.5 协办未交 force=true 的兜底配合(424 弹 confirm 后传 force).
 */

export type SubmitDialogMode = "submit"; // 留扩展空间(未来可能加 'interim' 中间汇报)

export type SubmitDialogProps = {
  open: boolean;
  task: MyTask | null;  // 选中要 submit 的 task,null = 关闭
  onClose: () => void;
  onSubmitted: () => void; // 成功提交后回调(让外层 reload)
};

export default function SubmitDialog({
  open,
  task,
  onClose,
  onSubmitted,
}: SubmitDialogProps) {
  const [completed, setCompleted] = useState("");
  const [problems, setProblems] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [evidenceText, setEvidenceText] = useState("");  // 一行一个 URL
  const [busy, setBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setCompleted("");
      setProblems("");
      setNextSteps("");
      setEvidenceText("");
    }
  }, [open]);

  const submit = async (force = false) => {
    if (!task) return;
    const evidence_urls = evidenceText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (evidence_urls.length > 10) {
      toast.error("佐证材料链接最多 10 条");
      return;
    }
    if (!completed.trim() && !problems.trim() && !nextSteps.trim()) {
      toast.error("至少填一段(已完成 / 问题 / 下一步)");
      return;
    }
    setBusy(true);
    try {
      await api.submitTaskStructured(task.id, {
        completed: completed.trim() || null,
        problems: problems.trim() || null,
        next_steps: nextSteps.trim() || null,
        evidence_urls: evidence_urls.length > 0 ? evidence_urls : null,
        force,
      });
      toast.success("✅ 已上报办结申请(含结构化阶段汇报)");
      onSubmitted();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上报失败";
      // v22.5: 协办未交 → 422,让用户 confirm 再 force
      if (!force && (msg.includes("协办") || msg.includes("force=true"))) {
        if (window.confirm(`${msg}\n\n确认强制汇总并提交?`)) {
          await submit(true);
          return;
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open || !task) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      data-testid="submit-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span aria-hidden>📋</span> 阶段性上报模板
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          >
            关闭
          </button>
        </header>
        <p className="mt-1 text-xs text-zinc-500">
          为这个任务填阶段汇报。不填的段落留空即可,但**至少要填一段**。
        </p>
        <div className="mt-2 rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-zinc-400">
          📌 任务:<span className="text-zinc-200">{task.title || task.content.slice(0, 60)}</span>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">✅ 已完成工作</span>
            <textarea
              rows={3}
              value={completed}
              onChange={(e) => setCompleted(e.target.value)}
              maxLength={2000}
              placeholder="本周已经完成的关键工作 / 阶段成果(具体到结论 / 数据)"
              data-testid="submit-completed"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500">⚠️ 当前问题 / 风险</span>
            <textarea
              rows={3}
              value={problems}
              onChange={(e) => setProblems(e.target.value)}
              maxLength={2000}
              placeholder="遇到的卡点、需上级协调的事项、潜在风险"
              data-testid="submit-problems"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500">➡️ 下一步计划</span>
            <textarea
              rows={3}
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              maxLength={2000}
              placeholder="下周关键里程碑、需要的资源、预计完成时间"
              data-testid="submit-next-steps"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500">📎 佐证材料链接(一行一个,最多 10 条)</span>
            <textarea
              rows={3}
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              maxLength={5500}
              placeholder="https://aimeeting.zhzjpt.cn/knowledge/...&#10;https://oss.../照片.jpg"
              data-testid="submit-evidence"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm font-mono text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy}
            data-testid="submit-confirm-btn"
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {busy ? "上报中…" : "📋 提交办结申请"}
          </button>
        </div>
      </div>
    </div>
  );
}
