// utils/auth.js — token 管理 + 自动 refresh
//
// 用法:
//   const { getToken, ensureAuth, clearAuth } = require('../../utils/auth');
//   const token = await ensureAuth();      // 没 token / 快过期 → 自动 refresh; 返 token 或 抛错跳登录
//   wx.request({ url, header: { Authorization: 'Bearer ' + token } });
//
// 没 token 时 ensureAuth 抛 'no-token', 调用方应 wx.navigateTo 到登录页 (web-view login).
//
// v27.0-mobile P21 原生 N-1: 小程序原生页统一从这里拿 token, 不要在各 page 自己读 storage.

const app = getApp();

const TOKEN_KEY = 'aim_token';
const TOKEN_EXP_KEY = 'aim_token_exp';
const REFRESH_THRESHOLD_MS = 7 * 24 * 3600 * 1000; // 距过期 < 7 天就 refresh

/** 同步拿 token (storage). 没就返 '' */
function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (_) {
    return '';
  }
}

/** 同步拿 expires_at (storage). 没就返 '' */
function getTokenExp() {
  try {
    return wx.getStorageSync(TOKEN_EXP_KEY) || '';
  } catch (_) {
    return '';
  }
}

/** 存 token + expires_at (登录 / refresh 后调) */
function setToken(token, expiresAt) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
    wx.setStorageSync(TOKEN_EXP_KEY, expiresAt);
  } catch (e) {
    console.error('[auth] setToken failed', e);
  }
}

/** 清 token (登出 / 401 时调) */
function clearAuth() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(TOKEN_EXP_KEY);
  } catch (_) {
    // ignore
  }
}

/** token 是否快过期 — 距 expires_at < 7 天 */
function _shouldRefresh() {
  const exp = getTokenExp();
  if (!exp) return false;
  const t = new Date(exp).getTime();
  if (isNaN(t)) return false;
  return t - Date.now() < REFRESH_THRESHOLD_MS;
}

/** 调 /api/auth/token/refresh 换新 token. 成功后写 storage. 失败抛错. */
function refreshToken() {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) {
      reject(new Error('no-token'));
      return;
    }
    wx.request({
      url: app.globalData.h5Base + '/api/auth/token/refresh',
      method: 'POST',
      header: { Authorization: 'Bearer ' + token },
      timeout: 10000,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.token) {
          setToken(res.data.token, res.data.expires_at);
          resolve(res.data.token);
        } else {
          // 401 = 旧 token 已过期, 必须重登
          reject(new Error('refresh-failed:' + res.statusCode));
        }
      },
      fail: (err) => reject(new Error('refresh-network:' + (err.errMsg || 'unknown'))),
    });
  });
}

/**
 * 拿 token, 必要时 refresh.
 *
 * 调用方应在 page onLoad 调:
 *   try {
 *     const token = await ensureAuth();
 *     // 用 token 调 API
 *   } catch (e) {
 *     // 跳登录页 (web-view login)
 *     wx.reLaunch({ url: '/pages/webview/webview?path=/login' });
 *   }
 */
async function ensureAuth() {
  const token = getToken();
  if (!token) {
    throw new Error('no-token');
  }
  if (_shouldRefresh()) {
    try {
      return await refreshToken();
    } catch (e) {
      // refresh 失败, 但旧 token 可能还能用一段时间 — 先用旧的, 下次 page 加载再试
      console.warn('[auth] refresh failed, using old token:', e.message);
      return token;
    }
  }
  return token;
}

/**
 * 用邮箱密码登录, 拿 token 写进 storage. 给 (未来) 小程序原生登录页用.
 * 当前 H5 webview 登录走 cookie, 不进这里 — 这里是为了后续真做原生登录页准备的.
 */
function loginWithPassword(email, password) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.h5Base + '/api/auth/token',
      method: 'POST',
      data: { email, password },
      timeout: 10000,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.token) {
          setToken(res.data.token, res.data.expires_at);
          resolve(res.data);
        } else {
          const detail = (res.data && res.data.detail) || ('HTTP ' + res.statusCode);
          reject(new Error(detail));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || 'network')),
    });
  });
}

module.exports = {
  getToken,
  getTokenExp,
  setToken,
  clearAuth,
  ensureAuth,
  refreshToken,
  loginWithPassword,
};
