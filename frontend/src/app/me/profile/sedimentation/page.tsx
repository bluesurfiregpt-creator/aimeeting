"use client";

/**
 * v26.5-WS / Lineage · 待我审批的 沉淀草稿 + 历史
 *
 * 两个 顶层 tab:
 *  - 📚 KB 沉淀 (v26.5-02c)  — 跨人办结任务 → 拟把内容写 KB → 你审批
 *  - 🧠 Memory 沉淀 (v26.5-Lineage) — 会议结束 LLM 抽出候选记忆 → 你审批
 *
 * 内层 tab: pending / approved / rejected.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type MemoryDraft, type SedimentationDraft } from "@/lib/api";
import { toast } from "@/lib/toast";

type TopTab = "kb" | "memory";
type Tab = "pending" | "approved" | "rejected";

export default function SedimentationPage() {
  const [topTab, setTopTab] = useState<TopTab>("kb");
  const [tab, setTab] = useState<Tab>("pending");
  const [kbDrafts, setKbDrafts] = useState<SedimentationDraft[]>([]);
  const [memDrafts, setMemDrafts] = useState<MemoryDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKbDraft, setOpenKbDraft] = useState<SedimentationDraft | null>(null);
  const [openMemDraft, setOpenMemDraft] = useState<MemoryDraft | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (topTab === "kb") {
        setKbDrafts(await api.listSedimentationDrafts(tab));
      } else {
        setMemDrafts(await api.listMemoryDrafts(tab));
      }
    } finally {
      setLoading(false);
    }
  }, [topTab, tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const drafts = topTab === "kb" ? kbDrafts : memDrafts;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium text-white">🔔 沉淀审批中心</h2>
        <p className="mt-1 text-sm text-zinc-500">
          会议 / 任务 自动抽取的内容, 拟挂到 你维护的 AI 上. 你审批 才真正入库.
        </p>
      </header>

      {/* v26.5-Lineage: 顶层 tab — KB 沉淀 vs Memory 沉淀 */}
      <nav className="flex gap-1 rounded-xl border border-ink-700 bg-ink-950 p-1">
        <TopTabButton
          active={topTab === "kb"}
          onClick={() => setTopTab("kb")}
          label="📚 KB 沉淀"
          count={topTab === "kb" ? kbDrafts.filter((d) => d.status === "pending").length : undefined}
        />
        <TopTabButton
          active={topTab === "memory"}
          onClick={() => setTopTab("memory")}
          label="🧠 Memory 沉淀"
          count={topTab === "memory" ? memDrafts.filter((d) => d.status === "pending").length : undefined}
        />
      </nav>

      <nav className="flex gap-1 border-b border-ink-700">
        {[
          { k: "pending" as Tab, label: "待我审批" },
          { k: "approved" as Tab, label: "已批准" },
          { k: "rejected" as Tab, label: "已驳回" },
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
          // v26.8-UI-06: 空状态加 引导
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center">
            <div className="text-4xl" aria-hidden>
              {tab === "pending" ? "📭" : tab === "approved" ? "✅" : "🗑️"}
            </div>
            <h4 className="mt-3 text-sm font-medium text-zinc-200">
              {tab === "pending" && `暂无待你审批的 ${topTab === "kb" ? "KB" : "Memory"} 沉淀`}
              {tab === "approved" && `尚无 已批准 的${topTab === "kb" ? "KB" : "Memory"} 沉淀`}
              {tab === "rejected" && `尚无 已驳回 的${topTab === "kb" ? "KB" : "Memory"} 沉淀`}
            </h4>
            {tab === "pending" && (
              <p className="mx-auto mt-2 max-w-md text-xs text-zinc-500 leading-relaxed">
                当会议或任务自动提取知识内容后, 拟挂到 你维护的 AI 上, 需要 你审批
                才能 真正 入库 到对应的 AI 知识库 / 长期记忆.
              </p>
            )}
            {tab === "pending" && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <a
                  href="/me"
                  className="rounded-lg border border-ink-700 px-4 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
                >
                  → 我的任务
                </a>
                <a
                  href="/me/profile/agents"
                  className="rounded-lg border border-ink-700 px-4 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
                >
                  → 我管理的 AI
                </a>
              </div>
            )}
          </div>
        ) : topTab === "kb" ? (
          <ul className="space-y-2">
            {kbDrafts.map((d) => (
              <KbDraftRow
                key={d.id}
                draft={d}
                onClick={() => setOpenKbDraft(d)}
                isPending={tab === "pending"}
              />
            ))}
          </ul>
        ) : (
          <ul className="space-y-2">
            {memDrafts.map((d) => (
              <MemDraftRow
                key={d.id}
                draft={d}
                onClick={() => setOpenMemDraft(d)}
                isPending={tab === "pending"}
              />
            ))}
          </ul>
        )}
      </section>

      {openKbDraft && (
        <KbDraftReviewDialog
          draft={openKbDraft}
          onClose={() => setOpenKbDraft(null)}
          onDone={() => {
            setOpenKbDraft(null);
            void refresh();
          }}
        />
      )}
      {openMemDraft && (
        <MemDraftReviewDialog
          draft={openMemDraft}
          onClose={() => setOpenMemDraft(null)}
          onDone={() => {
            setOpenMemDraft(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function TopTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition ${
        active
          ? "bg-accent-500/15 text-accent-300"
          : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
          {count}
        </span>
      )}
    </button>
  );
}

function KbDraftRow({
  draft: d,
  onClick,
  isPending,
}: {
  draft: SedimentationDraft;
  onClick: () => void;
  isPending: boolean;
}) {
  return (
    <li className="rounded-xl border border-ink-700 bg-ink-900 p-4">
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
          onClick={onClick}
          className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
        >
          {isPending ? "查看 / 审批 →" : "查看 →"}
        </button>
      </div>
    </li>
  );
}

function MemDraftRow({
  draft: d,
  onClick,
  isPending,
}: {
  draft: MemoryDraft;
  onClick: () => void;
  isPending: boolean;
}) {
  return (
    <li className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
              {d.proposed_content.slice(0, 80)}
              {d.proposed_content.length > 80 && "…"}
            </span>
            {(d.target_agent_names ?? []).map((n) => (
              <span
                key={n}
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
              >
                → {n}
              </span>
            ))}
            <StatusBadge status={d.status} />
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            来源: {d.source_meeting_title
              ? `会议《${d.source_meeting_title}》`
              : d.source_task_title
                ? `任务《${d.source_task_title}》`
                : d.source_type}
            {" · "}创建于 {new Date(d.created_at).toLocaleString("zh-CN")}
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
          onClick={onClick}
          className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
        >
          {isPending ? "查看 / 审批 →" : "查看 →"}
        </button>
      </div>
    </li>
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

function KbDraftReviewDialog({
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

// v26.5-Lineage: Memory 沉淀审批 dialog (跟 KbDraftReviewDialog 对称)
function MemDraftReviewDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: MemoryDraft;
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
      await api.approveMemoryDraft(draft.id);
      toast.success("✅ 已批准, 写入 long_term_memory");
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
      await api.rejectMemoryDraft(draft.id, rejectReason.trim() || undefined);
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
          <h4 className="text-sm font-medium text-zinc-200">Memory 沉淀审批</h4>
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">✕</button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-zinc-500">来源</div>
            <div className="mt-1 text-sm text-white">
              {draft.source_meeting_title
                ? `🎙️ 会议《${draft.source_meeting_title}》`
                : draft.source_task_title
                  ? `📋 任务《${draft.source_task_title}》`
                  : draft.source_type}
            </div>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-zinc-500">挂给 AI 专家</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(draft.target_agent_names ?? []).map((n) => (
                <span
                  key={n}
                  className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
                >
                  🤖 {n}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-xs text-zinc-500">拟写入内容</div>
            <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-200">
              {draft.proposed_content}
            </pre>
            <div className="mt-2 flex gap-3 text-[11px] text-zinc-500">
              <span>scope: {draft.proposed_scope}</span>
              <span>重要度: {draft.proposed_importance.toFixed(1)}</span>
            </div>
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
                    placeholder="例: 这条事实有歧义"
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
                  {busy ? "处理中…" : "✅ 批准 入库"}
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
