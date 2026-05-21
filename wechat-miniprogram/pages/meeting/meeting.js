// pages/meeting/meeting.js — v27.0-mobile P21 原生 N-1 会议室主页.
//
// 已完成的刀:
//   1. 骨架 + 鉴权 + 拉详情 + 议程/状态渲染
//   2. WebSocket + 转录列表 + 自动滚 (当前)
//
// 后续刀:
//   3. 录音 + PCM 发送
//   4. AI 气泡 + 议程 banner
//   5. 召唤 sheet + 邀请追加
//   6. 真机调试 + token 桥接 (替代开发模式输入框)

const { getToken, setToken } = require('../../utils/auth');
const api = require('../../utils/api');
const { createMeetingWs } = require('../../utils/ws');
const { createRecorder, openMicSetting } = require('../../utils/recorder');

const AUTO_SCROLL_THRESHOLD_PX = 80; // 距底部 < 80px 时认为"贴底", 继续自动滚

Page({
  data: {
    meetingId: '',
    loading: true,
    error: '',
    needToken: false,
    devTokenInput: '',
    devTokenExpInput: '',
    detail: null,
    agendaChips: [],

    // 第 2 刀新增
    wsState: 'idle',            // idle / connecting / connected / ready / reconnecting / closed
    transcriptLines: [],         // [{ id, kind: 'user', speaker_name, speaker_status, text, at_minute }]
    transcriptScrollIntoView: '',// 目标元素 id, 触发自动滚
    transcriptStuckAtBottom: true, // 用户没主动上滑 = 继续自动滚
    pendingNewCount: 0,          // 用户上滑后, 累计的"新转录"数 (显在 ↓ 按钮上)

    // 第 3 刀新增 — 录音
    micState: 'idle',           // idle / starting / recording / paused / stopping / error
    micError: '',
    micElapsedSec: 0,           // 已录秒数 (录音中每秒 +1)
    micElapsedStr: '00:00',     // mm:ss 格式 (供 wxml 直接渲染)
    framesSent: 0,              // 已发 PCM 帧数 (debug 用)

    // 第 4 刀新增 — 议程 banner (顶部插条, 同时只显 1 个)
    banner: null,

    // 第 5 刀新增 — 召唤 sheet
    summonSheetOpen: false,
    workspaceAgents: null,     // [WorkspaceAgentBrief] 工作区所有 active AI
    workspaceAgentsLoading: false,
    workspaceAgentsErr: '',
    summonBusyId: '',          // 正在 summon/invite 的 agent_id (防 double click)
    inviteableAgents: [],      // computed: workspaceAgents 过滤掉已在 attending 的
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad(options) {
    const meetingId = options.meeting_id || options.id || '';
    if (!meetingId) {
      this.setData({ loading: false, error: '缺少 meeting_id 参数' });
      return;
    }
    this.setData({ meetingId });

    // 第 6 刀: query 带 t= / exp= 是 H5 端 NativeMeetingEntry 桥接过来的;
    // 直接写 storage. 开发期手动 powaste 也走这条 (粘贴框依然作 fallback).
    if (options.t) {
      try {
        const exp =
          options.exp ||
          new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        setToken(decodeURIComponent(options.t), decodeURIComponent(exp));
      } catch (e) {
        console.warn('save token from query failed', e);
      }
    }

    if (!getToken()) {
      // 没 token + 没 query → 显引导提示 + 开发模式 fallback 输入框
      this.setData({ loading: false, needToken: true });
      return;
    }

    this._init();
  },

  async _init() {
    // 串行: 拉详情 → 拉历史转录 → 接 WS
    try {
      await this.fetchDetail();
      await this.fetchTranscript();
      this.connectWs();
    } catch (e) {
      // fetchDetail 自己已经 setData error, 不重复处理
      console.warn('init failed', e);
    }
  },

  onUnload() {
    if (this._recorder) {
      this._recorder.dispose();
      this._recorder = null;
    }
    if (this._micTimer) {
      clearInterval(this._micTimer);
      this._micTimer = null;
    }
    this._clearBannerTimer();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  },

  onHide() {
    // 切到后台 / 跳子页 时, 暂不断 WS — 用户可能很快回来
    // 真要省电的话 onHide 断, onShow 重连; mvp 不做
  },

  // ============================================================
  // 详情 + 议程
  // ============================================================

  async fetchDetail() {
    const { meetingId } = this.data;
    this.setData({ loading: true, error: '' });
    try {
      const detail = await api.get(`/api/m/meetings/${meetingId}`);
      this.setData({
        detail,
        agendaChips: this._buildAgendaChips(
          detail.agenda_items || [],
          detail.current_agenda_idx,
        ),
        loading: false,
      });
      this._recomputeInviteable();
      wx.setNavigationBarTitle({ title: detail.title || '会议室' });
      return detail;
    } catch (e) {
      console.error('fetch meeting detail failed', e);
      if (e.message === 'unauthorized') {
        this.setData({
          loading: false,
          needToken: true,
          error: 'token 已失效, 请重新粘贴',
        });
      } else {
        this.setData({ loading: false, error: e.message || '加载失败' });
      }
      throw e;
    }
  },

  _buildAgendaChips(items, currentIdx) {
    return items.map((item, idx) => {
      let statusIcon = '○';
      let toneClass = 'chip-pending';
      if (item.status === 'done') {
        statusIcon = '✓';
        toneClass = 'chip-done';
      } else if (item.status === 'active') {
        statusIcon = '●';
        toneClass = 'chip-active';
      }
      return {
        idx,
        title: item.title || `议题 ${idx + 1}`,
        statusIcon,
        toneClass,
        timeBudget: item.time_budget_min,
        elapsedMin: item.elapsed_min,
        isCurrent: idx === currentIdx,
      };
    });
  },

  // ============================================================
  // 转录: 历史 + 实时
  // ============================================================

  async fetchTranscript() {
    const { meetingId } = this.data;
    try {
      const data = await api.get(`/api/m/meetings/${meetingId}/transcript`);
      // 第 4 刀: 保留 user + agent 两种 line, 统一 schema
      const lines = (data.lines || []).map((l) =>
        l.kind === 'agent' ? this._normalizeAgentLine(l) : this._normalizeUserLine(l),
      );
      // 重置正在 streaming 的 agent map (这是新拉的 snapshot, 历史所有 agent 行都 done)
      this._currentAgentLineByAgent = {};
      this.setData({ transcriptLines: lines });
      this._scrollToBottom();
    } catch (e) {
      console.warn('fetch transcript failed', e);
    }
  },

  _normalizeUserLine(line) {
    return {
      id: 't-' + line.id,
      kind: 'user',
      lineId: line.id,
      speakerName: line.speaker_name || '未知',
      speakerStatus: line.speaker_status || '',
      text: line.text || '',
      atMinute: line.at_minute,
      status: 'done',
    };
  },

  _normalizeAgentLine(line) {
    // history endpoint /transcript 返的 agent line: kind/id/text/at_minute/created_at/
    //   agent_id/agent_name/agent_nickname/agent_color/trigger/citations_count
    return {
      id: 'a-hist-' + line.id,
      kind: 'agent',
      lineId: line.id,
      text: line.text || '',
      atMinute: line.at_minute,
      agentId: line.agent_id || '',
      agentName: line.agent_name || 'AI',
      agentNickname: line.agent_nickname || '',
      agentColor: line.agent_color || 'violet',
      citationsCount: line.citations_count || 0,
      status: 'done',
    };
  },

  _appendLiveLine(event) {
    const newLine = {
      id: 't-' + event.line_id,
      kind: 'user',
      lineId: event.line_id,
      speakerName: event.speaker_name || '未知',
      speakerStatus: event.speaker_status || '',
      text: event.text || '',
      atMinute: this._msToMinute(event.start_ms),
      status: 'done',
    };
    const lines = this.data.transcriptLines.slice();
    if (lines.some((l) => l.lineId === newLine.lineId && l.kind === 'user')) return;
    lines.push(newLine);
    const updates = { transcriptLines: lines };
    if (!this.data.transcriptStuckAtBottom) {
      updates.pendingNewCount = this.data.pendingNewCount + 1;
    }
    this.setData(updates, () => {
      if (this.data.transcriptStuckAtBottom) this._scrollToBottom();
    });
  },

  // ============================================================
  // AI 流式气泡 (第 4 刀)
  // ============================================================
  //
  // 状态: this._currentAgentLineByAgent = { agent_id: lineId }
  //   start → 新建一条 streaming line, 记 agent_id → 这条 line 的 id
  //   chunk → 找 agent_id 对应的 line, 路径语法 setData 局部 append text
  //   end → 用 event.text 替换 (防 chunk 拼接误差), status='done', 移除 map 项

  _onAgentMessageStart(event) {
    // event: { type, agent_id, agent_name, agent_nickname, agent_color }
    if (!this._currentAgentLineByAgent) this._currentAgentLineByAgent = {};
    // 同 agent 上一条还没 end? 强制关掉, 防 ghost line
    if (this._currentAgentLineByAgent[event.agent_id]) {
      this._finalizeStreamingLine(event.agent_id, null);
    }
    const lineId = 'a-' + event.agent_id + '-' + Date.now() + '-' +
      Math.floor(Math.random() * 1000);
    const newLine = {
      id: lineId,
      kind: 'agent',
      text: '',
      agentId: event.agent_id,
      agentName: event.agent_name || 'AI',
      agentNickname: event.agent_nickname || '',
      agentColor: event.agent_color || 'violet',
      status: 'streaming',
      atMinute: null,
      citationsCount: 0,
    };
    this._currentAgentLineByAgent[event.agent_id] = lineId;
    const lines = this.data.transcriptLines.slice();
    lines.push(newLine);
    const updates = { transcriptLines: lines };
    if (!this.data.transcriptStuckAtBottom) {
      updates.pendingNewCount = this.data.pendingNewCount + 1;
    }
    this.setData(updates, () => {
      if (this.data.transcriptStuckAtBottom) this._scrollToBottom();
    });
  },

  _onAgentMessageChunk(event) {
    // event: { type, agent_id, chunk }
    if (!event.chunk) return;
    const lineId = this._currentAgentLineByAgent &&
      this._currentAgentLineByAgent[event.agent_id];
    if (!lineId) return; // 没 start? 容错丢弃 chunk
    const idx = this.data.transcriptLines.findIndex((l) => l.id === lineId);
    if (idx < 0) return;
    const oldText = this.data.transcriptLines[idx].text || '';
    const newText = oldText + event.chunk;
    // 路径语法局部更新, 比 setData 整个 array 轻
    this.setData(
      { [`transcriptLines[${idx}].text`]: newText },
      () => {
        if (this.data.transcriptStuckAtBottom) this._scrollToBottom();
      },
    );
  },

  _onAgentMessageEnd(event) {
    // event: { type, agent_id, text, citations }
    this._finalizeStreamingLine(event.agent_id, event);
  },

  _finalizeStreamingLine(agentId, event) {
    if (!this._currentAgentLineByAgent) return;
    const lineId = this._currentAgentLineByAgent[agentId];
    if (!lineId) return;
    delete this._currentAgentLineByAgent[agentId];
    const idx = this.data.transcriptLines.findIndex((l) => l.id === lineId);
    if (idx < 0) return;
    const updates = {
      [`transcriptLines[${idx}].status`]: 'done',
    };
    if (event) {
      if (event.text) updates[`transcriptLines[${idx}].text`] = event.text;
      if (Array.isArray(event.citations)) {
        updates[`transcriptLines[${idx}].citationsCount`] = event.citations.length;
      }
    }
    this.setData(updates);
  },

  _msToMinute(ms) {
    if (ms === null || ms === undefined) return null;
    return Math.floor(ms / 60000);
  },

  _scrollToBottom() {
    const lines = this.data.transcriptLines;
    if (lines.length === 0) return;
    const lastId = lines[lines.length - 1].id;
    this.setData({ transcriptScrollIntoView: lastId });
  },

  // 用户手动滚到底 — 触发 scroll-view 的 bindscrolltolower
  onScrollToBottom() {
    if (!this.data.transcriptStuckAtBottom) {
      this.setData({ transcriptStuckAtBottom: true, pendingNewCount: 0 });
    }
  },

  // scroll-view 滚动事件 — 判断当前是否贴底
  onTranscriptScroll(e) {
    const { scrollTop, scrollHeight } = e.detail;
    // detail 没 viewport height — 我们用 selectorQuery 拿, 但每次滚都查 太贵.
    // 简化: bindscrolltolower 触发时算贴底; 用户主动上滑导致 stuck=false 在
    // _checkStuckOnUserScroll 处理.
    // 这里不需要做事 (留个 hook 给未来要做)
  },

  // 用户上滑 时 bindscrolltoupper 不准 (是滚到最上方才触发).
  // 改用 touchend 检测当前位置.
  onTranscriptTouchEnd() {
    // 用 selectorQuery 拿当前 scrollTop + scrollHeight + clientHeight
    const q = wx.createSelectorQuery();
    q.select('#transcript-scroll').scrollOffset();
    q.select('#transcript-scroll').boundingClientRect();
    q.exec((res) => {
      const offset = res[0];
      const rect = res[1];
      if (!offset || !rect) return;
      const distanceToBottom =
        offset.scrollHeight - offset.scrollTop - rect.height;
      const stuck = distanceToBottom < AUTO_SCROLL_THRESHOLD_PX;
      if (stuck !== this.data.transcriptStuckAtBottom) {
        this.setData({
          transcriptStuckAtBottom: stuck,
          pendingNewCount: stuck ? 0 : this.data.pendingNewCount,
        });
      }
    });
  },

  // 用户点 "↓ N 条新" 跳到底部
  onJumpToBottom() {
    this.setData({ transcriptStuckAtBottom: true, pendingNewCount: 0 });
    this._scrollToBottom();
  },

  // ============================================================
  // WebSocket 接入
  // ============================================================

  connectWs() {
    const token = getToken();
    if (!token) {
      console.warn('connectWs: no token');
      return;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._ws = createMeetingWs({
      meetingId: this.data.meetingId,
      token,
      onSystem: (ev) => {
        if (ev.msg === 'auth required' || ev.msg === 'invalid meeting_id') {
          console.warn('[ws] fatal system msg:', ev.msg);
          // 这种是 server 主动 close 前发的, 不重连
          if (this._ws) {
            this._ws.close();
            this._ws = null;
          }
        }
      },
      onTranscript: (ev) => {
        this._appendLiveLine(ev);
      },
      onSpeakersUpdated: () => {
        // 声纹识别完了, 重新拉一次完整转录 (因为后端可能更新了 speaker_name)
        this.fetchTranscript();
      },
      onAgentMessageStart: (ev) => this._onAgentMessageStart(ev),
      onAgentMessageChunk: (ev) => this._onAgentMessageChunk(ev),
      onAgentMessageEnd: (ev) => this._onAgentMessageEnd(ev),
      onAgendaEvent: (ev) => this._onAgendaEvent(ev),
      onDissentDetected: (ev) => this._onAgendaEvent({ ...ev, type: 'dissent_detected' }),
      onAgentsInvited: (ev) => {
        // 重新拉一次 detail (拿到新 attending_agents)
        this.fetchDetail();
      },
      onConnectionChange: (state) => {
        this.setData({ wsState: state });
      },
    });
  },

  // ============================================================
  // 议程 banner (第 4 刀)
  // ============================================================
  //
  // 6 种 event 各自的 banner tone + 内容. mvp 实现:
  //   - 同时只显 1 个 banner (新 event 覆盖旧)
  //   - 带 auto_summon_after_s 的事件做倒计时显示 (纯视觉)
  //   - 倒计时到 0 → 关 banner (mvp 不真召唤, 留 第 5 刀)
  //   - 用户可主动关
  //
  // 跟 H5 端 P16 AgendaEventBanner 视觉风格对齐.

  _onAgendaEvent(event) {
    const banner = this._eventToBanner(event);
    if (!banner) return;
    // 关旧 banner 的倒计时
    this._clearBannerTimer();
    this.setData({ banner });
    if (banner.countdownSec && banner.countdownSec > 0) {
      this._startBannerTimer();
    }
  },

  _eventToBanner(event) {
    const t = event.type;
    if (t === 'agenda_off_topic') {
      const severity = event.off_topic_severity || 'suspected';
      const isSevere = severity === 'severe';
      return {
        type: t,
        tone: isSevere ? 'severe' : (severity === 'confirmed' ? 'warning' : 'info'),
        emoji: isSevere ? '🚨' : '⚠️',
        title: isSevere ? '严重偏离议程' : '偏离议程',
        text: event.off_topic_summary || '当前讨论似乎偏离了议程',
        sub: event.suggested_agenda_item
          ? `建议回到: ${event.suggested_agenda_item}`
          : null,
        countdownSec: event.auto_summon_after_s || 0,
        autoSummon: !!event.auto_summon_after_s,
      };
    }
    if (t === 'agenda_stuck') {
      return {
        type: t,
        tone: 'warning',
        emoji: '⏸',
        title: '议题僵局',
        text: event.stuck_summary || '议题卡住了, 建议召唤主持人推进',
        sub: null,
        countdownSec: event.auto_summon_after_s || 5,
        autoSummon: true,
      };
    }
    if (t === 'agenda_time_warning') {
      return {
        type: t,
        tone: 'warning',
        emoji: '⏰',
        title: '议题时间预警',
        text: event.time_warning_text || '当前议题已超过预设时间',
        sub: event.elapsed_min ? `已议 ${event.elapsed_min} 分钟` : null,
        countdownSec: 0,
        autoSummon: false,
      };
    }
    if (t === 'agenda_decision_summary') {
      return {
        type: t,
        tone: 'info',
        emoji: '🎯',
        title: '需要收口拍板',
        text: event.decision_brief || '出现多个立场, 建议主持人收口',
        sub: event.current_agenda_item
          ? `议题: ${event.current_agenda_item}`
          : null,
        countdownSec: event.auto_summon_after_s || 12,
        autoSummon: true,
      };
    }
    if (t === 'agenda_advance_suggested') {
      return {
        type: t,
        tone: 'success',
        emoji: '→',
        title: '可以推进下一议程',
        text: event.advance_reason || '当前议题似乎已收口',
        sub: event.next_agenda_item
          ? `下一项: ${event.next_agenda_item}`
          : null,
        countdownSec: 0,
        autoSummon: false,
      };
    }
    if (t === 'dissent_detected') {
      return {
        type: t,
        tone: 'severe',
        emoji: '⚔️',
        title: '检测到立场分歧',
        text: event.summary || event.dissent_summary || '专家间出现立场分歧',
        sub: null,
        countdownSec: 0,
        autoSummon: false,
      };
    }
    return null;
  },

  _startBannerTimer() {
    this._clearBannerTimer();
    this._bannerTimer = setInterval(() => {
      const b = this.data.banner;
      if (!b || !b.countdownSec || b.countdownSec <= 0) {
        this._clearBannerTimer();
        return;
      }
      const next = b.countdownSec - 1;
      if (next <= 0) {
        this._clearBannerTimer();
        // 第 5 刀: 倒计时到 0 自动召唤 (autoSummon=true 时)
        if (b.autoSummon) {
          this._autoSummonForBanner(b);
        }
        this.setData({ banner: null });
        return;
      }
      this.setData({ 'banner.countdownSec': next });
    }, 1000);
  },

  _clearBannerTimer() {
    if (this._bannerTimer) {
      clearInterval(this._bannerTimer);
      this._bannerTimer = null;
    }
  },

  onBannerClose() {
    this._clearBannerTimer();
    this.setData({ banner: null });
  },

  /** banner "立刻召唤" 按钮 — 手动触发 */
  onBannerSummonNow() {
    const b = this.data.banner;
    if (!b) return;
    this._clearBannerTimer();
    this._autoSummonForBanner(b);
    this.setData({ banner: null });
  },

  _autoSummonForBanner(banner) {
    // banner.autoSummon=true 的几种 (stuck / severe off_topic / decision_summary)
    // 都是 召唤主持人. 从 attending_agents 找 role='moderator';
    // 找不到就 toast 提示 (mvp 不自动 invite moderator).
    const mod = this._findModerator();
    if (!mod) {
      wx.showToast({
        title: '会议中无主持人, 请先邀请',
        icon: 'none',
        duration: 2500,
      });
      return;
    }
    this._summonAgent(mod.agent_id, { silent: false });
  },

  _findModerator() {
    const attending =
      (this.data.detail && this.data.detail.attending_agents) || [];
    return attending.find((a) => a.role === 'moderator');
  },

  // ============================================================
  // 召唤 sheet (第 5 刀)
  // ============================================================

  onOpenSummonSheet() {
    if (!this.data.detail || this.data.detail.status !== 'ongoing') {
      wx.showToast({ title: '仅进行中会议可召唤', icon: 'none' });
      return;
    }
    this.setData({ summonSheetOpen: true });
    if (this.data.workspaceAgents === null) {
      this._fetchWorkspaceAgents();
    }
  },

  onCloseSummonSheet() {
    this.setData({ summonSheetOpen: false });
  },

  async _fetchWorkspaceAgents() {
    this.setData({ workspaceAgentsLoading: true, workspaceAgentsErr: '' });
    try {
      const list = await api.get('/api/agents', { active_only: true });
      // 仅显 expert + moderator role (其他角色不进会议)
      const filtered = (list || []).filter(
        (a) => a.role === 'expert' || a.role === 'moderator',
      );
      this.setData({
        workspaceAgents: filtered,
        workspaceAgentsLoading: false,
      });
      this._recomputeInviteable();
    } catch (e) {
      console.error('fetch workspace agents failed', e);
      this.setData({
        workspaceAgentsLoading: false,
        workspaceAgentsErr: e.message || '加载失败',
      });
    }
  },

  _recomputeInviteable() {
    const workspaceAgents = this.data.workspaceAgents;
    if (!workspaceAgents) {
      this.setData({ inviteableAgents: [] });
      return;
    }
    const attendingIds = new Set(
      ((this.data.detail && this.data.detail.attending_agents) || []).map(
        (a) => a.agent_id,
      ),
    );
    this.setData({
      inviteableAgents: workspaceAgents.filter((a) => !attendingIds.has(a.id)),
    });
  },

  /** sheet 内点击 agent 卡片 — 已邀请的直接 summon, 未邀请的先 invite 再 summon */
  onSheetSummonAgent(e) {
    const agentId = e.currentTarget.dataset.id;
    if (!agentId) return;
    this._summonAgent(agentId, { silent: false, closeSheet: true });
  },

  /**
   * 召唤一个 AI 发言.
   * 若 agent 不在 attending → 先调 invite endpoint, 再 summon.
   * 后端 invite 后会通过 WS agents_invited 推, 我们 fetchDetail 更新 attending.
   */
  async _summonAgent(agentId, opts = {}) {
    if (!agentId || this.data.summonBusyId === agentId) return;
    this.setData({ summonBusyId: agentId });
    try {
      const meetingId = this.data.meetingId;
      const attending =
        (this.data.detail && this.data.detail.attending_agents) || [];
      const isAttending = attending.some((a) => a.agent_id === agentId);

      if (!isAttending) {
        // 先邀请 (这一步 ABAC 要 leader+ 或 创建人; member 调会 403)
        await api.post(`/api/meetings/${meetingId}/agents`, {
          agent_ids: [agentId],
        });
      }
      // 再召唤
      await api.post(`/api/m/meetings/${meetingId}/summon`, {
        agent_id: agentId,
      });
      if (!opts.silent) {
        wx.showToast({ title: '已请发言', icon: 'success' });
      }
      if (opts.closeSheet) {
        this.setData({ summonSheetOpen: false });
      }
    } catch (e) {
      console.error('summon agent failed', e);
      wx.showToast({
        title: e.message || '召唤失败',
        icon: 'none',
        duration: 2500,
      });
    } finally {
      this.setData({ summonBusyId: '' });
    }
  },

  // ============================================================
  // 录音 (第 3 刀)
  // ============================================================

  /** 主按钮 — 根据当前 micState 切换 启动/停止 */
  onMicMain() {
    const s = this.data.micState;
    if (s === 'recording' || s === 'paused') {
      this._stopRecording();
    } else if (s === 'idle' || s === 'error') {
      this._startRecording();
    }
    // starting / stopping 中: 忽略, 防 double click
  },

  /** 次按钮 — 暂停 / 恢复 (闭麦 / 解麦) */
  onMicToggleMute() {
    const s = this.data.micState;
    if (s === 'recording') {
      this._recorder.pause();
    } else if (s === 'paused') {
      this._recorder.resume();
    }
  },

  async _startRecording() {
    // 守卫: 会议必须 ongoing 才能录音
    if (!this.data.detail || this.data.detail.status !== 'ongoing') {
      wx.showToast({
        title: this.data.detail
          ? '仅 进行中 会议可录音'
          : '会议未加载',
        icon: 'none',
      });
      return;
    }
    // 守卫: WS 必须就绪 (否则 PCM 缓存有上限, 不如等)
    if (!this._ws) {
      wx.showToast({ title: 'WS 未连接', icon: 'none' });
      return;
    }
    if (!this._ws.isReady()) {
      wx.showToast({ title: 'WS 连接中, 稍等几秒', icon: 'none' });
      return;
    }

    this.setData({ micError: '' });

    // 创建 (如果首次) — recorder manager 是单例不能重建, 但 wrapper 可以
    if (!this._recorder) {
      this._recorder = createRecorder({
        sampleRate: 16000,
        frameSize: 2, // 2 KB / 帧 ≈ 62.5 ms
        encodeBitRate: 48000,
        onFrame: (buf) => {
          if (this._ws) {
            const ok = this._ws.sendPCM(buf);
            if (ok) {
              this.data.framesSent += 1;
              // 不每帧都 setData (太重); 每 50 帧 ≈ 每 3 秒 更新一次 UI
              if (this.data.framesSent % 50 === 0) {
                this.setData({ framesSent: this.data.framesSent });
              }
            }
          }
        },
        onError: (err) => {
          console.error('[recorder] error', err);
          const text = this._micErrorText(err);
          this.setData({ micError: text });
          this._stopMicTimer();
          // 用户拒过权限 — 引导 openSetting
          if (err && err.message === 'mic-permission-denied-need-setting') {
            wx.showModal({
              title: '需要麦克风权限',
              content: '小程序设置里手动开"录音"权限后回来重试',
              confirmText: '去设置',
              success: ({ confirm }) => {
                if (confirm) {
                  openMicSetting();
                }
              },
            });
          }
        },
        onStateChange: (s) => {
          this.setData({ micState: s });
          if (s === 'recording') {
            this._startMicTimer();
          } else if (s !== 'paused') {
            // 'paused' 时秒数继续算暂停状态 (不归零, 仅停 tick)
            // 其他状态 (idle/stopping/error) 归零 + 停 tick
            this._stopMicTimer();
            if (s === 'idle' || s === 'error') {
              this.setData({
                micElapsedSec: 0,
                micElapsedStr: '00:00',
                framesSent: 0,
              });
            }
          }
        },
      });
    }

    this.setData({ micState: 'starting', micError: '' });
    try {
      await this._recorder.start();
    } catch (e) {
      // onError 已处理 + setData; 此处 catch 仅为防 throw 冒到上层
      console.warn('start recording rejected:', e && e.message);
    }
  },

  _stopRecording() {
    if (this._recorder) {
      this._recorder.stop();
    }
  },

  _startMicTimer() {
    if (this._micTimer) return;
    this._micTimer = setInterval(() => {
      if (this.data.micState === 'recording') {
        const next = this.data.micElapsedSec + 1;
        this.setData({
          micElapsedSec: next,
          micElapsedStr: this._formatElapsed(next),
        });
      }
    }, 1000);
  },

  _stopMicTimer() {
    if (this._micTimer) {
      clearInterval(this._micTimer);
      this._micTimer = null;
    }
  },

  _micErrorText(err) {
    if (!err) return '录音错误';
    if (err.message === 'mic-permission-denied') return '麦克风未授权';
    if (err.message === 'mic-permission-denied-need-setting') {
      return '麦克风被拒过, 需手动到设置开启';
    }
    return err.errMsg || err.message || '录音错误';
  },

  /** 把 micElapsedSec 转 "mm:ss" 形式. 用于 wxml 显示. */
  // (wxml 用 wxs 或在 _startMicTimer 里写 setData formatted string)
  // 这里走第二种: 每秒更新 micElapsedSec 时再算个 micElapsedStr
  _formatElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  },

  // ============================================================
  // 开发模式 token 输入
  // ============================================================

  onDevTokenInput(e) {
    this.setData({ devTokenInput: e.detail.value });
  },
  onDevTokenExpInput(e) {
    this.setData({ devTokenExpInput: e.detail.value });
  },
  onDevTokenConfirm() {
    const token = (this.data.devTokenInput || '').trim();
    if (!token) {
      wx.showToast({ title: '请粘贴 token', icon: 'none' });
      return;
    }
    const exp =
      (this.data.devTokenExpInput || '').trim() ||
      new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    setToken(token, exp);
    this.setData({ needToken: false, error: '' });
    this._init();
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/webview/webview' }),
    });
  },

  onRefresh() {
    this.fetchDetail();
    this.fetchTranscript();
  },
});
