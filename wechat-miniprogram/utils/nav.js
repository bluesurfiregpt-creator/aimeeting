// utils/nav.js — v27.2 自定义导航栏 (navigationStyle: custom) 度量.
//
// custom nav 后, WeChat 只画右上角胶囊 (···|◯), 不画标题栏 — 我们自己画.
// 这样 4 主 tab 页 大标题 不再 跟 WeChat 标题栏 重复.
//
// 关键度量:
//   statusBarHeight — 状态栏高 (刘海 / 灵动岛 / 挖孔 区)
//   navBarHeight    — 标题栏 内容区 高 (胶囊 所在那条)
//   totalHeight     — statusBar + navBar; 页面内容 从这下面 开始
//
// navBarHeight 公式 (微信官方推荐 — 让 自定义内容 跟 胶囊 垂直居中对齐):
//   navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height

function getNavMetrics() {
  let statusBarHeight = 20;
  let navBarHeight = 44;
  let capsule = null;

  try {
    // wx.getWindowInfo — 基础库 2.20.1+, 替代已弃用的 getSystemInfoSync
    const win = wx.getWindowInfo ? wx.getWindowInfo() : {};
    if (win && typeof win.statusBarHeight === 'number') {
      statusBarHeight = win.statusBarHeight;
    }
  } catch (e) {
    // ignore — 用默认 20
  }

  try {
    capsule = wx.getMenuButtonBoundingClientRect();
    if (capsule && capsule.height && capsule.top >= statusBarHeight) {
      navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height;
    }
  } catch (e) {
    // ignore — 用默认 44
  }

  return {
    statusBarHeight,
    navBarHeight,
    totalHeight: statusBarHeight + navBarHeight,
    capsule, // { top, right, bottom, left, width, height } 或 null
  };
}

module.exports = { getNavMetrics };
