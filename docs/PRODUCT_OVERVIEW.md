# aimeeting · 产品全貌 (对齐版)

> **生成时间**: 2026-05-26
> **用途**: PM 完成 round-4 UI 之前 / 进入"回归功能性"阶段 之前 的 顶层对齐
> **范围**: 整个 codebase + 全部 commit + 已有 spec 文档 + Kimi 测试用例 — 一份给 PM 看的合订本, 不堆 commit 细节
> **方法**: 读了 336 个 commit, 60+ 个 docs, 39 个 Kimi 用例, 65 个 frontend page, 24 个 backend router; 抽样深读关键文件
> **本文档不动代码** — 是一面镜子, 让 PM 重新照一下产品

---

## 0. 一页 TL;DR (PM 5 分钟版)

1. **产品定位**: aimeeting 是 **面向中国政企的 AI Agent 协作会议工作台**. 让一场会议从"开了几小时不知道怎么落地"变成"开完就能拍板", 并且这场会议产出的知识不消失, 反过来喂给下一场会的 AI.
2. **当前状态**: **桌面 admin 主链路 + 移动 H5 用户旅程 + 微信小程序原生入口** 三端都已上线 + GA. 后端 24 个 router, ~200+ endpoint. 数据模型 ~30 张表. design system v1 已反向抽取.
3. **PM 的痛点 (你原话)**: "原计划很多功能没实现预期". 这个判断**是对的** — 我识别出 **3 大类未实现** (后端缺数据/API · 业务逻辑半成品 · UX 不完整), 其中 **AI 圆桌真协同 / 真人 attendee API / 二级页浅色化 / 跨端同步 / 真实 PDF 预览** 是最高优先级.
4. **已实现 vs 未实现**: 大约 **70% 的产品需求 v1 已落地, 30% 是 mock/占位**. mock 集中在: AI 圆桌 (TD2 永久 1 张) · 章节/筛选 sheet 数据 · 多专家协作视图 · MemoryRadar 雷达图 (round-4 设计) · today_decisions 字段.
5. **下一步建议**:
   - **PM 决策点 1**: round-4 (UI 浅色化扩张 ~110h) 还做不做? — 我建议**先做完 P0 浅色化** (Saga A, ~40h, 已 in-progress) **就停**, **不要把 P1/P2/P3 全做**, 把功夫转到功能补齐.
   - **PM 决策点 2**: 立一份 NORTH_STAR 文件 (从 `product-needs-v1.md` 升级) — 把 "AI Agent + 会议系统" 跟 "智慧住建 政府工单平台" 两条产品线**重新切清楚**. 现在两条线在一个 codebase 里搅在一起.

---

## 1. 产品故事 (顶层)

### 1.1 一句话定位

> **aimeeting 是面向 团队 / 政府 / 企业 的 AI Agent 协作会议工作台. 让会议从"被动记录"升级为"组织决策智能系统" — 多 AI 专家参会、会议结论沉淀回 AI 知识库、下次类似话题时 AI 自动调用.**

证据:
- `README.md:2` — "把会议从'被动记录'升级为'组织决策智能系统'. 多 AI 专家参会、记得住、能延续"
- `docs/product-needs-v1.md:7-17` — 一句话 + 4 个核心价值主题 (决策加速 / 知识沉淀 / 跨部门协作 / AI 增能)
- `docs/v26.3-spec.md:11-43` — v26.3 召集人模式的产品定位描述

### 1.2 详细版

**给谁用** (从 CLAUDE.md 测试账号 + demo_seed 反推):
- **政府机关** (主场景): 福田住建局 demo (`bluesurfiregpt@gmail.com` workspace, 5 部门 19 用户 16 AI 专家)
- **企业团队** (横向场景): 一般 SaaS 团队, 跑跨部门 / 跨科室协作会
- **乙方运营自己** (v26.4 后): 平台超管, 跨 workspace 给客户代建 / 切换 / 看 audit

**解决什么痛点** (反推产品需求 v1 的 4 个主题):
1. **决策加速** — 真人开完会不知道怎么落地, 等秘书写纪要慢. → AI 全程转录 + 30-60s 出纪要 + 抽待办 + 派人
2. **知识沉淀** — 一年 200 场会, 内容散落, 找不回, 一年后"这事讨论过但忘了在哪". → 三层记忆金字塔 (快照 / 待审 / 记忆库), AI 帮筛, 用户拍板
3. **跨部门协作** — 跨科室会议 调四方真人 时间窗口长 1-2 周, 缺位部门事后再补意见. → 每个科室配 AI 专家 (KB + 经验), 不需要真人到场也能听到科室视角; 跨 AI 数据访问申请审批
4. **AI 增能** — AI 不只是被动问答, 主动给能力. → AI 拆议程 / 全 AI 自主开会 / AI 召唤 / AI 模板生成器 / OCR / 声纹

**核心价值主张**: **"开完会就能拍板, 不依赖记忆, 不等秘书. AI 替你做了'听 + 记 + 整理 + 提炼', 你只做拍板."** (product-needs-v1.md:37)

**跟同类产品的差异** (我的反推):
- 跟 **腾讯会议 / 飞书妙记**: 它们做"录音 + 转录 + 纪要" — aimeeting **还做 多 AI 专家发言 + 知识库沉淀 + 任务派发 + 召集人模式**, 是"决策助手"而不是"记录工具"
- 跟 **ChatGPT / Claude**: 它们是 1v1 私聊 — aimeeting 是 **N 个 AI 在一场会议里相互讨论 + 综合输出**, 是"多 Agent 协作"
- 跟 **政务系统**: aimeeting 把"组织决策" + "知识沉淀" + "ABAC + 5 级数据分级" 收在一起, 是 **从工具走向决策助手的政企版**

---

## 2. 用户角色 + 旅程 (5 个角色)

> 测试账号见 `CLAUDE.md` "测试账号"表. 这 5 个角色不是抽象 — 福田住建局 demo workspace 里都是真人 + 真数据.
> 角色矩阵权威定义见 `docs/v26.5-role-redesign-spec.md` (5 角色: owner / admin / leader / manager / member; manager 在 codebase 里现在仍叫 `expert`)

### 2.1 召集人 / owner (bluesurfiregpt@gmail.com)

**角色定位**: 工作空间拥有者 + 召集会议的人 (乙方代建场景下也是平台超管的影子)

**典型旅程**:
1. 注册 → 创建/进入 workspace
2. /admin/team 邀请成员 (leader / admin / expert / member)
3. /admin/agents 配 N 个 AI 专家 (或用 agent_template 一键生成 5 个)
4. /admin/knowledge 给 AI 上传 KB 文档 (PDF / Word / Excel / PPT / 图片)
5. /m/meetings/new 创会议 (写 brief + 上传资料 + AI 拆议程 + 选模式 hybrid/auto/human)
6. /m/meetings/[id] 开会 (实时转录 + 召唤 AI + AI 提示偏题 / 时间)
7. 会议结束 → /m/meetings/[id]/summary (AI 纪要 + 抽出的待办 + 议程时间线)
8. 召集人模式下 (mode=auto): /meeting/[id]/orchestrate 看 AI 自主开会 + 会后批量裁决分歧
9. 待办 → /m/tasks (分派 / 接受 / 完成 / 评分)
10. /m/insights 审批"待审"记忆 → 入库
11. (v26.4 后) /super 跨 workspace 切换

**核心痛点 / 收益**: "我想出题, AI 替我讨论; 我只做拍板". 全 AI 自主开会 (auto mode) 就是给这个角色的杀手锏.

**当前实现状态**: **完整闭环**. 所有 11 步都有 endpoint + UI. 召集人模式 v26.3 GA, /super 平台超管 v26.4 GA.

---

### 2.2 Leader / 局长 (demo.lijg@futian.gov.cn)

**角色定位**: 一把手 / 局长 / 副局长. 权限 = admin 别名 (`docs/v26.5-role-redesign-spec.md` 角色矩阵).

**典型旅程**:
1. 收到 owner 邀请 → 注册/加入 workspace
2. 看 /m (今日工作台) → "今天还有 N 场会 + N 个待办"
3. /m/meetings 进 ongoing 会议 → 真人 + AI 混合发言 (hybrid mode)
4. 会议中召唤 AI 专家 (城管 AI / 物业 AI / 房屋安全 AI) 协同
5. 会后 /m/tasks 给下属派单 (leader_directive 自然语言 → AI 拆 task)
6. /me/profile 看自己负责的 AI 专家 + 看 audit log
7. /dashboard (桌面 admin) 看跨部门 Kanban + 月度评价 + 报表

**核心痛点 / 收益**: "我跨部门协调成本高, 等真人凑齐时间窗 1-2 周. AI 专家代表科室出席, 议事效率从'周'提速到'小时'".

**当前实现状态**: **完整**. 但桌面 admin 跟 H5 mobile 是**两套 UI**, leader 在桌面跑深度操作 (/dashboard / /admin), 在 H5 跑日常追踪 (/m/meetings). 跨端切换体验 一致性一般.

---

### 2.3 Admin / 物业科长 (demo.chensy@futian.gov.cn)

**角色定位**: 管理员 / 科长 / 部门头. v26.5 后, **manager 也算这一类**, 但权限收窄到 "我管的几个 AI 范围内".

**典型旅程**:
1. /admin/agents 维护自己科室的 AI 专家 (改 persona / 接 KB)
2. /admin/knowledge 上传科室专属 KB
3. /admin/cron-rules 定周期巡检任务
4. /admin/access-requests 审批"跨 AI 数据访问申请" (别科室想看我的 KB)
5. /admin/memory 审批待审记忆 (memory_draft) — 是否入库
6. /admin/document-audit 公文智能审核 (v24.2 #3)
7. 平时跟 leader 一样参加会议

**核心痛点 / 收益**: "我管几个 AI, 但 AI 学的不一定对. 我要能控制 AI 写什么进知识库". → 任务办结自动沉淀 → 待审 → 我审 → 入 KB.

**当前实现状态**: **完整**. ABAC 已在 v26.5 收紧 — manager 只能改 自己 primary 的 AI 范围内的 KB / Memory. 待审审批流 (memory_draft / kb_sedimentation_draft) v26.5-Lineage 已上线.

---

### 2.4 Expert / 物业 expert · 实际操作员 (demo.fengl@futian.gov.cn, bound AI-08)

**角色定位**: 科员 / 专员 / AI 专家的"科室账号" (Agent.primary_user_id). v26.5 重命名为 manager (但代码字段还叫 expert), v26.0 派发模型从 user-centric 切到 agent-centric, **这个角色实际上是 AI 的"手脚"**.

**典型旅程**:
1. 加入 workspace, 绑定到一个 AI 专家 (`WorkspaceMembership.bound_agent_id`, 老字段; v26.5 后 Agent.primary_user_id 反过来指)
2. 收到任务通知 (AI 把任务派给我对应的 AI, 我作为 "实际操作员")
3. 完成任务 / 上传资料 / 关任务
4. 任务办结自动触发 task_consolidator → 4 段闭环档案 → 等 admin 审批 (kb_sedimentation_draft) → 写入我 AI 的 KB
5. 偶尔参加会议 (作为 AI 的人形代表)

**核心痛点 / 收益**: "AI 不只是聊天机器人, AI 真在'学' — 我办的每一个任务最后都进了它的 KB, 下次类似任务 AI 调出来 '上次怎么处理的'".

**当前实现状态**: **完整链路**. 但 **expert / manager 角色的 UX 还偏'传统员工 view'** — 没专门为这个角色做"我跟我的 AI 的协作"页面. /me/profile/agents/[id] 是看 AI 详情, 但跟"我作为 AI 的代理"这种心智模型对不齐. **属于 4.3 类 (UX 不完整)**.

---

### 2.5 Member / 物业普通员工 (demo.hanx@futian.gov.cn)

**角色定位**: 普通成员. 权限最小 — 看会议 / 邀请 AI / 接任务. 不管 AI / 不管 KB / 不任免.

**典型旅程**:
1. 加入 workspace
2. /m 看今日工作台
3. /m/meetings 看会议列表 → 进会议听
4. /m/tasks 看自己被派的任务 → 做 → 提交
5. /m/insights 看 AI 智囊 (只读)
6. /m/me 看自己

**核心痛点 / 收益**: "AI 已经把会议产出整理好了, 我直接拿待办去做, 不用从会议录音里翻找".

**当前实现状态**: **完整**. member 在 5 个角色里 UX 最干净.

---

## 3. 已实现功能清单 (按模块)

> **完整度评分** (我的判断, 不是官方):
> - 完整 ✅ = 闭环可用 + 有 Kimi 用例 + 客户能 demo
> - 半成 ⚠️ = 主链路通, 但有 mock 或缺一些字段/UI
> - 半成 🟡 = 数据模型有了, UX 不完整或没接前端

### 模块 A · 用户与权限 (注册 / 登录 / 角色 / ABAC)
**实现概况** ✅ — 完整闭环, 5 角色矩阵 + 数据 5 级分级 + 跨 AI 审批
- 邮箱密码登录 (sprint-f), 手机号一键登录 + 微信 OAuth (v27.1/v27.2)
- 5 角色 (owner/admin/leader/manager/member) + ABAC (v21+v26.5-P0)
- 数据 5 级分级 (core/important/sensitive/general/public) + 跨 AI 访问申请 (v21)
- 平台超管 跨 workspace 切换 (v26.4)
- audit_log 全覆盖 (v24.0) + Sentry 监控 (v24.4)
- 关键 commit: `4dc6b99 v26.5 角色重设计`, `490dedc v26.4 Platform Admin`, `d5ffe5c v21 政务安全基线`
- 关键路径: `backend/app/access_control.py`, `backend/app/routers/auth.py`, `backend/app/auth.py`

### 模块 B · Workspace (多租户)
**实现概况** ✅ — 完整
- workspace_membership N:M (sprint-f.1) + 邀请链接 (v26.4 一次性 7 天)
- workspace 隔离: 所有业务表 workspace_id + middleware 拦截
- workspace.status (active/suspended/archived) (v26.4) — **但 suspend/archive endpoint 暂未做** (v26.5 候选 C2)
- workspace.preset = "smart_construction" 走智慧住建专属链路 (v17+)
- 关键 commit: `907029f sprint-f.1 邀请`, `490dedc v26.4 平台超管`

### 模块 C · 会议管理 (列表 / 创建 / 详情)
**实现概况** ✅ — 完整闭环
- 创建会议 (mode=human/hybrid/auto) + 议程 + brief + 资料上传 (v27.0-P19 + P19-B + P21)
- AI 拆议程 (v27.0-P19) — 用户写 brief, LLM 给 2-6 议程项
- 议程进度 tracking + 推进 (v26.14-P5)
- 会议导出 (Markdown + Word .docx, v25-3+4+5)
- 资料抽取 (PDF / Word / Excel / PPT / OCR via Qwen-VL) — v25-2 + P19-B
- 关键 commit: `2686b86 v27.0-P19 brief + AI 拆议程`, `bc4b871 v27.0-P19-B 资料上传`, `e936d22 v26.14-P5 议程进度`

### 模块 D · 会议室 (实时录音 / 转录 / AI / Mira)
**实现概况** ⚠️ — 主链路完整, 但 AI 圆桌 mock + 浅色化 round-3 完成
- 实时 ASR (DashScope paraformer-v2 + LLM 修正层) — v25.8
- 声纹识别 (pyannoteAI, 工作区共享) — phase-a + v27.0-P22
- 移动端录音 (H5 + 小程序原生 P21) — v27.0-P12
- AI 自动 routing (5 维: semantic + KB + history + load + availability) — v26.1
- AI 议程监督 (agenda_monitor, 偏题 / 时间 / 僵局 banner) — m3.0 + v26.14-P4
- 召集人模式 (auto) 全 AI 自主开会 + 45 分钟硬上限 + 会后批量裁决分歧 — v26.3
- 反幻觉纪要 (qwen-max temperature=0) — v25.7
- 移动端会议室 round-3 浅色化 — v1.2.0 (just done)
- **mock**:
  - AI 圆桌 RoundMessage 永久 1 张固定 (`mock/roundtable.ts`, TD2 PM 决策)
  - 真人筛选段为空 (无 attendee API)
  - 章节 / highlights sheet 数据是 mock (无 backend chapter API)
  - 字幕 / 摄像头 / 举手 / 字幕设置 仅 UI toggle 无硬件接入
- 关键 commit: `0a4ee62 v1.2.0 P1 meeting-room-v2`, `e369159 v27.0-P13 IM 流`, `2cf4c1e v1.2.0 P2 dock`

### 模块 E · AI 专家 / Agent
**实现概况** ✅ — 完整
- Agent 数据模型 + persona/tone/boundary/KB 绑定 (sprint-b)
- "数字员工"形象 (头像 / 全身 / 动图) — v26.9
- 短名 nickname / 调用计数 invoke_count / 个人渐变色 — v26.12
- AI 模板生成器 (一句话 → 5 AI 配置 + 种子 KB) — v26.6
- moderator AI 内置 (每个 workspace 一个, 不可删) — m3.0
- AI 私聊 (1v1 调试模式) — v26.13.1
- AI 详情页 (移动 /m/agents/[id] + 桌面 /me/profile/agents/[id]) — v27.0-P3
- 关键 commit: `af85d0f v26.9 数字员工`, `4b52b06 v26.12 hero CTA`, `a159d67 v26.6 模板生成`

### 模块 F · 任务管理 (Task 一级对象)
**实现概况** ✅ — 完整, 是 v17-v25 的核心成果
- Task 一级对象 (v17, 智慧住建翻译层)
- 8 态状态机 (open/dispatched/accepted/in_progress/submitted/done/archived/cancelled + 通用 cancelled) — v18+v19
- 5+ 种触发源 (meeting / leader_directive / upper_doc / cron / alert / report / manual) — v17-v21
- 4 维自动派发 (关键词+历史+负载+能力) → v26.0 升级为 agent-centric
- 多 AI 协作 (主责 + 协办 + 双向评分) — v22.5
- 任务办结 → AI KB 自动沉淀 (4 段闭环档案 + embedding) — v26.2
- 24h 签收超时催办 + 三级催办 (yellow/red/purple) — v18+v24.1
- 月度任务评价 (4 维: completion / on-time / quality / collaboration) — v22+v23
- 任务详情页 / 评论 / 实录依据 (evidence_anchor_line_ids 跳回原文) — v25.15-v25.21
- 关键 commit: `14f3fed v17 Task 立项`, `8aee8c7 v22.5 多 AI 协作`, `c0fc9af v26.0 agent-centric`

### 模块 G · 智囊团 / Memory (知识沉淀)
**实现概况** ✅ — 完整, 是 v26.5-Lineage 的核心
- 长期记忆 LongTermMemory + pgvector embedding (1536d) — sprint-e
- 三层金字塔 (快照 ai_insight → 待审 memory_draft → 记忆库 long_term_memory) — v27.0-P21
- Memory ↔ Agent 多对多 (memory_agent_link, primary + subscribers) — v26.5-Lineage
- 出处链回 (source_line_ids → 跳回原文) — v26.14-P7.3
- 拒绝二选一 (discard / feedback 退回 LLM) — v26.14-P7.4
- KB 任务沉淀审批草稿 (kb_sedimentation_draft) — v26.5-02c
- AI 数据中心 + 桑基血缘图 — v26.5-Lineage-P2
- 关键 commit: `4e9d383 v26.5-Lineage-P1`, `82a6e25 v26.5-Lineage-P2 血缘图`, `60dbb30 P21 金字塔`

### 模块 H · 通知 (Notification)
**实现概况** ✅ — 完整, 但移动端通知页风格还是 dark (round-4 设计要改成 sheet)
- 4 个 severity 级别 (normal/yellow/red/purple) — v18
- 多种 kind (action_assigned/due_soon/overdue/comment/dispatched/co_submitted/access_approved...) — 横跨 v17-v26
- Cron 去重 (24h 内同 user+action+kind 不重发)
- 移动端 /m/notifications 页 + 顶栏铃铛 — v27.0-P10
- 关键 commit: `2e1bb48 theme-1 P0`, `0716531 v24.1#2a 问题上报`

### 模块 I · 移动端 (H5 + 微信小程序)
**实现概况** ⚠️ — H5 完整闭环, 但浅色化只做了会议室 (round-3); 4 主 tab 还是 dark
- H5 大改造 v27.0-mobile (P0-P23) — 5 主 tab + 二级详情 + WebSocket 实时
- 移动端工卡墙 (专家视角) — v27.0-P2-next
- 智囊三 tab (AI 产出 / 待我审 / 已入库) — v27.0-P4.4
- 任务闭环视图 — v27.0-P1.4
- 紧急修假死 + tab 失灵 + iOS WKWebView 弹性滚动 锁 viewport — v27.0-P23, P20.3
- 微信小程序: 4 tab 全转原生 (login / webview / picker / about + 主 tab) — v1.1.0
- 微信 OAuth 一键登录 + 手机号一键登录 — v27.1 + v27.2
- 微信聊天记录文件直传 (wx.chooseMessageFile) — v27.0-P21 N-3 第 3 刀
- 会议室 round-3 浅色化 — v1.2.0 just done
- **未实现** (round-4 设计已稿, 未实施):
  - 4 主 tab 浅色化 (P0 in-progress, feature/mobile-app-r4-A 分支)
  - MAGlowBanner (跨 tab brand)
  - MemoryRadar SVG 雷达图
  - NotificationsSheet (bottom sheet 替代独立路由)
- 关键 commit: `b74a09d v27.0-P0`, `c441963 v1.1.0 小程序全转原生`, `c77a09b v1.2.0 meeting-room-v2`

### 模块 J · 桌面 admin / dashboard / 智慧住建翻译层
**实现概况** ✅ — 完整, 是 v17-v25 早期主战场
- /admin 工作站 (信息架构 v26.5-WS)
- /me/profile (个人中心 v26.5)
- 看板 Dashboard (AI / 科长两个视角, Kanban) — v23
- Excel 报表导出 — v23
- 月度评价 / 趋势预警 / 公文智能审核 / 自然语言图表生成 — v22-v24.2
- 智慧住建 16 AI 专家一键 seed + 1:1 KB — v24.1
- 桑基血缘图 / AI 数据中心 — v26.5-Lineage-P2
- /super 平台超管 — v26.4
- 关键 commit: `66efe80 v23 看板`, `5be5e34 v26.5-WS 工作站`, `490dedc v26.4 super`

### 模块 K · 第三方集成
- DashScope (LLM qwen-max + STT paraformer-v2 + embedding text-embedding-v2)
- pyannoteAI (声纹)
- 阿里云 OSS (录音 + KB 文档存储)
- Dify (n8n 工作流, 现在 hidden — "Dify invisible" rule 见 `be0d9dd`)
- Perplexity (自生成知识抓取, v26.13.2 月配额制)
- 微信 OAuth + 微信 SDK

---

## 4. 未实现 / 半成品功能清单 (PM 最关心 — 放最显眼)

> **方法**: 我从 commit message / Kimi 用例的"已知不在本次范围" / round-4 changelist / `v27.0-mobile-phase3-todo.md` / `[BACKEND-NEEDED]` 标签 / 代码里 MOCK_/TODO 注释 反推.

### 4.1 后端缺字段 / API

| # | 缺什么 | 影响哪里 | 紧急度 | 出处 |
|---|---|---|---|---|
| 1 | **真人 attendee API** (`GET /api/meetings/{id}/attendees` 包含 users + voiceprint 色) | 会议室筛选 sheet 真人段 / round-4 设计的头像 stack | 🔥 高 | `v1.2.0-meeting-room-v2-kimi.md:第 6 节` |
| 2 | **today_decisions** workbench 字段 | round-4 设计 /m today 的 "今天的决策" section | 中 | `SAGA-mobile-app-round-4-changelist.md:R8` |
| 3 | **memory-stats** 接口 (`GET /api/me/memory-stats`) — 6 维度 you/team 统计 | round-4 MemoryRadar SVG 雷达图 | 中 (round-4 P2) | `SAGA-mobile-app-round-4-changelist.md:第 6 节` |
| 4 | **chapter/highlights 提取 API** (会议自动节点) | 会议室章节 sheet | 中 | `v1.2.0-meeting-room-v2-kimi.md:TD8` |
| 5 | **multi-expert 协作视图 数据** (一条议题多 AI 观点对照) | 智囊 tab 多 AI 协同视图 | 中 | `v27.0-mobile-phase3-todo.md:2` |
| 6 | **notification.glow** boolean 字段 (灵感时刻标识) | round-4 NotificationsSheet 紫渐变 action 按钮 | 低 (前端可 hardcode) | `SAGA-mobile-app-round-4-changelist.md:第 6 节` |
| 7 | **agent_template** 跨 workspace 模板表 | v26.5 候选 C1 — 乙方运营痛点, 一处改 N 处生效 | 中 (运营痛点) | `docs/v26.5-spec.md:C1` |
| 8 | **workspace_quota / usage** 计费 + 用量 dashboard | v26.5 候选 C3 | 中 (运营) | `docs/v26.5-spec.md:C3` |

### 4.2 业务逻辑半成品 (前端 mock / 占位)

| # | 半成品 | 当前状态 | 应该是 | 紧急度 |
|---|---|---|---|---|
| 1 | **AI 圆桌 (RoundMessage)** | 永久 1 张固定 mock (`mock/roundtable.ts`, TD2 PM 决策) | 多 AI 真正轮流发言 + Mira 综合 — 这是 PM 在 design 里强调的核心场景 | 🔥 高 (是 PM 的旗舰功能) |
| 2 | **真实 PDF / PPT / Excel 预览** | `materials/FilePreview.tsx` 是 mock 渲染 (hardcoded 内容模仿真 PDF/PPT/Excel/Word 页面) | 真正接 backend 抽出的 extract_summary / extract_text 渲染 | 🔥 高 |
| 3 | **章节自动提取** | 章节 / highlights sheet 用 mock timeline (前端写死 5 类节点) | 后端 LLM 跑会议结束时自动提取重要时刻 + chapter | 中 |
| 4 | **WebSocket 实时推送** | v26.3 用 2.5s 轮询 (orchestrate 控制台) | WS 推送 phase 变化 | 中 |
| 5 | **KB 引用侧栏** | citations 数据已落库, UI 没做 | 会议室点 AI 发言 → 弹出引用的 KB chunk + 跳详情 | 中 |
| 6 | **跳过议程按钮** | spec 提了 (v26.3), 没做 | orchestrate 控制台允许召集人跳过当前议程项 | 低 |
| 7 | **已裁决议程改判** | 当前返 409 (`UNIQUE meeting_id+agenda_idx`) | 允许召集人重写裁决 | 低 |
| 8 | **per-meeting max_total_seconds 配置** | 当前全局常量 `MAX_MEETING_SECONDS=2700` (45 分钟) | 创建会议时可选 30/45/60/90 | 低 |
| 9 | **workspace suspend / archive / delete** | v26.4 spec Q5 留的, 没做 | /super 平台超管 一键暂停/归档/软删 客户空间 | 中 (运营) |
| 10 | **邮件自动发 invite_url** | 当前手动复制微信发给客户 | SMTP 发邀请邮件 | 低 |
| 11 | **OCR 准确度** | 用 Qwen-VL, 扫描件 / 手写体不准 | 接更专业 OCR | 低 (product-needs v1.1 路线提过) |
| 12 | **记忆库反悔删除** | 入库后无法删 | 用户审过想反悔时能删 | 中 (product-needs v1.1 提过) |
| 13 | **快照一键跳会议详情 + 自动滚到原文** | 当前跳到会议页顶部 | 跳到具体行 + 高亮 3 秒 | 中 (product-needs v1.1 提过) |
| 14 | **会议分享卡片自定义** | 微信只显小程序通用卡 | 显会议标题 + 议程数 + 召集人 | 低 |

### 4.3 UX 不完整 (有数据无 UI / UI 不一致)

| # | 哪里 | 问题 | 紧急度 |
|---|---|---|---|
| 1 | **二级详情页 (mobile)** | `/m/meetings/new` / `/m/tasks/[id]` / `/m/agents/[id]` / `/m/me/voiceprint` / `/m/privacy` 仍然是 dark, 跟 round-3 浅色会议室视觉撕裂 | 🔥 高 (round-4.5 Saga D 已规划但未做) |
| 2 | **4 主 tab (mobile)** | `/m` / `/m/meetings` / `/m/tasks` / `/m/insights` / `/m/me` 仍然是 dark, 跟 round-4 设计差距大 | 🔥 高 (round-4 P0 in-progress) |
| 3 | **expert 角色 UX** | expert / manager 角色没专门的"我跟我的 AI 协作" page, 用通用 /me/profile 看 | 中 |
| 4 | **会议室录音状态 / 麦克风权限 UX** | 仅 UI toggle, 无真实硬件状态反馈 | 低 |
| 5 | **桌面 admin / mobile 一致性** | 桌面是 admin-heavy (审批 / Dashboard / Kanban), mobile 是 user-heavy (今日 / 会议 / 任务) — leader 跨端切换体验断裂 | 中 |

### 4.4 跨端同步缺失

| # | 哪里 | 问题 | 紧急度 |
|---|---|---|---|
| 1 | **微信小程序 ↔ H5 token 桥接** | 已经做了 (v27.0-P21 第 6 刀 + N-3), 但仅限"小程序创建会议时上传聊天记录"路径 | OK |
| 2 | **小程序 → H5 visibility-change 同步附件** | 已做 (`MeetingAttachment` table + draft_id) | OK |
| 3 | **桌面 ↔ mobile 通知** | 通知是后端写库 + 前端 polling, 没真实跨端 push (在线状态判断粗) | 中 |

### 4.5 PM 在 commit message 里提过但没做完

| # | 提到的 | 出处 | 状态 |
|---|---|---|---|
| 1 | round-4 Mobile App 整体重做 (~110h) | `8b2b712 docs(design) round-4 review` | **P0 in progress** (feature/mobile-app-r4-A 分支) |
| 2 | round-4.5 二级页浅色化 (~30h) | `SAGA-mobile-app-round-4-changelist.md:第 5 节 P3` | 未启动 |
| 3 | v26.5 候选池 6 件 (跨 ws 推送 / suspend / 计费 / 邮件 / 客户 ABAC / agent-user 双向一致) | `docs/v26.5-spec.md` | **全部未启动**, 5 月 13 起标"候选" |
| 4 | v27.0-mobile Phase 3 (单专家详情页深度 + 智囊三 tab 真做) | `docs/v27.0-mobile-phase3-todo.md` | 部分做了 (v27.0-P4.4 三 tab + P3 详情页骨架), 多专家协作视图未做 |

---

## 5. 项目演进时间线 (一张表)

| 版本 | 时期 | 主要工作 | 关键里程碑 |
|---|---|---|---|
| **phase 1 / a / b / c** | ~2025.12-2026.01 (估算) | 骨架: FastAPI + Next.js + Docker · 声纹录入 · 单 AI 旁听 · 8 段纪要 | `6e6630f phase 1 scaffold`, `c35b2a2 phase-a 声纹`, `5bf311f sprint-b AI` |
| **sprint-d/e/f/i/j/k** | 2026.02-2026.03 | 声纹准确率 · 长期记忆 RAG · 多租户登录 · 知识库 · 多 AI 协调 · UX polish | `f458ce5 sprint-e memory`, `e0fc821 sprint-i KB` |
| **m3.0 / v8-v14** | 2026.03-2026.04 | M3.0 自驱主持人 · agenda monitor · 分歧检测召唤仲裁专家 · cowork 自测套件 | `b40228c m3.0 moderator`, `2f8fe99 P1·T1 Cowork suite` |
| **v17 - v25** | 2026.04-2026.05.10 | Task 一级对象 · 8 态状态机 · 智慧住建翻译层 · 多 AI 协作 · 看板 · 数据 5 级分级 · 反幻觉纪要 · 客户验收 | `14f3fed v17 Task`, `d5ffe5c v21 安全`, `66efe80 v23 看板`, `3d0ad3b v25.15 业务闭环` |
| **v26.0 - v26.4** | 2026.05.11-13 | Agent-centric 派发 · KB embedding 真正接入 · 任务办结自动沉淀 · 召集人模式 (全 AI 自主) · 平台超管 SaaS 平台层 | `c0fc9af v26.0 agent-centric`, `ab300c3 v26.3 召集人`, `490dedc v26.4 super` |
| **v26.5 - v26.14** | 2026.05.13-22 (估算) | 角色重设计 · 知识血缘 · 工作站 IA · 个人中心 · 模板生成 · AI 数字员工 · 会议室三栏 + AI 焦点卡 · Perplexity 抓取 · 议程进度推进 · 偏题三级 UI · 主动决策收口 | `ab300c3 v26.5-P0`, `82a6e25 v26.5-Lineage-P2`, `af85d0f v26.9 数字员工`, `e936d22 v26.14-P5` |
| **v27.0-mobile** | 2026.05.22-05.25 | 移动端 H5 大改造 P0-P23 (新 IA · 工卡墙 · 工作台 · 任务闭环 · 会议室录音 · 自动转录 · IM 流 · 会议室状态守卫 · 客户端原生 N-1 N-3 · 声纹页原生 · 假死修复 · iOS WKWebView 锁 viewport · 隐私协议 + 上线) | `b74a09d v27.0-P0`, `e055ba7 P22 声纹原生`, `7753a7f P23 紧急修` |
| **v1.1.0** | 2026.05.25 | 微信小程序 4 tab 全转原生 · 微信 OAuth 一键登录 · 手机号一键登录 · 全局动效 | `c441963 v1.1.0 小程序全转原生` |
| **v1.2.0** | 2026.05.25 | 会议室浅色 iOS 风全面重做 (round-3) — meeting-room-v2 · CompactContextBar · 单行 dock · Materials module · round-3 风扩到 new + summary 页 | `c77a09b 合并 main`, `0a4ee62 P1`, `2e3b589 P3 Materials`, `f217b53 P4` |
| **v1.3.0 round-4** (in-progress) | 2026.05.26+ | Mobile App 整体重做 round-4 (Saga A 主 tab 浅色化 + MAGlowBanner + Saga B/C/D 待定) | `8b2b712 docs round-4 review` (feature/mobile-app-r4-A 分支) |
| **未来 (建议)** | 2026.05.26+ | **回归功能性** (本文档诉求) — 见第 8 节 ROADMAP 建议 | — |

---

## 6. 顶层架构

### 6.1 三端

```
┌──────────────────────────────────────────────────────────────┐
│  入口                                                          │
│                                                                │
│  桌面浏览器        移动 H5            微信小程序原生 (v1.1.0)     │
│  /admin /me        /m/...             4 tab 原生壳              │
│  /dashboard        (recent focus)      + webview fallback       │
│  /super (v26.4)                        + picker (聊天记录)        │
│  /meeting/[id]                                                  │
│        ↓                ↓                       ↓                │
│  ────────────── Next.js 15 / React 19 + tailwind ──────────────│
│                          ↓                                       │
│                  ──── HTTP + WS ────                             │
│                          ↓                                       │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FastAPI 后端 (Python 3.11)                                    │
│  24 routers · ~200+ endpoints · ~30 SQLAlchemy 表                │
│  ├─ auth / meetings / mobile / me / agents / knowledge          │
│  ├─ memory / memory_drafts / kb_sedimentation / lineage         │
│  ├─ dashboard / super / team / audit / cron_rules / reports     │
│  ├─ access_requests / agent_templates / chat / voiceprints      │
│  ├─ meeting_attachments / model_providers / search_providers    │
│  └─ users / asr_vocabulary / perplexity_fetch                   │
│  + 调度链路:                                                     │
│    - orchestrator (hybrid 模式 AI 触发)                          │
│    - auto_meeting_orchestrator (auto 模式全 AI 自主)             │
│    - agenda_monitor / dissent_detector / closure_curator         │
│    - action_extractor / task_consolidator / consensus_consolid.  │
│    - briefing_generator / summary_generator / memory_extractor   │
└──────────────────────────────────────────────────────────────┘
                          ↓
        ┌────────────────────────────────────┐
        ↓                  ↓                  ↓
    PostgreSQL +        阿里云 OSS         第三方 LLM/STT
    pgvector            (录音 + KB)         DashScope
    (~30 表 + 1536d                          + pyannoteAI
     embedding)                              + Dify (hidden)
                                             + Perplexity
                                             + 微信 SDK
```

### 6.2 数据模型 (30 张表精简版)

**核心五象限**:

```
       ┌──── 组织 ─────────┐  ┌──── 用户 ─────┐
       │ workspace          │  │ user           │
       │ workspace_membership│  │ voiceprint     │
       │ workspace_invitation│  │ password_reset │
       └────────────────────┘  └────────────────┘
                ↓                       ↓
       ┌──── 会议 ───────────────────────┐
       │ meeting (mode + auto_state + agenda)
       │ meeting_attendee / attachment    │
       │ meeting_transcript / agent_message│
       │ meeting_speaker_segment           │
       │ meeting_consensus (v26.3)         │
       │ meeting_action_item / comment     │
       └────────────────────────────────────┘
                ↓
       ┌──── AI / 知识 / 记忆 ──────────┐
       │ agent (persona + primary_user) │
       │ knowledge_base / document / chunk
       │ long_term_memory (1536d emb)   │
       │ memory_agent_link              │
       │ memory_draft (审批 gate)        │
       │ kb_sedimentation_draft         │
       │ ai_insight (worth_remembering) │
       └─────────────────────────────────┘
                ↓
       ┌──── 任务 + 决策 ────────────────┐
       │ task (8 态状态机)                │
       │ task_co_progress / penalty / rating
       │ task_evaluation (月度 4 维)       │
       │ leader_directive / upper_doc     │
       │ cron_rule                        │
       │ data_access_request (跨 AI 审批)  │
       └────────────────────────────────────┘
                ↓
       ┌──── 横切 ────────────────────────┐
       │ notification / audit_log         │
       │ model_provider_config / search_  │
       └────────────────────────────────────┘
```

### 6.3 设计系统

`docs/design/system/DESIGN_SYSTEM.md` v1 (726 行, 2026-05-25):
- 反向抽取自 bundle (会议室 round-3 设计稿) + 现有 frontend 生产代码
- 标 `[bundle]` 新设计 / `[现有]` 老 dark / `[冲突]` 需 PM 决策
- **核心冲突 C1**: bundle 是 iOS 浅色, 现有是深色 Tailwind. round-4 in-progress 在解决.

---

## 7. 工作流 (PM 跟 Claude 已建立)

观察自最近 commit + CLAUDE.md:

1. **主-从架构 + 风格守门协议** — 主 Agent 把控 + subagent 隔离实施. 任何 UI 改动前必读 `DESIGN_SYSTEM.md`. STYLE-DEVIATION 必须在 commit message 标.
2. **Saga 拆分 + 改动清单 + 渐进合并** — round-3 拆 P1-P4 渐进 commit, round-4 拆 A/B/C/D 子 Saga 各 30-40h. Saga 落地前必有 changelist 文档 (`SAGA-*.md`).
3. **Kimi 测试用例必产** — 任何 feat/fix 落到生产后必产出 `docs/kimi-tests/<版本>-kimi.md`, 6 条死规矩反幻觉. 这是项目验收的核心约束.
4. **commit message 含版本号 + Phase 标** — `feat(v1.2.0 P4): ...` / `fix(v1.2.0 P1.2): ...`
5. **风格优先**: 现有代码可能是老风格 (浅色化前), 不要无脑借鉴.

---

## 8. 关键 ROADMAP 建议

### 8.1 已规划 (in-progress)

| Saga | 估算 | 状态 | 描述 |
|---|---|---|---|
| **Saga A · 主 tab 浅色 + Today 大改** (round-4 P0) | ~40h | in-progress (feature/mobile-app-r4-A) | MobileShell + BottomNav + PageHeader + Today 大重写 + MAGlowBanner + 共享头像/Icon 提层 |
| **Saga B · 次级 tab 浅色 + Glow Banner** (round-4 P1) | ~25h | 未启动 | meetings/tasks/me 浅色 + NotificationsSheet sheet 化 |
| **Saga C · MemoryRadar 雷达图** (round-4 P2) | ~15h | 未启动 | SVG 6 维度多边形 + 团队对比 + peek-then-tuck + backend memory-stats |
| **Saga D · 二级页浅色化** (round-4 P3) | ~30h | 未启动 | meetings/new, tasks/[id], agents/[id], me/voiceprint, privacy 浅色 |
| **合计 round-4** | ~110h | | |

### 8.2 建议下一步 (我的建议, PM 的诉求)

> **PM 的诉求是"回归功能性, 原计划很多功能没实现预期"**. 基于第 4 节"未实现"清单, 我建议拆 3 个新 Saga, 跟 round-4 并行 / 按需排序:

#### Saga E · 功能补齐 (P0) — 让现有"功能性"闭环真起来

**目标**: 把 4.2 节"业务逻辑半成品" 的前 3 项干掉.

| 子项 | 估算 | 优先级 | 备注 |
|---|---|---|---|
| E.1 AI 圆桌真协同 (从 mock 走 backend, 多 AI 真实轮发) | ~15-20h | 🔥 P0 | PM 旗舰功能, 现在是 1 张固定 mock — 客户看不到真正的"多 AI 协作"价值 |
| E.2 真实 PDF / PPT / Excel 预览 (接 extract_summary / extract_text 渲染) | ~8h | 🔥 P0 | 会议室"资料" tab 现在是 hardcoded mock 渲染 |
| E.3 真人 attendee API + 头像 stack | ~6h | 🔥 P0 | 解锁: 会议室真人筛选 / 头像 stack / round-4 设计的多人头像 |
| **小计** | ~30h | | |

#### Saga F · 知识闭环补齐 (P1) — Memory / KB / Citations

**目标**: 把"知识沉淀"链路里的 UX 短板补齐.

| 子项 | 估算 | 优先级 | 备注 |
|---|---|---|---|
| F.1 KB 引用侧栏 (citations 已在库, UI 没做) | ~6h | P1 | 让 AI 引用透明可信 |
| F.2 快照一键跳会议详情 + 滚到原文 + 高亮 | ~4h | P1 | product-needs v1.1 提过 |
| F.3 记忆库反悔删除 | ~3h | P1 | product-needs v1.1 提过 |
| F.4 chapter / highlights 自动提取 | ~10h | P1 | 解锁会议室章节 sheet 真功能 |
| F.5 multi-expert 协作视图 (一议题多 AI 对照) | ~12h | P1 | v27.0-mobile-phase3-todo 提过 |
| **小计** | ~35h | | |

#### Saga G · 运营层补齐 (P2) — 乙方 SaaS 运营缺的几件

**目标**: v26.5 spec 候选池里的 C2 / C3 / C4. 给乙方运营自己用.

| 子项 | 估算 | 优先级 | 备注 |
|---|---|---|---|
| G.1 workspace suspend / archive / soft delete (v26.5 C2) | ~6h | P2 | 客户离职 / 合同到期 回收空间 |
| G.2 计费 / 配额 / LLM 用量 dashboard (v26.5 C3) | ~14h | P2 | 不知道哪个客户烧多少钱 |
| G.3 邮件自动发 invite_url (v26.5 C4) | ~4h | P2 | 现在手动复制微信发 |
| G.4 跨 workspace 推送 agent / KB 模板 (v26.5 C1) | ~14h | P2 | 总部升级 prompt 一次推 N 个客户 |
| **小计** | ~38h | | |

#### Saga H · UX 收口 (P2)

- expert / manager 角色专属 UX (一个"我跟我的 AI 协作" page) — ~8h
- 桌面 ↔ mobile 一致性 (重点是通知 + 任务详情跨端一致) — ~10h
- 录音状态 / 麦克风权限 真实状态反馈 — ~4h
- **小计** ~22h

### 8.3 我的强建议 (排序)

> 跟 PM 的诉求"回归功能性"对齐:

1. **先把 round-4 Saga A 收尾** (~40h, 1-2 周, in-progress 不要中断, 浅色化 P0 主 tab 必做否则视觉撕裂)
2. **暂停 round-4 B/C/D**, 转到 **Saga E 功能补齐 (~30h)** — AI 圆桌 / PDF 预览 / 真人 attendee. 这是 PM 痛点最大的地方.
3. 之后看反馈, 决定:
   - 客户最在意"知识闭环" → Saga F (~35h)
   - 客户演示窗口期已经收到反馈 → Saga G 运营层 (~38h)
   - UI 视觉撕裂大客户投诉 → 才考虑 round-4 B/C/D 收尾
4. **不建议**: 在没补齐核心功能前继续 UI 重做. round-4 整体 110h 全做完, 客户看到的"漂亮 UI 包着 mock 数据" — 这正是 PM 自己说的"没实现预期".

---

## 9. PM 待对齐的关键问题 (7 个)

> 抛给 PM. 你的判断会决定下一阶段的 ROADMAP. **建议先读这一节**, 再回到第 4 / 8 节.

### Q1 · 产品一句话定位 — 我猜对了吗?

我反推的: **"面向中国政企的 AI Agent 协作会议工作台. 把会议从被动记录升级为组织决策智能系统"**.

- **如果对** → 下一步建议: 立 `docs/NORTH_STAR.md` 把这句话锁住. 所有未来 spec 跟它对齐.
- **如果不对** → 你想是什么? 我看到两条暗线在产品里搅在一起:
  - 线 A: "通用 AI 协作会议工作台" (SaaS, 任何团队)
  - 线 B: "智慧住建政府工单平台" (`workspace.preset='smart_construction'`, 16 AI + 三级催办 + 4 维派发 + 5 级数据分级 + 上级文件触发源 + 月度评价 + Kanban)
  - 线 B 是 v17-v24 的核心, 占了一半代码. 线 A 是 v26 后的主线.
  - **PM 决策**: B 是 A 的一个 preset (现状), 还是 B 应该拆出去成独立产品?

### Q2 · 5 个角色都核心吗? 还是某些其实没在用?

- owner / admin / leader / member — 显然在用
- **expert (= manager)** — 这角色定义有歧义. 代码里 expert / manager / primary_user 三个词混用. v26.5 spec 明确说 "manager" 但代码还叫 expert. UX 也不完整 (见 2.4).
- **PM 决策**: 把 manager 正式定为一等角色, 给它专属页面? 还是 manager 就是 admin 子集, 直接退化?

### Q3 · 哪些"未实现"是真 critical, 哪些可以推迟?

我在第 4 节按 🔥 / 中 / 低 打了优先级. **关键问题**:
- **AI 圆桌真协同** (4.2 第 1 项) — 是 PM 旗舰功能, 但现在是 mock. 你认同 P0 吗?
- **二级页浅色化** (4.3 第 1 项) — 视觉撕裂, 但功能可用. 是 P0 还是 P1?
- **运营层 (4.5 v26.5 候选 6 件)** — 现在客户演示窗口期收到的反馈触发了哪些? 还是没启动?

### Q4 · 是否需要正式立 NORTH_STAR 文件?

目前没正式 NORTH_STAR. 替代:
- `docs/product-needs-v1.md` (419 行, 用户视角)
- `docs/v26.3-spec.md` (召集人模式技术 spec)
- `docs/v26.5-role-redesign-spec.md` (5 角色矩阵)
- `README.md` (60 字一句话)
- 散落在 commit message 里的 PM 原话

建议把这些**合并升级**成 `docs/NORTH_STAR.md` (单一权威源). 然后每个 Saga changelist 顶上引用 NORTH_STAR 的哪一节.

### Q5 · round-4 之后, 是直接进"功能补齐"还是先稳定一段?

按 PM 诉求 "回归功能性", 我建议**功能补齐**优先 (Saga E). 但你可以选:
- **(a)** Saga E (功能补齐, ~30h) → 稳定 1-2 周收集客户反馈 → 决定下一步
- **(b)** Saga A 完成后直接进 Saga B/C/D 把 round-4 全部收完 (~70h 剩余) — 视觉一致, 但功能空洞
- **(c)** Saga E + 同时 Saga D (二级页浅色化, ~30h 后台并行) — 又干功能又干 UI, 但加压力

### Q6 · 智慧住建 16 AI 一键 seed 是只服务福田 demo 还是要扩到其他客户?

`backend/app/scripts/seed_smart_construction.py` (v24.1) + `workspace.preset='smart_construction'` 让一键 seed 16 AI + 月度评价 + cron + 上级文件 触发源 跑起来. 现状只在 福田住建局 demo 用.

- **PM 决策**: 这套是"福田专属", 还是"政府客户通用模板"? 如果通用, 需要 Saga G.4 跨 workspace 推送, 而且要做"政府版" vs "企业版"的 preset 分支.

### Q7 · 桌面 admin / mobile / 微信小程序 — 三端定位

现状:
- 桌面 admin (老主战场, v17-v25) — admin / leader 用, 深度操作 + Dashboard + Kanban + 报表
- mobile H5 (v27.0) — 全角色日常追踪
- 微信小程序原生 (v1.1.0) — 在 mobile 之上加一层"微信 OAuth + 聊天记录文件 picker", 主体是 webview 套壳的简化版

**问题**: 三端**信息架构不对齐**. 桌面是 "/admin + /me + /dashboard + /super", mobile 是 "/m + 5 tab", 小程序又是另一套. leader 角色跨端切换体验断裂.

**PM 决策**:
- (a) **三端独立各自最优**, 接受信息架构差异 (现状)
- (b) **mobile-first**, 桌面 admin 收敛成"mobile + 几个 admin 专属页面"
- (c) **桌面 desktop-first**, mobile 是"看会议 / 接任务 / 简单审批" 的精简版

---

## 10. 附录 · 文档索引 (PM 自己想深读时)

| 文档 | 路径 | 看什么 |
|---|---|---|
| 产品需求 v1 (用户视角) | `docs/product-needs-v1.md` | 4 主题 + 用户场景 + v1.1 路线 |
| 设计系统 v1 | `docs/design/system/DESIGN_SYSTEM.md` | 颜色 / 字号 / 组件 / 冲突点 |
| round-4 changelist | `docs/design/specs/SAGA-mobile-app-round-4-changelist.md` | 移动端整体重做改动清单 (612 行) |
| meeting-room-v2 (已实施) | `docs/design/specs/SAGA-meeting-room-v2-changelist.md` | 会议室 round-3 改动清单 |
| v26.3 召集人模式 spec | `docs/v26.3-spec.md` | 全 AI 自主会议产品 + 技术 spec (556 行) |
| v26.5 角色重设计 spec | `docs/v26.5-role-redesign-spec.md` | 5 角色矩阵 + ABAC |
| v26.5 运营深耕 spec (候选池) | `docs/v26.5-spec.md` | 6 件运营层候选 (C1-C6) |
| Phase 3 TODO | `docs/v27.0-mobile-phase3-todo.md` | 移动端 Phase 3 未做项 |
| CHANGELOG | `CHANGELOG.md` | v17-v26.4 里程碑 |
| Kimi 测试用例 (38 个) | `docs/kimi-tests/v*.md` | 每个版本的功能行为定义 + "已知不在范围" |
| 客户演示脚本 | `docs/客户演示脚本.md` | 7 幕剧 — PM 怎么给客户演 |

---

> **本文档不动代码**, 给 PM 顶层对齐用. 任何具体实施 Saga 需要单独开 changelist.
> 反馈 / 修正 / 不同意的判断, 请在本文档 markdown 直接批注或回头讨论.
