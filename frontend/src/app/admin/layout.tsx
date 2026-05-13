"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

// v26.5: manager (= 部门 AI 维护人,取代 v21 expert) 也允许进 /admin,但 仅 3 个 tab
// (agent / knowledge / memory).其他 tab 仍属 leader+ 职责.
// member 完全不能进 (跳 /me).
const ADMIN_ROLES = new Set(["owner", "admin", "leader", "manager", "expert"]);
const FULL_ADMIN_ROLES = new Set(["owner", "admin", "leader"]);

// v26.5 决策点 #1=A: manager 仅 这 3 个 tab
const MANAGER_VISIBLE_TABS = new Set(["agents", "knowledge", "memory"]);

type TabKey =
  | "agents"
  | "knowledge"
  | "asr-vocabulary"
  | "models"
  | "memory"
  | "cron-rules"
  | "team"
  | "access-requests"
  | "audit"
  | "demo-data";

const ALL_TABS: { key: TabKey; href: string; label: string }[] = [
  { key: "agents", href: "/admin/agents", label: "AI 专家" },
  { key: "knowledge", href: "/admin/knowledge", label: "知识库" },
  { key: "asr-vocabulary", href: "/admin/asr-vocabulary", label: "ASR 词表" },
  { key: "models", href: "/admin/models", label: "LLM 模型" },
  { key: "memory", href: "/admin/memory", label: "长期记忆" },
  { key: "cron-rules", href: "/admin/cron-rules", label: "定期巡检" },
  { key: "team", href: "/admin/team", label: "团队" },
  { key: "access-requests", href: "/admin/access-requests", label: "访问申请" },
  { key: "audit", href: "/admin/audit", label: "操作日志" },
  { key: "demo-data", href: "/admin/demo-data", label: "演示数据" },
];

function visibleTabs(role: string) {
  if (FULL_ADMIN_ROLES.has(role)) {
    return ALL_TABS; // 全部 10 个
  }
  // manager / expert(v21) 仅 3 个
  if (role === "manager" || role === "expert") {
    return ALL_TABS.filter((t) => MANAGER_VISIBLE_TABS.has(t.key));
  }
  return [];
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<"checking" | "yes" | "no">("checking");
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (!alive) return;
        setRole(m.role);
        if (ADMIN_ROLES.has(m.role)) {
          setAllowed("yes");
        } else {
          setAllowed("no");
          toast.warn("无权限访问后台", {
            detail: "管理员 / 领导 / 部门 AI 维护人 角色才能进入 /admin",
          });
          // 弹完 toast 跳回 /me 而不是 / (避免 member 看不到任何东西)
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
          仅 owner / admin / leader / manager 可访问.正在跳转…
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

  const tabs = visibleTabs(role);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            系统配置
            {role === "manager" && (
              <span
                className="ml-3 rounded-md bg-violet-500/15 px-2 py-0.5 text-xs text-violet-300"
                title="部门 AI 维护人视角 — 你能管自己 primary 的 AI / KB / 记忆"
              >
                部门 AI 维护人
              </span>
            )}
          </h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">
          ← 首页
        </Link>
      </header>
      <nav className="mt-6 flex gap-1 border-b border-ink-700">
        {tabs.map((t) => (
          <AdminTab key={t.key} href={t.href} label={t.label} />
        ))}
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
