/**
 * v27.0-mobile · 小程序 web-view ↔ 小程序原生 桥封装.
 *
 * 微信小程序 web-view 给 H5 注入了 `wx.miniProgram` 全局对象, 提供 5 个 API:
 *   - navigateTo / redirectTo / navigateBack — 跳到小程序原生页
 *   - switchTab — 跳到 tabBar 页
 *   - reLaunch — 重启
 *   - postMessage — 给外层小程序发消息 (但仅在 web-view 销毁/分享/后退 时触发)
 *   - getEnv — 拿环境信息
 *
 * 这个文件给 H5 代码用, 包装好 isInWxMiniProgram 检查:
 *   - 不在小程序里时, 所有调用 noop + 返 false
 *   - 在小程序里, 转发到 wx.miniProgram.*
 *
 * 现在 H5 代码暂时没调任何 wxBridge.* 方法, 但 hook 备好.
 * 后期在小程序里要用原生能力 (分享 / 转发 / 跳小程序页) 时直接调.
 *
 * SSR safe — 服务端调用全部 noop.
 *
 * 参考: https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html
 */

import { isInWxMiniProgram } from "./runtime";

/** 小程序 web-view 注入的全局 (在小程序里时才有). 私有类型, 避免污染 window namespace. */
type WxMiniProgram = {
  navigateTo: (opts: { url: string; success?: () => void; fail?: (err: unknown) => void }) => void;
  redirectTo: (opts: { url: string; success?: () => void; fail?: (err: unknown) => void }) => void;
  switchTab: (opts: { url: string; success?: () => void; fail?: (err: unknown) => void }) => void;
  reLaunch: (opts: { url: string; success?: () => void; fail?: (err: unknown) => void }) => void;
  navigateBack: () => void;
  postMessage: (opts: { data: unknown }) => void;
  getEnv: (cb: (env: { miniprogram: boolean }) => void) => void;
};

function getWx(): WxMiniProgram | null {
  if (!isInWxMiniProgram()) return null;
  if (typeof window === "undefined") return null;
  // wx.miniProgram 由小程序 web-view 自动注入到 H5 全局
  const w = window as unknown as { wx?: { miniProgram?: WxMiniProgram } };
  return w.wx?.miniProgram ?? null;
}

/** 给小程序外层发消息. 注意: 不实时 — 仅 web-view 销毁/分享/后退 时触发. */
export function postMessage(data: unknown): boolean {
  const mp = getWx();
  if (!mp) return false;
  try {
    mp.postMessage({ data });
    return true;
  } catch {
    return false;
  }
}

/** 跳到小程序原生页 (push 栈). url 是小程序内部 path, e.g. "/pages/about/about". */
export function navigateToMP(url: string): boolean {
  const mp = getWx();
  if (!mp) return false;
  try {
    mp.navigateTo({ url });
    return true;
  } catch {
    return false;
  }
}

/** 跳到 tabBar 页. mvp 我们没 tabBar, 备用. */
export function switchTabMP(url: string): boolean {
  const mp = getWx();
  if (!mp) return false;
  try {
    mp.switchTab({ url });
    return true;
  } catch {
    return false;
  }
}

/** 后退. mvp 没用 — 一般用 H5 浏览器后退 (history.back). */
export function navigateBackMP(): boolean {
  const mp = getWx();
  if (!mp) return false;
  try {
    mp.navigateBack();
    return true;
  } catch {
    return false;
  }
}

/** 命名空间式导出 — 调用更可读. */
export const wxBridge = {
  postMessage,
  navigateTo: navigateToMP,
  switchTab: switchTabMP,
  navigateBack: navigateBackMP,
  /** 是否在小程序里 (re-export, 调用方不需另外 import runtime) */
  isInMiniProgram: isInWxMiniProgram,
};
