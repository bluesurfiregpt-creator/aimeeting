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
    return () => { alive = false; };
  }, [pathname]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }, [router]);

  if (loading || PUBLIC_PATHS.has(pathname || "") || !me) return null;

  // v22: 看板入口给 leader/admin/owner/expert 看到;member 隐藏
  const showDashboardBtn =
    me.role === "owner" ||
    me.role === "admin" ||
    me.role === "leader" ||
    me.role === "expert";

  return (
    <>
      <div className="fixed right-4 top-3 z-30 flex items-center gap-2">
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
