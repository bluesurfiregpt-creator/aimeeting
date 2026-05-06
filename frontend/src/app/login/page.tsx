"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.login({ email: email.trim(), password });
      router.replace(next);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">登录</h1>
      </div>
      <form
        onSubmit={submit}
        className="mt-8 space-y-4 rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        <Field label="邮箱" type="email" value={email} onChange={setEmail} required />
        <Field
          label="密码"
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {busy ? "登录中..." : "登录"}
        </button>
        <p className="text-center text-xs text-zinc-500">
          还没有账号？
          <Link href="/register" className="ml-1 text-accent-400 hover:text-accent-500">
            立即注册
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
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
