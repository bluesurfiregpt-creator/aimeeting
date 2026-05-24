// pages/home/home.js — v27.0-mobile S1 第 1 刀
//
// 首页 (今日) 原生骨架. 跟 H5 /m page.tsx 等价但走 native:
//   - 进 → 直接渲染 (没有 H5 hydration / webview 冷启动)
//   - 4 tab BottomNav 全 view-based, 不走 tabBar (留给后期渐变/弹性动效)
//
// 启动流程 (v27.1 路 3 OAuth):
//   1. 用户首次进小程序 → app.json pages[0] = 本页, 直接 onLoad
//   2. onLoad 看 storage 是否有 token
//      - 有 → 直接 fetch (老用户秒进)
//      - 无 → wx.reLaunch /pages/login/login (微信一键登录原生页)
//   3. login 页登录成功 → setToken 后 reLaunch 回本页, 第 2 步再走一次走到 "有"
//
// onLoad 也接受 query t= / exp= (历史 H5 桥页遗留兼容; v27.1 不再有人调,
// 但保留分支防止旧版本入口)
//
// data 结构同 frontend/src/lib/mobile/types.ts WorkbenchOut.

const api = require('../../utils/api');
const { getToken, setToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');
const app = getApp();

Page({
  data: {
    // ===== 自定义导航 (navigationStyle: custom) =====
    navPadTop: 0, // header 顶 padding = statusBar + navBar 高, 让大标题落在胶囊下方

    // ===== auth =====
    needLogin: false, // 没 token → 渲染骨架 + 跳登录

    // ===== loading =====
    loading: true,
    refreshing: false, // 下拉刷新 中
    error: '',

    // ===== workbench 数据 =====
    ongoingMeetings: [], // [{ meeting_id, title, started_minutes_ago, current_agenda_idx, total_agenda_items, latest_insight }]
    pending: [], // [{ kind, id, title, source_meeting_title, insights, cta_label }]
    insightTopics: [], // grouped — [{ key, title, count, agents:[name...], items:[insight...] }]
    rawInsights: [], // 原始 insights (跳详情 时 用)

    // ===== 视图 segment =====
    view: 'meeting', // meeting | expert

    // ===== UI 衍生字段 =====
    nowSec: 0, // ongoing started_minutes_ago 实时刷的 epoch sec (1 min 一更新)
    pendingCount: 0,
    insightCount: 0,
    topicCount: 0,
    showEmptyHero: false,

    // ===== 专家视角 (S1 第 2 刀) =====
    expertLoading: false, // 切到 expert 但 还没拉过 时 显骨架
    expertError: '',
    expertAgents: [], // [{ agent_id, name, nickname, domain, color, role, last_active,
                      //    recent_meetings, tasks, _expanded, _summaryLine, _displayName,
                      //    _colorBg, _lastActiveLabel, _meetingPreview }]
    expertCount: 0,
    expertEmpty: false,
    // P19.1: 跨卡 独立 展开态. agent_id → bool.
    // (单独 出 map 是为 wxml 里 {{expandedMap[agent.agent_id]}} 这样取)
    expandedMap: {},
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad(options) {
    // 自定义导航 — 算 大标题区 顶 padding (statusBar + navBar, 再 + 8px 透气)
    const nav = getNavMetrics();
    this.setData({ navPadTop: nav.totalHeight + 8 });

    // 兼容历史 query 桥接 (v27.0 H5 handoff 时代留下, v27.1 OAuth 后 一般 没人 调)
    if (options.t) {
      try {
        const exp =
          options.exp ||
          new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        setToken(decodeURIComponent(options.t), decodeURIComponent(exp));
      } catch (e) {
        console.warn('[home] save token from query failed', e);
      }
    }

    if (!getToken()) {
      // 没 token → 跳 H5 登录, 登完桥回本页
      this._goLogin();
      return;
    }

    // 有 token → 正常拉数据
    this._fetch();
  },

  onShow() {
    // 自定义 tabBar — 同步高亮到 "今日"
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 切回本页 (从 meeting / task 等子页返回) 时 重拉一次, 让 ongoing /
    // pending count 同步.
    // 但 onLoad 时已拉过, 避免 double fetch — 用 _hasFetched flag.
    if (this._hasFetched) {
      this._fetch({ silent: true });
    }
  },

  onPullDownRefresh() {
    this._fetch({ pullDown: true });
    // 如 当前 在 专家视角, 顺手 也 重拉 工卡 (用户预期 下拉 刷整页)
    if (this.data.view === 'expert' && this._expertFetched) {
      this._fetchExpert({ silent: true });
    }
  },

  // 1 分钟跳一次 — ongoing 卡片里"已开始 N 分钟"实时刷
  onReady() {
    this._tickTimer = setInterval(() => {
      this.setData({ nowSec: Math.floor(Date.now() / 1000) });
    }, 60 * 1000);
  },

  onUnload() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  // ============================================================
  // 数据
  // ============================================================

  async _fetch(opts) {
    const { silent, pullDown } = opts || {};
    if (!silent && !pullDown) this.setData({ loading: true, error: '' });
    if (pullDown) this.setData({ refreshing: true });

    try {
      const data = await api.get('/api/m/workbench');
      const insightTopics = this._groupInsightsByTopic(
        data.todays_insights || [],
      );
      this.setData({
        ongoingMeetings: this._enrichOngoing(data.ongoing_meetings || []),
        pending: this._enrichPending(data.pending || []),
        rawInsights: data.todays_insights || [],
        insightTopics,
        pendingCount: (data.pending || []).length,
        insightCount: (data.todays_insights || []).length,
        topicCount: insightTopics.length,
        showEmptyHero: (data.ongoing_meetings || []).length === 0,
        loading: false,
        refreshing: false,
        error: '',
        nowSec: Math.floor(Date.now() / 1000),
      });
      this._hasFetched = true;
    } catch (e) {
      console.error('[home] workbench fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        this._goLogin();
        return;
      }
      this.setData({
        loading: false,
        refreshing: false,
        error: e.message || '加载失败',
      });
    } finally {
      // scroll-view refresher 通过 data.refreshing=false 自动 收回
      // (上面 setData 已置), 不需 调 wx.stopPullDownRefresh.
    }
  },

  /**
   * 给 ongoing meeting list 补字段 (议程进度等), 让 wxml 不需 复杂表达式.
   */
  _enrichOngoing(list) {
    return list.map((m) => {
      const total = m.total_agenda_items || 0;
      const cur = m.current_agenda_idx;
      const progressText =
        total > 0 && cur !== null && cur !== undefined
          ? `议程 ${Math.min(cur + 1, total)} / ${total}`
          : total > 0
          ? `${total} 个议程`
          : '议程未拆';
      const elapsedText = this._fmtMin(m.started_minutes_ago);
      const latestInsight = m.latest_insight || null;
      return {
        ...m,
        progressText,
        elapsedText,
        latestInsight,
        latestInsightTypeTone: latestInsight ? this._insightTypeTone(latestInsight.type) : '',
      };
    });
  },

  _enrichPending(list) {
    return list.map((p) => ({
      ...p,
      kindLabel: this._pendingKindLabel(p.kind),
      kindTone: this._pendingKindTone(p.kind),
      insightCount: (p.insights || []).length,
    }));
  },

  /**
   * 把 insights 按 (meeting_id, topic_idx) 分组, 返回组列表 (跟 H5
   * groupInsightsByTopic 算法对齐, 但 wxml 友好的 plain object).
   */
  _groupInsightsByTopic(insights) {
    const groups = new Map(); // key → { key, title, count, agents:Set, items:[] }
    for (const ins of insights) {
      const tIdx = ins.topic_idx !== null && ins.topic_idx !== undefined
        ? ins.topic_idx
        : 'na';
      const key = `${ins.meeting_id}__${tIdx}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          meetingId: ins.meeting_id,
          meetingTitle: ins.meeting_title || '(未命名会议)',
          topicIdx: ins.topic_idx,
          agents: new Set(),
          items: [],
        });
      }
      const g = groups.get(key);
      g.items.push(ins);
      if (ins.agent_name) g.agents.add(ins.agent_nickname || ins.agent_name);
    }
    // 转 array, agents Set → array
    return Array.from(groups.values()).map((g) => ({
      key: g.key,
      meetingId: g.meetingId,
      meetingTitle: g.meetingTitle,
      topicIdx: g.topicIdx,
      topicTitle: this._topicShortTitle(g.items, g.topicIdx),
      count: g.items.length,
      agentLine: Array.from(g.agents).slice(0, 3).join(' / '),
      preview: g.items[0] ? this._truncate(g.items[0].content, 50) : '',
    }));
  },

  _topicShortTitle(items, idx) {
    if (idx === null || idx === undefined) return '会议整体';
    return `议题 ${idx + 1}`;
  },

  _truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  },

  _fmtMin(m) {
    if (m === null || m === undefined) return '';
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h} 小时 ${r} 分` : `${h} 小时`;
  },

  _pendingKindLabel(kind) {
    if (kind === 'confirm') return '确认';
    if (kind === 'approve_draft') return '审批';
    if (kind === 'blocked') return '阻塞';
    return '待办';
  },

  _pendingKindTone(kind) {
    if (kind === 'blocked') return 'tone-rose';
    if (kind === 'approve_draft') return 'tone-violet';
    return 'tone-amber';
  },

  _insightTypeTone(type) {
    if (type === '风险') return 'tone-rose';
    if (type === '建议' || type === '决策建议') return 'tone-violet';
    if (type === '洞察') return 'tone-cyan';
    return 'tone-zinc';
  },

  // ============================================================
  // 跳转
  // ============================================================

  _goLogin() {
    this.setData({ needLogin: true, loading: false });
    // v27.1: 直接走原生登录页, 不再绕 H5 webview + native-handoff.
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/login/login',
        fail: (err) => {
          console.error('[home] reLaunch to login fail', err);
          this.setData({ error: '跳登录失败: ' + (err.errMsg || 'unknown') });
        },
      });
    }, 60);
  },

  onTapOngoing(e) {
    const meetingId = e.currentTarget.dataset.id;
    if (!meetingId) return;
    const token = getToken();
    const exp = wx.getStorageSync('aim_token_exp') || '';
    wx.navigateTo({
      url:
        `/pages/meeting/meeting?meeting_id=${encodeURIComponent(meetingId)}` +
        `&t=${encodeURIComponent(token)}&exp=${encodeURIComponent(exp)}`,
      fail: (err) => {
        console.error('[home] navigateTo meeting fail', err);
        wx.showToast({
          title: '跳会议失败',
          icon: 'none',
        });
      },
    });
  },

  onTapPending(e) {
    const kind = e.currentTarget.dataset.kind;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // confirm / blocked = 行动项 → 原生任务详情页
    if (kind === 'confirm' || kind === 'blocked') {
      wx.navigateTo({
        url: `/pages/task_detail/task_detail?id=${encodeURIComponent(id)}`,
        fail: (err) => console.error('[home] nav task_detail fail', err),
      });
      return;
    }
    // approve_draft = 记忆草稿 → 原生「任务」tab (待处理 tab 含草稿审批)
    wx.switchTab({
      url: '/pages/tasks_list/tasks_list',
      fail: (err) => console.error('[home] switchTab tasks fail', err),
    });
  },

  onTapInsightTopic(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    // key = "<meeting_id>__<topic_idx>" — 跳该议题所属会议的原生总结页
    const meetingId = key.split('__')[0];
    if (!meetingId) return;
    wx.navigateTo({
      url: `/pages/meeting_summary/meeting_summary?id=${encodeURIComponent(meetingId)}`,
      fail: (err) => console.error('[home] nav meeting_summary fail', err),
    });
  },

  onTapAllInsights() {
    // 原生「记忆」tab
    wx.switchTab({
      url: '/pages/insights/insights',
      fail: (err) => console.error('[home] switchTab insights fail', err),
    });
  },

  // ============================================================
  // segment (会议视角 / 专家视角)
  // ============================================================

  onTapSegment(e) {
    const view = e.currentTarget.dataset.view;
    if (view !== 'meeting' && view !== 'expert') return;
    if (view === this.data.view) return;
    this.setData({ view });
    // S1 第 2 刀: 切到 expert + 还没拉过 → 拉一次
    if (view === 'expert' && !this._expertFetched && !this.data.expertLoading) {
      this._fetchExpert();
    }
  },

  // ============================================================
  // 专家视角 数据
  // ============================================================

  async _fetchExpert(opts) {
    const { silent } = opts || {};
    if (!silent) this.setData({ expertLoading: true, expertError: '' });
    try {
      const data = await api.get('/api/m/agents/workboard');
      const agents = (data.agents || []).map((a, idx) =>
        this._enrichAgent(a, idx)
      );
      this.setData({
        expertAgents: agents,
        expertCount: agents.length,
        expertEmpty: agents.length === 0,
        expertLoading: false,
        expertError: '',
      });
      this._expertFetched = true;
    } catch (e) {
      console.error('[home] agents/workboard fetch failed', e);
      if (e.message === 'unauthorized') {
        this._goLogin();
        return;
      }
      this.setData({
        expertLoading: false,
        expertError: e.message || '专家数据加载失败',
      });
    }
  },

  /**
   * 把 后端 AgentWorkCard 装成 wxml 友好的 plain object.
   * 加这几个 衍生 字段:
   *   _displayName     — nickname > name
   *   _showNicknameTag — nickname 跟 name 不同 时 在 domain 后 显 · name
   *   _lastActiveLabel — "5 分钟前" / "未激活"
   *   _isActive        — bool
   *   _summaryLine     — 折叠态 数字摘要 "3 场会议 · 2 进行中"
   *   _hasTasks        — bool, 任务卡 是否展开
   *   _hasMeetings     — bool, 最近会议 是否有
   *   _colorClass      — tone-violet / tone-emerald / ... (左侧 色块条)
   *   _meetings3       — 最多 3 条 切好日期 标题 的 plain list
   *   _animDelayMs     — 入场 stagger delay (50ms × idx, cap 8 张)
   */
  _enrichAgent(a, idx) {
    const nick = (a.nickname || '').trim();
    const name = a.name || '';
    const displayName = nick || name;
    const showNicknameTag = !!(nick && nick !== name);

    const tasks = a.tasks || {
      total: 0,
      open_count: 0,
      done_count: 0,
      overdue_count: 0,
    };
    const meetings = a.recent_meetings || [];
    const isActive = !!a.last_active;

    const summaryBits = [];
    if (meetings.length > 0) summaryBits.push(`${meetings.length} 场会议`);
    if (tasks.open_count > 0) summaryBits.push(`${tasks.open_count} 进行中`);
    if (tasks.overdue_count > 0) summaryBits.push(`${tasks.overdue_count} 超期`);
    if (summaryBits.length === 0 && tasks.total > 0) {
      summaryBits.push(`${tasks.total} 任务`);
    }

    const meetings3 = meetings.slice(0, 3).map((m) => ({
      meeting_id: m.meeting_id,
      title: m.title || '(未命名)',
      shortDate: this._meetingShortDate(m.started_at),
    }));

    return {
      ...a,
      tasks,
      _displayName: displayName,
      _showNicknameTag: showNicknameTag,
      _lastActiveLabel: isActive ? this._timeAgo(a.last_active) : '',
      _isActive: isActive,
      _summaryLine: summaryBits.join(' · '),
      _hasTasks: tasks.total > 0,
      _hasMeetings: meetings.length > 0,
      _colorClass: this._agentColorClass(a.color),
      _meetings3: meetings3,
      _animDelayMs: Math.min(idx, 8) * 50,
    };
  },

  _agentColorClass(c) {
    const map = {
      violet: 'bar-violet',
      emerald: 'bar-emerald',
      amber: 'bar-amber',
      sky: 'bar-sky',
      rose: 'bar-rose',
      teal: 'bar-teal',
      blue: 'bar-blue',
      indigo: 'bar-indigo',
    };
    return map[c] || 'bar-zinc';
  },

  _timeAgo(iso) {
    if (!iso) return '';
    let t;
    try {
      t = new Date(iso).getTime();
      if (isNaN(t)) return '';
    } catch (_) {
      return '';
    }
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return `${Math.floor(d / 30)} 月前`;
  },

  _meetingShortDate(iso) {
    if (!iso) return '';
    let d;
    try {
      d = new Date(iso);
      if (isNaN(d.getTime())) return '';
    } catch (_) {
      return '';
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  // ============================================================
  // 专家工卡 交互
  // ============================================================

  /** 点 卡片 空白 / 文字 → 跳 专家详情 (v27.2 已原生) */
  onTapAgent(e) {
    const agentId = e.currentTarget.dataset.id;
    if (!agentId) return;
    wx.navigateTo({
      url: `/pages/agent_detail/agent_detail?id=${encodeURIComponent(agentId)}`,
      fail: (err) => console.error('[home] nav agent_detail fail', err),
    });
  },

  /** 点 右上角 ▼ → 仅 toggle 本卡, 不跳详情 (catchtap 拦冒泡) */
  onToggleAgent(e) {
    const agentId = e.currentTarget.dataset.id;
    if (!agentId) return;
    const expanded = !this.data.expandedMap[agentId];
    this.setData({ [`expandedMap.${agentId}`]: expanded });
  },

  /** 错误重试 (专家视角 专属) */
  onTapRetryExpert() {
    this._fetchExpert();
  },

  // ============================================================
  // 错误重试
  // ============================================================

  onTapRetry() {
    this._fetch();
  },

  // ============================================================
  // Header 右上 通知 / 我的 入口 (v27.2 UI 对齐 H5 PageHeader)
  // ============================================================

  onTapNotifications() {
    wx.navigateTo({
      url: '/pages/notifications/notifications',
      fail: (err) => console.error('[home] navigate notifications fail', err),
    });
  },

  onTapMe() {
    wx.navigateTo({
      url: '/pages/me/me',
      fail: (err) => console.error('[home] navigate me fail', err),
    });
  },
});
