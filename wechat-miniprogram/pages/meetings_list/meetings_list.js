// pages/meetings_list/meetings_list.js — v27.0-mobile S2 会议列表 原生页
//
// 跟 H5 /m/meetings 等价:
//   - 顶部 segment 三态: ongoing(进行中) / upcoming(即将开始) / finished(已结束)
//   - "+ 新建会议" 入口 sticky
//   - 卡片 stagger 入场动效 (跟 S1 第 2 刀 同步)
//   - 拉 /api/m/meetings (后端 一次 性返 全部, 前端 按 status filter)
//
// 跳转规则:
//   - 卡片 (ongoing / scheduled) → 原生 /pages/meeting/meeting?meeting_id=...&t=...&exp=...
//   - 卡片 (finished / processed) → webview /m/meetings/<id>/summary (详情页 S3 / S4 后再原生)
//   - "+ 新建会议"               → 原生 /pages/create/create
//
// 4 tab 同步:
//   - 今日 → reLaunch /pages/home/home
//   - 会议 → 当前
//   - 任务 / 智囊 → webview (S3 / S4 完后改 reLaunch)

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const TAB_ONGOING = 'ongoing';
const TAB_UPCOMING = 'upcoming';
const TAB_FINISHED = 'finished';

Page({
  data: {
    navPadTop: 0, // 自定义导航 — header 顶 padding

    tab: TAB_ONGOING,

    loading: true,
    refreshing: false,
    error: '',

    // 全量 (从后端拉一次, 按 tab filter 出 rows)
    allItems: [],

    // 衍生
    counts: { ongoing: 0, upcoming: 0, finished: 0 },
    rows: [], // 当前 tab 渲染的 list, 每项已 enrich
    emptyMsg: '',

    // 1 分钟一刷, 让 ongoing 卡 "已 N min" / "N 分钟前" 更新
    nowSec: 0,
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad() {
    const nav = getNavMetrics();
    this.setData({ navPadTop: nav.totalHeight + 8 });
    if (!getToken()) {
      // 没 token → reLaunch 登录
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this._fetch();
  },

  onShow() {
    // 自定义 tabBar — 同步高亮到 "会议"
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    // 从子页返回时 silent 重拉, 让 ongoing 状态 + 计数 同步
    if (this._hasFetched) {
      this._fetch({ silent: true });
    }
  },

  onReady() {
    this._tickTimer = setInterval(() => {
      this.setData({ nowSec: Math.floor(Date.now() / 1000) });
      // 仅 ongoing tab 需要 timeText 跟着刷 — 重 enrich 当前 tab
      if (this.data.tab === TAB_ONGOING) {
        this._rebuildRows();
      }
    }, 60 * 1000);
  },

  onUnload() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  onPullDownRefresh() {
    this._fetch({ pullDown: true });
  },

  // ============================================================
  // 数据
  // ============================================================

  async _fetch(opts) {
    const { silent, pullDown } = opts || {};
    if (!silent && !pullDown) this.setData({ loading: true, error: '' });
    if (pullDown) this.setData({ refreshing: true });

    try {
      const data = await api.get('/api/m/meetings');
      const items = data.items || [];
      const counts = {
        ongoing: 0,
        upcoming: 0,
        finished: 0,
      };
      for (const m of items) {
        if (m.status === 'ongoing') counts.ongoing++;
        else if (m.status === 'scheduled') counts.upcoming++;
        else if (m.status === 'finished' || m.status === 'processed') counts.finished++;
      }
      this.setData({
        allItems: items,
        counts,
        loading: false,
        refreshing: false,
        error: '',
        nowSec: Math.floor(Date.now() / 1000),
      });
      this._hasFetched = true;
      this._rebuildRows();
    } catch (e) {
      console.error('[meetings] fetch failed', e);
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

  /** 重建当前 tab 渲染的 rows + emptyMsg */
  _rebuildRows() {
    const { tab, allItems } = this.data;
    const filtered = allItems.filter((m) => {
      if (tab === TAB_ONGOING) return m.status === 'ongoing';
      if (tab === TAB_UPCOMING) return m.status === 'scheduled';
      return m.status === 'finished' || m.status === 'processed';
    });
    const rows = filtered.map((m, idx) => this._enrich(m, idx));
    let emptyMsg = '';
    if (filtered.length === 0) {
      if (tab === TAB_ONGOING) emptyMsg = '现在没有进行中的会议';
      else if (tab === TAB_UPCOMING) emptyMsg = '近期没有计划中的会议';
      else emptyMsg = '最近 30 天没有已结束的会议';
    }
    this.setData({ rows, emptyMsg });
  },

  /** 给 row 加 wxml 用的衍生字段 */
  _enrich(m, idx) {
    const isOngoing = m.status === 'ongoing';
    const isScheduled = m.status === 'scheduled';
    const isFinished = m.status === 'finished' || m.status === 'processed';

    // 状态 chip
    let statusLabel = '已结束';
    let statusTone = 'tone-zinc';
    if (m.status === 'ongoing') { statusLabel = '进行中'; statusTone = 'tone-emerald'; }
    else if (m.status === 'scheduled') { statusLabel = '未开始'; statusTone = 'tone-violet'; }
    else if (m.status === 'processed') { statusLabel = '已沉淀'; statusTone = 'tone-zinc'; }

    // 时长文本
    const planned = m.planned_minutes;
    const actual = m.minutes_total;
    let timeText = '';
    let timeOver = false;
    if (isOngoing && actual !== null && actual !== undefined) {
      if (planned !== null && planned !== undefined) {
        timeOver = actual > planned;
        timeText = `已 ${actual} / 计划 ${planned} min`;
      } else {
        timeText = `已 ${actual} min`;
      }
    } else if (isScheduled) {
      if (planned !== null && planned !== undefined) timeText = `计划 ${planned} min`;
      else if (m.started_at) timeText = this._timeAgo(m.started_at);
    } else if (m.ended_at) {
      const base = `${this._timeAgo(m.ended_at)} · 用时 ${actual || '-'} min`;
      if (planned !== null && planned !== undefined && actual !== null && actual !== undefined) {
        timeOver = actual > planned;
        timeText = `${base} / 计划 ${planned}`;
      } else {
        timeText = base;
      }
    }

    // 议程 进度 mini-bar (最多 6 格 + 余数)
    let progressCells = [];
    let progressMore = 0;
    let progressText = '';
    if (m.agenda_total > 0) {
      const total = m.agenda_total;
      const cur = m.current_agenda_idx === null || m.current_agenda_idx === undefined ? -1 : m.current_agenda_idx;
      const showN = Math.min(total, 6);
      for (let i = 0; i < showN; i++) {
        progressCells.push({
          key: 'c' + i,
          cls:
            i < cur ? 'p-done' :
            i === cur ? 'p-active' : 'p-pending',
        });
      }
      if (total > 6) progressMore = total - 6;
      if (isOngoing && cur >= 0) {
        progressText = `议程 ${cur + 1}/${total}`;
      } else {
        progressText = `${total} 议题`;
      }
    }

    return {
      ...m,
      _isOngoing: isOngoing,
      _isScheduled: isScheduled,
      _isFinished: isFinished,
      _statusLabel: statusLabel,
      _statusTone: statusTone,
      _timeText: timeText,
      _timeOver: timeOver,
      _progressCells: progressCells,
      _progressMore: progressMore,
      _progressText: progressText,
      _hasUsers: m.users_count > 0,
      _hasAgents: m.agents_count > 0,
      _hasInsights: m.insights_count > 0,
      _hasActions: m.actions_count > 0,
      _animDelayMs: Math.min(idx, 8) * 40,
    };
  },

  _timeAgo(iso) {
    if (!iso) return '';
    let t;
    try {
      t = new Date(iso).getTime();
      if (isNaN(t)) return '';
    } catch (_) { return ''; }
    const diff = Date.now() - t;
    if (diff < 0) {
      // 未来 — 倒计时
      const min = Math.floor(-diff / 60000);
      if (min < 60) return `${min} 分钟后`;
      const h = Math.floor(min / 60);
      if (h < 24) return `${h} 小时后`;
      return `${Math.floor(h / 24)} 天后`;
    }
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) return;
    if (tab !== TAB_ONGOING && tab !== TAB_UPCOMING && tab !== TAB_FINISHED) return;
    this.setData({ tab });
    this._rebuildRows();
  },

  onTapMeeting(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id) return;

    if (status === 'ongoing' || status === 'scheduled') {
      // 进会议室 原生页
      const token = getToken();
      const exp = wx.getStorageSync('aim_token_exp') || '';
      wx.navigateTo({
        url:
          `/pages/meeting/meeting?meeting_id=${encodeURIComponent(id)}` +
          `&t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
        fail: (err) => {
          console.error('[meetings] navigate meeting fail', err);
          wx.showToast({ title: '跳会议失败', icon: 'none' });
        },
      });
    } else {
      // 已结束 / 已沉淀 — 原生 会议总结页
      wx.navigateTo({
        url: `/pages/meeting_summary/meeting_summary?id=${encodeURIComponent(id)}`,
        fail: (err) => console.error('[meetings] nav summary fail', err),
      });
    }
  },

  onTapNew() {
    // 原生 创建会议 (N-3 已做)
    const token = getToken();
    const exp = wx.getStorageSync('aim_token_exp') || '';
    wx.navigateTo({
      url: `/pages/create/create?t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
      fail: (err) => {
        console.error('[meetings] navigate create fail', err);
      },
    });
  },

  onTapRetry() {
    this._fetch();
  },

  // ============================================================
  // Header 右上 入口 (v27.2 — 原生页, 不再 webview)
  // ============================================================
  onTapNotifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' });
  },
  onTapMe() {
    wx.navigateTo({ url: '/pages/me/me' });
  },
});
