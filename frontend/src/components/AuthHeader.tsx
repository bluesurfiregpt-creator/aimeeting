"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";
import NotificationBell from "./NotificationBell";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

// v26.11-fix3: 会议室 (/meeting/<id>) 是 二级页面, 已经 有 自己 的 顶部 chrome
// (MeetingRoomTopBar — 标题/状态/计时/退出会议). 全局 顶栏 (⚡超管 / 🔔通知 /
// workspace / 退出) 在 会议室 里 是 多余 的, 会 抢 焦点 + 占空间. 隐藏掉.
function isMeetingRoomPath(pathname: string | null): boolean {
  if (!pathname) return false;
  // 匹配 /meeting/<id> 或 /meeting/<id>/<anything>
  return /^\/meeting\/[^/]+/.test(pathname);
}

/**
 * v26.5-WS: 顶栏极简化到 4 项 — [⚡超管 | 🔔通知 | 👤名字 | 退出].
 * 之前的 ⚙️ 后台 / 📊 看板 / 📨 上报 / ✏️ 指令 / 📬 消息 全部移到 工作站
 * (/me/profile sidebar).
 *
 * Top-right strip. Also responsible for the redirect-on-401 fallback:
 * on mount we hit /api/auth/me, and if 401 we push to /login.
 */
export default function AuthHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  // v26.4 Platform Admin: 后端轻量 GET /api/super/me 判断当前 user 是否在 env 白名单
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    if (PUBLIC_PATHS.has(pathname || "") || isMeetingRoomPath(pathname)) {
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

  if (loading || PUBLIC_PATHS.has(pathname || "") || isMeetingRoomPath(pathname)) return null;

  // v26.5-P0-fix3: me 拿不到 (eg cookie 还在 但 workspace 已删 / 死会话) 时,
  // 给个最小退出 UI 让用户至少能登出, 不被一堆 toast 卡死无路可走.
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

  return (
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
      <NotificationBell />
      {/* v26.5-WS: 我的工作站 入口 (= 用户名 + workspace 名)
          统一替代之前的 ⚙️ 后台 / 📊 看板 / 📨 上报 / ✏️ 指令 / 📬 消息. */}
      <Link
        href="/me/profile"
        className="flex items-center gap-3 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1.5 backdrop-blur hover:border-accent-500/40"
        title="我的工作站 — 身份 / AI 专家 / 知识库 / 设置 全部在这"
        data-testid="me-profile-link"
      >
        <span className="text-xs text-zinc-500">{me.workspace_name}</span>
        <span className="text-zinc-700">·</span>
        <span className="text-xs text-zinc-200">👤 {me.name}</span>
      </Link>
      <button
        onClick={logout}
        title="退出登录"
        className="text-xs text-zinc-500 hover:text-rose-400"
      >
        退出
      </button>
    </div>
  );
}
