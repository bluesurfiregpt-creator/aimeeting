// pages/login/login.js — v27.1 微信 OAuth 一键登录页 (替代旧 H5 桥页)
//
// 三态流:
//   1. 初始 ready  → 大按钮 "微信一键登录"
//   2. wx-login 返 bound=true  → setToken + reLaunch /pages/home/home
//   3. wx-login 返 bound=false → 切到 bind 子态, 展开 邮密表单
//      用户填邮密 → POST /api/auth/token 拿 token → 用 token 调 /api/auth/wx-bind
//      绑成功 → 跟态 2 一样 reLaunch home
//
// 调用顺序 (态 3 完整):
//   a. wx.login()           → code (本次 用了被废弃, 下面 b 还要新 code)
//   b. POST /api/auth/wx-login {code}        → bound:false
//   c. setData show 邮密表单
//   d. user 填 → POST /api/auth/token        → token, expires_at
//   e. setToken(token, exp)
//   f. wx.login()           → 新 code (不能复用 a 的)
//   g. POST /api/auth/wx-bind {code} Bearer  → 新 token (写 storage)
//   h. wx.reLaunch /pages/home/home
//
// 错误恢复:
//   - 微信登录 fail (用户拒授权 / 网络挂)  → 留在态 1, 显小字 "请重试"
//   - 邮密验失败 (401)                  → 留态 3, 显 "邮箱或密码不正确"
//   - wx-bind 返 409 (openid 被别人绑)   → 显 "此微信号已绑别的账号, 联系管理员"
//
// 不做 (后续 phase):
//   - 拉 nickname / avatar (要 button open-type=getUserInfo)
//   - 注册 / 找回密码 (留桌面 H5 入口, login 页放纯文字 "请联系工作区管理员")

const api = require('../../utils/api');
const { setToken, getToken } = require('../../utils/auth');

const STATE_READY = 'ready';
const STATE_LOADING = 'loading';
const STATE_BIND = 'bind';     // 已有账号 用 邮箱/手机号 + 密码 登录
const STATE_REGISTER = 'register'; // 新用户 自助 注册 (姓名 + 账号 + 密码)

Page({
  data: {
    state: STATE_READY, // ready | loading | bind
    busy: false,
    hint: '', // 大按钮下方 灰色 提示文字
    error: '', // 红色 错误条 (态 1 + 态 3 通用)

    // === 态 3 bind form ===
    // v27.2: account 同时 接受 email / phone (前端 不强 区分, 后端 自动 识别)
    account: '',
    password: '',
    showPassword: false,

    // === 态 4 register form ===
    registerName: '',
    registerAccount: '',  // email or phone
    registerPassword: '',
    registerShowPassword: false,

    // ===== UI 衍生 =====
    statusBarHeight: 20, // 实际由 onLoad 用 wx.getMenuButtonBoundingClientRect 算
  },

  // ============================================================
  // 生命周期
  // ============================================================

  onLoad() {
    // 如果已经有 token (用户重启 app 落到 login 但其实已登 过), 直接跳 home
    if (getToken()) {
      wx.switchTab({ url: '/pages/home/home' });
      return;
    }

    // 算状态栏高度 给自定义 nav bar 留位
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : {};
      this.setData({ statusBarHeight: sys.statusBarHeight || 20 });
    } catch (_) {
      // ignore
    }
  },

  // ============================================================
  // 主按钮: 微信一键登录 (openid 路径)
  // ============================================================

  async onTapWxLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', state: STATE_LOADING });
    try {
      const code = await this._wxLogin();
      const res = await api.post('/api/auth/wx-login', { code }, { skipAuth: true });
      if (res.bound) {
        // ====== 已绑用户 一键过 ======
        setToken(res.token, res.expires_at);
        this._gotoHome();
      } else {
        // ====== openid 未绑 — 引导用户走 "微信手机号" 一键登录 ======
        // 同时 缓存 这次 wx.login 的 code, 后面 phone 登录 时 顺手 绑 openid.
        this._cachedWxLoginCode = code;
        this.setData({
          state: STATE_BIND,
          busy: false,
          hint: '首次使用?用「微信手机号一键登录」或「邮箱/手机号 + 密码」绑定一次,以后秒进.',
        });
      }
    } catch (e) {
      // v27.2 polish: 微信 OAuth 没配 / errcode 这种技术错, 平滑切到 邮密 fallback,
      // 别用红 banner 把用户吓到 (他们点的是 "一键登录" 不是来 debug 后端).
      const msg = e.message || '';
      const wxNotConfigured =
        msg.indexOf('微信 OAuth 未配置') >= 0 || msg.indexOf('errcode') >= 0;
      if (wxNotConfigured) {
        // 预期内 — 服务端没配 WX_SECRET, 不当错误报 (避免红字吓人)
        console.info('[login] 微信 OAuth 未启用, 自动转邮密登录');
        this.setData({
          state: STATE_BIND,
          busy: false,
          error: '',
          hint: '微信一键登录暂未启用, 请用邮箱或手机号 + 密码登录.',
        });
      } else {
        console.error('[login] wx-login failed', e);
        this.setData({
          state: STATE_READY,
          busy: false,
          error: msg || '微信登录失败,请重试',
        });
      }
    }
  },

  // ============================================================
  // 微信手机号 一键登录 (getPhoneNumber 路径)
  //
  // 触发: <button open-type="getPhoneNumber" bindgetphonenumber="...">
  // 微信会弹原生 sheet "授权将手机号 (138****5678) 提供给小程序",
  // 用户点 "允许" 才 fire 回调拿到 code. 拒绝 时 e.detail.errMsg 含 'cancel'.
  // ============================================================

  async onGetPhoneNumber(e) {
    if (this.data.busy) return;
    const phoneCode = e && e.detail && e.detail.code;
    if (!phoneCode) {
      // 用户拒授权 / 微信返 errMsg
      const errMsg = (e && e.detail && e.detail.errMsg) || '';
      if (errMsg.indexOf('cancel') < 0 && errMsg.indexOf('deny') < 0) {
        this.setData({ error: '微信手机号授权失败: ' + errMsg });
      }
      // cancel/deny 不显错, 用户自己点的
      return;
    }

    this.setData({ busy: true, error: '' });
    try {
      // 如果之前点过"微信一键登录"但没绑过, 这里复用那次的 wx.login code 顺手绑 openid;
      // 否则 重新 wx.login 拿一个新 code.
      let wxLoginCode = this._cachedWxLoginCode || '';
      if (!wxLoginCode) {
        try { wxLoginCode = await this._wxLogin(); } catch (_) { /* 失败不阻塞 */ }
      }
      this._cachedWxLoginCode = ''; // 用完即扔, code 一次性

      const res = await api.post(
        '/api/auth/wx-phone-login',
        { code: phoneCode, wx_login_code: wxLoginCode || undefined },
        { skipAuth: true },
      );

      if (res.bound) {
        // ====== 手机号 命中 User → 直接登录 ======
        setToken(res.token, res.expires_at);
        wx.showToast({ title: '登录成功', icon: 'success', duration: 700 });
        setTimeout(() => this._gotoHome(), 350);
      } else {
        // ====== 微信手机号 在 系统里 没账号 → 提示用户邮密绑定 ======
        this.setData({
          busy: false,
          state: STATE_BIND,
          hint: '该微信手机号尚未注册. 请用邮箱/手机号密码登录一次, 之后绑定就能一键进了.',
        });
      }
    } catch (e) {
      const msg = e.message || '';
      const wxNotConfigured =
        msg.indexOf('微信 OAuth 未配置') >= 0 || msg.indexOf('errcode') >= 0;
      if (wxNotConfigured) {
        console.info('[login] 微信手机号登录 未启用, 自动转邮密登录');
        this.setData({
          state: STATE_BIND,
          busy: false,
          error: '',
          hint: '微信手机号登录暂未启用, 请用邮箱或手机号 + 密码登录.',
        });
      } else {
        console.error('[login] wx-phone-login failed', e);
        this.setData({
          busy: false,
          error: '手机号登录失败: ' + msg.slice(0, 30),
        });
      }
    }
  },

  /**
   * Promise 化 wx.login().
   * 成功 resolve code, 失败 reject Error.
   */
  _wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        timeout: 10000,
        success: (res) => {
          if (res.code) resolve(res.code);
          else reject(new Error('wx.login 没返 code'));
        },
        fail: (err) => reject(new Error('wx.login 失败: ' + (err.errMsg || ''))),
      });
    });
  },

  // ============================================================
  // bind 表单
  // ============================================================

  onAccountInput(e) {
    this.setData({ account: e.detail.value });
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },
  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  /** 退出 bind 态, 回大按钮 */
  onCancelBind() {
    if (this.data.busy) return;
    this.setData({
      state: STATE_READY,
      error: '',
      account: '',
      password: '',
    });
  },

  // ============================================================
  // 注册 (态 4)
  // ============================================================

  onTapGoToRegister() {
    if (this.data.busy) return;
    this.setData({
      state: STATE_REGISTER,
      error: '',
      // 把 bind 表单里 已 输入 的 account 顺手 带过去 (用户体感连贯)
      registerAccount: this.data.account || '',
      registerPassword: '',
      registerName: '',
    });
  },

  onCancelRegister() {
    if (this.data.busy) return;
    this.setData({
      state: STATE_BIND,
      error: '',
      registerName: '',
      registerAccount: '',
      registerPassword: '',
    });
  },

  onRegNameInput(e)     { this.setData({ registerName: e.detail.value }); },
  onRegAccountInput(e)  { this.setData({ registerAccount: e.detail.value }); },
  onRegPasswordInput(e) { this.setData({ registerPassword: e.detail.value }); },
  toggleRegPassword()   { this.setData({ registerShowPassword: !this.data.registerShowPassword }); },

  async onSubmitRegister() {
    if (this.data.busy) return;
    const name = (this.data.registerName || '').trim();
    const account = (this.data.registerAccount || '').trim();
    const password = this.data.registerPassword || '';

    if (!name) {
      this.setData({ error: '请填姓名' });
      return;
    }
    if (!account) {
      this.setData({ error: '请填邮箱或手机号' });
      return;
    }
    if (!password || password.length < 6) {
      this.setData({ error: '密码至少 6 位' });
      return;
    }
    const kind = this._classifyAccount(account);
    if (!kind) {
      this.setData({ error: '账号格式不对 — 邮箱含 @, 手机号 11 位 1 开头' });
      return;
    }

    this.setData({ busy: true, error: '' });
    try {
      // step 1: 注册 (后端 创建 user + workspace, set cookie)
      const body = { name, password };
      if (kind === 'email') body.email = account;
      else body.phone = account;
      await api.post('/api/auth/register', body, { skipAuth: true });

      // step 2: 拿 Bearer token (走 /api/auth/token 邮密 = 同样的 credentials)
      const tk = await api.post(
        '/api/auth/token',
        { account, password },
        { skipAuth: true },
      );
      setToken(tk.token, tk.expires_at);

      // step 3 (可选): 顺手 wx.login + 绑 openid, 让 下次 微信一键登录 能用
      try {
        const code = await this._wxLogin();
        await api.post('/api/auth/wx-bind', { code });
      } catch (_) {
        // openid 绑失败 不阻塞 — 不是关键路径
      }

      wx.showToast({ title: '注册成功', icon: 'success', duration: 800 });
      setTimeout(() => this._gotoHome(), 400);
    } catch (e) {
      console.error('[login] register failed', e);
      let msg = e.message || '注册失败';
      // 友好化常见错
      if (msg.indexOf('email already registered') >= 0 || msg.indexOf('邮箱已被注册') >= 0) {
        msg = '邮箱已被注册, 请改用「登录」';
      } else if (msg.indexOf('手机号已被注册') >= 0) {
        msg = '手机号已被注册, 请改用「登录」';
      } else if (msg.indexOf('password too short') >= 0) {
        msg = '密码太短 (至少 6 位)';
      } else if (msg.indexOf('请提供邮箱或手机号') >= 0) {
        msg = '邮箱或手机号格式不对';
      } else if (msg.indexOf('手机号格式不正确') >= 0) {
        msg = '手机号格式不正确 (需 11 位 CN 手机号)';
      }
      this.setData({ busy: false, error: msg });
    }
  },

  /**
   * v27.2 客户端粗判: 含 '@' 当 email; 11 位 1 开头 (允许 +86 / 空格 / 横线) 当 phone.
   * 都不像 → 前端先拦. 真正合法性由后端 _authenticate_user 决定.
   */
  _classifyAccount(s) {
    const t = (s || '').trim();
    if (!t) return null;
    if (t.indexOf('@') >= 0) return 'email';
    // 抽掉 空白 / 横线 / +86 后看是否 11 位 1 开头
    let stripped = t.replace(/[\s-]/g, '');
    if (stripped.startsWith('+86')) stripped = stripped.slice(3);
    else if (stripped.startsWith('86') && stripped.length === 13) stripped = stripped.slice(2);
    if (/^1\d{10}$/.test(stripped)) return 'phone';
    return null;
  },

  async onSubmitBind() {
    if (this.data.busy) return;
    const { account, password } = this.data;
    if (!account || !password) {
      this.setData({ error: '请填邮箱/手机号和密码' });
      return;
    }
    const kind = this._classifyAccount(account);
    if (!kind) {
      this.setData({ error: '账号格式不对 — 邮箱含 @, 手机号 11 位 1 开头' });
      return;
    }

    this.setData({ busy: true, error: '' });
    try {
      // step 1: 邮箱/手机号 + 密码 登录拿 token (用 account 字段, 后端自动识别)
      const tk = await api.post(
        '/api/auth/token',
        { account: account.trim(), password },
        { skipAuth: true },
      );
      setToken(tk.token, tk.expires_at);

      // step 2: 重新 wx.login 拿新 code (旧的 wx-login 用过了)
      const code = await this._wxLogin();

      // step 3: 绑 openid
      const bind = await api.post('/api/auth/wx-bind', { code });
      // wx-bind 返新 token (顺手刷一下)
      setToken(bind.token, bind.expires_at);

      wx.showToast({ title: '绑定成功', icon: 'success', duration: 800 });
      // 略等 toast 闪一下再跳, 避免感觉太突兀
      setTimeout(() => this._gotoHome(), 400);
    } catch (e) {
      console.error('[login] bind failed', e);
      let msg = e.message || '绑定失败';
      // 友好化
      if (
        msg === 'unauthorized'
        || msg.indexOf('incorrect email or password') >= 0
        || msg.indexOf('incorrect account or password') >= 0
      ) {
        msg = '账号或密码不正确, 检查后重试 (没账号请点下方注册)';
      } else if (msg.indexOf('已绑定其他账号') >= 0) {
        msg = '此微信号已被其他账号绑定,请联系工作区管理员';
      } else if (msg.indexOf('已禁用') >= 0) {
        msg = '账号已被禁用,请联系管理员';
      }
      this.setData({ busy: false, error: msg });
    }
  },

  _gotoHome() {
    // home 是 tabBar 页 — 用 switchTab (会自动 关掉 login 这种 非 tab 页)
    wx.switchTab({
      url: '/pages/home/home',
      fail: (err) => {
        console.error('[login] switchTab home fail', err);
      },
    });
  },

  // ============================================================
  // 隐私政策链接
  // ============================================================

  onTapPrivacy() {
    // 短期 走 webview 看 H5 隐私详情 (后期 这页也可改原生)
    const path = encodeURIComponent('/m/privacy');
    wx.navigateTo({
      url: `/pages/webview/webview?path=${path}`,
    });
  },

  onTapAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },
});
