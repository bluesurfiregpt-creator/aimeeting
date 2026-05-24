// pages/insights/insights.js — v27.0-mobile S4 「记忆」模块 原生页
//
// 金字塔三层:
//   会议中 AI 发言 → [LLM 抽] → 快照 (ai_insight)
//     → [AI 筛 worth_remembering] → 待审 → [人审]
//       accepted → 记忆库 (long_term_memory)
//       rejected → 留快照 不入库
//
// 三 tab 对应三层:
//   snapshots → GET /api/m/insights?limit=50       全量 insight
//   review    → GET /api/m/insights?for_review=true  worth_remembering+pending
//   library   → GET /api/memory?limit=100             long_term_memory
//
// 拍板:
//   PATCH /api/m/insights/<id>/decision { decision: "accepted" | "rejected" }
//
// 跟 H5 /m/insights 等价, 每 tab lazy load + 切了不重拉.

const api = require('../../utils/api');
const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');

const TAB_SNAPSHOTS = 'snapshots';
const TAB_REVIEW = 'review';
const TAB_LIBRARY = 'library';

Page({
  data: {
    navPadTop: 0, // 自定义导航 — header 顶 padding

    tab: TAB_SNAPSHOTS,

    refreshing: false,

    // === Tab 1 快照 (groupedByTopic) ===
    snapshotsLoading: false,
    snapshotsErr: '',
    snapshots: [], // raw insights
    snapshotTopics: [], // grouped — [{ key, meetingId, topicIdx, meetingTitle, topicTitle,
                       //   count, agentLine, preview, items, _animDelayMs }]

    // === Tab 2 待审 ===
    reviewLoading: false,
    reviewErr: '',
    review: [], // [{ id, agent_id, agent_name, agent_nickname, type, content,
                //    evidence, meeting_title, topic_idx, created_at,
                //    _typeTone, _animDelayMs }]
    busyInsightId: '', // 操作中 — 锁双击

    // === Tab 3 记忆库 ===
    libraryLoading: false,
    libraryErr: '',
    library: [], // [{ id, content, source_meeting_id, agents,
                 //    importance, created_at, _animDelayMs, _agentsLine }]

    // tab 计数 (各 tab 拉过 一次 后才有数)
    countSnapshots: 0,
    countReview: 0,
    countLibrary: 0,

    // empty hint by tab
    emptyEmoji: '',
    emptyTitle: '',
    emptyBody: '',
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
    // 进来就拉默认 tab (snapshots)
    this._fetchTab(TAB_SNAPSHOTS);
  },

  onShow() {
    // 自定义 tabBar — 同步高亮到 "记忆"
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // silent 重拉当前 tab — 让用户从子页返回时数据是新的
    if (this._tabFetched(this.data.tab)) {
      this._fetchTab(this.data.tab, { silent: true });
    }
  },

  onPullDownRefresh() {
    // 重拉当前 tab
    this._fetchTab(this.data.tab, { pullDown: true });
  },

  // ============================================================
  // 数据 — lazy load 每个 tab 只拉一次, 切回不重复
  // ============================================================

  _tabFetched(tab) {
    if (!this._fetchedMap) this._fetchedMap = {};
    return !!this._fetchedMap[tab];
  },

  _markFetched(tab) {
    if (!this._fetchedMap) this._fetchedMap = {};
    this._fetchedMap[tab] = true;
  },

  async _fetchTab(tab, opts) {
    const { silent, pullDown } = opts || {};
    if (!silent && !pullDown) {
      // 标记 loading 在对应 tab 字段
      if (tab === TAB_SNAPSHOTS) this.setData({ snapshotsLoading: true, snapshotsErr: '' });
      else if (tab === TAB_REVIEW) this.setData({ reviewLoading: true, reviewErr: '' });
      else if (tab === TAB_LIBRARY) this.setData({ libraryLoading: true, libraryErr: '' });
    }
    if (pullDown) this.setData({ refreshing: true });

    try {
      if (tab === TAB_SNAPSHOTS) {
        const data = await api.get('/api/m/insights', { limit: 50 });
        const arr = Array.isArray(data) ? data : [];
        const topics = this._groupByTopic(arr);
        this.setData({
          snapshots: arr,
          snapshotTopics: topics,
          countSnapshots: arr.length,
          snapshotsLoading: false,
          snapshotsErr: '',
          refreshing: false,
        });
      } else if (tab === TAB_REVIEW) {
        const data = await api.get('/api/m/insights', { limit: 100, for_review: true });
        const arr = Array.isArray(data) ? data : [];
        const enriched = arr.map((ins, idx) => this._enrichInsight(ins, idx));
        this.setData({
          review: enriched,
          countReview: arr.length,
          reviewLoading: false,
          reviewErr: '',
          refreshing: false,
        });
      } else if (tab === TAB_LIBRARY) {
        const data = await api.get('/api/memory', { limit: 100 });
        const arr = Array.isArray(data) ? data : [];
        const enriched = arr.map((m, idx) => this._enrichMemory(m, idx));
        this.setData({
          library: enriched,
          countLibrary: arr.length,
          libraryLoading: false,
          libraryErr: '',
          refreshing: false,
        });
      }
      this._markFetched(tab);
      this._updateEmptyHint();
    } catch (e) {
      console.error('[insights] fetch', tab, 'failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      const errText = e.message || '加载失败';
      if (tab === TAB_SNAPSHOTS) this.setData({ snapshotsLoading: false, snapshotsErr: errText, refreshing: false });
      else if (tab === TAB_REVIEW) this.setData({ reviewLoading: false, reviewErr: errText, refreshing: false });
      else if (tab === TAB_LIBRARY) this.setData({ libraryLoading: false, libraryErr: errText, refreshing: false });
    }
  },

  _updateEmptyHint() {
    // 根据 当前 tab + 数据长度 设置 empty hint
    const { tab } = this.data;
    if (tab === TAB_SNAPSHOTS) {
      this.setData({
        emptyEmoji: '💡',
        emptyTitle: '还没有 AI 快照',
        emptyBody: '进一场会议召唤专家加视角, 会议结束后这里会有快照',
      });
    } else if (tab === TAB_REVIEW) {
      this.setData({
        emptyEmoji: '✓',
        emptyTitle: '没有待审快照',
        emptyBody: 'AI 还没从会议里挑出值得沉淀的内容, 或你都审完了',
      });
    } else {
      this.setData({
        emptyEmoji: '📚',
        emptyTitle: '记忆库还空',
        emptyBody: '审通过几条待审就有了 — 入库后未来会议 AI 会自动检索调用',
      });
    }
  },

  /** 按 (meeting_id, topic_idx) 分组, 跟 home._groupInsightsByTopic 一致 */
  _groupByTopic(insights) {
    const map = new Map();
    for (const ins of insights) {
      const tIdx = ins.topic_idx !== null && ins.topic_idx !== undefined ? ins.topic_idx : 'na';
      const key = `${ins.meeting_id}__${tIdx}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          meetingId: ins.meeting_id,
          meetingTitle: ins.meeting_title || '(未命名会议)',
          topicIdx: ins.topic_idx,
          agents: new Set(),
          items: [],
        });
      }
      const g = map.get(key);
      g.items.push(ins);
      if (ins.agent_name) g.agents.add(ins.agent_nickname || ins.agent_name);
    }
    return Array.from(map.values()).map((g, idx) => ({
      key: g.key,
      meetingId: g.meetingId,
      meetingTitle: g.meetingTitle,
      topicIdx: g.topicIdx,
      topicTitle: g.topicIdx === null || g.topicIdx === undefined
        ? '会议整体'
        : `议题 ${g.topicIdx + 1}`,
      count: g.items.length,
      agentLine: Array.from(g.agents).slice(0, 3).join(' / '),
      preview: g.items[0] ? this._truncate(g.items[0].content, 60) : '',
      _animDelayMs: Math.min(idx, 8) * 40,
    }));
  },

  _enrichInsight(ins, idx) {
    return {
      ...ins,
      _typeTone: this._insightTone(ins.type),
      _displayAgent: ins.agent_nickname || ins.agent_name || '',
      _evidenceShort: ins.evidence ? this._truncate(ins.evidence, 80) : '',
      _whenLabel: this._timeAgo(ins.created_at),
      _animDelayMs: Math.min(idx, 8) * 40,
    };
  },

  _enrichMemory(m, idx) {
    const agents = m.agents || [];
    const agentNames = agents.map((a) => (a.is_primary ? a.name + ' ★' : a.name));
    return {
      ...m,
      _agentsLine: agentNames.join(' · '),
      _whenLabel: this._timeAgo(m.created_at),
      _importanceStars: this._stars(m.importance),
      _hasSource: !!m.source_meeting_id,
      _animDelayMs: Math.min(idx, 8) * 40,
    };
  },

  _stars(n) {
    const safe = Math.max(0, Math.min(5, n || 0));
    return '★'.repeat(safe) + '☆'.repeat(5 - safe);
  },

  _insightTone(type) {
    if (type === '风险') return 'tone-rose';
    if (type === '建议' || type === '决策建议') return 'tone-violet';
    if (type === '洞察') return 'tone-cyan';
    if (type === '思路') return 'tone-amber';
    return 'tone-zinc';
  },

  _truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
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

  onTapTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) return;
    this.setData({ tab });
    // 切到没拉过的 tab → 拉
    if (!this._tabFetched(tab)) {
      this._fetchTab(tab);
    }
    this._updateEmptyHint();
  },

  /** 快照 tab — 点议题组, 跳该会议的原生总结页 */
  onTapTopic(e) {
    const meetingId = e.currentTarget.dataset.meeting;
    if (!meetingId) return;
    wx.navigateTo({
      url: `/pages/meeting_summary/meeting_summary?id=${encodeURIComponent(meetingId)}`,
      fail: (err) => console.error('[insights] nav meeting_summary fail', err),
    });
  },

  /** 待审 tab — 入库 */
  async onTapAccept(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.busyInsightId) return;
    this.setData({ busyInsightId: id });
    try {
      await api.patch(`/api/m/insights/${id}/decision`, { decision: 'accepted' });
      // 从 review 列表 移除 + 记忆库 标 dirty 下次切换时重拉
      const newReview = this.data.review.filter((x) => x.id !== id);
      this.setData({
        review: newReview,
        countReview: newReview.length,
      });
      if (this._fetchedMap) this._fetchedMap[TAB_LIBRARY] = false;
      this._updateEmptyHint();
      wx.showToast({ title: '已入库,记忆库可见', icon: 'success', duration: 1000 });
    } catch (e) {
      console.error('[insights] accept failed', e);
      wx.showToast({
        title: '入库失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 1800,
      });
    } finally {
      this.setData({ busyInsightId: '' });
    }
  },

  /** 待审 tab — 驳回 */
  async onTapReject(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.busyInsightId) return;
    // 不弹 confirm — 跟 H5 一致, 直接调
    this.setData({ busyInsightId: id });
    try {
      await api.patch(`/api/m/insights/${id}/decision`, { decision: 'rejected' });
      const newReview = this.data.review.filter((x) => x.id !== id);
      this.setData({
        review: newReview,
        countReview: newReview.length,
      });
      this._updateEmptyHint();
      wx.showToast({ title: '已驳回', icon: 'success', duration: 900 });
    } catch (e) {
      console.error('[insights] reject failed', e);
      wx.showToast({
        title: '驳回失败: ' + (e.message || '').slice(0, 18),
        icon: 'none',
        duration: 1800,
      });
    } finally {
      this.setData({ busyInsightId: '' });
    }
  },

  /** 记忆库 tab — 点 row, 跳来源会议总结 (有的话) */
  onTapMemory(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.library[idx];
    if (!m || !m.source_meeting_id) {
      wx.showToast({ title: '无来源会议', icon: 'none', duration: 900 });
      return;
    }
    wx.navigateTo({
      url: `/pages/meeting_summary/meeting_summary?id=${encodeURIComponent(m.source_meeting_id)}`,
      fail: (err) => console.error('[insights] nav summary fail', err),
    });
  },

  onTapRetry() {
    this._fetchTab(this.data.tab);
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
