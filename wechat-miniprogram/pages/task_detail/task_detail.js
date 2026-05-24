// pages/task_detail/task_detail.js — v27.2 任务详情 原生页
//
// 对齐 H5 /m/tasks/[id]:
//   - 任务全文 + 状态/截止/归属 chip + 来源会议 link
//   - AI 智囊依据 (insights)
//   - 实录依据 (evidence_quote + evidence_lines)
//   - 评论时间线 + 发评论 / 删评论
//
// API:
//   GET    /api/m/tasks/{id}
//   POST   /api/meetings/{mid}/actions/{aid}/comments  { content }
//   DELETE /api/meetings/{mid}/actions/{aid}/comments/{cid}

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

// 任务 8 态 中文 + tone
const STATUS_MAP = {
  open:        { label: '待派',   tone: 'tone-amber' },
  dispatched:  { label: '已派',   tone: 'tone-sky' },
  accepted:    { label: '已接',   tone: 'tone-sky' },
  in_progress: { label: '进行中', tone: 'tone-violet' },
  submitted:   { label: '待审',   tone: 'tone-violet' },
  done:        { label: '已完成', tone: 'tone-emerald' },
  archived:    { label: '归档',   tone: 'tone-zinc' },
  cancelled:   { label: '已取消', tone: 'tone-zinc' },
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,

    id: '',
    loading: true,
    error: '',
    data: null,        // enrich 后的 TaskDetailOut

    commentText: '',
    posting: false,
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
      this.setData({ loading: false, error: '缺少任务 id' });
      return;
    }
    this._fetch();
  },

  onTapBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/tasks_list/tasks_list' }) });
  },

  // ============================================================
  // 数据
  // ============================================================

  async _fetch(opts) {
    const silent = opts && opts.silent;
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const d = await api.get(`/api/m/tasks/${this.data.id}`);
      this.setData({ data: this._enrich(d), loading: false, error: '' });
    } catch (e) {
      console.error('[task_detail] fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  _enrich(d) {
    const st = STATUS_MAP[d.status] || STATUS_MAP.open;

    // 归属 chip
    let assignee = null;
    if (d.assignee_agent_id) {
      assignee = { icon: '🤖', text: d.assignee_agent_nickname || d.assignee_agent_name || 'AI', tone: 'tone-violet' };
    } else if (d.assignee_user_id) {
      assignee = { icon: '👤', text: d.assignee_user_name || '', tone: 'tone-emerald' };
    } else if (d.assignee_name_hint) {
      assignee = { icon: '?', text: d.assignee_name_hint, tone: 'tone-zinc' };
    }

    const insights = (d.insights || []).map((ins) => ({
      ...ins,
      _tone: this._insightTone(ins.type),
    }));
    const comments = (d.comments || []).map((c) => ({
      ...c,
      _whenLabel: this._fmtDate(c.created_at),
    }));
    const evLines = (d.evidence_lines || []).map((l) => ({
      ...l,
      _minLabel: String(l.at_minute).padStart(2, '0') + 'm',
    }));

    return {
      ...d,
      _statusLabel: st.label,
      _statusTone: st.tone,
      _dueLabel: d.due_at ? this._fmtDueDate(d.due_at) : '',
      _assignee: assignee,
      _hasInsights: insights.length > 0,
      _insights: insights,
      _hasEvidence: !!(d.evidence_quote || (d.evidence_lines && d.evidence_lines.length > 0)),
      _evLines: evLines,
      _comments: comments,
    };
  },

  _insightTone(type) {
    if (type === '风险') return 'tone-rose';
    if (type === '建议' || type === '决策建议') return 'tone-violet';
    if (type === '洞察') return 'tone-cyan';
    if (type === '思路') return 'tone-amber';
    return 'tone-zinc';
  },

  _fmtDate(iso) {
    if (!iso) return '';
    let d;
    try { d = new Date(iso); if (isNaN(d.getTime())) return ''; } catch (_) { return ''; }
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay
      ? `今天 ${hh}:${mm}`
      : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  },

  _fmtDueDate(iso) {
    let d;
    try { d = new Date(iso); if (isNaN(d.getTime())) return ''; } catch (_) { return ''; }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  // ============================================================
  // 来源会议
  // ============================================================

  onTapSourceMeeting() {
    const d = this.data.data;
    if (!d || !d.source_meeting_id) return;
    wx.navigateTo({
      url: `/pages/meeting_summary/meeting_summary?id=${d.source_meeting_id}`,
      fail: (err) => console.error('[task_detail] nav meeting fail', err),
    });
  },

  // ============================================================
  // 评论
  // ============================================================

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  async onPostComment() {
    const d = this.data.data;
    if (!d) return;
    if (!d.source_meeting_id) {
      wx.showToast({ title: '找不到源会议, 无法评论', icon: 'none' });
      return;
    }
    const txt = (this.data.commentText || '').trim();
    if (!txt || this.data.posting) return;

    this.setData({ posting: true });
    try {
      await api.post(
        `/api/meetings/${d.source_meeting_id}/actions/${d.action_item_id}/comments`,
        { content: txt },
      );
      this.setData({ commentText: '' });
      await this._fetch({ silent: true });
      wx.showToast({ title: '评论已发布', icon: 'success', duration: 800 });
    } catch (e) {
      console.error('[task_detail] post comment failed', e);
      wx.showToast({
        title: '评论失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 2000,
      });
    } finally {
      this.setData({ posting: false });
    }
  },

  onTapDeleteComment(e) {
    const d = this.data.data;
    const cid = e.currentTarget.dataset.cid;
    if (!d || !cid || !d.source_meeting_id) return;
    wx.showModal({
      title: '删除这条评论?',
      confirmText: '删除',
      confirmColor: '#f43f5e',
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await api.del(
            `/api/meetings/${d.source_meeting_id}/actions/${d.action_item_id}/comments/${cid}`,
          );
          await this._fetch({ silent: true });
          wx.showToast({ title: '已删除', icon: 'success', duration: 700 });
        } catch (err) {
          wx.showToast({
            title: '删除失败: ' + (err.message || '').slice(0, 18),
            icon: 'none',
            duration: 2000,
          });
        }
      },
    });
  },

  onTapRetry() {
    this._fetch();
  },
});
