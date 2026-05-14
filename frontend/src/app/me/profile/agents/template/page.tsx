"use client";

/**
 * v26.6-01 · AI 模板生成器
 *
 * 用户流程:
 *   1. 输入一段场景描述 + 数量 + 是否要 KB/Memory 种子
 *   2. 点 "生成预览" → 后端调 LLM → 返回 N 个 agent draft
 *   3. 用户可在预览页 编辑 / 删除 / 添加
 *   4. 点 "一键创建" → 后端批量真创建 + 种子 KB Doc + Memory
 *   5. 跳到 /me/profile/agents 看新建的 AI 列表
 *
 * ABAC: 仅 owner / admin / leader 可用 (后端 require_leader_or_admin).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AgentTemplateDraft, type Me, type TeamMember } from "@/lib/api";
import { toast } from "@/lib/toast";

const COLORS = ["violet", "sky", "emerald", "amber", "rose", "teal"];
const FULL_ADMIN = new Set(["owner", "admin", "leader"]);

type Stage = "input" | "previewing" | "preview" | "committing" | "done";

export default function AgentTemplatePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [stage, setStage] = useState<Stage>("input");
  // Input form
  const [scenario, setScenario] = useState("");
  const [count, setCount] = useState(5);
  const [withKbSeed, setWithKbSeed] = useState(true);
  const [withMemorySeed, setWithMemorySeed] = useState(true);
  // Preview state
  const [drafts, setDrafts] = useState<AgentTemplateDraft[]>([]);
  // managers 列表 (用来 auto-assign primary_user, 也可手动选)
  const [managers, setManagers] = useState<TeamMember[]>([]);
  const [selectedManagerIds, setSelectedManagerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.listMembers()
      .then((rows) => {
        const mgrs = rows.filter(
          (m) => m.role === "manager" || m.role === "leader" || m.role === "admin" || m.role === "owner",
        );
        setManagers(mgrs);
      })
      .catch(() => setManagers([]));
  }, []);

  const isFullAdmin = me ? FULL_ADMIN.has(me.role) : false;
  if (me && !isFullAdmin) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6">
        <h2 className="text-lg font-medium text-rose-200">⛔ 权限不足</h2>
        <p className="mt-2 text-sm text-zinc-400">
          AI 模板生成器 仅 owner / admin / leader 可用. 联系 owner 启用此功能.
        </p>
      </div>
    );
  }

  const doPreview = async () => {
    if (scenario.trim().length < 10) {
      toast.warn("场景描述至少 10 字");
      return;
    }
    setStage("previewing");
    try {
      const r = await api.previewAgentTemplate({
        scenario_description: scenario.trim(),
        count,
        with_kb_seed: withKbSeed,
        with_memory_seed: withMemorySeed,
      });
      setDrafts(r.agents);
      setStage("preview");
    } catch {
      setStage("input");  // api.ts toast 已弹
    }
  };

  const doCommit = async () => {
    if (drafts.length === 0) return;
    setStage("committing");
    try {
      const r = await api.commitAgentTemplate({
        agents: drafts,
        candidate_manager_ids: Array.from(selectedManagerIds),
      });
      const skipCount = (r.skipped ?? []).length;
      if (skipCount > 0) {
        // v26.6-fix1: 同名跳过的提示
        const skipNames = (r.skipped ?? []).map((s) => s.name).join("、");
        toast.warn(
          `✅ 已创建 ${r.created.length} 个 / 跳过 ${skipCount} 个同名`,
          { detail: `跳过: ${skipNames}` },
        );
      } else {
        toast.success(`✅ 已创建 ${r.created.length} 个 AI 专家`);
      }
      setStage("done");
      setTimeout(() => router.push("/me/profile/agents"), 1500);
    } catch {
      setStage("preview");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-medium text-white">✨ AI 模板生成器</h2>
        <p className="mt-1 text-sm text-zinc-500">
          用 LLM 帮你一次性生成 N 个 AI 专家配置 (含人格 / 关键词 / 种子知识 / 种子记忆).
          针对不同行业 / 部门 一键装好.
        </p>
      </header>

      {/* Stage: input */}
      {(stage === "input" || stage === "previewing") && (
        <section className="space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-6">
          <h3 className="text-sm font-medium text-zinc-300">1. 描述你的场景</h3>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={6}
            placeholder={
              "例: 我是福田区住建局, 想建一组住建领域的 AI 专家, 包含: \n" +
              "- 房屋安全管理 (检查 / 报告 / 投诉处理)\n" +
              "- 物业监管\n" +
              "- 公共住房\n" +
              "- 城市更新规划\n" +
              "- 综合事务 (跨部门协调)"
            }
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-xs text-zinc-500">数量 (1-10)</span>
              <input
                type="number"
                min="1"
                max="10"
                value={count}
                onChange={(e) => setCount(Math.min(10, Math.max(1, parseInt(e.target.value || "1", 10) || 1)))}
                className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={withKbSeed}
                onChange={(e) => setWithKbSeed(e.target.checked)}
                className="accent-amber-500"
              />
              <span>📚 生成种子知识库</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={withMemorySeed}
                onChange={(e) => setWithMemorySeed(e.target.checked)}
                className="accent-violet-500"
              />
              <span>🧠 生成种子长期记忆</span>
            </label>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            ⏳ LLM 调用 大约需要 10-30 秒. 用 当前 workspace 的默认 LLM (在 系统配置 / LLM 模型 设置).
          </div>
          <button
            type="button"
            onClick={doPreview}
            disabled={stage === "previewing" || scenario.trim().length < 10}
            className="rounded-lg bg-accent-500 px-6 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400"
          >
            {stage === "previewing" ? "⏳ 生成中…" : "✨ 生成预览"}
          </button>
        </section>
      )}

      {/* Stage: preview */}
      {(stage === "preview" || stage === "committing" || stage === "done") && (
        <section className="space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-6">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">
              2. 预览 + 编辑 ({drafts.length} 个 AI)
            </h3>
            <button
              type="button"
              onClick={() => setStage("input")}
              disabled={stage !== "preview"}
              className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            >
              ← 重新生成
            </button>
          </header>
          {/* 分配 primary_user */}
          {managers.length > 0 && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="text-xs uppercase tracking-wider text-violet-300">
                🎯 自动分配 primary_user (可选)
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">
                勾选 候选 manager, 后端 round-robin 按 顺序 分配给 创建的 AI.
                不勾就 全部 leave 空, owner 后续手动 在 AI 列表 指派.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {managers.map((m) => (
                  <label
                    key={m.user_id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                      selectedManagerIds.has(m.user_id)
                        ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                        : "border-ink-700 bg-ink-950 text-zinc-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedManagerIds.has(m.user_id)}
                      onChange={() => {
                        setSelectedManagerIds((s) => {
                          const next = new Set(s);
                          if (next.has(m.user_id)) next.delete(m.user_id);
                          else next.add(m.user_id);
                          return next;
                        });
                      }}
                      className="accent-violet-500"
                    />
                    {m.name}
                    {m.department && ` · ${m.department}`}
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* 卡片列表 */}
          <ul className="space-y-3">
            {drafts.map((d, idx) => (
              <DraftCard
                key={idx}
                draft={d}
                disabled={stage !== "preview"}
                onChange={(updated) =>
                  setDrafts((arr) => arr.map((x, i) => (i === idx ? updated : x)))
                }
                onRemove={() => setDrafts((arr) => arr.filter((_, i) => i !== idx))}
              />
            ))}
            {drafts.length < 10 && stage === "preview" && (
              <li>
                <button
                  type="button"
                  onClick={() =>
                    setDrafts((arr) => [
                      ...arr,
                      {
                        name: "",
                        domain: null,
                        persona: null,
                        keywords: [],
                        color: COLORS[arr.length % COLORS.length],
                      },
                    ])
                  }
                  className="w-full rounded-xl border border-dashed border-ink-700 px-3 py-3 text-xs text-zinc-500 hover:border-accent-500/50 hover:text-zinc-300"
                >
                  + 手动添加一个空白 AI
                </button>
              </li>
            )}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doCommit}
              disabled={stage !== "preview" || drafts.length === 0}
              className="rounded-lg bg-emerald-500 px-6 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-emerald-400"
            >
              {stage === "committing"
                ? "⏳ 创建中…"
                : stage === "done"
                  ? "✅ 完成 (跳转中…)"
                  : `🚀 一键创建 ${drafts.length} 个 AI`}
            </button>
            <span className="text-xs text-zinc-500">
              创建后 跳到 AI 列表页
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

// ----- DraftCard --------------------------------------------------------------

function DraftCard({
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  draft: AgentTemplateDraft;
  disabled: boolean;
  onChange: (updated: AgentTemplateDraft) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const keywordsStr = (draft.keywords || []).join(", ");
  return (
    <li className="rounded-xl border border-ink-700 bg-ink-950/60 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: cssColor(draft.color) }}
            aria-hidden
          />
          <input
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="AI 名字"
            className="flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none disabled:opacity-60"
          />
          <input
            type="text"
            value={draft.domain ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, domain: e.target.value || null })}
            placeholder="领域"
            className="w-32 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "↑" : "↓"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50"
        >
          ✕
        </button>
      </header>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <label className="block">
            <span className="text-xs text-zinc-500">人格 / 背景</span>
            <textarea
              value={draft.persona ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, persona: e.target.value || null })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-white focus:border-accent-500 focus:outline-none disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">关键词 (逗号分隔)</span>
            <input
              type="text"
              value={keywordsStr}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...draft,
                  keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-white focus:border-accent-500 focus:outline-none disabled:opacity-60"
            />
          </label>
          <div>
            <span className="text-xs text-zinc-500">颜色</span>
            <div className="mt-1 flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...draft, color: c })}
                  className={`h-5 w-5 rounded-full border ${
                    draft.color === c ? "border-white" : "border-transparent"
                  } disabled:opacity-60`}
                  style={{ backgroundColor: cssColor(c) }}
                />
              ))}
            </div>
          </div>
          {draft.suggested_kb_seed && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2">
              <div className="text-[10px] uppercase tracking-wider text-sky-300">
                📚 种子 KB (创建时一并写入)
              </div>
              <textarea
                value={draft.suggested_kb_seed}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...draft, suggested_kb_seed: e.target.value || null })
                }
                rows={5}
                className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none disabled:opacity-60"
              />
            </div>
          )}
          {(draft.suggested_memory_seeds || []).length > 0 && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2">
              <div className="text-[10px] uppercase tracking-wider text-violet-300">
                🧠 种子 Memory ({(draft.suggested_memory_seeds || []).length} 条)
              </div>
              <ul className="mt-1 space-y-1">
                {(draft.suggested_memory_seeds || []).map((mem, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <input
                      type="text"
                      value={mem}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          suggested_memory_seeds: (draft.suggested_memory_seeds || []).map(
                            (m, j) => (j === i ? e.target.value : m),
                          ),
                        })
                      }
                      className="flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...draft,
                          suggested_memory_seeds: (draft.suggested_memory_seeds || []).filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                      disabled={disabled}
                      className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function cssColor(name: string | null | undefined): string {
  return (
    {
      violet: "#8b5cf6",
      sky: "#38bdf8",
      emerald: "#34d399",
      amber: "#fbbf24",
      rose: "#fb7185",
      teal: "#2dd4bf",
    } as Record<string, string>
  )[name ?? ""] ?? "#8b5cf6";
}
