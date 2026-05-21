"use client";

/**
 * v27.0-mobile P21 原生 N-1 第 6 刀 · "试用新版会议室" 入口.
 *
 * 仅在 小程序 webview 内 显 (window.__wxjs_environment === 'miniprogram').
 * 点击:
 *   1. 调 POST /api/auth/exchange-token 用 cookie 换 token
 *   2. wx.miniProgram.navigateTo 跳原生 meeting 页, token 通过 query 传
 *   3. 原生页 onLoad 读 query 写 storage, 之后自己用 Bearer 调 API
 *
 * 不在 小程序 webview 内时 整个组件 不渲染 (普通浏览器看不到).
 *
 * v1.0.1 发版前的临时保护:
 *   线上小程序 v1.0.0 没有 /pages/meeting/meeting 原生页. 如果让按钮可点,
 *   用户点 navigateTo 会 fail. 用 ENABLED feature flag 关掉.
 *   v1.0.1 小程序上线后 改为 true + 部署 H5 即可启用.
 */

// ⚠️ 等小程序 v1.0.1 (含 pages/meeting + pages/create 原生页) 通过审核 + 发布后,
// 改为 true 重新部署 H5. 在那之前 按钮不显, 防用户 navigateTo 到不存在的页.
const NATIVE_MEETING_ENABLED = false;

import { useEffect, useState } from "react";

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

function isInMiniprogram(): boolean {
  if (typeof window === "undefined") return false;
  return window.__wxjs_environment === "miniprogram";
}

export default function NativeMeetingEntry({
  meetingId,
}: {
  meetingId: string;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // SSR 阶段 window 不可用 → 不渲染
    if (isInMiniprogram()) setShow(true);
  }, []);

  // feature flag — v1.0.1 上线前 暂时全关
  if (!NATIVE_MEETING_ENABLED) return null;
  if (!show) return null;

  const handleJump = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // 1. 换 token
      const r = await fetch("/api/auth/exchange-token", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      const { token, expires_at } = await r.json();

      // 2. 跳原生页, token + exp 通过 query 传
      const url =
        `/pages/meeting/meeting?meeting_id=${encodeURIComponent(meetingId)}` +
        `&t=${encodeURIComponent(token)}` +
        `&exp=${encodeURIComponent(expires_at)}`;
      if (!window.wx?.miniProgram?.navigateTo) {
        throw new Error("不在小程序里 — 此入口仅在微信小程序 webview 可用");
      }
      window.wx.miniProgram.navigateTo({
        url,
        fail: (err) => {
          console.error("[native-entry] navigateTo fail", err);
          setError("跳原生页失败,试试在小程序里重新进");
          setBusy(false);
        },
      });
      // navigateTo 成功不会再回来这页, 不必 setBusy(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-violet-500/30 bg-violet-500/[0.08] p-3">
      <div className="flex items-center gap-3">
        <div className="text-2xl">📱</div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-violet-200">
            试用 原生 会议室体验
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-zinc-400">
            原生录音 / 转录 更稳, 议程提醒 更跟手
          </p>
        </div>
        <button
          type="button"
          onClick={handleJump}
          disabled={busy}
          className="shrink-0 rounded-full bg-violet-500 px-4 py-2 text-[13px] font-medium text-white active:scale-[0.97] active:bg-violet-600 disabled:opacity-50"
          data-testid="native-meeting-entry"
        >
          {busy ? "跳转中…" : "进入 →"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}
