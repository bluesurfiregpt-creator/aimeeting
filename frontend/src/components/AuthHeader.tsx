"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";
import NotificationBell from "./NotificationBell";

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

  return (
    <div className="fixed right-4 top-3 z-30 flex items-center gap-2">
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
  );
}
