// app.js — Aimeeting 微信小程序入口

App({
  onLaunch() {
    // 启动 log — 便于调试 / 用户反馈定位
    const ver = wx.getAccountInfoSync?.().miniProgram?.version || "dev";
    const env = wx.getAccountInfoSync?.().miniProgram?.envVersion || "develop";
    console.log(`[Aimeeting MP] launched ver=${ver} env=${env}`);

    // v27.2: 隐私授权 不在 onLaunch 主动 wx.requirePrivacyAuthorize.
    //   原因 1 (体验): 用户还没做任何事就弹隐私框, 突兀.
    //   原因 2 (报错): mp 后台 "隐私保护指引" 未提交生效前, 框架走隐私流程
    //     会 timeout (调试器里那个 "Error: timeout" 就是它).
    //   __usePrivacyCheck__=true 时, 微信会在 真正调用隐私 API (录音 /
    //   选聊天文件) 的那一刻 自动 弹隐私授权框 — 上下文自然, 合规不受影响.
    //
    // v27.2: 删掉了 wx.getSystemInfoSync — 它存的 globalData.systemInfo
    //   全项目没人用 (是死代码), 且该 API 已 deprecated.
  },

  globalData: {
    // H5 基础 URL — 域名变了改这一处. 小程序后台 request / 业务域名 必须含此域名.
    h5Base: "https://aimeeting.zhzjpt.cn",
  },
});
