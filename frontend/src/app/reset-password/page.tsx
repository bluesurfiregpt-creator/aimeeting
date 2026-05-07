"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (password.length < 6) { setErr("密码至少 6 位"); return; }
    if (password !== confirm) { setErr("两次输入的密码不一致"); return; }
    if (!token) { setErr("链接缺少 token"); return; }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      router.replace("/");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">设置新密码</h1>
      </div>
      <form
        onSubmit={submit}
        className="mt-8 space-y-4 rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        {!token && (
          <p className="rounded bg-rose-500/10 p-3 text-sm text-rose-300">
            链接缺少 token。请确认从邀请邮件/管理员处获取的链接是完整的。
          </p>
        )}
        <Field label="新密码（至少 6 位）" type="password" value={password} onChange={setPassword} required />
        <Field label="再次输入新密码" type="password" value={confirm} onChange={setConfirm} required />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button
          type="submit"
          disabled={busy || !token}
          className="w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {busy ? "重置中..." : "重置密码并登录"}
        </button>
        <p className="text-center text-xs text-zinc-500">
          <Link href="/login" className="text-accent-400 hover:text-accent-500">
            ← 返回登录
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
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
