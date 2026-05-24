"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type InvitePreview } from "@/lib/api";

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");

  const [email, setEmail] = useState("");
  // v27.2: 手机号 替代 email — email 和 phone 至少 一个. 邀请链接 仍 走 email
  // (邀请 创建 时 拿到的 是 email; phone 邀请 后续 phase 再做).
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Invite-mode state
  const [inviteInfo, setInviteInfo] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);

  useEffect(() => {
    if (!inviteToken) return;
    api
      .invitePreview(inviteToken)
      .then((p) => {
        setInviteInfo(p);
        if (p.email) setEmail(p.email);
      })
      .catch((e) =>
        setInviteError(
          e instanceof Error
            ? `邀请链接无效:${e.message}`
            : "邀请链接无效",
        ),
      )
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (password.length < 6) {
      setErr("密码至少 6 位");
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setErr("请填邮箱或手机号 (至少一个)");
      return;
    }
    setBusy(true);
    try {
      await api.register({
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
        name: name.trim(),
        workspace_name: inviteToken
          ? undefined
          : workspaceName.trim() || undefined,
        invite_token: inviteToken ?? undefined,
      });
      router.replace("/");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          {inviteToken ? "加入工作空间" : "注册"}
        </h1>
        {!inviteToken && (
          <p className="mt-2 text-xs text-zinc-500">
            创建账号会自动给你一个工作空间, 之后所有数据(会议/记忆/Agent)都隔离在该空间内
          </p>
        )}
      </div>

      {inviteToken && (
        <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          {inviteLoading ? (
            <p className="text-zinc-400">正在校验邀请链接...</p>
          ) : inviteError ? (
            <p className="text-rose-400">{inviteError}</p>
          ) : inviteInfo ? (
            <>
              <p className="text-zinc-200">
                你被邀请加入工作空间「<strong className="text-amber-200">{inviteInfo.workspace_name}</strong>」, 角色:
                <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                  {inviteInfo.role}
                </span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                邀请有效至 {new Date(inviteInfo.expires_at).toLocaleString("zh-CN")}
              </p>
            </>
          ) : null}
        </div>
      )}

      <form
        onSubmit={submit}
        className="mt-6 space-y-4 rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        <Field label="姓名" value={name} onChange={setName} required />
        <Field
          label={inviteInfo?.email ? "邮箱（来自邀请, 可改）" : "邮箱 (可选)"}
          type="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          label="手机号 (可选, 邮箱和手机号至少填一个)"
          type="tel"
          value={phone}
          onChange={setPhone}
        />
        <Field
          label="密码 (至少 6 位)"
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        {!inviteToken && (
          <Field
            label="工作空间名称 (留空则用「<姓名> 的工作空间」)"
            value={workspaceName}
            onChange={setWorkspaceName}
          />
        )}
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button
          type="submit"
          disabled={busy || (!!inviteToken && (inviteLoading || !!inviteError))}
          className="w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {busy ? "提交中..." : inviteToken ? "加入工作空间" : "创建账号"}
        </button>
        <p className="text-center text-xs text-zinc-500">
          已有账号？
          <Link href="/login" className="ml-1 text-accent-400 hover:text-accent-500">
            登录
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-accent-500 focus:outline-none"
      />
    </label>
  );
}
