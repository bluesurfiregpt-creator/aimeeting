"use client";

/**
 * v27.0-mobile P10 · /m/me · 我的页 (个人中心简版).
 *
 * 入口: PageHeader 右上角 ⚙ icon (之前 404).
 *
 * 内容 (mvp):
 *   - 头像 (首字母色块) + 名字 + 邮箱 + 角色 chip
 *   - 当前工作区 (显示, 不切换)
 *   - 「关于」link → /m/about (复用 wechat-miniprogram 同名? 不, 不必, mvp 只 link 到外部 manual)
 *   - 「退出登录」红色按钮
 *   - 底部版本号
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { clearAllCache } from "@/lib/mobile/swrCache";
import Toast from "@/components/mobile/Toast";
import ConfirmDialog from "@/components/mobile/ConfirmDialog";

type MeInfo = {
  user_id: string;
  name: string;
  email: string | null;
  workspace_name: string;
  role: string;
  department: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  leader: "Leader",
  admin: "Admin",
  expert: "Expert",
  member: "Member",
};

const ROLE_CHIP: Record<string, string> = {
  owner: "bg-violet-500/15 text-violet-300",
  leader: "bg-amber-500/15 text-amber-300",
  admin: "bg-sky-500/15 text-sky-300",
  expert: "bg-emerald-500/15 text-emerald-300",
  member: "bg-zinc-700 text-zinc-300",
};

export default function MobileMePage() {
  const router = useRouter();
  const [me, setMe] = useState<MeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (!alive) return;
        setMe({
          user_id: m.user_id,
          name: m.name,
          email: m.email || null,
          workspace_name: m.workspace_name,
          role: m.role,
          department: m.department || null,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      clearAllCache();
      // 跳登录页
      router.replace("/login");
    } catch (e) {
      setToast({
        kind: "error",
        text: `登出失败: ${e instanceof Error ? e.message : String(e)}`,
      });
      setLoggingOut(false);
    }
  }, [loggingOut, router]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-32 animate-pulse rounded-2xl bg-ink-900" />
        <div className="h-12 animate-pulse rounded-xl bg-ink-900" />
      </div>
    );
  }

  return (
    /* P18: min-h-screen + flex col → mt-auto 把退出按钮推到屏幕底.
       min-h-full 在 layout main (flex-1) 里算 0%; 100vh 才稳. */
    <div className="flex min-h-screen flex-col">
      {/* TopBar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link
          href="/m"
          className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-semibold text-zinc-50">
          我的
        </h1>
      </div>

      <main className="flex flex-1 flex-col space-y-5 p-4 pb-6">
        {/* 档案卡 */}
        {me ? (
          <section
            className="rounded-2xl bg-ink-900 p-5"
            data-testid="mobile-me-profile"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-accent-500 text-[24px] font-semibold text-white">
                {me.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[20px] font-semibold text-zinc-50">
                  {me.name}
                </p>
                <p className="mt-1 flex items-center gap-2 truncate text-[14px] text-zinc-400">
                  <span
                    className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[13px] font-medium ${
                      ROLE_CHIP[me.role] || ROLE_CHIP.member
                    }`}
                  >
                    {ROLE_LABEL[me.role] || me.role}
                  </span>
                  {me.email ? <span className="truncate">{me.email}</span> : null}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* 工作区 / 部门 信息 */}
        {me ? (
          <section className="rounded-2xl bg-ink-900 px-5 py-2">
            <Row label="工作区" value={me.workspace_name} />
            {me.department ? (
              <Row label="所属部门" value={me.department} />
            ) : null}
          </section>
        ) : null}

        {/* 关于 + 反馈 (mvp 文字提示) */}
        <section className="rounded-2xl bg-ink-900 px-5 py-2">
          <Row label="客服 / 反馈" value="联系管理员" />
          <Row label="环境" value="生产" />
        </section>

        {/* 退出登录 — mt-auto 推到底, 内容少时也贴底 */}
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="mt-auto flex h-12 w-full items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/[0.06] text-[15px] font-medium text-rose-300 active:scale-[0.98] active:bg-rose-500/[0.12]"
          data-testid="mobile-me-logout"
        >
          退出登录
        </button>

        {/* 版本号 */}
        <p className="text-center text-[13px] text-zinc-500">
          Aimeeting · v27.0-mobile
        </p>
      </main>

      <ConfirmDialog
        open={logoutOpen}
        title="确认退出登录?"
        body="退出后需要重新输入邮箱密码登录."
        confirmLabel="退出"
        cancelLabel="再想想"
        danger
        busy={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 py-3 last:border-b-0">
      <span className="text-[14px] text-zinc-400">{label}</span>
      <span className="truncate text-[15px] text-zinc-100">{value}</span>
    </div>
  );
}
