"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type AgentInput, type KnowledgeBase, type Me, type User } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";

// v26.5 role-aware UI:
//   leader+ (owner/admin/leader) 全权 — 创建 / 编辑 / 删 / 改 primary_user 都可
//   manager 仅可 编辑 自己 primary 的 agent(不能创建 / 不能删 / 不能转 primary_user)
//   member 不该进 admin
const FULL_ADMIN_ROLES = new Set(["owner", "admin", "leader"]);

type Form = {
  name: string;
  domain: string;
  persona: string;
  keywords: string;        // comma separated for input
  color: string;
  knowledge_base_ids: Set<string>;
  is_active: boolean;
  primary_user_id: string;  // v26.0: 绑定的科室账号(空字符串 = 未绑)
};

const EMPTY: Form = {
  name: "",
  domain: "",
  persona: "",
  keywords: "",
  color: "violet",
  knowledge_base_ids: new Set<string>(),
  is_active: true,
  primary_user_id: "",
};

const COLORS = ["violet", "sky", "emerald", "amber", "rose", "teal"];

export default function AgentsAdmin() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  // v26.0: workspace users for primary_user_id binding
  const [users, setUsers] = useState<User[]>([]);
  // {id, name} of the agent the user is being asked to confirm deletion for.
  // null = no dialog open.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // v26.5 role-aware: 读 me 决定 看哪些按钮
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    const [as_, ks, us, meRes] = await Promise.all([
      api.listAgents(),
      api.listKnowledgeBases().catch(() => [] as KnowledgeBase[]),
      api.listUsers().catch(() => [] as User[]),  // v26.0
      api.me().catch(() => null),  // v26.5
    ]);
    setAgents(as_);
    setKbs(ks);
    setUsers(us);
    setMe(meRes);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // v26.5 role helpers
  const isFullAdmin = me ? FULL_ADMIN_ROLES.has(me.role) : false;
  const canCreate = isFullAdmin;
  const canDelete = (_a: Agent) => isFullAdmin;
  const canEdit = (a: Agent) =>
    isFullAdmin || (!!me && a.primary_user_id === me.user_id);
  const canChangePrimaryUser = isFullAdmin; // 转 primary_user 仅 leader+

  // 编辑时,如果当前在编辑某个 agent 但该 agent 不让 me 编辑(eg 网络改后被剥权),
  // 自动 reset 表单.
  useEffect(() => {
    if (editing) {
      const a = agents.find((x) => x.id === editing);
      if (a && !canEdit(a)) {
        setEditing(null);
        setForm(EMPTY);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, agents, me]);

  const reset = () => { setForm({ ...EMPTY, knowledge_base_ids: new Set(), primary_user_id: "" }); setEditing(null); setMsg(""); };

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
      primary_user_id: a.primary_user_id ?? "",  // v26.0
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
    const body: Partial<AgentInput> = {
      name: form.name.trim(),
      domain: form.domain || null,
      persona: form.persona || null,
      keywords: form.keywords ? form.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
      color: form.color,
      knowledge_base_ids: Array.from(form.knowledge_base_ids),
      is_active: form.is_active,
    };
    // v26.5-P0-fix4: 只有 leader+ 才传 primary_user_id (manager 改不动也不应该发,
    // 否则后端 即使 值没变 也可能 误拦. 后端 v26.5-P0-fix4 加了 "值没变不算改"
    // 容错, 前端 这里 双保险 — 直接 不传).
    if (canChangePrimaryUser) {
      // v26.0: 空 string → null (后端解 None = 未绑)
      body.primary_user_id = form.primary_user_id || null;
    }
    try {
      if (editing) {
        await api.updateAgent(editing, body);
        setMsg("✅ 已更新");
      } else {
        await api.createAgent(body as AgentInput);
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
      {/* v24.1: 智慧住建一键 seed banner (v26.5: 仅 leader+ 显示, manager 看不到 seed 入口) */}
      {isFullAdmin && (
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
      )}

      {/* v26.5: manager 看到 "你的 AI" 引导提示 */}
      {!isFullAdmin && me && (
        <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <h3 className="text-sm font-medium text-violet-200">
            👋 部门 AI 维护人视角({me.name})
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            你可以编辑 自己 primary 的 AI 配置(下方列表中没有 🔒 锁标记的).
            创建新 AI / 删除 AI / 转移 AI 给别的同事 需要 owner / admin / leader 操作.
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <h2 className="text-sm font-medium text-zinc-300">
            {editing ? "编辑 Agent" : (canCreate ? "新建 Agent" : "选择左侧 AI 编辑")}
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

          {/* v26.0: 绑定科室账号 — 该 AI 专家 接到的任务,由这个 user 实际操作 */}
          {/* v26.5-P0-fix2: manager 视角不用 disabled select(会显示空),改纯文字展示 */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs uppercase tracking-wider text-amber-300">
              🔗 绑定科室账号 (primary user)
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              该 AI 专家是 任务的「主人」,但实际操作 / 上传资料 / 工单闭环
              由它绑定的科室账号来做.<b className="text-amber-200">没绑科室账号的 AI 专家
              不能接受任务派发</b>.
            </p>
            {canChangePrimaryUser ? (
              <select
                value={form.primary_user_id}
                onChange={(e) => setForm({ ...form, primary_user_id: e.target.value })}
                className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
              >
                <option value="">— 未绑 (本 AI 不能接任务) —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            ) : (
              // manager 视角: 直接用 agent.primary_user_name 显示当前绑定的人
              // (避免 disabled select 因 users 列表问题显示空白)
              (() => {
                const currentAgent = editing ? agents.find((x) => x.id === editing) : null;
                const boundName = currentAgent?.primary_user_name ?? null;
                return (
                  <div
                    className="mt-2 rounded-md border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm"
                    title="转移 AI 给别的同事 需要 owner / admin / leader 权限"
                  >
                    {boundName ? (
                      <span className="text-zinc-100">
                        当前绑定: <strong className="text-emerald-300">{boundName}</strong>
                      </span>
                    ) : (
                      <span className="text-amber-300">— 未绑 (本 AI 不能接任务) —</span>
                    )}
                  </div>
                );
              })()
            )}
            {!canChangePrimaryUser && (
              <p className="mt-1 text-[10px] text-amber-300/60">
                🔒 转移 AI 给别的同事 需要 owner / admin / leader 权限
              </p>
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
                  <div className="flex items-center gap-2">
                    {/* v26.5 role-aware: 编辑按钮 仅 当 canEdit(this agent) */}
                    {canEdit(a) ? (
                      <button onClick={() => startEdit(a)} className="text-xs text-zinc-400 hover:text-white">编辑</button>
                    ) : (
                      <span
                        className="text-xs text-zinc-600"
                        title={`此 AI 由 ${a.primary_user_name ?? "(未绑)"} 管理,你无权编辑`}
                      >
                        🔒
                      </span>
                    )}
                    {a.role === "moderator" ? (
                      <span className="text-xs text-zinc-700" title="内置主持人不可删除">🛡</span>
                    ) : canDelete(a) ? (
                      <button onClick={() => remove(a.id, a.name)} className="text-xs text-rose-400 hover:text-rose-300">删除</button>
                    ) : null}
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
                {/* v26.0: 科室账号绑定状态 */}
                {a.role !== "moderator" && (
                  <p className="mt-1 text-xs">
                    {a.primary_user_name ? (
                      <span className="text-emerald-300">
                        🔗 绑科室账号: {a.primary_user_name} ✅ 可接任务
                      </span>
                    ) : (
                      <span className="text-amber-300">
                        ⚠️ 未绑科室账号 — 不能接受任务派发,点 编辑 配置
                      </span>
                    )}
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
