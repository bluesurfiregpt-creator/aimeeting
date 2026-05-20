// app.js — Aimeeting 微信小程序入口

App({
  onLaunch() {
    // 启动时 log 一下版本, 便于调试 / 用户反馈时定位
    const ver = wx.getAccountInfoSync?.().miniProgram?.version || "dev";
    const env = wx.getAccountInfoSync?.().miniProgram?.envVersion || "develop";
    console.log(`[Aimeeting MP] launched ver=${ver} env=${env}`);

    // 系统信息 (用于 webview 内 H5 通过 wx.miniProgram API 反查是否在小程序里)
    try {
      const sys = wx.getSystemInfoSync();
      this.globalData.systemInfo = sys;
    } catch (e) {
      // ignore
    }

    // v27.0-mobile P20: 微信 2023.9 起 强制 — 调用 任何 收集 个人信息 的 API
    // 之前 (例 picker 调 wx.chooseMessageFile) 必须 先 通过 wx.requirePrivacyAuthorize
    // 弹窗 获 用户 显式 同意. 我们 在 onLaunch 主动 触发 一次, 同意后 整个 session
    // 不再重弹.
    //
    // 关键: 必须 在 mp 后台 "设置 → 服务内容声明 → 用户隐私保护指引" 提交后,
    // 此 API 才生效. 否则 调用 fail (errMsg 含 "privacy policy not set").
    // 提交 1-2 小时 内 生效.
    if (typeof wx.requirePrivacyAuthorize === "function") {
      wx.requirePrivacyAuthorize({
        success: () => {
          // 用户已同意 (本次 或 历史)
        },
        fail: (err) => {
          console.warn("[Aimeeting MP] privacy authorize fail:", err);
          // mvp 不强阻塞 — H5 webview 内 还有 一道 自己 的 弹窗 (PrivacyConsent),
          // 双层保险.
        },
      });
    }
  },

  globalData: {
    // H5 基础 URL — 后续若域名变了改这一处. 微信小程序后台业务域名必须含此域名.
    h5Base: "https://aimeeting.zhzjpt.cn",
    systemInfo: null,
  },
});
