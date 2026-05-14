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
  /** badge 数 (从 me.task_counts 取). v26.14: 加 approval_pending_total = kb + memory 合并 */
  badgeKey?: "kb_sedimentation_pending" | "approval_pending_total";
  /** external = 跳走 (不是子页) */
  external?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

// v26.14-P1: sidebar 重拼 4 → 5 块. 按 "用户 心智 任务" 划分, 不再 按 "技术实体".
// 老 4 块: 我 / AI 数据中心 / 工作空间 / 系统配置 — AI/KB/Memory 全 混在 一块, 会议
// 不见踪影 (要走 顶部 链接 跳), 用户 找不到 路.
// 新 5 块:
//   🪪 我              — 身份 + 任务 + 看板 (一切 从 "我" 开始)
//   🤖 我的 AI 团队    — AI 专家 配置 + 模板 (跟 大脑 / 经验 拆开 — 这是 "管 AI 本身")
//   🧠 知识 与 经验    — KB (书架) + Memory (经验) + 审批 + 血缘 (这是 "管 AI 的 大脑")
//   🎙️ 会议 系统       — 历史/新建/声纹/ASR (会议 是 经验 产出 触发器, 单成一块 更清)
//   ⚙️ 系统 配置       — 空间/成员/LLM/巡检/日志 (admin 用 — manager 平时 不进)
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
    title: "🤖 我的 AI 团队",
    items: [
      { href: "/", label: "AI 卡片浏览", icon: "🏠", external: true },
      { href: "/me/profile/agents", label: "AI 专家管理", icon: "🤖" },
      {
        href: "/me/profile/agents/template",
        label: "AI 模板生成器",
        icon: "✨",
        needsRole: "full",
      },
    ],
  },
  {
    title: "🧠 知识 与 经验",
    items: [
      { href: "/me/profile/knowledge", label: "知识库 (📚 书架)", icon: "📚" },
      { href: "/me/profile/memory", label: "长期记忆 (🧠 经验)", icon: "🧠" },
      {
        href: "/me/profile/sedimentation",
        label: "审批中心",
        icon: "🔔",
        // v26.14-P1: 合并 kb_sedimentation + memory_draft 两类 pending 草稿 数
        badgeKey: "approval_pending_total",
      },
      {
        href: "/me/profile/lineage",
        label: "全景血缘图",
        icon: "🌐",
      },
    ],
  },
  {
    title: "🎙️ 会议 系统",
    items: [
      { href: "/meetings", label: "历史会议", icon: "📜", external: true },
      { href: "/meetings/new", label: "新建会议", icon: "➕", external: true },
      { href: "/me/profile/voiceprints", label: "声纹库", icon: "🗣" },
      {
        href: "/me/profile/asr",
        label: "ASR 词表",
        icon: "🎙",
        needsRole: "full",
      },
    ],
  },
  {
    title: "⚙️ 系统 配置",
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
      {
        href: "/me/profile/models",
        label: "LLM / 检索 API",
        icon: "🧮",
        needsRole: "full",
      },
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

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {/* v26.14-P1: 顶部 心智模型 mini 卡 — 一眼 看懂 4 个 实体 的 关系.
              新用户 友好, 老用户 滑过去 也 不占 主 space. */}
          <MindMapCard />
          <nav className="mt-4 space-y-5">
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
                          badge={computeBadge(it, me)}
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

// v26.14-P1: badge 计数 helper — approval_pending_total 是 合并 kb + memory 草稿
function computeBadge(item: NavItem, me: Me): number {
  if (!item.badgeKey) return 0;
  if (item.badgeKey === "approval_pending_total") {
    return (
      (me.task_counts?.kb_sedimentation_pending ?? 0) +
      (me.task_counts?.memory_draft_pending ?? 0)
    );
  }
  return (me.task_counts?.[item.badgeKey] as number) ?? 0;
}

// v26.14-P1: 心智模型 mini 卡 — 把 4 个 核心实体 的 关系 一图 讲清.
// 帮 新用户 + 我们 自己 不 迷路 — 因为 实体 多, 关系 复杂.
function MindMapCard() {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        <span>🪜</span>
        <span>心智 模型</span>
      </div>
      <div className="space-y-1.5 text-[11px] leading-4">
        <div className="text-zinc-200">🤖 <span className="font-medium">AI 专家</span></div>
        <div className="ml-3 flex items-baseline gap-1.5 text-zinc-400">
          <span className="text-zinc-600">┣</span>
          <span>📚 书架</span>
          <span className="text-zinc-600">— 查得到 的 资料</span>
        </div>
        <div className="ml-3 flex items-baseline gap-1.5 text-zinc-400">
          <span className="text-zinc-600">┣</span>
          <span>🧠 经验</span>
          <span className="text-zinc-600">— 已 记住 的 事</span>
        </div>
        <div className="ml-3 flex items-baseline gap-1.5 text-zinc-400">
          <span className="text-zinc-600">┗</span>
          <span>🎙️ 会议</span>
          <span className="text-zinc-600">— 产出 上面 两者</span>
        </div>
      </div>
    </div>
  );
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
    "group relative flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition";
  // v26.8-UI-08: 选中态加 border-l + 更强视觉反馈
  const tone = active
    ? "bg-accent-500/15 text-accent-300 border-l-2 border-accent-500"
    : "text-zinc-400 border-l-2 border-transparent hover:bg-ink-800 hover:text-zinc-100";
  return (
    <Link href={item.href} className={`${base} ${tone}`}>
      <span className="flex items-center gap-2">
        <span className="text-base leading-none" aria-hidden>
          {item.icon}
        </span>
        <span>{item.label}</span>
        {item.external && (
          <span className="text-[10px] text-zinc-700 opacity-0 group-hover:opacity-100 transition" aria-hidden>
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
