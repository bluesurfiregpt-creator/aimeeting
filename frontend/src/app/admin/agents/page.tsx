"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Agent } from "@/lib/api";

type Form = {
  name: string;
  domain: string;
  persona: string;
  keywords: string;        // comma separated for input
  color: string;
  dify_app_type: string;
  dify_base_url: string;
  dify_api_key: string;
  is_active: boolean;
};

const EMPTY: Form = {
  name: "",
  domain: "",
  persona: "",
  keywords: "",
  color: "violet",
  dify_app_type: "chatflow",
  dify_base_url: "https://api.dify.ai",
  dify_api_key: "",
  is_active: true,
};

const COLORS = ["violet", "sky", "emerald", "amber", "rose", "teal"];

export default function AgentsAdmin() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    setAgents(await api.listAgents());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => { setForm(EMPTY); setEditing(null); setMsg(""); };

  const startEdit = (a: Agent) => {
    setEditing(a.id);
    setForm({
      name: a.name,
      domain: a.domain ?? "",
      persona: a.persona ?? "",
      keywords: (a.keywords ?? []).join(", "),
      color: a.color ?? "violet",
      dify_app_type: a.dify_app_type,
      dify_base_url: a.dify_base_url ?? "https://api.dify.ai",
      dify_api_key: "",  // never echoed
      is_active: a.is_active,
    });
    setMsg(a.has_dify_key ? "Dify Key 已配置；想换的话填新的覆盖。" : "");
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
      dify_app_type: form.dify_app_type,
      dify_base_url: form.dify_base_url,
      ...(form.dify_api_key ? { dify_api_key: form.dify_api_key } : {}),
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await api.updateAgent(editing, body);
        setMsg("✅ 已更新");
      } else {
        await api.createAgent({ ...body, dify_api_key: form.dify_api_key });
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

  const remove = async (id: string) => {
    if (!confirm("确认删除这个 Agent？")) return;
    await api.deleteAgent(id);
    await refresh();
    if (editing === id) reset();
  };

  return (
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

          <div className="mt-4 rounded-lg border border-ink-700 bg-ink-950 p-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Dify 连接（可选 · 留空则用「LLM 模型」页面配置的默认模型）</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-zinc-500">App 类型</span>
                <select
                  value={form.dify_app_type}
                  onChange={(e) => setForm({ ...form, dify_app_type: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                >
                  <option value="chatflow">chatflow / 聊天助手</option>
                  <option value="agent">agent</option>
                  <option value="workflow">workflow / 工作流</option>
                </select>
              </label>
              <Field
                label="Base URL"
                value={form.dify_base_url}
                onChange={(v) => setForm({ ...form, dify_base_url: v })}
              />
            </div>
            <div className="mt-2">
              <Field
                label="App API Key（在 Dify app → 「访问 API」获取，以 app- 开头）"
                value={form.dify_api_key}
                onChange={(v) => setForm({ ...form, dify_api_key: v })}
                placeholder={editing ? "(留空表示不修改)" : "app-xxxxxxxx"}
                type="password"
              />
            </div>
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
                    {!a.has_dify_key && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">缺 Dify Key</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(a)} className="text-xs text-zinc-400 hover:text-white">编辑</button>
                    <button onClick={() => remove(a.id)} className="text-xs text-rose-400 hover:text-rose-300">删除</button>
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
              </li>
            ))}
          </ul>
        )}
      </section>
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
