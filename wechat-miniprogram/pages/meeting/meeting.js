// pages/meeting/meeting.js — v27.0-mobile P21 原生 N-1 会议室主页 (第 1 刀: 骨架).
//
// 当前刀 仅做:
//   - onLoad 从 query 取 meeting_id
//   - 拿 token (开发模式: 如果 storage 没 token, 弹一个输入框让用户粘贴)
//   - 调 GET /api/m/meetings/{id} 拉详情
//   - 渲染议程进度 + 会议标题 + 状态
//
// 后续刀:
//   2. WebSocket + 转录列表
//   3. 录音 + PCM 发送
//   4. AI 气泡 + 议程 banner
//   5. 召唤 sheet + 邀请追加
//   6. 真机调试 + token 桥接 (替代开发模式输入框)

const { getToken, setToken } = require('../../utils/auth');
const api = require('../../utils/api');

Page({
  data: {
    meetingId: '',
    loading: true,
    error: '',
    needToken: false,           // 开发模式: 没 token 时显输入框
    devTokenInput: '',
    devTokenExpInput: '',
    detail: null,               // MobileMeetingDetailOut

    // 议程 chip 渲染数据 (从 detail.agenda_items 转换)
    agendaChips: [],
  },

  onLoad(options) {
    const meetingId = options.meeting_id || options.id || '';
    if (!meetingId) {
      this.setData({ loading: false, error: '缺少 meeting_id 参数' });
      return;
    }
    this.setData({ meetingId });

    // 第 1 刀开发模式: 如果 query 里带 t=, 先把 token 写 storage
    // (后续刀做完整桥接后, 这段会去掉)
    if (options.t) {
      try {
        // exp 没传时给一个 30 天默认 (实际值会在 refresh 时被覆盖)
        const exp = options.exp || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        setToken(decodeURIComponent(options.t), decodeURIComponent(exp));
      } catch (e) {
        console.warn('save token from query failed', e);
      }
    }

    if (!getToken()) {
      // 没 token, 开发模式让用户粘贴
      this.setData({ loading: false, needToken: true });
      return;
    }

    this.fetchDetail();
  },

  async fetchDetail() {
    const { meetingId } = this.data;
    this.setData({ loading: true, error: '' });
    try {
      const detail = await api.get(`/api/m/meetings/${meetingId}`);
      this.setData({
        detail,
        agendaChips: this._buildAgendaChips(detail.agenda_items || [], detail.current_agenda_idx),
        loading: false,
      });
      // 顶栏标题 跟 会议标题 同步
      wx.setNavigationBarTitle({ title: detail.title || '会议室' });
    } catch (e) {
      console.error('fetch meeting detail failed', e);
      if (e.message === 'unauthorized') {
        this.setData({ loading: false, needToken: true, error: 'token 已失效, 请重新粘贴' });
      } else {
        this.setData({ loading: false, error: e.message || '加载失败' });
      }
    }
  },

  _buildAgendaChips(items, currentIdx) {
    // 把 agenda_items 转成 chip 渲染数据
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

  // 开发模式: 输入 token + 点确认
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
    const exp = (this.data.devTokenExpInput || '').trim()
      || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    setToken(token, exp);
    this.setData({ needToken: false, error: '' });
    this.fetchDetail();
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/webview/webview' }),
    });
  },

  onRefresh() {
    this.fetchDetail();
  },
});
