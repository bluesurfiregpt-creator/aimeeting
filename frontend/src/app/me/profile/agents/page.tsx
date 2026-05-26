"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Agent, type AgentInput, type KnowledgeBase, type Me, type User } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonList } from "@/components/Skeleton";
import { toast } from "@/lib/toast";

// v1.3.1 role-aware UI (PM Q7.4 web 独占编辑):
//   workspace_creator / leader 全权 — 创建 / 编辑 / 删 / 改 primary_user 都可
//   admin                       仅看 — 不能 创建 / 不能 删 / 不能 改 primary_user
//   agent_owner                  仅可 编辑 自己 primary 的 agent (不创建 / 不删)
//   member                       仅只读
// 老 'owner' 兼容服务端 老 cache (init_db 已 migrate, 但 H5 / 小程序 cache 滞后).
const FULL_ADMIN_ROLES = new Set(["workspace_creator", "leader", "owner"]);

type Form = {
  name: string;
  nickname: string;        // v26.12-Home: 拟人外号 (可选)
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
  nickname: "",
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
  // v26.13.2-perf: 首次 加载 时 显 skeleton, 别 让 用户 看 大片空白 以为 系统坏了.
  // 注意 仅 跟踪 *首次* 加载; 后续 refresh (例 创建后) 不再 重 skeleton, 平滑 替换 数据.
  const [initialLoading, setInitialLoading] = useState(true);

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
    setInitialLoading(false);
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
      nickname: a.nickname ?? "",  // v26.12-Home
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
      // v26.12-Home: 拟人外号 (可选). 传 "" → null (后端 视为 清空).
      nickname: form.nickname.trim() || null,
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

  // v26.12-Home-fix3: 老 "智慧住建 16 AI 一键 seed" hardcoded 函数 已移除 (banner 也 换 通用 CTA).
  // 后端 endpoint /api/dashboard/seed-smart-construction-agents 保留 — 测试 / seed 脚本 仍可 用.
  // 用户 想 一键生成 团队 → 跳 /me/profile/agents/template (✨ AI 模板生成器,v26.6-01).

  return (
    <div className="space-y-6">
      {/* v26.12-Home-fix3: 通用 "AI 一键生成 团队角色" CTA.
          替代 老 hardcoded "智慧住建 16 AI" banner — 用户 反馈 应该 通用化,
          任何 企业/组织 都 能 用:"描述 想解决 的 问题 / 想 要 什么 团队" →
          AI 自动生成 N 个 角色 (含 人格 / 关键词 / 种子 KB / 种子 Memory).
          视觉 沿用 首页 hero CTA 的 流动 渐变描边 + 紫色 发光. */}
      {isFullAdmin && (
        <Link
          href="/me/profile/agents/template"
          className="group relative block overflow-hidden rounded-2xl p-[2px] shadow-xl shadow-violet-500/20 transition hover:shadow-2xl hover:shadow-violet-500/40"
          data-testid="agent-template-cta"
        >
          {/* 描边 流动 — 跟 首页 一致 */}
          <span aria-hidden className="absolute inset-0 rounded-2xl animate-ai-flow" />
          {/* 内部 ink-950 暗底 */}
          <span className="relative flex items-center justify-between gap-4 rounded-[14px] bg-ink-950 px-6 py-5 transition group-hover:bg-ink-900">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-lg animate-ai-sparkle" aria-hidden>✨</span>
                <span className="text-base font-semibold text-white sm:text-lg">
                  AI 一键生成 团队角色
                </span>
                <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-200">
                  智能配置
                </span>
              </span>
              <span className="mt-1 block text-xs text-zinc-400 sm:text-sm">
                描述 你 想解决 的 问题, 或 想 要 什么 专业能力 的 团队 — AI 帮你 一次生成 N 个 角色 (含 人格 / 关键词 / 种子 知识 / 种子 记忆), 任何 行业 / 部门 都 能用
              </span>
            </span>
            <span className="shrink-0 grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg transition group-hover:translate-x-0.5 group-hover:scale-105">
              →
            </span>
          </span>
        </Link>
      )}

      {/* v26.5: manager 看到 "你的 AI" 引导提示 */}
      {/* v26.5-Profile: 加 → 个人中心 跳转入口, 形成 个人中心 ↔ AI 专家 双向联动 */}
      {!isFullAdmin && me && (
        <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-violet-200">
              👋 部门 AI 维护人视角({me.name})
            </h3>
            <p className="mt-1 text-xs text-zinc-400">
              你维护的 AI 在下方列表用 <span className="text-amber-300">⭐</span> 标出 (可编辑).
              其他 AI 用 🔒 锁住. 创建 / 删除 / 转移 AI 需要 owner / admin / leader.
            </p>
          </div>
          <Link
            href="/me/profile"
            className="shrink-0 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20"
            data-testid="agents-to-profile-link"
          >
            👤 我的身份 →
          </Link>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <h2 className="text-sm font-medium text-zinc-300">
            {editing ? "编辑 Agent" : (canCreate ? "新建 Agent" : "选择左侧 AI 编辑")}
          </h2>
        <div className="mt-4 space-y-3">
          <Field label="名称（会议中用 @<名称> 召唤）" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="产品专家" />
          {/* v26.12-Home: 拟人外号 — 首页 卡片 + 召唤 modal 显示; 可空 (严肃场景 可不填) */}
          <Field label="拟人外号（可选，例 数妙妙 / 危叔，可空）" value={form.nickname} onChange={(v) => setForm({ ...form, nickname: v })} placeholder="留空即不显示外号" />
          <Field label="领域" value={form.domain} onChange={(v) => setForm({ ...form, domain: v })} placeholder="产品 / 法务 / 架构 ..." />
          <TextArea label="人格 / 背景说明" value={form.persona} onChange={(v) => setForm({ ...form, persona: v })} placeholder="你是一名资深产品经理，重点关注用户价值与商业逻辑..." />
          <Field label="关键词（逗号分隔，命中即被触发）" value={form.keywords} onChange={(v) => setForm({ ...form, keywords: v })} placeholder="需求, 用户价值, MVP" />

          {/* v26.9-Avatar: 形象上传区 — 仅 编辑模式 显示 (需要 agent.id) */}
          {editing && (
            <AvatarUploadSection
              agentId={editing}
              currentAvatarUrl={agents.find((a) => a.id === editing)?.avatar_url ?? null}
              currentFullBodyUrl={agents.find((a) => a.id === editing)?.full_body_url ?? null}
              currentAnimatedUrl={agents.find((a) => a.id === editing)?.full_body_animated_url ?? null}
              onUploaded={refresh}
            />
          )}

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
            <a href="/me/profile/models" className="text-accent-400 hover:text-accent-500">「LLM 模型」</a>{" "}
            页配置的默认模型(当前工作空间生效)。无需在此处单独配置 API Key。
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-950 p-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              知识库（可选 · Agent 回答时优先引用）
            </div>
            {kbs.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">
                还没有知识库。先去{" "}
                <a href="/me/profile/knowledge" className="text-accent-400 hover:text-accent-500">
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
        {initialLoading ? (
          <div className="mt-3">
            <SkeletonList rows={6} />
          </div>
        ) : agents.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">还没有，先在左侧新建一个。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                me={me}
                canEdit={canEdit(a)}
                canDelete={canDelete(a)}
                onEdit={() => startEdit(a)}
                onRemove={() => remove(a.id, a.name)}
                onToggleActive={async () => {
                  // v26.8-UI-03: 快速 启用/禁用 切换
                  if (!canEdit(a)) return;
                  try {
                    await api.updateAgent(a.id, { is_active: !a.is_active });
                    toast.success(`✅ 已${a.is_active ? "停用" : "启用"}: ${a.name}`);
                    await refresh();
                  } catch (e) {
                    void e;  // api.ts 已 toast
                  }
                }}
              />
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

// v26.9-Avatar: AI 形象上传区 — 头像 / 静态全身 / 动图全身 3 个 slot
function AvatarUploadSection({
  agentId,
  currentAvatarUrl,
  currentFullBodyUrl,
  currentAnimatedUrl,
  onUploaded,
}: {
  agentId: string;
  currentAvatarUrl: string | null;
  currentFullBodyUrl: string | null;
  currentAnimatedUrl: string | null;
  onUploaded: () => void;
}) {
  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="text-xs uppercase tracking-wider text-violet-300">
        🪪 AI 数字员工形象 (3 种尺寸)
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        给 AI 上传 头像 / 静态全身 / 动图全身 — 让 AI 看起来 像 一个 活生生的人.
        会议气泡 / 列表 / 详情页 都会用上.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AvatarSlot
          label="头像"
          spec="200×200 PNG/JPG · max 500KB"
          currentUrl={currentAvatarUrl}
          aspect="square"
          accept="image/png,image/jpeg,image/webp"
          uploadFn={(f) => api.uploadAgentAvatar(agentId, f)}
          onUploaded={onUploaded}
        />
        <AvatarSlot
          label="静态全身"
          spec="200×388 PNG · max 800KB"
          currentUrl={currentFullBodyUrl}
          aspect="tall"
          accept="image/png,image/jpeg,image/webp"
          uploadFn={(f) => api.uploadAgentFullBody(agentId, f)}
          onUploaded={onUploaded}
        />
        <AvatarSlot
          label="动图全身"
          spec="200×388 GIF/APNG · max 2MB"
          currentUrl={currentAnimatedUrl}
          aspect="tall"
          accept="image/gif,image/webp,image/apng,image/png"
          uploadFn={(f) => api.uploadAgentFullBodyAnimated(agentId, f)}
          onUploaded={onUploaded}
        />
      </div>
    </div>
  );
}

function AvatarSlot({
  label,
  spec,
  currentUrl,
  aspect,
  accept,
  uploadFn,
  onUploaded,
}: {
  label: string;
  spec: string;
  currentUrl: string | null;
  aspect: "square" | "tall";
  accept: string;
  uploadFn: (f: File) => Promise<unknown>;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const w = 100;
  const h = aspect === "tall" ? 194 : 100;
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      await uploadFn(f);
      toast.success(`✅ ${label} 已上传`);
      onUploaded();
    } catch (err) {
      void err;
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1.5">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-dashed border-ink-700 bg-ink-950/60 hover:border-violet-500/50"
        style={{ width: w, height: h }}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-zinc-600">
            <span className="text-2xl">+</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-xs text-white">
            上传中…
          </div>
        )}
        <input
          type="file"
          accept={accept}
          onChange={onPick}
          className="hidden"
          disabled={busy}
        />
      </div>
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <span className="text-[10px] text-zinc-500">{spec}</span>
    </label>
  );
}

// v26.8-UI-03: AI 专家卡片 — persona 折叠 + 启用开关 + 徽章优化 + 🛠 我管理
function AgentCard({
  agent: a,
  me,
  canEdit,
  canDelete,
  onEdit,
  onRemove,
  onToggleActive,
}: {
  agent: Agent;
  me: Me | null;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggleActive: () => void;
}) {
  const [personaExpanded, setPersonaExpanded] = useState(false);
  const isModerator = a.role === "moderator";
  // v26.8-UI-03: 未绑科室 提示 由 整行黄警告 改 dot + tooltip
  const isUnbound = !isModerator && !a.primary_user_name;
  return (
    <li className="group rounded-xl border border-ink-700 bg-ink-900 p-4 transition hover:border-zinc-600 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        {/* v26.9-Avatar: 头像 48x48 (有 avatar_url) 或 颜色 dot (fallback) */}
        <Link
          href={`/me/profile/agents/${a.id}`}
          className="shrink-0"
          title="查看 AI 详情"
        >
          {a.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.avatar_url}
              alt={a.name}
              className="h-12 w-12 rounded-full border-2 object-cover transition hover:scale-105"
              style={{ borderColor: cssColor(a.color ?? "violet") }}
            />
          ) : (
            <div
              className="grid h-12 w-12 place-items-center rounded-full border-2 text-lg transition hover:scale-105"
              style={{
                borderColor: cssColor(a.color ?? "violet"),
                backgroundColor: `${cssColor(a.color ?? "violet")}22`,
              }}
            >
              🤖
            </div>
          )}
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
          {/* v26.8-UI-03: 未绑科室 黄 dot (替代整行黄警告) */}
          {isUnbound && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
              title="⚠️ 未绑科室账号 — 不能接受任务派发, 点 编辑 配置"
              aria-label="未绑科室"
            />
          )}
          {/* v26.9-Avatar: 名字 改成 link 跳详情页 */}
          <Link
            href={`/me/profile/agents/${a.id}`}
            className="font-medium text-white hover:text-accent-400"
          >
            {a.name}
          </Link>
          {/* v26.8-UI-03: ⭐ 我维护 → 🛠 我管理 (语义更明确) */}
          {me && a.primary_user_id === me.user_id && (
            <span
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
              title="你是这个 AI 的 primary_user (管理人)"
            >
              🛠 我管理
            </span>
          )}
          {!a.is_active && (
            <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">已停用</span>
          )}
          {isModerator && (
            <span
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
              title="工作空间内置主持人, 用于自动议程监督, 建议保留"
            >
              🛡 系统内置
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* v26.8-UI-03: 快速 启用/禁用 toggle */}
          {canEdit && !isModerator && (
            <button
              type="button"
              onClick={onToggleActive}
              className={`text-xs transition ${
                a.is_active
                  ? "text-emerald-400 hover:text-zinc-500"
                  : "text-zinc-600 hover:text-emerald-400"
              }`}
              title={a.is_active ? "点击 停用" : "点击 启用"}
            >
              {a.is_active ? "● 启用" : "○ 禁用"}
            </button>
          )}
          {canEdit ? (
            <button onClick={onEdit} className="text-xs text-zinc-400 hover:text-white">
              ✏️ 编辑
            </button>
          ) : (
            <span
              className="text-xs text-zinc-600"
              title={`此 AI 由 ${a.primary_user_name ?? "(未绑)"} 管理, 你无权编辑`}
            >
              🔒
            </span>
          )}
          {isModerator ? (
            <span className="text-xs text-zinc-700" title="系统内置 不可删除">🛡</span>
          ) : canDelete ? (
            <button onClick={onRemove} className="text-xs text-rose-400 hover:text-rose-300">
              🗑️
            </button>
          ) : null}
        </div>
      </div>
      {a.domain && <div className="mt-1 text-xs text-zinc-500">{a.domain}</div>}
      {/* v26.8-UI-03: persona 默认 2 行 + "展开/收起" */}
      {a.persona && (
        <div className="mt-2">
          <p
            className={`text-xs text-zinc-400 ${
              personaExpanded ? "" : "line-clamp-2"
            }`}
          >
            {a.persona}
          </p>
          {a.persona.length > 80 && (
            <button
              type="button"
              onClick={() => setPersonaExpanded((v) => !v)}
              className="mt-0.5 text-[10px] text-accent-400 hover:text-accent-500"
            >
              {personaExpanded ? "← 收起" : "展开 ↓"}
            </button>
          )}
        </div>
      )}
      {a.keywords && a.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.keywords.slice(0, 5).map((k) => (
            <span key={k} className="rounded bg-ink-800 px-2 py-0.5 text-xs text-zinc-400">
              {k}
            </span>
          ))}
          {a.keywords.length > 5 && (
            <span
              className="rounded bg-ink-800 px-2 py-0.5 text-xs text-zinc-500"
              title={a.keywords.slice(5).join(", ")}
            >
              +{a.keywords.length - 5}
            </span>
          )}
        </div>
      )}
      {!isModerator && a.primary_user_name && (
        <p className="mt-2 text-[11px] text-emerald-300/80">
          🔗 {a.primary_user_name} · ✅ 可接任务
        </p>
      )}
      {a.knowledge_base_ids && a.knowledge_base_ids.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          📚 {a.knowledge_base_ids.length} 个 KB
        </p>
      )}
    </li>
  );
}
