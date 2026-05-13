"use client";

/**
 * v26.5-WS · 我的工作站 (Workstation) — 统一控制台
 *
 * 把之前散落 7 处的入口 (顶栏 ⚙️ / 📊 / 📨 / ✏️ / 📬 + 首页链接 + /admin/*)
 * 全合并到这里. 顶栏只留 [⚡超管 | 🔔通知 | 👤名字 | 退出], 其他都进这里.
 *
 * Layout:
 *   左侧 sidebar (sticky)  · 分组导航 (按角色显示)
 *   右侧 main (动态加载)   · 子路由内容
 *
 * 子路由 (= /me/profile/*):
 *   /me/profile               身份信息 + 账户设置 (默认)
 *   /me/profile/workspace     空间设置 (owner+)
 *   /me/profile/team          成员管理 (owner+)
 *   /me/profile/agents        AI 专家
 *   /me/profile/agents/template  🆕 AI 模板生成器 (占位)
 *   /me/profile/knowledge     知识库
 *   /me/profile/memory        长期记忆
 *   /me/profile/sedimentation 待我审批 (沉淀)
 *   /me/profile/models        LLM 模型 (owner+)
 *   /me/profile/asr           ASR 词表 (owner+)
 *   /me/profile/voiceprints   声纹库
 *   /me/profile/cron          定期巡检 (owner+)
 *   /me/profile/audit         操作日志 (owner+)
 *   /me/profile/access-requests  访问申请 (owner+)
 *   /me/profile/dashboard     → 跳 /dashboard
 *   /me/profile/tasks         → 跳 /me
 *
 * ABAC:
 *   sidebar 按 me.role 决定哪些条目可见;
 *   后端 ABAC 仍是 各 endpoint 的最终防线.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";

const FULL_ADMIN_ROLES = new Set(["owner", "admin", "leader"]);

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** 角色可见性 — undefined = 所有登录用户 */
  needsRole?: "full" | "manager+";
  /** badge 数 (从 me.task_counts 取) */
  badgeKey?: "kb_sedimentation_pending";
  /** external = 跳走 (不是子页) */
  external?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "🪪 我",
    items: [
      { href: "/me/profile", label: "身份信息", icon: "👤" },
      { href: "/me", label: "我的任务", icon: "📋", external: true },
      { href: "/dashboard", label: "数据看板", icon: "📊", external: true },
    ],
  },
  {
    title: "🤖 AI 专家",
    items: [
      { href: "/me/profile/agents", label: "AI 列表 + 编辑", icon: "🤖" },
      {
        href: "/me/profile/agents/template",
        label: "AI 模板生成器",
        icon: "✨",
        needsRole: "full",
      },
    ],
  },
  {
    title: "📚 数据",
    items: [
      { href: "/me/profile/knowledge", label: "知识库", icon: "📚" },
      { href: "/me/profile/memory", label: "长期记忆", icon: "🧠" },
      {
        href: "/me/profile/sedimentation",
        label: "待我审批",
        icon: "🔔",
        badgeKey: "kb_sedimentation_pending",
      },
    ],
  },
  {
    title: "🏢 工作空间",
    items: [
      {
        href: "/me/profile/workspace",
        label: "空间设置",
        icon: "🏢",
        needsRole: "full",
      },
      {
        href: "/me/profile/team",
        label: "成员管理",
        icon: "👥",
        needsRole: "full",
      },
      {
        href: "/me/profile/access-requests",
        label: "访问申请",
        icon: "🔑",
        needsRole: "full",
      },
    ],
  },
  {
    title: "⚙️ 系统配置",
    items: [
      {
        href: "/me/profile/models",
        label: "LLM 模型",
        icon: "🧮",
        needsRole: "full",
      },
      {
        href: "/me/profile/asr",
        label: "ASR 词表",
        icon: "🎙",
        needsRole: "full",
      },
      { href: "/me/profile/voiceprints", label: "声纹库", icon: "🗣" },
      {
        href: "/me/profile/cron",
        label: "定期巡检",
        icon: "⏰",
        needsRole: "full",
      },
      {
        href: "/me/profile/audit",
        label: "操作日志",
        icon: "📜",
        needsRole: "full",
      },
    ],
  },
];

function isItemVisible(item: NavItem, role: string): boolean {
  if (!item.needsRole) return true;
  if (item.needsRole === "full") return FULL_ADMIN_ROLES.has(role);
  if (item.needsRole === "manager+")
    return FULL_ADMIN_ROLES.has(role) || role === "manager";
  return true;
}

export default function WorkstationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (alive) {
          setMe(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
        // api.ts handleAuthError 已 redirect /login
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <p className="text-sm text-zinc-500">加载中…</p>
      </div>
    );
  }
  if (!me) return null;

  const role = me.role;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-20 lg:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            workstation
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            我的工作站
            <span className="ml-3 text-sm font-normal text-zinc-500">
              {me.name} · {me.workspace_name}
            </span>
          </h1>
        </div>
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← 首页
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="space-y-5">
            {NAV_GROUPS.map((g) => {
              const visibleItems = g.items.filter((it) => isItemVisible(it, role));
              if (visibleItems.length === 0) return null;
              return (
                <div key={g.title}>
                  <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
                    {g.title}
                  </div>
                  <ul className="space-y-0.5">
                    {visibleItems.map((it) => (
                      <li key={it.href}>
                        <NavLink
                          item={it}
                          active={isActive(pathname, it.href, it.external)}
                          badge={
                            it.badgeKey
                              ? (me.task_counts?.[it.badgeKey] as number) ?? 0
                              : 0
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string, external?: boolean): boolean {
  if (external) return false;
  // 完全匹配 或 子路径匹配 (但 /me/profile 完全匹配, 不匹配 /me/profile/agents)
  if (href === "/me/profile") return pathname === "/me/profile";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  active,
  badge,
}: {
  item: NavItem;
  active: boolean;
  badge: number;
}) {
  const base =
    "group flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition";
  const tone = active
    ? "bg-accent-500/15 text-accent-300"
    : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100";
  return (
    <Link href={item.href} className={`${base} ${tone}`}>
      <span className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden>
          {item.icon}
        </span>
        <span>{item.label}</span>
        {item.external && (
          <span className="text-[10px] text-zinc-600" aria-hidden>
            ↗
          </span>
        )}
      </span>
      {badge > 0 && (
        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
          {badge}
        </span>
      )}
    </Link>
  );
}
