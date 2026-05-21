// utils/api.js — 统一 REST API 调用封装.
//
// 自动:
//   - 拼 Base URL (app.globalData.h5Base)
//   - 带 Bearer token (从 utils/auth ensureAuth 拿)
//   - 401 时清 token + 抛 'unauthorized' 错 (caller 跳登录)
//   - 网络错误 / 非 2xx 全部统一返 Error
//
// 用法:
//   const api = require('../../utils/api');
//   const detail = await api.get(`/api/m/meetings/${id}`);
//   const created = await api.post('/api/meetings', { title: 'xxx', ... });
//   const updated = await api.patch(`/api/m/insights/${id}/decision`, { decision: 'accepted' });
//
// 跟 frontend/src/lib/mobile/api.ts 的 jget/jsend 设计一致.

const app = getApp();
const { ensureAuth, clearAuth } = require('./auth');

const TIMEOUT_DEFAULT = 30000;
const TIMEOUT_LLM = 60000; // LLM 接口要长 timeout (拆议程 / 抽 insight 等)

const LLM_PATHS = [
  '/api/meetings/decompose-agenda',
  // 其他 LLM 接口陆续加
];

function _timeoutFor(path) {
  for (const p of LLM_PATHS) {
    if (path.startsWith(p)) return TIMEOUT_LLM;
  }
  return TIMEOUT_DEFAULT;
}

/**
 * 通用 request — 自动鉴权 + 错误处理.
 *
 * @param {string} method - GET/POST/PATCH/PUT/DELETE
 * @param {string} path - /api/... 开头
 * @param {object} opts - { data?, params?, timeout?, skipAuth? }
 * @returns {Promise<any>} 解析过的 response data
 * @throws {Error} 鉴权失败 / 网络失败 / 非 2xx 业务错误
 */
async function request(method, path, opts = {}) {
  let header = { 'content-type': 'application/json' };

  if (!opts.skipAuth) {
    let token;
    try {
      token = await ensureAuth();
    } catch (e) {
      throw new Error('unauthorized');
    }
    header.Authorization = 'Bearer ' + token;
  }

  let url = app.globalData.h5Base + path;
  if (opts.params) {
    const qs = Object.entries(opts.params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data: opts.data,
      header,
      timeout: opts.timeout || _timeoutFor(path),
      success: (res) => {
        const code = res.statusCode;
        if (code >= 200 && code < 300) {
          resolve(res.data);
          return;
        }
        if (code === 401) {
          // token 失效, 清掉, caller 跳登录
          clearAuth();
          reject(new Error('unauthorized'));
          return;
        }
        // 其他错误 — 优先用后端给的 detail 字段
        const detail = (res.data && res.data.detail) || ('HTTP ' + code);
        const err = new Error(detail);
        err.statusCode = code;
        err.body = res.data;
        reject(err);
      },
      fail: (err) => {
        // wx 网络层失败 (超时 / DNS 等)
        reject(new Error('network: ' + (err.errMsg || 'unknown')));
      },
    });
  });
}

const get = (path, params, opts) => request('GET', path, { params, ...(opts || {}) });
const post = (path, data, opts) => request('POST', path, { data, ...(opts || {}) });
const patch = (path, data, opts) => request('PATCH', path, { data, ...(opts || {}) });
const put = (path, data, opts) => request('PUT', path, { data, ...(opts || {}) });
const del = (path, opts) => request('DELETE', path, opts || {});

/**
 * 文件上传 (multipart).
 * @param {string} path - /api/... 开头
 * @param {string} filePath - wx.chooseMessageFile 等返的临时路径
 * @param {object} formData - 跟 file 一起发的 form fields
 */
async function uploadFile(path, filePath, formData = {}) {
  let token;
  try {
    token = await ensureAuth();
  } catch (e) {
    throw new Error('unauthorized');
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: app.globalData.h5Base + path,
      filePath,
      name: 'file',
      formData,
      header: { Authorization: 'Bearer ' + token },
      timeout: 120000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data));
          } catch (_) {
            resolve(res.data);
          }
        } else {
          let detail = 'HTTP ' + res.statusCode;
          try {
            const j = JSON.parse(res.data);
            if (j && j.detail) detail = j.detail;
          } catch (_) {
            // ignore
          }
          if (res.statusCode === 401) {
            clearAuth();
            reject(new Error('unauthorized'));
          } else {
            reject(new Error(detail));
          }
        }
      },
      fail: (err) => reject(new Error('network: ' + (err.errMsg || 'unknown'))),
    });
  });
}

module.exports = { request, get, post, patch, put, del, uploadFile };
