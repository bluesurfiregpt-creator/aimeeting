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
 *
 * v1.4.0 Saga D · 浅色化 (跟 /m today 一致, iOS 浅色).
 *
 * v1.4.0 Saga I · 新增 "切到 Web 管理" 入口 (R6 改版后跳 /workstation 不再是 /admin).
 *   - 仅 leader+ (workspace_creator / leader / admin) 显示
 *   - 点击 → 新窗口打开 /workstation (web 端工作站, R6 落地)
 *   - 在小程序 webview 内 跳出微信: 走 web-view 标准导航
 *
 * v1.4.0 Saga P-1 · 顶部加 Mira AI 智囊 hero (MAGlowBanner tone="mira"):
 *   - /api/v2/profile/ai-stats — 近 7 天采纳率 + 最热门 AI
 *   - 声纹库 row 加 counter subline ("6 条声纹 · 上次更新 5 天前")
 *   - /api/v2/profile/voiceprints-stats
 *   - 保留 Saga D+I 的所有业务入口 (工作区, "切到 web 管理 Leader+", 客服反馈, 退出)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { clearAllCache } from "@/lib/mobile/swrCache";
import Toast from "@/components/mobile/Toast";
import ConfirmDialog from "@/components/mobile/ConfirmDialog";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";
import {
  MAGlowBanner,
  MAIBadge,
  type V2ProfileAIStats,
  type V2ProfileVoiceprintsStats,
} from "@/components/mobile/v2";

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
  workspace_creator: "创建者",
  leader: "Leader",
  admin: "Admin",
  agent_owner: "AI 主理人",
  expert: "Expert",
  member: "Member",
};

// 浅色 iOS chip — 跟 round-3 同套
const ROLE_CHIP: Record<string, { bg: string; fg: string }> = {
  owner: {
    bg: "rgba(94,92,230,0.10)",
    fg: MR_COLORS.systemPurple,
  },
  workspace_creator: {
    bg: "rgba(94,92,230,0.10)",
    fg: MR_COLORS.systemPurple,
  },
  leader: {
    bg: "rgba(255,159,10,0.12)",
    fg: MR_COLORS.systemOrange,
  },
  admin: {
    bg: "rgba(0,122,255,0.10)",
    fg: MR_COLORS.systemBlue,
  },
  agent_owner: {
    bg: "rgba(52,199,89,0.12)",
    fg: MR_COLORS.systemGreen,
  },
  expert: {
    bg: "rgba(52,199,89,0.12)",
    fg: MR_COLORS.systemGreen,
  },
  member: {
    bg: MR_COLORS.bgInputFill,
    fg: MR_COLORS.textSecondary,
  },
};

// v1.4.0 Saga I — leader+ 才能跳 web 管理. 跟 voiceprint 页同一套白名单.
const LEADER_ROLES = new Set([
  "workspace_creator",
  "leader",
  "admin",
  "owner",
]);

// v1.4.0 Saga P-1 — 简单 fetch (mock endpoint 不带 auth 校验). 与 /m/page.tsx 同写法.
async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

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

  // v1.4.0 Saga P-1 — Mira AI 智囊 hero + 声纹库 counter
  const [aiStats, setAiStats] = useState<V2ProfileAIStats | null>(null);
  const [vpStats, setVpStats] = useState<V2ProfileVoiceprintsStats | null>(
    null,
  );

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

  // v1.4.0 Saga P-1 — 拉 Mira AI hero + 声纹 counter (并行, 失败容错)
  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      jget<V2ProfileAIStats>("/api/v2/profile/ai-stats"),
      jget<V2ProfileVoiceprintsStats>("/api/v2/profile/voiceprints-stats"),
    ]).then(([aiRes, vpRes]) => {
      if (!alive) return;
      if (aiRes.status === "fulfilled") setAiStats(aiRes.value);
      if (vpRes.status === "fulfilled") setVpStats(vpRes.value);
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
      <div
        className="space-y-4 p-4"
        style={{ background: MR_COLORS.bgGroupedPrimary, minHeight: "100%" }}
      >
        <div
          className="h-32 animate-pulse rounded-2xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
        <div
          className="h-12 animate-pulse rounded-xl"
          style={{ background: "rgba(60,60,67,0.06)" }}
        />
      </div>
    );
  }

  const isLeaderPlus = me && LEADER_ROLES.has(me.role);

  return (
    /* P18: min-h-screen + flex col → mt-auto 把退出按钮推到屏幕底.
       min-h-full 在 layout main (flex-1) 里算 0%; 100vh 才稳. */
    <div
      className="flex min-h-screen flex-col"
      style={{ background: MR_COLORS.bgGroupedPrimary }}
    >
      {/* TopBar — 浅色 iOS */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-3 backdrop-blur"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          background: "rgba(242,242,247,0.92)",
          borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        }}
      >
        <Link
          href="/m"
          className="-ml-2 flex h-10 w-10 items-center justify-center"
          style={{ color: MR_COLORS.systemBlue }}
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1
          className="flex-1 truncate text-[18px] font-semibold"
          style={{ color: MR_COLORS.textPrimary }}
        >
          我的
        </h1>
      </div>

      <main className="flex flex-1 flex-col space-y-5 p-4 pb-6">
        {/* v1.4.0 Saga Q (Phase 1 P0 M6-01) — glow hero 移到最顶 (设计稿顺序) */}
        {aiStats ? <MiraAIStatsHero data={aiStats} /> : null}

        {/* 档案卡 */}
        {me ? (
          <section
            className="rounded-2xl p-5"
            style={{
              background: MR_COLORS.bgWhite,
              border: `0.5px solid ${MR_COLORS.hairline}`,
            }}
            data-testid="mobile-me-profile"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-sky-500 text-[24px] font-semibold text-white">
                {me.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[20px] font-semibold"
                  style={{ color: MR_COLORS.textPrimary }}
                >
                  {me.name}
                </p>
                <p
                  className="mt-1 flex items-center gap-2 truncate text-[14px]"
                  style={{ color: MR_COLORS.textSecondary }}
                >
                  <span
                    className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[13px] font-medium"
                    style={(ROLE_CHIP[me.role] || ROLE_CHIP.member) as React.CSSProperties}
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
          <section
            className="rounded-2xl px-5 py-2"
            style={{
              background: MR_COLORS.bgWhite,
              border: `0.5px solid ${MR_COLORS.hairline}`,
            }}
          >
            <Row label="工作区" value={me.workspace_name} />
            {me.department ? (
              <Row label="所属部门" value={me.department} last />
            ) : null}
          </section>
        ) : null}

        {/* v1.4.0 Saga I — leader+ 看到的 "切到 web 管理" 入口.
            R6 落地 Workstation 后, 目的地 = /workstation (而不是老 /admin).
            桌面 /admin → /me/profile/agents 老 redirect 仍在, 但新动线一律走 /workstation. */}
        {isLeaderPlus ? (
          <WebManagementEntry />
        ) : null}

        {/* P22: 声纹 — 跳录音页. 在小程序 webview 内, 自动跳 原生 voiceprint 页;
            浏览器 / 普通 H5 走 /m/me/voiceprint H5 版.
            等 v1.0.1 小程序发版前, NATIVE_VOICEPRINT_ENABLED=false 时退化全走 H5.
            v1.4.0 Saga P-1: 加 counter subline ("6 条声纹 · 上次更新 5 天前"). */}
        <VoiceprintEntry stats={vpStats} />

        {/* 关于 + 反馈 (mvp 文字提示) */}
        <section
          className="rounded-2xl px-5 py-2"
          style={{
            background: MR_COLORS.bgWhite,
            border: `0.5px solid ${MR_COLORS.hairline}`,
          }}
        >
          <Row label="客服 / 反馈" value="联系管理员" />
          {/* v1.4.0 Saga R (Phase 1 P1 M6-06): 环境 "生产" 用绿色 pill, 跟设计稿
              mobile-screens.jsx:908-912 一致 (rgba(52,199,89,0.14) + #1F8A5B). */}
          <RowPill label="环境" pillLabel="生产" last />
        </section>

        {/* 退出登录 — mt-auto 推到底, 内容少时也贴底.
            v1.4.0 Saga R (Phase 1 P2 M6-07): bg 改成白色 (设计稿 mobile-screens.jsx:916
            `background: '#fff'`), 不再用浅红 urgentBg; active 态走 active:opacity-80
            自然反馈, 不再 inline 红 bg. */}
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="mt-auto flex h-12 w-full items-center justify-center rounded-xl text-[15px] font-medium active:opacity-80"
          style={{
            border: `0.5px solid ${MR_COLORS.urgentBorder}`,
            background: MR_COLORS.bgWhite,
            color: MR_COLORS.systemRed,
          }}
          data-testid="mobile-me-logout"
        >
          退出登录
        </button>

        {/* 版本号 */}
        <p
          className="text-center text-[13px]"
          style={{ color: MR_COLORS.textTertiary }}
        >
          Aimeeting · v1.4.0
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

function Row({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-3"
      style={
        last
          ? undefined
          : { borderBottom: `0.5px solid ${MR_COLORS.hairline}` }
      }
    >
      <span
        className="text-[14px]"
        style={{ color: MR_COLORS.textSecondary }}
      >
        {label}
      </span>
      <span
        className="truncate text-[15px]"
        style={{ color: MR_COLORS.textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * v1.4.0 Saga R (Phase 1 P1 M6-06) · "环境: 生产" 行 — 右侧用绿色 pill.
 * 设计源 mobile-screens.jsx:908-912.
 */
function RowPill({
  label,
  pillLabel,
  last = false,
}: {
  label: string;
  pillLabel: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-3"
      style={
        last
          ? undefined
          : { borderBottom: `0.5px solid ${MR_COLORS.hairline}` }
      }
    >
      <span
        className="text-[14px]"
        style={{ color: MR_COLORS.textSecondary }}
      >
        {label}
      </span>
      <span
        style={{
          background: "rgba(52,199,89,0.14)",
          color: "#1F8A5B",
          padding: "2px 7px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
        }}
        data-testid="mobile-me-env-pill"
      >
        {pillLabel}
      </span>
    </div>
  );
}

// 等 小程序 v1.0.1 (含 pages/voiceprint) 通过审核 + 发布后, 改 true 重新部署 H5
const NATIVE_VOICEPRINT_ENABLED = false;

declare global {
  interface Window {
    __wxjs_environment?: string;
    wx?: {
      miniProgram?: {
        navigateTo: (opts: { url: string; fail?: (err: unknown) => void }) => void;
      };
    };
  }
}

function VoiceprintEntry({
  stats,
}: {
  stats: V2ProfileVoiceprintsStats | null;
}) {
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    const inMp = window.__wxjs_environment === "miniprogram";
    if (!inMp || !NATIVE_VOICEPRINT_ENABLED) {
      // 浏览器 / flag 关 → 走 H5 (Link 自然跳)
      return;
    }
    // 小程序内 + flag 开 → 拦截 Link, 调 exchange-token + navigateTo 原生
    e.preventDefault();
    try {
      const r = await fetch("/api/auth/exchange-token", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { token, expires_at } = await r.json();
      const url =
        `/pages/voiceprint/voiceprint` +
        `?t=${encodeURIComponent(token)}` +
        `&exp=${encodeURIComponent(expires_at)}`;
      window.wx?.miniProgram?.navigateTo({ url });
    } catch (err) {
      console.error("[voiceprint-entry] navigateTo fail", err);
      // fallback 走 H5
      window.location.href = "/m/me/voiceprint";
    }
  };

  // v1.4.0 Saga P-1 — counter subline. mock = "6 条声纹 · 上次更新 5 天前"
  const subline = stats
    ? `${stats.count} 条声纹 · ${stats.last_updated_display}`
    : null;

  return (
    <Link
      href="/m/me/voiceprint"
      onClick={handleClick}
      className="rounded-2xl px-5 py-3 active:opacity-80"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-me-voiceprint-link"
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-col">
          <span
            className="text-[15px] font-medium"
            style={{ color: MR_COLORS.textPrimary }}
          >
            声纹库
          </span>
          {subline ? (
            <span
              className="mt-0.5 truncate text-[12.5px]"
              style={{ color: MR_COLORS.textTertiary }}
              data-testid="mobile-me-voiceprint-subline"
            >
              {subline}
            </span>
          ) : null}
        </div>
        <span
          className="flex items-center gap-1 text-[15px]"
          style={{ color: MR_COLORS.textPrimary }}
        >
          <span
            className="text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            管理
          </span>
          <span style={{ color: MR_COLORS.textTertiary }}>›</span>
        </span>
      </div>
    </Link>
  );
}

/**
 * v1.4.0 Saga P-1 · 顶部 Mira AI 智囊 hero — 近 7 天采纳率 + 最热门 AI.
 *
 * 视觉: 复用已有 MAGlowBanner tone="mira" (紫→粉渐变 + sparkle).
 *
 * v1.4.0 Saga R (Phase 1 P1 M6-02~M6-05): 跟设计稿 mobile-screens.jsx:848-854 对齐.
 *   - M6-02 eyebrow "AI 智囊 · 近 X 天" (强调"AI 智囊"概念, 之前 "MIRA · 近 7 天")
 *   - M6-03 customIcon 用 MAIBadge (圆角方 + 紫蓝渐变 + ⌬, 替代默认 sparkle SVG)
 *   - M6-04 body 完整两句 "最热门的专家是 Aria（X%）。采纳率 Y% 超过团队平均线。"
 *   - M6-05 titleSize 17 (设计稿 hero 大字, atom 默认 14)
 */
function MiraAIStatsHero({
  data,
}: {
  data: V2ProfileAIStats;
}) {
  const router = useRouter();
  const pct = Math.round(data.adoption_rate * 100);
  const popPct = Math.round(data.most_popular_ai.adoption_pct * 100);
  return (
    <MAGlowBanner
      tone="mira"
      eyebrow={`AI 智囊 · 近 ${data.period_days} 天`}
      title={`你采纳了 ${data.adopted}/${data.total_suggestions} 条 AI 建议 (${pct}%)`}
      titleSize={17}
      customIcon={
        <MAIBadge
          name={data.most_popular_ai.name}
          glyph={data.most_popular_ai.glyph}
          gradient_from={data.most_popular_ai.gradient_from}
          gradient_to={data.most_popular_ai.gradient_to}
          size={28}
          ring="rgba(255,255,255,0.30)"
        />
      }
      body={`最热门的专家是 ${data.most_popular_ai.name}(${popPct}%)。采纳率 ${pct}% 超过团队平均线。`}
      cta={`💬 跟 ${data.most_popular_ai.name} 临时聊聊`}
      onCta={() => router.push(`/m/chat/${data.most_popular_ai.id}`)}
    />
  );
}

/**
 * v1.4.0 Saga I — 跨端切到 web 管理.
 *
 * R6 落地 "工作站" 框 后, leader+ 跨端跳目的地 改为 /workstation.
 * (老 /admin redirect 仍存在但新动线不走它.)
 *
 * 行为分支:
 *   - 浏览器 / H5 内 → 直接 window.open("/workstation"), 新 tab 打开
 *   - 小程序 webview 内 → 不能开新 tab, 提示用户复制链接到电脑浏览器
 *     (短期方案: 显 toast + copy. 长期: 用 wx.openLink / wx.showShareMenu 唤起分享)
 */
function WebManagementEntry() {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window === "undefined") return;
    const inMp = window.__wxjs_environment === "miniprogram";
    if (inMp) {
      // 小程序内不能开新 tab — 提示用户去电脑端
      try {
        navigator.clipboard?.writeText(
          window.location.origin + "/workstation",
        );
      } catch {
        /* ignore — 仅复制失败, 仍提示用户 */
      }
      alert("已复制 web 管理链接, 请到电脑浏览器粘贴打开");
      return;
    }
    // 浏览器 / 普通 H5: 新窗口打开 web 工作站
    window.open("/workstation", "_blank", "noopener");
  }, []);

  return (
    <Link
      href="/workstation"
      onClick={handleClick}
      className="rounded-2xl px-5 py-2 active:opacity-80"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-me-workstation-link"
    >
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <span
            className="text-[14px]"
            style={{ color: MR_COLORS.textSecondary }}
          >
            切到 web 管理
          </span>
          <span
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            style={{
              background: "rgba(0,122,255,0.10)",
              color: MR_COLORS.systemBlue,
            }}
          >
            Leader+
          </span>
        </div>
        <span
          className="flex items-center gap-1 text-[15px]"
          style={{ color: MR_COLORS.textPrimary }}
        >
          <span
            className="text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            工作站
          </span>
          <span style={{ color: MR_COLORS.textTertiary }}>›</span>
        </span>
      </div>
    </Link>
  );
}
