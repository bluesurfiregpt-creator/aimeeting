"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ReportSeverity } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v24.1 #2 — 用户主动上报问题 → Task(source_type='report').
 *
 * 任何 workspace member 都可以发起,不限角色.创建出来的 Task 进 leader/admin
 * 的「待派发」队列(status='open' + assignee 留空),根据严重度发不同色通知.
 *
 * 由 AuthHeader 顶栏「📢 上报」按钮控制开/关.
 */

const SEVERITY_OPTIONS: { value: ReportSeverity; label: string; desc: string; color: string }[] = [
  { value: "low",    label: "轻微",  desc: "可以排期处理",            color: "bg-zinc-700 text-zinc-300" },
  { value: "medium", label: "一般",  desc: "尽快关注 / 影响个别业务",  color: "bg-amber-500/20 text-amber-200" },
  { value: "high",   label: "严重",  desc: "立即处理 / 系统性风险",    color: "bg-red-500/20 text-red-200" },
];

export default function ReportPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [severity, setSeverity] = useState<ReportSeverity>("medium");
  const [busy, setBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setTitle("");
      setContent("");
      setSeverity("medium");
    }
  }, [open]);

  const submit = useCallback(async () => {
    const c = content.trim();
    if (c.length < 5) {
      toast.error("请详细描述问题(至少 5 字)");
      return;
    }
    if (c.length > 2000) {
      toast.error("内容过长(最多 2000 字)");
      return;
    }
    setBusy(true);
    try {
      const r = await api.createReport({
        title: title.trim() || null,
        content: c,
        severity,
      });
      toast.success(
        `✅ 已上报,通知了 ${r.notified_leaders} 位 leader/admin。点击查看任务。`,
      );
      onClose();
      // 自动跳转到新建的任务详情页(让用户看到结果)
      router.push(`/task/${r.task_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上报失败");
    } finally {
      setBusy(false);
    }
  }, [title, content, severity, router, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      data-testid="report-panel"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span aria-hidden>📢</span> 上报问题
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            关闭
          </button>
        </header>
        <p className="mt-1 text-xs text-zinc-500">
          描述你看到的问题。提交后会进入 leader/admin 的「待派发」队列,
          由领导分派给具体 AI 专家或责任人。
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">标题(可选 — 不填取正文前 40 字)</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              placeholder="如:沙头街道某楼宇外立面瓷砖松动"
              data-testid="report-title-input"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500">问题描述 *(5-2000 字)</span>
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              placeholder="详细说明问题现象、发生时间、地点、影响范围、是否需要紧急处理…"
              data-testid="report-content-input"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
            <span className="mt-0.5 block text-right text-[10px] text-zinc-600">
              {content.length} / 2000
            </span>
          </label>

          <div>
            <span className="text-xs text-zinc-500">严重度</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSeverity(opt.value)}
                  data-testid={`report-severity-${opt.value}`}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    severity === opt.value
                      ? "border-accent-500 bg-accent-500/10"
                      : "border-ink-700 bg-ink-950 hover:border-ink-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${opt.color}`}
                    >
                      {opt.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
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
            onClick={submit}
            disabled={busy || content.trim().length < 5}
            data-testid="report-submit-btn"
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {busy ? "上报中…" : "📢 提交上报"}
          </button>
        </div>
      </div>
    </div>
  );
}
