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
  },

  globalData: {
    // H5 基础 URL — 后续若域名变了改这一处. 微信小程序后台业务域名必须含此域名.
    h5Base: "https://aimeeting.zhzjpt.cn",
    systemInfo: null,
  },
});
