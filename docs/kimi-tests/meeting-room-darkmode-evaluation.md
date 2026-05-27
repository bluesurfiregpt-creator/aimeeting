# 会议室 Web 深色版本 设计稿 vs NORTH_STAR § 7.1 评估报告

**日期**: 2026-05-28
**评估人**: Claude (subagent)
**评估对象**: PM 提供的新设计稿 `Meeting Room (Web).html` (深色) + `Meeting Room (Web) v1.html` (浅色, 老版备份)
**Design bundle**: `https://api.anthropic.com/v1/design/h/S3TK_UXeBzGF0V_jQr4hLg?open_file=Meeting+Room+%28Web%29.html`
**本地解压**: `/tmp/design-extract/aimeeting/`
**核心问题**: 设计稿引入了"深色版本", 跟 NORTH_STAR § 7.1 "不做 dark mode" 是否冲突?

---

## TL;DR (一段扫读)

PM 在 chat6.md (2026-05-27 16:15 UTC) **明确口述** 了:
> **"那这一版本干脆定义为深色版本。之前设计那一版定义为浅色版本，把深色浅色的控件开关也同步出现在会议室界面。"**

设计稿是**双 theme 共存** (浅色 + 深色, 通过 ThemeToggle 切换), **不是** 替换浅色. 这跟 § 7.1 "不做 dark mode" 的字面表述冲突, 但本质上是 **PM 在新会话里 override 了 § 7.1 关于会议室的子约束** (round-3/4 当年浅色化也是 PM 拍板). 因此:

- **冲突等级**: **轻微 → 走 [STYLE-DEVIATION]**, **但必须 PM 在 NORTH_STAR.md 显式 override § 7.1**
- **推荐路径**: **走 W_THEME 接入 + § 7.1 升级到 v1.2.3 (PM 拍板新增 "会议室例外: 浅色 default + 深色 opt-in")**
- **不要直接实施**, 等 PM 在 NORTH_STAR 落字, 再做

---

## Step 2 · 5 个问题 答案

### 1. README 完整复述 + 设计 intent

**`aimeeting/README.md`** (handoff 通用):
> 这是从 claude.ai/design 导出的设计稿. 用户在 HTML/CSS/JS 里做了 mockup, 让 coding agent 实施. **重点读 `chats/`** — chat 是 intent live 的地方, HTML 是产出.

**`aimeeting/project/README.md`** (项目 README):
> 入口文件: `Meeting Room (Web).html` = Web 版「会议室」(1440×900 桌面端). **README 没提任何关于 dark mode 或主题切换的设计原则**, 仅描述 AI 专家 / 主持人 Mira / 偏离提醒梯度 / AI 圆桌等内容.

**关键 design intent (从 chat6.md 抓取, PM 原话)**:

PM 第一句:
> "我们还是把会议室中间的舞台中央的效果重新打造一下吧。目前的效果，感觉中间部分和四周都融为一体，感觉内容不是很突出 ... 中间部分应该颜色要深邃一些。给人感觉有无限的遐想、无限的内容在里面"

PM 第二轮:
> "中间舞台中央和四周交界界面感觉过于生硬，缺乏一些融入性 ... 真正的「围绕着舞台开展设计」的感觉。另外，我发现上方的会议议程进度条的进度填充，颜色过淡了"

PM 第三轮 (**关键 — 双 theme 拍板**):
> **"那这一版本干脆定义为深色版本。之前设计那一版定义为浅色版本，把深色浅色的控件开关也同步出现在会议室界面。"**

**所以设计 intent 是 "新增 深色 主题 (浅色 保留 + 用户 可切换)" — 不是 替换.**

### 2. 新设计 vs R5.D 浅色 的 关系

**答**: **双 theme 共存** (option 2). 证据:

- 两个 HTML 文件并列存在:
  - `Meeting Room (Web) v1.html` — `<title>会议室 Web · Q3 路线图对齐 · 浅色</title>` · body bg `#1A1A1F` (其实是浏览器外壳, 内容浅色) · 加载 `meeting-room-web-parts.v1.jsx` + `meeting-room-web.v1.jsx`
  - `Meeting Room (Web).html` — `<title>会议室 Web · Q3 路线图对齐 · 深色</title>` · body bg `#03050E` · 加载 `meeting-room-web-parts.jsx` + `meeting-room-web.jsx`
- 两个 JSX 共存 (没删 v1):
  - `meeting-room-web-parts.v1.jsx` / `meeting-room-web.v1.jsx` (老浅色)
  - `meeting-room-web-parts.jsx` / `meeting-room-web.jsx` (新深色)
- **`ThemeToggle` 组件** (`meeting-room-web.jsx:104-147`) 双向跳转:
  - 浅色 (`current === 'light'`) → 点深色 = `window.location.href = 'Meeting Room (Web).html'`
  - 深色 (`current === 'dark'`) → 点浅色 = `window.location.href = 'Meeting Room (Web) v1.html'`
  - 浅色 active 时颜色 `#FFB340` (iOS 琥珀), 深色 active 时 `linear-gradient(135deg, #5E5CE6, #7A5AF0)` (紫渐变)
- chat6.md 最后 PM-Assistant 总结确认: "**Both versions now coexist** with a synced theme toggle"

### 3. layout 结构 vs 现有 R5.D 一致性

**答**: **结构 100% 一致**, 只是配色变. 组件 1:1 映射:

| 现有 R5.D 文件 (frontend) | 设计稿 函数 (meeting-room-web.jsx) | layout 角色 |
|---|---|---|
| `MRTopBar.tsx` | `TopBar` (line 149) | 顶 Row1 logo+面包屑+LIVE+timer+people-strip + **ThemeToggle 新加** + filter/invite/end |
| (含在 TopBar) | `AgendaTimeline` + `AgendaSegment` (line 241/279) | Row2 议程时间线 4 段 (PM 第二轮要求 进度填充加深) |
| `MRTopBar.tsx` Row2 (PeopleMicroStrip) | `PeopleMicroStrip` (line 383) | 在场真人 avatar 微条 |
| `MRLeftPanel.tsx` | `LeftPanel` (line 565) | AI 专家 + timeline highlights 左栏 |
| `MRLiveView.tsx` (center) | center stage `<div>` (line 1742-1814) | 中心 transcript + 星空 ambient + filter banner + input bar |
| `MRMessages.tsx` / `MRRealMessages.tsx` | `WebHumanMessage` / `WebAIMessage` / `WebHostMessage` / `WebRoundMessage` (parts.jsx) | 4 种 message 渲染器 |
| `MRRightPanel.tsx` | `RightPanel` (line 948) | 决策池 / 章节 / 知识库 等右栏 |
| `MRBottomBar.tsx` | `BottomBar` (line 1463) | 麦/视频/举手/CC + ExpertDock |
| `MRInputBar.tsx` | `InputBar` (line 1356) | 输入框 (深色版加 luminous focus border) |
| `MRFilterBanner.tsx` | `FilterBanner` (line 1313) | 筛选 banner |
| `OrchestrateStatusBanner.tsx` | (未在新设计稿出现) | (Saga E.E 后置, 不在 mockup 范围) |
| `tokens.ts` (MR_TOKENS) | inline 散落 hex | **需扩 dark token 集** |

**结论**: **0 个新组件**, **0 个组件需删除**, **0 个新 layout structure** — 改动仅 "色 + ambient". 工作量主要在 tokens.ts 扩 dark + 组件内根据 theme 切色.

### 4. 关键 CSS 变量 / 色值 (深色版)

**Stage / 中心舞台**:
- 中心 bg: `linear-gradient(180deg, #060818 0%, #0A0E22 50%, #060818 100%)` + 3 层 radial-gradient aurora (紫顶 `rgba(94,92,230,0.28)` / 蓝右下 `rgba(10,132,255,0.22)` / 紫粉左下 `rgba(175,82,222,0.16)`)
- 外层 MeetingRoom bg: `#05071A` (line 1726)
- body bg: `#03050E` (HTML line 10)

**Top bar**:
- bg: `linear-gradient(180deg, #0B0F26 0%, #080B1F 100%)`
- border-bottom: `0.5px solid rgba(124,92,250,0.18)` (紫色微边)
- shadow: `0 1px 0 rgba(124,92,250,0.10), 0 8px 24px rgba(0,0,0,0.30)`

**Left / Right Panel (instrument walls)**:
- bg: `linear-gradient(90deg, #060818 0%, #0A0D24 100%)` (Left)
- 内边光晕: `linear-gradient(90deg, transparent, rgba(124,92,250,0.10))` (跟中心 stage 融入)

**Agenda Timeline (议程进度条 — PM 第二轮要求 颜色变深邃 vivid)**:
- 进行中段 fill: `linear-gradient(90deg, rgba(124,92,250,0.55), rgba(94,92,230,0.45) 60%, rgba(10,132,255,0.35))`
- 进行中 leading edge (playhead): `linear-gradient(180deg, rgba(255,255,255,0), #B9A0FF 30%, #B9A0FF 70%, rgba(255,255,255,0))` + glow `0 0 12px #B9A0FF`
- done segment: `rgba(48,209,88,0.20)` (绿色半透)
- pending: `rgba(255,255,255,0.025)`

**Accent / 紫色系 (跨 theme 一致, 已在 `W_TOKENS.accent`)**:
- 主紫: `#5E5CE6 → #7A5AF0 → #AF52DE` (Aimeeting logo grad, 已存在 MR_TOKENS.aimeetingLogoGrad)
- 紫亮: `#B9A0FF` (playhead)
- 紫激活: `rgba(124,92,250,0.40)` (W_TOKENS.borderActive, 已有)
- 紫 soft: `rgba(124,92,250,0.16)` (W_TOKENS.accentSoft, 已有)

**文字 色 (深色版)**:
- primary: `#F5F5F7` (≈ iOS gray1 反相)
- secondary: `#9090A0`
- tertiary: `#5A5A6B`
- muted: `#8E8E93`

**关键 hex 集 (新增到 W_THEME_CSS 即可)**:
```css
:root[data-theme="dark"] .mr-stage {
  --mr-bg-canvas: #05071A;
  --mr-bg-stage: #060818;
  --mr-bg-stage-mid: #0A0E22;
  --mr-bg-panel: #060818;
  --mr-bg-panel-end: #0A0D24;
  --mr-bg-topbar: #080B1F;
  --mr-bg-topbar-mid: #0B0F26;
  --mr-fg-primary: #F5F5F7;
  --mr-fg-secondary: #9090A0;
  --mr-fg-tertiary: #5A5A6B;
  --mr-accent-glow: rgba(124,92,250,0.18);
  --mr-accent-playhead: #B9A0FF;
}
```

**重点**: 设计稿用的紫色系 (`#5E5CE6 / #7A5AF0 / #AF52DE / #B9A0FF / #7C5CFA`) **完全跟 Web workstation 的 `W_TOKENS.accentGrad` 一致** — 跨页面色彩统一, 实施时 W_THEME 接入毫无心智负担.

### 5. PM 是否明确写 "切换" / "深色 mode toggle" / "继承 浅色"

**答**: **是, 明确写了**.

chat6.md 最后一轮 PM 原话:
> **"把深色浅色的控件开关也同步出现在会议室界面"**

设计稿的实现 (`ThemeToggle` 组件 已在 `meeting-room-web.jsx:104-147` + 也加到 v1 浅色版 = 两边都有 toggle 按钮):
- segmented control 形态: `[浅色] [深色]` 横条
- 浅色 active 用 iOS 琥珀 `#FFB340`
- 深色 active 用 logo 紫渐变
- 位置: 顶 nav `between people-strip 和 action buttons`
- 实施: 直接 `window.location.href = '<other file>.html'` — 设计稿是静态 mockup, 真实 React 接入 应该用 `W_THEME.setTheme('dark' | 'light')` + localStorage 持久化

---

## Step 3 · 跟 § 7.1 对账

### § 7.1 原文 (NORTH_STAR.md:410-414)

> **7.1 不做 dark mode**
>
> round-4 全面切换到 iOS 浅色 (会议室 round-3 done, 主 tab round-4 in-progress). **不允许**新写 dark token / 借鉴老 dark 代码.
> - 例外: 必须 dark 的(eg. 模态过渡黑底)在 commit message 标 `[STYLE-DEVIATION: 具体原因]`.
> - 反例: v1.2.0 P1.2 折叠态借了 AttachmentsSection 老 dark token, 是错误案例 (`CLAUDE.md` 风格守门协议).

### 当前 codebase 注释 (已写死 "会议室永远浅色")

**`frontend/src/components/web/tokens.ts:6-7`**:
```ts
* - 会议室 Web 永远 light, **不**走 W_THEME (PM 在 chat 明确"会议室不需要暗色")
```

**`frontend/src/components/web/meeting-room/tokens.ts:4-7`**:
```ts
* **跟 `frontend/src/components/web/tokens.ts` 严格分离**:
*  - Web 主体 (首页 / workstation) — `W_TOKENS` 暗紫双 theme
*  - Web 会议室 (本文件) — **iOS 浅色单 theme**, PM 拍板 "会议室永远浅色 iOS 风"
*    (见 docs/design/system/DESIGN_SYSTEM.md § 0.3.1)
```

### 冲突判定

**字面冲突等级**: **中等** (不是严重 "替换浅色", 也不是轻微 "component-level 黑 bar overlay")

- 不是替换浅色 — v1 浅色版被保留, 用户可 toggle
- 不是 component-level — 整个会议室视觉系统 (top bar / left / right / bottom / input / messages) 全部需要新增 dark token
- 是 "双 theme 共存" — 这本身是 W_TOKENS 已经为 workstation/home 跑通的模式, 复用没问题

**本质矛盾**: § 7.1 v1.2.2 (本周一沉淀) 字面写 "不允许新写 dark token". PM 这次新设计稿明确要 "**新增** 深色版本 + 工具栏 toggle". 这是 PM 直接 override 字面约束.

### 推荐 处理路径

**Path A · PM 在 NORTH_STAR.md 升级到 v1.2.3 显式 override § 7.1** (推荐):

在 § 7.1 后追加例外段落:
```markdown
### 7.1.1 例外: 会议室 双 theme (PM 2026-05-27 拍板, v1.2.3 升级)

会议室 (`MRLiveView` / `MRTopBar` / `MRLeftPanel` / `MRRightPanel` / `MRBottomBar` / `MRInputBar`)
**允许** 双 theme 共存:
- 默认 浅色 (iOS 风, R5.D 现状, 保护 § 7.1 主约束)
- 用户可在 顶 nav 切到 深色 (深邃星空 + 紫色渐变 aurora, "会议舞台" 沉浸感)
- 切换走 W_THEME (复用 workstation 同套 localStorage `w-theme` + `data-theme` attr)

**判断准则** (后续 想加 dark mode 的提案 仍受 § 7.1 约束):
- 仅 "**沉浸式 内容容器**" (会议室 / 未来 可能 的 deep-focus 写作 / 数据探索 大屏) 可以 dual theme
- 工作流页面 (`workstation 任务 / 知识库 / 设置 / admin`) 仍 强制 浅色 (信息密度 + 长时 阅读 不适合 dark)
```

**Path B · 走 [STYLE-DEVIATION]** (不推荐):
- 每次 dark 相关 commit 标 `[STYLE-DEVIATION]`, 但工作量大 (会议室所有组件 都要标), 也 跟 PM 主导路径 不符. **拒绝**.

**Path C · 不实施, 等 PM 显式 NORTH_STAR override** (我推荐立即这么做):
- 当前不动代码
- 把 evaluation report (本文件) 给 PM
- PM 拍板 → Path A 落字 → 才进 实施

---

## 我的 推荐: **Path A · 走 W_THEME 接入**

### 为什么 走 W_THEME 而 不重写 token

1. **已存在的基础设施 完美 匹配**:
   - `frontend/src/components/web/WThemeProvider.tsx` — 已 wire 完整 (mount localStorage / data-theme / inline script zero-flash)
   - `frontend/src/components/web/tokens.ts:117 W_THEME_CSS` — 已 有 dark / light 两套 `:root` var
   - `frontend/src/components/web/useWebTheme.ts` — 已 export hook `useWebTheme()` 返回 `{ theme, setTheme, toggleTheme }`
2. **跨页面 色彩 已 统一**:
   - 设计稿 dark accent 紫 `#5E5CE6 / #7A5AF0 / #AF52DE / #B9A0FF` 跟 `W_TOKENS.accentGrad` 一字不差
   - workstation 的 dark surface `#13131c` 跟 会议室 stage `#0A0E22` 是 同梯度, 切到 会议室 时 "暗紫 → 更暗 + 紫 aurora" 视觉延续
3. **不污染 mobile (`/m/*`)**:
   - WThemeProvider 只挂在 web layout, mobile 不会被切色 — 安全
4. **toggle 组件 复用**:
   - workstation 顶 nav 已 有 dark/light toggle (W_THEME)
   - 会议室加 ThemeToggle 直接 `import { useWebTheme }` 即可, 0 新 state machine

### 改动 清单 (估时 ~1.5d 真活 + 0.5d 联调)

| # | 文件 | 改动 | 估时 |
|---|---|---|---|
| 1 | `frontend/src/components/web/tokens.ts` | 移除 line 6-7 "会议室 Web 永远 light" 注释; 不动 W_THEME_CSS | 5min |
| 2 | `frontend/src/components/web/meeting-room/tokens.ts` | 重构 `MR_TOKENS` 为 双层: literal 浅色 default + `MR_TOKENS_DARK` dark 覆盖. 或者 完全 改用 CSS var (推荐 var, 跟 W_TOKENS 一致) | 2h |
| 3 | `frontend/src/components/web/meeting-room/MRTopBar.tsx` | 接 `useWebTheme()`, hex 改 var, 新增 ThemeToggle slot | 1.5h |
| 4 | `frontend/src/components/web/meeting-room/MRLeftPanel.tsx` | hex 改 var (panel bg + halo seam) | 1h |
| 5 | `frontend/src/components/web/meeting-room/MRRightPanel.tsx` | 同上 | 1h |
| 6 | `frontend/src/components/web/meeting-room/MRBottomBar.tsx` | 同上 | 30min |
| 7 | `frontend/src/components/web/meeting-room/MRInputBar.tsx` | 同上 (深色 luminous focus border 是 PM 第一轮要求) | 30min |
| 8 | `frontend/src/components/web/meeting-room/MRMessages.tsx` (1104 行!) | 大头: 4 种 message renderer 都要双色, AI/Mira/Round 卡 dark glass + 渐变 accent rail | 4h |
| 9 | `frontend/src/components/web/meeting-room/MRLiveView.tsx` | center stage 加 `StageAmbient` 组件 (星空 + aurora drift + grid + vignette), 仅 dark 渲染 | 2.5h |
| 10 | `frontend/src/components/web/meeting-room/MRFilterBanner.tsx` | 同上 (filter banner 暗化) | 20min |
| 11 | 新建: `frontend/src/components/web/meeting-room/MRThemeToggle.tsx` | 顶 nav segmented control [浅色][深色] | 1h |
| 12 | `frontend/src/app/meeting/[id]/live/page.tsx` | 接 WThemeProvider (如还没接) + animation keyframes 注入 (`starTwinkle` / `auroraDrift` / `agendaEdge`) | 30min |
| 13 | NORTH_STAR.md | PM 升级到 v1.2.3, 写 § 7.1.1 例外 | (PM 工作) |
| 14 | Kimi 测试用例 | 走 § 8.5, 写 `docs/kimi-tests/<版本>-darkmode-kimi.md`, 含 toggle 切换 + localStorage 持久化 + reload 不闪 | 1.5h |

**预计**: 实施 ~14-16 真 work hour (1.5d 1 个人), 加 Kimi 用例 + 双盲 (§ 8.7 默认 不适用 UI, 单跑 真人 + Kimi UI smoke) 0.5d.

### 实施前 必要 前置 (我 不会 跑 任何 代码 直到):

1. **PM 在 NORTH_STAR.md 显式 override § 7.1** (升级到 v1.2.3, 写 § 7.1.1 例外)
2. **PM 确认** Path A (走 W_THEME) — 不是 单 file 散乱 hex
3. **PM 确认** 默认 (新用户首次进会议室) 是 **浅色** (保 § 7.1 主精神), 用户 toggle 后 localStorage 记住
4. **PM 确认** 设计稿里的 starfield ambient / aurora drift 进生产 (会消耗 ~31 个 `<span>` + 2 个 blur radial-gradient + keyframes — 1440 屏 性能 应该 OK, 但需要 标 [STYLE-DEVIATION] 因为 "无障碍 减少动画" prefers-reduced-motion 需要 关 animation)

---

## 反幻觉 自检

- [x] 真 fetch 了 12.7MB tar.gz → 解压 → 真 读了 README + chat6.md 全文 + meeting-room-web.jsx 关键 4 段 (line 1-200 / 200-500 / 1649-1850)
- [x] hex 色值 全部 引用 自 真 jsx 行号 (eg `meeting-room-web.jsx:152` for top bar grad)
- [x] PM 原话 是 chat6.md 真有 这句 (line 271): `那这一版本干脆定义为深色版本。之前设计那一版定义为浅色版本，把深色浅色的控件开关也同步出现在会议室界面。`
- [x] § 7.1 原文 引用 自 NORTH_STAR.md:410-414 真 line
- [x] codebase 注释 引用 自 真 line (`tokens.ts:6-7` + `meeting-room/tokens.ts:4-7`)
- [x] 没 编 "应该 / 通常 / 估计 / 似乎" — 全部 基于 真 source
- [x] 现有 R5.D 组件 文件名 全部 真在 `frontend/src/components/web/meeting-room/` (ls 验证 过)
- [x] **本评估 没动 任何 代码**, 仅 写 evaluation md (此文件) + 读 文件

---

## 给 main agent 的 一段 报告 (300 字)

PM 设计稿是 "**双 theme 共存**", 不是替换浅色. chat6.md PM 原话明确: "**这一版本定义为深色版本, 之前设计那一版定义为浅色版本, 把深色浅色的控件开关也同步出现在会议室界面**". 跟 § 7.1 字面冲突 (中等等级), 但本质是 PM 主导路径, 应升级 NORTH_STAR 到 v1.2.3 加 § 7.1.1 例外条款.

**layout 100% 同构** — 0 个新组件, MRTopBar/MRLeftPanel/MRRightPanel/MRBottomBar/MRInputBar/MRLiveView/MRMessages 跟设计稿 TopBar/LeftPanel/RightPanel/BottomBar/InputBar/center stage/Web*Message 一一对应. 改动 仅 "色 + 中心 ambient (星空 + aurora) + 顶 ThemeToggle". 设计稿的 紫色 hex `#5E5CE6/#7A5AF0/#AF52DE/#B9A0FF` 跟 `W_TOKENS.accentGrad` 完全一致, 复用 W_THEME 完美匹配.

**推荐 Path A**: 走 W_THEME 接入 (复用 `WThemeProvider` + `useWebTheme` + `data-theme` attr 机制, workstation 已 prod 跑通). 估时 ~1.5d 实施 + 0.5d Kimi smoke. 改动 14 个 task 已列在 evaluation md.

**不实施 直到**: (1) PM 在 NORTH_STAR.md 落字 § 7.1.1 例外 + 升级 v1.2.3; (2) PM 确认 默认浅色 + localStorage 记 toggle; (3) PM 确认 starfield 进生产 (含 prefers-reduced-motion).

完整 evaluation: `/Users/bluesurfire/Documents/claude/aimeeting/docs/kimi-tests/meeting-room-darkmode-evaluation.md`
