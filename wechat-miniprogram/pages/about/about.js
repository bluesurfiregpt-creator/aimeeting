// pages/about/about.js — 关于页

Page({
  data: {
    version: "dev",
    envVersion: "develop",
  },
  onLoad() {
    try {
      const info = wx.getAccountInfoSync?.();
      if (info?.miniProgram) {
        this.setData({
          version: info.miniProgram.version || "dev",
          envVersion:
            info.miniProgram.envVersion === "release"
              ? "正式"
              : info.miniProgram.envVersion === "trial"
              ? "体验版"
              : "开发版",
        });
      }
    } catch (e) {
      // ignore
    }
  },
});
