// pages/tasks_list/tasks_list.js — v27.0-mobile S3 任务列表 原生页
//
// 跟 H5 /m/tasks 等价 (但 RejectFeedbackSheet 用 wx.showModal editable 替代):
//   - segment 三态: pending (等你处理, 默认) / tracking / done
//   - pending 卡 full 形态, 带 主 + 副 CTA 按钮
//   - tracking + done 紧凑 row, 仅 标题 + meta, 无 CTA
//   - 卡片入场 stagger 跟 S2 同步
//
// CTA 分支:
//   confirm + primary  →  PATCH /api/meetings/<mid>/actions/<aid> { status: "done" }
//   confirm + secondary → PATCH 同 { status: "cancelled" }
//   approve_draft + primary  →  POST /api/memory-drafts/<id>/approve
//   approve_draft + secondary → wx.showModal editable → POST /api/memory-drafts/<id>/reject
//       feedback 空 = kind: "discard"; 非空 = kind: "feedback"
//
// 同会议室一样, 调完 reload 整页 (确保 counts 同步).

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const TAB_PENDING = 'pending';
const TAB_TRACKING = 'tracking';
const TAB_DONE = 'done';

Page({
  data: {
    navPadTop: 0, // 自定义导航 — header 顶 padding

    tab: TAB_PENDING,

    loading: true,
    refreshing: false,
    error: '',

    // 全量
    allItems: [],
    meTotal: 0,
    otherTotal: 0,

    // 衍生
    counts: { pending: 0, tracking: 0, done: 0 },
    rows: [],
    emptyTitle: '',
    emptyBody: '',

    // 单 row 操作中 — 锁双击
    busyKey: '',
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad() {
    const nav = getNavMetrics();
    this.setData({ navPadTop: nav.totalHeight + 8 });
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this._fetch();
  },

  onShow() {
    // 自定义 tabBar — 同步高亮到 "任务"
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (this._hasFetched) {
      this._fetch({ silent: true });
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
      const data = await api.get('/api/m/tasks');
      const items = data.items || [];
      const counts = { pending: 0, tracking: 0, done: 0 };
      for (const it of items) {
        if (it.group === 'pending') counts.pending++;
        else if (it.group === 'tracking') counts.tracking++;
        else if (it.group === 'done') counts.done++;
      }
      this.setData({
        allItems: items,
        meTotal: data.me_primary_count || 0,
        otherTotal: data.other_participating_count || 0,
        counts,
        loading: false,
        refreshing: false,
        error: '',
      });
      this._hasFetched = true;
      this._rebuildRows();
    } catch (e) {
      console.error('[tasks] fetch failed', e);
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

  _rebuildRows() {
    const { tab, allItems } = this.data;
    const filtered = allItems.filter((it) => it.group === tab);
    const rows = filtered.map((it, idx) => this._enrich(it, idx));
    let emptyTitle = '';
    let emptyBody = '';
    if (filtered.length === 0) {
      if (tab === TAB_PENDING) {
        emptyTitle = '✓ 待办全处理完';
        emptyBody = '会议结束后, AI 抽出的待办会出现在这里';
      } else if (tab === TAB_TRACKING) {
        emptyTitle = '没有跟踪中的任务';
      } else {
        emptyTitle = '还没有已完成的任务';
      }
    }
    this.setData({ rows, emptyTitle, emptyBody });
  },

  _enrich(it, idx) {
    // kind tag
    let kindLabel = '待办';
    let kindTone = 'tone-amber';
    if (it.kind === 'confirm') { kindLabel = '确认'; kindTone = 'tone-amber'; }
    else if (it.kind === 'approve_draft') { kindLabel = '审批'; kindTone = 'tone-violet'; }
    else if (it.kind === 'tracking') { kindLabel = '跟踪'; kindTone = 'tone-cyan'; }
    else if (it.kind === 'done') { kindLabel = '已完成'; kindTone = 'tone-emerald'; }

    // 年龄
    let ageLabel = '';
    if (typeof it.age_days === 'number') {
      if (it.age_days === 0) ageLabel = '今天';
      else if (it.age_days === 1) ageLabel = '昨天';
      else ageLabel = `${it.age_days} 天前`;
    } else if (it.created_at) {
      ageLabel = this._timeAgo(it.created_at);
    }

    // insights 渲染 — 仅 pending 卡 展开
    const insights = (it.insights || []).slice(0, 3).map((ins) => ({
      ...ins,
      _tone: this._insightTone(ins.type),
    }));

    return {
      ...it,
      _rowKey: `${it.kind}-${it.id}`,
      _kindLabel: kindLabel,
      _kindTone: kindTone,
      _ageLabel: ageLabel,
      _insights: insights,
      _hasInsights: insights.length > 0,
      _hasPrimary: !!it.cta_primary,
      _hasSecondary: !!it.cta_secondary,
      _animDelayMs: Math.min(idx, 8) * 40,
    };
  },

  _insightTone(type) {
    if (type === '风险') return 'tone-rose';
    if (type === '建议' || type === '决策建议') return 'tone-violet';
    if (type === '洞察') return 'tone-cyan';
    return 'tone-zinc';
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
    return `${Math.floor(h / 24)} 天前`;
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) return;
    this.setData({ tab });
    this._rebuildRows();
  },

  /** 点 card / row 整体 — 跳详情 (action 类有详情页, draft 无) */
  onTapTask(e) {
    const id = e.currentTarget.dataset.id;
    const sourceKind = e.currentTarget.dataset.sourceKind;
    if (!id) return;
    if (sourceKind === 'draft') {
      wx.showToast({ title: '草稿无详情页', icon: 'none', duration: 1200 });
      return;
    }
    // v27.2: 任务详情 已 原生
    wx.navigateTo({
      url: `/pages/task_detail/task_detail?id=${encodeURIComponent(id)}`,
      fail: (err) => console.error('[tasks] nav task_detail fail', err),
    });
  },

  /** 主 CTA */
  async onTapPrimary(e) {
    const idx = e.currentTarget.dataset.idx;
    const it = this.data.rows[idx];
    if (!it || this.data.busyKey) return;

    const okText = `已${it.cta_primary || '操作'}`;
    await this._runCta(it, 'primary', okText);
  },

  /** 副 CTA */
  async onTapSecondary(e) {
    const idx = e.currentTarget.dataset.idx;
    const it = this.data.rows[idx];
    if (!it || this.data.busyKey) return;

    // draft 驳回 — 弹 wx.showModal editable, 让用户输理由
    if (it.kind === 'approve_draft') {
      wx.showModal({
        title: '驳回这条草稿?',
        content: `「${this._truncate(it.title, 30)}」`,
        editable: true,
        placeholderText: '(可选) 为什么不准 / 错在哪 — 会回流给 AI 改进, 留空 = 整条丢弃',
        cancelText: '取消',
        confirmText: '确认驳回',
        success: async (res) => {
          if (!res.confirm) return;
          const feedback = (res.content || '').trim();
          await this._submitRejectDraft(it, feedback);
        },
      });
      return;
    }

    // action 类 — secondary = 取消, 不需 确认弹窗 (直接 PATCH cancelled)
    const okText = `已${it.cta_secondary || '操作'}`;
    await this._runCta(it, 'secondary', okText);
  },

  async _runCta(it, action, okText) {
    this.setData({ busyKey: it._rowKey });
    try {
      if (it.kind === 'confirm') {
        if (!it.source_meeting_id) throw new Error('缺 source_meeting_id');
        const status = action === 'primary' ? 'done' : 'cancelled';
        await api.patch(
          `/api/meetings/${it.source_meeting_id}/actions/${it.id}`,
          { status },
        );
      } else if (it.kind === 'approve_draft' && action === 'primary') {
        await api.post(`/api/memory-drafts/${it.id}/approve`);
      } else {
        throw new Error(`不支持的操作: ${it.kind}/${action}`);
      }
      wx.showToast({ title: okText, icon: 'success', duration: 900 });
      await this._fetch({ silent: true });
    } catch (e) {
      console.error('[tasks] cta failed', e);
      wx.showToast({
        title: '操作失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 1800,
      });
    } finally {
      this.setData({ busyKey: '' });
    }
  },

  async _submitRejectDraft(it, feedback) {
    this.setData({ busyKey: it._rowKey });
    try {
      const body = feedback
        ? { kind: 'feedback', feedback_text: feedback }
        : { kind: 'discard' };
      await api.post(`/api/memory-drafts/${it.id}/reject`, body);
      wx.showToast({
        title: feedback ? '已驳回并反馈' : '已驳回',
        icon: 'success',
        duration: 900,
      });
      await this._fetch({ silent: true });
    } catch (e) {
      console.error('[tasks] reject failed', e);
      wx.showToast({
        title: '驳回失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 1800,
      });
    } finally {
      this.setData({ busyKey: '' });
    }
  },

  _truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
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
