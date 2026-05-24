// pages/agent_detail/agent_detail.js — v27.2 AI 专家详情 原生页
//
// 对齐 H5 /m/agents/[id]:
//   - 档案区: 色块条 + 累计 (场会议 / 条智囊 / 项任务) + 最近活跃
//   - segment 三 tab: 会议 / 任务 / 智囊
//   - 会议 tab → 点跳会议总结 / 会议室
//   - 任务 tab → 按状态分组 (进行中 / 已完成 / 已取消), 点跳任务详情
//   - 智囊 tab → insight 列表
//
// API: GET /api/m/agents/{agent_id}

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const MEETING_STATUS = {
  ongoing:   { label: '进行中', tone: 'tone-emerald' },
  scheduled: { label: '未开始', tone: 'tone-sky' },
  finished:  { label: '已结束', tone: 'tone-zinc' },
  processed: { label: '已沉淀', tone: 'tone-violet' },
};
const TASK_STATUS = {
  open:        { label: '待派',   tone: 'tone-amber' },
  dispatched:  { label: '已派',   tone: 'tone-sky' },
  accepted:    { label: '已接',   tone: 'tone-sky' },
  in_progress: { label: '进行中', tone: 'tone-violet' },
  submitted:   { label: '待审',   tone: 'tone-violet' },
  done:        { label: '完成',   tone: 'tone-emerald' },
  archived:    { label: '归档',   tone: 'tone-zinc' },
  cancelled:   { label: '已取消', tone: 'tone-zinc' },
};
const OPEN_SET = ['open', 'dispatched', 'accepted', 'in_progress', 'submitted'];
const DONE_SET = ['done', 'archived'];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,

    id: '',
    loading: true,
    error: '',
    tab: 'meetings',

    // 档案
    displayName: '',
    subLine: '',
    colorClass: 'bar-zinc',
    totalMeetings: 0,
    totalInsights: 0,
    totalTasks: 0,
    lastActiveLabel: '',

    // tab 数据
    meetings: [],
    taskGroups: [],   // [{ title, tone, items }]
    insights: [],
    counts: { meetings: 0, tasks: 0, insights: 0 },
  },

  onLoad(options) {
    const nav = getNavMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      id: options.id || '',
    });
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    if (!options.id) {
      this.setData({ loading: false, error: '缺少专家 id' });
      return;
    }
    this._fetch();
  },

  onTapBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  // ============================================================
  // 数据
  // ============================================================

  async _fetch() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await api.get(`/api/m/agents/${this.data.id}`);
      const nick = (d.nickname || '').trim();
      const name = d.name || '';
      const display = nick || name;
      const showNick = !!(nick && nick !== name);

      const meetings = (d.meetings || []).map((m) => {
        const st = MEETING_STATUS[m.status] || MEETING_STATUS.finished;
        return {
          ...m,
          _statusLabel: st.label,
          _statusTone: st.tone,
          _dateLabel: this._meetingDate(m.started_at),
        };
      });

      const tasksRaw = (d.tasks || []).map((t) => {
        const st = TASK_STATUS[t.status] || TASK_STATUS.open;
        return {
          ...t,
          _statusLabel: st.label,
          _statusTone: st.tone,
          _dueLabel: t.due_at ? this._meetingDate(t.due_at) : '',
        };
      });
      const taskGroups = [];
      const openT = tasksRaw.filter((t) => OPEN_SET.indexOf(t.status) >= 0);
      const doneT = tasksRaw.filter((t) => DONE_SET.indexOf(t.status) >= 0);
      const cancelT = tasksRaw.filter((t) => t.status === 'cancelled');
      if (openT.length) taskGroups.push({ key: 'open', title: '进行中', items: openT, muted: false });
      if (doneT.length) taskGroups.push({ key: 'done', title: '已完成', items: doneT, muted: false });
      if (cancelT.length) taskGroups.push({ key: 'cancel', title: '已取消', items: cancelT, muted: true });

      const insights = (d.insights || []).map((ins) => ({
        ...ins,
        _tone: this._insightTone(ins.type),
      }));

      this.setData({
        loading: false,
        error: '',
        displayName: display,
        subLine: d.domain
          ? (showNick ? `${d.domain} · ${name}` : d.domain)
          : (showNick ? name : ''),
        colorClass: this._colorClass(d.color),
        totalMeetings: d.total_meetings || 0,
        totalInsights: d.total_insights || 0,
        totalTasks: (d.tasks || []).length,
        lastActiveLabel: d.last_active ? '最近活跃 ' + this._timeAgo(d.last_active) : '暂未激活',
        meetings,
        taskGroups,
        insights,
        counts: {
          meetings: meetings.length,
          tasks: tasksRaw.length,
          insights: insights.length,
        },
      });
    } catch (e) {
      console.error('[agent_detail] fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  _colorClass(c) {
    const map = {
      violet: 'bar-violet', emerald: 'bar-emerald', amber: 'bar-amber',
      sky: 'bar-sky', rose: 'bar-rose', teal: 'bar-teal',
      blue: 'bar-blue', indigo: 'bar-indigo',
    };
    return map[c] || 'bar-zinc';
  },

  _insightTone(type) {
    if (type === '风险') return 'tone-rose';
    if (type === '建议' || type === '决策建议') return 'tone-violet';
    if (type === '洞察') return 'tone-cyan';
    if (type === '思路') return 'tone-amber';
    return 'tone-zinc';
  },

  _timeAgo(iso) {
    if (!iso) return '';
    let t;
    try { t = new Date(iso).getTime(); if (isNaN(t)) return ''; } catch (_) { return ''; }
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return `${Math.floor(d / 30)} 月前`;
  },

  _meetingDate(iso) {
    if (!iso) return '';
    let d;
    try { d = new Date(iso); if (isNaN(d.getTime())) return ''; } catch (_) { return ''; }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapSegment(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.tab) this.setData({ tab });
  },

  onTapMeeting(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id) return;
    if (status === 'ongoing' || status === 'scheduled') {
      const token = getToken();
      const exp = wx.getStorageSync('aim_token_exp') || '';
      wx.navigateTo({
        url:
          `/pages/meeting/meeting?meeting_id=${encodeURIComponent(id)}` +
          `&t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
        fail: () => {},
      });
    } else {
      wx.navigateTo({
        url: `/pages/meeting_summary/meeting_summary?id=${encodeURIComponent(id)}`,
        fail: () => {},
      });
    }
  },

  onTapTask(e) {
    const aid = e.currentTarget.dataset.aid;
    if (!aid) {
      wx.showToast({ title: '该任务无详情', icon: 'none', duration: 900 });
      return;
    }
    wx.navigateTo({
      url: `/pages/task_detail/task_detail?id=${encodeURIComponent(aid)}`,
      fail: () => {},
    });
  },

  onTapRetry() {
    this._fetch();
  },
});
