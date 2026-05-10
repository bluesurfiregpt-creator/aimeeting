"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

const ADMIN_ROLES = new Set(["owner", "admin", "leader"]);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<"checking" | "yes" | "no">("checking");

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (!alive) return;
        if (ADMIN_ROLES.has(m.role)) {
          setAllowed("yes");
        } else {
          setAllowed("no");
          toast.warn("无权限访问后台", {
            detail: "管理员 / 领导 角色才能进入 /admin",
          });
          // 弹完 toast 跳回 /me 而不是 / (避免 expert 看不到任何东西)
          setTimeout(() => router.replace("/me"), 800);
        }
      })
      .catch(() => {
        // 401 由 api.ts 自动跳 /login
      });
    return () => {
      alive = false;
    };
  }, [router]);

  // v25-bug-fix #6: 守卫 — non-admin 不渲染任何 admin 内容
  if (allowed === "no") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-lg text-zinc-300">无权限访问后台</p>
        <p className="mt-2 text-sm text-zinc-500">
          仅 owner / admin / leader 可访问.正在跳转…
        </p>
      </div>
    );
  }
  if (allowed === "checking") {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-zinc-500">权限校验中…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">系统配置</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">
          ← 首页
        </Link>
      </header>
      <nav className="mt-6 flex gap-1 border-b border-ink-700">
        <AdminTab href="/admin/agents" label="AI 专家" />
        <AdminTab href="/admin/knowledge" label="知识库" />
        <AdminTab href="/admin/models" label="LLM 模型" />
        <AdminTab href="/admin/memory" label="长期记忆" />
        <AdminTab href="/admin/cron-rules" label="定期巡检" />
        <AdminTab href="/admin/team" label="团队" />
        <AdminTab href="/admin/access-requests" label="访问申请" />
        <AdminTab href="/admin/audit" label="操作日志" />
        <AdminTab href="/admin/demo-data" label="演示数据" />
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-t-lg px-4 py-2 text-sm text-zinc-400 hover:bg-ink-800 hover:text-white"
    >
      {label}
    </Link>
  );
}
