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
        {/* v26.8-UI-05: 密码可见性切换 */}
        <PasswordField
          label="密码"
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
        {/* v26.8-UI-05: 辅助链接 统一为 链接色 */}
        <div className="flex items-center justify-between text-xs">
          <Link href="/register" className="text-accent-400 hover:text-accent-500">
            还没有账号? 立即注册
          </Link>
          <Link href="/forgot-password" className="text-accent-400 hover:text-accent-500">
            忘记密码?
          </Link>
        </div>
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

// v26.8-UI-05: 密码输入框 + 👁️ 显示切换
function PasswordField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="relative mt-1">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 pr-10 text-white focus:border-accent-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-zinc-500 hover:text-zinc-300"
          aria-label={show ? "隐藏密码" : "显示密码"}
          tabIndex={-1}
        >
          {show ? "🙈" : "👁️"}
        </button>
      </div>
    </label>
  );
}
