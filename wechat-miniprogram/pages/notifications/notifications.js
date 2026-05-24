// pages/notifications/notifications.js — v27.2 「通知」原生页 (替代 webview /m/notifications)
//
// 拉 GET /api/me/notifications?limit=50, 时间倒序列表.
// 顶部 "全部已读" → POST /api/me/notifications/read-all
// 点单条 → POST /api/me/notifications/<id>/read (标已读), 再 按 kind 跳对应页.

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

// kind → emoji + 中文 (跟 H5 notifications/page.tsx KIND_LABEL 对齐)
const KIND_MAP = {
  task_assigned:          { emoji: '📌', label: '任务派给你了' },
  task_dispatched:        { emoji: '📌', label: '任务已派发给你' },
  task_due_soon:          { emoji: '⏰', label: '任务快截止' },
  task_overdue:           { emoji: '🚨', label: '任务超期' },
  task_submitted:         { emoji: '📝', label: '任务已提交' },
  task_approved:          { emoji: '✓', label: '任务被通过' },
  task_rejected:          { emoji: '✗', label: '任务被驳回' },
  action_comment:         { emoji: '💬', label: '任务有新评论' },
  meeting_invited:        { emoji: '📅', label: '邀请你参加会议' },
  meeting_started:        { emoji: '▶', label: '会议已开始' },
  meeting_finished:       { emoji: '⏹', label: '会议已结束' },
  memory_draft_for_review:{ emoji: '🔍', label: 'AI 草稿等你审' },
  mention:                { emoji: '@', label: '有人 @ 你' },
};

const SEVERITY_DOT = {
  normal: 'dot-zinc',
  yellow: 'dot-amber',
  red:    'dot-rose',
  purple: 'dot-violet',
};

Page({
  data: {
    // 自定义导航
    statusBarHeight: 20,
    navBarHeight: 44,

    loading: true,
    error: '',
    refreshing: false,
    rows: [],            // enrich 后的 通知
    unreadCount: 0,
    marking: false,
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
      fail: () => wx.switchTab({ url: '/pages/home/home' }),
    });
  },

  onPullDownRefresh() {
    this._fetch({ pullDown: true });
  },

  async _fetch(opts) {
    const { pullDown } = opts || {};
    if (!pullDown) this.setData({ loading: true, error: '' });
    if (pullDown) this.setData({ refreshing: true });
    try {
      const data = await api.get('/api/me/notifications', { limit: 50 });
      const items = (data && data.items) || [];
      this.setData({
        rows: items.map((n, idx) => this._enrich(n, idx)),
        unreadCount: (data && data.unread_count) || 0,
        loading: false,
        refreshing: false,
        error: '',
      });
    } catch (e) {
      console.error('[notifications] fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({
        loading: false,
        refreshing: false,
        error: e.message || '加载失败',
      });
    }
  },

  _enrich(n, idx) {
    const km = KIND_MAP[n.kind] || { emoji: '🔔', label: n.kind || '通知' };
    return {
      ...n,
      _emoji: km.emoji,
      _kindLabel: km.label,
      _title: this._extractTitle(n.payload),
      _whenLabel: this._timeAgo(n.created_at),
      _isUnread: !n.read_at,
      _dotClass: SEVERITY_DOT[n.severity] || 'dot-zinc',
      _animDelayMs: Math.min(idx, 8) * 35,
    };
  },

  /** payload schema 各 kind 不同, 尝试通用字段 */
  _extractTitle(payload) {
    if (!payload) return '';
    const keys = ['task_title', 'meeting_title', 'title', 'content', 'summary'];
    for (const k of keys) {
      const v = payload[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return '';
  },

  _timeAgo(iso) {
    if (!iso) return '';
    let t;
    try {
      t = new Date(iso).getTime();
      if (isNaN(t)) return '';
    } catch (_) { return ''; }
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return `${Math.floor(d / 30)} 月前`;
  },

  // ============================================================
  // 交互
  // ============================================================

  async onTapMarkAll() {
    if (this.data.marking || this.data.unreadCount === 0) return;
    this.setData({ marking: true });
    try {
      await api.post('/api/me/notifications/read-all');
      // 本地 全部 标已读
      const rows = this.data.rows.map((r) => ({
        ...r,
        _isUnread: false,
        read_at: r.read_at || new Date().toISOString(),
      }));
      this.setData({ rows, unreadCount: 0 });
      wx.showToast({ title: '已全部已读', icon: 'success', duration: 800 });
    } catch (e) {
      console.error('[notifications] mark-all failed', e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      this.setData({ marking: false });
    }
  },

  async onTapRow(e) {
    const idx = e.currentTarget.dataset.idx;
    const n = this.data.rows[idx];
    if (!n) return;

    // 先标已读 (fire-and-forget, UI 立即 更新)
    if (n._isUnread) {
      const rows = this.data.rows.slice();
      rows[idx] = { ...n, _isUnread: false, read_at: new Date().toISOString() };
      this.setData({
        rows,
        unreadCount: Math.max(0, this.data.unreadCount - 1),
      });
      api.post(`/api/me/notifications/${n.id}/read`).catch(() => {});
    }

    // 按 kind 跳对应页
    const p = n.payload || {};
    if (n.kind && n.kind.indexOf('meeting') === 0 && p.meeting_id) {
      // 会议类 → 原生会议室 (ongoing/scheduled) 或 webview summary
      const token = getToken();
      const exp = wx.getStorageSync('aim_token_exp') || '';
      wx.navigateTo({
        url:
          `/pages/meeting/meeting?meeting_id=${encodeURIComponent(p.meeting_id)}` +
          `&t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
        fail: () => {},
      });
    } else if (n.kind && n.kind.indexOf('task') === 0 && p.action_item_id) {
      wx.navigateTo({
        url: `/pages/task_detail/task_detail?id=${encodeURIComponent(p.action_item_id)}`,
        fail: () => {},
      });
    }
    // 其他 kind 暂不跳
  },

  onTapRetry() {
    this._fetch();
  },
});
