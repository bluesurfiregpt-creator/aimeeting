"use client";

/**
 * v25-3 — 数据访问申请审批页(智慧住建文档 §2.3 跨 AI 共享审批).
 *
 * leader / admin 视角:看 workspace 全部 pending,可 approve / reject.
 * approve 时可选授权窗口 1-720 小时(默认 24).
 */

import { useCallback, useEffect, useState } from "react";
import { api, type AccessRequest } from "@/lib/api";
import { toast } from "@/lib/toast";

const STATUS_LABEL: Record<AccessRequest["status"], string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  expired: "已过期",
};

const STATUS_TONE: Record<AccessRequest["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-rose-500/15 text-rose-300",
  expired: "bg-zinc-700/40 text-zinc-400",
};

const TARGET_LABEL: Record<AccessRequest["target_resource_type"], string> = {
  task: "任务",
  kb_document: "知识库文档",
  memory: "长期记忆",
  agent: "AI 专家",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export default function AccessRequestsAdmin() {
  const [items, setItems] = useState<AccessRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<Record<string, number>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rs = await api.listMyAccessRequests("reviewer", filter, 100);
      setItems(rs);
    } catch (e) {
      toast.error(`加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approve = async (id: string) => {
    const hours = windowHours[id] ?? 24;
    if (hours < 1 || hours > 720) {
      toast.error("授权窗口 1-720 小时");
      return;
    }
    setBusy(id);
    try {
      await api.approveAccessRequest(id, hours);
      toast.success(`✅ 已通过(有效 ${hours}h)`);
      await refresh();
    } catch (e) {
      toast.error(`通过失败: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    const reason = (rejectReason[id] || "").trim();
    if (!reason) {
      if (!confirm("没填驳回理由,确定继续?")) return;
    }
    setBusy(id);
    try {
      await api.rejectAccessRequest(id, reason || null);
      toast.success("✅ 已驳回");
      await refresh();
    } catch (e) {
      toast.error(`驳回失败: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">数据访问申请</h2>
          <p className="mt-1 text-sm text-zinc-400">
            智慧住建文档 §2.3 跨 AI 共享审批 — 敏感 / 重要 / 核心数据被申请访问时,在这里通过或驳回.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("pending")}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              filter === "pending"
                ? "bg-amber-500/20 text-amber-200"
                : "bg-ink-800 text-zinc-400 hover:bg-ink-700"
            }`}
          >
            待审批
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              filter === "all"
                ? "bg-violet-500/20 text-violet-200"
                : "bg-ink-800 text-zinc-400 hover:bg-ink-700"
            }`}
          >
            全部
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-8 text-center">
          <div className="text-4xl">📋</div>
          <p className="mt-3 text-sm text-zinc-400">
            {filter === "pending"
              ? "目前没有待审批的访问申请."
              : "还没有任何申请记录."}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            当 expert / member 试图访问超出权限范围的敏感资源时,他们会发起申请,在这里出现.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-ink-700 bg-ink-900 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_TONE[r.status]
                      }`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {TARGET_LABEL[r.target_resource_type]}{" "}
                      <code className="rounded bg-ink-950/60 px-1 text-[10px] text-zinc-400">
                        {r.target_resource_id.slice(0, 8)}…
                      </code>
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-zinc-300">
                    申请人 ID:
                    <code className="ml-1 rounded bg-ink-950/60 px-1 text-[10px] text-zinc-400">
                      {r.requester_user_id.slice(0, 8)}…
                    </code>
                    <span className="mx-2 text-zinc-700">·</span>
                    创建于 {fmt(r.created_at)}
                  </div>
                  {r.justification && (
                    <div className="mt-2 rounded-lg bg-ink-950/60 px-3 py-2 text-sm text-zinc-300">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                        申请理由
                      </div>
                      {r.justification}
                    </div>
                  )}
                  {r.status !== "pending" && (
                    <div className="mt-2 text-xs text-zinc-500">
                      决定于 {fmt(r.decided_at)}
                      {r.expires_at && ` · 有效至 ${fmt(r.expires_at)}`}
                      {r.decision_reason && (
                        <div className="mt-1 italic text-zinc-400">
                          理由:{r.decision_reason}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {r.status === "pending" && (
                  <div className="flex flex-col gap-2 sm:w-72">
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                      <label className="shrink-0 text-xs text-emerald-200">
                        授权
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={windowHours[r.id] ?? 24}
                        onChange={(e) =>
                          setWindowHours((m) => ({
                            ...m,
                            [r.id]: parseInt(e.target.value || "24", 10),
                          }))
                        }
                        className="w-16 rounded bg-ink-950/60 px-2 py-0.5 text-sm text-emerald-200"
                      />
                      <span className="text-xs text-emerald-300">小时</span>
                      <button
                        onClick={() => approve(r.id)}
                        disabled={busy === r.id}
                        className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {busy === r.id ? "…" : "✅ 通过"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
                      <input
                        type="text"
                        placeholder="驳回理由(选填)"
                        value={rejectReason[r.id] || ""}
                        onChange={(e) =>
                          setRejectReason((m) => ({
                            ...m,
                            [r.id]: e.target.value,
                          }))
                        }
                        className="flex-1 rounded bg-ink-950/60 px-2 py-0.5 text-xs text-rose-200 placeholder-rose-500/40"
                      />
                      <button
                        onClick={() => reject(r.id)}
                        disabled={busy === r.id}
                        className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
                      >
                        {busy === r.id ? "…" : "❌ 驳回"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
