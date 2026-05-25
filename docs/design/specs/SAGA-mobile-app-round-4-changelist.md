# Saga · Mobile App round-4 · Review 清单

> 来源: Claude Design handoff `meP7dcG6W4bT65GBiOryRg` (2026-05-26)
> Bundle 解压路径: `/tmp/claude-design-round4/aimeeting/project/`
> 状态: **待 PM 对齐 scope + 批准实施 — 主 Agent 严禁先 coding**
>
> 完整 chat 记录: `/tmp/claude-design-round4/aimeeting/chats/chat1.md` + `chat2.md`

---

## 0. TL;DR

PM 在 Claude Design 里把**整个移动端 App** (5 主 tab + 通知中心) 按会议室浅色 iOS 设计语言重做了一遍, 并把"灵光一现"紫色调系统化抽出 `MAGlowBanner` 在每页都用. round-4 = **会议室 round-3 风格扩张到 4 个主 tab + 通知中心 + 一个全新功能 (记忆雷达图)**.

- **核心结论**: 这是 `[冲突 C1]` (浅色 vs 深色) 的**全面切换信号** — PM 已经在 design 里证明了"会议室浅色 + 主 tab 浅色"可以并存. 这次落地 = 把现有 dark UI **全部** 改为 light iOS 风.
- **大小**: 重写主 tab 4 个 + 通知页 1 个 + 新增 `MAGlowBanner` + 新增 `MemoryRadar` (SVG 雷达图) + 新增"专家视角"小手风琴 + 重做 BottomNav 视觉.
- **完全不动**: 会议室页 (已 P3 done) / 总结页 (已 P4 done) / 二级详情页 (agents/[id], tasks/[id], me/voiceprint, privacy 等 — 后续 Saga)
- **预估工作量**: ~60-80 小时 (单人) — **建议拆 3-4 个子 Saga**, 见第 5 节优先级
- **0 项后端需求** — 所有改动是纯前端视觉 + 一个 mock 雷达图数据, 现有 API contracts 全部兼容

---

## 1. 设计稿概览

### 1.1 Bundle 文件清单 (移动端相关)

```
/tmp/claude-design-round4/aimeeting/project/
├── Mobile App.html              ← 移动端入口 (iPhone 15 Pro 壳 + 5 tab + Notif sheet)
├── mobile-shared.jsx            ← 数据 + 原子组件 + MAGlowBanner + MABottomTabs (734 行)
├── mobile-today.jsx             ← 今日页 (TodayView + MeetView + ExpertView, 705 行)
├── mobile-screens.jsx           ← 会议 + 任务 + 记忆 + 我的 (994 行)
├── mobile-notifications.jsx     ← 通知中心 NotificationsSheet (347 行)
│
├── Meeting Room.html            ← 会议室 (已实施, round-3 done)
├── meeting-room.jsx             ← (round-3 done)
├── meeting-room-materials.jsx   ← (round-3 done)
├── meeting-room-shared.jsx      ← (round-3 done — 跟 mobile-shared 共享 AI 渐变 token)
└── ios-frame.jsx                ← iOS 壳 mock (不实施)
```

### 1.2 PM 在 chat2 里的关键 quote (产品 intent)

按 chat2 时序:

1. **"按照会议室的这版设计方案，把移动端的这些界面都重新设计一下"** → 整个 mobile app 浅色化, 跟会议室对齐
2. **"我觉得这个设计可以稍微大胆一点，目前这一版我觉得内容非常少，你可以适当的做一些延伸，特别是「今日」这个板块"** → 今日页大幅扩展, 不要 minimal, 要密集 + 信息层级丰富
3. **"banner 黑色底有点不太合适，用蓝紫色作为一个科技色吧，给人「灵光一现」的感觉"** → 抽出紫色 brand language, 后续每个次级页面都用
4. **"按这个思路，把次级页面也都设计一遍"** → MAGlowBanner 3 个 tone (brief / ai / warn) 在会议 / 任务 / 记忆 / 我的 都注入
5. **"能不能设计一个更为直观的图表显示目前的记忆情况...雷达图"** → 新功能 MemoryRadar (SVG 6 维度多边形 + 团队对比)
6. **"雷达图应该要做展开收起，不然常驻页面会影响用户阅读及操作"** → peek-then-tuck (复用会议室 CompactContextBar 模式 2.8s 自动 tuck)
7. **"点击左上角的铃铛「通知」界面也设计一下"** → 新增通知中心 bottom sheet (4 个主 tab 都接通)

### 1.3 设计的 5 个核心新概念

| 概念 | 用在 | 来源文件 |
|---|---|---|
| **MAGlowBanner** (3 tone: brief / ai / warn) | 5 个主 tab 每页 1-2 个 | `mobile-shared.jsx:559-672` |
| **Mira 早间简报 hero** (蓝紫渐变 + sparkle + 双 chip) | /m 今日页顶部 | `mobile-today.jsx:88-162` |
| **MemoryRadar** (SVG 6 维度多边形 + 团队对比 + peek-then-tuck) | /m/insights 顶部 | `mobile-screens.jsx:339-584` |
| **NotificationsSheet** (bottom sheet 4 段筛选 + 时间分组 + Glow 摘要) | 每个主 tab 顶栏铃铛 | `mobile-notifications.jsx` 全文 |
| **专家视角 ExpertCard 手风琴** (4px 渐变竖条 + 累计统计 + 最近会议) | /m 今日页 ExpertView | `mobile-today.jsx:567-702` |

---

## 2. 按页面列改动清单

### 2.1 /m (今日 — 大幅扩展)

**当前文件**: `frontend/src/app/m/page.tsx` (290 行) + 依赖 `HeroOngoingCard` `HeroEmptyCard` `MiniListRows` `PageHeader` `SegmentControl` `AgentWorkCard`

**新设计文件**: `mobile-today.jsx` (705 行) — 远比当前丰富

#### DIFF-NEW (新设计有, 当前没有)
1. **Mira 早间简报 hero** (`MiraDailyBrief`) — 蓝紫渐变 + 双色径向光晕 + 3 颗散落小星点 + Mira 头像 + 个性化 brief + 2 枚行动 chip ("优先拍板 Q3 协作功能" / "预读 Sage 评审稿"). **新概念**, 当前完全没有.
2. **今日一览 4 张统计小卡** (`TodaySnapshot`) — 会议数 / 待办数 / AI 洞察数 / 已决数 — 右上角小色块装饰, 大数字 + 副标. 当前无.
3. **AI 智囊高优先级"关键"红章** — `impact: 'high'` 的 InsightCard 顶部带红色 "关键" pill + 渐变背景. 当前 `InsightTopicGroupRow` 是议题聚合的 mini row, 无 "关键" 强调.
4. **今天的决策列表** (`DecisionRow`) — 绿色对勾 + 决策标题 + 拍板人头像 + 来源会议 + 时间. 当前完全没有这个 section.
5. **今天的会议水平 snap scroller** (`MeetingCardSmall`) — 横滑 240px 宽小卡, 4-5 张, 滚动 snap. 当前是 `HeroOngoingCard` 单卡 + 不显未来会议.
6. **专家视角 ExpertCard 手风琴** — 4px 渐变 accent 竖条 + 头像 + 名字 + 副标 + 折叠/展开. 展开后显示最近 3 场会议 + 任务数. 当前 `AgentWorkCard` 是卡片列表, 无手风琴折叠.
7. **TodayView 整体重排** — 顺序: TopBar → MiraDailyBrief → LiveMeetingCard → TodaySnapshot → Segmented(会议/专家) → (MeetView 或 ExpertView). 当前是 TopBar → Hero → 等你处理 → AI 智囊 三段.
8. **专家视角默认展开 SHU** (数小妙) — `useState('SHU')`, 反映本地化 AI 专家. 当前 ExpertView 列出全部 agent, 无默认聚焦.

#### DIFF-WRONG (当前有但跟新设计不一致)
1. **底色**: 现在 `bg-ink-950` 黑底 → 新 `bg-#F2F2F7` iOS 浅灰. **`[冲突 C1]` 全面切换信号**.
2. **PageHeader**: 现在 26px 标题 + 🔔 + ⚙ icons → 新设计是 34px 大字 + 大字下加日期 subtitle (`2026 年 5 月 25 日 · 周一`) + 圆形 40×40 icon. 文字 layout 完全不同.
3. **进行中会议卡 (LiveMeetingCard vs HeroOngoingCard)**:
   - 新: 白底卡 + 顶部绿色 LIVE 渐变进度条 (按 `elapsed/duration` 填充) + LIVE pill 脉冲 + Mira note 灰底嵌套 + 蓝色 "立即进入" 渐变按钮
   - 现: dark gradient 卡 + 5 颗 stage bar dots + insight callout + accent 按钮
   - **完全重做**
4. **SectionHeader**: 现在 `text-[17px] font-medium text-zinc-100` → 新 `fontSize: 17, fontWeight: 700, color: #1C1C1E, letterSpacing: -0.2` + count 紧贴标题 + "全部 →" 改为蓝色 13px action 文字 (`#007AFF`).
5. **Segment Control**: 现 `bg-ink-900/60` pill (15px text, 10px h-10) → 新 iOS 系统 segmented: `#E5E5EA` 容器 + 选中白底 + `boxShadow: 0 1px 2px rgba(0,0,0,0.08)` + 13px text + h-32px. **样式完全不同**.
6. **TaskRow / 等你处理**: 现 `PendingMiniRow` 是单行 emoji + chip + AI 数量 → 新 `TaskRow` 含圆形空 checkbox + 标题 + 紧急度色 chip (`紧急/今日/本周`) + AI 头像 + 来源会议 + 右侧 due 文字 + 截止颜色编码.
7. **AI 智囊 InsightCard**: 现 `InsightTopicGroupRow` 议题聚合 → 新单条 InsightCard 显示 (3 条 top), 顶部 AI 头像 + 名字 + 角色 + 时间 + 高 impact 红 pill, 中部标题 + body, 底部灰背景 "来源会议 / 查看上下文 →".
8. **专家视角 AgentWorkCard vs ExpertCard**: 现 `AgentWorkCard` 是 dark 卡 + 工卡墙样式 → 新 ExpertCard 卡左侧 4px 渐变竖条 (基于 AI 个人渐变) + 36px 渐变头像 + 名字 + 副标 + 折叠/展开 chevron 旋转动画.

#### DIFF-EXCESS (当前有但新设计没有)
1. **`groupInsightsByTopic`** 议题聚合逻辑 — 新设计不按议题聚合, 直接列 top 3 insights. **(可保留 backend 聚合, UI 不强制用)**
2. **`PendingMiniRow` 多种 kind** (confirm/approve_draft/blocked) → 新设计统一形态. 后端 kind 不变, 前端 UI 收敛.

#### 估算工作量: **中改 ~10-14 小时**
- 重写 page.tsx (3-4h)
- 新增 `MiraDailyBrief` + `TodaySnapshot` + `LiveMeetingCard` (light) + `TaskRow` + `InsightCard` (light) + `DecisionRow` + `MeetingCardSmall` + `ExpertCard` (~6-8h)
- 接 backend 数据 (workbench API 已有 ongoing_meetings / pending / todays_insights; 决策 + decision count 可能要补) (~2h)

#### 影响跨页组件
- `PageHeader.tsx` — 重做 (浅色 + subtitle 支持)
- `SegmentControl.tsx` — 重做 (iOS 系统 segmented 样式)
- `HeroOngoingCard.tsx` — 整个废弃或重写 → `LiveMeetingCard`
- `HeroEmptyCard.tsx` — 整个废弃或重写
- `MiniListRows.tsx` — 重做 (`TaskRow` + `InsightCard` + `DecisionRow`)
- `AgentWorkCard.tsx` — 重做 (`ExpertCard` 手风琴)

---

### 2.2 /m/meetings (会议列表)

**当前文件**: `frontend/src/app/m/meetings/page.tsx` (251 行)

**新设计**: `mobile-screens.jsx:13-170` (MeetingsView + MeetingFullCard)

#### DIFF-NEW
1. **Mira 本周脉络 brief MAGlowBanner** (tone: brief) — 顶部紫色渐变 banner, eyebrow "Mira · 本周脉络" + 标题 "本周 6 场会，搜索体验线吃掉了 4 场" + body + 2 chips ("今日决策 1 项" / "待同步 3 项"). 当前没有.
2. **MeetingFullCard 视觉**:
   - 进行中卡左侧 3px 绿色实条
   - 即将开始卡: 时钟 icon + `startsIn` 倒计时
   - 已结束卡: "X 决策 / X 行动" 双数字 (绿色 + 橙色)
   - "立即进入 →" 绿色 inline CTA (state=live 时)

#### DIFF-WRONG
1. **底色** — dark → light (同 2.1)
2. **新建会议按钮**: 当前 `border border-accent-500/30 bg-accent-500/[0.08]` → 新 `border: 1.5px dashed rgba(0,122,255,0.40)` + plus icon + "新建会议" — 视觉调性更轻.
3. **Segmented count 标签**: 当前 "进行中 (N)" → 新 "进行中 [N]" 数字角标紧贴 label, 用浅灰底.
4. **MeetingRow → MeetingFullCard**: 当前 `bg-ink-900` + chip + 标题 + footer chip 行 → 新白底 + status pill + 时间 + 大标题 + sub · topic + 头像 stack + 状态对应右侧 CTA/倒计时.
5. **PageHeader subtitle**: 新增 "本周 {N} 场 · 进行中 {live.length}" 副标. 当前无.

#### DIFF-EXCESS
1. **MiniProgress 6 段 stage bar** — 新设计在列表卡内不用 stage bar, 直接显头像 + 数字. 可保留 backend 进度数据, 但 UI 列表层不画.
2. **`timeAgo` 时间计算 + 实际/计划 minutes 对比** — 新设计简化为单行 `timeLabel`. 可保留逻辑, 显示文本变.

#### 估算工作量: **小改 ~4-6 小时**
- 重写 page.tsx 视觉 (~2h)
- 新 MeetingFullCard 组件 (~2h)
- 接 backend `latest_insight` + 进度数据 + 决策/行动数 (后端有, 仅 UI 映射) (~1-2h)

#### 影响跨页组件
- 复用新 `MAGlowBanner` (来自 2.1 today)
- 复用新 `PageHeader` + `SegmentControl`

---

### 2.3 /m/tasks (任务列表)

**当前文件**: `frontend/src/app/m/tasks/page.tsx` (228 行) + `TaskCard.tsx`

**新设计**: `mobile-screens.jsx:172-322` (TasksView + TaskFullRow)

#### DIFF-NEW
1. **Mira 今日优先级 MAGlowBanner** (tone: warn — 紫→品红渐变) — 顶部, eyebrow "Mira · 今日优先级" + 标题 "1 项今日截止 · 需 11:30 前拍板「协作功能是否进入 Q3」" + body + "全部展开" CTA. **替代** 现在的橙红 banner.
2. **按来源会议分组**: 任务按 `t.source.split(' · ')[0]` 分组 (相同会议的任务一组), 每组用 cal icon + 灰色 label header. 当前无分组.
3. **iOS Reminders 风格 checkbox**:
   - 未完成: 22×22 灰色 1.7px 圆形边框 (空圈)
   - 已完成: 22×22 绿色 `#34C759` 实心圆 + 白色 ✓
4. **完成项删除线 + 灰色文字** — 当前 `TaskRowCompact` 灰底但无删除线.
5. **AI 头像 + "建议" 内联** — 显示 `<MAIBadge id={sourceAI} size={13}> + ai.name + " 建议"`. 当前 `TaskCardFull` 是 `agent_nickname · agent_name` 文字, 无头像.
6. **assignee 头像** — 显示 owner 头像 (人色块 + 名字). 当前是 chip.

#### DIFF-WRONG
1. **底色** — dark → light
2. **TaskCardFull**: 当前是 dark 卡 + primary/secondary CTA 按钮 → 新 TaskFullRow 是白底列表行 + 无内联 CTA (列表只展示, 详情页或 sheet 处理 CTA — 需 PM 确认这个产品决策).
3. **截止时间颜色**: 当前固定颜色 → 新按 `t.dueColor` 字段映射 (`#FF3B30` 红 / `#FF9F0A` 橙 / `#3C3C43` 灰).

#### DIFF-EXCESS
1. **RejectFeedbackSheet** + `runCta` 复杂状态机 — 新设计的 list 上无 CTA, 操作放详情页. **[BACKEND-NEEDED] 决策**: 是否保留列表 CTA? 还是只查看?
2. **busyId / 单条 busy 状态** — 跟随上面.
3. **draft 类型的 secondary 驳回 sheet 拦截逻辑** — 跟随上面.

#### 估算工作量: **小改 ~4-6 小时**
- 重写 page.tsx + TaskFullRow (~3h)
- 移除 list CTA 逻辑 (或保留, 看 PM 决策) (~1-2h)
- 按 source 分组 (~1h)

#### 影响跨页组件
- 复用新 `MAGlowBanner` (warn tone)
- 复用新 `PageHeader` + `SegmentControl`

---

### 2.4 /m/insights (记忆 — **重大新增 MemoryRadar**)

**当前文件**: `frontend/src/app/m/insights/page.tsx` (431 行) + `MemoryRow.tsx` + `PendingInsightReviewCard.tsx`

**新设计**: `mobile-screens.jsx:324-806` (MemoryView + MemoryRadar + SnapshotList + PendingList + LibraryList)

#### DIFF-NEW
1. **MemoryRadar SVG 雷达图** — **核心新功能**:
   - 360×290 SVG, 6 维度 (数据洞察 / 产品策略 / 客户体验 / 法规合规 / UX 设计 / 财务建模)
   - 双多边形: 实心紫渐变 = 你, 虚线白 = 团队平均
   - 6 个顶点圆点 (外白内紫)
   - 深紫宇宙渐变背景 (`#1a1733 → #2a1f5a → #3b2b73`) + 青色 + 粉色径向光晕 + 散落星点
   - 顶部 header: 28×28 圆角方形 brain icon + "AI 智囊 · 记忆地图" eyebrow + 总数 + 最强领域 chip
   - "对比团队" 切换按钮
   - 底部双 stat 卡: "你最强 数据洞察 32" (青色) + "可补充 团队 +3" (粉色)
   - **Peek-then-tuck 折叠**: 默认展开, 2.8s 后自动 tuck → 70px header 行; 点 header 手动 toggle
   - SVG `<filter id="glow">` + `<radialGradient id="mr-fill">` + 6 spoke lines + 4 concentric rings
2. **快照 tab — SnapshotList 议题聚合卡**:
   - 36×36 AI 头像 + 议题名 + "X 位 AI · 洞察/建议" + 计数 chip + chevron
   - 显示 `s.aiCount` + `s.sub` 区分类型
3. **待审 tab — PendingList**:
   - 顶部 MAGlowBanner (tone: ai) "AI 智囊 · 为你提炼 — 刚刚从会议中提取了 N 条候选记忆"
   - 每条: AI 头像 + 名字 + 会议名 + 时间 → 大字文本 → 双 CTA "审入记忆库" (蓝渐变 + ✓) / "忽略" (灰色)
4. **记忆库 tab — LibraryList**:
   - 顶部假搜索框 (search icon + "搜索记忆库 · 100 条")
   - 每条 MemoryFullRow: 大字文本 → tag chip (项目/流程/合规) + AI 头像+名字 → 底部行 "入库 2026/5/20 · 数据安全合规" + "来源会议 →"

#### DIFF-WRONG
1. **底色** — dark → light
2. **三 tab label**: 当前 "快照 / 待审 / 记忆库" 保留, 但 SegmentControl 视觉变 iOS 系统.
3. **PendingInsightReviewCard**: 当前 dark + 长卡 + 多按钮 → 新 light + 单 textBlock + 双 CTA. **简化**.
4. **MemoryRow**: 当前 dark 行 → 新 MemoryFullRow (上述 DIFF-NEW.4).

#### DIFF-EXCESS
1. **lazy load 状态机 + fetchedRef** — 可保留 (性能优化).
2. **insightTopics 议题聚合** — 跟 2.1 一样, backend 数据可保留, UI 是否聚合按 PM.
3. **decision: accepted / rejected API** — 保留, 但 CTA 视觉变.

#### 估算工作量: **大改 ~12-16 小时**
- 重写 page.tsx (~3h)
- **MemoryRadar SVG 组件** — 这是最大新增物: 6 维度多边形渲染 + 双层动画 + 团队对比 + peek-then-tuck + Insights 卡 (~6-8h)
- 重写 SnapshotList + PendingList + LibraryList (~3-4h)
- 后端补 6 维度统计接口 — **[BACKEND-NEEDED]** (~2-3h backend, 可用 mock 兜底)

#### 影响跨页组件
- 复用新 `MAGlowBanner` (ai tone)
- 复用新 `PageHeader` + `SegmentControl`

#### [BACKEND-NEEDED]
- **新接口**: `GET /api/me/memory-stats` 返回 `{ total, axes: [{ id, label, you, team, ai }] * 6 }`
  - `axes` 是 6 个维度 (数据/产品/客户/法规/UX/财务)
  - `you` = 当前用户在该领域的记忆数, `team` = workspace 平均
  - 没有接口前可写本地 mock (`MA_RADAR` from `mobile-screens.jsx:327-337`)

---

### 2.5 /m/me (我的)

**当前文件**: `frontend/src/app/m/me/page.tsx` (290 行)

**新设计**: `mobile-screens.jsx:808-963` (ProfileView)

#### DIFF-NEW
1. **AI 智囊近 7 天 MAGlowBanner** (tone: ai) — "你采纳了 18 / 24 条 AI 建议" + body "最热门的专家是 Aria (46%). 采纳率 75% 超过团队平均线". 当前无.
2. **环境 chip 绿底**: 当前 `value="生产"` 普通字 → 新 `bg: rgba(52,199,89,0.14), color: #1F8A5B, 11px 700` 绿色 pill.
3. **声纹 ProfileRow 带 icon + sub**: 当前 link → 新带 mic icon (28×28 灰底圆角) + "6 条声纹 · 上次更新 5 天前" sub + 蓝色 "管理 →" 右侧值.
4. **退出登录按钮带 logout icon** — 当前纯文字, 新加 17px stroke icon.
5. **PageHeader 简化**: 顶部不是 sticky TopBar (当前), 而是 inline 6×8 px padding + ← back + "我的" 28px 大字.

#### DIFF-WRONG
1. **底色** — dark → light
2. **头像卡**:
   - 当前 `from-violet-500 to-accent-500` dark gradient
   - 新 56×56 圆形 `from-#5E5CE6 to-#AF52DE` + shadow `0 2px 8px rgba(94,92,230,0.30)`
   - 名字 18px 700 + OWNER chip 10.5px 700 (紫底) + email 12px 灰
3. **ProfileGroup 卡**: 当前 `bg-ink-900 rounded-2xl px-5 py-2` + `<Row>` 间分割线 → 新 `bg #fff borderRadius 14 + 0.5px hairline border` + `<ProfileRow>` 通用组件 (含 icon 支持 + valueArrow / valueMulti / sub).
4. **退出按钮**: 当前 `border-rose-500/30 bg-rose-500/[0.06]` → 新 `bg #fff color #FF3B30 border 0.5px solid rgba(255,59,48,0.30)`.

#### DIFF-EXCESS
1. **VoiceprintEntry 小程序拦截逻辑** — 保留 (业务逻辑), 仅视觉重做.
2. **`ConfirmDialog` 退出确认** — 保留 (跟 bundle EndConfirm 同形态).

#### 估算工作量: **小改 ~4-5 小时**

#### 影响跨页组件
- 复用新 `MAGlowBanner` (ai tone)

---

### 2.6 /m/notifications (通知 — **重大改造: bottom sheet 而非整页**)

**当前文件**: `frontend/src/app/m/notifications/page.tsx` (283 行) — **整页 / 独立路由**

**新设计**: `mobile-notifications.jsx` — **bottom sheet, 从各 tab 顶栏弹起**

#### DIFF-NEW (产品架构变化, 重要!)
1. **形态从"独立路由"变为"sheet"**:
   - 新设计是 `NotificationsSheet` bottom sheet, top: 60 (顶部留 60px 看原页面), slideUp 280ms 动画
   - 每个主 tab 顶栏铃铛 (`onBell`) 唤起这个 sheet, 不导航离开当前页
   - **当前** `/m/notifications` 是独立路由 + sticky TopBar + 列表
   - **决策点**: PM 需要明确 "通知是 sheet 还是页?". sheet 体验更好 (不丢上下文), 但要重写所有 PageHeader 铃铛跳转逻辑
2. **AI 智囊通知摘要 MAGlowBanner** (compact 模式) — 顶部 "N 条未读 · 其中 M 条来自 AI 专家" 紫色 banner
3. **按时间分组**:
   - 现在 · 早些时候 · 昨天 — 3 段固定分组
   - 当前是 createdAt 倒序无分组
4. **iOS Segmented Control 4 类筛选**:
   - 全部 / AI / 会议 / 任务
   - 当前无筛选
5. **彩色 kind 标签**:
   - meeting-soon 绿 / ai-insight 紫 / ai-memory 紫罗兰 / decision 深绿 / mira-brief 橙 / material 蓝 / task-due 红
   - 当前用 KIND_LABEL + emoji
6. **NotifRow 富信息**:
   - 左未读蓝圆点 + 头像 (AI/human/system 三型) + sender 名 + kind 标签 + 时间
   - 标题 14 / body 12.5 (`-webkit-line-clamp: 2`)
   - 底部行 "源会议 + action button (glow 时紫渐变)"
7. **glow 标记**: `n.glow = true` 时 action 按钮变紫渐变 (Mira brief 等"灵感时刻")
8. **未读样式**: 浅蓝渐变背景 (`linear-gradient(90deg, rgba(0,122,255,0.04) 0%, transparent 60%)`) + 标题加粗

#### DIFF-WRONG
1. **底色** — dark → light
2. **kind 映射重做** — 当前 `KIND_LABEL` 13 种映射, 新设计 7 种 (`meeting-soon / ai-insight / ai-memory / decision / mira-brief / material / task-due`). 后端 kind 仍是十几种 → 前端需做映射收敛
3. **时间格式**: 当前 `timeAgo` ("5 分钟前") → 新混合 ("刚刚" / "8 分钟前" / "上午 11:08" / "昨天 22:18")

#### DIFF-EXCESS
1. **PageHeader 的 unread badge** — 如果改 sheet, 顶栏铃铛角标逻辑可保留, 但跳转改为 `onBell={() => setNotifOpen(true)}`
2. **POST /read-all + POST /:id/read** — 保留 API, UI 改一下

#### 估算工作量: **中改 ~8-10 小时**
- 决策: sheet vs page (~PM)
- 新增 NotificationsSheet 组件 (~4-5h)
- 接入 4 个主 tab 顶栏 (~1-2h)
- 重写 kind 映射 + 时间格式 + 渲染 (~2-3h)

#### 影响跨页组件
- **PageHeader** — 改铃铛 onClick 从 `<Link>` 改为 `onBell` callback
- 所有 4 个主 tab 顶层 page.tsx 都要传 `setNotifOpen` 到 PageHeader

#### [BACKEND-NEEDED]
- **未读统计**: 当前 `task_counts.kb_sedimentation_pending + memory_draft_pending` 拿未读数. 新设计需要 `unread_count` (现有 `/api/me/notifications` 已返回, 兼容).
- **glow 字段**: 后端需要标识 "灵感时刻" 通知 (mira_brief / 重要 ai_insight) → 新 `notif.glow: boolean` 字段. 可前端 hardcode 按 kind 推 (mira_brief = glow, ai_insight high_impact = glow).

---

### 2.7 跨页 / 共享组件

#### 2.7.1 BottomNav (4 tab)

**当前**: `BottomNav.tsx` — emoji icon + dark `bg-ink-950/95 backdrop-blur`

**新设计**: `MABottomTabs` (`mobile-shared.jsx:689-726`) — stroke SVG icon + light frosted `bg: rgba(255,255,255,0.88), backdrop-filter: blur(24px) saturate(180%)`

#### DIFF
- **icon**: 当前 emoji (🎯 📅 ✓ 🧠) → 新 lucide stroke SVG (`target / cal / check / brain`)
- **底色**: dark → light frosted
- **active color**: `accent-300` → `#007AFF`
- **inactive color**: `zinc-500` → `#8E8E93`
- **label fontSize**: 11px → 10.5px (微调)

**工作量**: ~2-3 小时

---

#### 2.7.2 PageHeader

**当前**: `PageHeader.tsx` (97 行) — 26px 标题 + 内置 🔔 + ⚙ Link

**新设计**: `MATopBar` (`mobile-shared.jsx:511-554`) — 34px 标题 + subtitle 行 + 40×40 圆形 icon (bell + gear) + 红色 unread dot 角标

#### DIFF
- **title fontSize**: 26 → 34, fontWeight: 600 → 800, letterSpacing: undefined → -1
- **subtitle**: 新增 (12.5px 灰色, 可选)
- **icons**: 当前 18px emoji + Link → 新 20px stroke SVG (`bell` / `gear`) + 红色 8×8 dot 角标 + 圆形 40×40 button
- **铃铛 click**: 当前 Link 跳转 → 新 `onBell` callback (打开 NotificationsSheet)
- **gear click**: 当前 Link 跳转 `/m/me` → 新 `onGear` callback (可 navigate 或开 ProfileView, 看 PM 决策)

**工作量**: ~2-3 小时 — **但每个主 tab 调用方都要改**

---

#### 2.7.3 SegmentControl

**当前**: dark pill (`bg-ink-900/60 + bg-zinc-700`)

**新设计**: `MASegmented` (`mobile-shared.jsx:446-478`) — iOS 系统 segmented (`bg #E5E5EA + bg #fff + 1px 阴影`)

**工作量**: ~1-2 小时

---

#### 2.7.4 (新增) MAGlowBanner — 跨页紫色 brand component

**新设计**: `mobile-shared.jsx:559-672`

**API**:
```tsx
<MAGlowBanner
  tone="ai" | "warn" | "brief"
  icon="sparkle" | "bolt" | "brain" | ...
  eyebrow="AI 智囊 · 近 7 天"
  title="你采纳了 18 / 24 条 AI 建议"
  body="...optional"
  chips={[{ icon, label }, ...]}
  cta="全部展开"
  onCta={...}
  compact={false}  // 通知 sheet 内用 compact
/>
```

**视觉**: 渐变底 + 双色径向光晕 + 3 颗散落小星点 + 28×28 玻璃白 icon 盒 + eyebrow + title + 可选 body + 可选 chips + 可选 CTA

**用在**:
- /m today: MiraDailyBrief (custom, 但同语言)
- /m/meetings: brief tone "本周脉络"
- /m/tasks: warn tone "今日优先级"
- /m/insights pending: ai tone "为你提炼"
- /m/me: ai tone "近 7 天"
- NotificationsSheet: ai tone compact "通知摘要"

**工作量**: ~3-4 小时 (单独组件实现 + 3 tone palette)

---

#### 2.7.5 (新增) 头像系统 — MAvatar / MAIBadge / MAvatarStack

**新设计**: `mobile-shared.jsx:257-321`

- **MAvatar** (真人): 圆形 + 个人色 + 白色首字母
- **MAIBadge** (AI): 圆角方形 + 渐变 + glyph 字符 (◎ ⚖ ∑ ♥ ⌬ ◆ ✦ ◈ § ¥)
- **MAvatarStack**: 叠加 (humans 在前, AIs 在后) + maxShown + "+N" overflow

**这跟会议室 round-3 已实施的 `avatars.tsx` 高度重叠** — 应**复用** 而不是另起.

**[STYLE-DEVIATION 风险点]**: 会议室 round-3 的 `MRHumanAvatar` / `MRAIAvatar` / `MRHostAvatar` 在 `meeting-room/avatars.tsx` 路径. round-4 设计稿的 `MAvatar` / `MAIBadge` 应该**提到** `components/mobile/` 顶层路径 (例如 `components/mobile/avatars.tsx`), 让会议室 + 主 tab 共用. 否则会有两套头像组件.

**工作量**: ~2-3 小时 (含从 `meeting-room/avatars.tsx` 提到顶层 + 5 处 import 改) — **重构, 不是新增**

---

#### 2.7.6 (新增) MAIcon — Lucide-style icon set

**新设计**: `mobile-shared.jsx:324-388` — 30+ inline SVG icons

**这跟会议室 round-3 已实施的 `MRIcon.tsx` 高度重叠** — 同样应**复用并提到顶层**.

新增的 icon (会议室没有的):
- `target` `cal` `task` `brain` `bell` `gear` `sun` `flag` `arrow-right` `play` `clock` `pin` `filter` `archive` `history` `today` `mic` `logout`

**工作量**: ~3-4 小时 (整合现有 MRIcon + 加 18 个新 icon)

---

#### 2.7.7 Toast / ConfirmDialog

不动. 现有 `Toast.tsx` / `ConfirmDialog.tsx` 形态合适, 仅在主 tab 浅色化后跟着调整 token (PM 可选: 一并浅色化 vs 保留 dark — 后者风格混乱).

---

#### 2.7.8 MobileShell

**当前**: `MobileShell.tsx` — `bg-ink-950 text-zinc-100`

**改动**:
- `bg-ink-950` → `bg-[#F2F2F7]`
- `text-zinc-100` → `text-[#1C1C1E]`
- 其他逻辑 (viewport lock / safe area) 不变

**工作量**: ~30 分钟

---

## 3. 二级 / 详情页 — **本 Saga 不动**

新设计稿没覆盖以下页面, 但风格 shock 后会显得格格不入 — **建议下一个 Saga 单独处理**:

| 文件 | 当前状态 | 风险 |
|---|---|---|
| `/m/meetings/[id]/page.tsx` | round-3 done (P3) | **已浅色**, OK |
| `/m/meetings/[id]/summary/page.tsx` | P4 done | **已浅色**, OK |
| `/m/meetings/new/page.tsx` | dark | 跟 round-4 风格冲突 |
| `/m/tasks/[id]/page.tsx` | dark | 同上 |
| `/m/agents/[id]/page.tsx` | dark | 同上 |
| `/m/me/voiceprint/page.tsx` | dark | 同上 |
| `/m/privacy/page.tsx` | dark | 同上 |

**建议**: 在 round-4 落地后, 单开 Saga "round-4.5 二级页浅色化" 一次性处理.

---

## 4. Scope 评估总表

| 改动级别 | 涉及 | 估算 | 备注 |
|---|---|---|---|
| **超小改 (<2h)** | MobileShell bg / Toast / ConfirmDialog token | 1-2h | 跟整体切换浅色一并 |
| **小改 (2-6h)** | BottomNav / SegmentControl / PageHeader / /m/me / /m/tasks / /m/meetings | 5h × 6 = ~30h | |
| **中改 (8-12h)** | /m today (重写 + 6 个新组件) / NotificationsSheet (新组件 + 接入 4 tab) | 10h × 2 = ~20h | |
| **大改 (12-16h)** | /m/insights MemoryRadar + 3 list 重做 | ~14h | SVG 雷达图是最大单点 |
| **跨页组件新增 (8-12h)** | MAGlowBanner / 头像系统 (复用 MR) / MAIcon (复用 MR) | ~10h | |
| **总计** | | **~75-85 小时** | 单人, 1-2 周 |

---

## 5. 优先级建议 (PM 拆 Saga 用)

### **P0 — 必做 (~40 小时)**
**子 Saga A · "浅色 + Today 大改"**
- MobileShell + BottomNav + PageHeader + SegmentControl 浅色化
- /m today 大重写 (含 MiraDailyBrief + LiveMeetingCard + TodaySnapshot + ExpertView 手风琴)
- MAGlowBanner + MAIcon + MAvatar 等共享组件提到顶层

### **P1 — 强建议 (~25 小时)**
**子 Saga B · "次级 tab 浅色 + Glow Banner"**
- /m/meetings 浅色 + brief banner
- /m/tasks 浅色 + warn banner + 按会议分组
- /m/me 浅色 + ai banner
- NotificationsSheet 改造 (sheet 替代页, 4 tab 接入)

### **P2 — 可选 (~15 小时)**
**子 Saga C · "MemoryRadar 雷达图"**
- /m/insights MemoryRadar SVG 大功能
- 后端 memory-stats 接口
- 三 list 浅色化

### **P3 — 跟随 (后续 Saga)**
**子 Saga D · "二级页浅色化"** (~30 小时)
- meetings/new, tasks/[id], agents/[id], me/voiceprint, privacy 全部浅色化

---

## 6. [BACKEND-NEEDED] 标记

唯一新接口:

### `GET /api/me/memory-stats`
用于 MemoryRadar 6 维度统计.

```ts
{
  total: number,            // 总记忆数 (e.g. 100)
  axes: Array<{
    id: 'data' | 'product' | 'cx' | 'legal' | 'ux' | 'finance',
    label: string,          // "数据洞察" 等
    you: number,            // 当前用户该领域记忆数
    team: number,           // workspace 平均
    ai: 'SHU' | 'STRATOS' | 'ZHAOJIE' | 'LEX' | 'SAGE' | 'TALLY',
  }>
}
```

**fallback**: 前端先 hardcode `MA_RADAR` (`mobile-screens.jsx:327-337`) 让 UI 上线; backend 上线后切.

### `notification.glow: boolean` 字段 (可选)
让 backend 标识 "灵感时刻" 通知 (mira_brief / 高 impact ai_insight). 不上线则前端按 kind hardcode 推断 (`kind === 'mira-brief' || (kind === 'ai-insight' && severity === 'high')`).

**0 个其他后端改动** — 所有页面用现有数据契约.

---

## 7. [STYLE-DEVIATION] 风险点 — 主 Agent 跟 PM 沟通

### R1 · [冲突 C1] 全面浅色化决策
设计稿是会议室 round-3 浅色风扩张到 5 个主 tab. 一旦实施, **整个 mobile App 必须切到浅色** — 二级页不切就跟主 tab 视觉撕裂. PM 需明确:

- (a) **一次性 切全部** (本 Saga + 立即下一 Saga D 跟进二级页) — 体验一致, 工作量 ~110h
- (b) **分批切** (本 Saga 仅主 tab + 一些二级页留 dark) — 短期撕裂, 工作量减 30h
- (c) **保留 dark + light 双主题切换** — 工程复杂度激增, 不建议

**推荐 (a)**.

### R2 · NotificationsSheet 替代 /m/notifications 整页
新设计是 bottom sheet, 当前是独立路由. 决策:

- (a) **改 sheet** (推荐 — UX 更好, 不丢上下文) — 删除 `/m/notifications` 路由 + 重写各 tab 顶栏铃铛 onClick
- (b) **保留独立路由 + 同时支持 sheet** — 维护成本上升

### R3 · 头像组件复用 vs 重新建一套
会议室 round-3 已经在 `components/mobile/meeting-room/avatars.tsx` 实现了 `MRHumanAvatar` / `MRAIAvatar` / `MRHostAvatar`. round-4 设计的 `MAvatar` / `MAIBadge` 99% 一样.

**推荐**: 重构 — 把会议室的 `avatars.tsx` + `MRIcon.tsx` **提到** `components/mobile/avatars.tsx` + `components/mobile/Icon.tsx` 顶层, 5 个主 tab + 会议室共用. **这是一次重要的 deduplication**.

### R4 · 任务列表 CTA 决策
新设计 TaskFullRow 是纯展示行 (无 primary/secondary CTA). 当前 `TaskCardFull` 有 "完成 / 驳回" 等 CTA. 决策:

- (a) **列表只查看, CTA 进详情页** (新设计) — 多一次跳转, 但列表更干净
- (b) **保留列表 CTA** — 设计调整, 在卡底加按钮区

### R5 · groupInsightsByTopic 是否保留
当前 today + insights 都用议题聚合. 新设计不用. 决策:

- (a) **保留 backend 聚合 + UI 拍平** (兼容)
- (b) **完全废弃聚合逻辑** (简化)

### R6 · "ExpertView 工卡墙" → 手风琴 卡组件层级
当前 `AgentWorkCard` 是 backend 数据驱动 (workspace 自定义 agent). 新设计 `ExpertCard` 是 hardcode 6 个固定 AI 专家 (Aria/Stratos/Lex/Sage/Tally/Scout + 本地化 SHU/FALAO/ZHAOJIE). **这是 `[冲突 C8]`** — 固定 vs 自定义.

**推荐**: 保留现有动态 agent (backend), 仅用新视觉. 6 个 hardcode 名字 mock 仅作设计稿数据.

### R7 · Mira 早间简报数据来源
新设计 `MA_TODAY.todayBrief` 是 hardcode. 实际需要 backend 生成今日 brief.

**Decision**: 短期 hardcode + 长期接 backend Mira 简报生成接口 (在 Saga D 之外的"Mira 引擎"Saga 单独做).

### R8 · Today 页 "今天的决策" section 后端字段缺失
当前 backend workbench 没有 "today_decisions" 字段. 决策:

- (a) **加 backend 字段** (~2h) — 拉今日已敲定的 decisions
- (b) **前端从 todays_insights / pending 推导** — 不准确, 不推荐

---

## 8. 建议主 Agent 跟 PM 对齐的关键决策点

按重要性排序:

1. **R1 (浅色化范围)** — 必决, 否则整体调性混乱
2. **R3 (头像 / icon 组件提层)** — 必决, 决定本 Saga 边界
3. **R2 (NotificationsSheet vs 整页)** — 必决, 影响 4 个主 tab 顶栏 + 路由
4. **R4 (任务列表 CTA)** — 影响 backend API 调用模式
5. **MemoryRadar 是否本 Saga 落地** — 大功能, 建议拆到 P2 子 Saga
6. **子 Saga 拆分** — 建议 A (P0) → B (P1) → C (P2) 三批次, 每批独立 commit + Kimi 测试用例

---

> 本文档**仅 review**, **未触动任何代码**.
> 所有 design 文件保留在 `/tmp/claude-design-round4/aimeeting/project/` 供后续 subagent 1:1 移植参考.
