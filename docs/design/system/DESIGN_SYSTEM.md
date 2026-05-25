# aimeeting Design System v1

> **来源**: Claude Design handoff bundle (2026-05-25, `docs/design/handoffs/2026-05-25-meeting-room/`) + 现有 frontend 代码反推 (`frontend/src/`)
> **用途**: 后续每次 design 和 code 阶段的视觉/交互/产品约束 — "宪法"
> **更新机制**: 每个 Saga 收尾时反思,有新 pattern 沉淀进来
> **标注约定**:
> - `[bundle]` = 来自 Claude Design 新设计 (2026-05-25)
> - `[现有]` = 来自当前 frontend 生产代码
> - `[冲突]` = 两边视觉/概念有差,需 PM 决策 — 见第 10 节集合
> - 文件引用一律相对 repo 根, 行号精确到组件块

---

## 0. 两套设计的根本差异 (先看这个!)

| 维度 | `[bundle]` 新设计 (2026-05-25) | `[现有]` 生产代码 (v27.0-mobile) |
|------|------------------------------|--------------------------------|
| **色调** | iOS 浅色 (#F2F2F7 / #fff 背景) | 深色 (#0b0d12 `ink-950` 背景) |
| **底层语言** | iOS 系统色 + 系统圆角 + 系统字 | Tailwind 自定义 `ink` 灰阶 + `accent-500 #5b8def` 蓝 |
| **AI 专家头像** | 圆角方形 + 渐变 + sparkle 图形 (人 vs AI 强视觉区分) | 单色圆点/纯色块 + `◆` 字符 (AI/人 区分弱) |
| **主持人 Mira** | 同心圆头像 + 琥珀色 (`#FFB340 → #FF9F0A`) + 完整人格 | 仅作为 `role="moderator"` 的特殊 agent, 无独立视觉 |
| **多专家协作** | "AI 圆桌"卡片 + Mira 综合 (一卡承载 N 个专家) | 暂无 — 每个 insight 独立卡 |
| **偏离梯度** | 3 级 (soft/drift/drift-strong) — 视觉差异显著 | 4 类 banner + severe modal — 用 emoji + 颜色区分 |
| **章节导航** | 自动从 timeline 抽取的"重要时刻"列表 | 无 |
| **筛选** | 多选发言人 (主持人 + 人 + AI) + 跨场景 | 无 |

**核心冲突点 见第 10 节. 这一节只是先打个预防针 — DESIGN_SYSTEM 是 _目标态_, 不是 _现状描述_.**

---

## 1. 颜色系统

### 1.1 中性 + 系统色 (iOS 风, bundle 优先)

| Token | Hex | 用途 | 来源 |
|-------|-----|------|------|
| `ios.bg.canvas` | `#F2F2F7` | 整页 canvas / 转录流背景 | `[bundle]` `meeting-room.jsx:1617` |
| `ios.bg.surface` | `#FFFFFF` | 卡片 / sheet 表面 | `[bundle]` 通用 |
| `ios.bg.subtle` | `#F7F7F9` | 卡内嵌套数据块 (`data` rows) | `[bundle]` `meeting-room.jsx:655` |
| `ios.bg.lavender` | `#FAFAFA` | Accordion 展开背景 | `[bundle]` `meeting-room.jsx:139` |
| `ios.fg.primary` | `#1C1C1E` | 主文字 | `[bundle]` 通用 |
| `ios.fg.secondary` | `#3C3C43` | 次文字 / 数据值 | `[bundle]` 通用 |
| `ios.fg.tertiary` | `#8E8E93` | 标签 / 时间戳 | `[bundle]` 通用 |
| `ios.fg.quaternary` | `#C7C7CC` | disabled / chevron | `[bundle]` 通用 |
| `ios.divider` | `rgba(60,60,67,0.10)` | 0.5px hairline 分隔 | `[bundle]` 通用 |
| `ios.divider.strong` | `rgba(60,60,67,0.14)` | 卡片描边 | `[bundle]` 通用 |
| `ios.blue` | `#007AFF` | 链接 / 主 CTA | `[bundle]` 通用 |
| `ios.gray.4` | `#E5E5EA` | 进度 track / 未激活段 | `[bundle]` 通用 |
| `ios.gray.5` | `#D1D1D6` | sheet 把手 | `[bundle]` 通用 |

### 1.2 iOS 语义色

| Token | Hex | 含义 | 来源 |
|-------|-----|------|------|
| `green` | `#34C759` | success / 完成 / 真人 speaking | `[bundle]` 通用 |
| `red` | `#FF3B30` | error / 强提醒 / 结束 | `[bundle]` 通用 |
| `red.alt` | `#FF453A` | mute 标记 / off-topic 警示 | `[bundle]` |
| `red.pink` | `#FF375F` | 用户 CY 个人色 | `[bundle]` |
| `orange` | `#FF9F0A` | host 强调 / 时间紧 / 中度警示 | `[bundle]` 通用 |
| `orange.amber` | `#FFB340` | host 渐变浅端 / 软提醒 | `[bundle]` 通用 |
| `orange.darkAmber` | `#B8860B` / `#8B6914` | 软提醒文字 (在浅琥珀背景上) | `[bundle]` 通用 |
| `yellow` | (未独立) | — | — |
| `purple` | `#5E5CE6` | sparkle / @mention / AI 唤醒 | `[bundle]` 通用 |
| `purple.violet` | `#AF52DE` | AI 主渐变浅端 | `[bundle]` 通用 |
| `pink` | `#FF6482` | Lex 个人色 / 提醒 | `[bundle]` |
| `teal` | `#30B0C7` | 苏蕾个人色 | `[bundle]` |
| `cyan` | `#64D2FF` | Tally 个人色 | `[bundle]` `app.jsx:25` |

### 1.3 现有 Tailwind 调色板 `[现有]`

定义在 `frontend/tailwind.config.ts:1-26`:
- `ink.950 #0b0d12` (canvas) · `ink.900 #11141b` · `ink.800 #171b24` · `ink.700 #1f2430`
- `accent.500 #5b8def` (主 CTA) · `accent.400 #7ba2ff` (hover/text)

Insight type 配色 (`frontend/src/components/mobile/AIInsightCard.tsx:32-58`):
| Type | chip text | chip bg | border |
|------|-----------|---------|--------|
| 建议 | `violet-200` | `violet-500/15` | `violet-500/40` |
| 决策建议 | `emerald-200` | `emerald-500/15` | `emerald-500/40` |
| 风险 | `rose-200` | `rose-500/15` | `rose-500/40` |
| 洞察 | `sky-200` | `sky-500/15` | `sky-500/40` |
| 思路 | `amber-200` | `amber-500/15` | `amber-500/40` |

**[冲突 C1]**: bundle 是 light/iOS, 现有是 dark/Tailwind. 见第 10 节 C1.

### 1.4 AI 专家个人渐变 (bundle 内的"品牌色")

`[bundle]` `meeting-room-shared.jsx:14-18` 和 `app.jsx:20-26`:

| 专家 | 角色 | 渐变 from → to | 用于 |
|------|------|--------------|------|
| **Aria** | 数据分析师 | `#0A84FF → #5E5CE6` (蓝→紫) | 头像 / 卡片 strip / accent |
| **Stratos** | 产品策略 | `#AF52DE → #FF375F` (紫→粉) | 同上 |
| **Lex** | 法务合规 | `#FF9F0A → #FF6482` (橙→粉) | 同上 |
| **Sage** | UX 顾问 | `#FF2D55 → #AF52DE` (玫红→紫) | 同上 |
| **Tally** | 财务建模 | `#64D2FF → #0A84FF` (青→蓝) | `app.jsx:25` |
| **Scout** | 竞品研究 | `#34C759 → #30B0C7` (绿→青) | `app.jsx:22` |
| **Mira** (host) | 主持人 | `#FFB340 → #FF9F0A` (琥珀→橙) | 同心圆 + 卡片 |

**用法约定**:
- 头像背景 `linear-gradient(135deg, grad[0] 0%, grad[1] 100%)`
- AI 消息卡左侧 3px accent bar 用 `linear-gradient(180deg, ...)`
- note 块背景 `linear-gradient(135deg, grad[0]10, grad[1]10)` + `border 0.5px solid grad[0]33` (hex alpha)

### 1.5 真人个人色 (Voiceprint identity)

`[bundle]` `meeting-room-shared.jsx:4-10`:

| ID | 名 | 色 | 角色 |
|----|----|----|----|
| ZK | 周凯 | `#FF9F0A` 橙 | PM |
| LM | 林敏 | `#34C759` 绿 | 设计 |
| WJ | 王俊 | `#5E5CE6` 紫 | 工程 |
| CY | 陈宇 | `#FF375F` 粉红 | 工程 |
| SL | 苏蕾 | `#30B0C7` 青 | 研究 |

**约定**: 每个真人在 workspace 内分配一个 voice-print 色,头像用纯色填充 + 白色首字母. 同色不复用 (除非超 9 人需要二轮).

`[现有]` 类似但用 Tailwind 语义色名 `(violet|emerald|amber|sky|rose|teal|blue|indigo)` 存在 DB `agent.color` 字段,见 `frontend/src/components/mobile/SummonAgentSheet.tsx:19-28`、`AgentWorkCard.tsx:27-36`.

### 1.6 立场 (Stance) 三色 — AI 圆桌专用

`[bundle]` `meeting-room.jsx:40-41`:

| Stance | 色 | 字 | 形状 |
|--------|----|----|------|
| `support` 支持 | `#34C759` 绿 | "支持" | `✓` 勾 |
| `caution` 注意 | `#FF9F0A` 橙 | "注意" | `!` 叹号 |
| `block` 反对 | `#FF3B30` 红 | "反对" | `×` 叉 |

---

## 2. 字号体系

iOS 系统字体栈:
```
-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, system-ui, sans-serif
```
`[bundle]` 三个 HTML 都用同一份字体声明 (e.g. `Meeting Room.html:11`).

`[现有]` 用 Inter 通过 next/font (`tailwind.config.ts:20`),与 bundle 不一致 — 见 [冲突 C2].

### 字号阶 (iOS 风, bundle 实测)

| 名 | px | 用途 | bundle 例 |
|----|----|----|--------|
| `display` | 22-24 | (web) 极少用,通常给数字钟 | — |
| `largeTitle` | 24-26 | iOS large title (页头) | `frontend/PageHeader.tsx:66` 26px `[现有]` |
| `title2` | 19-20 | 章节分隔大标题 / "结束会议?" | `meeting-room.jsx:274` 17, web 19 |
| `title3` | 16-17 | 顶栏标题 / sheet title / item title | 通用 16-17 |
| `body` | 15 | 转录消息正文 | `meeting-room.jsx:563` 15 |
| `bodySm` | 14 | 卡内副文 / 按钮 / 数据值 | 通用 14 |
| `callout` | 13 | next-to-last 信息密度 | `meeting-room.jsx:152` 13.5 |
| `footnote` | 12 | 时间戳 / role 副标 | `meeting-room.jsx:560` 11 |
| `caption1` | 11 | 标签 / "已干预 3 次" | 通用 11 |
| `caption2` | 10 | uppercase eyebrow / `STANCE_LABEL` | `meeting-room.jsx:46` 10 |
| `nano` | 9-9.5 | 角标 / "AI" badge | `meeting-room.jsx:1333` 9 |

**约定**:
- 数字一律 `font-variant-numeric: tabular-nums` (倒计时 / 数据 / SLA / 余量)
- 字重: `400` body, `500` 强调, `600` 卡标 + 按钮, `700` eyebrow + 数字大值
- 行高: 转录文 1.45-1.55, 列表 1.35-1.5, 大标题 1.1-1.15
- letter-spacing: eyebrow 大写文字 `0.3-0.8` (e.g. "议程 2 / 4")

---

## 3. 间距规范

iOS 8-pt 栅格 (bundle 实测细化到 6-7px):

| Token | 值 | 用途 |
|------|----|----|
| `space.1` | 2-3 px | inline icon gap / 标签之间微距 |
| `space.2` | 4 px | 行内多个 chip 间距 |
| `space.3` | 6 px | 卡内 label + value 间 |
| `space.4` | 8 px | 默认 gap (icon ↔ text) |
| `space.5` | 10 px | 行高 / 卡内段落间距 |
| `space.6` | 12 px | 卡内主区段间 |
| `space.7` | 14 px | 卡片 padding (横向) `[bundle]` |
| `space.8` | 16 px | 全局 gutter (移动端) `[bundle]` |
| `space.padCard` | `11-14px` | 卡片内边 (`padding: '11px 14px'`) |
| `space.gutterWeb` | 20-28 px | Web 端横向 gutter |

**移动端约定**:
- 主滚动区横向 padding `16 px`
- 卡片内 padding `11-14 px`
- sheet 顶部 padding `14 16 8` (上左右下)
- 底部 safe area `paddingBottom: 26-34 px`

**Web 端约定**:
- 顶栏 padding `0 20 px`
- 三栏布局: 左 280 px / 中 flex / 右 340 px (bundle `meeting-room-web.jsx:366` 与 `:735`)
- 转录消息块 padding `8-10 px 28 px`,maxWidth 720 px (避免长行)

---

## 4. 圆角 + 阴影

### 4.1 圆角 (iOS continuous-corner 风格)

| Token | px | 用途 | 来源 |
|------|----|----|------|
| `radius.chip` | 3-4 | tiny stance pill | `meeting-room.jsx:48` |
| `radius.label` | 4-6 | 角标 / "AI" badge | 通用 |
| `radius.input` | 8 | 数据块 / chip pill 内嵌按钮 | 通用 |
| `radius.card` | 10-12 | 卡片基线 (web/mobile) | 通用 |
| `radius.cardLg` | 14 | 移动端转录卡 / sheet 顶圆角 | `meeting-room.jsx:209` |
| `radius.pill` | 全圆 (`9999px` 或 `50%`) | 头像 / status dot / live pulse | 通用 |
| `radius.actionBar` | 20 | 移动端底部 dock | `meeting-room.jsx:1366` |

### 4.2 阴影

| Token | 值 | 用途 |
|------|----|----|
| `shadow.flat` | `none` | 默认 — 卡片靠描边而非阴影 |
| `shadow.hair` | `0 1px 2px rgba(0,0,0,0.03-0.04)` | AI 消息卡 / web 卡 |
| `shadow.card` | `0 2px 8px rgba(0,0,0,0.04)` | 转录卡 / 圆桌卡 |
| `shadow.fab` | `0 4px 14px rgba(0,0,0,0.15)` | FAB 跳到底 / 浮按钮 |
| `shadow.dock` | `0 6px 22px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(60,60,67,0.12)` | 底部 action bar |
| `shadow.cta` | `0 2px 6px rgba(255,59,48,0.30)` 等 | 强 CTA — 用 CTA 自身色 30% alpha |

### 4.3 边框

- 几乎所有卡片用 `0.5px solid` (iOS hairline) — 不是 1px
- 描边色用 `rgba(60,60,67,0.12-0.14)` (近黑半透), 强调时换语义色 30-45% alpha

---

## 5. 字体 (font-family)

| 用途 | family | 来源 |
|------|--------|------|
| 默认正文 (bundle) | `-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, system-ui, sans-serif` | `[bundle]` 3 个 HTML |
| 默认正文 (现有) | Inter (via next/font) + `system-ui, sans-serif` fallback | `[现有]` `tailwind.config.ts:20` |
| 数字 / 倒计时 / 数据值 | 同上 + `font-variant-numeric: tabular-nums` | 通用 |
| 数字钟 (现有特性) | `"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, monospace` | `[现有]` `globals.css:127` |
| icon | inline `<svg>` (无 icon font) | 通用 |

**[冲突 C2]**: bundle 用 SF Pro 系统字, 现有用 Inter. 在浅色 iOS 风下 SF Pro 更原生, 但 dark mode 下 Inter 已经稳定. 见第 10 节.

---

## 6. 组件 patterns

### 6.1 头像 (Avatar) — `[bundle]` 三型分类

视觉信号是该设计的核心识别力之一. 三种参与者一眼区分:

| 类型 | 形状 | 填充 | 内容 | 文件 |
|------|------|------|------|------|
| **真人** | 圆形 | 个人纯色 (1.5 节) | 白色首字母 (中文取首字, 拉丁字母 upper) | `meeting-room-shared.jsx:169-205` `MRHumanAvatar` |
| **AI 专家** | 圆角方形 (`borderRadius = size * 0.28`, 最小 6) | 渐变 (1.4 节) | 白色 sparkle 图形 (双星) | `meeting-room-shared.jsx:207-226` `MRAIAvatar` |
| **主持人 Mira** | 圆形 | 同心圆 radial-gradient (`#FFB340 / #fff / #FF9F0A` 环带) | 无字符 | `meeting-room-shared.jsx:229-239` `MRHostAvatar` |

**真人附加状态** (`showStatus=true`):
- speaking: 外圈 2px `#34C759` + 4px `rgba(52,199,89,0.30)` 脉冲 (动画 `speakingPulse 1.2s`)
- muted: 右下角 42%×42% 红圆 + 白色斜杠麦克风 icon

**尺寸阶**: `18 / 22 / 26 / 28 / 30 / 32 / 36 / 40` px (按上下文密度选)

**[现有]** 当前所有 agent 都是同一个 `colorDot` 圆形 (`SummonAgentSheet.tsx:118-122`) + `◆` 字符,`AIInsightCard.tsx` 用 `◆ nickname · name` 文字标签代替头像 (无视觉头像). 这是 [冲突 C3].

### 6.2 卡片 (Card)

#### 6.2.1 AI 消息卡 `[bundle]`
位置: `meeting-room.jsx:610-699` (mobile) / `meeting-room-web-parts.jsx:113-196` (web)

视觉:
- `background: #fff`, `borderRadius: 14`, `border: 0.5px solid rgba(60,60,67,0.12)`
- 左侧 3px accent bar = AI 个人渐变 (180deg)
- header: 头像 (26-32px) + 名 + role + 唤醒方式 (`由 X 唤醒` / `由主持人转交`)
- body: 自由文本 (14-15 px, 行高 1.5-1.55)
- 可选 `data` 块: `#F7F7F9` 内嵌, 每行 label + 右对齐数值 (tabular-nums)
- 可选 `note` 块: 个人渐变 ×0.10 alpha 背景 + ×0.33 alpha 描边
- 可选 `actions`: 两个按钮 (primary `#007AFF` 蓝 / secondary 白底蓝字 + 描边)

#### 6.2.2 真人消息 (无卡片包裹) `[bundle]`
`meeting-room.jsx:552-597`
- 直接展示: 头像 (32px) + name/role/time + waveform (speaking 时)
- 文本 inline @mention 紫色高亮 (`renderTextWithMentions`)
- 下方可挂 inline meta chip: 唤醒 X / 向主持人提问 / **话题偏离当前议程** (红色)

#### 6.2.3 主持人 (Host) 卡 — 4 个 tone, 3 级偏离梯度 `[bundle]`
位置: `meeting-room.jsx:701-903` (核心), `meeting-room-web-parts.jsx:198-404` (web)

| Tone | 视觉 | 用途 |
|------|------|------|
| `agenda` | 居中 hairline + 大写 eyebrow `议程 X/N` + 大标题居中 + meta 行 | 议程切换 (替代显式卡片, 形成"章节分隔") |
| `drift-soft` (Level 1 软观察) | 紧凑内联条 `6 10px` padding, 左 2px `#FFB340` 边, 浅琥珀背景 `rgba(255,159,10,0.07)`, 小字 `#8B6914` | "苏蕾的发言偏离当前议程 · 持续观察中" |
| `drift` (Level 2 中度协商) | 完整卡片 `11 14px`, 琥珀渐变背景 + 0.5px 描边, 含 `compass` icon + 标题 + body + actions (橙色 primary `#FF9F0A`) | "讨论持续偏离 · 已 1 分 30 秒" |
| `drift-strong` (Level 3 强行打断) | 红色卡 `urgentPulse 2.2s` 动画 + 红渐变背景 + 1px 红描边 + 头像红角标 + 红 livePulse 7px 点 + **倒计时盒** (64px 宽白盒, 24px 红数字) + urgent 高度 38px 按钮 + 红 shadow | "议程将无法按时完成" |
| `route` | 同 drift, icon 换 `route`, 显示拆解 items (绿/橙状态圆 + label + loading dots + detail) | 主持人路由问题 |
| `timer` | 同 drift | 时间提醒 |

`[现有]` 等价物: `AgendaEventBanner.tsx` 用 emoji + 单层 tone (`bg-amber-500/10` 等), 没有 3 级梯度的视觉差.

#### 6.2.4 AI 圆桌 `[bundle]` (**新概念!**)
位置: `meeting-room.jsx:202-252` `RoundMessage` / `meeting-room-web-parts.jsx:497+`

结构 (一卡含 4 区):
1. **Header** (紫渐变背景): `sparkle` icon + `AI 圆桌 · {doneCount}/{total} 已答` eyebrow + 发起人 + 时间. 下方一行话题 `"...{topic}..."` (带引号)
2. **Mira 综合** (琥珀渐变背景): 头像 + "Mira 综合" + verdict pill (`可推进 · 注意法务节奏`) + (可选) "存在分歧" 红 badge. 下方 N 行 stance dot + tag + text. 最下白底圆角块 `→ 建议 ...`
3. **手风琴说明行**: `点击展开专家详情 · 一次只展开一位,timeline 不跳动`
4. **专家列表** (`ExpertAccordion`): 每行 = 头像 + 名 + stance pill + role + headline (1行). 点击展开 → 详细 summary + data grid + note 块. **timeline 不跳动** = 一次只展开一个,关一个开一个 (locked accordion).

**[新]** 现有代码无对应组件 — 见 [冲突 C5].

#### 6.2.5 章节分隔 (Chapter Divider) `[bundle]`
`meeting-room.jsx:255-286` `ChapterDivider`
- 上下 hairline `#C7C7CC` 0.5px + 中间 caption2 `议程 X / N`
- 居中 17px bold title
- meta 行: 时长 + 绿色 `议程 X-1 完成 ✓` + 时间戳

不是卡, 是 timeline 切片符 — 视觉上分隔不同议程的发言.

### 6.3 sheet (Bottom Sheet) — `[bundle]` 统一形态

位置: `meeting-room.jsx:315-383` 等多处.

固定结构:
- 遮罩 `rgba(0,0,0,0.32)` + `animation: fadeIn 180ms`
- 主体 `background: #F2F2F7`, `borderTopLeft/RightRadius: 14`, `paddingBottom: 34` (safe area), `maxHeight: 74%-82%`, `animation: slideUp 240ms cubic-bezier(.22,.61,.36,1)`
- 顶部把手: 36×5 px 圆条 `#D1D1D6`
- 标题栏 (三栏): 左 `清空/Width 50` · 中 16px 600 标题 · 右 `完成` 蓝字按钮 (`#007AFF`)
- 内容区 `padding: 4 16 0; overflow: auto`
- 内嵌 list 用白色圆角 12 块,行内 hairline 分隔

**用法** (bundle 5 个 sheet):
- `SummonSheet` 唤醒 AI 专家
- `AskHostSheet` 问主持人 (含 quick chips + textarea)
- `MoreSheet` 更多功能 (含一个 `wechat #07C160` 绿背景的 primary item)
- `FilterSheet` 筛选发言人 (含 host / humans / ais 三段)
- `HighlightsSheet` 章节 / 重要时刻

**[现有]** `SummonAgentSheet.tsx` 形态接近但深色, sheet 圆角 `rounded-t-3xl` (24px) — 比 bundle 的 14px 大. [冲突 C4 小].

### 6.4 Modal (居中弹窗) `[bundle]`

`meeting-room.jsx:1486-1524` `EndConfirm`:
- 遮罩 `rgba(0,0,0,0.4)`, `fadeIn 180ms`
- 主体 `280px` 宽, `top/left 50% translate(-50%, -50%)`
- `background: rgba(245,245,247,0.98); backdropFilter: blur(20px); borderRadius: 14`
- `popIn` 动画 `scale 0.85 → 1`
- 文字垂直居中, 下方两个等宽按钮 (`#007AFF` 取消 / `#FF3B30` 红色结束), 用 hairline 分隔

**[现有]** `SevereOffTopicModal.tsx` 形态等价但深色, `max-w-md`. 视觉风格不同但结构对应.

### 6.5 Banner / Toast / 状态条

- **Banner** `[bundle]` 没有顶部 banner, 因偏离/路由都进了 host card. **[现有]** `AgendaEventBanner.tsx` 是 sticky `top: 60` 的圆角条 + emoji + 标题 + body + 倒计时 + CTA. — 该 banner 在 bundle 设计里被吸收进 host card 的 `drift-soft/drift/drift-strong` 三级. [冲突 C7].
- **Filter Banner** `[bundle]` `meeting-room.jsx:1037-1087`:
  - `background: rgba(0,122,255,0.08)`, `borderBottom: 0.5px solid rgba(0,122,255,0.20)`
  - 一行 sticky 条: filter icon + "仅显示" + chips (头像 + 名 + ×) + `matched/total` + "清除" 文字按钮
- **Toast** `[现有]` `Toast.tsx`: 浮于 bottom + 圆角 12 + ✓/⚠ + 文字 + 2.5s 自闭. bundle 没有独立 toast (用 inline 反馈).

### 6.6 按钮 (Button)

#### Primary CTA `[bundle]`
- 高度 32-38 px (urgent 时 38)
- `borderRadius: 8-10`
- `background: #007AFF` (默认) / `#FF9F0A` (host) / `#FF3B30` (urgent)
- `color: #fff`, `font: 13-14 / 600`
- urgent 加 `boxShadow: 0 2px 6px <self>30%`

#### Secondary `[bundle]`
- 同尺寸但 `background: #fff` + `border: 0.5px solid rgba(60,60,67,0.16)`
- 文字色 `#007AFF` 或 `#B8860B` (host 场景) 或 `#1C1C1E`

#### Big AI primary (`PrimaryBtn`) `[bundle]`
`meeting-room.jsx:1438-1465`:
- 高度 52, 圆角 14, 渐变背景 + 30px 圆形 inline icon
- 两行: 14/700 label + 10.5/85% sub
- 用于 dock 上 "@ AI 专家" / "问主持人"

#### Control button (`CtrlBtn`) `[bundle]`
`meeting-room.jsx:1467-1483`:
- 高度 50, 圆角 12
- 默认 `bg #F2F2F7 + color #1C1C1E`
- active 时换 `activeBg` (`#FF3B30 muted` / `#FF9F0A hand` / `#007AFF cc`)
- 上 icon (18 px) + 下 10/600 label

### 6.7 Pill / Chip

| 形态 | 视觉 | 用途 |
|------|------|------|
| `StancePill` | `背景: stance color, color: white, padding: 1.5px 6px, radius: 3` | AI 圆桌专家立场 |
| `FilterBanner chip` | 白底 + 1px alpha border + 头像 + 名 + × | 已选筛选项 |
| `iOS segmented progress` | flex 段, `bg: #34C759 / linear / #E5E5EA`, height 4, radius 2 | 议程进度 |
| `Stage chip` `[现有]` | rounded-full + border + ` ✓ ●  ○ ` symbol + truncate label | `StageChipsRow.tsx:59-79` |

### 6.8 列表项 (List Row)

`[bundle]` 通用形态 (e.g. `HighlightsSheet` / `FilterSheet` / `MoreSheet`):
- 高度 `padding: 9-12px 14px`
- 左 icon 块 (32×32, radius 8) 或头像 (26-30)
- 中区 flex 1: title (13-15 / 500) + sub (11-12 `#8E8E93`)
- 右 chevron 16 px `#C7C7CC` 或 selection 框 (22×22 radius 6, 选中蓝色)
- 行间 `0.5px solid rgba(60,60,67,0.10-0.12)`,首行无 borderTop
- 整列包裹在 `background: #fff; borderRadius: 12; overflow: hidden` 容器内

---

## 7. 交互模式

### 7.1 Loading
- 三点动画 `<Dots />` `meeting-room.jsx:26-37` — 4×4 px 圆点, `dotBounce 1.1s` 错位
- inline 文字 "分析中" + Dots — AI 还在生成时
- "Mira 等待 2 位专家完成…" + Dots (圆桌 partial state)

### 7.2 Empty state
- 浅色版 `[bundle]`: 居中 60 32px padding, 14 px `#8E8E93`, 副字 12 `#C7C7CC` — "筛选后无发言 / 试试再勾选一些人"
- 深色版 `[现有]`: dashed border 圆角 + 居中文字, 见 `MeetingCarousel.tsx:120-128`

### 7.3 Confirm 弹窗 (危险操作)
- iOS 双键弹窗 (6.4) — 取消蓝色 / 危险红色 / 文字 17 px
- bundle 文案: "结束会议? / 主持人 Mira 会自动整理 AI 摘要、决策项与行动项,完成后发到群里。"

### 7.4 倒计时
- 普通 (host route): inline 数字 + dots
- 强提醒 (drift-strong): 64px 白盒 + 24px 红色 `tabular-nums` + label "议程剩余"
- severe modal `[现有]`: 居中 `Math.ceil(remaining)` + " 秒后自动召唤 X"

### 7.5 自动滚 + 跳到底 FAB
- `meeting-room.jsx:1606-1610`: scroll 监听 — 距底 <80 px 时 hide FAB
- FAB: 40×40 圆, 白底 shadow, 右下 `bottom: 178` (留 action bar 高度)

### 7.6 筛选交互
- Filter 触发: 顶栏 funnel icon (`MRIcon name="filter"`) + 蓝色 8×8 圆点角标 (已激活)
- 筛选时 timeline 头部出 FilterBanner (6.5)
- 多选: 任一勾选 → 仅显该人发言
- AI 圆桌特殊: 若任一 expert 被选中, 整卡显示且自动展开该专家 accordion

### 7.7 章节跳转
- jumpTo(idx) 行为: `scrollTo({ top, behavior: 'smooth' })` + 200ms 后 `background: rgba(0,122,255,0.10)` 高亮 + 1100ms 后退回
- 高光列表来源: 自动从 timeline 提取 4 类节点 (`getHighlights()`):
  - `agenda` → 议程切换 (绿 ✓)
  - `drift-strong` → 强提醒 (红 compass)
  - `drift` → 偏离提醒 (橙 compass)
  - `route` → 问题路由 (橙 route)
  - `round` → AI 圆桌 (紫 sparkle)

---

## 8. 动画规范 (timing + easing)

`[bundle]` `meeting-room.jsx:1723-1751` 完整定义:

| 名 | duration | easing | 用途 |
|----|----------|--------|------|
| `fadeIn` | 180 ms | `ease` | 遮罩 / FAB 出现 |
| `slideUp` | 240 ms | `cubic-bezier(.22, .61, .36, 1)` | sheet 从底部弹起 |
| `popIn` | 200 ms | `cubic-bezier(.22, .61, .36, 1)` | modal 居中弹出 (scale 0.85 → 1) |
| `wfBar` | 900 ms | `ease-in-out` (alternate, `i * 110ms` 延迟) | 真人 speaking 波形 (5 条) |
| `dotBounce` | 1.1 s | `ease-in-out` (`i * 180ms`) | loading 三点 |
| `livePulse` | 1.4 s (web) / 1.2 s (urgent) | `ease-in-out` | 实时红点 / 强提醒小点 |
| `speakingPulse` | 1.2 s | `ease-in-out` | 真人头像外圈呼吸 (8 → 0 alpha) |
| `urgentPulse` | 2.2 s | `ease-in-out` | drift-strong 卡片整体红光呼吸 |
| `transform.toggle` | 180 ms | `ease` | chevron 旋转 (0 → 90deg) |

`[现有]` 额外动画 `globals.css:46-156`:
- `focusGlow` 紫色卡片呼吸
- `slideInRight` / `slideInDown` 右栏 / 顶栏 slide-in
- `ringPulse` AI 头像思考中呼吸
- `overtimePulse` 议程超时闪烁
- `ai-gradient-flow` 6s — Hero CTA 多色渐变流动
- `ai-sparkle` 3s — sparkle 点闪
- `clock-glow-green/amber/red` — 数字钟发光三态

→ **现有动画体系比 bundle 更丰富,但 bundle 没用渐变流动 + glow,视觉更克制**.

### 滚动条
两边都用 `div::-webkit-scrollbar { display: none }` 隐藏 (`meeting-room.jsx:1751` + `globals.css:159-172` 现有有可选 thin scrollbar).

---

## 9. 核心产品概念 (重要!)

bundle 设计抽出的 6 个新概念,**必须沉淀到代码里**.

### 9.1 AI 专家系统 (6 人)

`meeting-room-shared.jsx:14-18` (会议室核心 4 人) + `app.jsx:20-26` (全集 6 人):

| 专家 | 角色 | 入场场景 |
|------|------|----------|
| **Aria** | 数据分析师 | "@Aria 帮我看下 P95" / 数据复盘 |
| **Stratos** | 产品策略 | 路线图 / 优先级决策 |
| **Lex** | 法务合规 | 隐私 / 用户同意 / 合同 |
| **Sage** | UX 顾问 | 用户研究 / 访谈洞察 |
| **Tally** | 财务建模 | 成本估算 / ROI |
| **Scout** | 竞品研究 | 客户访谈 / 行业对标 |

**约定**:
- 每个专家有 fixed nickname (英文) + Chinese role label
- 渐变色 fixed (1.4 节)
- 在 timeline 出现的形态: `AIMessage` (1 v 1) / `RoundMessage`.experts[] (1 v N)
- 唤醒方式: `via.kind = 'summon'` (人 @召) 或 `'host'` (Mira 拆问题转交)

`[现有]` 对应: backend `agent.name` + `agent.nickname` + `agent.color` + `agent.role`. 概念兼容, 但 6 个 fixed 名字 vs 现有 workspace 可自定义 — 见 [冲突 C8].

### 9.2 主持人 Mira

`meeting-room-shared.jsx:21-25`:
```
name: 'Mira', role: '会议主持人',
grad: ['#FFB340', '#FF9F0A'],
desc: '管议程 · 提醒走神 · 拆问题转给 AI 专家',
```

**Mira 的 4 类输出** (`HostMessage` tones):
1. `agenda` — 议程切换 (变成 ChapterDivider)
2. `drift` (含 3 级: `drift-soft` / `drift` / `drift-strong`) — 偏离提醒
3. `route` — 拆解请求, 把子问题派给具体 AI 专家
4. `timer` — 时间提醒

**3 级偏离梯度** (核心创新):

| 级 | 触发 | 视觉强度 | 用户动作 |
|----|------|---------|----------|
| **Level 1 软观察** (`drift-soft`) | 单次跑题 | 紧凑内联条, 浅琥珀 | 仅记录, 无 CTA |
| **Level 2 中度协商** (`drift`) | 持续 1-2 min | 卡片 + 三选 actions (记入 parking / 改为议程 / 再讨论 1min) | 用户选 |
| **Level 3 强行打断** (`drift-strong`) | 连续 ≥ 2:30 + 议程剩余 < N | 红卡 + urgentPulse + 倒计时 + 双 CTA (`立即记入 parking 回原议程` 红 urgent / `议程顺延 5 分钟`) | 用户必须二选一 |

`[现有]` `SevereOffTopicModal` ≈ Level 3 但是全屏 modal (强制决策) + 5-30s 自动召主持人. bundle 设计的 Level 3 是 inline 红卡, 不阻塞滚动 — [冲突 C6].

### 9.3 AI 圆桌 (Multi-Expert Roundtable)

**新概念** — 一次召唤多个专家给出多视角综合答复.

数据形态 (`MR_MESSAGES` index 14, `meeting-room-shared.jsx:113-162`):
```js
{ kind: 'round',
  topic: '把 B 组灰度到 20%,可推进吗?',
  trigger: { kind: 'summon', by: 'ZK' },
  experts: [
    { who: 'ARIA', stance: 'support', headline, summary, data, note },
    { who: 'LEX',  stance: 'caution', ... },
    { who: 'SAGE', stance: 'support', ... },
  ],
  miraSummary: {
    verdict: '可推进 · 注意法务节奏',
    conflict: false,
    points: [{ stance, tag, text }, ...],
    recommendation: '...',
  },
}
```

**UI 关键**:
- 折叠成 _单卡_ — 多专家不拍 timeline (避免视觉跳动)
- Mira 综合永远在顶 (可见性优先于专家详情)
- 专家详情用 accordion 手风琴, 一次只展开一位
- timeline 不跳动 (accordion locked, scroll position 不变)

`[新, 现有代码 0 实现]` — 见 [冲突 C5].

### 9.4 章节导航 (Highlights / Chapters)

从 timeline 自动提取 5 类关键节点:
- 议程切换 (绿 `check`)
- 强提醒 (红 `compass`)
- 偏离提醒 (橙 `compass`)
- 问题路由 (橙 `route`)
- AI 圆桌 (紫 `sparkle`)

入口: 顶栏 hamburger-with-dots icon (`meeting-room.jsx:424-427`)
形态: bottom sheet 列表, 点击 → 平滑滚动到位 + 200ms 高亮

`[新]` — 现有无此功能.

### 9.5 多维筛选 (Speaker Filter)

按发言人多选筛选 timeline. 三段:
- 主持人 (Mira)
- 团队成员 (5 真人)
- AI 专家 (6 人)

筛选状态:
- 顶栏 funnel + 蓝色 8×8 角标 (已激活)
- 顶部 sticky FilterBanner: filter icon + "仅显示" + 选中 chips (头像+名+×) + `matched/total` + "清除"
- AI 圆桌特殊匹配规则: 任一被选 host/expert 命中,整卡显示, 命中的 expert accordion 自动展开

约定: **会议中和会后归档共用同一套筛选 UI**.

`[新]` — 现有无对应组件.

### 9.6 议程时间线 (Web) + 议程进度条 (Mobile)

**Mobile** `[bundle]` `AgendaStrip` (`meeting-room.jsx:448-487`):
- 顶部 row: `议程 X/N` + 当前 title (truncate) + `剩 X 分钟` (橙)
- 下方 segmented progress: flex 比例 = `minutes`, height 4, radius 2
  - done: `#34C759`
  - active: `linear-gradient(90deg, #007AFF 70%, rgba(0,122,255,0.25) 70%)` — 70/30 ratio 显示当前已用 vs 剩余
  - pending: `#E5E5EA`

**Web** `[bundle]` `AgendaTimeline` (`meeting-room-web.jsx:71-181`):
- 高 44 px 的 N 个段落, 每段宽 ∝ `minutes`
- 状态色: done 绿渐变背景 / active 白底蓝描边 + 渐变填充 fillPct% / pending 白底淡灰 + opacity 0.65
- 每段顶 eyebrow `议程 X` + status icon + title (truncate) + bottom meta `剩 X 分 · X/Y min`
- 点击段落 → 跳转到对应 transcript 位置

**[现有]** `StageChipsRow.tsx` 是横滑 chip pills, 不是段进度条. [冲突 C9].

---

## 10. Bundle 与现有代码的冲突清单 (**用户决策必读**)

| ID | 维度 | bundle (新) | 现有 (生产) | 影响 | 建议决策 |
|----|------|------------|------------|------|----------|
| **C1** | 色调 (整体) | iOS 浅色 (`#F2F2F7` canvas, `#fff` 卡) | dark mode (`#0b0d12` canvas, `#11141b` 卡) | 重写所有 mobile 组件的色板 | **必决** — 是否切换到 light? 还是浅色仅用于会议室、其余维持 dark? |
| **C2** | 字体 | SF Pro 系统字 (iOS 原生) | Inter (next/font) | 中文渲染差异 / iOS 像素吸附差异 | 建议 light 切换 时一并改 SF Pro |
| **C3** | 头像系统 | 真人圆形 + AI 圆角方形渐变 + Host 同心圆 — 三型强区分 | 所有 agent 统一圆形纯色 + `◆` 字符 | 区分度差 = 现有方案;新方案需写 3 个 React 组件 (`HumanAvatar` / `AIAvatar` / `HostAvatar`) | **强建议接受** bundle — 这是核心识别力 |
| **C4** | Sheet 圆角 | 14 px | 24 px (`rounded-t-3xl`) | 视觉风格细差 | 跟整体调性选 — light 走 14, dark 现状 24 |
| **C5** | AI 圆桌 | 整卡 + Mira 综合在顶 + 专家手风琴 + timeline 不跳动 | 不存在 | 新增 1 个核心组件 + 后端事件流支持 | **必决** — 接受 = 大动作, 拒绝 = 多专家咨询体验回到单卡瀑布 |
| **C6** | 偏离提醒梯度 | 3 级 (soft inline / drift card / strong inline 红卡 + urgent pulse) | 4 种 banner emoji + severe full-screen modal | 体验差异: bundle 不阻塞滚动, 现有 modal 强阻塞 | **必决** — Modal 强决策 vs inline 梯度 |
| **C7** | Banner 位置 | 偏离 / 路由全部进 host card | sticky `top: 60` banner (单 slot 新覆盖旧) | 信息层级不同 | 跟 C6 一起决 |
| **C8** | AI 专家是否预设 | bundle 固定 6 名 (Aria/Stratos/Lex/Sage/Tally/Scout) | workspace 可自定义 agent (DB 表), nickname 用户填 | 命名权 | **建议保留现有动态** + 默认 seed 6 个 bundle 同名 agent, 用户可改 |
| **C9** | 议程进度可视化 | mobile: segmented bar / web: 44px 段落 timeline | mobile: 横滑 chip pills (`StageChipsRow`) | 风格差异较大,信息密度也不同 | **建议接受** bundle (更密 / 信息更全 / 跟时间预算挂钩) |
| **C10** | "主持人 Mira" 实体化 | Mira 是有人格 / 头像 / 个性的"角色" | 后端有 `role="moderator"` 的 agent, 前端无独立视觉 | 用户感知 |  **建议接受** bundle — Mira 一旦视觉化, AI 圆桌 / 偏离梯度 才能讲通 |
| **C11** | 章节导航 | 自动抽取 5 类节点 + sheet 列表跳转 | 无 | 长会议导航效率 | 新功能 — 先做 backend `highlight_events` 接口 |
| **C12** | 多维筛选 | 多选 host + humans + ais, 会议中/归档共用 | 无 | 中长会议可读性 | 中等优先 — 长会议必要 |
| **C13** | `@专家` 唤醒入口 | 大紫色 `PrimaryBtn` 52 高 占主 dock 一半位置 | `SummonAgentSheet` 普通入口, 通过 `StickyActionBar` 二级触发 | 唤醒 affordance — bundle 把"召专家"提为一级 | **建议接受** — 这是 product 卖点 |
| **C14** | 用户身份色 | 5 个 fixed iOS 系统色 (per voice-print) | DB `agent.color` 8 种 (`violet/emerald/...`) | 颜色一致性 | 现有方案足够, 但建议扩到 9 个并跟 bundle 命名对齐 |
| **C15** | 字体 family 命名 | inline (`-apple-system,...`) | `var(--font-inter)` via next/font | tooling | 跟 C2 |
| **C16** | Toast 形态 | 没有独立 toast (用 inline 反馈) | `Toast.tsx` 浮于 sticky bar 上 2.5s | 反馈层 | 现有 toast 保留 |
| **C17** | "AI" badge | 紫渐变小 badge (`linear-gradient(135deg, #AF52DE, #5E5CE6)` + 9px white) | 现有无 — `nickname · name` 文字标识 | 视觉 hierarchy | **建议接受** bundle 的 badge |
| **C18** | 数字钟 | 普通 `tabular-nums` + 大字 | `clock-tone-normal/warning/overtime` glow 三态 + monospace 字体 | bundle 设计无明显数字钟需求 (会议室倒计时仅 1 处, 24 px 红字) | 保留现有 (`globals.css:118-156`), bundle 没新需求覆盖 |
| **C19** | 移动端整体壳 | `IOSDevice` 含状态栏 + Home indicator (iOS 模型) | `MobileShell` fixed-inset + locked viewport (针对微信 WKWebView 弹性滚动) | 落地差异: bundle 是设计稿 mock 壳, 现有是真实运行环境 | 不冲突 — `IOSDevice` 仅 mock, 实际不用 |
| **C20** | BottomNav | bundle 会议室无 BottomNav (沉浸式) | 4 主 tab 有 BottomNav, 会议室页隐藏 (`MobileShell` 判断) | 一致 — 会议室都沉浸 | 无需决策 |

---

## 附录 A · 来源索引 (常用)

| 主题 | bundle 位置 | 现有代码位置 |
|------|------------|------------|
| iOS 色板定义 | `meeting-room-shared.jsx:4-26` | `tailwind.config.ts` |
| 真人头像 | `meeting-room-shared.jsx:169-205` | — (不存在) |
| AI 头像 | `meeting-room-shared.jsx:207-226` | `SummonAgentSheet.tsx:118-122` |
| Host 头像 | `meeting-room-shared.jsx:229-239` | — (不存在) |
| Icon 集 (27 个) | `meeting-room-shared.jsx:241-269` | inline emoji + svg 散落 |
| AI 消息卡 | `meeting-room.jsx:610-699` | `AIInsightCard.tsx` (类似但 dark) |
| 真人消息 | `meeting-room.jsx:552-597` | `MeetingTranscriptView.tsx` |
| Host 卡 (4 tones × 3 级) | `meeting-room.jsx:701-903` | `AgendaEventBanner.tsx` + `SevereOffTopicModal.tsx` |
| AI 圆桌 | `meeting-room.jsx:131-252` | — (不存在) |
| 章节分隔 | `meeting-room.jsx:255-286` | — (不存在) |
| Highlights sheet | `meeting-room.jsx:315-383` | — (不存在) |
| Filter sheet | `meeting-room.jsx:936-1034` | — (不存在) |
| Filter banner | `meeting-room.jsx:1037-1087` | — (不存在) |
| Summon sheet | `meeting-room.jsx:1090-1147` | `SummonAgentSheet.tsx` |
| Ask host sheet | `meeting-room.jsx:1159-1269` | — (不存在) |
| More sheet | `meeting-room.jsx:1272-1349` | — (不存在) |
| 底部 ActionBar | `meeting-room.jsx:1352-1483` | `StickyActionBar.tsx` |
| 议程进度条 (mobile) | `meeting-room.jsx:448-487` | `StageChipsRow.tsx` (不同形态) |
| 议程时间线 (web) | `meeting-room-web.jsx:71-181` | — (无 web 会议室) |
| Web 三栏 | `meeting-room-web.jsx:362-377` 左 / 中 / `:732-752` 右 | — (无 web 会议室) |
| Mira live 卡 | `meeting-room-web.jsx:755-795` | — (不存在) |
| 决策 / 行动项 / parking lot / refs 面板 | `meeting-room-web.jsx:705-731 + RightPanel` | scattered, mostly backend |
| 动画 keyframes | `meeting-room.jsx:1723-1751` | `globals.css:46-156` |
| Insight 5 类型 + 配色 | — (bundle 没用 5 类 insight type 概念) | `AIInsightCard.tsx:32-58` |

---

## 附录 B · 移动端整体布局规范

`[bundle]` `meeting-room.jsx:1612-1721` `App`:
```
IOSDevice (402 × 874 — iPhone 14/15 Pro 模型)
└─ root flex column, bg #F2F2F7
   ├─ MRHeader (paddingTop 54 statusBar + 44 nav)
   │   ├─ 左 ← 历史
   │   ├─ 中 标题 + 实时红点 + 时间
   │   ├─ 右 章节 + 筛选 (with 蓝角标)
   ├─ AgendaStrip (议程 strip + segmented bar)
   ├─ ParticipantsStrip (横滑头像列)
   ├─ scroll area (flex 1, paddingBottom 200)
   │   ├─ FilterBanner (sticky, 仅 selected 非空)
   │   ├─ N messages (HumanMessage / AIMessage / HostMessage / ChapterDivider / RoundMessage)
   │   └─ 末尾 "X 正在说话" + Waveform
   ├─ Jump FAB (滚离底时显, right 14 bottom 178)
   ├─ ActionBar (absolute bottom, 渐变背景遮罩)
   │   ├─ Row 1: @AI 专家 / 问主持人 (两个 PrimaryBtn 渐变大按钮)
   │   └─ Row 2: 麦 / 视频 / 举手 / 字幕 / 更多 / 结束 (6 个 CtrlBtn)
   └─ Modals (SummonSheet / AskHostSheet / MoreSheet / FilterSheet / HighlightsSheet / EndConfirm)
```

---

## 附录 C · Web 端整体布局规范

`[bundle]` `meeting-room-web.jsx`:
```
1440 × 900 stage
└─ flex column
   ├─ TopBar (Row 1 chrome 48 高: 返 + 标题 + 实时 + people micro + filter/invite/gear + 红色 [结束会议])
   │  └─ AgendaTimeline (Row 2: 议程横向时间线, 高 44, 段宽 ∝ minutes)
   ├─ ExpertDock (68 高: 在场 AI 阵容 — Mira + 4 ExpertPill + 添加专家虚线按钮 + 右侧 "@唤醒"hint)
   └─ flex row (主体, flex 1)
      ├─ LeftPanel (280 宽, #FAFAFA, borderRight)
      │   ├─ ExpertsPanel — 多选专家卡
      │   └─ TimelineHighlights — 5 类节点列表
      ├─ TranscriptCenter (flex 1, #fff)
      │   └─ messages stream (WebHumanMessage / WebAIMessage / WebHostMessage / RoundMessage)
      └─ RightPanel (340 宽, #FAFAFA, borderLeft)
          ├─ MiraLive — Mira 当下监测状态卡
          ├─ DecisionPool — 决策池
          ├─ ActionList — 行动项
          ├─ ParkingLotPanel — 待办停车场
          └─ ReferencesPanel — 参考资料
```

**[关键]** 现有项目没有 Web 端会议室 — 目前桌面端是 PM 用的 management dashboard, mobile/小程序是参会者用的. 若要落地 Web 端会议室 = **新页面**.

---

## 附录 D · 使用本文档的建议

1. **每次开新 design Saga 前**, 先读第 9 节 (核心概念) + 第 10 节 (冲突表) — 知道哪些是已定的"宪法",哪些还需要 PM 拍板.
2. **每次开 code 实施前**, 查附录 A 找精确的 bundle 源,优先 1:1 移植视觉, 再考虑接现有数据流.
3. **新组件实现完**, 反推到本文档 — 如发现 bundle 没覆盖的形态,新增到对应章节并标 `[新增于 Saga X]`.
4. **冲突清单 C1-C20** 一旦决策, 在本文档对应行加 `**决策**: ...` 行, 记录决策时间 + PR.
5. 若 bundle 与现有冲突外又出现 _第三种_ 形态, 必须在本文档第 10 节新增 C-ID 条目.

---

> **本文档不是终态** — 是 Saga 起点. 每个 Saga 结束做 retro 时, 必须问: "我们引入的新 pattern / 修订的旧 token 沉淀了吗?"
