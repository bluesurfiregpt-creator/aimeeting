"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type Me, type Memory } from "@/lib/api";
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
  const [agents, setAgents] = useState<Agent[]>([]);  // v26.5-02b
  const [scope, setScope] = useState<string>("");
  const [scopeRef, setScopeRef] = useState("");
  const [filterAgentId, setFilterAgentId] = useState<string>("");  // v26.5-02b
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // v26.5-Lineage P2: form.agent_ids 改成 数组 — 第一个 = primary, 其余 subscriber
  const [form, setForm] = useState<{
    scope: string;
    scope_ref: string;
    content: string;
    importance: number;
    agent_ids: string[];
  }>({
    scope: "project",
    scope_ref: "",
    content: "",
    importance: 0.6,
    agent_ids: [],
  });
  const [msg, setMsg] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const isFullAdmin = me ? FULL_ADMIN_ROLES.has(me.role) : false;

  // v26.5-02b: 我作为 primary_user 的 agent id 集合 (manager 可写)
  const myAgentIds = new Set((me?.primary_agents ?? []).map((a) => a.id));
  // 是否可写 (用于 显示写表单):
  // - leader+ 任何 memory 都能写
  // - manager 至少 是某个 AI 的 primary 才能写 该 AI 的 memory
  const canWrite = isFullAdmin || myAgentIds.size > 0;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.listAgents().then(setAgents).catch(() => setAgents([]));  // v26.5-02b
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listMemories(
        scope || undefined,
        scopeRef || undefined,
        filterAgentId || undefined,
      );
      setMemories(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [scope, scopeRef, filterAgentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!form.content.trim()) {
      setMsg("内容必填");
      return;
    }
    // v26.5-Lineage P2: manager 必须 选 至少 1 个 agent (workspace 通用记忆 仅 leader+)
    if (!isFullAdmin && form.agent_ids.length === 0) {
      setMsg("manager 写记忆 必须 指定 至少 1 个 归属 AI 专家");
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
        agent_ids: form.agent_ids.length > 0 ? form.agent_ids : null,
      });
      setForm({ ...form, content: "", agent_ids: [] });
      setMsg("✅ 已写入");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `❌ ${e.message}` : "失败");
    } finally {
      setCreating(false);
    }
  };

  const toggleFormAgent = (agentId: string) => {
    setForm((f) => ({
      ...f,
      agent_ids: f.agent_ids.includes(agentId)
        ? f.agent_ids.filter((id) => id !== agentId)
        : [...f.agent_ids, agentId],
    }));
  };

  const remove = async (id: string) => {
    if (!confirm("确认删除这条记忆？")) return;
    try {
      await api.deleteMemory(id);
      await refresh();
    } catch (e) {
      void e;  // api.ts 已 toast
    }
  };

  // v26.5-Lineage: 该 memory 我是否能删
  //   leader+ 全可 / manager 是该 memory 任一 primary AI 的 primary_user 即可
  //   (向后兼容 老 agent_id 字段)
  const canDeleteMemory = (m: Memory): boolean => {
    if (isFullAdmin) return true;
    const primaryAids = (m.agents ?? [])
      .filter((a) => a.is_primary)
      .map((a) => a.id);
    if (primaryAids.some((id) => myAgentIds.has(id))) return true;
    return false;
  };

  return (
    <div>
      <p className="text-sm text-zinc-500">
        长期记忆是 AI 跨会议引用的事实库。会后系统自动从纪要里抽取(决策/风险/待办/分歧)并入库；这里你也可以手工添加。AI 专家在会议中会基于关键词检索最相关的记忆,作为 system prompt 的一部分。
      </p>

      {/* Filter bar */}
      <section className="mt-6 flex flex-wrap items-center gap-2">
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
        {/* v26.5-02b: 按归属 AI 过滤 */}
        <select
          value={filterAgentId}
          onChange={(e) => setFilterAgentId(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white focus:border-accent-500 focus:outline-none"
        >
          <option value="">所有归属</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              🤖 {a.name}
            </option>
          ))}
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

      {/* v26.5-02b: manager 提示 — 现在可以写自己 AI 的记忆 */}
      {!isFullAdmin && me && (
        <section className="mt-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <h3 className="text-sm font-medium text-violet-200">
            👋 部门 AI 维护人视角({me.name})
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            你 可以 给 你 primary 的 AI 写 / 删 记忆 (下方表单 必选 归属 AI).
            workspace 通用记忆 (不归属任何 AI) 仅 owner / admin / leader 可写.
          </p>
        </section>
      )}

      {/* New memory — v26.5-02b: manager 也能写 (必须 选 agent_id) */}
      {canWrite && (
      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-medium text-zinc-300">手工添加</h2>
        <div className="mt-3 grid gap-3">
          {/* v26.5-Lineage P2: 归属 AI 多选 — 一条 memory 可同时挂多个 AI */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs uppercase tracking-wider text-amber-300">
              🔗 归属 AI 专家 {isFullAdmin ? "(可多选, 不选 = workspace 通用)" : "(至少选 1 个)"}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              第一个勾的是 <span className="text-emerald-300">⭐ primary (主人)</span>,
              其余是 <span className="text-violet-300">🔗 subscriber (订阅引用)</span>.
              共享给多个 AI 时, 它们都能在会议中引用这条记忆.
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {agents
                .filter((a) => isFullAdmin || myAgentIds.has(a.id))
                .map((a, idx) => {
                  const checked = form.agent_ids.includes(a.id);
                  const order = form.agent_ids.indexOf(a.id);
                  const isPrimary = order === 0;
                  return (
                    <label
                      key={a.id}
                      className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition ${
                        checked
                          ? isPrimary
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-violet-500/40 bg-violet-500/10"
                          : "border-ink-700 bg-ink-950 hover:bg-ink-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFormAgent(a.id)}
                        className="accent-amber-500"
                      />
                      {checked && (
                        <span className="text-[10px] font-medium">
                          {isPrimary ? "⭐" : `🔗 ${order + 1}`}
                        </span>
                      )}
                      <span className="text-zinc-100">🤖 {a.name}</span>
                      {a.domain && <span className="text-zinc-500">· {a.domain}</span>}
                    </label>
                  );
                })}
              {agents.filter((a) => isFullAdmin || myAgentIds.has(a.id)).length === 0 && (
                <p className="text-zinc-500">
                  {isFullAdmin ? "本 workspace 还没有 AI 专家" : "你不是任何 AI 的 primary_user"}
                </p>
              )}
            </div>
            {form.agent_ids.length === 0 && isFullAdmin && (
              <p className="mt-2 text-[10px] text-zinc-500">
                不勾任何 AI → 写入 workspace 通用记忆 (老行为)
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[120px_180px_1fr_100px_auto] sm:items-end">
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
                        {/* v26.5-Lineage: 多对多 — 显示所有挂的 agent. primary 加 ⭐ */}
                        {(m.agents ?? []).length > 0 ? (
                          (m.agents ?? []).map((a) => (
                            <span
                              key={a.id}
                              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300"
                              title={a.is_primary ? "primary (主人, 可改)" : "subscriber (订阅, 只读)"}
                            >
                              {a.is_primary ? "⭐" : "🔗"} {a.name}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-full bg-zinc-700/30 px-2 py-0.5 text-zinc-500">
                            workspace 通用
                          </span>
                        )}
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
                    {canDeleteMemory(m) ? (
                      <button
                        onClick={() => remove(m.id)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        删除
                      </button>
                    ) : (
                      <span
                        className="text-xs text-zinc-700"
                        title={(m.agents ?? []).length > 0
                          ? `此记忆归 ${(m.agents ?? []).map((a) => a.name).join(" / ")} 管, 你无权删`
                          : "workspace 通用记忆 仅 owner / admin / leader 可删"}
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
