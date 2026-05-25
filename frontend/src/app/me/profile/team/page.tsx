"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Agent,
  type Invitation,
  type TeamMember,
  type TeamRole,
} from "@/lib/api";
import { toast } from "@/lib/toast";

// v1.3.1: 5 角色 (PM 拍板) + 老兼容色票.
const ROLE_TONE: Record<string, string> = {
  workspace_creator: "bg-amber-500/15 text-amber-300",
  leader: "bg-violet-500/15 text-violet-300",
  admin: "bg-violet-500/15 text-violet-300",
  agent_owner: "bg-cyan-500/15 text-cyan-300",
  member: "bg-zinc-700/40 text-zinc-300",
  // 老兼容 (服务端 init_db 已 migrate, 但 H5 cache 滞后)
  owner: "bg-amber-500/15 text-amber-300",
  manager: "bg-cyan-500/15 text-cyan-300",
  expert: "bg-cyan-500/15 text-cyan-300",
};

// v1.3.1: 可邀请/可改派的角色 (workspace_creator 走 transfer-ownership, 不在此列).
const ROLE_OPTIONS: { value: TeamRole; label: string; desc: string }[] = [
  { value: "leader", label: "leader (工作空间管理员)", desc: "ws 内最高权, 管所有 AI / KB / 成员" },
  { value: "admin", label: "admin (科室长)", desc: "管科室人员 + 发起会议; 不改 AI/KB/memory" },
  { value: "agent_owner", label: "agent_owner (AI 主用户)", desc: "改自己 primary AI 的 KB/memory" },
  { value: "member", label: "member (普通)", desc: "仅查看 + 发起会议" },
];

export default function TeamAdmin() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [me, setMe] = useState<{ user_id: string; role: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  // v1.3.1: 邀请角色 — leader / admin / agent_owner / member
  const [inviteRole, setInviteRole] = useState<
    "leader" | "admin" | "agent_owner" | "member"
  >("member");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  // v21: 行内编辑 role + bound_agent 的草稿
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<TeamRole>("member");
  const [editBoundAgent, setEditBoundAgent] = useState<string>("");
  const [editDepartment, setEditDepartment] = useState<string>(""); // v24.3 #5
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meRow, ms, ivs, ags] = await Promise.all([
        api.me(),
        api.listMembers(),
        api.listInvitations().catch(() => [] as Invitation[]),
        api.listAgents().catch(() => [] as Agent[]),
      ]);
      setMe({ user_id: meRow.user_id, role: meRow.role });
      setMembers(ms);
      setInvites(ivs);
      setAgents(ags);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // v1.3.1: ws 管理员 (workspace_creator / leader / admin) 都可管邀请.
  // 老 'owner' 兼容服务端老 cache.
  const canManage =
    me?.role === "workspace_creator" ||
    me?.role === "leader" ||
    me?.role === "admin" ||
    me?.role === "owner";

  const createInvite = async () => {
    if (!canManage) return;
    setCreating(true);
    try {
      const inv = await api.createInvitation({
        email: inviteEmail.trim() || undefined,
        role: inviteRole,
      });
      setInviteEmail("");
      await refresh();
      // Auto-copy invite URL for convenience
      try {
        await navigator.clipboard.writeText(inv.invite_url);
        toast.success("邀请已生成", { detail: "邀请链接已复制到剪贴板" });
      } catch {
        toast.info("邀请已生成", { detail: inv.invite_url });
      }
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("撤销该邀请？已发出的链接将立即失效。")) return;
    await api.revokeInvitation(id);
    await refresh();
  };

  const removeMember = async (userId: string, name: string) => {
    if (!confirm(`将「${name}」移出本工作空间？该用户的会议、记忆等数据保留。`))
      return;
    await api.removeMember(userId);
    await refresh();
  };

  const startEdit = (m: TeamMember) => {
    setEditingId(m.user_id);
    setEditRole(m.role);
    setEditBoundAgent(m.bound_agent_id || "");
    setEditDepartment(m.department || ""); // v24.3 #5
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (userId: string) => {
    if (saving) return;
    // v1.3.1: expert 已 deprecated (老 bound_agent_id 不再 使用),
    // agent_owner 通过 Agent.primary_user_id 反向查管的 AI, 不需要 UI 选 bound.
    setSaving(true);
    try {
      await api.updateMember(userId, {
        role: editRole,
        // bound_agent_id 永不再 传 (老字段保留 schema 兼容, 不再使用)
        bound_agent_id: null,
        department: editDepartment.trim() || null, // v24.3 #5
      });
      setEditingId(null);
      await refresh();
      toast.success("已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已复制邀请链接");
    } catch {
      toast.warn("复制失败", { detail: url });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      {/* Invite form */}
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-medium text-zinc-300">邀请新成员</h2>
        {!canManage ? (
          <p className="mt-3 text-sm text-zinc-500">
            只有 owner 或 admin 角色可以邀请新成员。
          </p>
        ) : (
          <>
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-zinc-500">邮箱（可选, 仅作备注）</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="例如:teammate@example.com"
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-zinc-500">角色</span>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(
                      e.target.value as
                        | "leader"
                        | "admin"
                        | "agent_owner"
                        | "member",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                >
                  <option value="member">member（普通成员, 仅查看 + 发起会议）</option>
                  <option value="agent_owner">agent_owner（某 AI 的 主用户, 改自己 AI 的 KB/memory）</option>
                  <option value="admin">admin（科室长, 管科室人员 + 发起会议）</option>
                  <option value="leader">leader（工作空间管理员, ws 内最高权）</option>
                </select>
              </label>
              <button
                onClick={createInvite}
                disabled={creating}
                className="w-full rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
              >
                {creating ? "生成中..." : "生成邀请链接"}
              </button>
              <p className="text-xs text-zinc-600">
                邀请链接 7 天内有效, 点击「生成」后会自动复制到剪贴板。把链接发给同事, 对方打开后注册即可加入本工作空间。
              </p>
            </div>
          </>
        )}
      </section>

      {/* Members + invitations */}
      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-medium text-zinc-300">
            成员 ({members.length})
          </h2>
          {loading ? (
            <p className="mt-3 text-sm text-zinc-600">加载中...</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
              {members.map((m) => {
                const tone = ROLE_TONE[m.role] ?? ROLE_TONE.member;
                const isMe = me?.user_id === m.user_id;
                const isEditing = editingId === m.user_id;
                return (
                  <li
                    key={m.user_id}
                    className="px-4 py-3 text-sm"
                    data-testid={`team-member-${m.user_id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white">{m.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>
                            {m.role}
                          </span>
                          {/* v1.3.1: 老 expert 的 bound_agent_name 老数据 兼容显示
                              (agent_owner 通过 Agent.primary_user_id 反向查, 不显示在这里) */}
                          {m.role === "expert" && m.bound_agent_name ? (
                            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-400">
                              👤 {m.bound_agent_name}
                            </span>
                          ) : null}
                          {isMe && (
                            <span className="text-xs text-zinc-500">（你）</span>
                          )}
                          {/* v24.3 #3: 暂停派单徽章 */}
                          {m.suspended_until &&
                            new Date(m.suspended_until) > new Date() && (
                              <span
                                data-testid={`team-suspended-${m.user_id}`}
                                title={`暂停派单至 ${new Date(m.suspended_until).toLocaleString("zh-CN")}`}
                                className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300"
                              >
                                🚫 暂停派单
                              </span>
                            )}
                          {/* v24.3 #5: 科室徽章 */}
                          {m.department && (
                            <span
                              data-testid={`team-dept-${m.user_id}`}
                              className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300"
                            >
                              🏢 {m.department}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {m.email ?? "—"} · 加入于{" "}
                          {new Date(m.joined_at).toLocaleDateString("zh-CN")}
                        </div>
                      </div>
                      {canManage &&
                        !isMe &&
                        m.role !== "workspace_creator" &&
                        m.role !== "owner" /* 老兼容 */ &&
                        !isEditing && (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() => startEdit(m)}
                            data-testid={`team-member-edit-${m.user_id}`}
                            className="text-xs text-zinc-400 hover:text-zinc-100"
                          >
                            修改角色
                          </button>
                          <button
                            onClick={() => removeMember(m.user_id, m.name)}
                            className="text-xs text-rose-400 hover:text-rose-300"
                          >
                            移出
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing && (
                      <div
                        className="mt-3 grid gap-2 rounded-md border border-ink-700 bg-ink-950 p-3"
                        data-testid={`team-member-edit-form-${m.user_id}`}
                      >
                        <label className="text-xs text-zinc-400">
                          角色
                          <select
                            value={editRole}
                            onChange={(e) =>
                              setEditRole(e.target.value as TeamRole)
                            }
                            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <span className="mt-0.5 block text-[10px] text-zinc-600">
                            {ROLE_OPTIONS.find((r) => r.value === editRole)?.desc}
                          </span>
                        </label>
                        {/* v1.3.1: 老 expert bound_agent_id UI 已 retire.
                            agent_owner 通过 Agent.primary_user_id 反向查管的 AI,
                            不需要在这里 选 bound — 改在 agents 页面 选 primary_user. */}
                        {false && editRole === "expert" && (
                          <label className="text-xs text-zinc-400">
                            (v1.3.1 后此 UI 已废弃, 见 /me/profile/agents)
                            <select
                              value={editBoundAgent}
                              onChange={(e) => setEditBoundAgent(e.target.value)}
                              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
                            >
                              <option value="">— 选择一个 Agent —</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                  {a.role === "moderator" ? " (主持人)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {/* v24.3 #5: ABAC 雏形 — 科室 */}
                        <label className="text-xs text-zinc-400">
                          科室(可选,ABAC 用)
                          <input
                            type="text"
                            value={editDepartment}
                            onChange={(e) => setEditDepartment(e.target.value)}
                            placeholder="如:房屋安全管理与整治科"
                            maxLength={128}
                            data-testid={`team-edit-dept-${m.user_id}`}
                            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
                          />
                        </label>
                        <div className="mt-1 flex justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-ink-800"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => saveEdit(m.user_id)}
                            disabled={saving}
                            data-testid={`team-member-save-${m.user_id}`}
                            className="rounded-md bg-accent-500 px-2.5 py-1 text-xs font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400"
                          >
                            {saving ? "保存中…" : "保存"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canManage && (
          <section>
            <h2 className="text-sm font-medium text-zinc-300">
              待接受邀请 ({invites.filter((i) => !i.accepted_at).length})
            </h2>
            {invites.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">还没有邀请。</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="px-4 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-200">
                            {inv.email ?? "未指定邮箱"}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              ROLE_TONE[inv.role] ?? ROLE_TONE.member
                            }`}
                          >
                            {inv.role}
                          </span>
                          {inv.accepted_at ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                              已接受
                            </span>
                          ) : new Date(inv.expires_at) < new Date() ? (
                            <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-500">
                              已过期
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          创建于 {new Date(inv.created_at).toLocaleString("zh-CN")} ·
                          有效至 {new Date(inv.expires_at).toLocaleDateString("zh-CN")}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {!inv.accepted_at && (
                          <>
                            <button
                              onClick={() => copyLink(inv.invite_url)}
                              className="text-xs text-accent-400 hover:text-accent-500"
                            >
                              复制链接
                            </button>
                            <button
                              onClick={() => revoke(inv.id)}
                              className="text-xs text-rose-400 hover:text-rose-300"
                            >
                              撤销
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
