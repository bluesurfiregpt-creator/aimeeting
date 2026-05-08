"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ProviderCatalogEntry,
  type ProviderConfig,
} from "@/lib/api";

type Form = {
  api_key: string;
  base_url: string;
  model_id: string;
  is_active: boolean;
  note: string;
};

const EMPTY_FORM: Form = {
  api_key: "",
  base_url: "",
  model_id: "",
  is_active: false,
  note: "",
};

type ModelOption = { id: string; label?: string | null };

export default function ModelsAdmin() {
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [forms, setForms] = useState<Record<string, Form>>({});
  // Per-provider list of models pulled live via /list-models. Keyed by
  // provider name. Only populated when the user clicks 拉取模型列表;
  // otherwise the Model ID field stays as free-text.
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Separate busy state for the list-models call so saving and listing
  // can't both spin the same button.
  const [listing, setListing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const [c, cfgs] = await Promise.all([api.providerCatalog(), api.listProviderConfigs()]);
    setCatalog(c);
    setConfigs(cfgs);
    const next: Record<string, Form> = {};
    for (const sp of c) {
      const existing = cfgs.find((x) => x.provider === sp.name);
      next[sp.name] = {
        api_key: "",
        base_url: existing?.base_url ?? sp.default_base_url,
        model_id: existing?.model_id ?? sp.default_model,
        is_active: existing?.is_active ?? false,
        note: existing?.note ?? "",
      };
    }
    setForms(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (provider: string) => {
    const f = forms[provider];
    if (!f) return;
    if (!f.api_key) {
      setMsg("请填写 API Key 后再保存");
      return;
    }
    setBusy(provider);
    setMsg("");
    try {
      await api.saveProviderConfig(provider, {
        provider,
        api_key: f.api_key,
        base_url: f.base_url || undefined,
        model_id: f.model_id || undefined,
        is_active: f.is_active,
        note: f.note || undefined,
      });
      setMsg(`✅ ${provider} 已保存`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const activate = async (provider: string) => {
    setBusy(provider);
    try {
      await api.activateProvider(provider);
      setMsg(`✅ ${provider} 已设为默认`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "切换失败");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: string) => {
    if (!confirm(`确认删除 ${provider} 的配置？`)) return;
    setBusy(provider);
    try {
      await api.deleteProviderConfig(provider);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  /**
   * Pull live models for one provider. We use whichever API key the user has
   * typed in the form right now (preferred — they may be testing a new key)
   * and only fall back to a hint to type one if they haven't.
   */
  const fetchModels = async (provider: string) => {
    const f = forms[provider];
    if (!f) return;
    if (!f.api_key) {
      setMsg("请先在「API Key」里粘贴 key,再拉取模型列表");
      return;
    }
    setListing(provider);
    setMsg("");
    try {
      const r = await api.listProviderModels(provider, {
        api_key: f.api_key,
        base_url: f.base_url || undefined,
      });
      setModels((prev) => ({ ...prev, [provider]: r.models }));
      // Auto-select current model_id if it appears in the new list, else
      // pick the first one. This lets the dropdown have something selected.
      if (r.models.length > 0) {
        const current = forms[provider]?.model_id;
        const stillThere = current && r.models.some((m) => m.id === current);
        if (!stillThere) {
          setForms((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], model_id: r.models[0].id },
          }));
        }
        setMsg(`✅ ${provider} 拉到 ${r.models.length} 个模型`);
      } else {
        setMsg(`⚠️ ${provider} 返回空列表 — 你可能要用其他 key 或 Base URL`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? `❌ 拉取失败:${e.message}` : "拉取失败");
    } finally {
      setListing(null);
    }
  };

  const clearModels = (provider: string) => {
    setModels((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
  };

  return (
    <div>
      <p className="text-sm text-zinc-500">
        配置不同 LLM 供应商的 API Key 和默认模型。**勾选「设为默认」**的那一个会被会议纪要、长期记忆抽取等直接调用。Dify 内部会用自己配置的模型，与此处独立。
      </p>
      {msg && <p className="mt-3 text-sm text-zinc-300">{msg}</p>}

      <div className="mt-6 space-y-4">
        {catalog.map((sp) => {
          const cfg = configs.find((c) => c.provider === sp.name);
          const f = forms[sp.name] ?? EMPTY_FORM;
          const update = (k: keyof Form, v: string | boolean) =>
            setForms((prev) => ({ ...prev, [sp.name]: { ...prev[sp.name], [k]: v } }));

          return (
            <section
              key={sp.name}
              className={`rounded-xl border p-5 ${
                cfg?.is_active
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-ink-700 bg-ink-900"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-medium text-white">{sp.label}</span>
                    {cfg?.is_active && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                        当前默认
                      </span>
                    )}
                    {cfg && !cfg.is_active && (
                      <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
                        已配置 {cfg.masked_key}
                      </span>
                    )}
                  </div>
                  <a
                    href={sp.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-zinc-500 hover:text-accent-400"
                  >
                    {sp.api_key_help} ↗
                  </a>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="API Key"
                  placeholder={cfg ? "(粘贴新 key 即可覆盖)" : "必填"}
                  value={f.api_key}
                  onChange={(v) => update("api_key", v)}
                  type="password"
                />
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Model ID</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fetchModels(sp.name)}
                        disabled={listing === sp.name || !f.api_key}
                        className="text-xs text-accent-400 hover:text-accent-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={!f.api_key ? "先填 API Key" : "用当前 Key 调 /models 接口拉取列表"}
                      >
                        {listing === sp.name ? "拉取中…" : "拉取模型列表 ↻"}
                      </button>
                      {models[sp.name] && (
                        <button
                          type="button"
                          onClick={() => clearModels(sp.name)}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                          title="改回手动填写"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  {models[sp.name] && models[sp.name].length > 0 ? (
                    <select
                      value={f.model_id}
                      onChange={(e) => update("model_id", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                    >
                      {models[sp.name].map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label ? `${m.id} — ${m.label}` : m.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={f.model_id}
                      placeholder={sp.default_model}
                      onChange={(e) => update("model_id", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
                    />
                  )}
                </div>
                <Field
                  label="Base URL"
                  value={f.base_url}
                  placeholder={sp.default_base_url}
                  onChange={(v) => update("base_url", v)}
                />
                <Field
                  label="备注（可选）"
                  value={f.note}
                  onChange={(v) => update("note", v)}
                />
              </div>

              <label className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={f.is_active}
                  onChange={(e) => update("is_active", e.target.checked)}
                  className="h-4 w-4 accent-accent-500"
                />
                设为默认（仅一个 provider 可同时为默认）
              </label>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => save(sp.name)}
                  disabled={busy === sp.name}
                  className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
                >
                  {busy === sp.name ? "保存中..." : "保存"}
                </button>
                {cfg && !cfg.is_active && (
                  <button
                    onClick={() => activate(sp.name)}
                    disabled={busy === sp.name}
                    className="rounded-lg border border-emerald-500/40 px-4 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 transition"
                  >
                    设为默认
                  </button>
                )}
                {cfg && (
                  <button
                    onClick={() => remove(sp.name)}
                    disabled={busy === sp.name}
                    className="ml-auto rounded-lg border border-rose-500/30 px-4 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10 transition"
                  >
                    删除
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
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
    <label className="block">
      <span className="block text-xs text-zinc-500">{label}</span>
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
