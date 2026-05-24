// pages/me/me.js — v27.2 「我的」原生页 (替代 webview /m/me)
//
// 之前 ⚙ icon 走 webview /m/me, 在 小程序 内 webview 有玄学 404 + 不符合
// "全原生" 方向. 改 原生页.
//
// 内容 (对齐 H5 /m/me):
//   - 档案卡: 头像(name 首字) + name + role chip + email/phone
//   - 工作区 / 部门
//   - 关于 (客服 / 环境)
//   - 退出登录 (confirm → clearAuth → reLaunch login)
//
// 声纹录入入口 暂不放 — voiceprint 原生页 还没并入 app.json, 留后续 phase.

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const ROLE_LABEL = {
  owner: '召集人',
  leader: '局长',
  admin: '管理员',
  expert: '专家',
  member: '成员',
};

const ROLE_TONE = {
  owner: 'tone-violet',
  leader: 'tone-amber',
  admin: 'tone-sky',
  expert: 'tone-emerald',
  member: 'tone-zinc',
};

Page({
  data: {
    // 自定义导航
    statusBarHeight: 20,
    navBarHeight: 44,

    loading: true,
    error: '',
    me: null,          // { name, email, role, workspace_name, department, ... }
    avatarChar: '',
    roleLabel: '',
    roleTone: 'tone-zinc',
    accountLine: '',   // email 或 phone, 显在 role chip 旁
    version: 'v1.1.0',
  },

  onLoad() {
    const nav = getNavMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
    });
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this._fetch();
  },

  onTapBack() {
    wx.navigateBack({
      fail: () => {
        // 没历史栈 (深链直进) → 回 home tab
        wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },

  async _fetch() {
    this.setData({ loading: true, error: '' });
    try {
      const me = await api.get('/api/auth/me');
      const name = me.name || '未命名';
      const role = me.role || 'member';
      this.setData({
        me,
        avatarChar: name.slice(0, 1),
        roleLabel: ROLE_LABEL[role] || role,
        roleTone: ROLE_TONE[role] || 'tone-zinc',
        accountLine: me.email || me.phone || '',
        loading: false,
      });
    } catch (e) {
      console.error('[me] fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  onTapRetry() {
    this._fetch();
  },

  // ============================================================
  // 退出登录
  // ============================================================

  onTapLogout() {
    wx.showModal({
      title: '确认退出登录?',
      content: '退出后需重新用微信 / 邮箱 / 手机号登录.',
      confirmText: '退出',
      cancelText: '再想想',
      confirmColor: '#f43f5e',
      success: ({ confirm }) => {
        if (!confirm) return;
        // 原生 没 cookie — 直接 清 storage token 即可.
        // 顺手 调 一下 /api/auth/logout (Bearer), 失败 也 无所谓.
        api.post('/api/auth/logout').catch(() => {});
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
      },
    });
  },

  // ============================================================
  // 关于
  // ============================================================

  onTapAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onTapVoiceprint() {
    wx.navigateTo({
      url: '/pages/voiceprint/voiceprint',
      fail: (err) => console.error('[me] navigate voiceprint fail', err),
    });
  },
});
