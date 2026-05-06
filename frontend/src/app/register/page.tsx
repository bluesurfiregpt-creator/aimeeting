"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (password.length < 6) {
      setErr("密码至少 6 位");
      return;
    }
    setBusy(true);
    try {
      await api.register({
        email: email.trim(),
        password,
        name: name.trim(),
        workspace_name: workspaceName.trim() || undefined,
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
        <h1 className="mt-2 text-3xl font-semibold text-white">注册</h1>
        <p className="mt-2 text-xs text-zinc-500">
          创建账号会自动给你一个工作空间, 之后所有数据(会议/记忆/Agent)都隔离在该空间内
        </p>
      </div>
      <form
        onSubmit={submit}
        className="mt-8 space-y-4 rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        <Field label="姓名" value={name} onChange={setName} required />
        <Field label="邮箱" type="email" value={email} onChange={setEmail} required />
        <Field
          label="密码 (至少 6 位)"
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        <Field
          label="工作空间名称 (留空则用「<姓名> 的工作空间」)"
          value={workspaceName}
          onChange={setWorkspaceName}
        />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {busy ? "创建中..." : "创建账号"}
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
