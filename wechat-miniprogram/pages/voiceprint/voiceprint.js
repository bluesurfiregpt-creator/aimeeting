// pages/voiceprint/voiceprint.js — v27.0-mobile P22 声纹录入 (原生版)
//
// 跟 H5 版 /m/me/voiceprint 行为对齐, 但:
//   - 录音走 wx.getRecorderManager (PCM 16kHz mono, 复用 utils/recorder.js)
//   - 累积 frame buffer → 拼成 PCM Blob → 写临时文件 → wx.uploadFile
//   - 没顶部 web-view 进度条 (用户要的 "100% 原生" 体验)

const { getToken, setToken } = require('../../utils/auth');
const api = require('../../utils/api');
const { createRecorder, openMicSetting } = require('../../utils/recorder');

const TARGET_SECONDS = 30;
const MAX_SECONDS = 60;
const MIN_SUBMIT_SECONDS = 20;

const SCRIPTS = [
  {
    title: '午后阅读',
    text:
      '我喜欢在安静的午后捧一本书, 坐在阳台上慢慢翻看. 窗外的阳光斜斜地洒在书页上, 远处偶尔传来几声鸟鸣. 读书最让人愉快的, 不是读完一本厚厚的著作那种成就感, 而是在某一页突然遇到一句让自己心里一动的话.',
  },
  {
    title: '清晨小镇',
    text:
      '清晨的城市还没有完全醒过来. 地铁站门口排着稀疏的队, 便利店刚把热饮的招牌摆出来. 我点了一杯热豆浆和一个茶叶蛋, 靠在落地窗边吃完. 这样一份普通的早餐, 却让我觉得新的一天有了盼头.',
  },
  {
    title: '学习新事',
    text:
      '学一件新东西的开头总是最难的. 你会反复怀疑自己, 会觉得别人都比你聪明, 会想干脆放弃算了. 但只要你能撑过最难受的那两三周, 事情就会突然变得清晰. 原本看不懂的概念开始有了意义, 原本笨拙的动作也慢慢顺手起来.',
  },
];

Page({
  data: {
    needToken: false,
    devTokenInput: '',
    devTokenExpInput: '',

    userId: '',                    // 当前用户 id (从 /api/auth/me 拿)
    currentVoiceprint: null,       // 已录的声纹 (或 null)

    phase: 'idle',                 // idle / starting / recording / uploading / done / error
    seconds: 0,
    secondsStr: '0.0',             // 进度条旁的秒数 (wxml 用)
    progressPct: 0,                // 0-100, 进度条宽度
    canSubmit: false,              // 秒数 ≥ 20 时可提交

    scriptIdx: 0,
    scripts: SCRIPTS,

    error: '',
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad(options) {
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
    // 随机选一段朗读文
    this.setData({
      scriptIdx: Math.floor(Math.random() * SCRIPTS.length),
    });

    if (!getToken()) {
      this.setData({ needToken: true });
      return;
    }
    this._init();
  },

  onUnload() {
    this._stopTick();
    if (this._recorder) {
      this._recorder.dispose();
      this._recorder = null;
    }
  },

  async _init() {
    try {
      const me = await api.get('/api/auth/me');
      this.setData({ userId: me.user_id });
    } catch (e) {
      console.warn('fetch me failed', e);
    }
    await this._fetchMyVoiceprint();
  },

  async _fetchMyVoiceprint() {
    try {
      const vp = await api.get('/api/voiceprints/me');
      this.setData({ currentVoiceprint: vp || null });
    } catch (e) {
      // null / 404 都视为未录
      this.setData({ currentVoiceprint: null });
    }
  },

  // ============================================================
  // 录音
  // ============================================================

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

  async onStart() {
    if (this.data.phase === 'recording' || this.data.phase === 'uploading') return;
    this._pcmBuffer = [];
    this.setData({
      phase: 'starting',
      seconds: 0,
      secondsStr: '0.0',
      progressPct: 0,
      canSubmit: false,
      error: '',
    });
    this._ensureRecorder();
    try {
      await this._recorder.start();
      this.setData({ phase: 'recording' });
      this._startTick();
    } catch (e) {
      // onError 已弹错
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
      if (s >= MAX_SECONDS) this.onStop(true);
    }, 200);
  },

  _stopTick() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    this._tickTimer = null;
  },

  async onStop(autoSubmit) {
    if (this.data.phase !== 'recording') return;
    this._stopTick();
    if (this._recorder) {
      this._recorder.stop();
    }

    const sec = this.data.seconds;
    if (!this._pcmBuffer || this._pcmBuffer.length === 0 || sec < 1) {
      this.setData({ phase: 'idle' });
      wx.showToast({ title: '没录到声音', icon: 'none' });
      return;
    }

    if (!autoSubmit && sec < MIN_SUBMIT_SECONDS) {
      this.setData({ phase: 'idle' });
      wx.showToast({
        title: `录了 ${sec.toFixed(0)}s, 至少 ${MIN_SUBMIT_SECONDS}s 才能提交`,
        icon: 'none',
        duration: 2500,
      });
      return;
    }

    await this._uploadVoiceprint();
  },

  async _uploadVoiceprint() {
    if (!this.data.userId) {
      this.setData({ phase: 'idle', error: '未拿到用户身份' });
      return;
    }

    // 拼 PCM
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
      // 1. 写临时文件
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath: tempPath,
          data: merged.buffer,
          encoding: 'binary',
          success: resolve,
          fail: reject,
        });
      });

      // 2. wx.uploadFile (走 utils/api.uploadFile, 自动 Bearer)
      await api.uploadFile('/api/voiceprints', tempPath, {
        user_id: this.data.userId,
      });

      // 3. 清临时文件
      try {
        fs.unlinkSync(tempPath);
      } catch (_) { /* ignore */ }

      // 4. 拉新状态
      await this._fetchMyVoiceprint();
      this._pcmBuffer = [];
      this.setData({ phase: 'done' });
      wx.showToast({ title: '声纹录入成功', icon: 'success' });
    } catch (e) {
      console.error('upload voiceprint failed', e);
      this.setData({
        phase: 'idle',
        error: e.message || '上传失败',
      });
      wx.showToast({
        title: (e && e.message) || '上传失败',
        icon: 'none',
        duration: 3000,
      });
    }
  },

  // ============================================================
  // 删除
  // ============================================================

  onDelete() {
    wx.showModal({
      title: '删除我的声纹?',
      content: '删除后 会议中 将无法 自动识别 你的发言.',
      confirmText: '删除',
      confirmColor: '#f43f5e',
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await api.del('/api/voiceprints/me');
          this.setData({ currentVoiceprint: null });
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (e) {
          wx.showToast({
            title: e.message || '删除失败',
            icon: 'none',
            duration: 2500,
          });
        }
      },
    });
  },

  // ============================================================
  // 朗读文 切换 + 其他 UI
  // ============================================================

  onNextScript() {
    if (this.data.phase === 'recording' || this.data.phase === 'uploading') return;
    this.setData({
      scriptIdx: (this.data.scriptIdx + 1) % SCRIPTS.length,
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/webview/webview' }),
    });
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
    this.setData({ needToken: false });
    this._init();
  },
});
