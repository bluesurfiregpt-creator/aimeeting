"use client";

// v26.13.2: Perplexity 抓取 触发 modal — 两个场景 共用:
//   1. KB 管理页 → "✨ AI 帮我补充" 按钮 (无 prefill)
//   2. 私聊 答不出 → "📚 用 Perplexity 补充" (prefill kb_id + 用户最近问题)
//
// 行为:
//   - 用户 输 query (或 prefill)
//   - 选 时效 (any / 月 / 周)
//   - 后端 调 Perplexity → 1 篇 synth + citations → 沉淀草稿
//   - 跳 审批中心 看草稿
//
// 风格: 复用 首页 hero CTA 的 紫色 流动渐变 (animate-ai-flow)

import { useEffect, useState } from "react";
import { api, type Agent, type KnowledgeBase } from "@/lib/api";
import { toast } from "@/lib/toast";

type Recency = "any" | "month" | "week";

export function PerplexityFetchModal({
  kbId,
  agentId,
  prefilledQuery,
  onClose,
}: {
  kbId: string;
  agentId?: string;            // 私聊 闭环 时 已知; KB 页 触发 时 让 用户 选
  prefilledQuery?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(prefilledQuery || "");
  const [recency, setRecency] = useState<Recency>("any");
  const [busy, setBusy] = useState(false);
  // KB-page 入口 没传 agent → 拉 该 KB 绑的 agents 让 用户 选
  const [agentChoices, setAgentChoices] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agentId || "");
  const [kbInfo, setKbInfo] = useState<KnowledgeBase | null>(null);
  // 配额 信息 (上一次 调用 拿到, 给用户参考)
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  // 拉 KB 信息 + 候选 agents
  useEffect(() => {
    if (agentId) {
      setSelectedAgentId(agentId);
    }
    api.listKnowledgeBases().then((kbs) => {
      const kb = kbs.find((k) => k.id === kbId);
      setKbInfo(kb || null);
    }).catch(() => {});

    // KB 页 触发 (无 agentId) → 拉 workspace agents, 用户 自己 选
    if (!agentId) {
      api.listAgents({ active_only: true }).then((rows) => {
        // 优先 显 该 KB.owner_agent 或 包含 此 KB 的 agents
        // 简化: 显 全部 active agents, 用户 自己 选
        setAgentChoices(rows);
        // 默认 选 第一个 有 primary_user 的 agent (没 primary_user 后端 会 reject)
        const firstWithMgr = rows.find((a) => !!a.primary_user_id);
        if (firstWithMgr) setSelectedAgentId(firstWithMgr.id);
      }).catch(() => {});
    }
  }, [kbId, agentId]);

  const submit = async () => {
    const q = query.trim();
    if (q.length < 3) {
      toast.warn("查询 至少 3 个字");
      return;
    }
    if (!selectedAgentId) {
      toast.warn("请 选 触发该抓取的 AI 专家 (用于 溯源 + 配额 ABAC)");
      return;
    }
    setBusy(true);
    try {
      const r = await api.perplexityFetch({
        kb_id: kbId,
        agent_id: selectedAgentId,
        query: q,
        recency: recency === "any" ? null : recency,
      });
      setQuotaRemaining(r.quota_remaining);
      if (r.drafts_created > 0) {
        toast.success(
          `✅ 已抓 ${r.drafts_created} 篇, 等待 manager 审批`,
          { detail: r.primary_url ? `来源: ${r.primary_url.slice(0, 60)}` : undefined },
        );
        onClose();
      } else if (r.drafts_skipped_dedup > 0) {
        toast.warn(
          "📚 KB 中 已有 类似 资料, 本次 跳过 (去重)",
          { detail: "如果 你 想 强制 入库, 改 query 再 试" },
        );
      } else {
        toast.info(`抓取 完成 但 没 入草稿 (剩余 配额: ${r.quota_remaining})`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      toast.error("Perplexity 抓取失败", { detail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl p-[2px] shadow-2xl shadow-violet-500/30"
      >
        {/* AI 紫色 流动 描边 (跟 首页 hero CTA / agent banner 一套) */}
        <span aria-hidden className="absolute inset-0 rounded-2xl animate-ai-flow" />
        <div className="relative rounded-[14px] bg-ink-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <span className="text-lg animate-ai-sparkle">✨</span>
              AI 帮 我 补充 知识
            </h2>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="关闭"
              disabled={busy}
            >
              ✕
            </button>
          </div>

          {/* 入 哪 个 KB — 只显, 不可改 (调用方 已 指定) */}
          {kbInfo && (
            <div className="mb-3 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-zinc-400">
              📚 入 KB: <span className="text-zinc-200">{kbInfo.name}</span>
            </div>
          )}

          {/* Agent 选 (KB 页 入口 时 显; 私聊 入口 已 prefill) */}
          {!agentId && agentChoices.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-zinc-500">触发的 AI 专家 (用于 溯源)</div>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                disabled={busy}
              >
                {agentChoices.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.primary_user_id}>
                    {a.nickname?.trim() || a.name}
                    {!a.primary_user_id ? " (未绑 primary_user, 无人审批)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-3">
            <div className="text-xs text-zinc-500">
              描述 你 想 让 AI 抓取 什么 资料
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              placeholder="例: 帮 我 找 危房 鉴定 三级标准 最新文件"
              className="mt-1 w-full resize-none rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
              disabled={busy}
            />
          </div>

          <div className="mb-3">
            <div className="text-xs text-zinc-500">时效 (可选)</div>
            <div className="mt-1 inline-flex rounded-lg border border-ink-700 bg-ink-950 p-0.5 text-xs">
              {(["any", "month", "week"] as Recency[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRecency(r)}
                  disabled={busy}
                  className={`rounded-md px-3 py-1 transition ${
                    recency === r
                      ? "bg-violet-500 text-white shadow"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {r === "any" ? "不限" : r === "month" ? "近 1 月" : "近 1 周"}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-200">
            ℹ️ 每次 抓取 消耗 1 次 workspace 月配额. 抓回来 走 沉淀草稿 →
            manager 审批 → 入 KB. 跟 现有 同名/同义 内容 自动 去重.
            {quotaRemaining !== null && (
              <div className="mt-1 text-zinc-400">
                本月剩余: <span className="text-zinc-200">{quotaRemaining}</span> 次
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={busy || query.trim().length < 3 || !selectedAgentId}
              className="rounded-lg bg-violet-500 px-4 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-violet-400"
            >
              {busy ? "抓取中... (10-30s)" : "✨ 开始抓取"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
