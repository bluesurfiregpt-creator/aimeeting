"use client";

/**
 * v26.5-WS · 工作站 默认页 = 身份信息
 *
 * Layout (单列):
 *   👤 身份卡片  — 头像 / 名字 / 邮箱 / 角色 / 工作空间 / 科室
 *   📋 任务速览  — 待签收 / 办理中 / 待审核 (跳 /me)
 *   ⚙️ 账户设置  — 改名 / 改密码 / 退出
 *
 * 重的内容 (我维护的 AI / KB / 审批) 已拆到独立子页:
 *   /me/profile/agents
 *   /me/profile/knowledge
 *   /me/profile/memory
 *   /me/profile/sedimentation
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";
import { toast } from "@/lib/toast";

const ROLE_LABEL: Record<string, string> = {
  owner: "工作空间所有者",
  admin: "管理员",
  leader: "局长 / 部门负责人",
  manager: "部门 AI 维护人",
  member: "普通成员",
  expert: "AI 专家 (旧)",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  admin: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  leader: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  manager: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  member: "bg-zinc-700/30 text-zinc-400 border-zinc-700",
  expert: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function IdentityPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await api.me());
    } catch {
      // api.ts handleAuthError handles 401
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

  if (loading) return <div className="text-sm text-zinc-500">加载中…</div>;
  if (!me)
    return <div className="text-sm text-rose-400">⚠️ 无法加载身份信息</div>;

  const roleLabel = ROLE_LABEL[me.role] ?? me.role;
  const roleBadgeClass =
    ROLE_BADGE[me.role] ?? "bg-zinc-700/30 text-zinc-400 border-zinc-700";
  const initials = (me.name || "?").trim().slice(0, 2);
  const tc = me.task_counts;

  return (
    <div className="space-y-6">
      {/* 身份卡片 */}
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
              {(me.primary_agents ?? []).length > 0 && (
                <>
                  <span className="text-xs text-zinc-500">·</span>
                  <Link
                    href="/me/profile/agents"
                    className="text-xs text-violet-300 hover:text-violet-200"
                  >
                    🤖 维护 {(me.primary_agents ?? []).length} 个 AI
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 任务速览 */}
      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-300">
            📋 任务速览
          </h3>
          <Link
            href="/me"
            className="text-xs text-accent-400 hover:text-accent-500"
          >
            → 任务中心
          </Link>
        </div>
        {tc && tc.pending + tc.working + tc.review > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <TaskCountBox label="待签收" value={tc.pending} tone="amber" />
            <TaskCountBox label="办理中" value={tc.working} tone="sky" />
            <TaskCountBox label="待审核" value={tc.review} tone="violet" />
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            ✨ 没有待处理的任务
          </p>
        )}
        {tc?.kb_sedimentation_pending && tc.kb_sedimentation_pending > 0 ? (
          <Link
            href="/me/profile/sedimentation"
            className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 hover:bg-amber-500/10"
          >
            <span className="text-xs text-amber-300">
              🔔 你有 {tc.kb_sedimentation_pending} 个 KB 沉淀待审批
            </span>
            <span className="text-xs text-amber-300/60">→</span>
          </Link>
        ) : null}
      </section>

      {/* 账户设置 */}
      <AccountSettingsCard me={me} onRefresh={refresh} onLogout={logout} />
    </div>
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
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
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
        <span
          className={`text-sm ${danger ? "text-rose-300" : "text-zinc-100"}`}
        >
          {label}
        </span>
      </span>
      {hint && (
        <span className="ml-3 truncate text-xs text-zinc-500">{hint}</span>
      )}
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
    if (!oldPwd) return setMsg("请填旧密码");
    if (newPwd.length < 6) return setMsg("新密码至少 6 位");
    if (newPwd !== confirmPwd) return setMsg("两次输入的新密码不一致");
    if (newPwd === oldPwd) return setMsg("新密码不能跟旧密码一样");
    setBusy(true);
    try {
      await api.changePassword({ old_password: oldPwd, new_password: newPwd });
      toast.success("✅ 密码已修改");
      onClose();
    } catch (e) {
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
        <PwdField
          label="再次输入新密码"
          value={confirmPwd}
          onChange={setConfirmPwd}
        />
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
