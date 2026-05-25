# Saga · Meeting Room v2 · 改动清单

> 来源: Bundle (`docs/design/handoffs/2026-05-25-meeting-room/`) + `docs/design/system/DESIGN_SYSTEM.md`
> Scope: 守住 `/m/meetings/[id]/` 一页 (PM 决策 思路 1 渐进式 Saga)
> 状态: 待 PM Review + 批准

---

## 0. TL;DR

这一 Saga 只重做 **移动端会议室页面** 的视觉 + 交互, 边界严格收在 `/m/meetings/[id]/page.tsx` 自身和它**专用**的几个 mobile 组件. 不动后端、不动 WS 协议、不动其他页面、不动共享组件 (`Toast` / `ConfirmDialog` / `AttachmentsSection` / `AIInsightCard` 等), 副作用接受视觉撕裂.

预计 **修改 7 个文件 + 新增 13 个文件 + 删除 0 个**, 工作量 ~36 小时.

---

## 1. Scope 边界

### 1.1 必动 (本 Saga 处理)

**主页面**
- `frontend/src/app/m/meetings/[id]/page.tsx` — 重写整页布局: dark → light (仅这一页), 引入 iOS 风骨架 (Header + AgendaStrip + ParticipantsStrip + scroll feed + ActionBar dock + 5 类 sheet)

**会议室专用组件 (改造)**
- `frontend/src/components/mobile/StageChipsRow.tsx` — 议程 chip 行 → 换成 segmented progress bar (浅色, bundle `AgendaStrip` 形态). **仅 meeting room 使用**, 安全改.
- `frontend/src/components/mobile/StickyActionBar.tsx` — 把单条 sticky bar 替换为 bundle 的双行 dock (Row 1 大紫色 `@AI 专家` + 大琥珀色 `问主持人` / Row 2 麦/摄像/举手/字幕/更多/结束 6 控制按钮). **仅 meeting room 使用**, 安全改.
- `frontend/src/components/mobile/AgendaEventBanner.tsx` — sticky top-60 emoji banner → 改造成 inline `HostMessage` 卡 (3 级 `drift-soft` / `drift` / `drift-strong`, 含 urgent pulse + 倒计时盒). **仅 meeting room 使用**. 改完不再 sticky, 由父页面把它嵌入 transcript feed 中.
- `frontend/src/components/mobile/SevereOffTopicModal.tsx` — 黑色全屏 modal → 浅色 280px iOS 居中弹窗 (跟 bundle `EndConfirm` 同形). **仅 meeting room 使用**, 安全改.
- `frontend/src/components/mobile/SummonAgentSheet.tsx` — dark sheet (圆角 24px, `bg-ink-950`) → 浅色 iOS sheet (圆角 14px, `bg-#F2F2F7`, 顶部把手 36×5px). **仅 meeting room 使用**, 安全改. 内部 agent 列表用 `MRAIAvatar` 渐变圆角方形头像.
- `frontend/src/components/mobile/MeetingTranscriptView.tsx` — dark transcript view → 浅色版本, 改 `UserLine` / `AgentLine` 用 bundle 的 `HumanMessage` / `AIMessage` 视觉 (头像 + 渐变 accent bar + data 块 + note 块). **仅 meeting room 使用**, 安全改. **WS 数据流 / event handling 保持不变**.

**不改但要复用**
- `frontend/src/components/mobile/LeaveMeetingSheet.tsx` — 用户点 ← 弹的"仅离开 / 结束 / 取消"sheet, 视觉沿用现有 dark 风格 (TD3). 仅 meeting room 用, 但因属于"返回流", 可在下一 Saga 一并浅色化.
- `frontend/src/components/mobile/MeetingRecorderControl.tsx` — 录音控制小条, 现在被 dock 区替代不再单独显示. 留组件但 page.tsx 不再渲它 (录音状态收进新 dock 的麦克风 CtrlBtn). 见 TD5.
- `frontend/src/components/mobile/NativeMeetingEntry.tsx` — 现 flag 关闭 (`NATIVE_MEETING_ENABLED=false`), 暂不动. 但若 flag 重新打开, 需 PM 决定要不要保留浅色化.
- `frontend/src/components/mobile/AttachmentsSection.tsx` — 多页复用, **不动**. 如果新会议室不再显附件区, 直接不渲染即可.

### 1.2 必新增 (本 Saga 新建)

放在 `frontend/src/components/mobile/meeting-room/` 子目录, 避免污染共享 mobile 组件.

- `frontend/src/components/mobile/meeting-room/MRHeader.tsx` — 顶栏: ← 历史 / 标题+实时红点+时长 / 章节 button / 筛选 button (含蓝色已激活角标)
- `frontend/src/components/mobile/meeting-room/ParticipantsStrip.tsx` — 横滑参会人头像列 (host + N humans + N AIs)
- `frontend/src/components/mobile/meeting-room/avatars.tsx` — `MRHumanAvatar` / `MRAIAvatar` / `MRHostAvatar` 三型头像组件 (含 speaking 脉冲 + muted 角标)
- `frontend/src/components/mobile/meeting-room/MRIcon.tsx` — 27 个 inline SVG icon (back/more/mic/mic-off/hand/sparkle/chat/end/video/video-off/cc/share/invite/note/gear/feedback/wechat/compass/clock/route/check/chev/live/filter/sparkle/...)
- `frontend/src/components/mobile/meeting-room/ChapterDivider.tsx` — 议程切换分隔符 (上下 hairline + caption2 议程编号 + 居中标题 + meta 行)
- `frontend/src/components/mobile/meeting-room/RoundMessage.tsx` — **AI 圆桌核心卡** (C5): header 紫渐变 + Mira 综合琥珀渐变 + 手风琴专家列表 + `StancePill` / `StanceDot` 子组件
- `frontend/src/components/mobile/meeting-room/HighlightsSheet.tsx` — 章节 / 重要时刻 bottom sheet (从 mock timeline 自动提取 5 类节点跳转)
- `frontend/src/components/mobile/meeting-room/FilterSheet.tsx` — 发言人筛选 sheet (multi-select host + humans + ais), **仅 UI**, 筛选目标是本地 mock 数组 (见 D 节)
- `frontend/src/components/mobile/meeting-room/FilterBanner.tsx` — 筛选激活时 sticky banner (filter icon + "仅显示" + chip 列 + matched/total + 清除)
- `frontend/src/components/mobile/meeting-room/AskHostSheet.tsx` — 问主持人 Mira sheet (含 host self-intro 卡 + 6 个 quick chips + 自由输入 textarea + 按住说话 + 发送)
- `frontend/src/components/mobile/meeting-room/MoreSheet.tsx` — 更多 sheet (屏幕共享 / 邀请 / 纪要 / 字幕设置 / 转发微信 / 反馈 / 设置 7 项, 微信项绿底)
- `frontend/src/components/mobile/meeting-room/EndConfirm.tsx` — 结束会议 iOS 居中确认弹窗 (280px, hairline 分隔双键). **跟 bundle 一致, 替换现有 `ConfirmDialog`** (仅 meeting room scope)
- `frontend/src/components/mobile/meeting-room/JumpToLatestFab.tsx` — 跳到底 FAB (滚离底 80px 时显, `position: absolute; right: 14; bottom: 178`)

**数据 / mock 文件**
- `frontend/src/components/mobile/meeting-room/mock/roundtable.ts` — AI 圆桌假数据 (1-2 条预置 round, structure 同 bundle `MR_MESSAGES` index 14). 见 D 节方案.
- `frontend/src/components/mobile/meeting-room/styles.ts` — 共享视觉常量 + animation keyframes inject 工具 (`fadeIn` / `slideUp` / `popIn` / `wfBar` / `dotBounce` / `livePulse` / `speakingPulse` / `urgentPulse`)

**Kimi 测试用例**
- `docs/kimi-tests/v28.0-meeting-room-v2-kimi.md` — 本 Saga 验收用例 (按 `CLAUDE.md` 强制要求产出)

### 1.3 不动 (后续 Saga 或永不动)

| 文件 / 目录 | 原因 |
|---|---|
| `frontend/src/app/m/page.tsx` 工作台首页 | C1 视觉撕裂, 下个 Saga 处理 |
| `frontend/src/app/m/meetings/page.tsx` 会议列表 | 同上 |
| `frontend/src/app/m/meetings/[id]/summary/page.tsx` 总结页 | 同上 |
| `frontend/src/app/m/meetings/new/page.tsx` 新建会议 | 同上 |
| `frontend/src/app/m/agents/` 专家墙 + 详情 | 同上 |
| `frontend/src/app/m/tasks/` 任务 | 同上 |
| `frontend/src/app/m/insights/` 记忆库 | 同上 |
| `frontend/src/app/m/me/` 个人页 | 同上 |
| `frontend/src/app/m/notifications/` 通知 | 同上 |
| `frontend/src/app/m/MobileShell.tsx` shell + BottomNav | 沿用现有 dark, 会议室 page 自己 `fixed inset-0` 覆盖, 不影响 |
| `frontend/src/app/m/layout.tsx` mobile layout | 同上 |
| `frontend/src/app/globals.css` 全局 CSS | 沿用 — 新动画 keyframes 注入本 Saga 的 styles.ts 即可, 不污染全局 |
| `frontend/tailwind.config.ts` | 沿用现有 `ink` / `accent` 色板 — 新页直接 inline iOS 色值, 不扩展 Tailwind 全局 token (避免下 Saga 反复改 config) |
| `frontend/src/lib/mobile/api.ts` | 后端 API 不动 |
| `frontend/src/lib/mobile/meetingWsBus.tsx` | WS 协议不动 |
| `frontend/src/lib/mobile/types.ts` | type 不扩展 — AI 圆桌走 mock, 不进后端 schema |
| `frontend/src/components/mobile/AIInsightCard.tsx` | 多页复用 — 工作台 / 任务详情 / 智能墙都用. 本 Saga **绝不改**. 会议室内不再用此卡, 改用新 `AIMessage` |
| `frontend/src/components/mobile/Toast.tsx` | 多页复用, 沿用 |
| `frontend/src/components/mobile/ConfirmDialog.tsx` | 多页复用. 会议室换成新 `EndConfirm`, 但组件文件本身不动 |
| `frontend/src/components/mobile/CurrentTopicCard.tsx` | 现 page.tsx 已不用 (已被替换), 留作 dead code 不删 (TD6) |
| `frontend/src/components/mobile/HeroOngoingCard.tsx` | 工作台用 |
| `frontend/src/components/mobile/AgentWorkCard.tsx` | 专家墙用 |
| `frontend/src/components/mobile/MeetingCarousel.tsx` | 工作台用 |
| backend 全部 | AI 圆桌 mock, 不进后端 |
| 小程序 / native 端 | 不在 H5 scope |

---

## 2. 改动清单

### 2.A 修改文件

| 文件 | 改动 | 代码量 (估) |
|---|---|---|
| `frontend/src/app/m/meetings/[id]/page.tsx` | 重写整页结构: 移除 dark `bg-ink-950` 容器, 改用 `bg-[#F2F2F7]` 浅色 + iOS 字体. 重组渲染 (MRHeader + AgendaStrip + ParticipantsStrip + scroll feed + Dock + 5 sheet + EndConfirm). WS event handling / API 调用保持不变, 仅渲染层换. | ~600 行 (从 604 → ~700, 含新组件 wire-up) |
| `frontend/src/components/mobile/StageChipsRow.tsx` | dark chip row → 浅色 `AgendaStrip` (`议程 X/N` + 当前 title + 剩余分钟 + segmented progress bar). props 不变 (`items` / `currentIdx` / `isComplete`). | ~90 行 (重写) |
| `frontend/src/components/mobile/StickyActionBar.tsx` | dark 单条 sticky → 双行浅色 dock (Row1 = 2 个 PrimaryBtn 渐变大按钮 / Row2 = 6 个 CtrlBtn). props 扩展: `onSummonAi` 拆为 `onSummonAi + onAskHost`, 新增 `muted/video/hand/cc/onMore/onEnd` 状态 + setter. | ~200 行 (重写) |
| `frontend/src/components/mobile/AgendaEventBanner.tsx` | sticky banner → inline `HostMessage` 三级卡 (`drift-soft` / `drift` / `drift-strong`). 不再 sticky, 由父页面在 transcript feed 中渲染 (TD1). WS event 到 BannerData 的映射在 page.tsx 调整 — 现 6 类 emoji banner 映射到 3 级 drift + route + timer. | ~250 行 (重写) |
| `frontend/src/components/mobile/SevereOffTopicModal.tsx` | dark 全屏 modal → 浅色 280px iOS 居中弹窗 (同 bundle `EndConfirm` 形). 仍含倒计时 + 自动召主持人. 视觉换, 行为保留. | ~120 行 (重写) |
| `frontend/src/components/mobile/SummonAgentSheet.tsx` | dark sheet → 浅色 iOS sheet (顶部把手 + 14px 圆角 + bg `#F2F2F7` + agent 行用 `MRAIAvatar` 渐变方形头像). props 不变. | ~140 行 (重写) |
| `frontend/src/components/mobile/MeetingTranscriptView.tsx` | dark transcript → 浅色: `UserLine` 换成 bundle `HumanMessage` (头像 32px 个人色 + waveform + @mention 紫高亮 + offTopic/summon/askHost meta chip), `AgentLine` 换成 bundle `AIMessage` (头像 26px 渐变方形 + 左 3px accent bar + data 块 `#F7F7F9` + note 块渐变 ×10 alpha). WS 数据流 / streaming / IntersectionObserver autoscroll 全部保留. **空头像**回退 (后端不返 `agent_color` 渐变时) 走 fallback 单色. | ~470 行 (重写, 从 457) |

### 2.B 新增文件

| 新文件 | 用途 | 代码量 (估) |
|---|---|---|
| `frontend/src/components/mobile/meeting-room/MRHeader.tsx` | 顶栏 (← 历史 + 标题+实时 + 章节 + 筛选) | ~80 行 |
| `frontend/src/components/mobile/meeting-room/ParticipantsStrip.tsx` | 横滑参会人头像列 | ~80 行 |
| `frontend/src/components/mobile/meeting-room/avatars.tsx` | 3 型头像 `MRHumanAvatar` / `MRAIAvatar` / `MRHostAvatar` | ~150 行 |
| `frontend/src/components/mobile/meeting-room/MRIcon.tsx` | 27 个 inline SVG icon | ~80 行 |
| `frontend/src/components/mobile/meeting-room/ChapterDivider.tsx` | 议程切换分隔 | ~50 行 |
| `frontend/src/components/mobile/meeting-room/RoundMessage.tsx` | AI 圆桌核心 (含 `MiraSynthesis` + `ExpertAccordion` + `StancePill` + `StanceDot`) | ~300 行 |
| `frontend/src/components/mobile/meeting-room/HighlightsSheet.tsx` | 章节 sheet | ~120 行 |
| `frontend/src/components/mobile/meeting-room/FilterSheet.tsx` | 发言人筛选 sheet | ~150 行 |
| `frontend/src/components/mobile/meeting-room/FilterBanner.tsx` | 筛选激活 sticky banner | ~80 行 |
| `frontend/src/components/mobile/meeting-room/AskHostSheet.tsx` | 问主持人 Mira sheet | ~180 行 |
| `frontend/src/components/mobile/meeting-room/MoreSheet.tsx` | 更多 sheet (7 项, 微信绿) | ~80 行 |
| `frontend/src/components/mobile/meeting-room/EndConfirm.tsx` | 结束会议 iOS 居中弹窗 | ~60 行 |
| `frontend/src/components/mobile/meeting-room/JumpToLatestFab.tsx` | 跳到底 FAB | ~30 行 |
| `frontend/src/components/mobile/meeting-room/styles.ts` | 共享 iOS 色值常量 + 注入 keyframes 工具 (放进一个 `<style>` global by useEffect) | ~80 行 |
| `frontend/src/components/mobile/meeting-room/mock/roundtable.ts` | AI 圆桌 mock 数据 (1-2 条 round message) + 触发条件 | ~120 行 |
| `docs/kimi-tests/v28.0-meeting-room-v2-kimi.md` | Kimi 测试用例 | ~350 行 |

### 2.C 删除文件 (本 Saga 不删)

无. `CurrentTopicCard.tsx` 已是 dead code, 但保留, 见 TD6.

### 2.D Mock 数据来源 (AI 圆桌 C5)

PM 决策: AI 圆桌 **只做 UI + mock**, 不接后端.

**推荐方案**: 把 mock 放在 `frontend/src/components/mobile/meeting-room/mock/roundtable.ts`, 一个常量数组 `MOCK_ROUNDTABLE_MESSAGES`. 结构 1:1 复制 bundle `meeting-room-shared.jsx:113-162` 的 `MR_MESSAGES` index 14 (round kind), 但 `who/by` 字段对应到 mock-only 的 agent id (e.g. `"ARIA"`, `"LEX"`, `"SAGE"`). 真实 `MR_HUMANS` / `MR_AIS` 也搬入 mock 文件作为 fallback 数据.

**注入策略**: page.tsx 把 mock round message **insert** 到从后端拿到的真实 transcript lines 中 (按 `at_minute` 比较插位置), 而不是替代. 这样:
- 真实 transcript 一直能流 (WS 推 streaming AI 回复)
- AI 圆桌作为"装饰性 demo" 卡片穿插显示
- 用户能直观看到圆桌 UI, 但点圆桌内的 "记入决策" / "详细数据" 按钮**无后端响应** (仅 toast `"AI 圆桌为 demo, 后续接入"`)

**触发条件 (默认开)**: 当 page mount 时, 永久插入 1 条 round 到 transcript 第 N+1 位 (N = 真实 lines.length). 不需要任何 trigger.

**反例 (不要做)**:
- ❌ 不要把 mock 走 WS event 注入 — meetingWsBus 是真协议, mock 会污染
- ❌ 不要新建后端 endpoint mock — PM 明确 "后端留给后续 Saga"
- ❌ 不要把 mock agent 写进 `attending_agents` — 那会让 SummonSheet 也出现假 agent

见 TD2 给最终方案投票.

---

## 3. 关键技术决策点 (需 PM 拍板)

### TD1 · 议程事件 (`AgendaEventBanner`) 的位置: sticky vs inline

现行: sticky `top:60`, 单 slot 新覆盖旧. 用户滚动时一直见.

bundle: inline 进 transcript feed, 跟 host message 同流, 滚走就不见.

**冲突**: 现有 6 类 banner (off_topic / time_warning / stuck / dissent / decision_summary / advance_suggested) 对应 bundle 3 类 (drift 三级 + route + timer + agenda 切换), 映射不 1:1.

**建议**: 全部映射到 inline `HostMessage`, 三种 tone:
- `off_topic` (severity=suspected/confirmed) → `drift-soft`
- `off_topic` (severity=high but not severe) → `drift`
- `off_topic` (severity=severe) → `drift-strong` 红卡 inline (不再走全屏 modal, 但保留 modal 作为 fallback 给后端 confidence 极高的情况? — 见 TD4)
- `time_warning` / `stuck` → `timer` tone (橙色 clock icon)
- `dissent_detected` → `drift` tone + 改 title 包含 `parties`
- `decision_summary` / `advance_suggested` → `route` tone (橙色 route icon)

**风险**: 失去"任何时刻都看得见"的 sticky 优势 — 用户滚到下方时如果新 banner 进来, 在视野外. 建议: 配合 jumpToLatest FAB + 来新 host card 时若用户不在底则 FAB 亮琥珀色提示.

**PM 必答**: 接受 inline 化吗? 还是保留 sticky + 视觉浅色化但行为不变?

### TD2 · AI 圆桌 mock 数据何时显示

3 个候选方案:
- **A. 永久 1 张**: page mount 时插入固定 1 条 round message, 永远在 transcript 末尾出现. 适合纯 demo.
- **B. 触发式**: 用户点 dock 上 `@ AI 专家` → 选 ≥ 2 个专家 → 模拟生成 round (3 秒 fake loading + 显示).
- **C. 永久 + 触发**: A + 用户主动触发可以再加更多 round.

**建议 A** — 最低风险, 不耦合 SummonSheet 真实流程, 用户演示时永远能看到. 反正下 Saga 会接真后端, 本 Saga UI 验收即可.

**PM 必答**: A / B / C 选哪个?

### TD3 · 沿用 dark 的"返回流"组件: `LeaveMeetingSheet`

会议室浅色后, 用户点 ← 弹的 sheet 还是 dark `bg-ink-950`. 视觉撕裂.

**候选**:
- **a. 本 Saga 也改浅色** (~30 分钟工作量)
- **b. 留 dark, 下 Saga 顺势改**

**建议 a** — 工作量小, 一次到位, 不留视觉撕裂. 但 PM 想守严 scope 选 b 也行.

### TD4 · `SevereOffTopicModal` 是否保留为 fallback

TD1 决定后, 如果 off_topic severity=severe 也走 inline `drift-strong`, 那原来的全屏 modal 还要不要?

**候选**:
- **a. 完全废弃**: 删 modal 用法, severe 也只 inline 红卡. 用户体验更轻.
- **b. 保留**: severe 走全屏 (现有行为), 中度以下 inline. 强决策走 modal 保证用户必看.

**建议 b** — 强 severe 比较罕见 (后端置信度极高), 全屏决策有安全感, 浅色化 modal 即可 (像 bundle `EndConfirm` 那种 280px iOS 居中, 不是黑底).

### TD5 · 麦克风录音控制 (`MeetingRecorderControl`) 放哪

现行: 单独一条 sticky 在 transcript 下方 + dock 上方.

bundle: dock Row 2 有麦克风 `CtrlBtn`, 单击 toggle mute (active 时红).

**候选**:
- **a. 完全合并到 dock 麦克风按钮**: 录音状态机进 dock 按钮 (开麦/闭麦/失败 重试), 失败时按钮变红色 + tooltip.
- **b. 保留 `MeetingRecorderControl` 单条**: dock 上的麦克风按钮做镜像状态显示 (active=红=已闭麦), 实际 toggle 走 RecorderControl.

**建议 a** — 视觉简洁, dock 充当统一控制中心. 录音中放小红点 livePulse 在按钮右下 (跟 bundle `drift-strong` 的红角标同形).

**风险**: 失败重试要进 dock 按钮的 "long press" 或者下拉 More sheet, 反馈链路更长. 失败案例少, 可接受.

### TD6 · `CurrentTopicCard.tsx` 处理

dead code, page.tsx 不再 import 它. 删 / 留?

**建议**: 留 (本 Saga 保守 scope). 标 `@deprecated`. 下 Saga 一并清.

### TD7 · 字体 (SF Pro vs Inter)

bundle 用 `-apple-system, "SF Pro Text", ...` 系统字, 现有用 `Inter` (next/font).

**候选**:
- **a. 整页内联 SF Pro 字体栈**, 强制 iOS 原生感. 安卓 / 微信浏览器 fallback `system-ui`.
- **b. 保留 Inter**: 设计稿 iOS 字体仅是视觉效果, Inter 也接近.

**建议 a** — 浅色 iOS 风格的核心识别力, fallback 在非 iOS 上不会丑.

**实施**: page.tsx 容器 `style={{ fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif" }}` 覆盖一层. 不动 tailwind config / next-font.

### TD8 · 章节 / 筛选 mock 数据

bundle 的 Highlights 是 `getHighlights()` 自动从 `MR_MESSAGES` 提取 5 类节点. 真实 timeline 是后端返的 transcript lines.

候选:
- **a. mock + 真实合并**: Highlights 仅显示 mock round (5 类节点) + 真实 host card. 真实 humans/AI 不显.
- **b. 仅 mock**: Highlights 永远显 mock 3-5 个节点 (假数据).
- **c. 隐藏入口**: 章节 button 现在不可点 (灰), 等下 Saga 接后端再开.

**建议 b** — 跟 AI 圆桌 一起作为 UI demo, 不接后端不污染数据流.

### TD9 · 6 个 AI 专家与现有 workspace agent 的映射

DESIGN_SYSTEM C8: bundle 固定 6 名 (Aria/Stratos/Lex/Sage/Tally/Scout), 现有 workspace 自定义 agent.

**本 Saga 不解这个冲突** — 真实 transcript 仍走后端 `agent_name` / `agent_nickname` / `agent_color`. mock 圆桌的 3-4 个 expert 用 bundle 固定 6 名. **不同名空间, 不混**.

**风险**: 视觉上 transcript 里可能出现"陈老师 (橙色单圆头像) + Aria (蓝紫渐变方形)" 同框. 接受 — 这是 mock 的代价.

### TD10 · 浅色化范围内是否同步更新 BottomNav

`MobileShell.tsx` 判断会议室隐藏 BottomNav. 现状是会议室 page 自己 `fixed inset-0 z-30` 覆盖 BottomNav. 浅色化后:
- BottomNav 仍 dark, 用户从会议室返回 `/m/meetings` 时, 列表页和 BottomNav 都是 dark, **不撕裂**.
- 会议室页面浅色, 自己覆盖 BottomNav, **不撕裂**.

**结论**: 不需要动 MobileShell / BottomNav. 视觉撕裂只在"列表页 → 会议室"的 transition (用户已知接受).

---

## 4. 风险点

### R1 · WS event 到 inline HostMessage 的映射可能丢失信息

现有 6 类 banner 各自带特定字段 (e.g. `advance_suggested.advanceTargetIdx`, `decision_summary.decision_summary_query`). 重写后必须确保:
- `advance_suggested` 的 `[立刻推进 →]` 按钮仍能调 `handleAdvance`
- `decision_summary` 的倒计时仍能触发自动 `onSummonAgent`
- `dissent_detected` 的 `parties` 仍能显示
- 所有 6 类的 `agentId / invokeQuery` 仍能正确传给 `handleSummonAgent`

**mitigation**: 实施时严格 1:1 映射, 每类写一个单测 (或至少 cy snapshot). 在 changelist 后续给 code-subagent 时附带 mapping table.

### R2 · 浅色化破坏现有用户的"夜间"使用习惯

工作台 dark, 会议室浅色, 中午会议室可能太刺眼. 建议: 看 PM 是否需要给浅色 / 跟随系统色 toggle (本 Saga 范围外, 列入下 Saga issue).

### R3 · Mock AI 圆桌引起用户对"真"功能的期待落差

用户看到 round card 上的 `[记入决策]` / `[详细数据]` 按钮, 点击仅 toast "demo 后续接入" 可能挫败.

**mitigation**: 在 round card header 加微小 caption "演示" tag (e.g. `<DemoBadge />` 紫色 9px 角标, 跟 bundle `AI` badge 同形). 见 TD2 选定的方案后再细化.

### R4 · ChapterDivider 替代 `agenda` tone host message 的解析依赖

bundle `ChapterDivider` 用正则 `/议程\s*(\d+)\s*[:：](.+?)$/` 从 message body 抽议程编号 + title. 现有后端 `agenda_advanced` event 字段直接给数字 + title, **不走文本解析**. 实施时直接用 event 字段, 不要照抄 bundle 的 regex (会脆).

### R5 · 三型头像组件需要后端无 `agent_color` 时的 fallback

后端 `agent_color` 是 8 个 Tailwind 语义色名 (`violet / emerald / ...`), bundle `MR_AIS` 是 6 个 fixed 渐变. 真实 agent 没渐变, fallback:
- 后端给 `agent_color = "violet"` → `MRAIAvatar` 用 `["#AF52DE", "#5E5CE6"]` 渐变 (映射表)
- 后端不给 / 名字不在表里 → fallback 单色 圆角方形 (用 `#5E5CE6` 紫 + 白色 sparkle)

**实施**: 在 `avatars.tsx` 内置 `COLOR_TO_GRADIENT` 映射表, 8 个 Tailwind 色名各对应一对 hex 渐变.

### R6 · iOS WKWebView (微信浏览器) 不支持 `backdrop-filter: blur`

bundle `EndConfirm` 用 `backdropFilter: blur(20px)`. 微信浏览器旧版本可能不支持, 退化为不透明背景. 这是已知的小程序 webview 限制. 接受.

### R7 · 7 个 sheet 的 z-index 冲突

5 个 sheet (Summon / AskHost / More / Filter / Highlights) + EndConfirm + LeaveSheet + SevereModal + Toast. 现有用 `z-50`, bundle 用 `z-80/81/90/91`. 实施时给本 Saga 内的所有 sheet/modal 一个统一 z-index 规划:

```
0     base
20    transcript content / dock (z-30 fixed inset)
60    FAB / FilterBanner sticky
80    sheet 遮罩 (Summon/AskHost/More/Filter/Highlights)
81    sheet 主体
90    Modal 遮罩 (EndConfirm/SevereOffTopic/LeaveSheet)
91    Modal 主体
50    Toast (最顶层, fixed)
```

### R8 · 浅色化对 `globals.css` 的潜在污染

`globals.css` 有现有动画 (`focusGlow`, `ai-gradient-flow`, `clock-glow-*` 等). 本 Saga 新动画 (`fadeIn`, `slideUp`, `popIn`, `urgentPulse` 等) **不写进 globals.css**, 而是在 `meeting-room/styles.ts` 内用 useEffect 注入 `<style>` tag (跟 bundle `meeting-room.jsx:1723-1751` 一样). 卸载页面时清掉. 避免污染其他页.

### R9 · transcript view 数据形态 vs bundle MR_MESSAGES 不同

真实 `TranscriptStreamLine` 只有 `kind: 'user' | 'agent'`, 没有 `host` / `round` 类型. inline HostMessage 怎么进流?

**实施**: page.tsx 维护一个 `mergedTimeline` 数组, 由以下源 merge 而成:
1. `MeetingTranscriptView` 拿到的真实 `lines` (user / agent)
2. WS event handler 拿到的 host card (从 `banner` / `severeOffTopic` state 提取)
3. mock round messages (本地常量)

然后渲染顺序按时间戳排. 这意味着 **`MeetingTranscriptView` 不再独立渲染** — 它的 lines 数据由 page.tsx 拿到后, 跟 host / round 一起合并渲染. 这是一个**比"组件改造"更深的重构**.

**候选**:
- **a. 上移渲染**: page.tsx 自己拉 `lines + meta`, transcript view 拆成纯渲染 + 数据 hook. 重构成本高.
- **b. transcript view 内部 merge**: transcript view 接收 page.tsx 推下来的 host card + round mock, 自己 merge 渲染. 改动小但 transcript view 变 bloated.

**建议 b** — 把 transcript view 改成既渲染 user/agent 也渲染 host/round (props 新增 `hostCards` 数组 + `roundMessages` mock). MeetingTranscriptView 仍是渲染唯一出口.

### R10 · TopBar 上"实时" 红点闪烁 vs 现有 `<ConnDot>` WS 连接指示

bundle TopBar 显示 `实时 · 23:14` (livePulse 红点). 现有 transcript view 顶部有 ConnDot (绿/黄/红 = 已连/重连/失败). 重复信号.

**实施**: 砍掉 transcript view 顶部 ConnDot, 信号合并进 MRHeader 的"实时" — WS 已连接时 livePulse 红点, 重连时改琥珀 livePulse, 失败时改 grey + 点击 reload.

---

## 5. 估算工作量

| 阶段 | 估算 |
|---|---|
| A. 基础: 浅色容器 + iOS 字体 + 27 icon + 3 型头像 + ChapterDivider + 动画 inject | 6h |
| B. 修改 7 个 mobile 组件 (StageChipsRow / StickyActionBar / AgendaEventBanner / SevereOffTopicModal / SummonAgentSheet / MeetingTranscriptView 浅色化, 视觉 1:1) | 10h |
| C. 新增 4 个核心 sheet/modal (HighlightsSheet / FilterSheet / AskHostSheet / MoreSheet / EndConfirm) + JumpToLatestFab + FilterBanner | 6h |
| D. AI 圆桌 (RoundMessage + MiraSynthesis + ExpertAccordion + StancePill + StanceDot) + mock 数据 + 插入 transcript | 5h |
| E. page.tsx 整页重写 + 6 类 WS event → 3 级 drift/route/timer host card 映射 + mergedTimeline 数据流 | 5h |
| F. Kimi 测试用例 (`v28.0-meeting-room-v2-kimi.md`, ~350 行) + 部署联调 | 4h |
| **总计** | **~36 小时** |

---

## 6. 实施顺序建议

code-subagent 实施时建议按下面顺序, 每一步都可独立验收, 出问题时回滚成本小.

1. **Step 1 (基础设施, ~6h)**: 先新建 `meeting-room/` 子目录, 实现 `avatars.tsx` / `MRIcon.tsx` / `styles.ts` (动画 inject), 写一个临时 demo 页面 `/m/meetings/[id]/demo` 单独渲染所有 atoms 测视觉. 完成后 PM 看一眼颜色 / 头像是否对.

2. **Step 2 (改造 6 个共享组件, ~8h)**: 按顺序改 `StageChipsRow` → `SummonAgentSheet` → `SevereOffTopicModal` → `AgendaEventBanner` → `MeetingTranscriptView` → `StickyActionBar`. 每改完一个, page.tsx 立即接上, 看一眼能不能跑 (浅色 + 现有逻辑). 不要一次改 6 个再 wire-up.

3. **Step 3 (新增主页面 chrome, ~3h)**: 新建 `MRHeader` / `ParticipantsStrip` / `ChapterDivider` / `JumpToLatestFab` / `FilterBanner`, 接进 page.tsx. 这一步会让会议室看起来"基本对".

4. **Step 4 (4 个 sheet, ~5h)**: `HighlightsSheet` (mock) / `FilterSheet` / `AskHostSheet` / `MoreSheet` / `EndConfirm`. 每个独立 sheet 用 storybook 风跑一遍.

5. **Step 5 (AI 圆桌, ~5h)**: 实现 `RoundMessage` + `MiraSynthesis` + `ExpertAccordion` + `StancePill` + `StanceDot` + mock data. 注入 transcript view, 看圆桌能不能在末尾显示 + accordion 能不能展开收起.

6. **Step 6 (WS event mapping + mergedTimeline, ~5h)**: 把 6 类 WS event 重新映射到 3 级 drift/route/timer host card, page.tsx 维护合并 timeline, 真实 host card + mock round 都能进流. **这一步最容易出 bug**, 必须每一类 event 手动触发一次过.

7. **Step 7 (Kimi 测试用例, ~4h)**: 按 `CLAUDE.md` 要求写 `docs/kimi-tests/v28.0-meeting-room-v2-kimi.md`. 覆盖:
   - P-1~P-3 预检 (生产页面 200 / API 401 / 登录看到 Mira 头像)
   - T-01 浅色切换 (会议室进入后, 整页 bg 是 `#F2F2F7` 不是 `#0b0d12`)
   - T-02 三型头像 (真人圆形 / AI 方形 / Mira 同心圆 各至少 1 个能截图区分)
   - T-03 Dock 双行 (`@AI 专家` + `问主持人` 2 个大渐变按钮可点, 弹对应 sheet)
   - T-04 议程 segmented progress (议程切换后 done 段变绿)
   - T-05 AI 圆桌 mock 显示 (mount 后 transcript 末尾出现 round card)
   - T-06 圆桌 accordion 一次只展开一个
   - T-07 章节 sheet (顶栏点章节, sheet 弹起, 至少 1 个 mock 节点)
   - T-08 筛选 sheet (选 host, transcript 仅显 host card)
   - T-09 强提醒 inline (severe off_topic 触发, transcript 内出现红卡 + 倒计时 + urgentPulse)
   - T-10 结束会议 iOS 风弹窗 (`确定` 按钮 vs `取消` 红/蓝色对齐 bundle)

8. **Step 8 (浅色化扫尾, ~1-2h)**: 联调 + 修视觉 bug + 反思填进 DESIGN_SYSTEM 附录 D.

---

## 7. 不在本 Saga scope 的副作用清单 (给 PM 看)

PM 已接受, 此处只是确认:

- **F1 视觉撕裂**: `/m` 工作台仍 dark, 进 `/m/meetings/[id]` 突然 light. 接受.
- **F2 AI 圆桌假**: 用户点圆桌内"记入决策"等按钮 → toast 提示 demo. 接受.
- **F3 Mira 在其他页面看不见**: 只在会议室出现. 用户首次接触 Mira 体验断裂. 接受.
- **F4 历史会议室没体验更新**: 进 finished 会议也走新浅色 UI, 看到的是新视觉 + 历史 transcript data. 这其实是好事 — 全量用户立刻看到效果. 但: 历史会议数据没有 "host card" 类型, 也不会有 round, 仅显示 human/agent line. 接受.
- **F5 章节 / 筛选只能筛 mock 数据**: 真实数据无 chapter/highlight 提取. 接受.
- **F6 浅色化没考虑系统色跟随**: 未来"夜间模式" 需另起 Saga. 接受.

---

## 附录 A · 文件移动清单 (备查)

无文件移动. 所有改动是 in-place 修改 + 新增子目录.

## 附录 B · 命名约定

- 新组件统一 `MR*` 前缀仅在 atoms 上 (`MRHeader`, `MRIcon`, `MRHumanAvatar`...). 容器组件直接用业务名 (`RoundMessage`, `ChapterDivider`, `HighlightsSheet`...).
- 颜色常量集中在 `styles.ts`, 不写 hardcoded hex 散落各处 (除非是个人色 / 渐变 — 那些跟数据绑, 在 avatars.tsx).
- Mock 数据文件名 `mock/<type>.ts`, 暂只 `roundtable.ts`. 不要 import 真后端 types — 直接定义自己的 mock 形态.

## 附录 C · DESIGN_SYSTEM 反推回写

本 Saga 完成后, 在 `DESIGN_SYSTEM.md` 的下列章节加 `**决策**: ...` 行:
- C1 (色调): 决策 = 本 Saga 仅会议室浅色, 其他保留 dark
- C5 (AI 圆桌): 决策 = 本 Saga UI + mock, 后端下 Saga
- C10 (Mira 具象化): 决策 = 本 Saga 仅会议室出现, 其他下 Saga

并新增 11 节 `[新 pattern]` 列出本 Saga 引入的:
- `MR*` 子目录约定
- 浅色 sheet 14px 圆角约定
- 3 型头像组件 API
- mock 数据隔离原则 (`mock/` 子目录 + 不污染 types.ts)
