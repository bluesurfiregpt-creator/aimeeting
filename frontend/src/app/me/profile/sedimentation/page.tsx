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
import Link from "next/link";
import { api, type MemoryDraft, type SedimentationDraft } from "@/lib/api";
import { toast } from "@/lib/toast";

// v26.14-P7.3: 出处 链回 chip — Memory 草稿 / 持久 memory 通用.
//   显 "📝 来自 N 句 → 看上下文", click 跳 /meeting/<mid>?focus=<ids>
//   meetingId 缺 OR lineIds 空 → 不渲 (老 数据 兼容)
function SourceLineChip({
  meetingId,
  lineIds,
}: {
  meetingId: string | null | undefined;
  lineIds: number[] | null | undefined;
}) {
  if (!meetingId || !lineIds || lineIds.length === 0) return null;
  const focus = lineIds.join(",");
  return (
    <Link
      href={`/meeting/${meetingId}?focus=${focus}`}
      className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200 hover:border-violet-500 hover:bg-violet-500/20"
      title="跳到 实录 看 这条 经验 的 上下文 (会高亮 + 展开 ±3 句)"
    >
      <span aria-hidden>📝</span>
      <span>来自 {lineIds.length} 句</span>
      <span className="text-violet-400">→ 看 上下文</span>
    </Link>
  );
}

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
  // v26.14-P7.2: 批量 选 — 仅 Memory pending 用
  const [selectedMemIds, setSelectedMemIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

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
    setSelectedMemIds(new Set());  // 切 tab / 刷新 → 清 选
  }, [topTab, tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const drafts = topTab === "kb" ? kbDrafts : memDrafts;
  // v26.14-P7.2: 仅 Memory pending tab 显 多选
  const showBatchUI = topTab === "memory" && tab === "pending";
  const toggleMemSelect = (id: string) => {
    setSelectedMemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedMemIds((prev) => {
      const allIds = memDrafts.map((d) => d.id);
      if (prev.size === allIds.length && allIds.every((i) => prev.has(i))) {
        return new Set();  // 全选 → 全清
      }
      return new Set(allIds);
    });
  };
  const doBatch = async (action: "approve" | "reject") => {
    if (selectedMemIds.size === 0) return;
    if (action === "reject") {
      if (!confirm(`确定 驳回 选 中 的 ${selectedMemIds.size} 条 草稿?`)) return;
    }
    setBatchBusy(true);
    try {
      const res = await api.batchActionMemoryDrafts(
        Array.from(selectedMemIds), action,
      );
      const verb = action === "approve" ? "通过" : "驳回";
      if (res.failed === 0) {
        toast.success(`✅ 批量 ${verb} ${res.succeeded} 条`);
      } else {
        toast.info(`${verb} ${res.succeeded} 条 成功, ${res.failed} 条 失败`);
      }
      await refresh();
    } catch (e) {
      void e;
    } finally {
      setBatchBusy(false);
    }
  };

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
                selectable={showBatchUI}
                selected={selectedMemIds.has(d.id)}
                onToggleSelect={() => toggleMemSelect(d.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* v26.14-P7.2: 批量 sticky bar — 仅 Memory pending + 至少 选 1 条 显 */}
      {showBatchUI && selectedMemIds.size > 0 && (
        <div
          data-testid="memdraft-batch-bar"
          className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent-500/40 bg-ink-950/95 px-4 py-2 text-sm shadow-[0_0_24px_rgba(99,102,241,0.3)] backdrop-blur"
        >
          <span className="text-zinc-300">
            已选 <span className="font-semibold text-accent-300">{selectedMemIds.size}</span> 条
          </span>
          <span className="text-zinc-700">|</span>
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            {selectedMemIds.size === memDrafts.length ? "全清" : "全选"}
          </button>
          <span className="text-zinc-700">|</span>
          <button
            type="button"
            onClick={() => doBatch("approve")}
            disabled={batchBusy}
            data-testid="memdraft-batch-approve"
            className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white shadow hover:bg-emerald-400 disabled:opacity-50"
          >
            {batchBusy ? "处理中…" : `✅ 批量 通过 ${selectedMemIds.size}`}
          </button>
          <button
            type="button"
            onClick={() => doBatch("reject")}
            disabled={batchBusy}
            data-testid="memdraft-batch-reject"
            className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            驳回 {selectedMemIds.size}
          </button>
          <button
            type="button"
            onClick={() => setSelectedMemIds(new Set())}
            disabled={batchBusy}
            className="text-zinc-600 hover:text-zinc-300"
            title="清 选"
          >
            ✕
          </button>
        </div>
      )}

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
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  draft: MemoryDraft;
  onClick: () => void;
  isPending: boolean;
  // v26.14-P7.2: 批量 选 (仅 pending 显)
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <li
      className={`rounded-xl border p-4 transition ${
        selected
          ? "border-accent-500/60 bg-accent-500/5"
          : "border-ink-700 bg-ink-900"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            data-testid="memdraft-select"
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent-500"
            aria-label="选 此条"
          />
        )}
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
          {/* v26.14-P7.3: 出处 链回 chip — 拿 source_line_ids 跳 实录 focus */}
          <SourceLineChip
            meetingId={d.source_meeting_id}
            lineIds={d.source_line_ids ?? null}
          />
          {/* v26.14-P7.4: 拒绝 子 类型 区分 显 — discard 红 / feedback 琥珀 */}
          {d.rejection_kind === "feedback" && d.rejection_feedback ? (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-200">
              ↩ 退回 LLM · {d.rejection_feedback}
            </div>
          ) : d.decision_reason ? (
            <div className="mt-2 rounded bg-rose-500/5 px-2 py-1 text-xs text-rose-300">
              {d.rejection_kind === "discard" ? "🗑 弃用" : "驳回理由"}: {d.decision_reason}
            </div>
          ) : null}
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
// v26.14-P7.1: 加 inline 编辑 — 改 内容/重要度/scope, 改完 一键 "保存+通过"
function MemDraftReviewDialog({
  draft: initialDraft,
  onClose,
  onDone,
}: {
  draft: MemoryDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  // local state — 让 inline 编辑 改 完 立刻 显示, 不依赖 父 重渲
  const [draft, setDraft] = useState<MemoryDraft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  // v26.14-P7.1: 编辑 模式 state
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(draft.proposed_content);
  const [editedImportance, setEditedImportance] = useState<number>(draft.proposed_importance);
  const isReadonly = draft.status !== "pending";

  const startEdit = () => {
    setEditedContent(draft.proposed_content);
    setEditedImportance(draft.proposed_importance);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setShowReject(false);
  };
  const saveEdit = async (alsoApprove: boolean): Promise<boolean> => {
    const trimmed = editedContent.trim();
    if (!trimmed) {
      toast.error("内容 不能 为空");
      return false;
    }
    const patch: {
      proposed_content?: string;
      proposed_importance?: number;
    } = {};
    if (trimmed !== draft.proposed_content) patch.proposed_content = trimmed;
    if (Math.abs(editedImportance - draft.proposed_importance) > 1e-6) {
      patch.proposed_importance = editedImportance;
    }
    if (Object.keys(patch).length === 0 && !alsoApprove) {
      toast.info("没 改动");
      setEditing(false);
      return true;
    }
    setBusy(true);
    try {
      if (Object.keys(patch).length > 0) {
        const updated = await api.patchMemoryDraft(draft.id, patch);
        setDraft(updated);
      }
      if (alsoApprove) {
        await api.approveMemoryDraft(draft.id);
        toast.success("✅ 已 保存 编辑 + 批准 入库");
        onDone();
        return true;
      }
      toast.success("已 保存");
      setEditing(false);
      return true;
    } catch (e) {
      void e;
      return false;
    } finally {
      setBusy(false);
    }
  };

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
  // v26.14-P7.4: 拒绝 子 类型 — discard (弃用) | feedback (退回 LLM 必填 reason)
  const [rejectKind, setRejectKind] = useState<"discard" | "feedback">("discard");
  const doReject = async () => {
    const text = rejectReason.trim();
    if (rejectKind === "feedback") {
      if (text.length < 5) {
        toast.error("退回 LLM 时 反馈 必填 ≥ 5 字 (写 为什么 不准)");
        return;
      }
    }
    setBusy(true);
    try {
      await api.rejectMemoryDraft(draft.id, {
        kind: rejectKind,
        feedback_text: rejectKind === "feedback" ? text : undefined,
        reason: rejectKind === "discard" ? text || undefined : undefined,
      });
      toast.success(rejectKind === "feedback" ? "已 退回 LLM (将累积 给 后续 抽取 当 反例)" : "已 弃用");
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
            {/* v26.14-P7.3: 出处 链回 — 审批 时 一键 跳 实录 看 上下文 */}
            <SourceLineChip
              meetingId={draft.source_meeting_id}
              lineIds={draft.source_line_ids ?? null}
            />
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
            <div className="flex items-center justify-between">
              <div className="text-xs text-zinc-500">拟写入内容</div>
              {/* v26.14-P7.1: 编辑 按钮 — 仅 pending + 没在 编辑 + 没 在 驳回 模式 显 */}
              {!isReadonly && !editing && !showReject && (
                <button
                  type="button"
                  onClick={startEdit}
                  data-testid="memdraft-edit"
                  className="text-[11px] text-accent-400 hover:text-accent-300"
                  title="LLM 抽 的 不准? 改 一下 再 通过"
                >
                  ✏️ 编辑
                </button>
              )}
            </div>
            {editing ? (
              <>
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  rows={6}
                  data-testid="memdraft-content-edit"
                  className="mt-1 w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-accent-500 focus:outline-none"
                  placeholder="改 表达 / 修主语 / 改 时间 等. 留空 不允许 通过."
                />
                <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>scope: {draft.proposed_scope} (此版 暂不 改)</span>
                  <label className="flex items-center gap-1.5">
                    <span>重要度:</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={editedImportance}
                      onChange={(e) => setEditedImportance(parseFloat(e.target.value))}
                      className="w-20"
                    />
                    <span className="font-mono text-zinc-400">{editedImportance.toFixed(2)}</span>
                  </label>
                </div>
              </>
            ) : (
              <>
                <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-200">
                  {draft.proposed_content}
                </pre>
                <div className="mt-2 flex gap-3 text-[11px] text-zinc-500">
                  <span>scope: {draft.proposed_scope}</span>
                  <span>重要度: {draft.proposed_importance.toFixed(1)}</span>
                </div>
              </>
            )}
          </div>
          {!isReadonly &&
            (editing ? (
              // v26.14-P7.1: 编辑 模式 按钮 — 保存+通过 / 仅保存 / 取消
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveEdit(true)}
                  disabled={busy}
                  data-testid="memdraft-save-and-approve"
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-emerald-400"
                >
                  {busy ? "处理中…" : "✓ 保存 并 通过"}
                </button>
                <button
                  type="button"
                  onClick={() => saveEdit(false)}
                  disabled={busy}
                  className="rounded-lg border border-accent-500/40 bg-accent-500/10 px-4 py-2 text-sm text-accent-200 hover:bg-accent-500/20 disabled:opacity-50"
                >
                  仅 保存
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800 disabled:opacity-50"
                >
                  取消 编辑
                </button>
              </div>
            ) : showReject ? (
              // v26.14-P7.4: 拒绝 二选一 — 弃用 vs 退回 LLM
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-700 bg-ink-950/40 p-3 hover:border-zinc-600">
                    <input
                      type="radio"
                      name="reject_kind"
                      value="discard"
                      checked={rejectKind === "discard"}
                      onChange={() => setRejectKind("discard")}
                      className="mt-0.5 accent-rose-400"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-zinc-100">🗑 弃用 — 这条 没意义</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        简短 注释 (选填). 这条 仅 标记 弃用, 不影响 LLM 后续 抽取.
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-700 bg-ink-950/40 p-3 hover:border-zinc-600">
                    <input
                      type="radio"
                      name="reject_kind"
                      value="feedback"
                      checked={rejectKind === "feedback"}
                      onChange={() => setRejectKind("feedback")}
                      className="mt-0.5 accent-amber-400"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-zinc-100">↩ 退回 LLM 重抽 — 写 反馈 (≥ 5 字)</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        反馈 会 累积 给 后续 抽取 当 反例 (例: "主语 不对, 张三 不是 反对方").
                      </div>
                    </div>
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="text-xs text-zinc-500">
                    {rejectKind === "feedback"
                      ? "反馈 内容 (必填, 写 为什么 不准 / 错在哪)"
                      : "弃用 注释 (可选)"}
                  </span>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    data-testid="memdraft-reject-text"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                    placeholder={
                      rejectKind === "feedback"
                        ? "例: 主语 不对, 张三 不是 反对方, 是 对 X 部分 有 顾虑"
                        : "例: 这条事实 有歧义"
                    }
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={doReject}
                    disabled={busy}
                    data-testid="memdraft-reject-confirm"
                    className={
                      rejectKind === "feedback"
                        ? "rounded-lg bg-amber-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-amber-400"
                        : "rounded-lg bg-rose-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-rose-400"
                    }
                  >
                    {busy
                      ? "处理中…"
                      : rejectKind === "feedback"
                      ? "↩ 确认 退回 LLM"
                      : "🗑 确认 弃用"}
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
