# Saga · Mobile Round-6 · Review 清单

> **来源**: Claude Design handoff `sWjVOWmjr5wXT8w-ydR6tQ` (2026-05-26)
> **Bundle 解压路径**: `/tmp/claude-design-round6-mobile/aimeeting/project/`
> **完整 chat 记录**: `/tmp/claude-design-round6-mobile/aimeeting/chats/chat1.md` + `chat2.md` (3235 行)
> **状态**: **REVIEW ONLY — 待 PM 对齐 scope + 优先级, 主 Agent 严禁先 coding**
> **配对 review**: `SAGA-web-round-6-changelist.md` (另一个 subagent 同步在写, Web 端)

---

## 0. TL;DR (一页扫读)

**Round-6 = Web-only 迭代轮. 移动端文件 byte-identical 跟 round-4 / round-5, 没有任何新移动端设计.**

PM 在 chat2 后半段 (line 1678+ 之后, ~618 新行) 全部在做 Web 端 — 全景血缘 Sankey + 全屏无限画布 + 详情侧栏 + 桑基 → 心智模型 合并为 「AI 心智一览」 + 浅色 home 卡片 + 明亮模式 token 加深. 完全没碰 mobile.

| 维度 | 现实 |
|---|---|
| Mobile JSX 8 个文件 | **byte-identical** vs R4/R5 (SHA-256 全等) |
| `Mobile App.html` 入口 | 跟 R4 差 1 行 (`animationFillMode: 'forwards'` 修 fadeIn, 已在 R5 review 标记过) |
| 新 mobile 概念 | **0 个** |
| R6 chat 里 "mobile" 关键词 | **2 次, 都是 web canvas `touchAction: 'none'` 防移动端手势冲突, 不是 mobile 设计** |
| 新 mobile 截图 | **0** (uploads 全是 web home / lineage) |

### 不是 "新 mobile 轮", 但**触发 4 个跨端波及决策**:

1. **R6 web "AI 心智一览" 概念 vs Saga C `/m/insights` MemoryRadar 关系** — 同一产品意图 (KB / Memory / Agent 三角关系可视化) 在两端用了**不同隐喻** (mobile = 6 轴雷达; web R6 = 桑基 + 力导向 + 节点详情侧栏). 建议**统一信息架构**, 否则用户跨端切换会迷惑.
2. **R6 web 明亮模式专属配色 vs mobile 浅色 iOS** — R6 chat 明确 web 也支持明亮模式且 token 跟 dark 不同(line 2102, 2274 加深正文文字). Mobile 浅色 一直走的是 iOS systemGray token. 需要在 `DESIGN_SYSTEM.md` 把 "浅色" 拆成两套 (Web 明亮模式 / Mobile + 会议室 iOS 浅色).
3. **R6 chat 没复活 round-4 Saga B/C/D** — PM 仍然延续 R5 时的决策 (B/C/D 暂停, 转 Saga E AI 核心能力补齐). 本 review 不建议替 PM 改变这条决策.
4. **Round-4 Saga D (二级页浅色化)** — 仍紧迫. R6 web 端继续往浅色发展, 间接证明 dark vs light 撕裂问题不会自愈; 应在 Saga E 之外 找窗口尽快做.

---

## 1. 这是什么轮 (判断 + 证据)

### 1.1 三轮文件 SHA-256 对比

```bash
$ for f in mobile-today.jsx mobile-shared.jsx mobile-notifications.jsx mobile-screens.jsx app.jsx ios-frame.jsx app.v1.jsx; do
    r4=$(shasum -a 256 /tmp/claude-design-round4/aimeeting/project/$f | awk '{print $1}')
    r5=$(shasum -a 256 /tmp/claude-design-round5/aimeeting/project/$f | awk '{print $1}')
    r6=$(shasum -a 256 /tmp/claude-design-round6-mobile/aimeeting/project/$f | awk '{print $1}')
    [ "$r4" = "$r5" ] && [ "$r5" = "$r6" ] && echo "IDENTICAL all 3 rounds: $f"
  done
IDENTICAL all 3 rounds: mobile-today.jsx           (27546 bytes)
IDENTICAL all 3 rounds: mobile-shared.jsx          (30543 bytes)
IDENTICAL all 3 rounds: mobile-notifications.jsx   (12919 bytes)
IDENTICAL all 3 rounds: mobile-screens.jsx         (38213 bytes)
IDENTICAL all 3 rounds: app.jsx                    (32944 bytes)
IDENTICAL all 3 rounds: ios-frame.jsx              (15755 bytes)
IDENTICAL all 3 rounds: app.v1.jsx                 (25152 bytes)
```

唯一 diff: `Mobile App.html` 行 78 比 R4 多一个 `animationFillMode: 'forwards'` — R5 review 已经说明过, 是 round-4 chat 里的 fadeIn fix, 不是新设计.

### 1.2 R6 chat 增量内容定位 (chat2 line 1678~2295)

R5 chat2 = 1678 行, R6 chat2 = 2296 行. 增量 618 行全部在 Web 端:

| 行段 | 主题 | 端 |
|---|---|---|
| 1678–1717 | 用户建议用桑基图做全景血缘 (而不是力导向) | Web 全景血缘 |
| 1718–1796 | 桑基视图全景血缘上线 (ECharts) + 全屏无限画布 + 详情侧栏 | Web 全景血缘 |
| 1796–1888 | 全屏入口更醒目 + 鼠标缩放/拖拽 + 详情面板字号 + 类型化内容 (AI/记忆/KB/会议) + 中文化术语 | Web 全景血缘 |
| 1923–2030 | 首页下半部分重做 (HomeFeedTabs hero 卡 + Mira 对话发现卡科技感 + LIVE 会议卡 4 stat) | Web 首页 |
| 2080–2125 | 明亮模式专属配色 (跟 dark 完全分离的 token 体系) | Web 主题系统 |
| 2128–2220 | 会议历史路由重做 (`MeetingHistoryPane` + 列表 → 详情) | Web 路由 |
| 2222–2270 | **「全景血缘图」合并进「心智模型」, 改名「AI 心智一览」** | **Web 信息架构 — 与 mobile 概念有交集** |
| 2274–2295 | 明亮模式 token 文本加深 (#0a0a0e 等) | Web 主题系统 |

### 1.3 R6 chat 里的 "mobile / 移动" 提及

```bash
$ awk 'NR>=1678' chat2.md | grep -iE 'mobile|移动|手机'
- 不抢节点点击: 鼠标移动 ≤ 3px 时视为点击    # 鼠标动作, 不是 mobile 设计
- touchAction: 'none' 阻止移动端默认手势冲突   # web canvas 手势抑制
```

**0 个 mobile 设计 ask**. R6 是纯 Web 轮.

### 1.4 跟 README + project/README 对照

- `aimeeting/README.md` 内容跟 R4/R5 字面一致 (CODING AGENTS: READ THIS FIRST 模板), 没 mobile 特定说明.
- `aimeeting/project/README.md` — 待核对, 大概率也 byte-identical (本 review 没做这次 diff).

### 1.5 结论

> **R6 是 "Web Round-2" (R5 的延续), 不是 mobile 轮.**
> Mobile 端在 R3 (会议室 round-3) → R4 (整 app 浅色化全套设计) 之后**停滞**, 进入 PM 决策的"等 Web 同节奏 + 等 Saga E 给 mobile UI 充实数据"双等待期.

---

## 2. 跟 round-4 / round-5 mobile diff

### 2.1 文件层

| 项 | R4 → R5 | R5 → R6 | R4 → R6 |
|---|---|---|---|
| 8 个 mobile JSX | byte-identical | byte-identical | byte-identical |
| `Mobile App.html` | 1 行 (fadeIn fix) | byte-identical | 1 行 (fadeIn fix) |
| `app.jsx` (入口路由) | byte-identical | byte-identical | byte-identical |
| `app.v1.jsx` (v1 备份) | byte-identical | byte-identical | byte-identical |
| `ios-frame.jsx` (iPhone 壳 mock) | byte-identical | byte-identical | byte-identical |

### 2.2 chat 层 (R5 → R6 增量)

| 主题 | 提及 mobile? |
|---|---|
| 桑基视图全景血缘 | 否 |
| 全屏无限画布 + 详情侧栏 | 否 |
| 明亮模式 token 拆分 | **隐含** (mobile 已经是浅色, 但 R6 web 浅色独立成第二套 — 见 § 3.2) |
| 会议历史路由重做 | 否 (mobile 已经有 `/m/meetings` 单列表) |
| 「AI 心智一览」合并 | **隐含** (跟 mobile MemoryRadar 是同一产品 ask — 见 § 4.2) |

### 2.3 这次 review 跟 R5 review 的关系

**R5 review (`SAGA-web-redesign-round-5-changelist.md`) 已经说明: mobile R4 changelist 仍有效, B/C/D 不必重新 review.** R6 不改变这条结论 — **R4 changelist 仍然是 mobile 真相源, 本 R6 review 仅做"是否需要修订"的判断**, 不重做 § 2 (按页面差异清单).

---

## 3. 跟 Saga A 已实施的 diff

### 3.1 Saga A 已 ship 范围 (commit `da2307e`, merged main via `209fd01`)

```bash
$ git log --oneline --stat da2307e
da2307e feat(v1.3.0 P0): Saga A — 浅色基础 + /m today 重写 + 共享组件提层 (R3)
 frontend/src/app/m/page.tsx                        | 661 ++++++++++++++-------
 frontend/src/components/mobile/shared/Icon.tsx     | 498 ++++++++++++++++
 frontend/src/components/mobile/shared/MAGlowBanner.tsx  | 291 +++++++++
 frontend/src/components/mobile/shared/MASection.tsx     | 108 ++++
 frontend/src/components/mobile/shared/MAStatusPill.tsx  |  54 ++
 frontend/src/components/mobile/shared/avatars.tsx       | 338 +++++++++++
```

**ship 范围**:
- ✅ `MobileShell` 浅色化 (`bg-[#F2F2F7]`)
- ✅ `PageHeader` 34px 大标题 + subtitle 浅色化
- ✅ `BottomNav` 浅色化 (frosted white blur)
- ✅ `SegmentControl` iOS 系统 segmented 浅色
- ✅ `/m` (today) 整页重写 + 7 个 `_components/today/` 子组件
- ✅ `components/mobile/shared/` 提层 (Icon / MAGlowBanner / MASection / MAStatusPill / avatars)

### 3.2 仍 dark 范围 (Saga B/C/D 仍然适用)

```bash
$ grep -rl "bg-ink-950" frontend/src/app/m frontend/src/components/mobile | grep -v node_modules
frontend/src/app/m/privacy/page.tsx                # 二级 Saga D
frontend/src/app/m/tasks/[id]/page.tsx             # 二级 Saga D
frontend/src/app/m/agents/[id]/page.tsx            # 二级 Saga D
frontend/src/app/m/me/page.tsx                     # 主 tab Saga B
frontend/src/app/m/meetings/new/page.tsx           # 二级 Saga D
frontend/src/app/m/notifications/page.tsx          # 主 tab Saga B (整页 → bottom sheet)
frontend/src/app/m/me/voiceprint/page.tsx          # 二级 Saga D
frontend/src/app/m/meetings/[id]/summary/page.tsx  # ?? 已 P4 round-3 浅色, 这里 grep 命中可能是注释; 待确认
frontend/src/components/mobile/ConfirmDialog.tsx   # 跨主 tab 共用
frontend/src/components/mobile/RejectFeedbackSheet.tsx
frontend/src/components/mobile/BottomNav.tsx       # 命中应是注释, 实际已浅色 frosted
frontend/src/components/mobile/SummonAgentSheet.tsx
frontend/src/components/mobile/LeaveMeetingSheet.tsx
frontend/src/components/mobile/MeetingRecorderControl.tsx
```

**未浅色化的主 tab**:
- `/m/meetings` — 列表页 (Saga B 范围)
- `/m/tasks` — 列表页 (Saga B 范围)
- `/m/insights` — 记忆页 (Saga C 含 MemoryRadar)
- `/m/me` — 个人 tab (Saga B 范围)
- `/m/notifications` — 通知页, 应改 bottom sheet (Saga B 范围)

### 3.3 R6 是否改变 Saga A 已 ship 内容?

**否**. Saga A 实施物 1:1 跟 `mobile-today.jsx` (R6 byte-identical 跟 R4/R5), 仍然忠实.

### 3.4 Saga A 跟 R6 web 端 home 卡片的 "tone 一致性" 检查

R6 web home 用了 LIVE 会议卡 (绿渐变 + 4 stat) + Mira 对话发现卡 (紫渐变 + 双 chip) + 明亮模式专属 (浅紫描边 + 深石板灰文字). Mobile Saga A `/m` today 用的是:

- LIVE 会议卡: `LiveMeetingCard` 绿色 LIVE pill + 进度条
- Mira 早间简报: `MiraDailyBrief` 蓝紫渐变 + 2 chip

**视觉调性是一致的**. Web R6 的更新没让 mobile Saga A 显得过时 — 反而 PM 在 web 端做了 mobile 同款语言的 hardening (双色 hero 卡 + 数字优先信息层级 + 紫光晕). **Mobile Saga A 跟 Web R6 home 在视觉哲学层一致**.

---

## 4. round-4 Saga B/C/D 是否需要修订?

### 4.1 总体结论

**Saga B (次级 tab 浅色 + Glow Banner) 不修订**.

新设计稿没动 mobile, 也没透露 PM 对 B 的态度变化. R4 changelist § 2.2 (/m/meetings) / § 2.3 (/m/tasks) / § 2.5 (/m/me) / § 2.6 (Notifications sheet) 仍然 1:1 有效.

但 NORTH_STAR § 6.2 已明确 "B/C/D 暂停, 转 Saga E". 这条决策在 R5 / R6 都没翻案 — 所以 B 不仅"不修订", 还"不立即恢复".

### 4.2 Saga C (MemoryRadar) — **需要修订**

#### 4.2.1 R6 web 端的"AI 心智一览"概念入侵

R6 chat (line 2222-2270) 出现关键 PM 意图:

> "心智模型这个页面设计的不太好, 请重新, 我们希望把「全景血缘图」挪到一起, 融合进来形成真正的「AI 心智一览」"

> 「AI 心智一览」上线 ✓
> 合并方案:
> - 侧栏「心智模型」→ AI 心智一览, 移除独立的「全景血缘图」入口
> - 页面结构:
>   1. 顶部 — 抽象概念 hero (4 节点流向: AI → 书架 → 经验 → 会议)
>   2. 中段 — 紫色脉冲分隔标 "下方 · 你工作空间里的真实血缘"
>   3. 下方 — 直接嵌入完整桑基图(支持点击节点 / 全屏探索 / 技术说明)

#### 4.2.2 跟 R4 mobile MemoryRadar 的语义关系

R4 mobile `mobile-screens.jsx:339-584` 的 MemoryRadar:
- 6 维度雷达 (数据 / 产品 / 客户 / 法规 / UX / 财务)
- 双多边形 (你 vs 团队平均)
- peek-then-tuck (2.8s 自动收)
- 用在 `/m/insights` 顶部

R6 web "AI 心智一览":
- 4 列桑基 (AI 专家 → 书架 → 经验 → 会议)
- 全屏无限画布 (3600×2200) + 缩放 / 拖拽
- 节点详情侧栏 (460px, 按类型显示 KB chunks / 记忆全文 + 引用上下文 / AI intro + 标签 / 会议引用)

**核心产品意图相同** ("帮用户看清 AI 专家脑内究竟有什么"), **但呈现完全不同**:
- 雷达图 = 维度统计 (我懂多少)
- 桑基图 = 关系流向 (谁影响了谁)

#### 4.2.3 R6 chat (line 1049) PM 跨端意图

> "在长期记忆和知识库这块, 需要花点设计的精力. 因为每个专家最核心的就是这两点, 长期记忆是由我们不断的开会沉淀下来的精华, 而知识库就像 ai 专家的书架, 是由我们后台的维护人员不断地去输入内容. **并且每个 AI 专家穿透过去都能看到他的脑子里面的记忆和书架**, 并且用最直观的方式呈现出来."

这是 **跨端产品 ask** — 不是 "web 用这个 / mobile 用那个", 而是 "**让用户看清 AI 专家脑内**".

#### 4.2.4 修订建议

**Saga C 修订选项**:

| 选项 | 内容 | 工作量 | 推荐度 |
|---|---|---|---|
| **C.0 (原计划)** | mobile 独立做 MemoryRadar SVG 6 轴 | ~14h | 低 — 跟 web 失联 |
| **C.1 (轻修订)** | mobile MemoryRadar 设计**保留**, 但 PM 须明确 mobile 雷达是 "我个人维度" / web 桑基是 "组织关系图" — 两者不重复 | 同 ~14h | 中 — 体验仍二分 |
| **C.2 (合并修订, 推荐)** | mobile `/m/insights` 跟 web `心智一览` 共享数据契约 (`workspace/lineage/sankey` graph API), **mobile 用桑基简化版** (横屏全屏 + 节点列表 + 详情 sheet); 移除 radar 实施, 改成跟 web 端一致的"流向 + 详情" | ~16h (mobile) + 跟 web 共用 backend | **高** — 信息架构一致, 跨端切换不迷惑 |
| **C.3 (推迟)** | 等 Saga E (AI 圆桌真协同 + AI 详情页) 收尾后, 再立"AI 心智一览跨端 saga", 同时改 web + mobile | ~30h 联动 | 中 — 工程更稳, 但 mobile insights 仍长期 dark |

**主 Agent 建议 PM 拍板**: **C.2 或 C.3**. 不要 C.0/C.1 (= 跨端心智分裂).

### 4.3 Saga D (二级页浅色化) — **不修订但更紧迫**

R6 web 端继续往 "心智 + Sankey + 节点详情侧栏" 这类信息密集型方向走. Mobile 二级页 (`agents/[id]` `tasks/[id]` `meetings/new` `me/voiceprint` `privacy`) 仍 dark 会让 mobile 整体调性进一步分裂. 但 R4 changelist § 2.7 列的二级页清单仍然 1:1 适用, 不需要重新 review.

**主 Agent 建议 PM**: D 的范围不变, 但优先级在 Saga E 之后**最高**. 不要让 D 一直推后到"以后".

---

## 5. Saga F (小程序浅色化) / I (移动 leader IA) / G (小程序编辑边界) 是否需要修订?

> 这三个 Saga 来源: `docs/audit/three-platform-sync-audit-2026-05-25.md` § 4 (3 平台同步审计)

### 5.1 Saga F · 小程序原生浅色化

**现状**: 微信小程序 17 张 wxss 全 dark, 跟 NORTH_STAR § 7.1 ("不做 dark mode") 冲突.

**R6 影响**: R6 进一步 hardening web 浅色调 ("明亮模式专属配色" / "正文加深") — 间接强化"全平台朝浅色"的产品方向. 小程序 dark 落后两轮 (R4 mobile 浅色化 + R6 web 明亮模式 hardening).

**修订**: Saga F **范围不变** (17 wxss 浅色化), 但**优先级应提升**. R6 给 PM 的明确信号是 "浅色是终局产品语言, dark 是历史包袱". 跟 Saga E (AI 核心能力补齐) 并行做不冲突 — Saga F 是 wxss 风格层, Saga E 是 backend + AI 引擎层.

### 5.2 Saga I · 移动 leader IA (跨端切换)

**现状**: leader 用户在 mobile 看 `/m/me` 时, 没有 "切到 web 管理" 路径; 桌面 `/admin` vs `/me/profile` 二选一未定.

**R6 影响**: R6 web 强化了 "首页 = 工作 + 工作站", 并把 "心智模型" 提到工作站重要位置 (line 945 "首页(AI 专家市场 + 对话式发现) 和 工作站(精致心智模型 + AI 专家管理 + 知识库)"). **Leader 跨端切换的 "切到 web 管理" 终态目的地** = 工作站 / 心智一览.

**修订**: Saga I 范围**轻微扩**:
- 原: mobile `/m/me` + 小程序 `pages/me` 加 "切到 web 管理" 引导 (Bearer → cookie 桥)
- 修订: 引导**目的地**明确 → 跳 web `/workstation` (不是 `/admin`). 桌面 `/admin` 在 R6 后已被 "工作站" 框替代 (line 987-1020 工作站 IA: 心智模型 / AI 专家 / 知识库 / 长期记忆 / 数据看板 / 审批中心 / 全景血缘图).

工作量影响: +1h (修桥代码的 target URL).

### 5.3 Saga G · 小程序编辑边界澄清

**现状**: NORTH_STAR § 4.2 已落地 PM 决策 M1=B (工作流允许 / 配置禁止) + M2=A (切 workspace 必做). 落 commit `6181437`.

**R6 影响**: 0. R6 web 没出新 "编辑" 类型, 也没改 NORTH_STAR § 4.2 适用边界.

**修订**: 不修订. Saga G 已经在 v1.3.1 P0 落地 (commit `32966fe` 权限对齐). 关闭这条 Saga.

### 5.4 Saga 排队修订建议

| Saga | R5 时态度 | R6 时态度 | 修订 |
|---|---|---|---|
| Saga E (AI 核心能力补齐) | P0, 正在做 | P0, 正在做 | 不修订 |
| Saga A (mobile 主 tab 浅色) | ✅ ship | ✅ ship | 不修订 |
| round-4 Saga B (mobile 次级 tab) | ⏸ 暂停 | ⏸ 暂停 | 不修订 |
| round-4 Saga C (MemoryRadar) | ⏸ 暂停 | **⏸ 暂停 + 修订 (合并 web 心智一览)** | **C.2/C.3** |
| round-4 Saga D (二级页浅色) | ⏸ 暂停 | ⏸ 暂停 (优先级 ↑) | 不修订, 提优先级 |
| R5 Saga A (Web 设计系统 + 首页) | 进行中 | ✅ ship via `1413a41` (R5.A v1.4.0) | 不在 mobile 范围 |
| R6 Saga (Web 心智一览 + Sankey) | — | 新 review (`SAGA-web-round-6-changelist.md` 由另一 subagent 写) | mobile 仅交集见 § 4.2 |
| Saga F (小程序浅色化) | 立 saga 待启动 | 立 saga 待启动 (优先级 ↑) | 范围不变, 优先级提升 |
| Saga I (移动 leader IA) | 立 saga 待启动 | 立 saga 待启动 (目的地修订) | 引导目的地改为 `/workstation`, +1h |
| Saga G (小程序编辑边界) | ✅ ship via v1.3.1 P0 | ✅ ship | 关闭 |
| Saga H (跨端 push) | 立 saga 待启动 | 立 saga 待启动 | 不修订 |
| Saga J (API 文档化) | P2 | P2 | 不修订 |

---

## 6. 按页面列改动清单 — Mobile 端

> **0 项页面级 mobile 改动**. R6 没碰 mobile 设计.

### 6.1 主 tab

| 页面 | R4 设计 | R5 设计 | R6 设计 | 跟 Saga A 关系 |
|---|---|---|---|---|
| /m (today) | mobile-today.jsx 1:1 | byte-identical | byte-identical | ✅ ship 1:1 跟设计 |
| /m/meetings | mobile-screens.jsx:13-170 | byte-identical | byte-identical | ⏸ Saga B |
| /m/tasks | mobile-screens.jsx:172-322 | byte-identical | byte-identical | ⏸ Saga B |
| /m/insights | mobile-screens.jsx:324-806 | byte-identical | byte-identical | ⏸ **Saga C (修订建议)** |
| /m/me | mobile-screens.jsx:808-994 | byte-identical | byte-identical | ⏸ Saga B |
| /m/notifications | mobile-notifications.jsx (整 sheet) | byte-identical | byte-identical | ⏸ Saga B |

### 6.2 二级页

R4 changelist § 3 列了 5 个: `meetings/new` `tasks/[id]` `agents/[id]` `me/voiceprint` `privacy`. R6 没改这部分设计稿. 全 ⏸ Saga D.

### 6.3 会议室相关 (round-3 已 done)

R3 (commit `c77a09b` round-3 done) 已浅色化. R6 不动. 不在本 saga 范围.

---

## 7. 跨页共享组件影响 (是否要扩 shared/?)

### 7.1 现状 (Saga A 已 ship 的 shared/)

```
frontend/src/components/mobile/shared/
├── Icon.tsx          (498 行, 30+ icons)
├── MAGlowBanner.tsx  (291 行, 3 tone)
├── MASection.tsx     (108 行)
├── MAStatusPill.tsx  (54 行)
└── avatars.tsx       (338 行)
```

**消费方**: 只有 `/m/page.tsx` + `_components/today/{InsightCard, MeetingCardSmall}.tsx`. Saga B 次级 tab 还没接入.

### 7.2 R6 引入的新跨页共享需求

**0 个**. 因为 R6 没碰 mobile.

### 7.3 但 Saga C 修订引入的潜在新 shared

如果 PM 拍板 § 4.2 修订选项 C.2 (mobile 跟 web 心智一览共享桑基):
- 新增 `components/mobile/shared/Sankey.tsx` (或共用 `components/lineage/Sankey.tsx` 跨 mobile + web) — ~6h
- 新增 `components/mobile/shared/NodeDetailSheet.tsx` (按节点类型显示 KB chunks / 记忆 / AI intro) — ~4h
- 引入 ECharts 依赖 (web 已经在 R6 用了; mobile 增加体积 ~280KB) — 0h 代码, 决策点

否则 (C.0/C.1/C.3): shared/ 不动.

---

## 8. Scope 评估 + 工作量

### 8.1 本 R6 review 引出的 mobile 实际工作量

**0 个新 mobile 设计需要落地**. 工作量集中在:

| 项 | 备注 | 工作量 |
|---|---|---|
| R4 Saga B (次级 tab 浅色) | 维持 R4 changelist § 2.2-2.6 + § 4 | ~25h (原估) |
| R4 Saga D (二级页浅色) | 维持 R4 changelist § 3 | ~30h (原估), 优先级提升 |
| **R4 Saga C 修订** | C.2 (跟 web 心智一览合并) 或 C.3 (推迟) | ~16h (C.2) / 0h (C.3 推迟) |
| Saga F (小程序浅色化) | 维持 audit 文档 | ~25h (原估), 优先级提升 |
| Saga I (移动 leader IA) | R6 修订: 目的地改 `/workstation` | ~13h (原 12 + 1) |

**纯 mobile 新增工作量** (因 R6): **+1h** (Saga I 目的地修改).
**因 R6 触发的修订决策工作量** (Saga C 重做): 0 - 16h (跟 PM 拍板有关).

### 8.2 单人时间盘

如果 PM 决策"全部按修订做" (C.2 + 提 D 优先级 + Saga F 启动):
- ~16h (Saga C 修订) + ~30h (Saga D) + ~25h (Saga B) + ~25h (Saga F) = **~96h** mobile + 小程序 ~ 12-15 工日
- 加上 web R6 (另一 subagent review 中) — 跟 mobile 不冲突, 可并行

如果 PM 决策 "继续 Saga E 优先, mobile 全 backlog":
- 本 review 0h 立即工作量, 仅文档

---

## 9. 跟现有 Saga 队列协同建议

### 9.1 当前 main 状态

```
HEAD = 9ed940b (chore: 清除 macOS Finder copy 污染)
Saga R5.A (Web 设计系统 + 首页 + 工作站骨架) → ✅ ship via 1413a41 + 0eeb87f
Saga 权限对齐 → ✅ ship via 32944f0 + ca42f80
Saga A mobile 浅色 → ✅ ship via da2307e + 209fd01
```

**Saga E (AI 核心能力补齐) 尚未启动** — NORTH_STAR § 6.2 把 E 设为当前阶段最高优.

### 9.2 协同方案 (主 Agent 建议给 PM)

**方案 A (保守, NORTH_STAR 当前路径)**:
1. 继续 Saga E (~50-80h)
2. E 收尾后启动 Saga F 小程序浅色 (~25h)
3. Saga C 推迟到 web 心智一览 ship 后, 拉成跨端 Saga (C.3)
4. Saga D 排在 C 之前 (因为 D 不依赖 web ship)

**方案 B (进取)**:
1. Saga E 启动同时, **并行启动 Saga D** (二级页浅色化, 工作量 30h, 跟 Saga E 不冲突 — 一个改 backend / AI 引擎, 一个改 mobile 视觉)
2. Saga D 收尾后 立 Saga F (小程序浅色, 25h)
3. Saga C 仍推迟 (C.3)

**方案 C (跨端心智一览先做)**:
1. 暂停 Saga E 一周, 启 "Saga R6.A · 跨端 AI 心智一览" 同时改 mobile `/m/insights` + web `/workstation/心智一览` (~30-40h 联动)
2. 然后回 Saga E

**主 Agent 推荐: 方案 B**. 理由:
- Saga E 是后端 + AI 引擎主线, 单人做 mobile 视觉提供并行带宽
- Saga D 工作量已知且不依赖 PM 拍板
- Saga C 推迟 (C.3) 等 web 心智一览 ship 才能确定数据契约, 避免 mobile 单独做了被推翻

---

## 10. PM 待对齐的关键决策 (6 个)

按重要性排序:

### D1 · Saga C (MemoryRadar) 修订路径 — **必决**

PM 是否接受 § 4.2 的分析? 即 mobile `/m/insights` MemoryRadar 跟 web `/workstation/心智一览` 是同一产品意图的两种隐喻, 应统一?

- (a) **C.0**: mobile 独立做 6 轴雷达, 跟 web 不联动 — 不推荐
- (b) **C.1**: 两端各做但 PM 明确定位差异 — 中
- (c) **C.2**: mobile 也改成桑基简化版, 共享数据契约 — **推荐**
- (d) **C.3**: 推迟 mobile Saga C, 等 web 心智一览 ship 后立跨端 Saga — **推荐**

### D2 · Saga 排队方案 — **必决**

NORTH_STAR § 6.2 仍生效 (Saga E 优先, B/C/D 暂停). R6 不改这条, 但 D 优先级是否在 E 之后立即提? 主 Agent 推荐方案 B (E + D 并行).

### D3 · Saga F (小程序浅色化) 优先级提升 — **必决**

R6 进一步证明 dark vs light 撕裂会持续. F 是否在 Saga E 之后立即启? 还是再延后?

### D4 · 双套浅色 token 体系 (Web 明亮 vs Mobile/会议室 iOS) — **必决**

R6 chat (line 2102-2125) 明确 web 明亮模式跟 dark 完全分离 token. Mobile/会议室 走 iOS systemGray. 需要在 `docs/DESIGN_SYSTEM.md` 立两个浅色子系统? 或仍维持单一浅色 token?

- (a) 立 § 0.1 (iOS 浅色 — mobile/会议室) + § 0.2 (Web 明亮 — web 主端)
- (b) 合并成 1 套通用浅色 (难度大, 会有视觉不一致)

主 Agent 推荐 (a).

### D5 · Saga I (移动 leader IA) 跳转目的地 — **必决 (R6 触发)**

R6 把 "工作站" 框做出来后, leader 从 mobile 跳 web 的目的地应是 `/workstation` 而不是 `/admin`? PM 确认即可.

### D6 · 是否立 "R6 mobile no-op" 文档说明? — **可选**

NORTH_STAR § 6.2 已经说明 mobile B/C/D 暂停. R6 没新设计, 但本 review 文档存在本身是 audit trail. PM 是否需要在 NORTH_STAR § 6 加一句 "R6 mobile = no-op (设计稿未动)"?

---

## 11. [BACKEND-NEEDED] + [STYLE-DEVIATION]

### 11.1 [BACKEND-NEEDED]

**0 个新 mobile backend 需求** (R6 没改 mobile).

**但 § 4.2 修订 C.2 触发 1 个跨端 backend 需求** (跟 web 心智一览共用):

#### `GET /api/workspace/lineage`

数据契约 (跟 R6 web chat line 1714 PM 给的 TypeScript 类型签名一致):

```ts
{
  nodes: Array<{
    id: string,
    label: string,
    type: 'agent' | 'kb' | 'memory' | 'meeting',
    meta?: {
      // type=agent: { name, role, persona, citations_count, calls_count }
      // type=kb:    { pages, chunks, citations, updated_at }
      // type=memory: { content, citations, source_meeting_id, ai_owner, importance_level }
      // type=meeting: { title, started_at, decisions_count, insights_count }
    }
  }>,
  links: Array<{
    source: string,  // node id
    target: string,  // node id
    value: number,   // 流量 (引用次数 / 流向强度)
    kind?: 'cite' | 'create' | 'derive'
  }>
}
```

工作量: ~6h backend (跟 web 共用)
**前置**: 跟 web R6 review 协同 (PM 让 web subagent 先 review)

### 11.2 [STYLE-DEVIATION]

#### S1 · 浅色 token 双系统未立约

R6 web 明亮模式 token (`#ffffff → #faf7ff` 卡片背景 / `#0a0a0e` 正文加深) 跟 mobile Saga A 用的 `#F2F2F7 + #1C1C1E` 是**两套不同的浅色**. 当前 `DESIGN_SYSTEM.md` 没立约这是双系统. 风险: 后续 review subagent 在 mobile 改动里借用 web 明亮 token, 反之亦然.

**修复**: D4 决策后, 在 `DESIGN_SYSTEM.md` 立 § 0.1 (iOS 浅色) + § 0.2 (Web 明亮) 章节. 不是本 saga 的 coding 范围, 是文档.

#### S2 · mobile `/m/insights` 长期 dark + R6 web 心智一览浅色 → 跨端调性裂痕

Mobile 用户在 dark `/m/insights` (Saga C 暂停) 跳到 web 浅色 `/workstation/心智一览` (R6 ship) 会有强烈视觉跳跃. 短期不修, 但**在 R4 Saga C 修订 (本 review § 4.2.4) 决策前不要继续往 mobile dark insights 加新功能**.

#### S3 · Mobile R4 设计稿 vs Web R6 设计稿 token 不一致警告

R4 mobile 用了 iOS 标准 system token (`#F2F2F7` systemGroupedBackground / `#E5E5EA` systemGray4 / `#007AFF` link blue). R6 web 明亮 = 紫色科技色 (`#7C5CFA + #faf7ff`). **不是同一调色板**.

如果 PM 后续要"全平台风格统一", 必须改设计稿 (要求 Claude Design 出 R7 mobile 重做). 当前不建议 mobile 跟 web 强行对齐.

---

## 12. 主 Agent 怎么呈现给 PM (跟 Web review 一起综合)

### 12.1 跟 Web R6 review 的关系

- Web R6 review 文档: `SAGA-web-round-6-changelist.md` (另一 subagent 同步写)
- Mobile R6 review 文档 (本): `SAGA-mobile-round-6-changelist.md`
- **两个文档应一起呈现给 PM**, 因为 R6 主体是 web 端, mobile 仅 4 个跨端波及决策

### 12.2 建议 PM 阅读顺序

1. **先看 Web R6 review** § 0 TL;DR → 理解 R6 web 端做了什么
2. **再看本 Mobile R6 review** § 0 TL;DR → 理解 mobile 端 "无设计变更" 这条事实
3. **聚焦本 review 的 § 4.2 (Saga C 修订)** + § 10 (6 个决策) → 这是 mobile 端唯一需要 PM 拍板的点

### 12.3 给 PM 的 1 句话总结

> R6 是纯 Web 轮, mobile 设计 byte-identical 跟 R4/R5 不变. 但 R6 web 把 "全景血缘 + 心智模型" 合并成 "AI 心智一览", 跟 mobile 原 Saga C MemoryRadar 是同一产品意图的不同呈现 — 需 PM 拍板 mobile 是合并 (C.2) / 推迟 (C.3) / 还是保留独立雷达 (C.0/C.1).

---

> 本文档**仅 review**, **未触动任何代码** / **未 commit** / **未 deploy**.
> 所有 design 文件保留在 `/tmp/claude-design-round6-mobile/aimeeting/project/` 供后续 subagent 1:1 移植参考.
> Mobile design 跟 R4/R5 byte-identical, 落地仍以 `SAGA-mobile-app-round-4-changelist.md` 为 truth source.
