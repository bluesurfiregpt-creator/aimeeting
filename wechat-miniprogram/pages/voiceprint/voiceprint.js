// pages/voiceprint/voiceprint.js — v27.2 声纹库 (原生重写)
//
// 模型 = workspace 级共享声纹库 (跟 H5 /m/me/voiceprint + 桌面端 同一套):
//   - 列 workspace 所有 user, 标 has_voiceprint
//   - "录新人": 输姓名 → POST /api/users 建 speaker-only profile → 录音 → POST /api/voiceprints
//   - "重录": 选已有 user → 录音 → POST /api/voiceprints { user_id 同 }
//   - 删: DELETE /api/voiceprints/by-user/{user_id}
//   - ABAC: 列表 谁都能看; 录入 / 删除 限 leader+ (member 看得到 但 按钮 不显)
//
// 录音: wx.getRecorderManager (16kHz mono PCM) — 复用 utils/recorder.js.
// 旧版 是 "我的个人声纹" 模型 + 调死端点 /api/voiceprints/me, 本次 整体重写.

const { getToken, clearAuth } = require('../../utils/auth');
const { getNavMetrics } = require('../../utils/nav');
const api = require('../../utils/api');
const { createRecorder, openMicSetting } = require('../../utils/recorder');

const TARGET_SECONDS = 30;
const MAX_SECONDS = 60;
const MIN_SUBMIT_SECONDS = 20;

const SCRIPTS = [
  '我喜欢在安静的午后捧一本书, 坐在阳台上慢慢翻看. 窗外的阳光斜斜地洒在书页上, 远处偶尔传来几声鸟鸣. 读书最让人愉快的, 是在某一页突然遇到一句让自己心里一动的话.',
  '清晨的城市还没有完全醒过来. 地铁站门口排着稀疏的队, 便利店刚把热饮的招牌摆出来. 我点了一杯热豆浆和一个茶叶蛋, 靠在落地窗边吃完, 觉得新的一天有了盼头.',
  '学一件新东西的开头总是最难的. 你会反复怀疑自己, 会想干脆放弃. 但只要撑过最难受的那两三周, 原本看不懂的概念就会开始有意义, 笨拙的动作也慢慢顺手起来.',
];

Page({
  data: {
    // 自定义导航
    statusBarHeight: 20,
    navBarHeight: 44,

    loading: true,
    error: '',

    isWriter: false,       // leader+ 才能 录入 / 删除
    users: [],             // [{ id, name, has_voiceprint, created_at, _statusLabel }]
    enrolledCount: 0,
    total: 0,

    // ===== 录音 modal =====
    recordOpen: false,
    targetUserId: '',
    targetUserName: '',
    isNewUser: false,      // true = 录新人 (先建 profile)
    newUserName: '',

    phase: 'idle',         // idle / starting / recording / uploading
    seconds: 0,
    secondsStr: '0.0',
    progressPct: 0,
    canSubmit: false,
    scriptText: SCRIPTS[0],

    // ===== 新人输名 modal =====
    nameInputOpen: false,
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad() {
    const nav = getNavMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      scriptText: SCRIPTS[Math.floor(Math.random() * SCRIPTS.length)],
    });
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this._fetch();
  },

  onUnload() {
    this._stopTick();
    if (this._recorder) {
      this._recorder.dispose();
      this._recorder = null;
    }
  },

  onTapBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/me/me' }),
    });
  },

  // ============================================================
  // 数据
  // ============================================================

  async _fetch() {
    this.setData({ loading: true, error: '' });
    try {
      // 并行: 拉 me (判 role) + 拉 workspace users
      const [me, users] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/users'),
      ]);
      const role = (me && me.role) || 'member';
      const isWriter = role === 'owner' || role === 'admin' || role === 'leader';
      const list = (users || []).map((u) => ({
        id: u.id,
        name: u.name || '(未命名)',
        has_voiceprint: !!u.has_voiceprint,
        created_at: u.created_at,
      }));
      // 排序: 已录在前, 再按 created_at 倒序
      list.sort((a, b) => {
        if (a.has_voiceprint !== b.has_voiceprint) {
          return a.has_voiceprint ? -1 : 1;
        }
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
      this.setData({
        isWriter,
        users: list,
        enrolledCount: list.filter((u) => u.has_voiceprint).length,
        total: list.length,
        loading: false,
      });
    } catch (e) {
      console.error('[voiceprint] fetch failed', e);
      if (e.message === 'unauthorized') {
        clearAuth();
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      }
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  onTapRetry() {
    this._fetch();
  },

  // ============================================================
  // 录新人 — 先输姓名
  // ============================================================

  onTapAddNew() {
    if (!this.data.isWriter) return;
    this.setData({ nameInputOpen: true, newUserName: '' });
  },

  onNewNameInput(e) {
    this.setData({ newUserName: e.detail.value });
  },

  onCancelNameInput() {
    this.setData({ nameInputOpen: false, newUserName: '' });
  },

  async onConfirmNewName() {
    const name = (this.data.newUserName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    try {
      // POST /api/users 建 speaker-only profile
      const created = await api.post('/api/users', { name });
      this.setData({ nameInputOpen: false, newUserName: '' });
      // 直接 进 录音 modal
      this._openRecordModal(created.id, name, true);
    } catch (e) {
      console.error('[voiceprint] create user failed', e);
      wx.showToast({
        title: e.message || '建档失败',
        icon: 'none',
        duration: 2500,
      });
    }
  },

  // ============================================================
  // 录音 modal
  // ============================================================

  /** 点 列表里 某人 的 录入 / 重录 */
  onTapEnroll(e) {
    if (!this.data.isWriter) return;
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    if (!id) return;
    this._openRecordModal(id, name, false);
  },

  _openRecordModal(userId, userName, isNewUser) {
    this.setData({
      recordOpen: true,
      targetUserId: userId,
      targetUserName: userName,
      isNewUser: !!isNewUser,
      phase: 'idle',
      seconds: 0,
      secondsStr: '0.0',
      progressPct: 0,
      canSubmit: false,
      scriptText: SCRIPTS[Math.floor(Math.random() * SCRIPTS.length)],
    });
  },

  onCloseRecordModal() {
    if (this.data.phase === 'recording' || this.data.phase === 'uploading') {
      wx.showToast({ title: '录音中, 请先停止', icon: 'none' });
      return;
    }
    this._stopTick();
    this.setData({ recordOpen: false });
  },

  onNextScript() {
    if (this.data.phase === 'recording' || this.data.phase === 'uploading') return;
    let idx = SCRIPTS.indexOf(this.data.scriptText);
    idx = (idx + 1) % SCRIPTS.length;
    this.setData({ scriptText: SCRIPTS[idx] });
  },

  _ensureRecorder() {
    if (this._recorder) return this._recorder;
    this._recorder = createRecorder({
      sampleRate: 16000,
      frameSize: 2,
      encodeBitRate: 48000,
      onFrame: (buf) => {
        if (this._pcmBuffer) this._pcmBuffer.push(buf);
      },
      onError: (err) => {
        console.error('[voiceprint recorder] error', err);
        this._stopTick();
        if (err && err.message === 'mic-permission-denied-need-setting') {
          wx.showModal({
            title: '需要麦克风权限',
            content: '小程序设置里 手动 开 "录音" 权限 后 回来 重试',
            confirmText: '去设置',
            success: ({ confirm }) => {
              if (confirm) openMicSetting();
            },
          });
        } else {
          wx.showToast({
            title: (err && err.errMsg) || (err && err.message) || '录音错误',
            icon: 'none',
            duration: 2500,
          });
        }
        this.setData({ phase: 'idle' });
      },
    });
    return this._recorder;
  },

  async onStartRecord() {
    if (this.data.phase === 'recording' || this.data.phase === 'uploading') return;
    this._pcmBuffer = [];
    this.setData({
      phase: 'starting',
      seconds: 0,
      secondsStr: '0.0',
      progressPct: 0,
      canSubmit: false,
    });
    this._ensureRecorder();
    try {
      await this._recorder.start();
      this.setData({ phase: 'recording' });
      this._startTick();
    } catch (e) {
      this.setData({ phase: 'idle' });
    }
  },

  _startTick() {
    this._tickStartedAt = Date.now();
    this._tickTimer = setInterval(() => {
      const s = (Date.now() - this._tickStartedAt) / 1000;
      const pct = Math.min(100, (s / TARGET_SECONDS) * 100);
      this.setData({
        seconds: s,
        secondsStr: s.toFixed(1),
        progressPct: pct,
        canSubmit: s >= MIN_SUBMIT_SECONDS,
      });
      if (s >= MAX_SECONDS) this.onStopRecord(true);
    }, 200);
  },

  _stopTick() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    this._tickTimer = null;
  },

  async onStopRecord(autoSubmit) {
    if (this.data.phase !== 'recording') return;
    this._stopTick();
    if (this._recorder) this._recorder.stop();

    const sec = this.data.seconds;
    if (!this._pcmBuffer || this._pcmBuffer.length === 0 || sec < 1) {
      this.setData({ phase: 'idle' });
      wx.showToast({ title: '没录到声音', icon: 'none' });
      return;
    }
    if (autoSubmit !== true && sec < MIN_SUBMIT_SECONDS) {
      this.setData({ phase: 'idle' });
      wx.showToast({
        title: `录了 ${sec.toFixed(0)}s, 至少 ${MIN_SUBMIT_SECONDS}s`,
        icon: 'none',
        duration: 2500,
      });
      return;
    }
    await this._upload();
  },

  async _upload() {
    const totalLen = this._pcmBuffer.reduce((n, b) => n + b.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let p = 0;
    for (const b of this._pcmBuffer) {
      merged.set(new Uint8Array(b), p);
      p += b.byteLength;
    }

    this.setData({ phase: 'uploading' });
    const fs = wx.getFileSystemManager();
    const tempPath = `${wx.env.USER_DATA_PATH}/voiceprint-${Date.now()}.pcm`;
    try {
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath: tempPath,
          data: merged.buffer,
          encoding: 'binary',
          success: resolve,
          fail: reject,
        });
      });
      await api.uploadFile('/api/voiceprints', tempPath, {
        user_id: this.data.targetUserId,
      });
      try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }

      this._pcmBuffer = [];
      this.setData({ recordOpen: false, phase: 'idle' });
      wx.showToast({ title: '声纹录入成功', icon: 'success' });
      this._fetch(); // 刷新列表
    } catch (e) {
      console.error('[voiceprint] upload failed', e);
      this.setData({ phase: 'idle' });
      wx.showToast({
        title: (e && e.message) || '上传失败',
        icon: 'none',
        duration: 3000,
      });
    }
  },

  // ============================================================
  // 删除声纹
  // ============================================================

  onTapDelete(e) {
    if (!this.data.isWriter) return;
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    if (!id) return;
    wx.showModal({
      title: `删除 ${name} 的声纹?`,
      content: '删除后, 会议中将无法自动识别 TA 的发言.',
      confirmText: '删除',
      confirmColor: '#f43f5e',
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await api.del(`/api/voiceprints/by-user/${encodeURIComponent(id)}`);
          wx.showToast({ title: '已删除', icon: 'success' });
          this._fetch();
        } catch (err) {
          wx.showToast({
            title: err.message || '删除失败',
            icon: 'none',
            duration: 2500,
          });
        }
      },
    });
  },
});
