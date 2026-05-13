"use client";

/**
 * v26.5-Profile: 个人中心
 *
 * 把 之前散落在 顶栏 / /admin/agents 编辑表单 / /admin/team 团队列表 的身份
 * 信息 统一到这里. 用户在这能一眼看到 自己是谁 + 维护什么 AI + 任务积压.
 *
 * Layout:
 *   左列  · 👤 身份卡片 (大头像 + 名字 + email + 角色 + 工作空间 + 科室)
 *   左列  · 🤖 我维护的 AI 专家 列表 (manager 视角) + ✏️ 跳 /admin/agents
 *   左列  · 📋 任务速览 (跳 /me)
 *   右列  · ⚙️ 账户设置 (改名 / 改密码 / 登出)
 *
 * 角色徽章:
 *   owner   — 紫色 "工作空间所有者"
 *   admin   — 红色 "管理员"
 *   leader  — 红色 "局长 / 部门负责人"
 *   manager — 紫色 "部门 AI 维护人"
 *   member  — 灰色 "普通成员"
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Me, type MyAgentBrief, type SedimentationDraft } from "@/lib/api";
import { toast } from "@/lib/toast";

const ROLE_LABEL: Record<string, string> = {
  owner: "工作空间所有者",
  admin: "管理员",
  leader: "局长 / 部门负责人",
  manager: "部门 AI 维护人",
  member: "普通成员",
  expert: "AI 专家 (旧)", // v21 兼容
};

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  admin: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  leader: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  manager: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  member: "bg-zinc-700/30 text-zinc-400 border-zinc-700",
  expert: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function cssColor(name: string | null | undefined): string {
  return ({
    violet: "#8b5cf6",
    sky: "#38bdf8",
    emerald: "#34d399",
    amber: "#fbbf24",
    rose: "#fb7185",
    teal: "#2dd4bf",
  } as Record<string, string>)[name ?? ""] ?? "#8b5cf6";
}

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  // v26.5-02c: 待我审批的 KB 沉淀草稿
  const [drafts, setDrafts] = useState<SedimentationDraft[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, ds] = await Promise.all([
        api.me(),
        api.listSedimentationDrafts("pending").catch(() => [] as SedimentationDraft[]),
      ]);
      setMe(m);
      setDrafts(ds);
    } catch {
      // api.ts handleAuthError 已经处理 401/dead-session
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }, [router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="text-sm text-zinc-500">加载中…</div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="text-sm text-rose-400">⚠️ 无法加载身份信息</div>
      </div>
    );
  }

  const roleLabel = ROLE_LABEL[me.role] ?? me.role;
  const roleBadgeClass =
    ROLE_BADGE[me.role] ??
    "bg-zinc-700/30 text-zinc-400 border-zinc-700";
  // 角色英文颜色 dot (头像 fallback 用)
  const initials = (me.name || "?")
    .trim()
    .slice(0, 2);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium text-white">👤 个人中心</h1>
        <Link
          href="/me"
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          → 我的任务中心
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* 左列 */}
        <div className="space-y-6">
          {/* 身份卡片 */}
          <IdentityCard
            me={me}
            initials={initials}
            roleLabel={roleLabel}
            roleBadgeClass={roleBadgeClass}
          />

          {/* 我维护的 AI 专家 */}
          <MyAgentsSection
            agents={me.primary_agents ?? []}
            role={me.role}
          />

          {/* v26.5-02c: 待我审批的 KB 沉淀 */}
          {drafts.length > 0 && (
            <SedimentationDraftsSection
              drafts={drafts}
              onChange={refresh}
            />
          )}

          {/* 任务速览 */}
          <TaskSummarySection counts={me.task_counts ?? null} />
        </div>

        {/* 右列: 账户设置 */}
        <div>
          <AccountSettingsCard
            me={me}
            onRefresh={refresh}
            onLogout={logout}
          />
        </div>
      </div>
    </div>
  );
}

// -- 子组件 ---------------------------------------------------------------

function IdentityCard({
  me,
  initials,
  roleLabel,
  roleBadgeClass,
}: {
  me: Me;
  initials: string;
  roleLabel: string;
  roleBadgeClass: string;
}) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
      <div className="flex items-start gap-5">
        <div
          className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-2xl font-medium text-white"
          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          aria-label="头像"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-medium text-white">
            {me.name}
          </h2>
          <div className="mt-1 text-sm text-zinc-400">
            {me.email ?? "(无邮箱)"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${roleBadgeClass}`}
            >
              {roleLabel}
            </span>
            <span className="text-xs text-zinc-500">·</span>
            <span className="text-xs text-zinc-400">
              📍 {me.workspace_name}
            </span>
            {me.department && (
              <>
                <span className="text-xs text-zinc-500">·</span>
                <span className="text-xs text-zinc-400">
                  🏢 {me.department}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MyAgentsSection({
  agents,
  role,
}: {
  agents: MyAgentBrief[];
  role: string;
}) {
  // member 不维护 AI — 但 hide 这块的判定不是 role,而是 agents 列表为不为空.
  // 这样未来 owner 也可能 primary 一个 AI,这里也能显示。
  if (agents.length === 0) {
    // role 是 manager 时 给个 "暂无, 联系 owner 指派" 引导
    const isManagerRole = role === "manager" || role === "expert";
    if (!isManagerRole) return null;
    return (
      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
        <h3 className="text-sm font-medium text-zinc-300">
          🤖 我维护的 AI 专家
        </h3>
        <p className="mt-2 text-xs text-zinc-500">
          你的角色是 manager (部门 AI 维护人), 但目前 没有被指定为任何 AI 的 primary_user.
          联系 owner / admin / leader 给你 指派.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">
          🤖 我维护的 AI 专家 ({agents.length})
        </h3>
        <Link
          href="/admin/agents"
          className="text-xs text-accent-400 hover:text-accent-500"
        >
          → 管理 AI
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {agents.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-950/60 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: cssColor(a.color) }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">
                    {a.name}
                  </span>
                  {!a.is_active && (
                    <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-400">
                      已停用
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {a.domain ? `领域: ${a.domain}` : "未填领域"}
                  {a.kb_count > 0 && ` · 📚 ${a.kb_count} 个知识库`}
                </div>
              </div>
            </div>
            <Link
              href="/admin/agents"
              className="ml-3 shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-ink-800"
            >
              ✏️ 编辑
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// v26.5-02c: 待我审批的 KB 沉淀 — 列表 + approve / reject dialog
function SedimentationDraftsSection({
  drafts,
  onChange,
}: {
  drafts: SedimentationDraft[];
  onChange: () => void;
}) {
  const [openDraft, setOpenDraft] = useState<SedimentationDraft | null>(null);
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-amber-200">
          🔔 待我审批的 KB 沉淀 ({drafts.length})
        </h3>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        别的同事 办了任务, 拟把内容沉淀到 你维护的 AI 的 KB. 你审批通过 才会真的写入.
      </p>
      <ul className="mt-3 space-y-2">
        {drafts.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-950/60 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-white">
                  {d.task_title ?? "(无标题任务)"}
                </span>
                {d.target_agent_name && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                    → {d.target_agent_name}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {d.curator_user_name && `由 ${d.curator_user_name} · `}
                {new Date(d.created_at).toLocaleString("zh-CN")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenDraft(d)}
              className="ml-3 shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30"
            >
              查看 / 审批 →
            </button>
          </li>
        ))}
      </ul>
      {openDraft && (
        <DraftReviewDialog
          draft={openDraft}
          onClose={() => setOpenDraft(null)}
          onDone={() => {
            setOpenDraft(null);
            onChange();
          }}
        />
      )}
    </section>
  );
}

function DraftReviewDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: SedimentationDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const doApprove = async () => {
    setBusy(true);
    try {
      await api.approveSedimentationDraft(draft.id);
      toast.success("✅ 已批准, 沉淀完成");
      onDone();
    } catch (e) {
      void e;
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      await api.rejectSedimentationDraft(draft.id, rejectReason.trim() || undefined);
      toast.success("已驳回");
      onDone();
    } catch (e) {
      void e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="KB 沉淀审批" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
          <div className="text-xs text-zinc-500">任务标题</div>
          <div className="mt-1 text-sm text-white">
            {draft.task_title ?? "(无标题)"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-zinc-500">沉淀目标 AI</div>
            <div className="mt-1 text-sm text-amber-300">
              🤖 {draft.target_agent_name ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
            <div className="text-zinc-500">触发者</div>
            <div className="mt-1 text-sm text-white">
              {draft.curator_user_name ?? "—"}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-950/60 p-3">
          <div className="text-xs text-zinc-500">拟沉淀摘要 (LLM 生成, 预览)</div>
          <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-200">
            {draft.proposed_summary}
          </pre>
        </div>

        {showReject ? (
          <div>
            <label className="block text-sm">
              <span className="text-xs text-zinc-500">驳回理由 (可选)</span>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                placeholder="例: 内容不在本专业范围"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={doReject}
                disabled={busy}
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-rose-400"
              >
                {busy ? "驳回中…" : "确认驳回"}
              </button>
              <button
                type="button"
                onClick={() => setShowReject(false)}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doApprove}
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-emerald-400"
            >
              {busy ? "处理中…" : "✅ 批准 沉淀"}
            </button>
            <button
              type="button"
              onClick={() => setShowReject(true)}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
            >
              驳回…
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
            >
              稍后再说
            </button>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

function TaskSummarySection({
  counts,
}: {
  counts: { pending: number; working: number; review: number; kb_sedimentation_pending?: number } | null;
}) {
  const c = counts ?? { pending: 0, working: 0, review: 0 };
  const total = c.pending + c.working + c.review;
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">
          📋 我的任务速览
        </h3>
        <Link
          href="/me"
          className="text-xs text-accent-400 hover:text-accent-500"
        >
          → 任务中心
        </Link>
      </div>
      {total === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          ✨ 没有待处理的任务
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <TaskCountBox label="待签收" value={c.pending} tone="amber" />
          <TaskCountBox label="办理中" value={c.working} tone="sky" />
          <TaskCountBox label="待审核" value={c.review} tone="violet" />
        </div>
      )}
    </section>
  );
}

function TaskCountBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "sky" | "violet";
}) {
  const cls = {
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    sky: "border-sky-500/30 bg-sky-500/5 text-sky-300",
    violet: "border-violet-500/30 bg-violet-500/5 text-violet-300",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-2xl font-medium">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400">{label}</div>
    </div>
  );
}

function AccountSettingsCard({
  me,
  onRefresh,
  onLogout,
}: {
  me: Me;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [showRename, setShowRename] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
      <h3 className="text-sm font-medium text-zinc-300">⚙️ 账户设置</h3>
      <div className="mt-4 space-y-2">
        <SettingsRow
          icon="✏️"
          label="修改名字"
          hint={me.name}
          onClick={() => setShowRename(true)}
        />
        <SettingsRow
          icon="🔒"
          label="修改密码"
          hint="6 位以上"
          onClick={() => setShowChangePwd(true)}
        />
        <SettingsRow
          icon="🚪"
          label="退出登录"
          hint="清除本地会话"
          onClick={onLogout}
          danger
        />
      </div>
      {showRename && (
        <RenameDialog
          currentName={me.name}
          onClose={() => setShowRename(false)}
          onDone={() => {
            setShowRename(false);
            onRefresh();
          }}
        />
      )}
      {showChangePwd && (
        <ChangePasswordDialog onClose={() => setShowChangePwd(false)} />
      )}
    </section>
  );
}

function SettingsRow({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border border-ink-700 bg-ink-950/60 px-3 py-2.5 text-left transition hover:bg-ink-800 ${
        danger ? "hover:border-rose-500/40" : ""
      }`}
    >
      <span className="flex items-center gap-3">
        <span className="text-base" aria-hidden>
          {icon}
        </span>
        <span className={`text-sm ${danger ? "text-rose-300" : "text-zinc-100"}`}>
          {label}
        </span>
      </span>
      {hint && <span className="ml-3 truncate text-xs text-zinc-500">{hint}</span>}
    </button>
  );
}

function RenameDialog({
  currentName,
  onClose,
  onDone,
}: {
  currentName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    if (name.trim() === currentName) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.updateMe({ name: name.trim() });
      toast.success("✅ 名字已更新");
      onDone();
    } catch (e) {
      // api.ts 已 toast, 这里不重复
      void e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title="修改名字" onClose={onClose}>
      <label className="block text-sm">
        <span className="text-xs text-zinc-500">新名字</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
          placeholder="例: 张三"
          maxLength={128}
        />
      </label>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-accent-400"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
        >
          取消
        </button>
      </div>
    </DialogShell>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("");
    if (!oldPwd) {
      setMsg("请填旧密码");
      return;
    }
    if (newPwd.length < 6) {
      setMsg("新密码至少 6 位");
      return;
    }
    if (newPwd !== confirmPwd) {
      setMsg("两次输入的新密码不一致");
      return;
    }
    if (newPwd === oldPwd) {
      setMsg("新密码不能跟旧密码一样");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({
        old_password: oldPwd,
        new_password: newPwd,
      });
      toast.success("✅ 密码已修改");
      onClose();
    } catch (e) {
      // api.ts 会弹 toast (旧密码错 → [权限不足]),这里防御性显示 msg
      setMsg(e instanceof Error ? e.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="修改密码" onClose={onClose}>
      <div className="space-y-3">
        <PwdField label="旧密码" value={oldPwd} onChange={setOldPwd} />
        <PwdField label="新密码 (≥6 位)" value={newPwd} onChange={setNewPwd} />
        <PwdField label="再次输入新密码" value={confirmPwd} onChange={setConfirmPwd} />
        {msg && <p className="text-xs text-rose-400">{msg}</p>}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm text-white shadow disabled:opacity-50 hover:bg-accent-400"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-zinc-300 hover:bg-ink-800"
        >
          取消
        </button>
      </div>
    </DialogShell>
  );
}

function PwdField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
        autoComplete="new-password"
      />
    </label>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-zinc-200">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
