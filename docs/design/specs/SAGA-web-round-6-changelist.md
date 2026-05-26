# Saga · Web Round-6 · Review 清单

> 来源: Claude Design handoff `Z9-SyxO6DubyyJ5woDuzKQ` (2026-05-26 fetch, Web Workstation.html)
> Bundle 解压路径: `/tmp/claude-design-round6-web/aimeeting/project/`
> 状态: **待 PM 对齐 scope + 批准实施 — 主 Agent 严禁先 coding**
>
> 完整 chat 记录:
> - `/tmp/claude-design-round6-web/aimeeting/chats/chat1.md` (旧 round-3/4 会议室, 不变)
> - `/tmp/claude-design-round6-web/aimeeting/chats/chat2.md` (**核心**, 共 2296 行;
>   1-1677 行 = round-5 内容, 1678-2296 行 = round-6 增量 ~619 行)

---

## 0. TL;DR

**这是 round-6 — 不是新一轮, 是 round-5 设计稿的"打磨补丁"** (PM 在同一个 Claude Design session 继续对话).

PM 用 R5.A 实施(暗紫风首页 + 工作站骨架)走到了 review 阶段, 但**对 R5 设计稿本身**积了 11 轮反馈, 全部落到设计文件:

1. **lineage 推倒重做** — D3 force-directed → **Apache ECharts Sankey** (4 列流向 KB→AI→记忆→会议) + **全屏 3600×2200 无限画布** + 右侧 **460px 详情面板**(分 AI / KB / 记忆 / 会议 四种内容深化)
2. **心智模型重定义** — 侧栏 `心智模型` 改名 **`AI 心智一览`**, 直接**吃掉**独立的 `#graph` 入口, 把 Sankey 嵌入 mental pane(顶概念 hero + 中分隔标 + 下真实血缘)
3. **侧栏会议入口重做** — 干掉硬编码的 `#meeting/q3-roadmap` 直接条目, 改 **`#history` (会议历史)** 列表 pane(6 张 mini-stat 卡 + segmented 全部/今日/本周 + 搜索)
4. **首页 LIVE 卡彻底重做** — 双列头(64px 环形计时器 + LIVE pill + 标题) + 4 张 mini-stat 卡(关键点/待确认/资料/AI 引用) + Mira 11 根橙色频谱条 SMIL 动画 + 大绿渐变 CTA
5. **首页 DiscoveryBox 重做** — 字号 13 → 17/18px, Mira 头像 28 → 44px, kbd 真键盘样式, light/dark 双套**真**配色而非强行复用 dark token
6. **HomeFeedTabs 重做** — 单 text "1 进行 · 2 即将 · 24 已开" → **3 张大号数字卡**(26px 加粗 + 标签退到副位), 激活态直接变 hero(深绿/紫渐变 + 阴影浮起)
7. **light-mode token 加深** — `#1c1c1e → #0a0a0e`, `border 0.07 → 0.10`, `scroll 0.10 → 0.18`(PM: "饱和度太低的色调只能用于小字和说明")
8. **文案中文化** — "chunk_1 / p.3 / sim 0.91 / P95 / SLA / stop loss" 全部中文化(PM: "用户是 50 岁以上的老专家")
9. **新增首页文案** "**让会议拥有超脑与灵魂**"(round-5 已落; round-6 chat 强化为 hero strong central halo + drop-shadow)
10. **新组件**: MeetingHistoryPane + HistoryMeetingCard + MentalLiveSection + MiniStat + FlowExample(嵌入式 Sankey 下方典型流向示例)

**核心结论**:
- **不替换 R5.A 已实施** — 全部是**增量打磨 + 一处架构变更**(lineage 改 ECharts).
- **不动 mobile** — 8 个 mobile JSX 跟 R5 byte-identical, mobile round-4 暂停 Saga 仍有效.
- **R5.B/C/D 排队需要修订** — R5.B 的 Lineage V2 (react-flow) 全部作废, 改用 ECharts. R5.B 的 LineagePane 跨页接口契约改名 `/lineage/sankey`.
- **预估**:
  - R5.A 已实施部分 redo: **~12-16 小时**(首页 3 个组件返工 + 侧栏 + MentalModelPane + 浅色 token)
  - 新增 lineage 大改 (R5.B 替代): **~22-28 小时** + backend 接口对齐
  - 新增 MeetingHistoryPane: **~4-6 小时**
  - **总 round-6 增量**:约 **38-50 小时**(单人, 1.5 周)

---

## 1. 这是什么轮 — 判断与证据

### 1.1 判断: round-6 (round-5 的 v2 打磨补丁, 同一 session 接着推)

### 1.2 证据

**A. Bundle 跟 round-5 仅 5 个文件差异**, 其他**全部 byte-identical**(包括 8 个 mobile JSX、5 个 meeting-room JSX、web-shared/web-extras/web-agent-detail/web-template/web-meeting-detail).

```
$ diff -rq /tmp/claude-design-round5 /tmp/claude-design-round6-web
Files Web Home.html        differ   ← 仅 light-mode 9 个 token 加深
Files Web Workstation.html differ   ← 同上 + 把 d3@7 CDN 改 echarts@5
Files web-home.jsx         differ   ← 310 行新增 (LIVE 卡 / Discovery / Tabs)
Files web-workstation.jsx  differ   ← 295 行新增 (Sidebar / Mental / History)
Files web-lineage-v2.jsx   differ   ← 535 行新增 (D3 → ECharts Sankey 全量重写)
```

**B. chat2.md 从 1677 → 2296 行**(新增 619 行 = round-6 完整对话), chat1 不动.

**C. PM 在 round-6 chat 里直接接 round-5 末尾问题继续推**, 没有重置或切换主题. 而且对话里多次说"已修 ✓" "重新设计了 X" "上线 ✓" — 全部是**补丁式继续打磨**.

### 1.3 PM 在 round-6 chat 里关键 quotes (按时序)

```
Q1 (Sankey 重做):
"https://echarts.apache.org/examples/zh/editor.html?c=sankey-energy
 全景血缘图我建议还是用桑基图更合适, 更直观看出专家、记忆、知识之间的关系"

Q2 (全屏画布):
"全景血缘图的画布有可能要做成无限大... 应该足够大的画布去承载它,
 应该点击有个全屏, 全屏以后是一个无限大的画布。
 另外, 我们点击每个专家, 每个知识和每条记忆都能看到对应的详情,
 可以在画布的右侧去呈现出来"

Q3 (全屏入口+鼠标):
"目前全屏的按钮不太能够发现, 我觉得要做得让更明确一些。
 另外, 我点击选屏进去以后, 应该整个画布应该是可以通过鼠标缩放和拖拽的"

Q4 (右侧弹窗 + 完整链路):
"右侧的弹窗字实在太小了, 根本看不清。
 另外, 点击后应该展示完整的线路链条:
 - 点击记忆 → 显示它来自于哪一场会议及会议室大致上下文
 - 点击知识库 → 显示对应的文件及向量化的内容及跳转链接
 - 点击 AI 专家 → 显示其涵盖的知识和拥有的记忆概况"

Q5 (用户画像 — 50岁以上老专家):
"里面的标题和说明, 尽可能不要用英文, 都用中文进行说,
 我们的用户是 50 岁以上的老专家对英文的掌握和理解不是很透彻"
 → 'chunk_1' → '分块 1', 'p.3' → '第 3 页', 'sim 0.91' → '相似度 0.91',
   'P95 / SLA / stop loss' → '延迟不超过 1.5 秒的服务承诺 / 何时停止' 等

Q6 (首页过散):
"首页的页面给人感觉过于分散, 不聚焦,
 我觉得从颜色选取(目前颜色太淡)和用户的关注度角度再去优化一下"
 ... 紧接着:
"这次的效果非常差。你应该是暗色模式和亮色模式都混淆了。回滚并重新设计。
 我其实核心是想下半部分重新设计, 突出一些重点"

Q7 (DiscoveryBox 字太小):
"我截图这一块, 请认真考虑, 重新设计,
 字太小根本看不清, 而且很脏的感觉, 也缺乏科技感。"
 → 字号 15 → 17px, MIRA 28 → 44px, kbd 真键样式

Q8 (LIVE 卡信息密度):
"首页我用红框框出来的部分是正在进行中的会议, 你有没有发现,
 这么大个卡片其实真正利润的空间很少, 所传递的信息量也很少。
 我觉得你可以考虑重新设计一下, 让界面显得这么空,
 同时来说维充些美观的装饰性元素"
 → 64px 环形计时器 + 4 mini-stat + Mira 频谱 + 装饰元素

Q9 (LIVE 卡 light/dark 没区分):
"首页会议的核心框, 你有没有发现暗色和明色调是一样的?
 我觉得不合适吧。淡色调应该有自己的风格特色和颜色搭配。"
 → 引入 isLight 状态, 双套独立配色

Q10 (会议历史孤立):
"为什么这一页会孤零零地出现一个已经完成的会议记录?
 我没太理解。它不应该是在历史会议的卡片里点击某个卡片才出现的内容吗?
 并且这个页面设计得非常混乱。"
 → 侧栏 'Q3 路线图对齐' 改 '会议历史' (#history) 列表 pane

Q11 (心智模型融合):
"心智模型这个页面设计的不太好, 请重新,
 我们希望把「全景血缘图」挪到一起, 融合进来形成真正的「AI 心智一览」"
 → 侧栏改名 'AI 心智一览' + 移除 '#graph' 独立入口 + 嵌入 Sankey

Q12 (浅色 token 加深):
"文字和填充尽可能要用深一点的色调, 看得更清晰,
 饱和度太低的色调只能用于小字和说明"
 → light tokens 加深: #1c1c1e → #0a0a0e 等 9 个变量
```

这 12 个反馈**全部落到** R6 设计稿. 落地实施时**直接遵循**, 不要再问 PM 重复决策.

---

## 2. 跟 round-5 design 的 diff (5 个文件)

### 2.1 `Web Workstation.html` (HTML 入口)
**CDN 切换**: `d3@7.9.0 → echarts@5.5.0` (1 行).
**Light token 加深**: `--w-text` 等 9 个变量同 § 2.5.

### 2.2 `Web Home.html`
仅 light token 加深, 同 § 2.5.

### 2.3 `web-workstation.jsx` (+295 行)
**侧栏**:
- `心智模型` → `AI 心智一览`
- `Q3 路线图对齐 (#meeting/...)` → `会议历史 (#history)`
- 移除 `全景血缘图 (#graph)` 独立项 (融入 mental)

**MentalModelPane**:
- 头部副标题加 `· 一页看完 AI 怎么思考、怎么记住、怎么使用`
- 头部标题改 `AI 心智一览`(同侧栏)
- 移除 4 张 QuickCard
- **新增 `<MentalLiveSection />`**: 紫色脉冲分隔标 + `下方 · 你工作空间里的真实血缘` + `<window.LineagePane embedded />`(嵌入式渲染)

**新组件 `MeetingHistoryPane`**:
- 顶 segmented `全部 / 今日 / 本周` + 计数 + 搜索框
- 网格 `repeat(auto-fill, minmax(440px, 1fr))`, 每张 `HistoryMeetingCard`
- 卡: 左 3px accent stripe (live=绿 / done=紫渐变) + LIVE pill / 已结束 chip + 日期 · 标题 · 副标题 · 议题 + 4 mini-stat (决策/行动项/AI 引用/新记忆) + 参会人 4 头堆叠 + AI 头像 + 「查看纪要 →」

### 2.4 `web-home.jsx` (+310 行)

**Hero**: 加 760×460 强紫光晕居中 halo + 文案 drop-shadow.

**DiscoveryBox 整体重做**:
- 引入 `isLight` MutationObserver tracker
- 容器: 双套独立 background (light: `linear-gradient(#ffffff → #faf7ff)`, dark: `linear-gradient(#1a1438 → #0f0d24)`)
- 容器: 加 24×24 px 紫色细网格 + radial mask 中心强外围淡
- 顶部 accent 描边: 2 → 3px + `0 0 16px rgba(124,92,250,0.60)` glow
- Mira 头部: 28 → 44px 头像 + 橙色光环 + "主持人" 紫色 chip + 标题 13 → 18px/800 + 副标题 11.5 → 15px/500 + 加绿色脉冲 dot
- 输入框: 15 → 17px, padding 14 → 18px, 边框 1px 紫白, focus 紫光晕 4px
- ⌘ Enter: 单行小字 → 真 kbd 元素 (灰底白字 + inset shadow)
- 灵感场景: chip padding 6×11 → 9×14, 字号 12.5 → 13.5, hover 浮起 + 紫光投影, 加 sparkle icon, 加 "灵感场景 · 点击直接试试" UPPERCASE 11px 标题

**LiveMeetingCard** (`MeetingsPulse.tsx` 第二张大卡):
- **新增 64×64 环形 SVG 计时器** (`strokeDasharray` 按 pct 描边 + 绿光 drop-shadow), 中心 `23` `/ 60 分`
- **新增 4 张 MiniStat** (关键点 12/绿 · 待确认 3/琥珀 · 资料 3/青 · AI 引用 4/紫)
- **新增 Mira 频谱**: 11 根 SVG `<rect>` 带 SMIL `<animate>` 跳动 + "Mira 正在记录关键点…"
- 顶部 LIVE pill: `padding: 2px 8px → 2px 9px`, `letterSpacing: 0.5 → 0.6`, fontWeight 700 → 800, 加 12px 绿光
- 装饰元素: 大绿光晕 220 → 280px, 加 22×22 px 绿色点阵 SVG `<pattern>` + linear mask 渐隐 + 3 颗绿色 sparkle
- 底部 CTA: 8×14px / fontSize 13.5 → 10×18px / 14/800 + 6 18px 绿光 + inset 白边

**HomeFeedTabs 整体重做** (`HomeFeedTabs.tsx`):
- 数据 schema: `hot: 'LIVE' | '32'` + `count: '1 进行 · 2 即将 · 24 已开'` → **`hotLabel + stats: [{ num, label, color }]`** 3 段数字卡
- 激活态: `t.surface + t.accent50 边框` → **`t.grad`(全 bleed 绿/紫渐变)+ `t.shadow` + inset 白 1px**
- 字号: 标题 17 → 19/800, 数字 13/700 → 26/800
- 高度: minHeight 116, 浮起 translateY(-2px)
- 装饰: 加 240×240 白光晕(active) + 2 颗白 sparkle
- 加右上 28×28 玻璃白方块 + 白箭头 affordance(只在 active 显示)
- 加 hover 浮起 -1px

### 2.5 Light-mode token 加深 (9 个变量, 3 个文件都改)

| token        | R5            | R6            |
|--------------|---------------|---------------|
| `--w-border` | `rgba(0,0,0,0.07)`  | `rgba(0,0,0,0.10)`  |
| `--w-border-hover` | `rgba(0,0,0,0.14)` | `rgba(0,0,0,0.18)` |
| `--w-text`   | `#1c1c1e`     | `#0a0a0e`     |
| `--w-text-2` | `#3c3c43`     | `#1f1f2b`     |
| `--w-text-muted` | `#71717a` | `#4b4b58`     |
| `--w-text-faint` | `#a8a8b0` | `#8a8a98`     |
| `--w-nav-bg` | `rgba(244,244,248,0.82)` | `rgba(244,244,248,0.86)` |
| `--w-scroll-thumb` | `rgba(0,0,0,0.10)` | `rgba(0,0,0,0.18)` |
| `--w-scroll-thumb-hover` | `rgba(0,0,0,0.18)` | `rgba(0,0,0,0.28)` |

PM 引语: **"饱和度太低的色调只能用于小字和说明"**.

### 2.6 `web-lineage-v2.jsx` (**整体重写** ~535 行净增, 但**功能不是 +535 而是替换**)

**Tech stack**: `d3@7 force-directed + 自定义 SVG` → `echarts@5 Sankey + React refs`.

**布局变更**:
- R5: 3 栏 `208 / 1fr / 280px` (左 filter + 中 force graph + 右 detail)
- R6: 单图 Sankey 4 列 (`书架 → AI 专家 → 长期记忆 → 会议`) 上方 5 个 stat 卡 + 4 列流向标签(图例 + 箭头) + 下方 ECharts canvas 渲染区(深紫宇宙底 + 紫光辐射 + sparkle) + 一行 `FlowExample` 典型流向示例

**新增组件**:
- `SankeyChart` — `echarts.init(ref)` + `series: [{ type: 'sankey', emphasis: { focus: 'adjacency' }, ...}]`. 节点 `name + _internalId + meta`(避免 `id` 字段被 ECharts 当 fallback 文本)
- `FullscreenSankey` — `position: fixed; inset: 0; zIndex: 2000` 全屏 overlay:
  - 3600×2200 大画布 (zoom 30%-300%, pan 鼠标拖拽)
  - 点状网格背景 (`<pattern id="fs-grid">`) + 中心光晕
  - 顶部 chrome: 小 logo + 节点数 + 连接数 + 键盘提示 `+ - 0 Esc` + 关闭 ×
  - 左下 zoom 面板 `+ − ⌖` + 当前缩放比
  - 右下 mini-map 全部节点散点 + 视口高亮框
  - 键盘快捷键 `Esc` / `0` / `+/-`
  - **460px 宽右侧详情面板** (按节点类型 4 种内容):
    - **AI 专家**: 大头像 52px + 启用脉冲 dot + 召唤次数 + 完整 intro 引用块 + 标签链 + 书架 N 份文档列表 + 长期记忆 N 条经验列表 + "查看脑内地图"CTA
    - **书架文档**: 4 mini-stat (页数 / 向量分块 / 被 AI 引用 / 更新时间) + 挂载 AI 专家跳卡 + 向量化分块预览(3 条样例 chunk: 分块 1 紫 ID + 第 3 页 + 相似度 0.91 绿色等宽字 + 15px 行高 1.55 文本) + 快速操作(打开原始文档 / 在本书架中检索 / 查看引用过本书的记忆)
    - **长期记忆**: 完整记忆引用块 15px 加粗 + 3 mini-stat (被引用 / 入库时间 / 重要度自动判定 ≥10 高 ≥5 中) + 归属 AI 专家跳卡 + 沉淀来源 + 被引用于 N 场会议(每场带真实上下文摘要 + 跳转)
    - **会议**: 该会议引用了哪些记忆, 2 行预览, 可跳转
- `FlowExample` — 嵌入式 typical flow `深圳物业管理条例 → 法老张 → 业主大会 2/3 同意 → 维修资金审议会`
- `TechItem` — 推荐顺序 `echarts > d3-sankey > visx > recharts(不支持)` (跟 R5 推荐顺序完全不同, R5 推 react-flow)

**Backend contract 变更**:

```ts
// R5:
GET /api/workspace/:id/lineage → { nodes: Node[], edges: Edge[] }
Node = { id, type:'agent'|'kb'|'memory'|'meeting', label, parent_agent?, meta }
Edge = { source, target, kind:'owns'|'has'|'extract'|'cite'|'create'|'participate', weight? }

// R6:
GET /api/workspace/:id/lineage/sankey → {
  nodes: [{ id, label, type:'kb'|'agent'|'memory'|'meeting', meta? }],
  links: [{ source: id, target: id, value: number }]
}
// value 即流量宽度; value = 引用次数 / 共享强度 / weighting
// 注意: ECharts 节点不传 id 字段(会被当 display fallback), 用 name + 外部 idMap
```

差异:
- `edges` → `links` 名词改
- `kind` 字段消失 (Sankey 单一关系, 不需要边类型区分)
- `weight?` → `value: number` (必填, 决定流量宽度)
- 接口路径加 `/sankey` 后缀, 暗示后端可能并存 `/lineage/graph` 老接口给图模式

---

## 3. 跟 R5.A 已实施的 diff (是否要 redo?)

### 3.1 R5.A 已实施清单 (commit `1413a41` 合并 main)

✅ 已建:
- `frontend/src/components/web/tokens.ts` (R5 light token)
- `frontend/src/components/web/atoms/` (10 W_*)
- `frontend/src/components/web/home/` (HomeHero / DiscoveryBox / HomeFeedTabs / MeetingsPulse / AgentMarketplace / AgentQuickModal / WebHome)
- `frontend/src/components/web/workstation/Sidebar.tsx` + `sidebarConfig.ts` (R5 sidebar 6 段 12 项)
- `frontend/src/components/web/workstation/MentalModelPane.tsx` (R5 4-node hero + 4 QuickCards)
- `frontend/src/app/workstation/` (14 panes placeholder)

### 3.2 R6 改动是否需要 redo R5.A?

| R5.A 文件 | R6 是否要改 | 工作量 |
|---|---|---|
| `tokens.ts` | ✅ **要改** — 9 个 light token 加深 (§ 2.5) | 5 min, 单纯改值 |
| `atoms/*` | ❌ 不动 | 0h |
| `home/HomeHero.tsx` | ✅ 要小改 — 加 760×460 强中心 halo + drop-shadow + sparkle 位置微调 | 1-1.5h |
| `home/DiscoveryBox.tsx` | ✅ **完全重写** — Mira 头像 28 → 44px, 字号大幅上调, kbd 真键, light/dark 双套配色, sparkle icon, "灵感场景 ·" 标题 | 5-7h |
| `home/HomeFeedTabs.tsx` | ✅ **完全重写** — 数据 schema 从 `hot/count` 改 `hotLabel/stats[]`, 激活态全 bleed 渐变, 26px 数字优先 | 4-5h |
| `home/MeetingsPulse.tsx` | ✅ **完全重写** LIVE 卡部分 — 环形计时器 / 4 mini-stat / Mira 频谱 / 装饰元素 / 大 CTA | 5-7h |
| `home/AgentMarketplace.tsx` | ❌ 不动 (R6 没改这部分) | 0h |
| `home/AgentQuickModal.tsx` | ❌ 不动 | 0h |
| `workstation/Sidebar.tsx` | ⚠ 不动文件本身, 但配置改 | 0h |
| `workstation/sidebarConfig.ts` | ✅ 要改 — `心智模型 → AI 心智一览`, `meeting/q3-roadmap → history`, **删** `graph` 项 | 10 min |
| `workstation/MentalModelPane.tsx` | ✅ **大改** — 头部副标题 + 标题文案改, 删 4 张 QuickCard, 加 `<MentalLiveSection />` 嵌入 LineagePane | 2-3h |
| `app/workstation/page.tsx` + `layout.tsx` | ⚠ 可能要小改 — 看 `MentalLiveSection` 怎么动态加载 LineagePane (`embedded` prop) | 1-2h |
| **新增** `workstation/MeetingHistoryPane.tsx` + `HistoryMeetingCard.tsx` | ✅ 新建 (R5.A 没建过) | 4-6h |
| **新增** `workstation/LineagePane.tsx` (R5.B 大头) | ✅ 完全按 R6 ECharts 实施, 不要 react-flow | 见 § 4 R5.B-replace |

### 3.3 R5.A redo 子合计: **~22-30 小时**

不包括 R5.B Lineage (那是新 Saga, 见 § 4).

---

## 4. R5.B/C/D 是否需要修订?

R5 changelist § 8 把后续拆成 4 个子 Saga. R6 改动影响如下:

### 4.1 R5.B (核心 pane) — **修订两处**

| R5.B 子任务 | R6 是否要改 | 修订内容 |
|---|---|---|
| #agent/<id> AgentDetail (BrainRadar + BrainGraph) | ❌ 不变 | 设计稿没动. 估算仍 16-22h + backend 8h. |
| #meeting/<id> MeetingDetail 6 tabs + AI 引用闭环 | ❌ 不变 | 设计稿没动. 估算仍 14-18h + backend 4h. |
| **#graph LineagePane** | ✅ **替换** — `react-flow` 方案作废, 改 **ECharts Sankey + 全屏无限画布** | 见下 |
| #tpl TemplateGeneratorPane | ❌ 不变 | 设计稿没动. 估算仍 14-18h + backend 8h. |

#### 4.1.1 R5.B-LineagePane 修订 (**重要**)

**R5 方案**:
- npm 加 `react-flow` (Apache 2.0)
- 4 类节点 (agent/kb/memory/meeting) + 6 类边 (owns/has/extract/cite/create/participate)
- 3 栏: 左 filter + 中 force graph + 右 detail panel
- Backend: `GET /api/workspace/:id/lineage` → `{ nodes, edges }`
- 估算: ~16-22h + backend ~6-10h

**R6 方案**:
- npm 加 `echarts` (Apache 2.0) **(or 复用 `@nivo/sankey` 已有依赖? 见 § 9 R6.5 决策)**
- 4 列 Sankey (KB → AI → 记忆 → 会议)
- 嵌入式 inline 模式 + 全屏 3600×2200 无限画布 overlay
- 右侧 460px 详情面板按节点类型 4 种内容
- 顶 5 stat 卡 + 4 列流向 banner + 下方 FlowExample 典型流向
- Backend: `GET /api/workspace/:id/lineage/sankey` → `{ nodes, links }` (`links` 而非 `edges`, 每条 `value: number`)
- **不再有边类型 (kind)** — Sankey 单关系流向, 设计自然消除了边类型 filter
- 估算: **~22-28h** + backend **~6-10h** (跟 R5 接近, 但 ECharts API 学习成本可能略高)

工作量 net delta: **+6-8h** (Sankey 全屏 overlay + 460px 详情侧栏比 react-flow drop-in 复杂)

#### 4.1.2 跟 #agent/<id> 的接口闭环影响

R6 详情面板 "AI 专家" 节点弹出 → 显示其知识 / 记忆概况 + "查看脑内地图"CTA 跳 `#agent/<id>`. 这跟 R5 设计一致, 跳转契约不变, 但 **detail 内容来源**变成 `node.meta.agentId`, 而 R5 是 `node.id === agentId`. 落地实施时 backend 需要在 `node.meta.agentId` 字段里传 ID.

### 4.2 R5.C (辅助 pane) — **大致不变**

| R5.C 子任务 | R6 影响 |
|---|---|
| #new NewMeetingPane | 不变 |
| #board DashboardPane | 不变 |
| #approve ApprovalPane | 不变 |
| #admin AdminPane | 不变 |
| #agents AgentsPane | 不变 |
| #kb / #memory / #browse / #profile / #tasks | 不变 |
| **#history MeetingHistoryPane** (新) | ✅ **要加** — R5.A 没建过, 但 R6 设计明确要求 |

R5.C 新增工作量: **+4-6h** (MeetingHistoryPane).

### 4.3 R5.D (Web 会议室集成) — 不变

设计稿没动. 估算仍 ~10-12h.

### 4.4 总 round-6 修订后队列

| Saga | R5 估算 | R6 修订后估算 | 备注 |
|---|---|---|---|
| **R5.A 已 ship** | (已落) | **+22-30h redo** | tokens + 4 home 组件 + sidebar config + MentalPane |
| **R6.X 新 (mini Saga)** | — | **+4-6h** | MeetingHistoryPane |
| R5.B core pane | ~60-80h | **~64-86h** | Lineage 改 +6-8h |
| R5.C 辅助 pane | ~30-40h | **~34-46h** | +History (新), 但若 R6.X 已做则同 R5 |
| R5.D Web 会议室 | ~10-12h | 同上 | |
| **新总和** | **~167-228h** | **~187-258h** | net +20-30h |

---

## 5. 按页面 / pane 改动清单

### 5.1 `/` (首页) — **3 个组件返工 + 1 个微调**

- **HomeHero** (`home/HomeHero.tsx`): 加 760×460 强中心 halo. 1-1.5h.
- **DiscoveryBox** (`home/DiscoveryBox.tsx`): 完全重写, 双套配色 + 字号上调 + kbd + sparkle. 5-7h.
- **HomeFeedTabs** (`home/HomeFeedTabs.tsx`): 数据 schema 换 + 激活态全 bleed 渐变 + 26px 数字. 4-5h.
- **MeetingsPulse**(LIVE 卡部分): 环形计时器 + 4 mini-stat + Mira 频谱 + 装饰. 5-7h.

### 5.2 `/workstation` (工作站) — **侧栏 + Mental + History**

- `sidebarConfig.ts`: 改 3 处. 10 min.
- `MentalModelPane.tsx`: 大改, 加 `MentalLiveSection`. 2-3h.
- **新建** `MeetingHistoryPane.tsx` + `HistoryMeetingCard.tsx`. 4-6h.

### 5.3 `/workstation/graph` — **如果保留这个 URL 的话** (PM 决策点, 见 § 9 R6.4)

R6 chat 说"移除独立的「全景血缘图」入口". 但侧栏移除 ≠ URL 移除. 决策点:

- (a) URL 保留 `/workstation/graph` (可深链, embedded=false), 但侧栏不展示
- (b) URL 彻底废 — `/workstation/graph` 跳回 `/workstation` (mental)

**推荐 (a)** — 给"分享给同事" / 后续 OnBoarding 留余地, 反正 LineagePane 必须实现 `embedded` 双模式.

### 5.4 `/workstation` (mental pane, 同 § 5.2 MentalModelPane)

`<MentalLiveSection />` 嵌入 LineagePane (embedded=true). 决策: LineagePane 当独立 component 在 R5.B 实施, mental pane 只是 wrapper. **R6.X mini-saga 不能脱离 R5.B 独立做** — 必须 R5.B 先做出 LineagePane, R6.X 再嵌入.

### 5.5 全部 light-mode 页 — **token 加深 (1 处改, 14 处自动生效)**

`tokens.ts` 改 9 个变量值. 不需要碰任何组件代码. 5 min.

### 5.6 受影响但不需要改的 panes

- AI 专家市场首页 (R5.A 已落) — 不动
- AgentQuickModal — 不动
- (R5.B/C 待建的 pane) — 设计稿没动, 按 R5 changelist 实施

---

## 6. 跨页共享组件 / tokens 影响

### 6.1 tokens.ts: **9 个 light 变量加深**

具体值见 § 2.5. 单文件改, 全局生效.

### 6.2 atoms: **不扩**

R6 没引入新 atom. 但 R6 内嵌使用了几种现有 atom 没覆盖的 pattern:
- `kbd` 真键盘元素 — 可考虑加 `WKbd` atom, 但 inline 用 1 处即可, **暂不加 atom**
- SMIL 频谱 `<animate>` — DiscoveryBox + LIVE 卡都用, 但实现在各自组件里, **暂不抽 atom**
- 环形 SVG 计时器 — LIVE 卡专用, **暂不抽 atom**

### 6.3 数据: **新增 mock**

`HISTORY_MEETINGS`: 6 场会议数据 (id / title / sub / date / time / topic / state(live|done) / participants / ais / decisions / actions / citations / mems). 放 `frontend/src/components/web/data/history.ts` 或 backend.

### 6.4 全局 layout

不变. 但 `workstation/layout.tsx` 可能要给 mental pane 加客户端 `LineagePane` 动态加载 (因为 ECharts CDN/npm 都是 client-only).

### 6.5 npm 依赖

**新增**: `echarts@5` (Apache 2.0, ~900KB gzip, tree-shakeable).
- **决策 R6.5**: 直接装 `echarts` 还是用已有 `@nivo/sankey`(`^0.99.0`)? — **推荐装 echarts**, 因为设计稿用了 ECharts 的 `emphasis.focus: 'adjacency'` 邻接高亮 / SMIL 配置式 API 不容易在 nivo 上复刻; 而且 ECharts 是 PM 在 chat 里**直接命名**的库.

---

## 7. Scope 评估 + 工作量

### 7.1 三段汇总

| 段 | 内容 | 工作量 | 备注 |
|---|---|---|---|
| **R6.0 redo R5.A** | tokens + 4 home 组件 + sidebar + MentalPane | **22-30h** | 必做, 修补 R5.A |
| **R6.X mini-saga** | MeetingHistoryPane | **4-6h** | R5.A 漏建的, 严格说是 R5.A 补丁 |
| **R6.B-replace (R5.B 改良)** | LineagePane ECharts Sankey + 全屏 + 详情面板 | **22-28h + backend 6-10h** | 替换 R5.B 原 react-flow 方案 |
| **小计** | | **48-64h + backend 6-10h** | round-6 直接增量 |
| R5.B 其他 (Agent/Meeting/Tpl) | 不变 | ~44-58h + backend ~20h | 不在 round-6 scope, 后续 |
| R5.C 辅助 pane | 不变 | ~30-40h | 不在 round-6 scope |
| R5.D 会议室 | 不变 | ~10-12h | 不在 round-6 scope |

### 7.2 round-6 直接增量

**~48-64 小时** 前端 + **6-10 小时** 后端 = **~54-74h 总**, 单人 **~1.5-2 周**.

### 7.3 跟 v1.3.1 协同

v1.3.1 已 ship (commit `32826fe / fe3d5ec` + R5.A merge). round-6 实施时**直接基于 main**, 不需要等其他 saga.

---

## 8. 跟现有 Saga 队列协同建议

### 8.1 当前队列状态

| Saga | 状态 | round-6 影响 |
|---|---|---|
| v1.3.1 权限对齐 | ✅ ship (commit `ca42f80`) | 0 交集 |
| **R5.A · Web 设计系统 + 首页 + 工作站骨架** | ✅ ship (commit `1413a41`) | **需要 redo: tokens + 4 home + sidebar + MentalPane (22-30h)** |
| R5.B · 工作站核心 pane | 待批 | **Lineage 子项改 ECharts (替换 react-flow), 其他不变** |
| R5.C · 工作站辅助 pane | 待批 | **+ MeetingHistoryPane** (建议提到 R6.X 优先) |
| R5.D · Web 会议室集成 | 待批 | 不变 |
| round-4 Saga B/C/D (mobile) | 暂停 | 0 交集 |
| meeting-room-v2 (round-3) | ✅ ship | 0 交集 |

### 8.2 建议执行序

```
R6.0 (R5.A redo + tokens 加深)
   ↓
R6.X (MeetingHistoryPane, 提到优先, 因侧栏改名后没了 placeholder)
   ↓
R5.B-replace (LineagePane ECharts Sankey + 全屏 + 详情面板)
   ↓ (可平行)
   ├── R5.B-agent (AgentDetail + BrainRadar + BrainGraph)
   ├── R5.B-meeting (MeetingDetail 6 tabs)
   └── R5.B-tpl (TemplateGenerator)
   ↓
R5.C (辅助 pane)
   ↓
R5.D (会议室)
```

**建议**: R6.0 + R6.X + R5.B-replace 打包成一个 sub-Saga (~50-70h, ~1.5-2 周), 作为 round-6 的"门面 ship"目标; 完成后 R5.A 实际等价于"完成 round-5 + round-6 全部首页 + Lineage" 状态.

### 8.3 关于"是否替换某些 Saga"

- **不替换** R5.B / R5.C / R5.D — 它们的大部分内容(AgentDetail / MeetingDetail / Tpl / Approve / New / Board / etc.)设计稿**没动**
- **修订** R5.B 中 LineagePane 子项 (react-flow → ECharts Sankey)
- **新增** R6.X mini-saga (MeetingHistoryPane), 严格说是 R5.A 漏建
- **修订** R5.A token 值 + 4 home 组件 + sidebar config + MentalPane

---

## 9. PM 待对齐的关键决策 (7 个)

按重要性排序:

### R6.1 · R5.A redo 范围 (**必决**)

R6 改动里**会议历史 + AI 心智一览 + lineage 改 ECharts** 是新东西, 一定要做. 但**首页 3 个组件返工 (DiscoveryBox / HomeFeedTabs / MeetingsPulse)** 工作量 ~14-19h, 是否优先?

选项:
- (a) **全部 redo** (推荐) — 一次性把首页拉到 R6 设计稿, 避免视觉撕裂
- (b) **只改 sidebar + tokens 加深 + MentalPane + MeetingHistoryPane** — 首页 3 个组件不动, 等首页大改 saga (现状不会撕裂, 但 PM 看 demo 时 LIVE 卡仍是 R5 旧版)
- (c) **仅改 light 颜色 (tokens.ts 9 行)** — 最小改, 首页 + 卡片都不动

**推荐 (a)**.

### R6.2 · ECharts 还是 @nivo/sankey?

`@nivo/sankey` 已经在 package.json. 但 R6 设计稿用了 ECharts 特有的 `emphasis.focus: 'adjacency'` + SMIL 等. 选项:

- (a) **装 echarts** (推荐) — 跟设计稿 1:1, ~900KB gzip, tree-shakeable
- (b) **复用 @nivo/sankey** — 减少依赖, 但需要自己实现邻接高亮 / 全屏 overlay / 详情侧栏的 ECharts 特性, 视觉效果可能不一致
- (c) **react-d3-sankey** — 轻量

**推荐 (a)** — PM 在 chat 里直接命名 ECharts, 设计稿配置很 ECharts-specific. 复刻成本高于直接装 echarts.

### R6.3 · 全屏画布交互保留全套吗?

R6 全屏 overlay 是**重型组件** ~250 行: pan + zoom + dot grid + mini-map + 键盘快捷键 + 460px 详情侧栏 + tooltip. 估算 22-28h 里**~12-15h 是这个**.

选项:
- (a) **全套实施** (推荐) — PM 明确要求 "无限画布", 全屏入口必须有
- (b) **简化版本** — 仅 inline Sankey + 简单详情 modal, 没有 pan/zoom (~8-12h)
- (c) **延迟到 R5.B 末尾** — 先做 inline 阶段 R5.B-replace-α(~10h), 全屏作为 R5.B-replace-β

**推荐 (a)** + 拆 α/β 节奏(α 先 ship inline, β 再补全屏).

### R6.4 · `/workstation/graph` URL 命运

R6 把 `#graph` 从侧栏移除, 但 URL 是否保留?

选项:
- (a) **URL 保留, 侧栏不展示** (推荐) — 支持深链 + 后续 OnBoarding 教程 + 嵌入 mental pane 共用 component
- (b) **URL 跳回 mental** — 干净但失去深链能力

**推荐 (a)**.

### R6.5 · Backend 接口名

R5 contract: `GET /api/workspace/:id/lineage`. R6 contract: `GET /api/workspace/:id/lineage/sankey`. 选项:

- (a) **直接用 R6 命名** `/lineage/sankey` (推荐)
- (b) **复用 R5 命名** `/lineage` — 但 schema 不一样 (edges → links + 无 kind), 容易混淆
- (c) **既给 `/lineage/graph` 又给 `/lineage/sankey`** — 后端工作量翻倍

**推荐 (a)** — PM 在 R6 chat 里没明确强调路径, 但 schema 改了, 用新 path 给后端避免歧义.

### R6.6 · MeetingHistoryPane 数据来源

`HISTORY_MEETINGS` 是 6 条 mock. 落地时:

- (a) **现有 backend meetings list 接口** — 应该已有, 但需要补 `mini-stat` 字段(decisions / actions / citations / mems)
- (b) **新接口 `GET /api/workspace/:id/meetings/history?seg=all|today|week`** — 直接按 segment 过滤 + paginate

**推荐 (a)** — 加字段比加接口便宜.

### R6.7 · 50 岁以上专家文案规则

R6 chat 明确 "中文化" — 所有 `chunk_X / p.N / sim_X.XX / P95 / SLA / stop loss` 改中文. 这个规则是否要**写进 `DESIGN_SYSTEM.md` 作为全局约定**?

- (a) **写进** (推荐) — 防止后续 Saga 漂移
- (b) **只在 LineagePane 详情面板生效** — 范围小, 但其他 Saga 可能没注意

**推荐 (a)** — 在 `DESIGN_SYSTEM.md` 新增 § "中文化原则", 适用所有面向终端用户的字符串.

---

## 10. [BACKEND-NEEDED] + [STYLE-DEVIATION]

### 10.1 [BACKEND-NEEDED]

按重要性:

#### B1 · `GET /api/workspace/:id/lineage/sankey` (R5.B-replace 必需)

```ts
GET /api/workspace/:id/lineage/sankey → {
  nodes: Array<{
    id: string,
    label: string,
    type: 'kb' | 'agent' | 'memory' | 'meeting',
    meta?: {
      agentId?: string,             // type='agent' 时必填, 给前端跳 AgentDetail
      pages?: number, chunks?: number, // type='kb'
      cited?: number, source?: string, when?: string, text?: string,  // type='memory'
      attendees?: string[], // type='meeting'
    }
  }>,
  links: Array<{
    source: string,  // node.id
    target: string,  // node.id
    value: number,   // 流量宽度, 引用次数 / 共享强度
  }>
}
```

后端必须遍历:
- KB → AI (owns 关系)
- AI → Memory (has 关系)
- Memory → Meeting (cite 关系)

**取消** R5 的 `participate / extract / create` 边类型(Sankey 单关系流向).

估计后端 **~6-10 小时**.

#### B2 · 会议 list 接口加字段 (R6.X 必需)

现有 meetings list 接口加:
```ts
{
  ...meeting,
  state: 'live' | 'done',
  decisions: number,
  actions: number,
  citations: number,
  mems: number,  // 新沉淀记忆数
}
```

估计后端 **~3-4 小时**.

#### B3 · 长期记忆"重要度"自动判定 (R5.B-replace 选作)

R6 设计稿在 memory 详情卡显示 `重要度 ≥10 高 / ≥5 中`. 可以前端 derive 自 `citedCount`, **不必新加 backend 字段**, 但建议 backend 显式返回 `importance: 'high'|'mid'|'low'` 避免前端硬编码阈值.

### 10.2 [STYLE-DEVIATION]

#### S1 · Light-mode token 加深 — **修订 DESIGN_SYSTEM.md § Web 紫色暗夜系统**

R5.A 落地的 light token 已经在生产用 (`bluesurfiregpt@gmail.com` workspace 已切 light 测过). R6 改 9 个变量值会**全局生效**.

要点:
- 不是新增 token, 是改值
- 现有用 `W_TOKENS.textPrimary` 等的代码**自动**变深, 无需碰
- 但 `DESIGN_SYSTEM.md` 上的样例 hex 需要同步更新

**主 Agent 实施 R6.0 必须**:
1. 改 `tokens.ts` 9 行
2. 改 `DESIGN_SYSTEM.md`(如果有 light token 样例区段) 同步 hex
3. PM review 一下 home + workstation 在 light 下文字对比度是否过强 (新值非常黑)

#### S2 · ECharts 引入 — **不是 deviation, 是新依赖**

R5.A 没引入 echarts. R6 必须装. PR 里要在 commit message 标 `[DEP: echarts@5]`.

#### S3 · 50 岁以上专家中文化规则 — **建议加进 DESIGN_SYSTEM.md**

新章节 "§ X 中文化原则":
- 所有面向终端用户的字符串使用中文
- 技术术语 (`chunk / page / similarity / SLA / P95 / stop loss / etc.`) 必须有中文对照
- 等宽字体只用在**数字 + 字母编号** (不用在术语)
- (这条规则推动全部 Saga, R5.B/C/D 一起遵守)

#### S4 · 频谱条 / 环形计时器 / Mira 动效 — **inline 实现**

R6 加了 3 处 SVG SMIL `<animate>` 元素 (DiscoveryBox 头像光环没用 SMIL, 但 MeetingsPulse Mira 频谱 11 根 + LIVE pulse dot 用了). 现有 W_THEME_CSS 已有 `@keyframes wPulse` `wFadeIn` `wModalIn` `wSlideIn` `wMoveRight`. R6 不需要扩 keyframe, 但频谱条用了 inline `<animate attributeName="height" ...>`. 不是 deviation, **就地实现**.

---

## 11. 总结

| 维度 | 结论 |
|---|---|
| 这是什么轮 | **round-6** — round-5 设计稿的 v2 打磨补丁, 同一 Claude Design session 接着推 11 轮反馈 |
| Mobile 是否改 | ❌ 完全不变, 跟 round-5 byte-identical |
| 是否替换 R5.B/C/D | ❌ 不替换, **修订** R5.B 中 Lineage 子项 (react-flow → ECharts) + **新增** R6.X (MeetingHistoryPane) + **R5.A redo** (4 home + sidebar + MentalPane + tokens) |
| 主要架构变更 | **Lineage 从 D3 force-directed → ECharts Sankey** (含 460px 详情侧栏 + 3600×2200 全屏无限画布) |
| 设计系统层面变更 | Light-mode 9 个 token 加深 (`#1c1c1e → #0a0a0e` 等) |
| 新增组件 | `MeetingHistoryPane / HistoryMeetingCard / MentalLiveSection / MiniStat / FlowExample / SankeyChart / FullscreenSankey` |
| 受影响 R5.A 实施 | tokens.ts (9 行) + sidebarConfig.ts (3 行) + MentalModelPane (大改) + DiscoveryBox / HomeFeedTabs / MeetingsPulse (3 个组件返工) |
| 主要后端增量 | `GET /api/workspace/:id/lineage/sankey` (替代 R5 设计的 `/lineage`) + meetings list 加字段 |
| 工作量 | **~48-64h 前端 + 6-10h 后端 = ~54-74h, 单人 ~1.5-2 周** (round-6 直接增量) |
| 跟 v1.3.1 协同 | 0 交集, 可直接基于 main 开 feature branch |
| 跟 mobile saga 协同 | 0 交集, mobile round-4 B/C/D 仍暂停, 不互相阻塞 |

---

## 12. 建议主 Agent 怎么呈现给 PM

按这个顺序聊:

1. **澄清判断**: round-6 是 round-5 的"打磨补丁", 而不是新一轮; mobile 完全没动.
2. **直接抛 7 个决策** (§ 9), 重点 **R6.1 (R5.A redo 范围, 必决) / R6.2 (ECharts vs nivo, 必决) / R6.3 (全屏画布是否拆 α/β, 必决)**.
3. **跟 mobile round-6 review 的关系** (另一个 review subagent 在写 SAGA-mobile-round-6-changelist.md):
   - 如果 mobile 也无大改: 把两份合并成 "round-6 全端打磨包"
   - 如果 mobile 也大改: 拆成 Web round-6 + Mobile round-6 两个 Saga 并行
4. **建议 scope 落地节奏**:
   - **路径 1 — "把 R5.A 拉到 round-6 完整版"**(推荐):
     - Phase α: R6.0 redo R5.A + R6.X MeetingHistoryPane (28-36h, ~1 周)
     - Phase β: R5.B-replace LineagePane Sankey α (inline + 详情侧栏, 不含全屏 ~12-14h, 3 天)
     - Phase γ: R5.B-replace LineagePane Sankey β (全屏无限画布 + mini-map, 10-14h, 3 天)
     - 总: ~1.5-2 周 单人 ship 完整 round-6 门面
   - **路径 2 — "纯打补丁, 不动 Lineage"**:
     - 只做 R6.0 + R6.X (28-36h, ~1 周)
     - LineagePane 推后到 R5.B 一起做
     - 优点: 短期完成快; 缺点: 心智模型 pane 嵌入血缘不能用, 跟 R6 设计稿不符
   - **推荐 路径 1**.
5. **重申双套设计系统不变** — Web 暗紫(双 theme) / Mobile 浅 iOS / 会议室浅 iOS. R6 没动这个边界.
6. **风险提示**:
   - 工作量比 R5.A (~60h) 稍小, 但首页 redo 跟 R5.A demo 视觉撕裂, **必须 PM 接受**
   - ECharts 是新依赖, 包大小 ~900KB gzip, 但 tree-shake 后可控
   - 全屏画布交互复杂, 触屏 / 大屏 / 多浏览器测试压力

---

> 本文档**仅 review**, **未触动任何代码**.
> 所有 design 文件保留在 `/tmp/claude-design-round6-web/aimeeting/project/` 供后续 subagent 1:1 移植参考.
> R5 baseline cached 在 `/tmp/claude-design-round5/aimeeting/project/`.
> R6 chat 增量 diff: `/tmp/chat2.diff` (R5→R6, 620 行).
