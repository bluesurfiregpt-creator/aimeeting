"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";
import DirectivePanel from "./DirectivePanel";
import NotificationBell from "./NotificationBell";
import ReportPanel from "./ReportPanel";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

/**
 * Top-right strip showing 工作空间 + 用户 + 登出. Also responsible for the
 * redirect-on-401 fallback: on mount we hit /api/auth/me, and if 401 we
 * push to /login (unless we're already there).
 */
export default function AuthHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [directiveOpen, setDirectiveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // v26.4 Platform Admin: 后端轻量 GET /api/super/me 判断当前 user 是否在 env 白名单
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    if (PUBLIC_PATHS.has(pathname || "")) {
      setLoading(false);
      return;
    }
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
        // api.ts already pushes to /login on 401; no-op here
      });
    // v26.4: 并行查 是否 super admin (不阻塞 me 渲染)
    api
      .superMe()
      .then((r) => { if (alive) setIsPlatformAdmin(r.is_platform_admin); })
      .catch(() => { /* 默默忽略 — 非超管 401/403 也不报错 */ });
    return () => { alive = false; };
  }, [pathname]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }, [router]);

  if (loading || PUBLIC_PATHS.has(pathname || "")) return null;

  // v26.5-P0-fix3: me 拿不到 (eg cookie 还在 但 workspace 已删 / 死会话) 时,
  // 给个最小退出 UI 让用户至少能登出, 不被一堆 toast 卡死无路可走.
  // (注: api.ts handleAuthError 会自动跳 /login, 这里只是 fallback 防御.)
  if (!me) {
    return (
      <div className="fixed right-4 top-3 z-30 flex items-center gap-2">
        <div className="flex items-center gap-3 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 backdrop-blur">
          <span className="text-xs text-rose-200">⚠️ 会话异常</span>
          <button
            onClick={logout}
            className="text-xs text-zinc-300 hover:text-rose-300"
          >
            退出重登
          </button>
        </div>
      </div>
    );
  }

  // v26.5: manager 取代 v21 expert 作为 "部门 AI 维护人"
  // v22 + v26.5: 看板入口给 leader/admin/owner/manager(+ 兼容 expert)看到;member 隐藏
  const showDashboardBtn =
    me.role === "owner" ||
    me.role === "admin" ||
    me.role === "leader" ||
    me.role === "manager" ||
    me.role === "expert"; // v21 兼容
  // v26.5: 后台入口给 leader/admin/owner/manager 看到.manager 进去 只显示部分 tab
  // (见 admin/layout.tsx).member 不能进 admin.
  const showAdminBtn =
    me.role === "owner" ||
    me.role === "admin" ||
    me.role === "leader" ||
    me.role === "manager" ||
    me.role === "expert"; // v21 兼容

  return (
    <>
      <div className="fixed right-4 top-3 z-30 flex items-center gap-2">
        {/* v26.4 Platform Admin · 仅 PLATFORM_ADMIN_EMAILS 白名单内邮箱显示 ⚡ 入口 */}
        {isPlatformAdmin && (
          <Link
            href="/super"
            data-testid="super-open-btn"
            title="平台超管 (跨 workspace 列表 + 切换 + 代客建)"
            aria-label="平台超管"
            className="grid h-8 w-8 place-items-center rounded-full border border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
          >
            ⚡
          </Link>
        )}
        {showAdminBtn && (
          <Link
            href="/admin/agents"
            data-testid="admin-open-btn"
            title="系统后台(AI 配置 / 团队 / 演示数据 等)"
            aria-label="系统后台"
            className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        )}
        {showDashboardBtn && (
          <Link
            href="/dashboard"
            data-testid="dashboard-open-btn"
            title="数据看板"
            aria-label="数据看板"
            className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 3v18h18" />
              <path d="M7 14l3-3 4 4 5-7" />
            </svg>
          </Link>
        )}
        <button
          type="button"
          data-testid="report-open-btn"
          onClick={() => setReportOpen(true)}
          title="上报问题(任何成员可发起)"
          aria-label="上报问题"
          className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 11l18-7-7 18-2-8-9-3z" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="directive-open-btn"
          onClick={() => setDirectiveOpen(true)}
          title="下达指令(自然语言 → 任务)"
          className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
          aria-label="下达指令"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <Link
          href="/messages"
          data-testid="messages-open-btn"
          title="消息中心"
          aria-label="消息中心"
          className="grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </Link>
        <NotificationBell />
        <div className="flex items-center gap-3 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1.5 backdrop-blur">
          <span className="text-xs text-zinc-500">{me.workspace_name}</span>
          <span className="text-zinc-700">·</span>
          <Link
            href="/me"
            className="text-xs text-zinc-300 hover:text-zinc-100"
            title="我的待办"
          >
            {me.name}
          </Link>
          <button
            onClick={logout}
            className="ml-1 text-xs text-zinc-500 hover:text-rose-400"
          >
            登出
          </button>
        </div>
      </div>
      <DirectivePanel
        open={directiveOpen}
        onClose={() => setDirectiveOpen(false)}
      />
      <ReportPanel
        open={reportOpen}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}
