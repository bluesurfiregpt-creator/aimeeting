# Aimeeting 微信小程序 (WebView 套壳)

把已有的 mobile H5 (`https://aimeeting.zhzjpt.cn/m`) 通过 `<web-view>` 组件嵌入微信小程序. 工程极简, 主体在 web 端, 小程序只做容器.

---

## 工程结构

```
wechat-miniprogram/
├── app.json                       小程序根路由 + 窗口配置
├── app.js                         启动逻辑 + 全局 h5Base
├── app.wxss                       全局深色样式
├── sitemap.json                   小程序内搜索索引
├── project.config.json            微信开发者工具工程配置 (AppID 在这)
├── pages/
│   ├── webview/                   主页 — 全屏 web-view, src 指向 H5
│   │   ├── webview.js
│   │   ├── webview.wxml
│   │   ├── webview.wxss
│   │   └── webview.json
│   ├── about/                     关于页 — 版本号 + 客服
│   │   ├── about.js
│   │   ├── about.wxml
│   │   ├── about.wxss
│   │   └── about.json
│   └── picker/                    v27.0-mobile P19-B 微信聊天记录文件选择器
│       ├── picker.js              wx.chooseMessageFile + wx.uploadFile
│       ├── picker.wxml
│       ├── picker.wxss
│       └── picker.json
└── .gitignore                     忽略本地配置
```

---

## 你必须做的 6 步

### 1. 填 AppID

打开 `project.config.json`, 找 `"appid": "__YOUR_APPID__"`, 替换成你企业小程序的 AppID. 例:

```diff
- "appid": "__YOUR_APPID__",
+ "appid": "wx1234567890abcdef",
```

AppID 在 [https://mp.weixin.qq.com](https://mp.weixin.qq.com) 后台 → **开发 → 开发管理 → 开发设置** 看.

### 2. 用微信开发者工具打开

下载: [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

- 打开 → 导入项目 → 项目目录选这个 `wechat-miniprogram/` 文件夹
- AppID 填刚才那个
- "不使用云服务" 勾上

启动后应看到一个空白 webview 在加载 `https://aimeeting.zhzjpt.cn/m`. 第一次打开**会报域名错** (因为还没在后台配业务域名). 这是预期的, 进到第 3 步.

### 3. 在小程序后台配业务域名

#### 3.1 后台添加业务域名
1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → **开发 → 开发管理 → 开发设置**
2. 滚到 **业务域名** 区, 点 "修改"
3. 弹框里点 **下载 MP_verify 文件** — 会下一个 `MP_verify_XXXXXXXX.txt` (XXXXXXXX 是 8 位随机字符)

#### 3.2 把验证文件挂到服务器
把下载的 `MP_verify_XXXXXXXX.txt` 文件 **放到 repo 的** `frontend/public/` 目录下, 文件名保留原样 (微信会按你下载的文件名校验).

```bash
mv ~/Downloads/MP_verify_XXXXXXXX.txt /path/to/aimeeting/frontend/public/
```

然后部署:
```bash
cd /path/to/aimeeting
bash deploy/rsync-up.sh --deploy
```

部署完测试:
```bash
curl -I https://aimeeting.zhzjpt.cn/MP_verify_XXXXXXXX.txt
# 应该返 200, content-type: text/plain
```

#### 3.3 回小程序后台填业务域名
回到 mp.weixin.qq.com 业务域名弹框, 填:

```
https://aimeeting.zhzjpt.cn
```

点 **保存并提交**. 微信会去 fetch `https://aimeeting.zhzjpt.cn/MP_verify_XXXXXXXX.txt` 校验, 几秒内显 "保存成功".

> ⚠️ 一个 MP 账号每月最多改 50 次业务域名, 别频繁动.

### 4. 开发者工具内重新编译

回到微信开发者工具, 点 **编译**. 这次应该能正常加载 H5 了. 你能在工具的模拟器里直接用所有 mobile 端功能:
- 登录 (cookie 自动管理)
- 看今日 / 会议 / 任务 / 智囊 / 单专家详情 / 任务详情
- 召 AI / 结束会议 / 议程推进
- WebSocket 实时转录 (web-view 支持原生 WebSocket)

### 5. 真机预览

工具右上角点 **预览** → 生成二维码 → 用微信扫码 → 在你手机微信里打开. 真机上验证一遍, 重点关注:
- 登录态在小程序里能保持 (cookie)
- WebSocket 实时 (议程横幅 / AI streaming) 真机能跑
- 字号 / 触摸热区在你手机屏幕上 OK

### 6. 提交审核

工具右上角点 **上传** → 填版本号 + 项目备注 → 上传.

去 mp.weixin.qq.com → **版本管理**:
- 上传的版本会变 "开发版"
- 点 **提交审核** → 填类目 (商务服务 - 企业管理 OR 工具) → 提交
- 微信审核 1-3 工作日, 邮件通知
- 通过后点 **发布**, 正式上线 ✓

---

## 我侧已经做完的事

- 工程骨架 (app.json / app.js / 路由 / 默认深色样式)
- WebView 页 (含分享 onShareAppMessage + 路径透传 onLoad)
- 关于页 (版本号 + 环境识别)
- gitignore 忽略本地配置

---

## 后续优化 (mvp 之后再说)

| 功能 | 现状 | 工作量 |
|------|------|--------|
| **wx.login 无感登录** | 用户在 webview 里走完整登录. 优化版: 启动时 wx.login() 拿 code → 后端 jscode2session 换 openid → 关联现有 user → cookie 设回 webview | 半天 |
| **小程序原生分享卡片** | onShareAppMessage 已写, 但分享出去的卡片图是默认的. 加自定义 share.png | 1h |
| **客服消息** | mp.weixin.qq.com → 客服 → 配企业微信客服, 用户在 webview 里能直接联系 | 2h |
| **订阅消息** | 任务到期 / 会议提醒等推送, 走小程序订阅消息 | 1 天 |
| **Taro/uni-app 同构** | 现在是 WebView 套壳, 没原生体验. 如果要充分用 wx API, 需要把现有 React 用 Taro 改写, 编译成小程序原生代码 | 2-4 周 |

---

## 常见问题

### Q: WebSocket 在小程序 WebView 里能跑吗?
A: 能. `<web-view>` 内的 H5 用浏览器标准 WebSocket API (`new WebSocket(...)`), 跟小程序 `wx.connectSocket` 是独立的两个能力, 不冲突. P5B 的实时转录 / AI streaming / 议程横幅在小程序里也能正常用.

### Q: 登录态 cookie 跨 web-view 切换会丢吗?
A: 不会. 同一 web-view 会话内, cookie 由 H5 自己管 (httpOnly cookie). 用户关小程序再开, cookie 一般还在 (取决于 cookie expire 设置).

### Q: 用户用其他手机登录怎么办?
A: 跟 H5 一样的逻辑 — 用户在另一手机的微信打开你小程序, 第一次会要他在 webview 里输邮箱密码登录. 后续做 wx.login 优化后可以一键无感登录.

### Q: 业务域名校验失败 "未通过校验"?
A: 检查:
1. `MP_verify_XXXXXXXX.txt` 文件名跟你下载的**完全一致** (大小写敏感)
2. 文件在 `https://aimeeting.zhzjpt.cn/MP_verify_XXXXXXXX.txt` 能 curl 到 200
3. content-type 是 `text/plain` (Next.js 默认就是)
4. 文件内容跟微信后台下载的一致 (一行随机字符)

### Q: P19-B picker 页 wx.uploadFile 失败 ("不在以下 request 合法域名列表中")?
A: 同 业务域名, **uploadFile 合法域名** 是 另一个 独立 列表. 去:
mp.weixin.qq.com → **开发 → 开发管理 → 开发设置 → 服务器域名**, 在
"uploadFile 合法域名" 加 `https://aimeeting.zhzjpt.cn`. 跟业务域名 一样
每月 50 次 修改 上限.

### Q: 微信聊天记录的文件 在 picker 页 选不出来?
A: `wx.chooseMessageFile` 仅能选 当前 用户 在 微信 聊天 里 收到 或 发出
的文件 (≤ 7 天内有效). 群文件 / 收藏夹 / 文件传输助手 都算. 微信号
没收过任何文件时, 弹窗会显空. 让用户先 把 文件 发到 自己 (or 文件传输助手).

### Q: 审核会被卡吗?
A: 常见卡点:
1. 没填类目 → 选 "商务服务 - 企业管理" 或 "工具 - 效率"
2. 描述不清 → 描述写明 "AI 协作的会议工作台"
3. 体验路径不可用 → 提交审核前确保测试账号能正常登录 + 看到主页. 若需要审核员账号, 在 "提交审核" 备注填 owner 邮箱密码

### Q: WebView 里页面有时白屏?
A: 一般是 H5 加载慢 + 网络抖. WebView 自身没 loading 态, H5 的 spinner 会接管. 如果想加小程序级 loading, 在 webview.js 的 onLoad 里加 `wx.showLoading()`, web-view onLoad/onReady 隐藏.

---

## 联系

代码问题 / 改动需求, 直接在主 repo 提.
