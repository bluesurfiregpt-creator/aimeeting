// pages/webview/webview.js — 主 web-view 套壳页

const app = getApp();

Page({
  data: {
    src: "",
  },

  /**
   * options 来源:
   *   - 默认启动: 无 query, 走 base + "/m"
   *   - 微信扫码 / 分享带参: ?path=/m/meetings/<id> 等, 跳到对应 H5 路径
   *   - 客服消息 / 公众号跳转 / 短链 都走这条
   *
   * 注: 微信对 web-view src 的 query 自动加 ?wx_miniprogram=1 之类的不存在,
   * 但 wx.miniProgram.* JS API 仅在白名单域名内可用.
   */
  onLoad(options) {
    const base = app.globalData.h5Base;
    // path 必须 / 开头, 防 XSS / 外链
    let path = options.path || "/m";
    if (!path.startsWith("/")) path = "/" + path;
    // 拒绝跳出本域名 (虽然 web-view 也只支持白名单域名)
    if (path.includes("://")) path = "/m";

    const src = base + path;
    this.setData({ src });

    // 标题: webview 内 H5 改的标题会自动同步到 navigationBar 上 (web-view 默认行为)
  },

  /**
   * web-view 内 H5 通过 wx.miniProgram.postMessage(data) 给小程序发的消息.
   * 注意: postMessage 不实时, 仅在 web-view 销毁 / 页面分享 / 后退 时触发.
   * mvp 不处理, 留 hook 后续扩展.
   */
  onMessage(e) {
    console.log("[webview] message from H5:", e.detail);
  },

  onError(e) {
    console.error("[webview] error:", e.detail);
    // mvp 不显示, 让 H5 自己的错误页接管. 异常时 H5 在 /login 重定向也是 OK 的.
  },

  /**
   * 用户点 右上角 ··· → 转发. mvp 转发当前 H5 url (含 path).
   */
  onShareAppMessage() {
    const path = this.data.src.replace(app.globalData.h5Base, "");
    return {
      title: "智囊团 — AI 协作会议工作台",
      // path 是小程序内路径, 启动后自动跳回当前 webview + 同 path
      path: `/pages/webview/webview?path=${encodeURIComponent(path)}`,
    };
  },
});
