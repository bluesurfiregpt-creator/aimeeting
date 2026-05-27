# aimeeting · NORTH_STAR (产品宪法 v1.2)

> **版本**: v1.2 (大会师对齐升级, 2026-05-27)
> **历史**: v1.0 (2026-05-25 PM 7 问对齐) → v1.1 (权限重命名 v1.3.1) → **v1.2 (本次)**
> **来源**: PM 主导 8 大客户痛点表述 + Code Archaeology 校准 + Phase 1-2 + Sprint 1-3 ship 历史
> **演进机制**: 每个 Saga 收尾时反思, **或 PM 主导"大会师"重新对齐**, 由 PM 决策升级版本 (见第 9 节)
> **本文档是产品 truth source** — 任何 Saga changelist / spec 必须先对齐 NORTH_STAR, 不一致以 NORTH_STAR 为准.

---

## 0. TL;DR (一页扫读)

1. **产品定位**: 面向 **中国政企** 的 **AI Agent 协作会议工作台**. AI 专家**有长期记忆**, 会议结论沉淀回知识库, AI 协助完成**会后任务**.
2. **用户**: AI 专家(expert)是虚拟实体, 不是真人; 真人用户分 **4+1 权限层级** — workspace_creator / leader / admin / agent_owner / member (+ 跨 ws system_owner 走 env 白名单).
3. **核心差异**: 不是会议录音工具, 是有"组织决策记忆 + AI 任务执行"闭环的 SaaS 系统; **AI 五大能力**是产品灵魂(记忆/知识/数据/任务执行/会议表现).
4. **架构**: multi-tenant SaaS, **每个 workspace 完全独立**(logo / 名称 / 用户 / 声纹 / AI 专家 / 数据), 不硬编码客户专属逻辑.
5. **三端**: Web 全功能(含独占编辑) + 小程序原生(只查看 + 发起会议) + H5 (vibe coding 阶段测试用, 终态翻译到小程序).
6. **当前阶段** (v1.2 升级): MVP 路径 Phase A → B → C, 共 ~19-21d 三阶段 ship, 跑通客户 "开第一场到第十场会 + 非会议场景" 完整体验. Phase D (NEW-D agentic + WebRTC) V1.5.
7. **不做清单**: dark mode / 客户专属硬编码 / 小程序编辑 / 一次性大改 / mock 假装真实.
8. **客户 8 大痛点** (v1.2 新增, 见 § 1.4): 会议人云亦云 / AI 不持立场 / 开完不了了之 / AI 像新人不成长 / 多议题串题 / 会议跑偏 / 临时找不到人问 / 任务派出去没人跑.

---

## 1. 产品定位

### 1.1 一句话

> **面向中国政企的 AI Agent 协作会议工作台. AI 专家能有长期记忆, 会议结论沉淀回知识库, 并能协助完成会后任务.**
>
> _(来源: PM Q1 升级版, 取代 `README.md` 老一句话 + `product-needs-v1.md` 一句话)_

### 1.2 三层价值

按"产品差异化 → 离开就走不掉"的顺序排:

1. **AI 专家有长期记忆 + 跨会议延续** — 不是一次性助手, 是有上下文的同事. 三个月前那场会的结论, 这次开会 AI 自动调出来 (`product-needs-v1.md` § 2.2).
2. **会议结论沉淀回知识库** — 一年开 200 场会, 不再"讨论过但忘了在哪". 三层金字塔 (快照 → 待审 → 记忆库), AI 筛 90% + 人拍板 (`product-needs-v1.md` § 2.1).
3. **AI 协助完成会后任务** — 决策完不止"派任务", AI 真正执行: 任务办结 → 自动沉淀回 AI KB → 下次类似任务调出"上次怎么处理" (v26.2 task_consolidator + v26.5-Lineage).

### 1.3 跟同类产品的差异

| 同类品类 | 同类做的 | aimeeting 多做的 |
|---|---|---|
| **腾讯会议 / 飞书妙记** | 录音 + 转录 + 纪要 | 多 AI 专家发言 + 知识库沉淀 + 任务派发 + 召集人模式(全 AI 自主) |
| **ChatGPT / Claude** | 1v1 私聊 | N 个 AI 在一场会里相互讨论 + 综合输出 + 召唤新 AI |
| **政务工单系统** | 工单流转 + 派人 | "组织决策 + 知识沉淀 + 数据 5 级 ABAC" 收在一起, 从工具走向决策助手 |

_(反推自 `docs/PRODUCT_OVERVIEW.md` § 1.2 + `docs/product-needs-v1.md` 主题一-四, 不硬猜)_

### 1.4 客户 8 大痛点 (v1.2 大会师对齐 · PM 主导口述)

> **来源**: 2026-05-27 PM "大会师" 主导问对齐. **这 8 条是产品最终要解决的客户痛点, 任何 saga / 功能取舍以此为准.**
> 用 PM 原话精炼, 不二次诠释.

#### 痛点 1 · 会议人云亦云
> "每次开会, 总是一两个人在会上发言和主导, 其他人完全提供不了有效的交流和建设性意见, 都是人云亦云."

**对应产品能力**: 多领域 AI 专家参会发言 (NORTH_STAR § 3.5 + auto_meeting_orchestrator + 3 路 LLM judge proactive)

#### 痛点 2 · AI 顺着发言人立场不持立场
> "AI 专家有他不同的知识库, 可以在某一特定领域针对性地提出意见, 而不是顺着发言人立场来去迎合, 真正能给会议注入新鲜的、聪明的、可讨论的建设性意见."

**对应产品能力**: 持 KB 的 AI agent (§ 3.2 + agent_router RAG retrieval) + **system prompt 立场守门** (v1.2 新增)

#### 痛点 3 · 会议完成不了了之, 沉淀不到位
> "开完会经常不了了之, 跟没开一样. 会议要有沉淀: 纪要(讨论重点、每个人立场、事实、下一步) + 任务. 关键: **任务必须能溯源到具体讨论段落或结论性依据**, 否则不知道 AI 总结对不对."

**对应产品能力**:
- summary_generator + action_extractor + insight_extractor (Sprint 2 verify ✓)
- `MeetingActionItem.evidence_quote` + `evidence_anchor_line_ids` 字段已落 ✓
- **summary 按发言人分立场** (v1.2 调优待做)
- **任务溯源 chip + 点击跳实录高亮** (Sprint 3 Mobile ship ✓, Web 待 Phase A)

#### 痛点 4 · AI 像新人不成长 · 会议记忆要"覆盖最新"
> "AI 专家应该陪着我们开会不断成长, 不是每次开会都是新人. 知识库(书架)和记忆(回忆)要区分: **书架上的书可以人为更新, 记忆是 AI 参加过会议沉淀下来的, 新会议覆盖老的冲突记忆**. 两个月前那场会跟现在冲突, AI 必须明确知道, 最新覆盖老的."

**对应产品能力**:
- 跨会议记忆 (§ 3.1 + LongTermMemory + RAG retrieve) ✓
- **NEW-A: 冲突检测 + 新覆盖老 memory** (v1.2 新增 P0 — 见 § 3.1)
- **书架 vs 回忆 UI 区分** (v1.2 新增设计原则)

#### 痛点 5 · 多议题穿插, AI 不能串题
> "议题可以是连续(同议题连开 3 场)也可以是交叉(中间穿插其他会议). 只要参会专家还是上一场会议的, 就能持续沟通讨论, **不会因中间穿插其他会议在记忆方面有所干扰**."

**对应产品能力**:
- RAG 相似度检索 (现有) — 部分覆盖
- **NEW-B: 议题主题一级对象 (topic_thread)** (v1.2 新增 P0 — 见 § 3.5)

#### 痛点 6 · 会议跑偏需要 AI 主持人拉回
> "会议经常聊偏, 1 小时开成 3 小时. 需要 AI 主持人及时提醒, 把会议拉回正题. **主持人还要清楚每位 AI 专家能力, 用户求助时推荐合适的一位或多位 AI 来回答**."

**对应产品能力**:
- agenda_monitor (偏题/超时/僵局) m3.0 + v26.14-P4 ✓
- agent_router 5 维 routing 推荐 AI ✓
- Mira moderator role 内置 ✓
- **主持人 UI 交互**(拉回提示 + @Mira 推荐专家)(v1.2 调优 Phase A)

#### 痛点 7 · 非会议场景找 Mira 临时问问题
> "不是所有问题都要开会. 临时有问题不知道问谁, 可以快速呼叫 AI 主持人. 主持人参与每场会, 知道历史 + 每位 AI 特长. 答不出会推荐 AI 专家."

**对应产品能力**:
- backend 全有 (Mira + 跨会议记忆 + agent_router 推荐) ✓
- **NEW-C: 非会议场景 1-on-1 Mira 对话入口** (v1.2 新增 P0 · 前端 0 实现)

#### 痛点 8 · AI 自主跑任务 vs 协作交付
> "会后形成的任务, 有些可以由 AI 专家自行完成 (类似 OpenClaude 模式) — AI 自己根据任务情况完成并交付. 有些需要人工协助 (补资料 / 现实操作), 则提示用户在人类协助下完成."

**对应产品能力**:
- 任务派 AI + 状态机 + 4 维 routing + KB 沉淀 ✓
- **NEW-D: AI agentic 自主跑任务执行链** (v1.2 新增 · 类 OpenClaude · 高风险 V1.5)

---

## 2. 用户与角色

### 2.1 AI Agent (expert) — 产品灵魂

> **expert = AI Agent 专家** (Aria / Stratos / Mira 等), 是 **虚拟实体**, 不是真人用户. 5 个核心能力见第 3 节.

- **moderator AI** (内置, Mira): 每个 workspace 一个, 不可删, 不接 task. 负责会议秩序 + 议程推进 + 共识收敛.
- **领域 AI**: workspace owner / admin 配置, 数量不限. 持 KB + persona + tone + boundary + `primary_user_id`.
- **数字员工形象** (v26.9+): 头像 / 全身 / 动图 + 短名 nickname + 个人渐变色, 跟真人有强视觉区分.

### 2.2 真人用户 — 4 + 1 权限层级 (v1.3.1 PM 拍板)

> v1.3.1 升级 (PM Q2.3 audit 后拍板). 旧 `owner` (workspace 注册者) 改名 `workspace_creator`, 旧 `manager` (v26.5 部门 AI 维护人) 改名 `agent_owner`, 拆 `leader > admin` 真正分层 (admin 不再 等同 leader).

| 角色 | 范围 | 主要权限 | Web 编辑 | 小程序 / H5 |
|---|---|---|---|---|
| **system_owner** | 跨 workspace | 所有 workspace + 角色 + AI + KB + 记忆 增删改查 跨 ws. **走 env `PLATFORM_ADMIN_EMAILS` 白名单, 不入 user table.** | 独占 | 仅查看 |
| **workspace_creator** | 单 workspace | workspace 注册者. ws 内最高权. 跟 leader 同权 (只是命名上 标识"原始创建者") | 独占 | 仅查看 |
| **leader** | 单 workspace | workspace 管理员, ws 内最高权. 管所有 AI / KB / 任务 / 成员 | 独占 | 仅查看 |
| **admin** | workspace 内科室 | 科室人员管理 + 发起会议. **不能 编辑 AI / KB / memory** (PM Q7.4 严控) | 仅看 AI / KB / memory | 查看 + 发起会议 |
| **agent_owner** | 单 workspace | 某 AI 的 primary user. 改自己 primary AI 的 KB / memory; 不能创建 / 删 AI | 独占(限自己 primary AI 范围) | 查看 + 发起会议 |
| **member** | 单 workspace | 仅查看 + 发起会议 | 不编辑 | 查看 + 发起会议 |

**关键不变量**:
- AI(`Agent.role='expert'/'moderator'`) 跟真人是**两套实体**, 不混用. 老 `WorkspaceMembership.role='expert'` 已 v26.5 → manager → v1.3.1 → agent_owner 自动迁移.
- "agent_owner / 普通用户" 统称 **普通用户**, 放在 admin / agent_owner / member 范畴内.
- `Agent.primary_user_id` 推荐指向 agent_owner, 也可指向 workspace_creator/leader/admin; 不应指向 member.
- **`leader` vs `admin` 拆分** (v1.3.1): leader = ws 最高权 (= workspace_creator), admin = 科室级 (不改 AI/KB/memory).
- **注册流程改造** (v1.3.1, PM 决策 4): 只 system_owner (email 在 PLATFORM_ADMIN_EMAILS 白名单) 注册时可建新 ws + 当 workspace_creator. 普通用户注册必须有 invite token, 否则加入 demo workspace 当 member.

_(来源: PM Q2 + audit 2026-05-25 + PM 4 拍板决策, 见 `docs/audit/role-permission-audit-2026-05-25.md`)_

---

## 3. AI 专家核心能力 (产品差异化)

> **这是产品灵魂. 任何不增强这五项的 Saga, 优先级都应该排在后面.**
> _(来源: PM Q3 五点)_

### 3.1 长期记忆 (Memory)

**现状**: 三层金字塔已落地 (快照 ai_insight → 待审 memory_draft → 记忆库 long_term_memory + pgvector 1536d). Memory ↔ Agent 多对多 (memory_agent_link) v26.5-Lineage 已 GA.
出处链回 + 跳回原文 + 高亮 3 秒 (Sprint 3 Mobile ship ✓). axis_tag 6 轴分类 (Saga T5 ship ✓).

**目标 (v1.2 升级)**:
- ✅ 出处链回 + 跳回原文 + 高亮 3 秒 (Sprint 3 Mobile ship)
- ✅ 跨会议自动调用 (RAG retrieve + 注入 prompt, agent_router.py:325)
- ⏳ 记忆库反悔删除 (Phase C)
- 🔴 **NEW-A: 冲突检测 + 新覆盖老 memory** (痛点 4) — P0
  - 新 memory 入库前 LLM judge vs 老 memory 是否冲突
  - 冲突标 `superseded_by=新.id`
  - AI 引用时只拿"活的"
  - **时间线 UI**: 让用户看到"AI 知道哪些是最新"
  - **书架 vs 回忆 UI 区分** — KB (book) 是显式管理的, Memory (brain) 是 AI 沉淀的
  - 估时 2-3d (Phase B 简版 + Phase C 完整版)

### 3.2 知识沉淀 (Knowledge)

**现状**: KB 文档 (PDF/Word/Excel/PPT/图片 OCR) + chunk + embedding 已落. 任务办结 → AI KB 自动沉淀 (4 段闭环档案) v26.2 已落. RAG retrieve 真注入 prompt (agent_router.py:325 + _compose_system_prompt:199-208) ✓. citations 端到端到前端 chip (Sprint 3 Mobile ship ✓).

**目标 (v1.2 升级)**:
- ✅ KB 引用侧栏 (Sprint 3 Mobile KBCitationSheet ship · 相似度 chip 高/相关/参考)
- ✅ RAG retrieval 真注入 prompt (agent_router prod work)
- 🔴 **system prompt 立场守门模板** (痛点 2) — P0 Phase A
  - AI 不许说"以您的判断为准"
  - 基于 KB 顶住, 不和稀泥
  - 估时 0.5d
- ⏳ OCR 准确度提升 (扫描件/手写体, 接更专业 OCR)
- ⏳ 公文智能审核 v24.2#3 已落, 看是否扩到通用

### 3.3 数据沉淀方案 (Data)

**现状**: 5 级数据分级 (core/important/sensitive/general/public) + 跨 AI 访问申请 + 操作 audit v24.0 已落. 桑基血缘图 + AI 数据中心 v26.5-Lineage-P2 已落.

**目标**:
- 真实 PDF / PPT / Excel 预览 (现在是 mock hardcoded 渲染) — 接 backend extract_summary / extract_text
- chapter / highlights 自动提取 (会议室章节 sheet 现是 mock)
- 待补: 数据导出 + 第三方系统对接 SOP

### 3.4 任务执行 (Task Execution)

**现状**: Task 一级对象 + 8 态状态机 + 4 维自动派发 + 多 AI 协作(主责 + 协办 + 双向评分) + 月度评价 v17-v23 已落. v26.0 升级为 agent-centric (AI 主责, 真人是 AI 的"手脚"). action_extractor + task_consolidator prod ✓.

**目标 (v1.2 升级)**:
- ✅ action_extractor 抽 task + 4 维 routing 派人 (Sprint 2 verify ✓)
- ✅ task_consolidator 任务办结沉淀回 KB (kb_sedimentation_draft v26.5-02c)
- ✅ 任务溯源 (evidence_quote + evidence_anchor_line_ids) + UI chip 跳实录 (Sprint 3 Mobile ✓)
- 🔴 **NEW-D: AI agentic 自主跑任务** (痛点 8) — V1.5 高风险
  - task 派 AI → AI 调 LLM + 工具 (网络搜索 / 代码 / 文件读) → 完成 → 交付
  - 类似 OpenClaude / Claude tool_use loop
  - 协作流: AI 卡某步 → 标 "需人补充" → 提示用户
  - 估时 5-7d (Phase D)
- ⏳ expert / manager 角色专属 UX ("我跟我的 AI 协作" page, 现没做)
- ⏳ 跨端任务通知 push (现在 polling + 在线状态判断粗)

### 3.5 在会议中的表现优化 (Meeting Performance)

**现状**: 大幅超出 v1.0 自述. Code Archaeology 校准后真实 ~90%:
- AI routing 5 维 (语义 + KB + 历史 + 负载 + 可用性) v26.1 prod ✓
- agenda_monitor (偏题/时间/僵局) m3.0 + v26.14-P4 prod ✓
- 反幻觉纪要 (qwen-max → deepseek-v4-pro Sprint 2-0 + temperature=0 + evidence anchor) v25.7 ✓
- 召集人模式 auto v26.3 GA · Sprint 2-3 verify 176s 跑通 ✓
- **3 路 LLM judge proactive** (main.py:370-379): maybe_invoke_agents (@/keyword) + maybe_detect_dissent + maybe_check_agenda ✓
- STT 实时转录 (DashScope paraformer-realtime-v2) ✓
- 声纹 (pyannote API · batch 45s · API 决定不是 streaming)
- Saga E.E orchestrator ship · 2.5s 轮询 + OrchestrateStatusBanner (mobile + web R5.D)

**目标 (v1.2 升级)**:
- 🔴 **MOCK_ROUND_MESSAGES UI 替换** (TD2 长期 mock) — P0 Phase A
  - 1 张固定 mock 替换为真 backend agent_message WS event
  - 估时 1d
- 🔴 **LLM judge 主动度调优** (痛点 1+6) — P0 Phase A
  - 降阈值 + prompt 改 "insider judge" — AI 不被动
  - 估时 0.5d
- 🔴 **NEW-B: 议题主题一级对象 topic_thread** (痛点 5) — P0 Phase C
  - meeting.topic_thread_id 关联
  - 议题线 UI (看一议题的会议时间轴)
  - AI 显式拿"同主题历史"注入 prompt
  - 估时 3-4d
- 🔴 **NEW-C: 非会议场景 1-on-1 Mira 对话入口** (痛点 7) — P0 Phase B
  - Mobile: /m/ask-mira 或主页加 ChatGPT 风入口
  - Web: workstation 加 AskMiraPane
  - backend 复用 agent_router + Mira agent
  - Mira 答不出 → 推荐专家 → 转 1-on-1 跟专家
  - 估时 3-4d
- 🔴 **AI 主持人 UI 交互** (痛点 6) — P0 Phase A
  - 跑偏提示 ("我们好像跑偏了")
  - @Mira 呼叫专家推荐
  - 估时 1d
- 🔴 **R5.D web mic 接通** (Code Archaeology surface) — P0 Phase A
  - Web 会议室目前 viewer-only, 无 mic
  - 估时 2d
- 🔴 **summary 按发言人分立场** (痛点 3) — P0 Phase A
  - summary_generator prompt 模板加 "按发言人分立场" 模块
  - 估时 1d
- ⏳ WebSocket 替换 2.5s 轮询 (P95 5-17s → <500ms) — V1.5 (E.E2)
- ⏳ 摄像头 / 举手 / WebRTC — V1.5 高风险 (Phase D)
- ⏳ 声纹周期 45s → 15s + 阈值 0.65 → 0.55 微调 — Phase A polish

---

## 4. 端定位

### 4.1 Web 端 (桌面 + 移动响应)

**功能**: 全功能, **独占编辑能力**:
- 普通查看 / 发起会议 / 切换 workspace
- **expert (AI Agent) 编辑** (独占!)
- **AI 知识库管理 增删改** (独占!)
- **AI 记忆管理 增删改** (独占!)
- **owner workspace 增删改查** (独占!)

**形态**: 桌面 + 平板 + 手机浏览器 都跑. 当前路径:
- `/admin/*` `/me/*` `/dashboard` `/super` `/meeting/[id]` — 桌面主战场 (v17-v25)
- `/m/*` — 移动响应模式

### 4.2 小程序原生 (终态生产形态)

**形态**: 微信原生壳(v1.1.0 已 4 tab 全转原生) + webview fallback + 微信 OAuth 一键登录 + 手机号一键登录 + 微信聊天记录文件直传(`wx.chooseMessageFile`).

#### 4.2.1 允许做什么(工作流推进 + 基础导航)

- **只读浏览**: 会议 / 任务 / 通知 / 智囊 / 详情 / 总结
- **发起会议**: 创建 + 加入
- **切换 workspace**: 基础导航能力(_PM 决策 M2 = 必做, 2026-05-25_)
- **工作流推进类写入**(_PM 决策 M1 = B "工作流允许 / 配置禁止", 2026-05-25_):
  - meeting action: 进议程 / 标完成 / 推迟
  - task: 评论
  - memory_draft: approve / reject(审核 AI 记忆草稿)
  - insight: decision(决定 AI 洞察是否采纳)
- **声纹录入 / 删除**: 用户自己的(workspace 共享声纹库)

#### 4.2.2 禁止做什么(配置编辑 — 必须跳 Web 端)

- **expert (AI Agent) 配置**: 创建 / 编辑 / 删除
- **知识库 (KB) 管理**: 增 / 删 / 改
- **记忆库管理**: 增 / 删 / 改(审核 ≠ 编辑,见 § 4.2.1)
- **workspace 配置**: logo / 名称 / 邀请 / 成员管理 / 角色变更
- **数据沉淀方案 / API 设置**: workspace_creator / leader 级配置全在 Web

**边界判据**: "工作流推进 OK,配置编辑禁"。语义不清时回到这一句话决策。

### 4.3 H5 (`/m/*`) — vibe coding 阶段的 staging

**用途**: vibe coding 阶段的 **测试 / 验证工具**. **不是终态**, 是 staging.
**生命周期**: Saga 验证流稳定后, 翻译到小程序原生 (用户体验最佳).

### 4.4 三端数据同步原则

- **目标**: 三端跑同一套后端 (~30 表 + 200+ endpoint), 数据完全同步.
- **现状**: 目前有些功能逻辑不自洽 / 冲突 (例: 桌面 admin / mobile 信息架构差异 leader 跨端切换断裂; 跨端通知 push 没真做; 离线编辑场景未明确).
- **演进**: 后续按 Saga 逐个处理, 不一次性大改.

_(来源: PM Q7)_

---

## 5. SaaS 架构原则 (multi-tenant)

> _(来源: PM Q6)_

### 5.1 workspace = SaaS 用户

每个 workspace 完全独立:
- **logo / 名称** — 独立品牌
- **用户管理员** — 独立 owner / leader / admin / member
- **声纹** — 独立(`voiceprint` 表 workspace_id 隔离, phase-a + v27.0-P22)
- **AI 专家** — 独立 agent 集合, 不跨 workspace
- **数据** — 严格隔离, 所有业务表 workspace_id + middleware 拦截

### 5.2 智慧住建 = SaaS 通用模板的一个实例

> "智慧住建是政府客户通用模板, 等于是 SaaS 中的一个用户, 一个独立 workspace."

- 不是产品分支, **不硬编码**客户专属逻辑.
- `workspace.preset='smart_construction'` 走政府版预设(16 AI + 月度评价 + cron + 上级文件触发源), 但本质是 workspace 的属性, 不是代码分叉.
- 未来"福田 / 罗湖 / 龙岗 / 任何客户" = 新 workspace 实例, 复用同一份代码 + preset.

### 5.3 平台超管 = 跨 workspace 操作

`/super` (v26.4) 给乙方代建 + 跨 workspace 切换 + audit 留痕. 客户在自己 workspace 也能看到超管动作 audit.

---

## 6. 当前阶段目标 — MVP Phase A / B / C (v1.2 升级)

> _(来源: 2026-05-27 PM "大会师" 主导对齐)_
> **MVP 定义**: Phase A + B + C 完成 = "客户开第一场到第十场会 + 非会议场景" 完整体验, 可上线给用户内测.
> **总估时**: ~19-21d 串行 ship. PM 3 次内部 review (Phase 间).

### 6.1 Phase A · 把当前会议跑顺 (~6.5d) — 调优 + UI 打磨

| # | 项 | 客户体感 | 估时 | 对应痛点 |
|---|---|---|---|---|
| 1 | `MOCK_ROUND_MESSAGES` UI 替换为真 WS event | 进会议看到真 hybrid 圆桌 | 1d | 痛点 1 |
| 2 | LLM judge 主动度调优 (降阈值 + prompt "insider judge") | AI 不被动主动插话 | 0.5d | 痛点 1+6 |
| 3 | system prompt 立场守门模板 | AI 不和稀泥 真顶住 | 0.5d | **痛点 2** |
| 4 | summary 按发言人分立场 + 任务溯源 chip + 跳实录高亮 | 沉淀质量飞跃 客户能复盘 | 1.5d | **痛点 3** |
| 5 | AI 主持人 UI 交互 (跑偏提示 + @Mira 推荐专家) | 主持感 + 用户能呼叫 | 1d | **痛点 6** |
| 6 | R5.D web 会议室接 mic + STT WS | Web 大屏能说话 | 2d | (Code Archaeology surface) |
| 7 | MOCK_HUMANS + closure_curator 死码清理 + 声纹阈值微调 | 整洁 + UX 优化 | 0.5d | polish |

**Phase A 完后**: 客户开 1 场会真实顺畅 — 转录 + 多 AI 真发言 + 持立场 + 主持人拉回 + 沉淀有依据.

### 6.2 Phase B · 真 MVP 闭环 (~5-6d) — NEW 项必备

| # | 项 | 客户体感 | 估时 | 对应痛点 |
|---|---|---|---|---|
| 8 | **NEW-C** 非会议 1-on-1 跟 Mira 对话入口 | 没会议时也能用产品 入口完整 | 3-4d | **痛点 7** |
| 9 | **NEW-A 简版** 冲突 LLM judge + 标 superseded (不做覆盖 UI) | 多场会议 AI 不矛盾 | 2d | **痛点 4** |

**Phase B 完后**: 客户开 5-10 场会 + 平时找 Mira 问问题, 体验完整, AI 不自相矛盾.

### 6.3 Phase C · 完成 MVP 全功能 (~7-8d)

| # | 项 | 客户体感 | 估时 | 对应痛点 |
|---|---|---|---|---|
| 10 | **NEW-B** 议题主题一级对象 + 议题线 UI | 1 个月会议后感受到 "AI 真记得议题脉络" | 3-4d | **痛点 5** |
| 11 | **NEW-A 完整版** 冲突覆盖 UI + 历史版本展示 | 客户看到 AI 怎么 reconcile 新老结论 | 1-2d | **痛点 4** |
| 12 | 真 PDF/PPT/Excel 预览 + chapter LLM 抽 | 文件不再 mock 占位 | 2d | § 3.3 |
| 13 | mobile 创建会议真接 + Mira NLU (qwen-max → deepseek) | 描述需求路径真 work | 1d | § 3.4 |

**Phase C 完后**: **MVP = 完整可上线给用户内测**. 全功能闭环 + 沉淀质量高 + 议题脉络清晰.

### 6.4 Phase D · 差异化 + 高风险 (V1.5, 可推迟)

| # | 项 | 客户体感 | 估时 | 对应痛点 |
|---|---|---|---|---|
| 14 | **NEW-D AI agentic 自主跑任务** | 客户惊艳的差异化 ("AI 真替我干活") | 5-7d 高风险 | **痛点 8** |
| 15 | WebRTC + 摄像头 + 举手 | 多模态完整 | 6d 高风险 | § 3.5 |
| 16 | 声纹 streaming + 跨端 push + V2 auto-relay | 体验优化 | 8d | § 3.5 |
| 17 | WebSocket 替换 2.5s 轮询 (E.E2) | P95 5-17s → <500ms | 3d | § 3.5 |

**Phase D 不必 MVP 内做**: 拿当前 MVP 给客户测, 反馈驱动 Phase D 优先级排序.

### 6.5 立 NORTH_STAR.md + 接进 CLAUDE.md 工作流 (v1.0 沿用)

- 本文档.
- 把 NORTH_STAR.md 写入 `CLAUDE.md` "风格守门协议" 下方一节, 每个 Saga 启动前必读 § 1 + § 1.4 + § 6 + § 7 + § 7.5.
- "不做" 5 条 + "设计原则" 5 条 进 review checklist.

---

## 7. 明确不做 (5 条, 保护方向)

> 根据 PM 多次反馈 + commit 反推 + 风格守门协议. 任何 Saga / spec 跟这 5 条冲突, 默认拒绝, 除非 PM 显式拍板 override.

### 7.1 不做 dark mode

round-4 全面切换到 iOS 浅色 (会议室 round-3 done, 主 tab round-4 in-progress). **不允许**新写 dark token / 借鉴老 dark 代码.
- 例外: 必须 dark 的(eg. 模态过渡黑底)在 commit message 标 `[STYLE-DEVIATION: 具体原因]`.
- 反例: v1.2.0 P1.2 折叠态借了 AttachmentsSection 老 dark token, 是错误案例 (`CLAUDE.md` 风格守门协议).

### 7.2 不硬编码客户专属逻辑

智慧住建 / 福田 / 任何客户都是 **workspace 实例**, 不是产品分支.
- 不允许 `if workspace.name == '福田住建局'` 这种代码.
- preset 是 workspace 属性, 走 `workspace.preset='xxx'` 配置, 不是代码分叉.

### 7.3 不在小程序做编辑功能

小程序 / H5 仅 **查看 + 发起会议 + 切换 workspace**.
- expert / AI 知识库 / AI 记忆 / workspace 增删改查 **必须**走 Web.
- 任何"在小程序里加个编辑入口"的需求, 默认拒绝.

### 7.4 不一次性大改

大需求拆 Saga, 每 Saga 独立 ship + 独立 Kimi 验收.
- round-4 拆 A/B/C/D 4 个子 Saga 是正例.
- 不允许"一个 PR 改 50 个文件改 5 个模块".

### 7.5 不让 mock 数据假装真实

- 有 mock 必须在 UI 上标"演示"或在文档明示.
- 客户演示用 mock 时, PM 必须知情.
- 不允许 "TD2 PM 决策" 这种 mock 长期占位却没出口规划 (eg. AI 圆桌 mock 已超过 2 周, 进 Saga E 必出口).

---

## 7.5 产品设计原则 (v1.2 大会师新增 · 5 条)

> 来源: 2026-05-27 PM 大会师对齐口述, 提炼自 8 大客户痛点. 任何 saga / spec / commit 跟这 5 条冲突, 默认拒绝.

### 原则 1 · AI 持立场, 不和稀泥 (痛点 2)

- AI 专家**必须基于自己 KB 持立场**, 不许"以您的判断为准"式打太极.
- system prompt 要明确 "你是 X 领域专家, 你的判断基于 KB. 用户不同意你也要顶住, 不能为了 nice 而和稀泥."
- 反例: AI 现在偏"客气提建议", 不是"基于 KB 持立场顶住".

### 原则 2 · 知识库(书架) vs 记忆(回忆) — 严格区分

- **知识库 = 书架** (book): 显式管理 · 人为更新 · 增删改查 · 版本化.
- **记忆 = 回忆** (brain): AI 自动沉淀 · 时间累积 · 不可"人为编辑"(只能审批入库 / 标 superseded).
- UI 必须让用户**一眼分清**两者. 书架管理在 KbPane / KB 增删改, 记忆只能审 (memory_draft) + 看 (LongTermMemory).
- 反例: 把 memory 当 KB 一样允许用户随意编辑, 会破坏 AI 时间累积逻辑.

### 原则 3 · 任务必须能溯源到讨论段落

- 任何 AI 抽出的 task 都必须有 `evidence_quote` (原句) + `evidence_anchor_line_ids` (实录行号).
- 前端 UI 必须有 chip 让用户**点击跳到实录精确位置 + 高亮 3 秒**.
- 客户复盘时能"知道这个任务从哪句话抽出的", 否则无法判断 AI 总结对不对.
- 反例: action_extractor 抽出 task 但没填 evidence_* 字段, UI 没溯源 chip.

### 原则 4 · 新会议覆盖老冲突记忆

- 新会议产生的 memory 跟老 memory **冲突时**, **新覆盖老**:
  - 新 memory 入库前 LLM judge 是否跟老 memory 冲突.
  - 冲突时老 memory 标 `superseded_by=新.id` (软删除).
  - AI 引用时只拿"活的" (未被 superseded 的).
  - UI 让用户看到"AI 知道哪些是最新".
- **新覆盖老的判定逻辑** (LLM judge):
  - 同一议题 + 时间更新 + 内容矛盾 → 新覆盖.
  - 时间更新但不矛盾 (eg 补充信息) → 共存.
  - 内容矛盾但同时期 (24h 内) → 标 conflict pending 人工介入.

### 原则 5 · 议题持续, 中间穿插不干扰

- 议题 = 一级对象 (`topic_thread` 表), 不是 meeting 的附属属性.
- 多场会议可共享同一 topic_thread_id (eg "Q3 路线图" 议题连开 3 场).
- AI 引用时**显式按 topic_thread 过滤**, 不只靠 pgvector 相似度.
- 中间穿插无关会议 (eg 在 Q3 路线图议题中间开成本调研会), 不影响下次回到 Q3 议题时 AI 调用历史.

---

## 8. 工作流约定 (跟 CLAUDE.md 一致)

### 8.1 主-从架构

主 Agent (PM 决策) + subagent 隔离实施. PM 拍板, Claude 实施.

### 8.2 风格守门协议

任何 `Edit` / `Write` 涉及 `*.tsx` / `*.css` / `*.ts` UI 相关:
1. 读 `docs/design/system/DESIGN_SYSTEM.md` 当前最新版
2. 检查改动是否引入与 design system 冲突的视觉/交互
3. 冲突: 优先按 design system 改, 不能改的在 commit message 标 `[STYLE-DEVIATION: 原因]`
4. subagent 委派 prompt 必须 reference DESIGN_SYSTEM.md

### 8.3 Saga 拆分 + 改动清单 + 渐进合并

- 大需求拆 Saga → 每 Saga 独立 ship.
- Saga 落地前必有 `docs/design/specs/SAGA-*.md` changelist 文档.
- 改动清单 → PM 批准 → 实施.

### 8.4 commit message 含版本号 + Phase 标

`feat(v1.2.0 P4): xxx` / `fix(v1.2.0 P1.2): xxx`. 纯文档加 `[no-kimi-test]`.

### 8.5 Kimi 测试用例必产

任何 `feat(*)` / `fix(*)` 落到生产 → 必产出 `docs/kimi-tests/<版本>-kimi.md`, 6 条死规矩反幻觉. 见 `CLAUDE.md` § 部署+测试流程.

### 8.6 Kimi 测试用例 路径规范 — **强约束**

> _PM 多次提醒 (2026-05-27 起): 给 Kimi 的命令 / 文件引用 不允许 用 相对路径._

#### 为什么

Kimi 跑在 自己 sandbox 里, **没有 当前 工作目录 上下文**. 我们 repo clone 路径 跟 Kimi sandbox 路径 不一样. 写 `python3 scripts/runner.py --script docs/kimi-tests/...json` Kimi 看到 不知道 在 哪个 dir 跑, 跑出来 找不到 文件 → 整个 用例 fail.

#### 强约束 (违反 = 测试用例 重写)

1. **每个 Kimi 测试用例 顶部 必须 定义 `REPO_ROOT`**:
   ```bash
   # 你 clone repo 后, set 这个 env var 为 repo 根目录 绝对路径:
   export REPO_ROOT=/some/absolute/path/to/aimeeting
   ```

2. **所有 命令 / 文件 引用 都 用 `$REPO_ROOT/...` 形式**:
   - ✅ `python3 $REPO_ROOT/scripts/runner.py --script $REPO_ROOT/docs/kimi-tests/...json`
   - ❌ `python3 scripts/runner.py --script docs/kimi-tests/...json`
   - ❌ `cd /opt/aimeeting && python3 ...` (除非 cd 后 全用 绝对路径)

3. **复述 / 校验 路径 时 也 给 完整 `$REPO_ROOT/...`**:
   - ✅ "result 写到 $REPO_ROOT/docs/kimi-tests/blind-test/results/run-kimi-A-xxx.json"
   - ❌ "result 写到 docs/kimi-tests/blind-test/results/run-kimi-A-xxx.json"

4. **配置 文件 (e.g. demo seed 路径 / runner --script 路径) 默认 用 `$REPO_ROOT` 前缀** — 不要 假设 Kimi `cd $REPO_ROOT` 已 在 cwd.

#### 触发时机 (对 Claude 自己)

- 任何 写 给 Kimi 的 测试用例 → **第一步** 就 在 用例顶部 写 `REPO_ROOT` 定义
- 写 给 PM 喂 Kimi 的 prompt → 同样 用 `$REPO_ROOT/`
- 历史 Kimi 用例 含 相对路径 的 → **路过 顺手 修** (不必专门 sprint, 但 review 阶段 看见 必须 改)

#### 反例 (已 触发 多次 提醒)

- 2026-05-27 双盲 测试 instruction 给 Kimi 写 `python3 scripts/blind-test-runner.py --script docs/kimi-tests/blind-test/scripts/A-grayrelease.json` — PM 第 N 次 提醒 后 sticky 进 宪法.

---

## 9. 演进机制

> NORTH_STAR 不是一次完美, 是逐步演进.

### 9.1 每个 Saga 收尾时反思

PM + Claude 同步问 3 个问题:
1. 这次学到的新约束要不要进 NORTH_STAR? (新"不做"项 / 新价值排序 / 新角色定义)
2. 当前 "不做" 5 条需不需要调整? (例: 某条 override 了多次, 该重写)
3. "三层价值" 排序对吗? (例: 客户反馈说"任务执行"比"长期记忆"更打动他, 该不该调?)

### 9.2 PM 主导"大会师"对齐 (v1.2 新增机制)

> 触发条件: 当 Claude 出现 "半路接手" 误判 (eg Deep Audit 评 35% vs Code Archaeology 校准 90%), 或 PM 觉得 sprint plan 跟心里愿景偏离时, **PM 主导发起"大会师"**.

**机制**:
1. PM **主导问** + Claude **答**, 不是 Claude 列问题让 PM 答 (PM 知道要问什么, 比 Claude 自问更切中要害).
2. Claude 承诺: 不知道说不知道 · 不脑补 · 简洁回答 · 主动暴露认知边界.
3. 对话沉淀 (本文档 v1.x 升级).

**v1.2 这次大会师 (2026-05-27) 关键产出**:
- § 1.4 客户 8 大痛点 (PM 原话精炼)
- § 3 五大能力扩展 NEW-A/B/C/D 4 项
- § 6 当前阶段 改为 MVP Phase A/B/C 路径
- § 7.5 产品设计原则 5 条
- § 9.2 大会师机制本身

### 9.3 升级流程

- 主 Agent 整理"反思清单" → PM 拍板 → 主 Agent 写 vX.X+1 升级.
- 旧版本保留在 git history, NORTH_STAR.md 顶部 "版本" 行更新.
- 每个 minor 升级在第 0 节 TL;DR 加一行 "v1.x 改动".

### 9.4 跟 CLAUDE.md 的接口

- CLAUDE.md "风格守门协议" 下面加一节 "**NORTH_STAR 守门**":
  - 任何 Saga 启动前必读 § 1 + § 1.4 (痛点) + § 6 (Phase 路径) + § 7 + § 7.5 (设计原则)
  - 任何 spec 写完跟 NORTH_STAR 对齐
- CLAUDE.md review checklist 加入 "不做 5 条" + "设计原则 5 条" 检查项.

### 9.5 Claude 系统性误判防护 (v1.2 新增)

> v1.2 前的多次误判 (Phase 1 视觉评 55% 后修复 / Deep Audit 评会议中 35% vs Code Archaeology 90%) 提示需要这些防护:

- **完成度评估不接受 % 数字本身** — 必须 surface 真实源码 evidence (eg "看 backend/app/auto_meeting_orchestrator.py:915 1122 行 prod work")
- **"代码层真接"≠"用户体验层闭环"** — endpoint 真接不等于用户能跑通 user flow
- **Subagent 自评 88-92% 还原度时主 Agent 必须独立 audit** — 不接受自评数字

---

## 10. 附录 · 引用证据

| 章节 | 来源 |
|---|---|
| § 1.1 一句话 | PM Q1 升级版 (2026-05-25 对话) |
| § 1.2 三层价值 | PM Q1 升级版 + `product-needs-v1.md` 主题一-四 |
| § 1.3 同类差异 | `docs/PRODUCT_OVERVIEW.md` § 1.2 反推 |
| **§ 1.4 客户 8 大痛点** | **2026-05-27 PM 大会师对齐 (口述 → 精炼)** |
| § 2.1 AI Agent | PM Q2 + v26.9 数字员工 + m3.0 moderator + v26.5 spec |
| § 2.2 真人 4 角色 | PM Q2 + `v26.5-role-redesign-spec.md` 矩阵 |
| § 3 五大核心能力 | PM Q3 五点 + **v1.2 大会师扩展 NEW-A/B/C/D** |
| § 4 三端 | PM Q7 + `v1.1.0-deploy-guide.md` 小程序原生 + `v27.0-mobile-*` 移动 H5 |
| § 5 SaaS 架构 | PM Q6 + `v26.4 平台超管` + `workspace.preset` 模型 |
| **§ 6 当前阶段 (Phase A/B/C/D)** | **2026-05-27 大会师 + Code Archaeology + Sprint 1-3 ship 历史** |
| § 7 不做 5 条 | PM 多次反馈反推 + `CLAUDE.md` 风格守门协议 |
| **§ 7.5 产品设计原则 5 条** | **2026-05-27 大会师 + 8 痛点提炼** |
| § 8 工作流 | `CLAUDE.md` 现行约定 |
| **§ 9.2 大会师机制 + § 9.5 误判防护** | **2026-05-27 Code Archaeology 校准 + 主 Agent 反思** |

---

## 11. v1.2 升级 changelog (2026-05-27 大会师)

### 升级背景

PM 在 Sprint 3 ship 之后发现:
1. Mobile 会议室核心功能基本未实现 (语音/声纹/AI 语义/答复)
2. Deep Audit subagent 评 "会议中 35% / 加权 41%" 引起警觉
3. Code Archaeology 校准: 真实 "会议中 ~90% / 加权 ~75%" — 老代码大部分已 prod-level
4. PM 担心 "半路接手" 的 Claude 对需求了解不透彻, 主导"大会师"对齐

### 新增内容

1. **§ 1.4 客户 8 大痛点** — PM 原话精炼 (人云亦云 / AI 不持立场 / 沉淀不到位 / AI 像新人 / 多议题串题 / 跑偏 / 临时找不到人 / 任务派出去没人跑)
2. **§ 3 五大能力 NEW-A/B/C/D 扩展**:
   - NEW-A 冲突检测 + 新覆盖老 memory (痛点 4)
   - NEW-B 议题主题一级对象 topic_thread (痛点 5)
   - NEW-C 非会议场景 1-on-1 Mira 对话入口 (痛点 7)
   - NEW-D AI agentic 自主跑任务 (痛点 8)
3. **§ 6 当前阶段** 改为 MVP Phase A/B/C/D 路径 (~19-21d MVP)
4. **§ 7.5 产品设计原则 5 条** (AI 持立场 / 书架 vs 回忆 / 任务溯源 / 新覆盖老 / 议题持续)
5. **§ 9.2 PM 主导"大会师"机制** + **§ 9.5 Claude 系统性误判防护**
6. TL;DR 加 v1.2 改动行 + 8 痛点缩略

### Phase 路径总账

| Phase | 工作 | 估时 | MVP 内? |
|---|---|---|---|
| A | 调优 + UI 打磨 + R5.D mic | ~6.5d | ✓ |
| B | NEW-C + NEW-A 简版 | ~5-6d | ✓ |
| C | NEW-B + NEW-A 完 + PDF + mobile 创建 | ~7-8d | ✓ |
| D | NEW-D + WebRTC + 声纹优化 + WS | ~22d | V1.5 |

**MVP 总 ~19-21d** · PM 3 次内部 review (Phase 间) · 然后给用户内测.

### 误判防护承诺

Claude 承诺 v1.2 起:
- 完成度不接受 % 自评, 必须 surface 真实源码 evidence
- subagent 自评 90% 必须主 Agent 独立 audit
- "代码层真接"和"用户体验层闭环"分开评估
- 出现重大误判时, PM 可发起"大会师" reset

---

> **本文档不动代码**, 是产品宪法. 任何 Saga changelist / spec / commit 跟 NORTH_STAR 冲突, 默认拒绝, 除非 PM 显式 override.
> **反馈渠道**: PM 直接 edit 本文档 + commit 升级版本号 (vX.Y).
> **v1.2 大会师承诺**: Claude 启动任何 Phase A/B/C/D saga 前必读 § 1.4 (8 痛点) + § 6 (Phase 路径) + § 7.5 (设计原则).
