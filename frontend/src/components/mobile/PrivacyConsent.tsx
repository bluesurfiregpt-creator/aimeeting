"use client";

/**
 * v27.0-mobile P20 · 隐私协议 同意 弹窗.
 *
 * 微信 2023.9 起 强制 — 用户 首次 使用 前 必须 显式 同意 隐私政策.
 * 不弹窗 / 默认勾选 = 审核 100% 被打回.
 *
 * 行为:
 *   - mount 时 检测 localStorage 'aimeeting_privacy_consent_v1'
 *   - 未同意 → 弹 fixed 全屏 modal (拦截所有交互, 不可关闭)
 *   - 同意 → set flag + onAccept callback (一般 关 modal)
 *   - "查看完整版" → 跳 /m/privacy
 *   - "暂不使用" → 简单提示 + 留在 modal (mvp 不导航;若 用户 关 webview 即可)
 *
 * 版本化: localStorage key 含 _v1, 若 政策 重大 修改 → 改 _v2 → 已同意 用户
 * 重新弹.
 *
 * 注意:
 *   - 本组件 仅在 /m layout 用 (其他 子页 不重复 弹)
 *   - 弹的 时机 是 mount, 不卡 SSR / 等数据
 *   - localStorage 在 SSR 不可用 — 用 useEffect 包
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const CONSENT_KEY = "aimeeting_privacy_consent_v1";
const CONSENT_VALUE = "accepted";

// In-memory session flag — 给 localStorage 在 webview 内被隔离 / 禁用 的
// 情况兜底. 同一 session (无刷新) 同意过就不再弹.
let __sessionAcceptedFlag = false;

export default function PrivacyConsent() {
  // 默认 closed — SSR 不渲染 modal (避免 闪烁); useEffect 后 才 决定 是否 弹
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [showDeclinedHint, setShowDeclinedHint] = useState(false);

  useEffect(() => {
    // 优先看 sessionAcceptedFlag (in-memory, 防 localStorage 异常时永远弹)
    if (__sessionAcceptedFlag) return;
    try {
      const v = localStorage.getItem(CONSENT_KEY);
      if (v !== CONSENT_VALUE) {
        setOpen(true);
      } else {
        __sessionAcceptedFlag = true;
      }
    } catch {
      // 浏览器 / webview 禁用 localStorage:
      // 之前的逻辑是兜底弹窗 → 弹窗永不消失, 挡死整个 nav. 改成 弹一次,
      // 用户点同意后 用 in-memory flag 记, 同 session 不再弹.
      setOpen(true);
    }
  }, []);

  const handleAccept = useCallback(() => {
    if (pending) return;
    setPending(true);
    try {
      localStorage.setItem(CONSENT_KEY, CONSENT_VALUE);
    } catch {
      // 写入失败 (隐身模式 / webview 隔离) — 用 in-memory flag 兜底, 本 session 不重弹
    }
    __sessionAcceptedFlag = true;
    setOpen(false);
    setPending(false);
  }, [pending]);

  const handleDecline = useCallback(() => {
    // 之前的 bug: 点 decline 只显提示, modal 不关 → 用户 永远 被 mask 锁死,
    // 点不动 nav 4 tab. 改成: 点 decline 关 modal + 跳隐私详情页,
    // 让用户重新决定. 隐私详情页本身在 SKIP_PRIVACY_PATHS 里不会再弹.
    setShowDeclinedHint(true);
    // 留 1 秒给用户看一眼提示, 然后跳
    setTimeout(() => {
      setOpen(false);
      if (typeof window !== "undefined") {
        window.location.href = "/m/privacy";
      }
    }, 1500);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-title"
      data-testid="mobile-privacy-consent"
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-ink-900 p-5 sm:rounded-2xl"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <h2 id="privacy-title" className="text-[18px] font-semibold text-zinc-50">
          欢迎使用 智囊团
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-300">
          在使用本产品前, 请仔细阅读{" "}
          <Link
            href="/m/privacy"
            className="text-violet-300 underline underline-offset-2"
          >
            《隐私保护指引》
          </Link>{" "}
          全文. 你需 知悉:
        </p>

        <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-zinc-300">
          <li className="flex gap-2">
            <span className="text-violet-300">●</span>
            为 提供 实时转录 / 说话人识别, 需 在 你 主动开启 会议时 调用
            麦克风, 退会即停.
          </li>
          <li className="flex gap-2">
            <span className="text-violet-300">●</span>
            为 提供 AI 议程拆解 + 纪要, 你的 会议内容 / 上传附件 会 发送 给
            阿里云 DashScope (通义千问) 处理.
          </li>
          <li className="flex gap-2">
            <span className="text-violet-300">●</span>
            为 提供 一键登录 体验, 你 主动 点击 "微信手机号 一键登录"
            时, 我们会 读取 你的 微信注册手机号 (仅用于 匹配 系统账号, 不
            外发).
          </li>
          <li className="flex gap-2">
            <span className="text-violet-300">●</span>
            所有 数据 存储 在 中国境内, 不跨境 不出售 不广告投放.
          </li>
          <li className="flex gap-2">
            <span className="text-violet-300">●</span>
            你 可随时 在 "我的 / 设置" 撤回 单项授权 或 注销账号.
          </li>
        </ul>

        {showDeclinedHint ? (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
            未同意 暂时 无法 使用 本产品. 如有疑问 请 联系 工作区 管理员.
            若 不再 使用, 直接 关闭 本页 即可.
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleDecline}
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-ink-800 text-[15px] font-medium text-zinc-300 active:scale-[0.98]"
            data-testid="mobile-privacy-decline"
          >
            暂不使用
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={pending}
            className="flex h-12 flex-[1.5] items-center justify-center rounded-xl bg-violet-500 text-[15px] font-medium text-white shadow-lg shadow-violet-500/20 active:scale-[0.98] active:bg-violet-600 disabled:opacity-50"
            data-testid="mobile-privacy-accept"
          >
            同意并继续
          </button>
        </div>

        <p className="mt-3 text-center text-[12px] text-zinc-500">
          点 "同意并继续" 即表示 你已阅读 并 同意《隐私保护指引》全部内容.
        </p>
      </div>
    </div>
  );
}
