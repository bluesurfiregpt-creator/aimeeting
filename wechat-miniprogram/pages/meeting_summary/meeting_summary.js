// pages/meeting_summary/meeting_summary.js — v27.2 会议总结 原生页
//
// 对齐 H5 /m/meetings/[id]/summary:
//   - AI 纪要 (markdown): pending 轮询 / ready 渲染 / skipped / failed+重试
//   - AI 抽出的待办: pending 列表 带 确认 / 驳回; 已处理 折叠只读
//   - 底部: 看完整会议 / 回工作台
//
// markdown 渲染: mini program 无 markdown 组件, 用轻量 行解析器 _parseMd()
// 拆成 { t, text } 块 (h1/h2/li/p), wxml 按 t 套不同样式. 内联 **bold** 去标记.
//
// API:
//   GET   /api/meetings/{id}/summary           轮询 (5s × 最多 60)
//   GET   /api/meetings/{id}/actions
//   PATCH /api/meetings/{mid}/actions/{aid}     { status: done|cancelled }

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60;

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,

    id: '',
    // summary
    summaryStatus: 'pending',  // pending | ready | skipped | failed
    summaryBlocks: [],         // 解析后的 markdown 块
    summaryMessage: '',
    summaryLoaded: false,

    // actions
    actionsLoaded: false,
    pendingActions: [],
    decidedActions: [],
    busyActionId: '',
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
      this.setData({ summaryStatus: 'failed', summaryMessage: '缺少会议 id', summaryLoaded: true });
      return;
    }
    this._pollCount = 0;
    this._cancelled = false;
    this._tickSummary();
    this._loadActions();
    // action_extractor 在 summary 之后跑, 30s 后再拉一次
    this._actionsRetry = setTimeout(() => this._loadActions(), 30000);
  },

  onUnload() {
    this._cancelled = true;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    if (this._actionsRetry) clearTimeout(this._actionsRetry);
  },

  onTapBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/meetings_list/meetings_list' }) });
  },

  // ============================================================
  // 纪要 (轮询)
  // ============================================================

  async _tickSummary() {
    if (this._cancelled) return;
    let status = 'failed';
    try {
      const s = await api.get(`/api/meetings/${this.data.id}/summary`);
      status = s.status || 'failed';
      this.setData({
        summaryStatus: status,
        summaryBlocks: s.summary_md ? this._parseMd(s.summary_md) : [],
        summaryMessage: s.message || '',
        summaryLoaded: true,
      });
    } catch (e) {
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({
        summaryStatus: 'failed',
        summaryMessage: e.message || '加载失败',
        summaryLoaded: true,
      });
      return;
    }
    // terminal 态 → 停
    if (status === 'ready' || status === 'skipped' || status === 'failed') return;
    // pending → 继续轮询
    this._pollCount += 1;
    if (this._pollCount >= MAX_POLLS) {
      this.setData({
        summaryStatus: 'failed',
        summaryMessage: '超时未生成 (5 分钟), 请稍后刷新',
      });
      return;
    }
    this._pollTimer = setTimeout(() => this._tickSummary(), POLL_INTERVAL_MS);
  },

  onTapRetrySummary() {
    this._pollCount = 0;
    this.setData({ summaryStatus: 'pending' });
    this._tickSummary();
  },

  /**
   * 轻量 markdown 行解析. 返回 [{ t, text }].
   *   t: h1 | h2 | li | p
   * 内联 **bold** / `code` 标记 去掉 (mini program 无富文本简单方案).
   */
  _parseMd(md) {
    const blocks = [];
    const lines = (md || '').split('\n');
    for (let raw of lines) {
      let line = raw.replace(/\*\*/g, '').replace(/`/g, '').trimEnd();
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#{1}\s/.test(trimmed)) {
        blocks.push({ t: 'h1', text: trimmed.replace(/^#\s+/, '') });
      } else if (/^#{2,}\s/.test(trimmed)) {
        blocks.push({ t: 'h2', text: trimmed.replace(/^#+\s+/, '') });
      } else if (/^[-*]\s/.test(trimmed)) {
        blocks.push({ t: 'li', text: trimmed.replace(/^[-*]\s+/, '') });
      } else if (/^\d+\.\s/.test(trimmed)) {
        blocks.push({ t: 'li', text: trimmed.replace(/^\d+\.\s+/, '') });
      } else {
        blocks.push({ t: 'p', text: trimmed });
      }
    }
    return blocks;
  },

  // ============================================================
  // 待办
  // ============================================================

  async _loadActions() {
    if (this._cancelled) return;
    try {
      const acts = await api.get(`/api/meetings/${this.data.id}/actions`);
      const list = acts || [];
      this.setData({
        pendingActions: list
          .filter((a) => a.status === 'open')
          .map((a) => this._enrichAction(a)),
        decidedActions: list
          .filter((a) => a.status !== 'open')
          .map((a) => ({
            ...a,
            _done: a.status === 'done',
          })),
        actionsLoaded: true,
      });
    } catch (e) {
      console.error('[meeting_summary] load actions failed', e);
      this.setData({ actionsLoaded: true });
    }
  },

  _enrichAction(a) {
    const assignee = a.assignee_agent_name
      || a.assignee_name
      || a.assignee_name_hint
      || '未指定';
    let dueLabel = '';
    if (a.due_at) {
      try {
        const d = new Date(a.due_at);
        if (!isNaN(d.getTime())) dueLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      } catch (_) { /* ignore */ }
    }
    return { ...a, _assignee: assignee, _dueLabel: dueLabel };
  },

  async onConfirmAction(e) {
    await this._patchAction(e.currentTarget.dataset.id, e.currentTarget.dataset.mid, 'done', '已确认');
  },

  async onRejectAction(e) {
    await this._patchAction(e.currentTarget.dataset.id, e.currentTarget.dataset.mid, 'cancelled', '已驳回');
  },

  async _patchAction(actionId, meetingId, status, okText) {
    if (!actionId || !meetingId || this.data.busyActionId) return;
    this.setData({ busyActionId: actionId });
    try {
      await api.patch(`/api/meetings/${meetingId}/actions/${actionId}`, { status });
      await this._loadActions();
      wx.showToast({ title: okText, icon: 'success', duration: 800 });
    } catch (e) {
      console.error('[meeting_summary] patch action failed', e);
      wx.showToast({
        title: '操作失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 2000,
      });
    } finally {
      this.setData({ busyActionId: '' });
    }
  },

  // ============================================================
  // 底部导航
  // ============================================================

  onTapFullMeeting() {
    const token = getToken();
    const exp = wx.getStorageSync('aim_token_exp') || '';
    wx.navigateTo({
      url:
        `/pages/meeting/meeting?meeting_id=${encodeURIComponent(this.data.id)}` +
        `&t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
      fail: (err) => console.error('[meeting_summary] nav meeting fail', err),
    });
  },

  onTapHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
