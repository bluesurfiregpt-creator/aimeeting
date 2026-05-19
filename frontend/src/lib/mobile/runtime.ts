/**
 * v27.0-mobile · 运行时环境识别 hook.
 *
 * 用途: H5 在不同容器里有不同表现, 同一份 React 代码需要分支:
 *   - 普通浏览器 (Chrome / Safari / Firefox): web
 *   - 微信内置浏览器 (用户在公众号 / 聊天点链接打开): wx-browser
 *   - 微信小程序 web-view 套壳: wx-miniprogram (后期 wechat-miniprogram/ 工程封装时跑这条)
 *
 * 设计:
 *   - SSR safe — 服务端不访问 window/navigator, 返回 "web" 兜底
 *   - 单次计算, 缓存结果 (UA 不变就不变)
 *   - 不做 alipay / 抖音 / 百度 mini 程序识别 (用户校准: 只做微信)
 *
 * 用法:
 *   import { getRuntimeKind, isInWxMiniProgram } from "@/lib/mobile/runtime";
 *   if (isInWxMiniProgram()) { ... wx 桥分支 ... }
 *
 * 参考微信文档:
 *   https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html
 *   web-view 内 H5 的 UA 含 "miniProgram" 字串
 */

export type RuntimeKind = "wx-miniprogram" | "wx-browser" | "web";

let _cached: RuntimeKind | null = null;

/** 解析当前运行时. SSR 调用返回 "web", 第一次客户端调用计算并缓存. */
export function getRuntimeKind(): RuntimeKind {
  if (_cached !== null) return _cached;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "web";
  }
  const ua = navigator.userAgent || "";

  // 微信小程序 web-view: UA 含 "miniProgram" (注意大小写敏感, 微信用 camelCase)
  // 同时一般也含 MicroMessenger.
  if (/miniProgram/i.test(ua)) {
    _cached = "wx-miniprogram";
    return _cached;
  }

  // 微信内置浏览器 (公众号 / 聊天里点链接): UA 含 MicroMessenger 但无 miniProgram
  if (/MicroMessenger/i.test(ua)) {
    _cached = "wx-browser";
    return _cached;
  }

  _cached = "web";
  return _cached;
}

/** 当前是否在微信小程序 web-view 内. 大多数分支判断只关心这个. */
export function isInWxMiniProgram(): boolean {
  return getRuntimeKind() === "wx-miniprogram";
}

/** 当前是否在微信内 (含小程序 OR 微信内置浏览器). 一些 UX 提示能用. */
export function isInWeChat(): boolean {
  const k = getRuntimeKind();
  return k === "wx-miniprogram" || k === "wx-browser";
}

/** 测试 hook — 强制覆盖运行时识别 (仅 dev / 测试用). */
export function __setRuntimeKindForTesting(k: RuntimeKind | null): void {
  _cached = k;
}
