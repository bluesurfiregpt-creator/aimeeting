"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Invitation, type TeamMember } from "@/lib/api";
import { toast } from "@/lib/toast";

const ROLE_TONE: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-300",
  admin: "bg-violet-500/15 text-violet-300",
  member: "bg-zinc-700/40 text-zinc-300",
};

export default function TeamAdmin() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [me, setMe] = useState<{ user_id: string; role: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meRow, ms, ivs] = await Promise.all([
        api.me(),
        api.listMembers(),
        api.listInvitations().catch(() => [] as Invitation[]),
      ]);
      setMe({ user_id: meRow.user_id, role: meRow.role });
      setMembers(ms);
      setInvites(ivs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canManage = me?.role === "owner" || me?.role === "admin";

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
                    setInviteRole(e.target.value as "admin" | "member")
                  }
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none"
                >
                  <option value="member">member（普通成员, 不能管理团队）</option>
                  <option value="admin">admin（可邀请、可移除其他成员）</option>
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
                return (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{m.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>
                          {m.role}
                        </span>
                        {isMe && (
                          <span className="text-xs text-zinc-500">（你）</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {m.email ?? "—"} · 加入于{" "}
                        {new Date(m.joined_at).toLocaleDateString("zh-CN")}
                      </div>
                    </div>
                    {canManage && !isMe && m.role !== "owner" && (
                      <button
                        onClick={() => removeMember(m.user_id, m.name)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        移出
                      </button>
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
