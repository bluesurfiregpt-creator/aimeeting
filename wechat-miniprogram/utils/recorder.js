// utils/recorder.js — 微信录音器封装 (帧模式 PCM 输出).
//
// 用法:
//   const rec = createRecorder({
//     sampleRate: 16000,
//     frameSize: 2,        // KB / 帧, 2 KB ≈ 62.5 ms
//     onFrame: (arrayBuffer) => { ws.sendPCM(arrayBuffer); },
//     onError: (err) => { /* 显错 */ },
//     onStateChange: (state) => { /* idle/starting/recording/paused/stopping/error */ },
//   });
//   await rec.start();   // 弹麦克风授权 + 启动
//   rec.pause();         // 闭麦 (不停止 session, 用户可恢复)
//   rec.resume();
//   rec.stop();          // 完全停止
//
// 已踩过的坑 (写在代码里防忘记):
//
// 1. `format: 'PCM'` 必须大写, 用 'pcm' 会被微信识别为 mp3 (基础库 2.30 前)
//
// 2. iOS 微信 PCM frame 模式 兼容性: 基础库 ≥ 2.30 OK; < 2.30 frame 可能不触发,
//    退化方案 用 wx.startRecord (老 API), 但不流式. 当前 mvp 仅支持 ≥ 2.30.
//
// 3. `frameSize` 单位是 KB 而非样本数. PCM 16kHz mono int16 → 32 KB/s, frameSize=2
//    ≈ 62.5 ms/帧. 太小 (1) 帧太密 wx.send 压力大; 太大 (10) 延迟感强.
//
// 4. `onStop` 会返完整 tempFilePath, 我们丢掉 (流式已经发完, 不需要整段文件).
//
// 5. 微信 RecorderManager 是 单例 — 多次 getRecorderManager() 返同一个对象.
//    重新 start 之前应该 stop, 否则旧 session 还在跑.

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_SIZE_KB = 2; // ~62.5ms @ 16kHz int16 mono
const DEFAULT_ENCODE_BITRATE = 48000;

function createRecorder(options) {
  const {
    sampleRate = DEFAULT_SAMPLE_RATE,
    frameSize = DEFAULT_FRAME_SIZE_KB,
    encodeBitRate = DEFAULT_ENCODE_BITRATE,
    onFrame,
    onError,
    onStateChange,
  } = options || {};

  let manager = null;
  let state = 'idle';

  function _setState(s) {
    if (state === s) return;
    state = s;
    if (typeof onStateChange === 'function') onStateChange(s);
  }

  function _ensureManager() {
    if (manager) return manager;
    manager = wx.getRecorderManager();

    manager.onStart(() => {
      console.log('[recorder] onStart');
      _setState('recording');
    });
    manager.onPause(() => {
      console.log('[recorder] onPause');
      _setState('paused');
    });
    manager.onResume(() => {
      console.log('[recorder] onResume');
      _setState('recording');
    });
    manager.onStop((res) => {
      console.log('[recorder] onStop', res);
      _setState('idle');
    });
    manager.onError((err) => {
      console.error('[recorder] onError', err);
      _setState('error');
      if (typeof onError === 'function') onError(err);
    });
    manager.onFrameRecorded((res) => {
      // PCM 时 frameBuffer 是 ArrayBuffer (raw PCM little-endian int16)
      if (res && res.frameBuffer && typeof onFrame === 'function') {
        onFrame(res.frameBuffer);
      }
    });
    return manager;
  }

  /** 检查 / 获取 麦克风权限. 返 'granted' / 'denied'. */
  function requestPermission() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (setting) => {
          const auth = (setting && setting.authSetting) || {};
          if (auth['scope.record'] === true) {
            resolve('granted');
            return;
          }
          if (auth['scope.record'] === false) {
            // 用户之前显式拒绝, 调 wx.authorize 不会再弹, 要走 wx.openSetting
            resolve('denied-need-setting');
            return;
          }
          // 没问过, 弹原生授权
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve('granted'),
            fail: () => resolve('denied'),
          });
        },
        fail: () => resolve('denied'),
      });
    });
  }

  async function start() {
    const perm = await requestPermission();
    if (perm !== 'granted') {
      _setState('error');
      const err = new Error(
        perm === 'denied-need-setting'
          ? 'mic-permission-denied-need-setting'
          : 'mic-permission-denied',
      );
      if (typeof onError === 'function') onError(err);
      throw err;
    }

    _ensureManager();
    _setState('starting');

    try {
      manager.start({
        sampleRate,
        numberOfChannels: 1,
        encodeBitRate,
        format: 'PCM', // 大写, 跟 mp3 区分
        frameSize,
      });
    } catch (e) {
      console.error('[recorder] start sync error', e);
      _setState('error');
      if (typeof onError === 'function') onError(e);
      throw e;
    }
  }

  function pause() {
    if (manager && state === 'recording') {
      manager.pause();
    }
  }

  function resume() {
    if (manager && state === 'paused') {
      manager.resume();
    }
  }

  function stop() {
    if (manager && (state === 'recording' || state === 'paused')) {
      _setState('stopping');
      manager.stop();
    }
  }

  /** 资源回收 — 页面 onUnload 时调. 微信 RecorderManager 是单例, 不能 destroy,
   *  但我们清掉本闭包的引用 + stop 录音 */
  function dispose() {
    stop();
    manager = null;
  }

  return {
    start,
    pause,
    resume,
    stop,
    dispose,
    requestPermission,
    getState: () => state,
  };
}

/** 启动 wx.openSetting 引导用户开麦克风 (用户之前显式拒绝过时调) */
function openMicSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => {
        const granted = !!(res && res.authSetting && res.authSetting['scope.record']);
        resolve(granted);
      },
      fail: () => resolve(false),
    });
  });
}

module.exports = { createRecorder, openMicSetting };
