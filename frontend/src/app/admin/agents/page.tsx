"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type KnowledgeBase } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

type Form = {
  name: string;
  domain: string;
  persona: string;
  keywords: string;        // comma separated for input
  color: string;
  knowledge_base_ids: Set<string>;
  is_active: boolean;
};

const EMPTY: Form = {
  name: "",
  domain: "",
  persona: "",
  keywords: "",
  color: "violet",
  knowledge_base_ids: new Set<string>(),
  is_active: true,
};

const COLORS = ["violet", "sky", "emerald", "amber", "rose", "teal"];

export default function AgentsAdmin() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  // {id, name} of the agent the user is being asked to confirm deletion for.
  // null = no dialog open.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const [as_, ks] = await Promise.all([
      api.listAgents(),
      api.listKnowledgeBases().catch(() => [] as KnowledgeBase[]),
    ]);
    setAgents(as_);
    setKbs(ks);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => { setForm({ ...EMPTY, knowledge_base_ids: new Set() }); setEditing(null); setMsg(""); };

  const startEdit = (a: Agent) => {
    setEditing(a.id);
    setForm({
      name: a.name,
      domain: a.domain ?? "",
      persona: a.persona ?? "",
      keywords: (a.keywords ?? []).join(", "),
      color: a.color ?? "violet",
      knowledge_base_ids: new Set<string>(a.knowledge_base_ids ?? []),
      is_active: a.is_active,
    });
    setMsg("");
  };

  const toggleKb = (kbId: string) => {
    const next = new Set(form.knowledge_base_ids);
    next.has(kbId) ? next.delete(kbId) : next.add(kbId);
    setForm({ ...form, knowledge_base_ids: next });
  };

  const save = async () => {
    if (!form.name.trim()) { setMsg("请填写 Agent 名称"); return; }
    setBusy(true);
    setMsg("");
    const body = {
      name: form.name.trim(),
      domain: form.domain || null,
      persona: form.persona || null,
      keywords: form.keywords ? form.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
      color: form.color,
      knowledge_base_ids: Array.from(form.knowledge_base_ids),
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await api.updateAgent(editing, body);
        setMsg("✅ 已更新");
      } else {
        await api.createAgent(body);
        setMsg("✅ 已创建");
        reset();
      }
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string, name: string) => {
    setConfirmDelete({ id, name });
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.deleteAgent(id);
      await refresh();
      if (editing === id) reset();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "删除失败");
    }
  };

  // v24.1: 智慧住建 16 AI 专家 + 1:1 KB 一键 seed(幂等)
  const [seedingSC, setSeedingSC] = useState(false);
  const seedSmartConstruction = async () => {
    if (seedingSC) return;
    if (
      !confirm(
        "将为本工作空间一键 seed 智慧住建 16 AI 专家(15 业务 + 1 住建智脑)+ 1:1 知识库。\n" +
        "已存在的同名 Agent / KB 会跳过(幂等)。\n继续?",
      )
    )
      return;
    setSeedingSC(true);
    try {
      const r = await api.seedSmartConstructionAgents();
      toast.success(
        `🏗️ 已 seed:Agent ${r.agents_created} 新增 / ${r.agents_skipped} 跳过 · ` +
          `KB ${r.kbs_created} 新增 / ${r.kbs_skipped} 跳过` +
          (r.preset_set ? "(workspace.preset 已设为 smart_construction)" : ""),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "seed 失败");
    } finally {
      setSeedingSC(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* v24.1: 智慧住建一键 seed banner */}
      <section
        className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        data-testid="sc-agents-seed-banner"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>🏗️</span>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-amber-200">
              智慧住建场景 · 一键 seed 16 AI 专家
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              福田区住建局 16 节点 — 15 业务 AI(综合事务/法制/房地产/公共住房/保障/建筑业/房屋安全/物业/建设科技/消防人防/城市更新规划/土地整备/城市更新项目/质量安全/住建土地)+ 1 住建智脑.
              <br />
              幂等可重跑,不会覆盖现有同名 Agent / KB.
            </p>
            <button
              type="button"
              onClick={seedSmartConstruction}
              disabled={seedingSC}
              data-testid="sc-agents-seed-btn"
              className="mt-3 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950 shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-400 transition"
            >
              {seedingSC ? "正在 seed…" : "一键 seed 智慧住建 16 AI"}
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <h2 className="text-sm font-medium text-zinc-300">
            {editing ? "编辑 Agent" : "新建 Agent"}
          </h2>
        <div className="mt-4 space-y-3">
          <Field label="名称（会议中用 @<名称> 召唤）" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="产品专家" />
          <Field label="领域" value={form.domain} onChange={(v) => setForm({ ...form, domain: v })} placeholder="产品 / 法务 / 架构 ..." />
          <TextArea label="人格 / 背景说明" value={form.persona} onChange={(v) => setForm({ ...form, persona: v })} placeholder="你是一名资深产品经理，重点关注用户价值与商业逻辑..." />
          <Field label="关键词（逗号分隔，命中即被触发）" value={form.keywords} onChange={(v) => setForm({ ...form, keywords: v })} placeholder="需求, 用户价值, MVP" />

          <div>
            <span className="text-xs text-zinc-500">颜色（气泡）</span>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-7 w-7 rounded-full border ${
                    form.color === c ? "border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: cssColor(c) }}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs text-zinc-500">
            🤖 Agent 默认使用{" "}
            <a href="/admin/models" className="text-accent-400 hover:text-accent-500">「LLM 模型」</a>{" "}
            页配置的默认模型(当前工作空间生效)。无需在此处单独配置 API Key。
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-950 p-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              知识库（可选 · Agent 回答时优先引用）
            </div>
            {kbs.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">
                还没有知识库。先去{" "}
                <a href="/admin/knowledge" className="text-accent-400 hover:text-accent-500">
                  「知识库」
                </a>{" "}
                创建并上传文档。
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {kbs.map((kb) => {
                  const checked = form.knowledge_base_ids.has(kb.id);
                  return (
                    <li key={kb.id}>
                      <label
                        className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                          checked
                            ? "border-accent-500 bg-accent-500/10"
                            : "border-ink-700 bg-ink-950 hover:border-ink-700"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-white">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleKb(kb.id)}
                            className="h-4 w-4 accent-accent-500"
                          />
                          {kb.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {kb.document_count} 文档 · {kb.chunk_count} 分块
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 accent-accent-500"
            />
            启用
          </label>

          <div className="mt-4 flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
            >
              {busy ? "保存中..." : editing ? "更新" : "创建"}
            </button>
            {editing && (
              <button
                onClick={reset}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800 transition"
              >
                取消
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-zinc-400">{msg}</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-300">已有 Agent</h2>
        {agents.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">还没有，先在左侧新建一个。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {agents.map((a) => (
              <li key={a.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: cssColor(a.color ?? "violet") }}
                    />
                    <span className="font-medium text-white">{a.name}</span>
                    {!a.is_active && (
                      <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">已停用</span>
                    )}
                    {a.role === "moderator" && (
                      <span
                        className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
                        title="工作空间内置主持人,用于自动议程监督。建议保留。"
                      >
                        🛡 内置主持人
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(a)} className="text-xs text-zinc-400 hover:text-white">编辑</button>
                    {a.role === "moderator" ? (
                      <span className="text-xs text-zinc-700" title="内置主持人不可删除">🔒</span>
                    ) : (
                      <button onClick={() => remove(a.id, a.name)} className="text-xs text-rose-400 hover:text-rose-300">删除</button>
                    )}
                  </div>
                </div>
                {a.domain && <div className="mt-1 text-xs text-zinc-500">{a.domain}</div>}
                {a.persona && <p className="mt-2 text-xs text-zinc-400 line-clamp-2">{a.persona}</p>}
                {a.keywords && a.keywords.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.keywords.map((k) => (
                      <span key={k} className="rounded bg-ink-800 px-2 py-0.5 text-xs text-zinc-400">
                        {k}
                      </span>
                    ))}
                  </div>
                )}
                {a.knowledge_base_ids && a.knowledge_base_ids.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    📚 已绑定 {a.knowledge_base_ids.length} 个知识库
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

        <ConfirmDialog
          open={confirmDelete !== null}
          title="确认删除 Agent？"
          body={
            <>
              将删除「<span className="text-white">{confirmDelete?.name}</span>」。
              该 Agent 在所有会议中的历史发言记录会保留，但今后无法再被召唤。
            </>
          }
          confirmLabel="删除"
          danger
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </div>
  );
}

function cssColor(name: string): string {
  // Tailwind color hex approximations for the swatches
  return ({
    violet: "#8b5cf6",
    sky: "#38bdf8",
    emerald: "#34d399",
    amber: "#fbbf24",
    rose: "#fb7185",
    teal: "#2dd4bf",
  } as Record<string, string>)[name] ?? "#8b5cf6";
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-zinc-500">{label}</span>
      <textarea
        rows={4}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
      />
    </label>
  );
}
