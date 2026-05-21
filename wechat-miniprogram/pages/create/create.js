// pages/create/create.js — v27.0-mobile P21 原生 N-3 创建会议页 (第 1 刀: 骨架).
//
// 已完成:
//   1. 骨架 + 标题 + 类型 + brief + 议程项 + 创建提交 (当前)
//
// 后续刀:
//   2. 邀请人 / AI 多选 + AI 拆议程 + 议程 note 折叠
//   3. 附件上传 (微信聊天记录 + 相册 + 文件) + 入口按钮 + 真机调试

const { getToken, setToken } = require('../../utils/auth');
const api = require('../../utils/api');

// 工作区 client_draft_id — 在 onLoad 时生成, 创建会议时传给后端关联预上传附件
function generateDraftId() {
  // 简易 uuid-like (32 hex chars), 不必严格 RFC v4 — 后端只是 string 用
  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * 16)];
  }
  return out;
}

// 时长 picker 选项
const DURATION_OPTIONS = [
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
  { label: '15 分钟', value: 15 },
  { label: '20 分钟', value: 20 },
  { label: '30 分钟', value: 30 },
  { label: '45 分钟', value: 45 },
  { label: '60 分钟', value: 60 },
  { label: '不设', value: null },
];

Page({
  data: {
    // 初始化
    needToken: false,
    devTokenInput: '',
    devTokenExpInput: '',
    creating: false,
    error: '',
    clientDraftId: '',

    // 表单字段
    title: '',
    mode: 'hybrid', // 'human' | 'hybrid' | 'auto'
    description: '',
    agenda: [
      // { id, title, time_budget_min, durationLabel, note, noteOpen }
    ],

    // UI 状态
    durationOptions: DURATION_OPTIONS,
    // 当前正在选时长的 agenda idx (-1 表示没在选)
    durationPickerForIdx: -1,
  },

  onLoad(options) {
    // 同 meeting 页的 token 流程
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
      this.setData({ needToken: true });
      return;
    }

    this._init();
  },

  _init() {
    // 生成 draft id (附件预上传用, 即使本次没上传也无害)
    const clientDraftId = generateDraftId();
    // 默认加一个空议程
    const firstAgenda = this._newAgendaRow();
    this.setData({
      clientDraftId,
      agenda: [firstAgenda],
    });
  },

  _newAgendaRow() {
    return {
      // 临时 id, React/wx:key 用
      id: 'a-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      title: '',
      time_budget_min: null,
      durationLabel: '不设',
      note: '',
      noteOpen: false,
    };
  },

  // ============================================================
  // 字段绑定
  // ============================================================

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!['human', 'hybrid', 'auto'].includes(mode)) return;
    this.setData({ mode });
  },

  // ============================================================
  // 议程项 CRUD
  // ============================================================

  onAgendaTitleInput(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    this.setData({
      [`agenda[${idx}].title`]: e.detail.value,
    });
  },

  onAgendaNoteInput(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    this.setData({
      [`agenda[${idx}].note`]: e.detail.value,
    });
  },

  onAddAgenda() {
    const next = this.data.agenda.concat(this._newAgendaRow());
    this.setData({ agenda: next });
  },

  onRemoveAgenda(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (this.data.agenda.length <= 1) {
      wx.showToast({ title: '至少保留 1 个议程项', icon: 'none' });
      return;
    }
    const next = this.data.agenda.slice();
    next.splice(idx, 1);
    this.setData({ agenda: next });
  },

  // 时长 picker — 用微信原生 picker, mode=selector
  onPickDuration(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const selectIdx = e.detail.value;
    const opt = DURATION_OPTIONS[selectIdx];
    this.setData({
      [`agenda[${idx}].time_budget_min`]: opt.value,
      [`agenda[${idx}].durationLabel`]: opt.label,
    });
  },

  // ============================================================
  // 校验 + 提交
  // ============================================================

  _validate() {
    if (!this.data.title.trim()) {
      return '会议标题不能为空';
    }
    const validAgenda = this.data.agenda.filter((a) => a.title.trim().length > 0);
    if (validAgenda.length === 0) {
      return '至少加一个有标题的议程项';
    }
    if (this.data.mode === 'auto') {
      if (validAgenda.length < 2) {
        return '全 AI 自主模式 至少 2 个议程项';
      }
      if (this.data.description.trim().length < 10) {
        return '全 AI 自主模式 需写一段诉求 (≥ 10 字)';
      }
      // 邀 AI ≥ 3 个 留 第 2 刀做了选择 UI 再校验
    }
    return null;
  },

  async onSubmit() {
    if (this.data.creating) return;
    const err = this._validate();
    if (err) {
      wx.showToast({ title: err, icon: 'none', duration: 2500 });
      return;
    }

    // 清洗议程: 只保留有标题的, 转 schema
    const cleanedAgenda = this.data.agenda
      .filter((a) => a.title.trim().length > 0)
      .map((a) => {
        const item = { title: a.title.trim() };
        if (a.time_budget_min !== null && a.time_budget_min !== undefined) {
          item.time_budget_min = a.time_budget_min;
        }
        const note = a.note.trim();
        if (note) item.note = note;
        return item;
      });

    const payload = {
      title: this.data.title.trim(),
      attendee_user_ids: [],   // 第 2 刀填
      attendee_agent_ids: [],  // 第 2 刀填
      agenda: cleanedAgenda,
      mode: this.data.mode,
      description: this.data.description.trim() || null,
      client_draft_id: this.data.clientDraftId,
    };

    this.setData({ creating: true, error: '' });
    try {
      const created = await api.post('/api/meetings', payload);
      // 创建即开始 (跟 H5 流程对齐)
      try {
        await api.post(`/api/m/meetings/${created.id}/start`);
      } catch (_) {
        // start 失败 不阻塞 — 详情页 还会提供 启动 入口
      }
      wx.showToast({ title: '已创建', icon: 'success', duration: 1500 });
      // 跳 原生 meeting 页 (storage 有 token, 不必传 query)
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/meeting/meeting?meeting_id=${encodeURIComponent(created.id)}`,
        });
      }, 500);
    } catch (e) {
      console.error('create meeting failed', e);
      this.setData({
        creating: false,
        error: e.message || '创建失败',
      });
      wx.showToast({
        title: e.message || '创建失败',
        icon: 'none',
        duration: 2500,
      });
    }
  },

  // ============================================================
  // 开发模式 token
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
});
