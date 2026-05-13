"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Me, type Memory } from "@/lib/api";
import { SkeletonList } from "@/components/Skeleton";

const SCOPE_LABEL: Record<string, { label: string; tone: string }> = {
  user: { label: "用户", tone: "bg-sky-500/15 text-sky-300" },
  project: { label: "项目", tone: "bg-violet-500/15 text-violet-300" },
  org: { label: "组织", tone: "bg-emerald-500/15 text-emerald-300" },
};

// v26.5: 长期记忆 写权限 仅 leader+, manager P1 后才能写自己 agent 的
const FULL_ADMIN_ROLES = new Set(["owner", "admin", "leader"]);

export default function MemoryAdmin() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [scope, setScope] = useState<string>("");
  const [scopeRef, setScopeRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    scope: "project",
    scope_ref: "",
    content: "",
    importance: 0.6,
  });
  const [msg, setMsg] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const isFullAdmin = me ? FULL_ADMIN_ROLES.has(me.role) : false;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listMemories(scope || undefined, scopeRef || undefined);
      setMemories(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [scope, scopeRef]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!form.content.trim()) {
      setMsg("内容必填");
      return;
    }
    setCreating(true);
    setMsg("");
    try {
      await api.createMemory({
        scope: form.scope,
        scope_ref: form.scope_ref || null,
        content: form.content.trim(),
        importance: form.importance,
      });
      setForm({ ...form, content: "" });
      setMsg("✅ 已写入");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "失败");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确认删除这条记忆？")) return;
    await api.deleteMemory(id);
    await refresh();
  };

  return (
    <div>
      <p className="text-sm text-zinc-500">
        长期记忆是 AI 跨会议引用的事实库。会后系统自动从纪要里抽取(决策/风险/待办/分歧)并入库；这里你也可以手工添加。AI 专家在会议中会基于关键词检索最相关的记忆,作为 system prompt 的一部分。
      </p>

      {/* Filter bar */}
      <section className="mt-6 flex items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white focus:border-accent-500 focus:outline-none"
        >
          <option value="">所有 scope</option>
          <option value="project">项目级</option>
          <option value="user">用户级</option>
          <option value="org">组织级</option>
        </select>
        <input
          type="text"
          value={scopeRef}
          onChange={(e) => setScopeRef(e.target.value)}
          placeholder="按 scope_ref 过滤(项目名/姓名)"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />
        <button
          onClick={refresh}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-ink-800 transition"
        >
          刷新
        </button>
      </section>

      {/* v26.5: 仅 leader+ 可写;manager 看到提示 */}
      {!isFullAdmin && me && (
        <section className="mt-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <h3 className="text-sm font-medium text-violet-200">
            👋 部门 AI 维护人视角({me.name})
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            长期记忆 写入 / 删除 需要 owner / admin / leader 权限.
            <br />
            v26.5-P1 后, 你 将能给 自己 primary 的 AI 写记忆.
          </p>
        </section>
      )}

      {/* New memory */}
      {isFullAdmin && (
      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-medium text-zinc-300">手工添加</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[120px_180px_1fr_100px_auto] sm:items-end">
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">scope</span>
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
            >
              <option value="project">project</option>
              <option value="user">user</option>
              <option value="org">org</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">scope_ref</span>
            <input
              type="text"
              value={form.scope_ref}
              onChange={(e) => setForm({ ...form, scope_ref: e.target.value })}
              placeholder="项目名/姓名(org 留空)"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">内容(单条事实)</span>
            <input
              type="text"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="例如:决定先做 AI 专家功能,声纹识别暂缓"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-zinc-500">重要度 0-1</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={form.importance}
              onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
            />
          </label>
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {creating ? "保存中..." : "添加"}
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-zinc-400">{msg}</p>}
      </section>
      )}

      {/* List */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-zinc-300">
          已记忆 {memories.length} 条
        </h2>
        {loading ? (
          <div className="mt-3">
            <SkeletonList rows={5} />
          </div>
        ) : memories.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">
            还没有记忆。开几场会、生成纪要,或手工添加几条试试。
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {memories.map((m) => {
              const tone = SCOPE_LABEL[m.scope] ?? SCOPE_LABEL.org;
              return (
                <li
                  key={m.id}
                  className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`rounded-full px-2 py-0.5 ${tone.tone}`}>
                          {tone.label}
                        </span>
                        {m.scope_ref && (
                          <span className="rounded bg-ink-800 px-2 py-0.5 text-zinc-400">
                            {m.scope_ref}
                          </span>
                        )}
                        <span className="text-zinc-600">
                          重要度 {m.importance.toFixed(1)}
                        </span>
                        <span className="text-zinc-600">
                          来源: {m.source_type ?? "—"}
                        </span>
                        <span className="text-zinc-600">
                          {new Date(m.created_at).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p className="mt-2 text-zinc-100">{m.content}</p>
                    </div>
                    {isFullAdmin ? (
                      <button
                        onClick={() => remove(m.id)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        删除
                      </button>
                    ) : (
                      <span
                        className="text-xs text-zinc-700"
                        title="删除长期记忆 仅 owner / admin / leader 可操作"
                      >
                        🔒
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
