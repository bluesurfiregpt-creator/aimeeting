# aimeeting

AI 会议系统的设计稿 — 两个端的高保真原型 + 历史搜索页。

## 入口文件

| 文件 | 内容 |
|---|---|
| `index.html` | 移动端「会议历史搜索」(微信小程序) |
| `Meeting Room.html` | 移动端「会议室」(直播态,微信小程序) |
| `Meeting Room (Web).html` | Web 版「会议室」(1440×900 桌面端) |

## 组件文件

| 文件 | 用途 |
|---|---|
| `app.jsx` | 历史搜索页主逻辑 |
| `ios-frame.jsx` | iOS 设备外壳 + 状态栏 + 键盘 |
| `meeting-room-shared.jsx` | 共享数据 + 头像 + 图标(移动端 / Web 都用) |
| `meeting-room.jsx` | 移动端会议室主逻辑 |
| `meeting-room-web-parts.jsx` | Web 端的消息渲染器 + AI 圆桌 |
| `meeting-room-web.jsx` | Web 端主布局 + 左右面板 |
| `browser-window.jsx` | Web 版用的浏览器外壳 |

## 备份

- `app.v1.jsx` — 历史搜索页 v1(无 AI 专家强调,可删)

## 核心设计概念

- **AI 专家**:Aria(数据)/ Stratos(策略)/ Lex(法务)/ Sage(UX)/ Tally(财务)/ Scout(市场)— 圆角方形 + 渐变头像,与真人(圆形)视觉区分
- **主持人 Mira**:同心圆头像 + 琥珀色 — 管议程、监测偏离、拆解问题路由
- **3 级偏离提醒梯度**:软观察 → 中度协商 → 强行打断(红色脉冲 + 倒计时)
- **AI 圆桌卡**:多专家并发咨询折叠成单卡 — Mira 综合在顶,手风琴展开专家详情,timeline 不跳动
- **筛选**:按发言人(真人 / AI / Mira)多选过滤 timeline,会议中和会后归档共用
- **章节导航**:从 timeline 自动提取议程切换 / 偏离提醒 / AI 圆桌等关键节点,点击平滑滚动

## 技术栈

纯静态 — React 18 (UMD) + Babel standalone,无构建步骤。每个 HTML 单独可打开。
