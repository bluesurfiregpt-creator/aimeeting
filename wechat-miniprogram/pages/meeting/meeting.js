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
    if (this._recorder) {
      this._recorder.dispose();
      this._recorder = null;
    }
    if (this._micTimer) {
      clearInterval(this._micTimer);
      this._micTimer = null;
    }
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
