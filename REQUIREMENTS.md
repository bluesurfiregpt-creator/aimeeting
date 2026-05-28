# REQUIREMENTS.md — 产品 需求 交接 (Claude → Codex)

> **写于**: 2026-05-28
> **truth source**: `/Users/bluesurfire/Documents/claude/aimeeting/docs/NORTH_STAR.md` v1.2.4 (813 行, 产品宪法), 跟代码不一致时 **以 NORTH_STAR 为准**.
> 本文档是 NORTH_STAR 的 摘要 + Codex 行动导向版.

---

## 1. 产品 一句话 定位

> **面向中国政企的 AI Agent 协作会议工作台. AI 专家有长期记忆, 会议结论沉淀回知识库, AI 协助完成会后任务.**

不是会议录音工具, 是有 "组织决策记忆 + AI 任务执行" 闭环的 SaaS 系统.

---

## 2. 目标 用户

### 2.1 终端 用户 (人)
- **中国 政企 中层** — 政府机关 / 国企 / 大型私企 中层管理 (科长 / 局长 / 总监级)
- 典型场景: **福田 区政府 智慧住建局** (示例 demo workspace 模型)
- 年龄 30-50, 桌面 + 移动 都用, 但 桌面 主战场 (会议主持人 / 业务专家 / 数据分析师)
- 现状 痛点: 开会 一两个人发言其他人陪坐 / AI 顺着发言人不持立场 / 开完不了了之

### 2.2 角色 4+1 (NORTH_STAR § 2.2, PM v1.3.1 拍板)

| 角色 | 中文 | 能干啥 | 不能干啥 |
|------|------|--------|---------|
| `system_owner` | 平台超管 | 跨 ws 视图 + 切换 + 代客建空间 | env 白名单, 不入 membership 表 |
| `workspace_creator` | ws 创建人 | ws 内 最高权限, 改 AI/KB/memory | 跨 ws 操作 |
| `leader` | 领导 (e.g. 局长) | 改 AI/KB/memory + 邀请成员 + 发起 auto 会议 + 撤销 superseded | 跨 ws |
| `admin` | 科长 | 管科室人员 + 发起 auto 会议 + 撤销 superseded | 改 AI/KB/memory (PM Q7.4 锁) |
| `agent_owner` | AI 主人 | 改 自己 AI 的 KB/memory | 别人 AI |
| `member` | 普通员工 | 仅 查看 + 发起会议 | 编辑 AI/KB/memory + 撤销 / 跨 ws |

### 2.3 AI Agent (虚拟实体, 不是 真人用户)
- 10 个 英文品牌 (demo_seed_v2): Mira (主持人) / Aria (UX) / Stratos (架构) / Sage (数据) / Lex (法务) / Scout (竞品) / Falao (仲裁) / Shu (KPI) / Zhaojie (客户) / Tally (财务)
- 16 个 中文 智慧住建 agent (demo_seed): 综合事务/物业监管/项目管理/...

---

## 3. 核心 使用 场景

### 3.1 主场景 (痛点 1, 6 cover)
**多 AI 圆桌 协作开会**:
- 用户 (leader/admin) 创建 mode=`auto` 会议, 拟议程 + 选 AI 阵容
- AI 主持人 Mira 串场, N 个 AI 专家 各自从 KB 角度 发言
- 多轮 turn (每议程 max 6 turn), 自动 进 下一议程
- AI 检测 偏题/超时 → 拉回 (agenda_monitor + dissent_detector)
- 议程完 → 共识 + 分歧 落 DB → 反向 沉淀回 AI KB

### 3.2 副场景 1 — Hybrid (痛点 2 cover)
**真人 + AI 混合 会议**:
- 用户 mic 说话 → ASR + 声纹 → transcript
- 用户 @ 提 AI 或 系统 自动 推荐 → AI 接力 发言, 持立场, 不和稀泥
- 议程 完 → summary 按发言人分立场 + 任务溯源 chip

### 3.3 副场景 2 — 1-on-1 跟 Mira (痛点 7 cover, NEW-C)
**非会议场景 临时问问题**:
- 用户 在 mobile `/m/chat/<mira_id>` 跟 Mira 私聊
- Mira 答 不了 推荐 AI 专家
- SSE 流式, sessionStorage 持久

### 3.4 副场景 3 — 议题 跨会议 (痛点 5 cover, NEW-B)
**议题主题 一级对象**:
- 创 议题 (e.g. "电梯改造决策线")
- 关联 多场 meeting (1 meeting 1 topic, 二期 升 N:N)
- 议题线 时间线 UI 看 1 个月 议题 演进

### 3.5 副场景 4 — 任务 跑 + 沉淀 (痛点 3, 8 cover)
**会后任务 跟踪**:
- summary_generator 抽 ActionItem + evidence_quote (源于哪句transcript)
- 任务派 真人 或 AI
- 完成 时 (PM v25 hits=N 校 触发) → consolidator 沉淀 回 AI KB

---

## 4. 当前 版本 必须 完成 的 P0 功能

> 来源: NORTH_STAR § 6 (Phase A + B + C 全 完 = MVP)

### 4.1 ✅ 已 ship 的 P0 (按 codebase 实证, 不是 spec)
- **Phase A** 1-7 + 后置 + 双盲 (会议跑顺 + 立场守门 + 任务溯源 + Web 接 mic)
- **Phase B · 8 NEW-C**: Mobile `/m/chat/[id]` 1-on-1 Mira chat
- **Phase B · 9 NEW-A 简版**: backend conflict_detector 自动 标 superseded
- **Phase C · 13**: Mira NLU 真 LLM (替 mock 1.1s sleep) + AI path 创会 真 落库
- **Phase C · 11 NEW-A 完整版**: 撤销 endpoint + chain drawer (drawer 渲染 等数据)
- **Phase C · 10 NEW-B**: Topic 一级对象 + 议题线 UI
- **Phase C · 12**: 文件 chapter LLM 抽 + Mobile FilePreview 3 tab
- **会议室 Dark mode** (§ 7.1.1 例外)
- **Sprint S1**: `/workstation` 心智一览 真接 (4 个 count + me name)

### 4.2 ⏸ 还没 完成 但 PM 已 启动 的 P0 (Sprint S2-S5)
- **S2 `/workstation/agent/[id]` 真接** — 痛点 4 核心展示页, 当前 1805 行 hardcoded W_PROFILES (~1d)
- **S3 会议室右栏 真接** — `MR_DECISIONS/MR_ACTIONS/MR_PARKING` 接 `api.listMeetingConsensus + listActionItems` (~1d)
- **S4 `/workstation/admin` + `/workstation/profile` 真接** (~0.5d)
- **S5 `/workstation/browse` + `/workstation/tpl` 真接** (~1d)

### 4.3 ⚠️ 验收 不全 的 P0
- **NEW-A 完整版 drawer** — 代码 ship, 但 测试 数据 被 Kimi probe 销毁, 当前 DB 0 行 superseded. 需 PM 在 测试 meeting 注入 conflict 重灌
- **NEW-B 议题** — 真接 GREEN, 但 **会议详情页 没显示 topic 关联 + 创会 modal 没 topic 选择**. 客户进不去这个功能
- **Phase C · 12 文件预览** — 代码 ship, 但 demo workspace 没真 PDF 测过, Kimi 没验

---

## 5. P1 / P2 功能

### 5.1 P1 (V1.0 收尾 前 完成)
- **TTFC 8-12s 优化** (NORTH_STAR Round 1 中优, 1-2d backend LLM 调用链 排查)
- **NEW-B 议题 集成 到 会议详情页 + 创会 modal** (0.5d, 客户能用上 议题 功能)
- **NEW-A 测试数据 重灌** (10min PM 手工 触发 conflict)
- **Mobile superseded 渲染** (0.5d, 一致性)

### 5.2 P2 (V1.5)
- **NEW-D AI agentic 自主跑任务** (5-7d 高风险, NORTH_STAR § 1.4 痛点 8)
- **WebRTC + 摄像头 + 举手** (6d 高风险)
- **WebSocket 替换 2.5s 轮询** (3d, 性能优化 P95 5-17s → <500ms)
- **声纹 streaming + 跨端 push** (8d)
- **Web FilePreview** (1d 二期, 当前 仅 Mobile)
- **KB document 章节抽** (1d 二期, 复用 MeetingAttachment 同 pattern)

---

## 6. 每个 核心 页面 的 职责

### 6.1 Web (`/Users/bluesurfire/Documents/claude/aimeeting/frontend/src/app/`)

| 路由 | 职责 | 当前 状态 |
|------|------|---------|
| `/` | 首页, 工作站入口 | 真接 W_THEME |
| `/login` | 登录 | 真接 |
| `/workstation` | **心智一览** — 4 个大数字 (AI / KB / Memory / Meeting) + sankey 全景图 | S1 已 真接 (count + me name 真) |
| `/workstation/board` | 任务 kanban | 真接 + fallback (缺 演示数据 pill) |
| `/workstation/agents` | AI 专家 列表 | 真接 + fallback + 演示数据 pill |
| `/workstation/agent/[id]` | **AI 专家 详情** (痛点 4 核心) — radar + KB + memory + 出席 | **全 mock W_PROFILES, S2 待做** |
| `/workstation/browse` | AI 市场 (订阅) | **全 mock, S5 待做** |
| `/workstation/tpl` | AI 模板生成器 | **全 mock 明确标 pill, S5 待做** |
| `/workstation/meeting` | 会议历史 列表 | 真接 + fallback |
| `/workstation/meeting/[id]` | 会议 详情 (6 tabs: overview/captions/decisions/actions/materials/citations) | 真接 + fallback |
| `/workstation/new` | 创会 | 真接 (提交), 但 attendee/agent picker UI 仍 简化 |
| `/workstation/history` | 同 /meeting (列表) | 真接 + fallback |
| `/workstation/tasks` | 我的 任务 | 真接 + fallback |
| `/workstation/profile` | 身份信息 | **全 mock W_USER, S4 待做** |
| `/workstation/kb` | 书架 (KB 列表) | 真接 + fallback |
| `/workstation/memory` | 长期记忆 (经验) | 真接 + fallback |
| `/workstation/approve` | 待审批 中心 | 真接 + mutation (approve/reject) |
| `/workstation/admin` | 平台超管 | **全 mock 8 行 WS_WORKSPACES, S4 待做** |
| `/workstation/topics` | 议题主题 列表 | 真接 (新加) |
| `/workstation/topics/[id]` | 议题线 时间线 | 真接 (新加) |
| `/workstation/graph` | 桑基血缘图 (LineagePane) | 混合 |
| `/meeting/[id]/live` | **Web 会议室 live** (transcript + ASR + 双 theme) | transcript / ASR / 打字 真接, **右栏 3 段 mock, S3 待做** |

### 6.2 Mobile (`/Users/bluesurfire/Documents/claude/aimeeting/frontend/src/app/m/`)

| 路由 | 职责 | 当前 状态 |
|------|------|---------|
| `/m` | Today (4 模块) | 真接 (8 endpoint Promise.all) |
| `/m/meetings` | 会议 列表 + 周脉冲 | 真接 |
| `/m/meetings/new` | 创会 (AI 描述 / 自定义) | AI tab 真接 (Mira NLU + POST /api/meetings), Custom tab mock |
| `/m/meetings/[id]` | 移动 会议室 | 真接 transcript + WS event |
| `/m/meetings/[id]/summary` | 纪要 | 真接 |
| `/m/tasks` | 任务 + 详情 | 真接 |
| `/m/insights` | Memory Radar (6 轴) | 真接 |
| `/m/me` | 个人 + 声纹管理 | 真接 |
| `/m/notifications` | 通知 中心 | 真接 |
| `/m/chat/[id]` | **1-on-1 chat** (NEW-C) | 真接 SSE 流式 |
| `/m/agents/[id]` | AI 卡 详情 | 真接 |

---

## 7. 用户 完整 流程

### 7.1 主流程 — 全 AI 自主开会 (mode=`auto`)

```
1. 用户 leader/admin 在 web /workstation/new 点 "新建会议"
   → 输入 title + agenda (≥2 项) + 选 AI ≥ 3 → POST /api/meetings (mode=auto)

2. 进 /meeting/<id>/live (Web R5.D)
   → 看 三栏布局 (Left 议程 / Center transcript / Right Mira 决策池+行动项)

3. 召集人 点 "开始" 启动 auto orchestrator
   → backend auto_meeting_orchestrator 跑:
     · 状态机 idle → running → finished
     · agenda 1: Mira intro → expert N 轮 turn → 共识 + 分歧 落 consensus 表
     · agenda 2: ... (max 6 turn per agenda)
     · 议程跑完 + 45 分钟 硬上限 (paused 不算)

4. 跑 过程 中 (每 2.5s frontend 轮询):
   · transcript 更新 (含 reply_to_agent_message + agenda_idx)
   · 立场冲突 时 conflict_detector LLM judge 自动 标 旧 message status='superseded'
   · 真人 用户 可 @ 召唤新 AI 进来 或 中途 切 paused

5. 议程 跑完 / 召集人 手动 结束:
   → action_extractor 抽 ActionItem + evidence_quote
   → summary_generator 生 总结 (按发言人分立场)
   → 触发 task 派 (member 真人 或 AI agent)

6. 用户 跳 /workstation/meeting/<id> 看 6 tab 详情
   → tasks 显 链接 (含 来源 transcript 行号 chip)
   → 后续 完成 任务 → task_consolidator 沉淀 回 AI KB
```

### 7.2 副流程 1 — Hybrid 会议

```
1. 创会 mode=hybrid → 进 /meeting/<id>/live
2. 召集人 麦克风 (WS STT) + 声纹识别 → transcript
3. 系统 自动检测 (agent_router 5 维 / dissent_detector LLM)
   → 推荐 AI banner: "邀请 Lex 来 看 法务?"
4. 用户 点 yes → AI Lex 发言 (持 KB 立场) → 加入 transcript
5. 议程 完 → summary + actions (同上)
```

### 7.3 副流程 2 — 1-on-1 跟 Mira (NEW-C)

```
1. 用户 在 mobile `/m/agents/<mira_id>` 或 `/m/me` 点 "跟 Mira 聊聊"
2. 进 `/m/chat/<mira_id>`
3. 输入问题 → POST /api/agents/<id>/chat (SSE)
4. Mira 流式 答 (~3-15s TTFC, 当前 backend 问题 留 优化)
5. 历史 存 sessionStorage:`aimeeting:m-chat:<agent_id>` (关 tab 即清, 不上 DB)
```

### 7.4 副流程 3 — 议题 跨会议 (NEW-B)

```
1. leader 在 /workstation/topics 创 议题 "电梯改造决策线"
2. 进 /workstation/topics/<id> 看议题线 (空)
3. 后续 开 多场会议 → 在会议详情 (待做!) 选 "关联议题"
   或 走 API POST /api/meetings/<mid>/topic
4. 议题线 自动 排 (started_at desc) 显 N 场会议
5. 1 个月后 一眼看 议题脉络
```

---

## 8. 关键 业务 规则

### 8.1 立场守门 (痛点 2 核心)
- `agent_router.py` system_prompt 强 "不和稀泥, 明确反对时 直说"
- LLM judge proactive (`dissent_detector.py`) 检测 对立 → 推荐 仲裁 AI
- `conflict_detector.py` 检测 新发言 推翻 旧发言 → 自动 标 旧 `status='superseded'` + `superseded_by_message_id`

### 8.2 反幻觉 (NORTH_STAR § 7.5)
- Mock 数据 必须 加 "演示数据 · ..." pill, 不让 用户 把 mock 当真
- 反例: `/workstation/board` 真接 + fallback 但 没显 pill → 待修
- 任务 必须 含 `evidence_quote` (来源 transcript) + `evidence_anchor_line_ids` (点击 跳实录高亮)

### 8.3 记忆 vs 知识库 (痛点 4)
- **KB (书架)**: `KnowledgeBase` + `KnowledgeDocument` + `KnowledgeChunk`. **人工 上传, 主动 引用**
- **Memory (回忆)**: `LongTermMemory`. **AI 沉淀, 跨 会议 自动 调用**. **新覆盖老冲突** (NEW-A 简版 已 ship)

### 8.4 数据 5 级 ABAC
- `data_classification` ∈ {public, general, sensitive, restricted, secret} (5 级)
- 跨 AI 引用 时 校 caller 权限 vs 文档级别
- 见 `auth.py` ABAC helper + `audit.py` 审计

### 8.5 多租户 隔离
- 所有 表 含 `workspace_id` (NOT NULL or ON DELETE CASCADE)
- 所有 endpoint 强 `auth.workspace.id` filter
- 跨 ws 数据 严禁 (`workspace_id` 不匹配 直接 403/404)

### 8.6 时间窗 限制
- Auto meeting 单场 ≤ 45 分钟 (paused 不算)
- 每议程 ≤ 6 turn
- TTFC SSE 目标 ≤ 3s (当前 8-12s, P1 待优化)

---

## 9. 关键 交互 规则

### 9.1 Web 三端 token 隔离 (DESIGN_SYSTEM § 0.3)
- **Workstation 走 W_TOKENS** (双 theme dark default + light, `/Users/bluesurfire/Documents/claude/aimeeting/frontend/src/components/web/tokens.ts`)
- **会议室走 MR_TOKENS** (双 theme light default + dark, § 7.1.1, `/Users/bluesurfire/Documents/claude/aimeeting/frontend/src/components/web/meeting-room/tokens.ts`)
- **Mobile 走 MR_COLORS** (单 theme 浅色 iOS, `/Users/bluesurfire/Documents/claude/aimeeting/frontend/src/components/mobile/meeting-room/styles.ts`)
- 跨 token 严禁 (e.g. mobile 不准 import W_TOKENS)

### 9.2 Web vs Mobile 角色
- **Web** = 全功能 (含 编辑 AI / KB / memory / workspace)
- **Mobile** = 仅 查看 + 发起会议 + 跟 AI 聊 (NEW-C)
- **小程序原生** = 浅色化 done, 编辑功能 PM 永不做 (§ 7.3)

### 9.3 Auth flow
- JWT cookie (`aimeeting_session`, httpOnly + secure on https)
- 登录 → POST /api/auth/login → set cookie + 返 user info
- 后续 endpoint 走 `Depends(get_current_auth)` (cookie 解析 → AuthContext)

---

## 10. 数据 结构 / 主要 实体

> 见 `/Users/bluesurfire/Documents/claude/aimeeting/backend/app/models.py` 完整定义. 这里列 Codex 改 业务 时 必看 的 20 个核心表.

| 表 | 关键 字段 | 说明 |
|----|---------|------|
| `workspace` | id, name, preset (JSON: kind=smart_construction 等), created_at | SaaS 租户 |
| `user` | id, email, name, role, phone, workspace_id, wx_openid | 真人用户 |
| `workspace_membership` | user_id, workspace_id, role (workspace_creator/leader/admin/agent_owner/member) | 真人 ↔ ws |
| `agent` | id, workspace_id, name, domain, persona, role (moderator/expert), keywords, knowledge_base_ids (UUID[]) | AI Agent |
| `knowledge_base` | id, workspace_id, name, owner_agent_id | KB |
| `knowledge_document` | id, kb_id, filename, mime, status (pending/ready/...), data_classification (5 级) | KB 文档 |
| `knowledge_chunk` | id, document_id, kb_id, chunk_index, content, embedding (Vector 1536) | KB chunk |
| `meeting` | id, workspace_id, title, status (scheduled/ongoing/finished/processed), mode (human/hybrid/auto), agenda (JSON), auto_state, topic_id (NEW-B) | 会议 |
| `meeting_attendee` | meeting_id, user_id, agent_id | 参会 |
| `meeting_agent_message` | id (BigInt), meeting_id, agent_id, text, trigger (manual/at_mention/keyword/auto_orchestrator), reply_to_agent_message_id, agenda_idx, **status (active/superseded), superseded_by_message_id** (NEW-A 简版) | AI 发言 |
| `meeting_transcript` | id (BigInt), meeting_id, speaker_user_id, speaker_label, text, start_ms | ASR 真人句 |
| `meeting_attachment` | id, meeting_id, filename, extract_status, extract_text, extract_summary, **chapter_summaries (JSON, NEW-C12)** | 会议 附件 |
| `meeting_consensus` | id, meeting_id, agenda_idx, consensus_md, dissents (JSON), needs_human_review | auto 议程 共识/分歧 |
| `meeting_action_item` | id, meeting_id, task_id, evidence_quote, evidence_anchor_line_ids | 议程 抽出 行动项 |
| `task` | id, meeting_id, title, status (open/in_progress/done/.../archived), assigned_user_id, assigned_agent_id | 任务 |
| `ai_insight` | id, meeting_id, agent_id, kind, content, worth_remembering, human_decision (NULL/pending/accepted/rejected) | AI 抽 insight |
| `long_term_memory` | id, workspace_id, agent_id, text, axis_tag (6 轴), source_line_ids | AI 沉淀 |
| `memory_draft` | id, workspace_id, source_line_ids, rejection_kind, rejection_feedback | 沉淀 草稿 |
| **`topic`** | id, workspace_id, name, description, status (active/archived) | **NEW-B 议题 一级对象** |
| `voiceprint` | id, workspace_id, user_id, ref_audio_url, embedding | 声纹 |
| `model_provider_config` | id, workspace_id, provider (qwen/openai/deepseek), model_id, api_key, is_active | LLM provider |
| `system_audit_log` | id, workspace_id, action, target_type, target_id, payload, user_id | 审计 |

---

## 11. 权限 / 角色 规则 (NORTH_STAR § 2.2 PM Q7.4)

| 操作 | 谁可以 | guard |
|------|-------|-------|
| 查 (list) | 所有 ws 成员 | `get_current_auth` |
| 创 会议 | 所有 ws 成员 | 同上 |
| 撤销 superseded | leader / admin / workspace_creator / system_owner | `is_leader_or_admin` |
| 改 AI / KB / memory | workspace_creator / leader (+ agent_owner 改 自己 AI) | `is_workspace_manager` |
| 邀请 成员 / 看团队 | leader / admin / workspace_creator | `is_workspace_admin_or_above` |
| 跨 workspace 切换 | system_owner (env 白名单) | `is_platform_admin` |
| 删 attachment (未挂会议) | uploader 或 leader+ | uploader_user_id 校 |

---

## 12. AI 功能 预期 行为

### 12.1 Mira (主持人 moderator)
- 串场 (auto 模式 intro + wrap_up)
- 答用户问 (1-on-1 chat NEW-C)
- 答不出 推荐 AI 专家
- 不 keyword 召唤, 只 @ 或 orchestrator recommend

### 12.2 Expert (Aria / Stratos / Lex 等)
- 5 维 routing (语义 + KB + 历史 + 负载 + 可用性) 召唤
- 持 KB 角度 发言, 不和稀泥
- 引用 KB 时 含 citations (chunk_id, doc filename, distance)
- 立场对立 后续发言 自动 标 superseded (NEW-A 简版)

### 12.3 系统 LLM judge (3 路)
- `agenda_monitor` 检测 偏题 / 超时 / 僵局 → 拉回 prompt
- `dissent_detector` 检测 对立 立场 → 推荐 仲裁 AI banner
- `conflict_detector` 检测 推翻 旧立场 → 自动 标 superseded

### 12.4 反幻觉 LLM judge
- summary_generator temperature=0 + evidence anchor
- insight_extractor 必含 source_line_ids
- 任务 含 evidence_quote + 点击 跳实录

---

## 13. 哪些 行为 明确 不要做 (NORTH_STAR § 7)

1. **不做 dark mode** (主流程 全 浅色) — 例外 § 7.1.1 会议室 双 theme
2. **不硬编码 客户专属 逻辑** — 福田 / 智慧住建 是 workspace 实例, 不是 代码分支
3. **不在小程序 / Mobile 做 编辑功能** — 编辑 AI / KB / memory 必须 走 Web
4. **不一次性 大改** — 拆 Saga, 每 saga 独立 ship + 独立 Kimi 验
5. **不让 mock 数据 假装 真实** — mock 必加 "演示数据" pill (NORTH_STAR § 7.5)
6. **中文表达 4 条** (§ 8.8 PM sticky):
   - 中文之间 不加 空格
   - 只用 常用字 (不 用 罕字)
   - AskUserQuestion 写完 自查
   - commit message 也别 罕字
7. **Kimi 测试 路径 必 用 `$REPO_ROOT/...` 绝对路径** (§ 8.6 PM sticky)

---

## 14. 验收 标准

### 14.1 Per-saga 验收
- 每 saga 完 必出 Kimi 测试用例 (`docs/kimi-tests/<version>-kimi.md`)
- 顶部 6 条反幻觉死规矩 + 唯一账号表 + REPO_ROOT
- T-01 ~ T-N 每用例 4 段 (实际看到 / 判定 / 失败理由 / 证据)
- backend AI 行为 走 双盲测试 (§ 8.7, Claude + Kimi 客观 metric 对账 GREEN)

### 14.2 当前 版本 (MVP 内测) 验收
- ✅ Web 默认 landing (`/workstation`) 不再 一眼 mock — S1 已 fix
- ⏸ Web AI 详情页 真接 — S2 待做
- ⏸ Web 会议室右栏 真接 — S3 待做
- ⏸ Web admin / profile 真接 — S4 待做
- ✅ Mobile 全功能真接 (已 done, 12/14 真接)
- ✅ 5 个 Kimi 用例 跑过 (Phase B 8/9 + Phase C 10/11/13)
- ⏸ Phase C · 12 文件 Kimi 验 (需 真 PDF)

### 14.3 P0 真正 完成 标志
**PM 自己 / Demo 客户 真 走 一遍 主流程, 一眼 看不出 mock**:
1. 登录 → /workstation 看 真 count
2. 点 AI 卡 → /workstation/agent/<id> 看 真 KB / memory / 出席
3. 创会 → 进 /meeting/<id>/live → 三栏 都 真 (含 右栏)
4. AI 圆桌 真 跑 → 看 真 transcript + 立场守门
5. 议程完 → 看 真 summary + 任务 (含 evidence)
6. 跳 议题 → 看 真 议题线

---

## 15. 需求 里 还 不确定 的 问题

### 15.1 待 PM 拍 (代码 不动, 等 PM 决策)
1. **NEW-B many-to-many** 何时 升 — 当前 MVP 1 meeting 1 topic, 客户 真用上 后 看 是否 需要 N:N
2. **TTFC 8-12s 优化** 走哪条路 — backend prompt 大 / 模型 切换 (deepseek-v4-pro 切回 qwen) / first-token streaming 优化, PM 没 拍 方向
3. **小程序原生 NEW-C 1-on-1 chat** 要不要做 — 当前 仅 H5 mobile 接, 小程序 没接, § 7.3 不做 编辑 但 chat 算 "看", 待 PM 拍
4. **`/workstation/browse` 订阅 行为** — 当前 全 mock, 真接 后 "订阅 AI" 是 加 ws membership 还是 加 favorite 收藏? 没 数据模型
5. **Phase D 何时 开始** — PM 反馈 后 排

### 15.2 已知 设计 vs 代码 不一致
- DESIGN_SYSTEM § 0 "两套设计的根本差异" 已 标 — bundle 设计 跟 现状 在 视觉/AI区分/Mira 视觉 上 有 7 处冲突, **现状 部分 落地, 部分 仍 老 风格**. 不是 bug 是 设计 演进中
- NORTH_STAR § 7.5 反幻觉 — 部分 mock 页 (`/workstation/board`) 没 "演示数据" pill, 不一致, 待修
- NORTH_STAR § 1.4 痛点 4 "新覆盖老冲突记忆" — 当前 NEW-A 简版 只针对 同议程 AI 发言, **跨议程 / 跨会议 冲突 没做** (memory 层面 vs message 层面). PM 说 "新覆盖老 memory" 是 memory 层面, 当前 只做了 message 层面 简化
- `/Users/bluesurfire/Documents/claude/aimeeting/wechat-miniprogram/` 小程序 浅色化 ship 但 Phase B/C 新功能 (NEW-A/B/C) 都 没 mobile 端 (除 NEW-C `/m/chat`), 也 没 小程序端
