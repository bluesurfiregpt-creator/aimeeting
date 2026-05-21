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
    agenda: [],     // { id, title, time_budget_min, durationLabel, note, noteOpen }

    // UI 状态
    durationOptions: DURATION_OPTIONS,

    // 第 2 刀 — 邀请数据
    members: null,            // [WorkspaceMember]
    membersErr: '',
    membersLoading: false,
    agents: null,             // [WorkspaceAgentBrief] (仅 expert + moderator)
    agentsLoading: false,
    agentsErr: '',

    selectedUserIdMap: {},    // { userId: true } map, wxml 渲染用
    selectedAgentIdMap: {},   // { agentId: true } map
    selectedUserIds: [],      // 数组, 提交时用
    selectedAgentIds: [],
    selectedExpertCount: 0,   // auto 模式校验用 (仅 expert, 不算 moderator)

    // 第 2 刀 — AI 拆议程
    decomposing: false,
    decomposeConfirmOpen: false,

    // 第 3 刀 — 附件
    attachments: [],          // [{id, filename, size_bytes, extension, extract_status, extract_summary}]
    attachmentsErr: '',
    uploadingCount: 0,        // 正在上传的数量 (UI 显 loading)
    pollingAttachments: false, // 是否在 polling extract 状态
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
    const clientDraftId = generateDraftId();
    const firstAgenda = this._newAgendaRow();
    this.setData({
      clientDraftId,
      agenda: [firstAgenda],
    });
    // 并行拉两份 邀请数据
    this._fetchMembers();
    this._fetchAgents();
  },

  onUnload() {
    this._stopAttachmentPolling();
  },

  async _fetchMembers() {
    this.setData({ membersLoading: true, membersErr: '' });
    try {
      const list = await api.get('/api/team/members');
      this.setData({
        members: list || [],
        membersLoading: false,
      });
    } catch (e) {
      // member 角色 403 — 让 UI 友好降级
      const is403 = e.message && e.message.indexOf('403') >= 0;
      this.setData({
        members: [],
        membersLoading: false,
        membersErr: is403
          ? '仅 leader+ 可看完整成员列表 (你只能邀请 AI)'
          : e.message || '加载失败',
      });
    }
  },

  async _fetchAgents() {
    this.setData({ agentsLoading: true, agentsErr: '' });
    try {
      const list = await api.get('/api/agents', { active_only: true });
      // 仅 expert + moderator (其他 role 不进会议)
      const filtered = (list || []).filter(
        (a) => a.role === 'expert' || a.role === 'moderator',
      );
      this.setData({
        agents: filtered,
        agentsLoading: false,
      });
    } catch (e) {
      this.setData({
        agents: [],
        agentsLoading: false,
        agentsErr: e.message || '加载失败',
      });
    }
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

  // 议程 note 展开/收起
  onToggleAgendaNote(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const cur = this.data.agenda[idx];
    if (!cur) return;
    const next = !cur.noteOpen;
    const updates = { [`agenda[${idx}].noteOpen`]: next };
    if (!next) {
      // 收起时清掉 note (用户主动放弃)
      updates[`agenda[${idx}].note`] = '';
    }
    this.setData(updates);
  },

  // ============================================================
  // 邀请 多选 (第 2 刀)
  // ============================================================

  onToggleUser(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const m = Object.assign({}, this.data.selectedUserIdMap);
    if (m[id]) delete m[id];
    else m[id] = true;
    this.setData({
      selectedUserIdMap: m,
      selectedUserIds: Object.keys(m),
    });
  },

  onToggleAgent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const m = Object.assign({}, this.data.selectedAgentIdMap);
    if (m[id]) delete m[id];
    else m[id] = true;
    const ids = Object.keys(m);
    // 算 expert 数 (auto 模式校验要 ≥ 3)
    const expertCount = (this.data.agents || []).filter(
      (a) => m[a.id] && a.role === 'expert',
    ).length;
    this.setData({
      selectedAgentIdMap: m,
      selectedAgentIds: ids,
      selectedExpertCount: expertCount,
    });
  },

  // ============================================================
  // AI 拆议程 (第 2 刀)
  // ============================================================

  onAIDecompose() {
    const brief = this.data.description.trim();
    if (brief.length < 10) {
      wx.showToast({ title: '请先把 brief 写够 10 字', icon: 'none' });
      return;
    }
    if (this.data.decomposing) return;

    // 当前 agenda 有内容? 弹 confirm 防覆盖
    const hasContent = this.data.agenda.some((a) => a.title.trim().length > 0);
    if (hasContent) {
      wx.showModal({
        title: '覆盖现有议程?',
        content: '你已填了一些议程项. 让 AI 拆议程会替换它们 — 已有内容会丢失.',
        confirmText: '覆盖',
        cancelText: '再想想',
        confirmColor: '#8b5cf6',
        success: ({ confirm }) => {
          if (confirm) this._doDecompose();
        },
      });
    } else {
      this._doDecompose();
    }
  },

  async _doDecompose() {
    this.setData({ decomposing: true, error: '' });
    try {
      const out = await api.post('/api/meetings/decompose-agenda', {
        brief: this.data.description.trim(),
        title: this.data.title.trim() || undefined,
        target_count: 3,
        // 第 3 刀: 把 client_draft_id 也传上 (附件做完后这里就能用 attachment 内容)
        client_draft_id: this.data.clientDraftId || undefined,
      });
      // 替换 agenda
      const newAgenda = (out.items || []).map((it) => {
        const dur = (it.time_budget_min || 10);
        const opt = DURATION_OPTIONS.find((o) => o.value === dur);
        return {
          id: 'a-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
          title: (it.title || '').slice(0, 100),
          time_budget_min: dur,
          durationLabel: opt ? opt.label : `${dur} 分钟`,
          note: it.note || '',
          // AI 拆出来的有 note → 默认展开让用户能看见 AI 写了啥
          noteOpen: !!it.note,
        };
      });
      if (newAgenda.length === 0) {
        wx.showToast({ title: 'AI 拆出 0 项, 请稍后重试', icon: 'none' });
      } else {
        this.setData({ agenda: newAgenda });
        wx.showToast({
          title: `AI 拆了 ${newAgenda.length} 个议题`,
          icon: 'success',
        });
      }
    } catch (e) {
      console.error('decompose failed', e);
      wx.showToast({
        title: e.message || 'AI 拆议程失败',
        icon: 'none',
        duration: 2500,
      });
    } finally {
      this.setData({ decomposing: false });
    }
  },

  // ============================================================
  // 附件 (第 3 刀)
  // ============================================================
  //
  // 三种入口:
  //   1. 微信聊天记录 — wx.chooseMessageFile (跟已有 picker 页 同一个 API)
  //   2. 手机相册图片 — wx.chooseMedia (PCM 图片自动走 OCR)
  //   3. 普通文件 — wx.chooseMessageFile 已覆盖, 不另做
  //
  // 上传完后 GET /api/meetings/attachments?draft_id 刷新列表.
  // 有 extracting 状态时 每 5 秒 poll 一次 直到全 ready / failed / skipped.

  /** 从微信聊天记录选文件 */
  onChooseFromWeChat() {
    if (this.data.uploadingCount > 0) return;
    wx.chooseMessageFile({
      count: 5,
      type: 'file',
      extension: [
        'pdf', 'docx', 'xlsx', 'xls', 'pptx',
        'txt', 'md', 'csv', 'log', 'json', 'yaml', 'yml',
      ],
      success: (res) => this._uploadTempFiles(res.tempFiles || []),
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') < 0) {
          wx.showToast({ title: '选文件失败', icon: 'none' });
        }
      },
    });
  },

  /** 从相册选图片 (走 OCR) */
  onChooseFromAlbum() {
    if (this.data.uploadingCount > 0) return;
    wx.chooseMedia({
      count: 5,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        // chooseMedia 返的 tempFiles 字段名 size/tempFilePath 跟 chooseMessageFile 字段名不一致, 统一
        const files = (res.tempFiles || []).map((f) => ({
          path: f.tempFilePath,
          size: f.size,
          name: this._inferImageName(f.tempFilePath),
        }));
        this._uploadTempFiles(files);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') < 0) {
          wx.showToast({ title: '选图片失败', icon: 'none' });
        }
      },
    });
  },

  _inferImageName(tempFilePath) {
    // tempFilePath 形如 wxfile://tmp_xxx.jpg, 取末段 + 时间戳防重名
    const ext = (tempFilePath.match(/\.(\w+)$/) || [, 'jpg'])[1];
    return `image_${Date.now()}.${ext}`;
  },

  async _uploadTempFiles(files) {
    if (!files || files.length === 0) return;
    const MAX_BYTES = 50 * 1024 * 1024;

    this.setData({ uploadingCount: this.data.uploadingCount + files.length });

    let okCount = 0;
    let failCount = 0;
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        wx.showToast({
          title: `${f.name} 超 50MB`,
          icon: 'none',
          duration: 2000,
        });
        failCount += 1;
        continue;
      }
      try {
        // utils/api.uploadFile 走 wx.uploadFile, 自动带 Bearer header
        await api.uploadFile(
          '/api/meetings/attachments',
          f.path,
          { client_draft_id: this.data.clientDraftId },
        );
        okCount += 1;
      } catch (e) {
        console.warn('upload failed', f.name, e);
        failCount += 1;
      }
    }

    this.setData({
      uploadingCount: this.data.uploadingCount - files.length,
    });

    if (okCount > 0) {
      wx.showToast({
        title: `已上传 ${okCount}${failCount > 0 ? ` (${failCount} 失败)` : ''}`,
        icon: 'success',
        duration: 1500,
      });
    } else if (failCount > 0) {
      wx.showToast({ title: '全部上传失败', icon: 'none', duration: 2000 });
    }

    // 刷新列表 + 启动 polling (如果有 extracting)
    await this._fetchAttachments();
    this._maybeStartPolling();
  },

  async _fetchAttachments() {
    if (!this.data.clientDraftId) return;
    try {
      const out = await api.get('/api/meetings/attachments', {
        draft_id: this.data.clientDraftId,
      });
      const items = ((out && out.items) || []).map((a) =>
        this._enrichAttachment(a),
      );
      this.setData({ attachments: items, attachmentsErr: '' });
    } catch (e) {
      console.warn('fetch attachments failed', e);
      this.setData({ attachmentsErr: e.message || '加载失败' });
    }
  },

  _enrichAttachment(a) {
    // 预算 wxml 直接用的字段 (sizeStr / statusLabel / statusTone)
    const sizeStr = this._formatAttachmentSize(a.size_bytes);
    const status = a.extract_status || 'pending';
    let statusLabel = '';
    let statusTone = 'pending';
    if (status === 'ready') {
      statusLabel = '✓ 就绪';
      statusTone = 'ready';
    } else if (status === 'extracting' || status === 'pending') {
      statusLabel = '抽取中…';
      statusTone = 'extracting';
    } else if (status === 'skipped') {
      statusLabel = '⊘ 未识别';
      statusTone = 'skipped';
    } else if (status === 'failed') {
      statusLabel = '✗ 失败';
      statusTone = 'failed';
    }
    return Object.assign({}, a, { sizeStr, statusLabel, statusTone });
  },

  _maybeStartPolling() {
    // 有 extracting / pending 状态 → 5s 轮询直到全 done
    const hasUnfinished = this.data.attachments.some(
      (a) => a.extract_status === 'extracting' || a.extract_status === 'pending',
    );
    if (!hasUnfinished) {
      this._stopAttachmentPolling();
      return;
    }
    if (this.data.pollingAttachments) return;
    this.setData({ pollingAttachments: true });
    this._attachmentPollTimer = setInterval(async () => {
      await this._fetchAttachments();
      // 没未完成的 → 停
      const stillUnfinished = this.data.attachments.some(
        (a) => a.extract_status === 'extracting' || a.extract_status === 'pending',
      );
      if (!stillUnfinished) this._stopAttachmentPolling();
    }, 5000);
  },

  _stopAttachmentPolling() {
    if (this._attachmentPollTimer) {
      clearInterval(this._attachmentPollTimer);
      this._attachmentPollTimer = null;
    }
    if (this.data.pollingAttachments) {
      this.setData({ pollingAttachments: false });
    }
  },

  /** 删一个附件 */
  onDeleteAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    if (!id) return;
    wx.showModal({
      title: '删除附件?',
      content: name ? `确定删除「${name}」?` : '确定删除该附件?',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#f43f5e',
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await api.del(`/api/meetings/attachments/${id}`);
          // 本地移除
          this.setData({
            attachments: this.data.attachments.filter((a) => a.id !== id),
          });
          wx.showToast({ title: '已删除', icon: 'success', duration: 1000 });
        } catch (e) {
          wx.showToast({
            title: e.message || '删除失败',
            icon: 'none',
            duration: 2000,
          });
        }
      },
    });
  },

  _formatAttachmentSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
      if (this.data.selectedExpertCount < 3) {
        return '全 AI 自主模式 至少邀请 3 个 AI 专家 (expert 角色)';
      }
    } else {
      // hybrid / human — 至少 1 个真人或 AI
      if (
        this.data.selectedUserIds.length + this.data.selectedAgentIds.length ===
        0
      ) {
        return '至少邀请 1 个真人或 AI 专家';
      }
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
      attendee_user_ids: this.data.selectedUserIds,
      attendee_agent_ids: this.data.selectedAgentIds,
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
