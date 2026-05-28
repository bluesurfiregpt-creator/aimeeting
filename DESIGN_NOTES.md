# DESIGN_NOTES.md — 设计 交接 (Claude → Codex)

> **写于**: 2026-05-28
> **truth source**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` (775 行, 视觉宪法)
> 本文档 是 DESIGN_SYSTEM 的 摘要 + Codex 行动导向版

---

## 1. 设计 来源

| 来源 | 用途 | 位置 |
|------|------|------|
| **Claude Design handoff bundle (2026-05-25)** | 主 设计 reference (会议室 R5.D + 移动 v2) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/handoffs/2026-05-25-meeting-room/` + `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/handoffs/2026-05-25-meeting-room-r3/` |
| **现有 frontend 代码 反推** | 反向 抽 出 design system | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/atoms/` + `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/mobile/meeting-room/styles.ts` |
| **Claude Design v1.4.0 darkmode bundle** (`S3TK_UXeBzGF0V_jQr4hLg`) | 会议室 深邃星空 dark theme (§ 7.1.1 例外) | 设计稿源 已抄到 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/meeting-room-darkmode-evaluation.md` |
| **Saga changelist 文档** (round-4 ~ round-6) | 历次 大改 的 设计 sync 记录 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/specs/SAGA-*.md` |
| **Figma / 截图** | 部分 详情 (e.g. AI 心智一览 4 件 拟物 icon) | 内嵌 Saga changelist |

---

## 2. 需要 实现 的 页面 (按 端 分)

### 2.1 Web Workstation (W_THEME 暗紫 / light 双 theme)
- `/` — 首页 (workstation 入口)
- `/login` — 登录
- `/workstation` — **AI 心智一览** (默认 landing, 4 件 拟物 SVG icon strip + 钻取 drawer + Sankey 嵌入)
- `/workstation/board` — 任务 kanban
- `/workstation/agents` — AI 专家 列表
- `/workstation/agent/[id]` — **AI 专家 详情** (痛点 4 核心: radar 6 轴 + KB list + memory list + 出席会议 + 5 维 connections)
- `/workstation/browse` — AI 市场 (订阅)
- `/workstation/tpl` — AI 模板 生成器
- `/workstation/meeting` 和 `/workstation/history` — 会议 历史
- `/workstation/meeting/[id]` — 会议 详情 (6 tabs)
- `/workstation/new` — 创会
- `/workstation/tasks` — 我的 任务
- `/workstation/profile` — 身份信息
- `/workstation/kb` — 书架 (KB 列表)
- `/workstation/memory` — 长期记忆 (经验)
- `/workstation/approve` — 待审批 中心
- `/workstation/admin` — 平台超管 (system_owner only)
- `/workstation/topics` — 议题 列表 (NEW-B)
- `/workstation/topics/[id]` — 议题线 时间线 (NEW-B)
- `/workstation/graph` — 桑基血缘图 (LineagePane)

### 2.2 Web 会议室 (MR_TOKENS 双 theme, § 7.1.1)
- `/meeting/[id]/live` — Web 会议室 (三栏: Left 议程 / Center transcript + InputBar / Right Mira 决策池+行动项+Parking + BottomBar mic/video/hand/cc/share + TopBar)

### 2.3 Mobile (MR_COLORS 浅 iOS 单 theme)
- `/m` — Today 4 模块
- `/m/meetings` 列表 + `/m/meetings/[id]` 移动会议室 + `/m/meetings/[id]/summary` 纪要
- `/m/meetings/new` — 创会 (AI tab + Custom tab)
- `/m/tasks` 列表 + `/m/tasks/[id]` 详情
- `/m/insights` — Memory Radar SVG (6 轴: 产品策略 / 法规合规 / 数据洞察 / 客户体验 / UX 体验 / 财务建模)
- `/m/me` — 个人 + 声纹管理
- `/m/notifications` — 通知 中心
- `/m/chat/[id]` — 1-on-1 chat (NEW-C, 浅色 iOS bubble)
- `/m/agents/[id]` — AI 卡 详情
- `/m/privacy` — 隐私协议

### 2.4 小程序 原生 (浅色化 done, 不开发 编辑)
- 浅色化已完 (Saga F). 编辑功能 永不做 (NORTH_STAR § 7.3)

---

## 3. 每个 页面 的 视觉 风格

### 3.1 Web 浅色 iOS 路径 (`/`, `/login`)
- `#F2F2F7` canvas + `#fff` surface + `#1C1C1E` 文字 + `#007AFF` 链接 + `#34C759` 成功 + `#FF3B30` 错误
- 圆角 8-14px, hairline 0.5px `rgba(60,60,67,0.10)`

### 3.2 Web Workstation (W_TOKENS 暗紫 dark default)
- `--w-bg: #0a0a0e` 主背景 / `--w-surface: #14151c` 卡 / `--w-text: #E8E8F0` 文字
- 紫渐变 hero: `linear-gradient(135deg, #15102f 0%, #1a1530 40%, #271a3f 100%)`
- 紫 CTA: `linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 100%)`
- accent indigo `#5E5CE6` / cyan glow `rgba(100,210,255,0.18)`
- 圆角 8-18px, glow shadow `0 16px 40px rgba(94,92,230,0.16)`
- Sparkle / Mental Glyph (compass / brain / book / target / sparkle) SVG iconography

### 3.3 Web 会议室 R5.D 浅色 (MR_TOKENS light default, § 7.1.1)
- `#F2F2F7` 三栏 wrapper "灰海" + `#fff` 中心 transcript "白岛" + 紫 hairline `rgba(94,92,230,0.35)` top border
- iOS 系统色 + 系统圆角 16-18px + 紫 active speaker pulse
- 跨 theme 常量: agent 渐变 + iOS 系统色 + brand gradient stops

### 3.4 Web 会议室 R5.D 深色 (MR_TOKENS dark opt-in, § 7.1.1)
- `--mr-bg-canvas: #05071A` 深邃星空 / `--mr-bg-stage: linear-gradient(180deg, #060818 → #0A0E22 → #060818)`
- `--mr-bg-topbar: linear-gradient(180deg, #0B0F26 → #080B1F)`
- `--mr-accent-playhead: #B9A0FF` (active speaker 紫光带)
- `--mr-bg-chip: rgba(124,92,250,0.10)` 紫 tint chip
- 跨 theme 一致 (iOS 系统色 / 品牌渐变) 保持 literal hex

### 3.5 Mobile (MR_COLORS 单 theme 浅 iOS)
- 严格 iOS 风: `#F2F2F7` group / `#fff` card / `#1C1C1E` 文字 / iOS 蓝 `#007AFF` / iOS 圆角 14-18px / iOS 字 -apple-system + SF Pro
- 不开 dark mode (NORTH_STAR § 7.1)
- Mira hero 用 深紫渐变 (`linear-gradient(135deg, #1a1733 → #2a1f5a → #3b2b73)`) — **唯一** 深色 元素 (PM 拍 H5 内嵌 OK)

---

## 4. 布局 结构

### 4.1 Web Workstation
- WPage 顶级 壳: WTopNav (左 logo + 中间 search + 右 me) + WGlowBackground + main
- Sidebar (`WorkstationSidebar`): 5 section (总览 / 我 / 会议 / 我的 AI 团队 / 知识与经验) + 平台 (system_owner)
- 主区: 各 pane (MentalModelPane / TasksPane / AgentDetailPane / ...)

### 4.2 Web 会议室
```
TopBar (48px 高, Row 1 logo + 面包屑 + LIVE + 人头 + 筛选 + 邀请 + 设置 + ThemeToggle + END)
       + Row 2 AgendaTimeline (4 段)
─────────────────────────────────────────────────────
Left Panel (280px)  │  Center (灰海中的白岛, 顶 紫 hairline)  │  Right Panel (340px)
- 专家时间线高光    │  - FilterBanner (条件)                  │  - Mira 当下决策池
- 议程列表          │  - Transcript (滚, mr-scroll iOS)        │  - 行动项
                    │  - "AI 圆桌进行中 · X 发言" hint        │  - Parking Lot
                    │  - InputBar (打字 + @ mention + 角色)   │
─────────────────────────────────────────────────────
BottomBar (72px 高, mic / video / hand / cc / share / 更多)
```

### 4.3 Mobile
- AppBar (48px)
- Page content (overflow scroll)
- TabBar (mobile only, 56px, 4-5 tab)

---

## 5. 颜色 / 字体 / 间距 / 圆角 / 阴影

> 详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` § 1 (颜色) / § 2 (字体) / § 3 (间距 + 圆角 + 阴影)

### 5.1 颜色 token 速查
- **iOS 浅色** (Mobile + Web 会议室 light): `#F2F2F7` canvas / `#fff` surface / `#1C1C1E` 主文字 / `#007AFF` 蓝 / `#34C759` 绿 / `#FF3B30` 红
- **W_TOKENS 暗紫** (Web Workstation dark default): `--w-bg #0a0a0e` / `--w-surface #14151c` / `--w-text #E8E8F0` / accent `#5E5CE6`
- **MR_TOKENS dark** (会议室 深邃星空, § 7.1.1): `#05071A` canvas / `#0A0E22` surface / `#B9A0FF` accent
- **跨 theme 不变**: iOS 系统色 (`#007AFF` / `#34C759` / `#FF3B30` / `#FF9F0A` / `#5856D6` / `#AF52DE` / `#5E5CE6` / `#7A5AF0`)

### 5.2 字体
- SF Pro Text + PingFang SC + system-ui (`-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui`)
- 字号: 10 (footnote) / 11 (caption) / 12 (body small) / 13 (body) / 14 (subhead) / 15 (callout) / 17 (body large) / 20 (title 3) / 22 (title 2) / 28 (title 1) / 34 (large title)
- 字重: 400 / 500 / 600 / 700 / 800

### 5.3 间距
- 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 28 / 32 / 40 / 48 / 56 / 64
- 卡片 padding 通常 14-20px
- 模块间 gap 通常 16-24px

### 5.4 圆角
- 4px chip / 6px badge / 8px button / 10px small card / 12-14px card / 16-18px sheet / 20-24px hero / 28-32px modal

### 5.5 阴影
- subtle: `0 1px 2px rgba(0,0,0,0.03)` (cards)
- card: `0 2px 8px rgba(0,0,0,0.04)`
- fab: `0 4px 14px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(60,60,67,0.12)`
- modal: `0 24px 60px rgba(0,0,0,0.30-0.40)`
- glow (dark mode): `0 0 0 2px rgba(94,92,230,0.30)` (active speaker pulse)

---

## 6. 组件 状态

### 6.1 必须 处理 的 4 种状态
1. **空状态** — 没数据 时 显 explainer + CTA. e.g. 议题线 "暂无关联会议. 在会议详情页 链接 议题即可."
2. **加载态** — `加载中…` 文字 + `⏳` icon, 或 skeleton (Saga 后期 加)
3. **错误态** — 红色 chip + 错误 message (HTTP code / parse error / etc), 可重试
4. **禁用态** — opacity 0.5 + cursor: not-allowed, 不允许触发 onClick

### 6.2 反幻觉 状态 (NORTH_STAR § 7.5)
- **演示数据 pill** — Mock 兜底 时 必显. 紫 tint `rgba(94,92,230,0.18)` + 紫字 `#A78BFA`, 文字 e.g. "演示数据 · 暂无真实 workspace 数据"
- 当前 用 此 pattern 的 pane: `/workstation/topics` (无, 因为 纯真接 没 fallback) / `/workstation/tasks` (✓) / `/workstation/approve` (✓) / `/workstation/memory` (✓) / `/workstation/kb` (✓) / `/workstation/agents` (✓) / `/workstation/meeting` (✓) / `/workstation/meeting/[id]` (✓) / `/workstation` 心智一览 (✓ Sprint S1 新加)
- **不一致**: `/workstation/board` 真接 + fallback 但 没 演示数据 pill, 待修

### 6.3 移动 端 特殊状态
- safe-area 上下 (iPhone notch + home indicator)
- Pull-to-refresh (Saga 后期 加)
- offline / 网络弱 (Saga 后期 加)

---

## 7. 已 实现 的 设计

### 7.1 Web Workstation (✅)
- WPage 壳 + Sidebar + TopNav (R5.A)
- LineagePane Sankey (R5.B)
- MentalModelPane (4 拟物 + 钻取 drawer, Saga 心智一览 改造)
- TasksPane / KbPane / MemoryPane / ApprovePane / MeetingHistoryPane / MeetingDetailPane (Sprint 3 Web W2, 真接 + 演示数据 pill)
- Topics list + detail (NEW-B 新加)
- v1.4.0 心智一览 真接 count + me name (Sprint S1)

### 7.2 Web 会议室 (✅)
- R5.D 三栏布局 + TopBar (双 行) + AgendaTimeline + BottomBar
- 双 theme (浅 default + 深 S3TK 深邃星空) + ThemeToggle
- 灰海白岛 + 紫 hairline + active speaker 光带
- iOS scrollbar 美化 (mr-scroll)
- transcript 真接 (2.5s 轮询 api.getWebMeetingTranscript)
- 打字 InputBar + @ mention + 角色代发
- Superseded chip + 撤销 drawer (NEW-A 完整版)
- mic + STT WS (Phase A · 6 真接)

### 7.3 Mobile (✅)
- All 13 主 page 设计落地 (Saga M / N / O / P + Phase 1 修复)
- iOS Memory Radar SVG (6 轴, Saga O)
- M7 创会 modal (Saga P)
- 1-on-1 chat 浅色 iOS bubble (NEW-C 新加)
- FilePreview 3 tab (概要 / 章节 / 全文, Phase C · 12 新加)

### 7.4 dark mode 会议室 (✅)
- 设计稿 `S3TK_UXeBzGF0V_jQr4hLg` 完整 落地
- MR_TOKENS 双 theme + MRThemeToggle iOS segmented control
- prefers-reduced-motion 关 aurora (留 二期 加)
- starfield + aurora ambient (留 二期, 当前 仅 静态)

---

## 8. 还 没 实现 的 设计

### 8.1 Web Workstation
- ⏸ **AI 详情页 真接 (S2)** — radar / KB / memory / 出席 visualization 已 设计完, 但 数据 全 mock
- ⏸ **超管页 真接 (S4)** — 设计 已有 ws list, 但 数据 mock
- ⏸ **AI 市场 真接 (S5)** — 订阅 模型 + UI 设计 没出 (需 PM 拍 行为)
- ⏸ **AI 模板生成器 真接 (S5)** — backend `previewAgentTemplate` 已有 缺接

### 8.2 Web 会议室
- ⏸ **右栏 Mira 决策池 / 行动项 / Parking 真接 (S3)** — 三 section 设计完整 但 全 mock 数据
- ⏸ **左栏 议程 真接** — backend meeting.agenda JSON 已 落, frontend 没接
- ⏸ **左栏 专家时间线高光** — 设计有, 数据 全 mock

### 8.3 Mobile
- ⏸ **Custom 创会 tab** — 显示 已 设计, 提交 mock
- ⏸ **Mobile superseded 渲染** — 跟 Web 一致 灰化 + chip, 0.5d 工作量

### 8.4 二期 (Phase D)
- ⏸ **aurora 流光 / starfield 闪烁** — § 7.1.1 dark mode 设计 含, 当前 仅 静态 渐变
- ⏸ **会议室全屏 沉浸 modal** — 设计 有 "舞台模式" 浮窗 (PIP), 没做
- ⏸ **WebRTC 摄像头 + 举手** — 设计 落但 backend 没接
- ⏸ **声纹 streaming visualization** — 设计 有 (人头光环 +/- 强度), 当前 仅 sync 显
- ⏸ **NEW-A 完整版 多分支 历史 树** — drawer chain 走 线性, 没做 tree 视图

---

## 9. 哪些 设计 可以 根据 工程情况 适当 调整

### 9.1 可调
- **Custom 创会 tab 进度** — 设计 假设 PM 走 AI 路径 优先, Custom 可以 简化 demo 兜底
- **议题主题 跟 会议 关联 UI** — 设计 没出 NEW-B 跟 创会 modal 的 集成, Codex 可以 自己 设计 (建议: 创会 时 一 dropdown 选 topic, 详情页 顶 显 "议题: X →")
- **演示数据 pill 文案** — 当前 各 pane 文案 不一致 ("演示数据" / "演示数据 · backend 未接通" / "演示数据 · LLM 拆解待接"), 可以 统一

### 9.2 不可调 (设计稿 严格)
- iOS 系统色 + 系统圆角 — 跨平台 一致性, 改 必 PM 批
- W_TOKENS / MR_TOKENS / MR_COLORS **三套 隔离** — DESIGN_SYSTEM § 0.3 强 约束, 跨 import 严禁
- 反幻觉 演示数据 pill — NORTH_STAR § 7.5 truth, 不允许 mock 假装 真实
- agent 头像 渐变 (W_TOKENS / MR_TOKENS / AGENT_GLYPHS 三处一致) — 改 必 全端 同步

---

## 10. 关键 设计 / 代码 不一致 (DESIGN_SYSTEM § 0 + § 10)

> DESIGN_SYSTEM 是 **目标态**, 不是 现状描述. 已知冲突 7 处:

| 维度 | bundle 设计 | 现状 代码 | 解决方向 |
|------|----------|---------|---------|
| 色调 (Web 会议室) | iOS 浅色 单 theme | 双 theme (PM § 7.1.1 override) | ✅ 已 落地 双 theme |
| AI 头像 (跨端) | 圆角方形 渐变 + sparkle | 部分 还是 单色圆点 | 二期 统一 |
| Mira 视觉 (跨端) | 同心圆 头像 琥珀色 | 仅 role=moderator, 无独立视觉 | 二期 加 |
| 多 AI 圆桌 卡 | "AI 圆桌" 卡承载 N AI + Mira 综合 | 每 insight 独立 (旧 round-3 模式) | 二期 加 卡片 容器 |
| 偏离 3 级梯度 | soft / drift / drift-strong 视觉差大 | 4 banner + severe modal (emoji + 色) | 二期 重设 |
| 章节 导航 | timeline 自动 抽 "重要时刻" 列表 | 无 | 二期 |
| 多选 发言人 筛选 | 主持人 + 人 + AI 跨 scenario | FilterSheet 仅 列 部分 mock speakers | S3 修 + 数据 真接 |

---

## 11. 给 Codex 的 设计 建议

### 11.1 改 UI 前 必 读 (顺序)
1. `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` § 风格守门协议 (强约束, S 2.2 / S 7.1.1 / S 7.5 / S 8.8)
2. `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` § 0.3 (三套 token 隔离)
3. 改 文件 所在 端的 token 定义 (e.g. 改 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/app/workstation/**` 必 用 W_TOKENS)
4. 改 完 前 mental read 一遍 (中文表达 § 8.8 4 条规则)

### 11.2 改 Sprint S2-S5 时 的 mock 替换 准则
- **数据 真接 后 不删 mock 常量** — 留 fallback 兜底 (workspace 没数据时)
- **加 "演示数据" pill** — 跟 现有 pattern 一致 (紫 tint 11px 字号, 顶部 露出)
- **不动 视觉** — 仅 替 数据 source (W_PROFILES 改 `api.getAgent` + 数据 mapping), 不重设 layout / 颜色

### 11.3 改 设计 vs 改 代码 边界
- "更视觉化" 的 改动 (布局调整 / 新视觉) 必 sync PM 拿设计稿
- "数据 真接" 的 改动 (替 mock, 不动 layout) 可自主 ship, 走 风格守门 流程
- Codex 干 4d Sprint S2-S5 时 主要 是 数据真接, 不需要 PM 设计 review
