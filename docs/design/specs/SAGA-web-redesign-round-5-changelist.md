# Saga · Web 端 整体重做 round-5 · Review 清单

> 来源: Claude Design handoff `-DNTFxmjkSF_UtUOJBqQdw` (2026-05-26 fetch)
> Bundle 解压路径: `/tmp/claude-design-round5/aimeeting/project/`
> 状态: **待 PM 对齐 scope + 批准实施 — 主 Agent 严禁先 coding**
>
> 完整 chat 记录:
> - `/tmp/claude-design-round5/aimeeting/chats/chat1.md` (会议室 history, 跟 round-3/round-4 重叠, 无新增)
> - `/tmp/claude-design-round5/aimeeting/chats/chat2.md` (**核心 — Web 端重做全过程, 1678 行**)

---

## 0. TL;DR

**这是 round-5, 不是 round-4 v2.**

PM 在 round-4 (mobile App 浅色化 + Glow Banner 系统化) 完成后, 把 chat 接着推进, 在**同一个 design handoff** 里**全新开了 Web 端整体重做**. 移动端文件**完全没动** (8 个 mobile JSX 跟 round-4 byte-identical, 唯一差异是 `Mobile App.html` 加了一行 `animationFillMode: 'forwards'` 修 fadeIn fix).

新增的是 **8 个 Web 端 JSX (7362 行)** + **2 个 HTML 入口** (`Web Home.html` + `Web Workstation.html`):
- `web-shared.jsx` (567 行) — 暗色 + 紫色 brand 设计系统 + CSS variable dark/light theme + 16 个 AI 专家 metadata
- `web-home.jsx` (1159 行) — 首页: AI 专家市场 + 对话式发现 + 你的会议/AI 专家 横向 tab
- `web-workstation.jsx` (1142 行) — 工作站: 左侧 6 段 sidebar (12 项导航) + 7 个 pane
- `web-agent-detail.jsx` (941 行) — AI 专家详情 (脑内地图: BrainRadar + BrainGraph)
- `web-meeting-detail.jsx` (840 行) — 会议详情 (6 tabs + AI 引用闭环)
- `web-template.jsx` (713 行) — AI 模板生成器 (LLM 拆解 → 多专家 + 种子知识/记忆)
- `web-lineage-v2.jsx` (907 行) — 全景血缘图 V2 (D3 force-directed, 含**技术契约文档**)
- `web-extras.jsx` (1093 行) — Lineage v1 + 新建会议 + 数据看板 + 审批中心 4 个 pane

**核心结论**:
- **不是替换** round-4 changelist 的 B/C/D — round-4 的 mobile 暂停 Saga 仍然有效, 设计稿没变.
- **是补充** — round-5 给 mobile 之外的 Web 端开了完全独立的新 saga.
- 移动端浅色化 (Saga A 已 ship) + 移动端 round-4 Saga B/C/D (暂停) 跟当前 Web 重做 是 3 个并行轨道.
- **设计语言**: Web 主体 暗色 + 紫色 "灵光" 科技色 (`#7C5CFA` 主紫 + `#5E5CE6→#7A5AF0→#AF52DE` 渐变), 跟 mobile 浅色 iOS 风**截然不同**. PM 在 chat 中明确"会议室不要暗色"."其他全暗 + 紫色作为科技色". 这是**双套设计系统**的产品决策.
- **0-1 个后端需求** (主要新增: `GET /api/workspace/:id/lineage` 全景血缘契约)
- **预估工作量**: ~140-180 小时 (单人, 3-4 周) — 必须拆 5-7 个子 Saga, 见第 6 节

---

## 1. 这是什么轮 — 判断与证据

### 1.1 判断: round-5 (新一轮, 平行 Web 重做)

### 1.2 证据

**A. 移动端文件 byte-identical**
```
$ diff -q round-4/mobile-shared.jsx round-5/mobile-shared.jsx     # 无差异
$ diff -q round-4/mobile-today.jsx round-5/mobile-today.jsx       # 无差异
$ diff -q round-4/mobile-screens.jsx round-5/mobile-screens.jsx   # 无差异
$ diff -q round-4/mobile-notifications.jsx round-5/mobile-notifications.jsx  # 无差异
$ diff -q round-4/Meeting\ Room.html round-5/Meeting\ Room.html   # 无差异
$ diff -q round-4/meeting-room.jsx round-5/meeting-room.jsx       # 无差异
```
唯一移动端差异: `Mobile App.html` 加 `animationFillMode: 'forwards'`. 这是 round-4 chat 里就提到的 fadeIn fix.

**B. chat2 文件从 916 → 1678 行 (新增 762 行)**
增量内容全部是 Web 端: 用户在 round-4 mobile 收尾后说:
> "现在我要开始优化 web 端了，你原来已经做了 web 端的会议室界面，现在你根据对移动端的理解，加上我给你目前的 web 端的页面（我觉得非常不满意，首先逻辑混乱。操作别扭，而且有很多。完全没有考量的功能和设计），帮我做一次整体的升级。"

随后 7+ 轮迭代:
1. 决策对话(暗色 + 紫色科技色 + Vercel 风顶 nav + AI 专家市场首页 + 对话式发现)
2. 首页 (Home) 落地
3. 工作站 (Workstation) 落地
4. 工作站 → AI 专家详情 (BrainRadar + BrainGraph)
5. 工作站 → 会议详情 (6 tabs)
6. 工作站 → 全景血缘图 v1 → 用户嫌简单 → V2 D3 力导向 + 技术契约
7. AI 模板生成器
8. 全局明/暗主题切换
9. 会议室 ↔ 操作页 桥接 (Logo 化顶部 + 结束并返回首页)
10. 首页加 "你的会议" stats (LIVE / 即将开始 / 历史)
11. 首页 "你的会议" vs "AI 专家" 改横向 tab 切换
12. 全景血缘图 v2 (D3 + 技术契约)

### 1.3 跟 round-4 changelist 的关系

| Round-4 changelist 状态 | 仍然适用? |
|---|---|
| Saga A (浅色 + Today 大改 + 共享组件提层) | ✅ **已 ship** (commit 209fd01, 合并 main) |
| Saga B (次级 mobile tab 浅色 + Glow Banner) | ⏸ 仍然暂停 — round-5 没改 mobile, 设计稿同样 |
| Saga C (MemoryRadar 雷达图) | ⏸ 仍然暂停 — round-5 没改 mobile |
| Saga D (mobile 二级页浅色化) | ⏸ 仍然暂停 — round-5 没改 mobile |

**所以本 round-5 Saga 不替换 B/C/D, 也不替换 当前 v1.3.1 权限对齐 Saga**. 是 4 个并行轨道.

---

## 2. Bundle 文件清单 (新增 Web 文件)

### 2.1 入口 HTML (2)

```
Web Home.html                    ← Vercel 风顶 nav + 首页主体
Web Workstation.html             ← 顶 nav + 左 sidebar (12 项) + 7 个 pane
```

两个 HTML 都在 `<head>` 注入了**完整的 CSS variable 主题系统** (dark + light), `localStorage.w-theme` 持久化, inline 脚本零闪烁切换.

### 2.2 JSX 模块 (8 个, 7362 行)

| 文件 | 行数 | 用途 | 暴露给 window 的组件 |
|---|---:|---|---|
| `web-shared.jsx` | 567 | 设计系统 + 数据 + 原子组件 | `W_TOKENS / W_AGENTS / W_HUMANS / W_CATEGORIES / W_DISCOVERY_EXAMPLES` + `WAIBadge / WAvatar / WIcon / WPill / WButton / WCard / WSection / WPage / WTopNav / WModal` |
| `web-home.jsx` | 1159 | 首页 (AI 市场 + 对话发现 + 会议 tab) | `WebHome` |
| `web-workstation.jsx` | 1142 | 工作站 + 7 pane + 路由 | `WebWorkstation` |
| `web-agent-detail.jsx` | 941 | AI 专家详情 (脑内地图) | `AgentDetail / W_PROFILES` |
| `web-meeting-detail.jsx` | 840 | 会议详情 6 tabs | `MeetingDetail` |
| `web-template.jsx` | 713 | AI 模板生成器 | `TemplateGeneratorPane` |
| `web-lineage-v2.jsx` | 907 | 全景血缘 V2 (D3) | `LineagePane` (覆盖 v1) |
| `web-extras.jsx` | 1093 | Lineage v1 + 新建会议 + 看板 + 审批 | `LineagePane / NewMeetingPane / DashboardPane / ApprovalPane` |

### 2.3 PM 在 chat2 的关键 quotes (产品 intent)

按时序:

1. **"现在我要开始优化 web 端了... 我觉得非常不满意，首先逻辑混乱。操作别扭，而且有很多。完全没有考量的功能和设计"** → 整个 Web 重做的起点, "翻盘式"重写
2. **决策对话 (theme: 深色 + 紫色 / core_user: 会议进行 / main_nav: 顶部水平 / homepage: AI 专家市场)** → 整体调性敲定
3. **"在首页点击专家的卡片应该是弹窗显示专家的详情... 这样的跳转很割裂. 首页应该可以直接开始会议, 而不是需要在工作台里面才能新建会议"** → AgentQuickModal + 首页直接开会
4. **"长期记忆和知识库这块需要花点设计精力... 通过雷达图和关系图的方式呈现"** → BrainRadar (6 axes 双多边形 kb/mem 重叠) + BrainGraph (4 类节点 + 3 类语义边)
5. **"现在开始 AI 模板生成器的设计, 这里是希望用户直接提出他的想法和诉求, 然后由我们通过 LMM 进行拆解"** → TemplateGeneratorPane 4 步流程 (描述 → 拆解动画 → 提案 → 创建)
6. **"这个项目全局设置一个暗夜模式和明亮模式, 之前设计的会议室就是明亮模式（会议室不需要暗夜模式）"** → CSS variable theme + 顶 nav toggle + Meeting Room 永远 light. **重要: 双主题系统**.
7. **"会议室返回操作页面及操作页面进入到会议室的路口... 这两部分页面是割裂的"** → Meeting Room 顶部 Logo 化面包屑 + "结束并返回首页"
8. **"首页看不出有多少个会议在召开和召开过多少历史会议... 在首页出现, 一目了然"** → 首页 stats (LIVE 1 / 今日 2 / 历史 24) + LIVE 大卡 + 双侧栏
9. **"首页的「你的会议」与「AI 专家」应该是横向的并列关系，或者说切换关系. 而不是上下关系"** → 首页两张大 tab 卡横向切换
10. **"全景血缘图我看目前还是太简单了... 请深化, 并且也要说明清楚用什么样的前端技术方案去实现, 方便 Claude Code 照着前端的代码去匹配后台逻辑"** → Lineage V2 D3 force + **完整 backend API contract 文档 (TypeScript 签名)**
11. **"首页标题「让会议拥有记忆与专家」改成「让会议拥有超脑与灵魂」"** → 文案 polish

### 2.4 PM 在 chat 里直接选定的"对齐 6 个关键问题"答案 (questions_v2 工具)

```
- theme: 深色 + 紫色作为科技色（沿用「灵光一现」语言到桌面)
- core_user: 会议进行（像 Zoom 一样开会、实时字幕、AI 参会）
- main_nav: 顶部水平 nav（类 Vercel / Stripe Dashboard）
- homepage: AI 专家市场（浏览 + 召唤，把「开会」放副位置)
- scope: 全部都要
- mental_model: 保留，做得更精致（因为这是产品的核心心智，必须 OnBoarding 时强调）
- ai_market: 做成对话式发现（「告诉我你要解决什么，我帮你召唤合适的专家」)
- my_tasks: 三段制：等你处理 / 跟踪中 / 已完成（像移动端）
- tweakable: 先做首页 + 工作站 2 个核心页，看效果再扩展
- platform_admin: 也重做（沿用同套设计语言)
```

这 10 个 决策**全部落到** 当前设计稿. 落地实施时不要再问 PM, 直接遵循.

---

## 3. 跟 round-4 v1 主要 diff

**Mobile 端: 0 行差异.** 见 § 1.2.A.

**Web 端: 新增 ~7362 行 JSX, 跨度 8 个核心页面**. round-4 没有任何 Web 文件 (只有 `Meeting Room (Web).html` 用于桌面会议室, 跟当前 round-5 的 `Meeting Room (Web).html` 也 identical).

---

## 4. 跟当前已实施 (main / Saga A) 主要 diff

### 4.1 已实施 (main 上)

- Mobile 端 `/m` today + 共享组件浅色化 (Saga A) — round-4 mobile 设计稿的一部分
- 会议室相关 (meeting-room-v2, 浅色 iOS) — round-3
- 总结页 P4 浅色 — round-3 接续
- Web 端**完全没动** — 是 v0 旧 dark Tailwind UI

### 4.2 Web 端要 redo 的清单 (按目录列)

| 当前文件 | 状态 | round-5 设计对应 |
|---|---|---|
| `frontend/src/app/page.tsx` (565 行) | 旧 (登录/导航 hub) | **完全重做** → `WebHome` (1159 行) |
| `frontend/src/app/dashboard/page.tsx` (885 行) | 旧 (老看板) | **重做或废弃** → 工作站 `DashboardPane` |
| `frontend/src/app/dashboard/{ask,kanban-*,trends,reports}` | 旧 | 大部分**废弃**, 数据看板汇入 `#board` |
| `frontend/src/app/meetings/page.tsx` (138 行) | 旧 | 由首页 + 工作站 sidebar `#meeting/q3-roadmap` 替代 (会议历史挪去工作站) |
| `frontend/src/app/meeting/[id]/...` | 旧 | **重做** → `MeetingDetail` (6 tabs 含 AI 引用) |
| `frontend/src/app/meetings/new/page.tsx` | 旧 | **重做** → `NewMeetingPane` (左表单 + 右 Mira 会前检查) |
| `frontend/src/app/admin/agents/page.tsx` (5 行 stub) | 几乎空 | **新建** → `AgentsPane` (16 张管理卡 + 模板生成器入口) |
| `frontend/src/app/admin/knowledge/page.tsx` (5 行 stub) | 几乎空 | **新建** → `KBPane` (6 KB 卡片 + 文档数/分块) |
| `frontend/src/app/admin/memory/page.tsx` | 存在但旧 | **新建** → 工作站 `#memory` (长期记忆 pane) |
| `frontend/src/app/super/page.tsx` (540 行) | 旧 超管 | **重做** → `AdminPane` (8 行 8 列租户表 + 警告 banner) |
| `frontend/src/app/admin/*` (cron-rules / access-requests / audit / models / team / asr-vocabulary / document-audit / demo-data) | 旧, 各种独立 page | 大部分**汇入工作站** sidebar 或保留 (本 Saga 不动) |
| `frontend/src/app/me/page.tsx` | 旧 | **重做** → 工作站 `#profile` `ProfilePane` (用户卡 + 声纹库) |
| `frontend/src/app/task/[id]/...` | 旧 | 暂保留 (本 Saga 不重做) |
| `frontend/src/app/chat/...` | 旧 chat UI | 暂保留 (跟 Web 重做不冲突) |
| `frontend/src/app/{login,register,enroll,forgot-password,reset-password,messages,privacy}` | 旧 | 暂保留 (auth 流不在本 Saga) |

### 4.3 跟 Saga A 已实施的关系

Saga A 是**纯 Mobile**, **没动 Web**. 因此 round-5 跟 Saga A **零交集**, 可以独立并行.

唯一潜在交集: **MobileShell vs Web 顶层 layout** —— 全局 `app/layout.tsx` 可能需要分流 (`/m/*` 沿用 mobile + light, `/*` 用 web + theme toggle). 需要确认 `frontend/src/app/layout.tsx` 当前状态.

### 4.4 跟 v1.3.1 权限对齐 Saga 的关系

v1.3.1 在**改角色名 + backend API** (workspace_creator / agent_owner). round-5 设计稿里也大量 reference 这些角色 ("Owner" pill, agent owner 字段). 没有冲突 — 但**实施 round-5 时**:
- 用 v1.3.1 落地后的 role names
- "byMe: true" 在 design 里对应"我管理的 AI" = `agent_owner_id === me`
- 不要回滚或绕过 v1.3.1 改动

---

## 5. 按页面 diff 概况

### 5.1 / (Web 首页) — **完全重做**

**当前**: `frontend/src/app/page.tsx` (565 行) — 旧导航 hub 或登录页 (需确认具体内容)

**新设计**: `web-home.jsx` (1159 行)

#### 核心结构

```
WTopNav (固定顶 nav, blur + theme toggle + bell + user)
└─ Container 1140 wide
   ├─ Hero (大紫渐变标题"让会议拥有 超脑与灵魂" + 飘浮星点)
   ├─ DiscoveryBox (对话式发现框)
   │   ├─ Mira 引导文案
   │   ├─ 大输入框
   │   ├─ 3 个示例 chip (roadmap / complaint / compliance)
   │   └─ 点 chip / 回车 → 三步动画 (理解问题 → 挑选专家 → 拟定议程)
   │       └─ 1.4s 后呈现: 召唤的 3 位 AI + 议程 + "立即开始" CTA
   ├─ HomeTabs (横向 tab 卡)
   │   ├─ "你的会议" tab (默认激活)
   │   │   ├─ 3 stats: LIVE 1 / 今日 2 / 历史 24
   │   │   ├─ 左大卡 LIVE meeting (进度条 + Mira 摘要 + "立即加入")
   │   │   └─ 右栏: 即将开始 + 最近纪要
   │   └─ "AI 专家" tab
   │       ├─ 9 个类目快切
   │       ├─ 最热/最新 切换 + 实时搜索
   │       └─ 16 张 AI 卡 (头像 + 名 + 外号 + 领域 + 标签 + 简介 + 召唤次数)
   │           └─ 点卡 → AgentQuickModal 弹窗 (不跳转)
   └─ Footer
```

#### DIFF-NEW (新设计有, 现在没有)
- 整个**对话式发现** UX (chip → 拆解动画 → 召唤结果)
- 整个 **AI 专家市场** (16 个角色 + metadata + 类目过滤 + 搜索)
- 整个 **AgentQuickModal** (弹窗预览, 替代跳转)
- 整个 **WTopNav theme toggle** (月亮/太阳)
- **首页 stats 区** (LIVE / 今日 / 历史)
- **首页直接开会路径** ("空白会议" + "立即开始这场会议")

#### 估算工作量: **大改 ~16-20 小时**
- 重写 page.tsx 主体 (~6-8h)
- DiscoveryBox 拆解动画 + 召唤结果 (~3-4h)
- AgentMarketGrid + AgentQuickModal (~4-5h)
- 16 个 AI 专家 metadata + 数据契约 (~2-3h, 应该来自 backend)

#### 影响跨页组件
- 必须先建 `web-shared` 等价物 (atoms + tokens + theme) — 见 § 5.8

---

### 5.2 /workstation (工作站) — **完全新建** (路径不存在)

**当前**: 不存在 `frontend/src/app/workstation/`. 现有 `/dashboard` 是老的, 不一样.

**新设计**: `web-workstation.jsx` (1142 行)

#### 核心结构

```
WTopNav
└─ Container with sidebar
   ├─ Sidebar (left, 232 wide, sticky)
   │   ├─ 总览: 心智模型 / 数据看板
   │   ├─ 我: 身份信息 / 我的任务 (badge 3)
   │   ├─ 会议: 新建会议 / Q3 路线图对齐 (具体会议)
   │   ├─ 我的 AI 团队: 卡片浏览 / 专家管理 / 模板生成
   │   ├─ 知识与经验: 知识库 / 长期记忆 / 全景血缘图 / 审批中心 (badge 5)
   │   └─ 平台: 平台超管
   └─ Main pane (路由切换)
       ├─ #mental → MentalModelPane (hero + 4 quick cards)
       ├─ #board → DashboardPane (数据看板)
       ├─ #profile → ProfilePane (用户卡 + 声纹库)
       ├─ #tasks → TasksPane (Mira priority banner + 三段制)
       ├─ #new → NewMeetingPane (左表单 + 右 Mira 会前检查 sticky)
       ├─ #meeting/<id> → MeetingDetail (6 tabs)
       ├─ #browse → BrowsePane (AI 卡片浏览, 同首页风格)
       ├─ #agents → AgentsPane (AI 专家管理 16 张卡 + 启用 dot + 我管理 pill)
       ├─ #tpl → TemplateGeneratorPane (AI 模板生成器)
       ├─ #kb → KBPane (6 KB cards)
       ├─ #memory → MemoryPane (紫色 banner + 3 filter + 6 条记忆)
       ├─ #graph → LineagePane (= LineagePaneDeep, V2 D3)
       ├─ #approve → ApprovalPane (紫 banner + 候选/权限/跨域三类)
       ├─ #agent/<id> → AgentDetail (脑内地图 BrainRadar + BrainGraph)
       └─ #admin → AdminPane (8 行租户表)
```

**hash 路由切换**, `window.location.hash` 驱动. 刷新保留位置.

#### DIFF-NEW (绝大部分都是新的)

新增**整套**:
- 整个 `/workstation` 路径
- Sidebar (6 段 12 项, badge 支持)
- Hash 路由系统 (Next.js App Router 下需要客户端 hashchange 监听)
- 14 个 pane (心智模型 / 数据看板 / 身份 / 任务 / 新建会议 / 会议详情 / 卡片浏览 / 专家管理 / 模板生成 / 知识库 / 长期记忆 / 全景图 / 审批 / 超管)

#### DIFF-WRONG (相关现有页面 → 工作站子 pane)
- `frontend/src/app/me/page.tsx` → `#profile`
- `frontend/src/app/admin/agents/page.tsx` (stub) → `#agents`
- `frontend/src/app/admin/knowledge/page.tsx` (stub) → `#kb`
- `frontend/src/app/admin/memory/page.tsx` → `#memory`
- `frontend/src/app/super/page.tsx` → `#admin`
- `frontend/src/app/meetings/new/page.tsx` → `#new`
- `frontend/src/app/meeting/[id]/...` → `#meeting/<id>`

#### 估算工作量: **超大改 ~50-70 小时** (工作站本身是骨架, 各 pane 单独算)

骨架部分:
- `/workstation/page.tsx` + Sidebar + hash 路由 (~6h)
- MentalModelPane + hero + quick cards (~3-4h)

每个 pane 单独估算见各小节.

---

### 5.3 /workstation#agent/<id> (AI 专家详情 — 脑内地图)

**当前**: 不存在专家详情页. `admin/agents/page.tsx` 只有 5 行 stub.

**新设计**: `web-agent-detail.jsx` (941 行)

#### 核心模块

- **AgentHero**: 72px 大渐变头像 + 名 + 外号 + 启用 dot + intro + 标签 + 5 stats (召唤/采纳率/记忆/书架/会议) + 编辑人格 + 邀请到会议
- **BrainRadar (能力雷达)** — 自定义 SVG:
  - 6 axes 按每位 AI 定制 (e.g. SHU: 工单数据 / 业主满意度 / 物业费收缴 / 维修资金 / 行业基准 / 报表能力)
  - 双多边形重叠: 🔵 书架知识 (cyan) + 🟣 长期记忆 (purple)
  - axis 标签下显示 `kb / mem` 双数字
  - legend 可切 `✓ 书架知识 39` `✓ 长期记忆 50`
- **BrainGraph (知识图谱)** — 自定义 SVG:
  - 中心 AI 发光节点
  - 左半弧: 🟦 KB 文档 (方块)
  - 右半弧: 🟣 长期记忆 (圆)
  - 下半弧: 🩷 会议 (六边形)
  - 3 种连接线: extract (cyan 实) / cite (purple 虚) / create (pink 实)
  - 悬停高亮关联 + 底部信息条
- **脑内明细 3 tabs**: 长期记忆 / 书架 / 会议
- **W_PROFILES**: 3 位 AI 全量精细 profile (SHU / ARIA / FALAO), 其它 13 位 generic shell

#### 估算工作量: **大改 ~16-22 小时**
- BrainRadar SVG (~5-6h, 复用 mobile MemoryRadar 思路但 6 轴自定义)
- BrainGraph SVG (~5-7h, 自定义 layout + 悬停高亮)
- AgentHero + 3 tab list (~3-4h)
- W_PROFILES 数据建模 (~3-5h, 跟 backend 商定 agent profile 字段)

#### [BACKEND-NEEDED]
- `GET /api/agents/<id>/brain`:
  ```ts
  {
    agent: { id, name, nick, ... },
    stats: { summonCount, adoptRate, memCount, kbCount, meetingCount },
    axes: Array<{ id, label, kb: number, mem: number }>,  // 6 个, AI 自定义
    knowledge: Array<{ id, name, type, pages, chunks, cited, updated }>,
    memories: Array<{ id, text, citedCount, sourceMeeting, createdAt }>,
    meetings: Array<{ id, title, when, role }>,
    edges: {
      extract: Array<{ kb: string, mem: string }>,   // KB→记忆
      cite:    Array<{ mem: string, meeting: string }>,  // 记忆→会议
      create:  Array<{ meeting: string, mem: string }>,  // 会议→新记忆
    }
  }
  ```

---

### 5.4 /workstation#meeting/<id> (会议详情)

**当前**: `frontend/src/app/meeting/[id]/page.tsx` (路径已存在, 内容未读)

**新设计**: `web-meeting-detail.jsx` (840 行)

#### 6 tabs

1. **概览** — summary + decisions/actions/citations 三 QuickList
2. **字幕** — transcript timeline (复用 meeting-room 数据)
3. **决策** — DecisionList
4. **行动项** — ActionList
5. **资料** — 4 文件类型 (PDF/Word/Excel/PPT)
6. **AI 引用** — 双栏对照 (AI 当时说 ↔ 引用了什么 + 跳回 AgentDetail "被引用 X 次" 闭环)

#### DIFF-NEW
- **AI 引用 tab** — 跟 AgentDetail 双向链接, 这是 round-5 的核心闭环
- 6 tabs 而非现有的"详情/转录/纪要" 简单 tab
- meta 含 `summaryStats: { decisions, actions, citations, memoriesCreated }`

#### 估算工作量: **大改 ~14-18 小时**
- 会议详情骨架 + 6 tab routing (~3h)
- 概览 tab + summaryStats hero (~3-4h)
- 字幕 / 决策 / 行动项 / 资料 tabs (~5-6h)
- AI 引用 tab 双栏 + 跳跳逻辑 (~3-4h)

#### [BACKEND-NEEDED]
- meeting detail API 已有, 但需要补 `citations` 字段:
  ```ts
  {
    ...meeting,
    citations: Array<{
      aiId: string,
      aiText: string,
      sourceType: 'kb'|'memory',
      sourceId: string,
      sourceName: string,
      sourcePage?: number,
    }>
  }
  ```

---

### 5.5 /workstation#new (新建会议)

**当前**: `frontend/src/app/meetings/new/page.tsx`

**新设计**: `web-extras.jsx` 中 `NewMeetingPane`

#### 结构
- **左**: 表单 (标题 / 时间 / 议程 / 参会人 / AI 阵容)
- **右**: Sticky **Mira 会前检查卡** — 实时摘要 + AI 阵容预览 + "开始会议" 大紫按钮 → 跳 `Meeting Room (Web).html`

#### 估算工作量: **中改 ~8-12 小时**

---

### 5.6 /workstation#board (数据看板)

**当前**: `frontend/src/app/dashboard/page.tsx` (885 行) + 子页 ask/kanban-*/trends/reports

**新设计**: `DashboardPane` (在 `web-extras.jsx`)

#### 结构
- 4 hero 大数字 (会议/AI 唤醒/决策/记忆)
- 趋势 bar chart
- AI 排行
- 记忆增长曲线
- KB/记忆 donut

#### DIFF-EXCESS
- 现 dashboard 子页 (ask / kanban-users / kanban-agents / trends / reports) 是否全保留? 还是汇入单个 `#board`?

#### 估算工作量: **中改 ~10-14 小时**

---

### 5.7 /workstation#graph (全景血缘图 V2 — D3 力导向 + 技术契约)

**当前**: 不存在.

**新设计**: `web-lineage-v2.jsx` (907 行) — **PM 重度关注**, 带完整 backend API contract.

#### 核心
- **D3 force simulation** (`d3@7` CDN, 400 tick 预跑到稳态)
- **4 类节点**: agent (大渐变圆 + glyph) / kb (青方块) / memory (紫圆) / meeting (粉六边形). 大小 ∝ 引用次数
- **6 类边**: owns / has / participate (淡虚) / extract (cyan 实) / cite (purple 虚) / create (pink 实)
- **3 栏布局**: 左 filter (单选 AI + 边类型 toggle) / 中图 / 右详情面板
- **交互**: 悬停高亮 / 点击 focus / 缩放 / 重置

#### Backend API contract (PM 已经写好, 直接复用)

```ts
GET /api/workspace/:id/lineage  →  { nodes: Node[], edges: Edge[] }

Node = {
  id: string,
  type: 'agent'|'kb'|'memory'|'meeting',
  label: string,
  parent_agent?: string,
  meta: {
    sum?:    number,
    text?:   string,
    pages?:  number, chunks?: number,
    when?:   string,
    attendees?: string[],
  }
}

Edge = {
  source: string, target: string,
  kind: 'owns'|'has'|'extract'|'cite'|'create'|'participate',
  weight?: number,
}
```

#### 渲染层推荐顺序 (PM 写在代码注释里, 直接执行)
1. **react-flow** (production 首选, drop-in)
2. **d3-force 自定义 React** (本演示采用, 自定义度最高)
3. **Cytoscape.js** (>1000 节点)
4. **Sigma.js WebGL** (>10000 节点)

#### 估算工作量: **大改 ~16-22 小时**
- react-flow 接入 + 节点类型 + 边类型 (~6-8h)
- 3 栏布局 + filter + 详情面板 (~3-4h)
- backend API + 数据合成 (~4-6h backend, 取决于现有数据模型)
- 交互打磨 (悬停 / 缩放 / 重置 / 跨节点 focus) (~3-4h)

#### [BACKEND-NEEDED]
- `GET /api/workspace/:id/lineage` — **全新接口**. 必须遍历:
  - 所有 agents → owns(kb), has(memory)
  - 所有 KB chunks → extract(memory)
  - 所有 memory → cite(meeting)
  - 所有 meeting → create(memory), participate(agent)
- 估计后端 ~6-10 小时

---

### 5.8 /workstation#tpl (AI 模板生成器)

**当前**: 不存在.

**新设计**: `web-template.jsx` (713 行)

#### 4 步流程
1. 描述场景 + chip + 设置 (期望专家数 2-6 + 模式 全新/增补)
2. 拆解动画 ~2.2s (5 步 progress)
3. 团队提案 (顶部紫 rationale banner + 多张 AI 卡 stagger 入场 + 展开三栏: 人格 / 种子知识 / 种子记忆)
4. sticky 底部 action bar ("创建 N 位 AI")

#### 估算工作量: **大改 ~14-18 小时**
- 4 步骨架 + 动画 (~4-5h)
- AgentProposalCard 三栏展开 (~5-6h)
- 3 个 preset 场景数据 (~2-3h, 应该 backend driven)
- LLM 拆解 API 接入 (~3-4h, **[BACKEND-NEEDED]**)

#### [BACKEND-NEEDED]
- `POST /api/agents/template-generate`:
  ```ts
  request: { prompt: string, expertCount: number, mode: 'new'|'augment' }
  response: {
    rationale: string,
    agents: Array<{
      name, nick, domain, glyph, grad, tags, intro,
      seedKB: Array<{ name, type, pages }>,
      seedMem: string[],
    }>
  }
  ```
- 估计后端 ~6-10 小时 (用现有 LLM provider)

---

### 5.9 /workstation#approve (审批中心)

**当前**: `admin/access-requests/page.tsx` 局部有, 但形态不同

**新设计**: `ApprovalPane` (在 `web-extras.jsx`)

#### 结构
- 紫 Mira banner
- 三类: 候选记忆 / 权限申请 / 跨域引用
- 每项: 优先级红条 + 类型 chip + 描述 + 双 CTA

#### 估算工作量: **中改 ~8-10 小时**

---

### 5.10 /workstation#admin (平台超管)

**当前**: `frontend/src/app/super/page.tsx` (540 行)

**新设计**: `AdminPane` (在 `web-workstation.jsx`)

#### 结构
- 暗红警告 banner
- 8 行 × 8 列 租户表格 (workspace 列表)

#### 估算工作量: **中改 ~6-10 小时** (super page 已经 540 行, 视觉换肤为主)

---

## 6. 跨页 / 共享组件

### 6.1 设计系统层 — **完全新建 `frontend/src/components/web/`**

#### 6.1.1 W_TOKENS / CSS variable theme system

新增 `frontend/src/styles/web-theme.css` (或在 `globals.css` 加):

```css
:root {
  --w-bg: #0a0a12;
  --w-surface: #13131c;
  --w-text: #fafafc;
  --w-accent: #7C5CFA;
  --w-accent-grad: linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%);
  ...
}
:root[data-theme="light"] {
  --w-bg: #f4f4f8;
  --w-surface: #ffffff;
  ...
}
```

+ inline script in `app/layout.tsx` 读 `localStorage.w-theme` 设 `data-theme`.

#### 6.1.2 原子组件 (`frontend/src/components/web/atoms/`)

新建:
- `WAIBadge` (AI 渐变方形头像 + glyph, 40px default)
- `WAvatar` (真人圆头像 + initials)
- `WIcon` (lucide-style 30+ stroke SVG icons)
- `WPill` (7 tone × 2 size)
- `WButton` (4 variants: primary 紫渐变 / ghost / outline / danger)
- `WCard` (含 hover + padding prop)
- `WSection` (eyebrow + title + sub)
- `WPage` (顶级容器, 含 1140 max-width)
- `WTopNav` (固定 blur 顶 nav + theme toggle + bell + user)
- `WModal` (居中弹窗 + backdrop + 240ms cubic-bezier)

#### 6.1.3 估算工作量: **大改 ~20-26 小时**
- CSS variable theme 系统 + light/dark + zero-flash (~4-5h)
- 10 个原子组件 + 30+ icons (~12-16h)
- TypeScript 类型 + Storybook (可选) (~4-5h)

#### 6.1.4 [STYLE-DEVIATION]
- Web 暗紫 vs Mobile 浅 iOS 是**完全不同的双套设计系统**. 需要在 `DESIGN_SYSTEM.md` 新增 § 0.3 "Web 端紫色暗夜系统" 章节, 跟 § 0.1 "Mobile 浅 iOS" 平级.
- 主 Agent 实施前必须更新 `DESIGN_SYSTEM.md`.

### 6.2 顶级 layout (`frontend/src/app/layout.tsx`)

需要分流逻辑: `/m/*` 用 mobile shell + light, `/*` (除 `/m/*` 外) 用 web shell + theme toggle.

#### 估算工作量: **小改 ~2-4 小时**

### 6.3 Theme toggle 接到 `localStorage`

新增 `useWebTheme()` hook. 在 `WTopNav` 里用.

---

## 7. Scope 评估总表

| 改动级别 | 涉及 | 估算 | 备注 |
|---|---|---|---|
| **设计系统 + atoms** (大改) | W_TOKENS / CSS variable theme / 10 个原子 + 30 icons | 20-26h | 必须先做 |
| **首页 (大改)** | / 完全重做 | 16-20h | |
| **工作站骨架 (大改)** | /workstation + Sidebar + hash 路由 + MentalModel | 8-10h | |
| **专家详情 (大改)** | #agent/<id> BrainRadar + BrainGraph | 16-22h | + backend ~8h |
| **会议详情 (大改)** | #meeting/<id> 6 tabs + AI 引用闭环 | 14-18h | + backend ~4h |
| **全景血缘 V2 (大改)** | #graph D3 + API contract 落地 | 16-22h | + backend ~8h |
| **模板生成器 (大改)** | #tpl 4 步流程 + LLM | 14-18h | + backend ~8h |
| **新建会议 (中改)** | #new | 8-12h | |
| **数据看板 (中改)** | #board | 10-14h | + dashboard 子页迁移决策 |
| **审批中心 (中改)** | #approve | 8-10h | |
| **超管 (中改)** | #admin | 6-10h | |
| **专家管理 (中改)** | #agents 16 张卡 | 6-8h | |
| **KB / Memory (中改)** | #kb #memory | 8-12h | |
| **AgentQuickModal (小改)** | 弹窗组件 | 3-4h | |
| **AI 卡片浏览 (小改)** | #browse (跟首页类同) | 4-6h | |
| **身份信息 (小改)** | #profile | 4-6h | |
| **我的任务 (小改)** | #tasks | 4-6h | |
| **Theme toggle layout (小改)** | layout.tsx | 2-4h | |
| **总计** | | **~167-228 小时** | 单人, **3-5 周** |

**Backend 增量**: ~30-40 小时 (4 个新接口 + 现有接口补字段)

---

## 8. 优先级建议 (PM 拆 Saga 用)

### **P0 — 必做 (~60-70 小时)**
**子 Saga R5.A · "Web 设计系统 + 首页 + 工作站骨架"**
- W_TOKENS + CSS variable theme (light/dark)
- 10 原子组件 + 30 icons → `frontend/src/components/web/atoms/`
- `/workstation/page.tsx` 骨架 + Sidebar + hash 路由 + MentalModelPane
- `/` (首页) 完全重做 → DiscoveryBox + HomeTabs + AgentMarketGrid + AgentQuickModal
- `app/layout.tsx` 分流 (`/m/*` vs `/*`)
- `DESIGN_SYSTEM.md` 加 § 0.3 Web 紫色暗夜系统

**交付价值**: PM 可以看到首页 + 工作站门面, 后续 pane 逐步填充.

### **P1 — 强建议 (~60-80 小时)**
**子 Saga R5.B · "工作站核心 pane"**
- #agent/<id> AgentDetail (BrainRadar + BrainGraph) + backend `/api/agents/<id>/brain`
- #meeting/<id> MeetingDetail 6 tabs + backend citations 字段
- #graph LineagePane V2 (react-flow + D3 fallback) + backend `/api/workspace/<id>/lineage`
- #tpl TemplateGeneratorPane + backend `/api/agents/template-generate`

**交付价值**: 完成 round-5 的"灵魂功能"—— 脑内地图 + 全景血缘 + AI 模板.

### **P2 — 可选 (~30-40 小时)**
**子 Saga R5.C · "工作站辅助 pane"**
- #new NewMeetingPane (Mira 会前检查)
- #board DashboardPane + 决策 dashboard 子页是否迁移
- #approve ApprovalPane
- #admin AdminPane (重做 super page)
- #agents AgentsPane (16 张管理卡)
- #kb / #memory / #browse / #profile / #tasks

### **P3 — 跟随 (后续 Saga)**
**子 Saga R5.D · "会议室 Web 集成 + 跨页跳转打磨"**
- 现有 `Meeting Room (Web).html` 设计稿挪到 `/meeting/<id>` 实施 (round-3 设计稿延续)
- 顶部 Logo 化面包屑 + "结束并返回首页" UX
- 4 个跨页跳转闭环测试 (首页空白会议 → 会议室 / 工作站新建 → 会议室 / 顶 nav 会议 → 会议室 / 会议室结束 → 首页)

---

## 9. [BACKEND-NEEDED] 标记 (本 Saga 总和)

按重要性:

### 9.1 `GET /api/workspace/<id>/lineage` (P1 必需)
全景血缘图 V2 的核心. PM 已经在代码注释里写好 TypeScript contract, 后端按 contract 实施即可. 见 § 5.7.

### 9.2 `GET /api/agents/<id>/brain` (P1 必需)
AI 专家脑内地图 (radar + graph) 需要. 见 § 5.3.

### 9.3 `POST /api/agents/template-generate` (P1 必需)
AI 模板生成器调用 LLM. 见 § 5.8.

### 9.4 `meeting.citations[]` 字段 (P1 必需)
会议详情 "AI 引用" tab 需要. 现有 meeting detail API 补字段. 见 § 5.4.

### 9.5 workspace stats (P0 可选, 也可前端推导)
首页 stats (LIVE 1 / 今日 2 / 历史 24) 需要 workspace-level counts. 现有 workbench API 已有大部分, 补 `meetings.history_count` 即可.

### 9.6 模板生成 LLM provider (P1)
按现有 LLM 接入 (Doubao / DeepSeek / GLM), 不引入新供应商.

---

## 10. [STYLE-DEVIATION] 风险点 — 主 Agent 跟 PM 沟通

### R1 · 双套设计系统 (Mobile 浅 iOS vs Web 暗紫)

**事实**: PM 明确"会议室不要暗色"+"其他全部暗 + 紫色科技色". Mobile = 浅色 iOS (`#F2F2F7` + `#007AFF`), Web = 暗夜紫 (`#0a0a12` + `#7C5CFA`). 这是**两套不同的 brand language**.

**决策点**:
- (a) **PM 确认双系统** — Web 暗 / Mobile 浅 / 会议室浅 / 微信小程序浅. `DESIGN_SYSTEM.md` 必须分章节. **推荐 (a)**.
- (b) **统一一套** — 跟设计稿冲突, **不推荐**.

### R2 · Web theme toggle (light/dark)

设计稿在 Web 主体支持 `localStorage.w-theme` 切换. 但 PM 在 chat 里同时强调"会议室不需要暗色, 永远是 light". 实施时:
- `Meeting Room (Web)` 强制 light, 不走 theme variable
- 其他 Web 页跟 theme toggle 走

**决策**: 实施细节, 按设计稿. 但**会议室 Web 实施时, 跟 round-4 mobile 浅色一致**, 不要走 theme toggle.

### R3 · /dashboard 老子页 (ask / kanban-* / trends / reports) 命运

工作站 #board 是新设计的数据看板, 跟现有 `dashboard/page.tsx` (885 行) + 5 个子页**不重叠**. 决策:
- (a) **全部废弃** (推荐, 简化)
- (b) **保留 + 链接** (旧 ask/kanban 仍然能用)
- (c) **逐步迁移** (kanban 迁到 #board 子 view)

### R4 · /super 页 (540 行)

`super/page.tsx` 已经实现了一套老 admin 表格. 新设计的 `#admin` 是从 0 视觉化. 决策:
- (a) **重做** (跟新设计语言对齐, 推荐)
- (b) **仅换肤** (颜色 + token 切换, ~3h 但视觉撕裂)

### R5 · Hash 路由 vs Next.js App Router

Web Workstation 设计稿用 `window.location.hash` (`#mental` `#agent/<id>`) 切 pane. Next.js App Router 推荐用 `/workstation/[pane]`. 决策:
- (a) **完全 hash 路由** (跟设计稿一致, 但破坏 SSR)
- (b) **App Router /workstation/[pane]** (推荐, SSR + 深链 + SEO)
- (c) **混合**: 顶层用 App Router, pane 内子状态用 hash

**推荐 (b)** — 重要 pane 都用 dynamic route.

### R6 · AI 专家市场 — 16 个 hardcode vs backend workspace_agents

设计稿里 16 个 AI 是 hardcode (`W_AGENTS`). 实际 workspace 有自己的 agent 列表 (动态 backend). 决策:
- (a) **16 是示例, 落地用 backend agents** (推荐, 一致性)
- (b) **保留 16 个全局 AI + workspace 自定义 agent 单独 section**

### R7 · v1.3.1 权限对齐 落地后的 role 名

设计稿写 "Owner" (`W_USER.role = 'Owner'`). v1.3.1 实施后 role 名变 (`workspace_creator` 等). 实施时:
- 用 v1.3.1 落地后的 role names
- "byMe: true" → `agent_owner_id === me`
- 不要回滚

### R8 · D3 vs react-flow 实际选型

PM 在 lineage v2 注释里给的 推荐顺序: `react-flow > d3-force > Cytoscape > Sigma`. 实施时:
- **<= 1000 节点**: react-flow (production 首选)
- **设计稿本身**用 d3-force, 是因为 design 环境无 npm
- 落地代码: **react-flow** (Apache 2.0, 文档好, 内置 minimap/缩放)

**决策**: 落地用 react-flow, 不复刻 d3.

### R9 · 跟当前 v1.3.1 权限对齐 Saga 协同

v1.3.1 在主分支 `feature/permission-realignment` 持续推进 backend + UI 角色名. **本 round-5 实施时**:
- 等 v1.3.1 合并 main 再开始 (避免 merge 冲突)
- 或 round-5 在另一个 feature branch, rebase 跟 v1.3.1 同步

---

## 11. 跟现有 Saga 队列的协同建议

| Saga | 当前状态 | round-5 关系 |
|---|---|---|
| Saga A (mobile 浅色化 + Today 大改) | ✅ ship (commit 209fd01) | 0 交集, 不动 |
| round-4 Saga B (mobile 次级 tab Glow Banner) | ⏸ 暂停 | 不动, 后续可恢复 |
| round-4 Saga C (mobile MemoryRadar) | ⏸ 暂停 | 不动 |
| round-4 Saga D (mobile 二级页浅色) | ⏸ 暂停 | 不动 |
| v1.3.1 Saga · 权限对齐 | 🔄 in_progress | **必须先合并 main**, round-5 实施时用新 role names |
| meeting-room-v2 round-3 | ✅ ship | 0 交集 (Web 重做不动会议室) |
| **round-5 Web 整体重做** | 🆕 待批 | 平行新轨道, 拆 R5.A → R5.B → R5.C → R5.D 四批 |

**建议执行序**:
1. v1.3.1 权限对齐先合 main (1-2 周)
2. 然后启动 round-5 R5.A (设计系统 + 首页 + 工作站骨架, 1.5-2 周)
3. R5.B 核心 pane (2-3 周)
4. R5.C 辅助 pane (1-2 周)
5. R5.D Web 会议室集成 (1 周)

总周期: **~7-10 周** (单人, P0 + P1 范围).

如果 PM 想加速, 可并行: R5.A + v1.3.1 同步推进 (前者全部新代码不冲突), 但 R5.B 等 must wait for both.

---

## 12. PM 待对齐的关键决策 (7 个)

按重要性排序:

1. **R1 · 双套设计系统确认** — 必决, 决定`DESIGN_SYSTEM.md` 结构
2. **R5 · Hash 路由 vs App Router** — 必决, 决定 `/workstation/*` 整体架构
3. **R9 · 跟 v1.3.1 协同** — 必决, 决定启动时机
4. **本 round-5 是否替换 round-4 Saga B/C/D?** — 不替换 (mobile 设计稿没变), 仅延后
5. **是否引入 react-flow npm dep?** — 决定全景图实施
6. **dashboard 老子页命运** (R3)
7. **首页 16 个 hardcode AI vs workspace agents** (R6)

---

## 13. 建议主 Agent 怎么呈现给 PM

按这个顺序聊:

1. **明确判断**: 这是 round-5, 是**全新 Web 端重做**, mobile 完全没改 (跟 round-4 byte-identical).
2. **承认 round-4 mobile B/C/D 仍在暂停**, 没替换.
3. **强调双套设计系统**(R1)的产品决策意义 — Web 暗紫 / Mobile 浅 iOS / 会议室浅 iOS (都用过同一套渐变 token).
4. **抛 7 个决策** (§ 12), 重点 R1 / R5 / R9 三个 must-decide.
5. **建议 Scope 拆 4 个子 Saga** (R5.A → R5.B → R5.C → R5.D), 总 ~167-228h.
6. **建议执行序**: v1.3.1 先 merge → R5.A 启动 (单独建 feature branch).
7. **风险提示**: 工作量大, 单人 7-10 周; 建议跟 mobile round-4 B/C/D 暂时不并行做.

---

> 本文档**仅 review**, **未触动任何代码**.
> 所有 design 文件保留在 `/tmp/claude-design-round5/aimeeting/project/` 供后续 subagent 1:1 移植参考.
> 移动端文件已确认跟 round-4 byte-identical, 故 round-4 changelist (§ B/C/D) 仍有效, 不必重新 review.
