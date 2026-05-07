"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setDone(true);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">aimeeting</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">找回密码</h1>
      </div>
      {done ? (
        <div className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6 text-sm text-zinc-200">
          <p>
            如果该邮箱已注册, 我们已生成一条重置链接(有效期 1 小时)。
          </p>
          <p className="mt-3 text-zinc-400">
            邮件功能尚未接通, **请联系管理员从服务器日志中获取重置链接**, 然后用这条链接打开 `/reset-password?token=...` 页面设置新密码。
          </p>
          <p className="mt-3">
            <Link href="/login" className="text-accent-400 hover:text-accent-500">
              ← 返回登录
            </Link>
          </p>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-xl border border-ink-700 bg-ink-900 p-6"
        >
          <p className="text-xs text-zinc-500">
            填写注册邮箱, 我们会生成一条重置链接发给管理员(SMTP 暂未接通)。
          </p>
          <label className="block text-sm">
            <span className="text-xs text-zinc-400">邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-accent-500 focus:outline-none"
            />
          </label>
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {busy ? "提交中..." : "请求重置链接"}
          </button>
          <p className="text-center text-xs text-zinc-500">
            想起密码了？
            <Link href="/login" className="ml-1 text-accent-400 hover:text-accent-500">
              返回登录
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
