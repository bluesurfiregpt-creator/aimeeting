"use client";

/**
 * v26.5-WS · 待我审批的 KB 沉淀 + 历史
 *
 * 跟身份页底部的 🔔 提示 配套. 跨人办结任务 → 创建 draft → 在这里审批.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type SedimentationDraft } from "@/lib/api";
import { toast } from "@/lib/toast";

type Tab = "pending" | "approved" | "rejected";

export default function SedimentationPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [drafts, setDrafts] = useState<SedimentationDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDraft, setOpenDraft] = useState<SedimentationDraft | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listSedimentationDrafts(tab);
      setDrafts(rows);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium text-white">🔔 KB 沉淀审批</h2>
        <p className="mt-1 text-sm text-zinc-500">
          别的同事 办了任务, 拟把内容沉淀到 你维护的 AI 的 KB. 你审批 才会真的写入.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-ink-700">
        {[
          { k: "pending" as Tab, label: "待我审批", count: drafts.length },
          { k: "approved" as Tab, label: "已批准", count: undefined },
          { k: "rejected" as Tab, label: "已驳回", count: undefined },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-t-lg px-4 py-2 text-sm transition ${
              tab === t.k
                ? "border-b-2 border-accent-500 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section>
        {loading ? (
          <p className="text-sm text-zinc-500">加载中…</p>
        ) : drafts.length === 0 ? (
          <p className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-zinc-500">
            {tab === "pending" && "✨ 没有待你审批的沉淀"}
            {tab === "approved" && "尚无 已批准 的沉淀"}
            {tab === "rejected" && "尚无 已驳回 的沉淀"}
          </p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-ink-700 bg-ink-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {d.task_title ?? "(无标题)"}
                      </span>
                      {d.target_agent_name && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                          → {d.target_agent_name}
                        </span>
                      )}
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {d.curator_user_name && `由 ${d.curator_user_name} · `}
                      创建于 {new Date(d.created_at).toLocaleString("zh-CN")}
                      {d.decided_at && ` · 处理于 ${new Date(d.decided_at).toLocaleString("zh-CN")}`}
                    </div>
                    {d.decision_reason && (
                      <div className="mt-2 rounded bg-rose-500/5 px-2 py-1 text-xs text-rose-300">
                        驳回理由: {d.decision_reason}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenDraft(d)}
                    className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
                  >
                    {tab === "pending" ? "查看 / 审批 →" : "查看 →"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openDraft && (
        <DraftReviewDialog
          draft={openDraft}
          onClose={() => setOpenDraft(null)}
          onDone={() => {
            setOpenDraft(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = {
    pending: "bg-amber-500/15 text-amber-300",
    approved: "bg-emerald-500/15 text-emerald-300",
    rejected: "bg-rose-500/15 text-rose-300",
    expired: "bg-zinc-700/40 text-zinc-500",
  }[status] ?? "bg-zinc-700/40 text-zinc-400";
  const label = {
    pending: "待审批",
    approved: "已批准",
    rejected: "已驳回",
    expired: "已过期",
  }[status] ?? status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${cls}`}>
      {label}
    </span>
  );
}

function DraftReviewDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: SedimentationDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const isReadonly = draft.status !== "pending";

  const doApprove = async () => {
    setBusy(true);
    try {
      await api.approveSedimentationDraft(draft.id);
      toast.success("✅ 已批准, 沉淀完成");
      onDone();
    } catch (e) {
      void e;
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      await api.rejectSedimentationDraft(draft.id, rejectReason.trim() || undefined);
      toast.success("已驳回");
      onDone();
    } catch (e) {
      void e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-zinc-200">沉淀审批详情</h4>
          <button
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-zinc-500">任务标题</div>
            <div className="mt-1 text-sm text-white">
              {draft.task_title ?? "(无标题)"}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
              <div className="text-zinc-500">沉淀目标 AI</div>
              <div className="mt-1 text-sm text-amber-300">
                🤖 {draft.target_agent_name ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
              <div className="text-zinc-500">触发者</div>
              <div className="mt-1 text-sm text-white">
                {draft.curator_user_name ?? "—"}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-zinc-500">拟沉淀摘要 (LLM 生成)</div>
            <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-200">
              {draft.proposed_summary}
            </pre>
          </div>

          {!isReadonly &&
            (showReject ? (
              <div>
                <label className="block text-sm">
                  <span className="text-xs text-zinc-500">驳回理由 (可选)</span>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                    placeholder="例: 内容不在本专业范围"
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={doReject}
                    disabled={busy}
                    className="rounded-lg bg-rose-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-rose-400"
                  >
                    {busy ? "驳回中…" : "确认驳回"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReject(false)}
                    className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doApprove}
                  disabled={busy}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-emerald-400"
                >
                  {busy ? "处理中…" : "✅ 批准 沉淀"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject(true)}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                >
                  驳回…
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
