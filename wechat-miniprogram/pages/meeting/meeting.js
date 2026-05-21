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

    // 开发模式: query 带 t=, 写 storage
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
      // 只保留 user 行 (agent 行第 4 刀做完整气泡)
      const userLines = (data.lines || [])
        .filter((l) => l.kind === 'user')
        .map((l) => this._normalizeUserLine(l));
      this.setData({ transcriptLines: userLines });
      this._scrollToBottom();
    } catch (e) {
      console.warn('fetch transcript failed', e);
      // 不抛, 拉失败不影响 WS 连接
    }
  },

  _normalizeUserLine(line) {
    // 把 /transcript endpoint 的 line 和 WS transcript_persisted event 统一成 同一份 shape
    return {
      id: 't-' + line.id,
      lineId: line.id,
      speakerName: line.speaker_name || '未知',
      speakerStatus: line.speaker_status || '',
      text: line.text || '',
      atMinute: line.at_minute,
    };
  },

  _appendLiveLine(event) {
    // 后端 transcript_persisted event 字段: line_id, start_ms, end_ms, text, speaker_name, speaker_status
    const newLine = {
      id: 't-' + event.line_id,
      lineId: event.line_id,
      speakerName: event.speaker_name || '未知',
      speakerStatus: event.speaker_status || '',
      text: event.text || '',
      atMinute: this._msToMinute(event.start_ms),
    };
    const lines = this.data.transcriptLines.slice();
    // 幂等: 同 line_id 已经在 (例如历史拉过) 就 skip
    if (lines.some((l) => l.lineId === newLine.lineId)) return;
    lines.push(newLine);
    const updates = { transcriptLines: lines };
    if (!this.data.transcriptStuckAtBottom) {
      updates.pendingNewCount = this.data.pendingNewCount + 1;
    }
    this.setData(updates, () => {
      if (this.data.transcriptStuckAtBottom) this._scrollToBottom();
    });
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
      onAgentMessageStart: (ev) => {
        // 第 4 刀: AI 气泡 start
        console.log('[ws] agent_message_start (留 第 4 刀):', ev);
      },
      onAgentMessageChunk: (ev) => {
        // 第 4 刀: AI streaming chunk
      },
      onAgentMessageEnd: (ev) => {
        // 第 4 刀: AI 气泡 end
      },
      onAgendaEvent: (ev) => {
        // 第 4 刀: 议程 banner
        console.log('[ws] agenda event (留 第 4 刀):', ev);
      },
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
