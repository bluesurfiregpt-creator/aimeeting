# Saga E · AI 五大能力 拆细 changelist

> **生成时间**: 2026-05-26
> **来源**: NORTH_STAR § 3 (产品宪法 五大能力) + PRODUCT_OVERVIEW § 4 (35+ 未实现项) + v1.3.1 权限对齐 audit + round-6 设计稿 (LineagePane / 心智一览 / MentalLiveSection)
> **状态**: 待 PM 拍板 5 个子 Saga 启动顺序
> **本文档不动代码** — 只是把 Saga E (PRODUCT_OVERVIEW § 8.2 估算 60-100h) 拆成 5 个对应 NORTH_STAR § 3 的子 Saga, 每个独立可 ship 可 Kimi 验收

---

## 0. TL;DR (一页扫读)

1. NORTH_STAR § 3 定义 **AI 5 大能力 = 产品灵魂**: 记忆 (3.1) / 知识 (3.2) / 数据 (3.3) / 任务 (3.4) / 会议表现 (3.5). 不增强这 5 项的 Saga 优先级一律排后.
2. 当前 PRODUCT_OVERVIEW § 8.2 把 Saga E 等同于"AI 圆桌真协同 + PDF 预览 + 真人 attendee"3 个旗舰功能 (~30h). 这只是 **3.5 会议表现** 的一部分, 剩下 4 项能力大量 mock / 半成品没拆细.
3. 本文档拆出 **5 个子 Saga**: E.A 长期记忆 / E.B 知识沉淀 / E.C 数据沉淀 / E.D 任务执行 / E.E 会议表现优化, 一一对齐 NORTH_STAR § 3.1-3.5.
4. **推荐启动顺序 = E.E → E.A → E.B → E.D → E.C** (理由见 § 7), 总工作量 ~125-160h, 8-10 周一个人推, 4-5 周两个人并行.
5. **协同**: E.E 跟 R5.B/C/D Web 会议室集成有冲突 (R5.D 还没启动, E.E 先做不影响); E.A/E.B 跟 R6.0 LineagePane 强协同 (E.A 后端补"出处链回"接口 + E.B 补"KB 引用侧栏" 直接喂 LineagePane); E.D 跟 Saga I (移动 leader IA) 重叠 (任务详情跨端); E.C 跟 Saga G (运营层) 弱协同 (用量计费).
6. PM 待对齐 7 个关键决策: (a) 启动顺序; (b) 向量数据库选型 (现 pgvector 1536d 继续 vs 切独立向量库); (c) WebSocket 是否真做; (d) "AI 圆桌真协同" 后端架构选型 (multi-agent debate vs 顺序轮发); (e) 任务执行 push 是 polling 优化还是真做 WS push; (f) OCR 升级值不值; (g) "AI 心智一览" 跨端语义 (mobile 雷达 vs web 桑基).

---

## 1. AI 五大能力概览 (NORTH_STAR § 3 引用)

### 1.1 五大能力一览表 (truth source = NORTH_STAR § 3)

| # | 能力 | NORTH_STAR § | 现状 | 目标 (NORTH_STAR 原文) | 子 Saga |
|---|---|---|---|---|---|
| 1 | **长期记忆 (Memory)** | § 3.1 | 三层金字塔 (快照 → 待审 → 记忆库) + pgvector 1536d + Memory↔Agent 多对多 (memory_agent_link) v26.5-Lineage GA | "出处链回 + 跳回原文 + 高亮 3 秒 + 记忆库反悔删除 + 跨会议自动调用 (AI 发言时引用过往记忆 + 一键跳查证)" | **E.A** |
| 2 | **知识沉淀 (Knowledge)** | § 3.2 | KB 文档 (PDF/Word/Excel/PPT/图片 OCR) + chunk + embedding + 任务办结自动沉淀 4 段闭环 v26.2 GA | "KB 引用侧栏 (citations 在库 UI 没做) + OCR 准确度提升 (扫描件/手写体) + 公文智能审核扩到通用" | **E.B** |
| 3 | **数据沉淀方案 (Data)** | § 3.3 | 5 级分级 + 跨 AI 申请 + 操作 audit v24.0 + 桑基血缘图 v26.5-Lineage-P2 + AI 数据中心 | "真实 PDF/PPT/Excel 预览 (现 mock) + chapter/highlights 自动提取 (现 mock) + 数据导出 + 第三方系统对接 SOP" | **E.C** |
| 4 | **任务执行 (Task Execution)** | § 3.4 | Task 一级对象 + 8 态 + 4 维派发 + 多 AI 协作 + 月度评价 v17-v23 + agent-centric v26.0 | "expert/manager 角色专属 UX (我跟我的 AI 协作 page 现没做) + 任务办结审批流体验打磨 + 跨端任务通知 push (现 polling)" | **E.D** |
| 5 | **会议表现 (Meeting Performance)** | § 3.5 | AI routing 5 维 + agenda_monitor + 反幻觉纪要 + 召集人 auto v26.3 | "**AI 圆桌真协同 (最高优, 当前永久 1 张 mock)** + WebSocket 实时推送 (现 2.5s 轮询) + 字幕/摄像头/举手 真实硬件 + 跳过议程 / 改判 / per-meeting max_total_seconds" | **E.E** |

### 1.2 NORTH_STAR § 3.5 的"最高优"标记

NORTH_STAR § 3.5 原文写明: "AI 圆桌真协同 — 当前 RoundMessage 永久 1 张固定 mock (TD2 PM 决策). 这是 PM 旗舰功能, 必须真做." 这是整个 Saga E 的最大单项, 也是 PRODUCT_OVERVIEW § 4.2 表第 1 行 🔥 高 优先级.

### 1.3 PRODUCT_OVERVIEW § 8.2 已立 Saga E 是窄定义

PRODUCT_OVERVIEW § 8.2 的 Saga E 只拆 3 项 (~30h):
- E.1 AI 圆桌真协同 (~15-20h) — 本文 § 6 E.E
- E.2 真实 PDF/PPT/Excel 预览 (~8h) — 本文 § 5 E.C
- E.3 真人 attendee API + 头像 stack (~6h) — 本文 § 6 E.E 收口 (轻量, 6h, 不单独拆)

剩下 4 项能力 (NORTH_STAR § 3.1-3.4) 在 § 8.2 没拆, 散落在 Saga F (知识闭环, § 3.1+3.2 部分) + Saga H (UX 收口, § 3.4 部分). 本文档把 Saga F + 部分 Saga H 重新合并到 Saga E 子级, 因为 NORTH_STAR § 3 把这 5 项视作一体的"产品灵魂".

---

## 2. 子 Saga E.A · AI 长期记忆

> NORTH_STAR § 3.1: "出处链回 + 跳回原文 + 高亮 3 秒 + 记忆库反悔删除 + 跨会议自动调用"

### 2.1 Scope

**目标**: 让 AI 真正"记得住, 用得上, 反得了悔". 当前三层金字塔已落, 但 6 个体验断点没补.

#### 后端
- **R-A1** `long_term_memory.source_line_ids` 已有字段 (v26.14-P7.3), 但**老数据 NULL**. 写 backfill job (从 source_meeting_id + memory_extractor 重跑) 补老数据.
- **R-A2** 新接口 `GET /api/memory/{id}/source-context` 返回 `{ meeting_id, transcript_lines: [{ id, t, speaker, text, highlight }] }`, 让前端跳回原文 + 高亮.
- **R-A3** memory 删除 endpoint 已有 (`DELETE /api/memory/{id}` memory.py:256), 但**审过入库的 LongTermMemory 没"反悔"用例** — 加 `POST /api/memory/{id}/revoke` (软删 + audit log + 提示 "可在 30 天内 undo").
- **R-A4** 跨会议自动调用 — `memory_retrieval.py` 已有, 但**发言时是否调用 + 调用哪些 memory** 当前不透明. 加 `meeting_agent_message.cited_memory_ids: list[uuid]` 字段, 让 AI 发言时同时返回 "我引用了这些记忆", 前端可点跳查证.
- **R-A5** memory_draft 拒绝反馈累积 — 当前 `MemoryDraft.rejection_feedback` 字段已有 (v26.14-P7.4), **没接入 LLM negative example**. memory_extractor.py 加 prompt: "以下是近 N 条被驳回的候选记忆 + 用户反馈, 不要再这样抽取..."

#### 前端 (Web 端独占编辑)
- **F-A1** `/workstation` MemoryPane (`web-workstation.jsx:741` 已有设计) — 但当前是 mock, 接真接口 (`GET /api/memory?workspace_id=...&page=...`), 加 6 项: scope 筛 / 归属 AI 筛 / scope_ref 搜 / 入库时间排序 / **"反悔" 按钮** (调 R-A3) / **行点击展开 source-context 抽屉** (调 R-A2).
- **F-A2** `/workstation` LineagePane Memory 节点详情 (`web-lineage-v2.jsx:1029-1110` 已有 "打开长期记忆库" + "沉淀来源" 区块) — 接 R-A2 让 "沉淀来源" 区显示 transcript_lines + 跳回原文 + 高亮 3 秒.
- **F-A3** 会议室 (Web 端 R5.D, **尚未实施**) — AI 发言气泡显示 "引用了 N 条记忆" chip, 点开侧栏看 memory 文本 + 跳查证.
- **F-A4** memory_drafts 审批页 (现 `/me/profile/memory` 一类) — 拒绝时弹"原因 + 反馈给 LLM" textarea, 写入 `MemoryDraft.rejection_feedback`.

#### 数据
- `long_term_memory.source_line_ids` backfill 脚本 (一次性 job)
- `meeting_agent_message` 新增 `cited_memory_ids` JSON 列 + 索引
- `audit_log` 新增 entry type `memory.revoke`

### 2.2 Backend 改动

| 类型 | 文件 | 改动 |
|---|---|---|
| 新接口 | `routers/memory.py` | `GET /api/memory/{id}/source-context` (R-A2), `POST /api/memory/{id}/revoke` (R-A3) |
| 字段扩 | `models.py MeetingAgentMessage` | `cited_memory_ids: list[uuid]` (R-A4) |
| 新接口 | `routers/meetings.py` | `GET /api/meetings/{id}/agent-messages` 返回值附 `cited_memory_ids` + (展开后) memory 文本 snippet |
| Backfill | `init_db.py` / 一次性 script | `long_term_memory.source_line_ids` 老数据补抽 (R-A1) |
| LLM prompt | `memory_extractor.py` | negative example 注入 (R-A5) — 从近 N 条 `MemoryDraft where status='rejected' and rejection_kind='feedback'` 取 |
| LLM prompt | `agent_router.py` / `orchestrator.py` | AI 生成发言时, RAG 召回 memory → 写回 `cited_memory_ids` (R-A4) |

**LLM prompt 设计 (R-A5 关键)**:
```
[系统]
你是 <agent.name>, 在 <workspace.name> 工作.
以下是近 30 天用户驳回的 候选记忆 + 反馈, 请避免再这样抽取:
- 候选: "<text>" 反馈: "<feedback>"
...
[抽取任务] 请从以下会议纪要抽取 长期记忆候选项 (JSON 数组, 每条 < 80 字, scope ∈ {user|project|org}):
<纪要文本>
```

### 2.3 UI 集成

- **跟 R6.0 LineagePane 集成** (web-lineage-v2.jsx 已有 Memory 节点 sankey + 详情侧栏): R6.0 实施时埋好 placeholder, E.A 实施时填真接口. `MemoryDetail` (`web-lineage-v2.jsx:1046+`) 加 "沉淀来源" 区块的 transcript_lines 渲染 + 跳回原文按钮.
- **跟 R6.0 MentalLiveSection 集成** (web-workstation.jsx:1405 已有 `心智模型 → AI 心智一览` 入口): 4 个节点 (AI 专家 / 书架 / 经验 / 会议) 中 "经验" 节点点开走 R-A1/A2.
- **跟 Saga C (mobile MemoryRadar) 协同**: mobile `/m/insights` 现 mock 6 维统计, 后端 `GET /api/me/memory-stats` 已立项但没做. E.A 顺手把 memory-stats 接口做了 (导出每个用户在 6 维度的 memory 数 + workspace 均值).

### 2.4 工作量 + 优先级

| 项 | 工作量 | 备注 |
|---|---|---|
| R-A1 source_line_ids backfill | ~3h | 一次性脚本 |
| R-A2 source-context 接口 | ~4h | join transcript + memory.source_meeting_id |
| R-A3 revoke 接口 + audit | ~3h | soft delete + 30 天 undo grace 期 |
| R-A4 cited_memory_ids 字段 + 写入 | ~6-8h | agent_router + orchestrator 都改 |
| R-A5 LLM prompt negative example | ~4h | memory_extractor.py |
| F-A1 MemoryPane 真接口 + revoke + 抽屉 | ~6h | 替换 `WS_MEM` mock |
| F-A2 LineagePane source-context 抽屉 | ~4h | 嵌入到 MemoryDetail |
| F-A3 会议室 AI 引用 chip + 侧栏 | ~6-8h | **依赖 R5.D Web 会议室已 ship** |
| F-A4 memory_drafts 反馈 textarea | ~2h | 简单 form 改 |
| memory-stats 接口 (兼顾 Saga C) | ~3h | 跟 mobile MemoryRadar 共享 |
| **小计** | **~41-46h** | |

**优先级**: **P1** (排在 E.E 之后). 理由: 长期记忆体验三层金字塔已有, 体验断点不致命; E.E 旗舰功能 (AI 圆桌真协同) 更影响客户演示.

### 2.5 依赖

- **强依赖**: R6.0 LineagePane 实施 ship (W端 sankey + 节点详情侧栏架构稳定) — 否则 F-A2 无处嵌入
- **弱依赖**: R5.D Web 会议室集成 ship — F-A3 需要 Web 会议室基础架构
- **协同 Saga**: Saga C (mobile MemoryRadar) 共享 memory-stats 接口
- **不冲突**: 跟 v1.3.1 权限对齐已落, agent_owner 改自己 primary AI 记忆 / leader 改 ws 全部 — E.A 接口加权限 guard 复用 `auth.can_write_memory`

---

## 3. 子 Saga E.B · AI 知识沉淀

> NORTH_STAR § 3.2: "KB 引用侧栏 (citations 已在库 UI 没做) + OCR 准确度提升 + 公文智能审核扩到通用"

### 3.1 Scope

#### 后端
- **R-B1** `meeting_agent_message.cited_chunk_ids: list[uuid]` 字段 — 当前 KB chunk 召回有 (knowledge_retrieval.py), 但**没记录哪条 message 引用了哪些 chunk**. 加字段 + 在 agent_router.py 写入.
- **R-B2** 新接口 `GET /api/agent-messages/{id}/citations` 返回 `{ chunks: [{ id, document_id, doc_filename, content, similarity }] }`.
- **R-B3** OCR 准确度提升: 现 Qwen-VL 扫描件/手写体不准. 接 PaddleOCR / 阿里云 OCR API 做 A/B (新加 `ocr_provider` 字段到 `KnowledgeDocument`, 双跑评估准确率, 不切默认).
- **R-B4** 公文智能审核 (v24.2#3 已落 KB 内 documents 维度) — 扩到 "通用文档审核": 上传一份 PDF 提示 "格式不规范 / 缺章 / 错别字 N 处". 新接口 `POST /api/knowledge-bases/{kb_id}/documents/{doc_id}/audit` 触发 LLM 审 + 返回 `{ issues: [...] }`.
- **R-B5** KB 沉淀审批流体验 — `kb_sedimentation_draft` 已有 (v26.5-02c), 当前 admin/leader/primary_user 审批. 加 "审批前可看 diff" (proposed_content vs 现有 KB 是否重复) + "diff merge" (重复时建议合并而非新建 doc).
- **R-B6** Perplexity 抓取的 KB doc (v26.13.2) 现 `source_url` 显示, 但 chunks 内 inline citation marker (`[来源 1]`) 没做 — agent_router 召回时改 prompt 让 AI 在引用时输出 markers.

#### 前端 (Web 端独占编辑)
- **F-B1** 会议室 (Web R5.D) AI 发言气泡点击 → 弹"KB 引用侧栏" (NORTH_STAR § 3.2 原文目标): 显示 R-B2 返回的 chunks + 跳 KB document 详情页. 跟 F-A3 是同一个侧栏的两个 tab ("记忆" / "知识").
- **F-B2** `/workstation` KBPane (`web-workstation.jsx:659` 已有设计) — 接真接口, 每个 KBCard 点开看 documents 列表 + R-B4 审核按钮.
- **F-B3** KB document 详情页 (新建 `/workstation/kb/<kb_id>/doc/<doc_id>`) — 显示 chunks + R-B4 audit issues + 引用次数 (从 `cited_chunk_ids` 反查).
- **F-B4** 沉淀审批页 (现 `/me/sedimentation-drafts`) — 加 R-B5 diff view + merge 建议.
- **F-B5** Perplexity KB doc 渲染 — chunks 内 `[来源 N]` marker 渲染成可点击链接 (跳 source_url).

#### 数据
- `meeting_agent_message.cited_chunk_ids` JSON 列
- `knowledge_document.ocr_provider` String(16) (qwen-vl|paddle|aliyun-ocr)
- `knowledge_document.audit_issues` JSON nullable (LLM 审核结果)

### 3.2 Backend 改动

| 类型 | 文件 | 改动 |
|---|---|---|
| 字段扩 | `models.py MeetingAgentMessage` | `cited_chunk_ids` |
| 写入 | `agent_router.py` / `orchestrator.py` | 调用 KB retrieval 后写回 cited_chunk_ids (R-B1) |
| 新接口 | 新 router `routers/citations.py` (或合并 knowledge.py) | `GET /api/agent-messages/{id}/citations` (R-B2) |
| OCR 抽象层 | `ocr.py` | 加 provider switch (qwen-vl 默认, paddle/aliyun 备选) (R-B3) |
| 新接口 | `routers/knowledge.py` | `POST /api/knowledge-bases/{kb}/documents/{doc}/audit` (R-B4) |
| LLM prompt | LLM审核prompt: "请审核以下文档, 输出 JSON: issues: [{type: 'format'|'missing'|'typo', line, msg}]" |
| 接口扩 | `routers/kb_sedimentation.py` | preview endpoint 返回 diff 候选 doc list (R-B5) |
| LLM prompt | `agent_router.py` | 引用时输出 `[来源 N]` (R-B6) |

### 3.3 UI 集成

- **跟 R6.0 LineagePane**: KB 节点详情侧栏 (`web-lineage-v2.jsx:951 kb: { label: '书架文档' ...}`) 加"被哪些 AI message 引用"计数, 链回 R-B2 接口.
- **跟 R6.0 MentalLiveSection**: 4 节点中"书架" 节点点开走 F-B2 KBPane.
- **跟 R5.D Web 会议室**: F-B1 侧栏跟 F-A3 共用容器, 仅 tab 不同.

### 3.4 工作量 + 优先级

| 项 | 工作量 | 备注 |
|---|---|---|
| R-B1 cited_chunk_ids 字段 + 写入 | ~4h | agent_router + orchestrator |
| R-B2 citations 接口 | ~3h | join chunk + document |
| R-B3 OCR provider 切换 + A/B 评估 | ~10-14h | **不确定性高** — 接新 OCR + 评估准确率 |
| R-B4 文档审核 endpoint + LLM | ~6-8h | LLM prompt 工程 + JSON parser |
| R-B5 沉淀审批 diff merge | ~5h | 相似度算法 + UI diff |
| R-B6 Perplexity inline citation | ~3h | prompt + 前端 marker 渲染 |
| F-B1 会议室 KB 侧栏 | ~5h | **依赖 R5.D** + 跟 F-A3 共用 |
| F-B2 KBPane 真接口 | ~4h | 替换 mock |
| F-B3 KB document 详情页 | ~6h | 新建页 + chunks 列 + audit issues |
| F-B4 沉淀审批 diff view | ~3h | 嵌入现页 |
| F-B5 Perplexity marker 渲染 | ~2h | markdown render 扩 |
| **小计** | **~51-58h** | (R-B3 OCR 升级单项 10-14h, 看 PM 是否做) |

**优先级**: **P1** (跟 E.A 并列). 理由: "KB 引用侧栏" 是 NORTH_STAR § 3.2 原文目标, 也是客户最常问的 "AI 引的资料能看吗"; OCR 提升 (R-B3) 可暂缓.

**子优先级**:
- **P1 必做** (~32-37h): R-B1/R-B2/R-B4/R-B5/R-B6 + F-B1/B2/B3/B4/B5
- **P2 选做** (~10-14h): R-B3 OCR 升级 (准确度 A/B 不可预测, 单独 PM 拍板)

### 3.5 依赖

- **强依赖**: R6.0 LineagePane + R5.B/C/D Web 重做 — 否则 F-B2/B3 无外壳
- **强协同**: E.A (cited_memory_ids 跟 cited_chunk_ids 是一对) — 一起做 LLM prompt 改动效率最高, 建议 E.A + E.B **同时立项, 同一 sprint 跑**
- **不冲突**: v1.3.1 权限 — knowledge.py 已落 `can_write_kb` ABAC

---

## 4. 子 Saga E.C · AI 数据沉淀方案

> NORTH_STAR § 3.3: "真实 PDF/PPT/Excel 预览 + chapter/highlights 自动提取 + 数据导出 + 第三方系统对接 SOP"

### 4.1 Scope

#### 后端
- **R-C1** 真实 PDF/PPT/Excel 预览数据接口 — backend `doc_parser.py extract_text` 已有, 但**前端 `materials/FilePreview.tsx` 是 hardcoded mock 渲染**. 加 `GET /api/meetings/{id}/attachments/{att_id}/preview` 返回 `{ pages: [{ idx, text, html? }] }` (PDF 按页 / Excel 按 sheet / PPT 按 slide / Word 按段落).
- **R-C2** chapter/highlights 自动提取 — 会议结束触发 `chapter_extractor.py` (新模块), LLM 跑 transcript → 输出 `[{ idx, t_start, t_end, title, summary, kind: '决策'|'风险'|'分歧'|'里程碑' }]`. 新表 `meeting_chapter`.
- **R-C3** 数据导出 SOP — workspace 级 "一键导出": 会议纪要 + 任务列表 + memory 库 全量 ZIP. 新接口 `POST /api/workspaces/{id}/export` (异步 job + email 完成通知).
- **R-C4** 第三方系统对接 — 暴露 webhook (workspace 设置 N 个 webhook URL: `meeting.done` / `task.done` / `memory.commit` 时 POST). 新表 `workspace_webhook`.
- **R-C5** 数据 5 级分级 操作 UI — `Task.data_classification` / `KnowledgeDocument.data_classification` / `LongTermMemory.data_classification` 已落, 但**修改入口只有 admin 后台**. 给 owner_agent_id 的 primary_user 加"修改本 AI 记忆/KB 分级" 入口.

#### 前端 (Web 端独占编辑)
- **F-C1** 会议室 `materials/FilePreview.tsx` 替换 — 接 R-C1 接口, 删 hardcoded `MOCK_PDF` / `MOCK_PPT` / `MOCK_EXCEL`. PDF.js / xlsx / pptx-preview 三方库可选.
- **F-C2** 会议室 章节 sheet (`ChaptersSheet` 当前 mock timeline) — 接 R-C2 接口, 5 类节点替换为真 chapter.
- **F-C3** `/workstation` 加 "数据导出" 入口 (workspace_creator/leader 可见) — R-C3.
- **F-C4** `/workstation/admin` 加 "Webhook 设置" tab — R-C4.
- **F-C5** AI 详情页 / KB 详情页 加 "分级" 编辑器 (5 级 chip 切换) — R-C5.

#### 数据
- 新表 `meeting_chapter (id, meeting_id, idx, t_start, t_end, title, summary, kind, created_at)` (R-C2)
- 新表 `workspace_webhook (id, workspace_id, url, events, secret, enabled, created_at)` (R-C4)

### 4.2 Backend 改动

| 类型 | 文件 | 改动 |
|---|---|---|
| 新接口 | `routers/meeting_attachments.py` | `GET /preview` 返回 pages + text |
| 新模块 | `chapter_extractor.py` | LLM 跑 chapter 抽取 |
| 新接口 | `routers/meetings.py` | `GET /api/meetings/{id}/chapters` |
| 触发 | `summary_generator.py` 收尾 | 调用 chapter_extractor |
| 新接口 | `routers/super.py` (或 workspaces) | `POST /export` 异步 job |
| 新表 + router | `routers/webhooks.py` | webhook CRUD + dispatch |
| 新接口 | `routers/agents.py` / `knowledge.py` / `memory.py` | `PATCH data_classification` (受 primary_user 限制) |

**LLM prompt 设计 (R-C2)**:
```
[任务] 从以下会议纪要 (按分钟切片), 抽取 chapter:
- 每个 chapter 含 1 个 决策/风险/分歧/里程碑 事件
- title < 20 字, summary < 60 字
- 输出 JSON 数组 [{ t_start: 分钟数, t_end, title, summary, kind }]
```

### 4.3 UI 集成

- **跟 R5.D Web 会议室**: F-C1 (PDF/Excel 预览) + F-C2 (chapter sheet) 必须在 R5.D 落地之后做, 否则无外壳
- **跟 R6.0 不冲突**: 数据导出 / webhook / 分级编辑都是 Web 独占编辑, 在 `/workstation/admin` pane (现有 AdminPane)
- **跟 mobile 不冲突**: 数据预览也可走 mobile (PRODUCT_OVERVIEW 列 mobile 会议室 ChaptersSheet 是 mock — F-C2 接口顺手喂 mobile)

### 4.4 工作量 + 优先级

| 项 | 工作量 | 备注 |
|---|---|---|
| R-C1 preview 接口 | ~3-4h | 复用 doc_parser.extract_text |
| R-C2 chapter_extractor + 表 + 接口 | ~8-10h | LLM prompt + JSON parser + 触发链 |
| R-C3 数据导出 异步 job | ~5-6h | celery/rq 调度 + zip + email |
| R-C4 webhook 表 + dispatch + 签名 | ~6-8h | HMAC 签名 + retry |
| R-C5 分级 PATCH endpoints | ~3h | 3 个表 + ABAC |
| F-C1 FilePreview 真渲染 | ~6-8h | PDF.js / xlsx-js / pptx-preview 集成 |
| F-C2 ChaptersSheet 真数据 | ~3h | 替换 mock |
| F-C3 导出入口 | ~2h | 按钮 + 进度 toast |
| F-C4 Webhook 设置 tab | ~5h | CRUD UI |
| F-C5 分级编辑器 | ~3h | chip toggle 复用 |
| **小计** | **~44-52h** | |

**优先级**: **P2** (最低). 理由: NORTH_STAR § 3.3 原文目标已大量落地 (5 级分级 + 桑基血缘 + 跨 AI 申请). 剩下的 PDF 预览 / chapter 提取 是 PRODUCT_OVERVIEW § 4.2 中优, 不致命; webhook 是 Saga G 的运营层延伸.

**子优先级**:
- **P1 必做** (~17-20h): R-C1/R-C2 + F-C1/F-C2 — 把会议室"资料"/"章节"两个 mock 真做 (这部分接近 PRODUCT_OVERVIEW § 8.2 原 E.2)
- **P2 选做** (~27-32h): R-C3/R-C4/R-C5 + F-C3/F-C4/F-C5 — 运营层延伸, 可推迟到 Saga G

### 4.5 依赖

- **强依赖**: R5.D Web 会议室 ship — F-C1/F-C2 在 Web 会议室
- **协同**: Saga G (运营层) 共享 webhook + 导出
- **不冲突**: v1.3.1 权限

---

## 5. 子 Saga E.D · AI 任务执行

> NORTH_STAR § 3.4: "expert/manager 角色专属 UX + 任务办结审批流体验打磨 + 跨端任务通知 push (现 polling)"

### 5.1 Scope

#### 后端
- **R-D1** WebSocket 通知 push — 当前 `notification` 表写库 + 前端 polling (轮询粗). 加 WS endpoint `/ws/notifications/{user_id}` (FastAPI WebSocket), 服务端 任务状态变更 / 通知新增 时 push.
- **R-D2** 任务办结后 AI KB 自动沉淀 (`task_consolidator.py` 已落) 的审批流体验 — 当前是后台 job + UI 待审列表. 加 "审批前预览" (sedimentation_draft 实际写入 KB 的 doc + chunks 预览).
- **R-D3** agent-centric 任务详情 — 任务详情现 leader_directive / consensus / co_progress 都有, 但 "AI 主责 + 真人是手脚" 的视觉关系不明显. 加接口 `GET /api/tasks/{id}/agent-view` 返回 `{ agent: {...}, human_executors: [{user, role: 'co_progress'|'co_rating'}], evidence_chain: [...] }`.
- **R-D4** 任务跨端一致性 — 同一 task 在桌面 `/admin/tasks/[id]` 跟 mobile `/m/tasks/[id]` 视觉差异大. 加共享 schema `TaskDetailOut`, 两端复用.
- **R-D5** "我跟我的 AI 协作" 角色 UX — agent_owner 专属页 `/me/profile/agent-collab` (新). 接口 `GET /api/me/my-agents-collab` 返回 `{ agents: [{ agent, tasks_in_progress, tasks_done, kb_recent_changes, memory_recent_adds }] }`.

#### 前端 (Web 端独占编辑 + 跨端)
- **F-D1** Web 端 `/me/profile/agent-collab` 新页 — agent_owner 看到 "我管的 AI 们最近在干啥" 仪表盘 (R-D5).
- **F-D2** Web 端 任务详情页 `/admin/tasks/[id]` 改造 — 显示 R-D3 agent-view 结构 (AI 主责 卡片 + 真人协办栏 + 证据链时间线).
- **F-D3** mobile 端 `/m/tasks/[id]` 1:1 复用 R-D4 TaskDetailOut schema, 视觉跨端一致 (这部分跟 Saga I 移动 leader IA 重叠).
- **F-D4** WS push 客户端 — 桌面 + mobile + 小程序 都接 R-D1 endpoint, 替换 polling.
- **F-D5** sedimentation_draft 预览 — 沉淀审批页加 "预览 doc 内容" 抽屉 (跟 F-B4 是同一个抽屉的"沉淀"tab).

#### 数据
- 暂无新表 (WS endpoint 是逻辑层)
- `task` 表 audit 已落, 不需新加

### 5.2 Backend 改动

| 类型 | 文件 | 改动 |
|---|---|---|
| 新 WS endpoint | `routers/notifications.py` 或新 `routers/ws.py` | `/ws/notifications/{user_id}` FastAPI WebSocket |
| 触发 | `notify.py` | 同步写 notification 表 + push WS 消息 |
| 新接口 | `routers/tasks.py` (或 mobile.py) | `GET /api/tasks/{id}/agent-view` (R-D3) |
| 新接口 | `routers/me.py` | `GET /api/me/my-agents-collab` (R-D5) |
| Schema 统一 | `schemas.py` | 抽 `TaskDetailOut` shared schema (R-D4) |
| 接口扩 | `routers/kb_sedimentation.py` | preview endpoint (R-D2) |

**WebSocket 架构 (R-D1 关键)**:
- 用 FastAPI 内建 WS (单 worker 简单 broadcast) — POC 阶段
- 多 worker 部署: 用 Redis pub/sub 跨 worker push (生产)
- 客户端: heartbeat 30s + 断线 5s 重连 + fallback polling (避免离线掉消息)

### 5.3 UI 集成

- **跟 R6.0 (Web)**: 不冲突 — agent-collab page 是新页, /admin/tasks 改造在工作站 pane 下
- **跟 Saga I (移动 leader IA)**: 强协同 — R-D4 TaskDetailOut 是 Saga I 的 dependency. 建议 Saga I 顺手做 R-D4.
- **跟 mobile round-4 Saga D (二级页浅色化)**: 协同 — F-D3 是浅色化路径上的一部分

### 5.4 工作量 + 优先级

| 项 | 工作量 | 备注 |
|---|---|---|
| R-D1 WS endpoint + Redis pub/sub | ~10-12h | **不确定性高** — 多 worker scaling |
| R-D2 sedimentation preview | ~3h | 接口扩 |
| R-D3 agent-view 接口 | ~5h | join task + agent + users |
| R-D4 TaskDetailOut 统一 schema | ~4h | 抽 schemas.py + 改三处 |
| R-D5 my-agents-collab 接口 | ~4h | 多 agent 聚合 |
| F-D1 agent-collab 新页 | ~6h | 新页 + 卡片 |
| F-D2 桌面任务详情改造 | ~6h | 视觉重做 |
| F-D3 mobile 任务详情 | ~4h | 跟 Saga I 共做 |
| F-D4 WS client 三端 | ~8-10h | 桌面 + mobile + 小程序 都接 |
| F-D5 沉淀预览抽屉 | ~2h | 跟 F-B4 共用 |
| **小计** | **~52-56h** | |

**优先级**: **P2** (排 E.E/E.A/E.B 之后). 理由: 任务执行核心闭环 (Task + agent-centric) 已落, "我跟我的 AI 协作" UX 是 NORTH_STAR § 3.4 原文目标但客户没强提; WebSocket 是性能优化, polling 2.5s 当前可用.

**子优先级**:
- **P1 必做** (~21-23h): R-D2/R-D3/R-D4 + F-D2/F-D5 — 任务详情体验打磨
- **P2 选做** (~31-33h): R-D1/R-D5 + F-D1/F-D3/F-D4 — WS push + agent_owner 专属页

### 5.5 依赖

- **强依赖**: v1.3.1 权限对齐 (agent_owner 概念) — 已落
- **强协同**: Saga I 移动 leader IA — 共做 R-D4
- **不冲突**: R6.0 / R5.D — 都是新页或独立改造

---

## 6. 子 Saga E.E · AI 在会议中表现优化

> NORTH_STAR § 3.5 (最高优): "**AI 圆桌真协同 (当前 1 张 mock)** + WebSocket 实时推送 + 字幕/摄像头/举手 真实硬件 + 跳过议程 / 改判 / per-meeting max_total_seconds"

### 6.1 Scope

> **这是 PRODUCT_OVERVIEW § 8.2 原 Saga E 的核心 + 唯一的旗舰差异化功能.**

#### 后端
- **R-E1 (旗舰)** AI 圆桌真协同 — 当前 `MOCK_ROUND_MESSAGES` 永久 1 张固定 (`frontend/.../mock/roundtable.ts`). 真做需要:
  - 新表 `meeting_round (id, meeting_id, topic, trigger_user_id, trigger_kind, started_at, done_at, status, mira_summary JSON)`
  - 新表 `meeting_round_contribution (id, round_id, agent_id, stance, headline, summary, data JSON, note, order_idx, generated_at)`
  - 新接口 `POST /api/meetings/{id}/rounds` 召唤 N 个 AI 同主题 (输入 topic + agent_ids[]). 顺序串行 LLM 调用 (每个 AI 看到前面所有 AI 的回答 + Mira 综合最后跑)
  - 新接口 `GET /api/meetings/{id}/rounds` 列当前会议所有 round
  - 触发: 会议室"召唤多专家"按钮 (mobile 已有触发 UI, 桌面待 R5.D)
- **R-E2** 真实 attendee API — `GET /api/meetings/{id}/attendees` 已有但**不含 voiceprint 色**. 扩字段 `voiceprint_color`.
- **R-E3** WebSocket 推送 phase 变化 — `auto_meeting_orchestrator.py` 当前写 `Meeting.phase` (DB), 前端 2.5s 轮询. 加 WS push (用 R-D1 同基础架构, 不重复开发).
- **R-E4** 跳过议程 / 改判 / per-meeting max_total_seconds:
  - 跳过: `POST /api/meetings/{id}/agenda/{idx}/skip` (orchestrator 看 skipped 标记跳过本议程)
  - 改判: `consensus_id` UNIQUE 改为 (meeting_id, agenda_idx, version) — 允许 v2 改判
  - max_total_seconds: `meeting.max_total_seconds: Optional[int]` 字段 (NULL = fallback 全局 2700s)
- **R-E5** 字幕/摄像头/举手 真实硬件 — 当前 UI toggle 无后端. 加 `meeting_attendee_state` 表 (user_id, mic_on, camera_on, hand_raised). WebSocket sync 跨参会者状态.
- **R-E6** 召集人模式 (auto) 优化 — agenda_monitor 偏题/僵局 检测准确率打磨 (现 LLM prompt 偶发误报). 加 `agenda_monitor_log` 表记录每次判断的 LLM 输入/输出, 让 PM 反查.

#### 前端
- **F-E1 (旗舰)** AI 圆桌真协同 UI — 替换 `MOCK_ROUND_MESSAGES` mock. RoundMessage.tsx (`frontend/src/components/mobile/meeting-room/RoundMessage.tsx`) 改成接 R-E1 接口流式渲染. Web R5.D 同步做.
- **F-E2** 真人 attendee 头像 stack — R-E2 数据喂会议室筛选 sheet + 头像 stack (round-4 设计).
- **F-E3** WS 客户端替换 polling — 跟 F-D4 共用.
- **F-E4** 跳过 / 改判 / max_total_seconds UI — orchestrate 控制台 (`/meeting/[id]/orchestrate`) 加按钮.
- **F-E5** 麦克风/摄像头/举手 真实接入 — WebRTC getUserMedia (mic/camera) + 状态 sync via R-E5.

#### 数据
- 新表 3 张 (`meeting_round`, `meeting_round_contribution`, `meeting_attendee_state`, `agenda_monitor_log`)
- `meeting.max_total_seconds` 字段
- `meeting_consensus.version` 字段

### 6.2 Backend 改动

| 类型 | 文件 | 改动 |
|---|---|---|
| 新模块 | `round_orchestrator.py` (新) | 串行调多 AI + Mira 综合 (R-E1) |
| 新表 + router | `routers/rounds.py` (新) | round CRUD + 流式 SSE 推送 (R-E1) |
| 接口扩 | `routers/meetings.py attendees` | `voiceprint_color` (R-E2) |
| WS | 复用 R-D1 | phase push (R-E3) |
| 接口扩 | `routers/meetings.py` | skip / re-decide / max_total_seconds (R-E4) |
| 新表 + WS | `routers/ws.py` | attendee_state sync (R-E5) |
| 调优 | `agenda_monitor.py` | prompt + log table (R-E6) |

**LLM prompt 设计 (R-E1 关键)**:
```
[圆桌 AI N 号]
你是 <agent_N>. 主题: <topic>. 召唤者: <trigger_user>.
其他专家已经发言:
- <agent_1>: <stance> — <headline>: <summary>
- <agent_2>: ...
请输出 JSON: { stance: support|caution|block, headline: <20字>, summary: <60字>, data?: [{label,v}], note?: <可选> }

[Mira 综合]
以上 N 位专家发言完毕. 请你 (主持人) 综合:
- verdict: <一句话裁决>
- conflict: true/false (是否有分歧)
- points: [{stance, tag, text}] * 3-5
- recommendation: <下一步建议>
```

**架构决策点**: 串行 vs 并行 (PM 待决 — § 9 D4).

### 6.3 UI 集成

- **跟 R5.D Web 会议室**: F-E1/F-E2/F-E3/F-E4/F-E5 全部依赖 R5.D 落地后再做. **强建议**: R5.D 先把架构铺好 (transcript 区 + 资料区 + 圆桌触发区), 然后 E.E 填真接口
- **跟 mobile round-3 (已 ship)**: F-E1 直接换 mock 接口, 视觉不变
- **跟 mobile round-4 Saga A/B/C/D**: 不冲突 (round-3 会议室 已浅色化, mock roundtable 直接换接口)

### 6.4 工作量 + 优先级

| 项 | 工作量 | 备注 |
|---|---|---|
| R-E1 AI 圆桌后端 (表 + LLM 串行 + 接口 + 流式) | ~14-18h | **核心** — LLM prompt 工程 + 多 AI 协调状态机 |
| R-E2 attendee voiceprint_color | ~2h | 字段扩 |
| R-E3 WS phase push | ~3h | 复用 R-D1 |
| R-E4 skip/re-decide/max_total_seconds | ~4-5h | 3 处接口 + state machine 改 |
| R-E5 attendee_state 表 + WS sync | ~6-8h | 跨参会者实时同步 |
| R-E6 agenda_monitor 调优 + log | ~4h | prompt 调 + 表 |
| F-E1 圆桌 UI 接真接口 (mobile + Web) | ~6-8h | 替换 mock, 流式渲染 |
| F-E2 真人头像 stack | ~3h | round-4 设计已稳 |
| F-E3 WS client | (含 F-D4) | 复用 |
| F-E4 跳过/改判/max UI | ~3h | orchestrate 控制台 |
| F-E5 mic/camera/举手 WebRTC | ~8-10h | WebRTC 集成不可预测 |
| **小计** | **~53-61h** | |

**优先级**: **P0 (最高)**. 理由: NORTH_STAR § 3.5 原文 "最高优", PM 旗舰功能, 客户演示直接体验; 当前永久 mock 是 NORTH_STAR § 7.5 "不让 mock 假装真实" 的直接违反案例.

**子优先级**:
- **P0 必做** (~28-34h): R-E1 (旗舰) + R-E2 + R-E4 + F-E1 + F-E2 + F-E4 — PRODUCT_OVERVIEW § 8.2 原 Saga E (~30h) 的全部
- **P1 强建议** (~13-15h): R-E3 + R-E5 + R-E6 + F-E3 + F-E5 (mic/camera) — 实时性 + 真实硬件
- **P2 选做** (~12h): F-E5 WebRTC 完整集成 — 不确定性高

### 6.5 依赖

- **强依赖**: R5.D Web 会议室集成 (R5.B/C/D Saga 中最后一项, 当前未启动) — 否则 Web 端没外壳放 F-E1
- **mobile 不依赖**: round-3 mobile 会议室已 ship, F-E1 直接替换 mock 即可
- **不冲突**: v1.3.1 权限 — agent_owner/leader 都能创建 round

---

## 7. 推荐启动顺序 + 总工作量

### 7.1 推荐顺序 (理由 + 工作量)

| Sprint | 子 Saga | 工作量 | 理由 |
|---|---|---|---|
| **Sprint 1** | **E.E (P0 必做部分)** | ~28-34h | NORTH_STAR § 3.5 最高优 + 旗舰 mock 必须出口 + 客户演示痛点 |
| **Sprint 2** | **E.A + E.B (并行, 必做部分)** | ~41-46h (A) + ~32-37h (B) | 两者共享 LLM prompt 改动 + R6.0 LineagePane 协同 + 跨端记忆/知识闭环 |
| **Sprint 3** | **E.D (必做部分)** | ~21-23h | 任务详情体验打磨 + 跟 Saga I 共做 |
| **Sprint 4** | **E.C (必做部分)** | ~17-20h | PDF/chapter 真做 (近似 PRODUCT_OVERVIEW 原 E.2) |
| **Sprint 5 (可选)** | **E.E P1 + E.B P2 + E.D P2 + E.C P2** | ~70-85h | WebSocket + OCR 升级 + agent_owner 专属页 + 数据导出/webhook |

**总工作量**:
- **P0+P1 必做** (Sprint 1-4): **~139-160h** (~17-20 人日, 8-10 周一个人, 4-5 周两人并行)
- **P2 选做** (Sprint 5): **~70-85h** — 看 PM 是否做

### 7.2 单人 vs 双人并行

**单人**: 8-10 周 (P0+P1 必做). 不推荐, 客户压力大.

**双人** (推荐):
- Backend dev: E.E R-E1/E2/E4 → E.A R-A1/2/3/4/5 → E.B R-B1/2/4/5/6 → E.D R-D2/3/4 → E.C R-C1/2
- Frontend dev: F-E1/F-E2/F-E4 → F-A1/F-A2/F-A4 + F-B2/F-B3/F-B5 → F-D2/F-D5 → F-C1/F-C2
- 共 4-5 周 (P0+P1 必做)

### 7.3 跟 Kimi 测试用例策略

每个子 Saga 落地后必产 `docs/kimi-tests/v1.4.X-saga-EE-kimi.md` 类似. 因为 Saga E 涉及 LLM 输出, 测试用例的"反幻觉自检"额外加一条: **不允许把 LLM 生成的 round contribution 描述为"准确" — 只能复述 JSON 字面值**.

---

## 8. 跟现有 Saga 队列协同建议

### 8.1 协同矩阵

| 现有 Saga | E.A | E.B | E.C | E.D | E.E |
|---|---|---|---|---|---|
| **R5.B Web 核心 pane (R6 修订)** | 强协同 (LineagePane MemoryDetail) | 强协同 (LineagePane KB 节点) | 弱协同 | 不冲突 | 不冲突 |
| **R5.C Web 辅助 pane** | 弱协同 | 弱协同 | 弱协同 | 弱协同 (任务详情) | 不冲突 |
| **R5.D Web 会议室集成 (未启动)** | **强依赖** (F-A3 会议室引用 chip) | **强依赖** (F-B1 KB 引用侧栏) | **强依赖** (F-C1 PDF 预览 / F-C2 chapter sheet) | 不冲突 | **强依赖** (F-E1 圆桌 + F-E2 头像 + F-E4 跳过) |
| **R6.0 (Light token + LineagePane + Mental + Home)** | **强协同** | **强协同** | 不冲突 | 不冲突 | 不冲突 |
| **Saga F (round-4 修订: 知识闭环)** | **合并** E.A | **合并** E.B | 不冲突 | 不冲突 | 不冲突 |
| **Saga G (运营层)** | 不冲突 | OCR R-B3 可拆出来到 G | webhook + 导出 可拆到 G | 不冲突 | 不冲突 |
| **Saga H (UX 收口)** | 不冲突 | 不冲突 | 不冲突 | **合并** R-D5 my-agent-collab | 不冲突 |
| **Saga I (移动 leader IA)** | 不冲突 | 不冲突 | 不冲突 | **强协同** (R-D4 TaskDetailOut) | 不冲突 |
| **Mobile round-4 Saga C (MemoryRadar)** | **强协同** (共享 memory-stats 接口) | 不冲突 | 不冲突 | 不冲突 | 不冲突 |
| **Mobile round-4 Saga D (二级页浅色)** | 不冲突 | 不冲突 | 不冲突 | **弱协同** (F-D3 mobile 任务详情) | 不冲突 |
| **v1.3.1 权限对齐 (已落)** | 不冲突 | 不冲突 | 不冲突 | 不冲突 | 不冲突 |

### 8.2 关键协同建议

1. **R5.D 必须先启动** — 当前 R5.D Web 会议室集成 没启动, 但 E.B/E.C/E.E 都强依赖. 建议: PM 拍板 R5.D + E.E 同 Sprint 启动 (R5.D 先铺架构, E.E 接 R-E1 后端)
2. **E.A + E.B 同 Sprint 跑** — LLM prompt 改动 (cited_memory_ids 跟 cited_chunk_ids) 一起改省一半时间
3. **E.D 跟 Saga I 合并** — R-D4 TaskDetailOut 是 Saga I 的 dependency, 同一个 backend dev 顺手做
4. **E.A memory-stats 接口 顺手喂 Saga C (mobile MemoryRadar)** — Saga C 已暂停, 但接口先做了等 Saga C 解冻直接用
5. **E.E R-E5 (WebRTC) 跟 R5.D 解耦** — WebRTC 不确定性高, 可推到 P2 不卡 R5.D

### 8.3 风险解耦建议

- **R-B3 (OCR 升级)** — 单独拆出来到 Saga G (运营层), 因为 OCR 准确率不可预测 + 测试集需要构建. 不卡 E.B 主流程
- **R-E5 (WebRTC)** — 同上, 拆到 P2
- **R-D1 (WebSocket)** — 单独做, 一次性架构投入, E.D + E.E 共用. 不放在任一子 Saga 单内估时

---

## 9. PM 待对齐的关键决策 (7 个)

### D1 · 5 个子 Saga 启动顺序

本文档推荐 **E.E → E.A+E.B → E.D → E.C** (§ 7.1). 但 PM 可选:
- (a) 推荐顺序 — 旗舰先做
- (b) **E.A + E.B 先做** (知识/记忆体验最容易出客户演示亮点)
- (c) **E.E + E.D 先做** (旗舰 + 任务体验, 跨 NORTH_STAR § 3.4/3.5)

### D2 · 向量数据库选型

当前: PostgreSQL + pgvector 1536d (OpenAI text-embedding-3-small / Qwen text-embedding-v2).
- **继续** (低成本): 数据量小 (~10K memory + 50K chunks) 时性能足够. **推荐**.
- **迁独立向量库** (Pinecone / Milvus / Weaviate): 当 memory + chunks 量到 100K+ 时考虑. 现在切换有 backfill + 接入成本 (~20-40h), 不划算.

**推荐**: 继续 pgvector, E.A/E.B 不切.

### D3 · WebSocket 是否真做

- 现状: 2.5s polling + 在线状态判断粗
- **真做 (R-D1 + R-E3)**: 单 worker FastAPI WS 简单, 多 worker + Redis pub/sub 复杂 (~10-12h backend)
- **不做**: 推迟到生产真实出问题时

**推荐**: **真做** — NORTH_STAR § 3.5 原文目标 + 跨端通知 (R-D1) + 会议 phase push (R-E3) 都需要

### D4 · "AI 圆桌真协同" 后端架构选型

R-E1 关键决策:
- **A. 串行轮发 (推荐)**: AI 1 看 topic → 发言 → AI 2 看 (topic + AI 1) → 发言 → ... → Mira 综合. 简单, 延迟可控 (N 个 AI 各 1 次 LLM 调用)
- **B. 并行 + 综合**: AI 全部并行各跑一次 → Mira 综合. 延迟最短, 但 AI 看不到彼此, 失去"协同"语义
- **C. Multi-agent debate**: AI 1 发言 → AI 2 反驳 → AI 1 回应 → ... 多轮. 真协同, 但延迟 + 成本爆炸

**推荐**: **A. 串行轮发** + 选项允许 PM 后续切 C

### D5 · 任务执行 push: WS 还是 polling 优化

- WS 真做 (R-D1): ~10-12h backend + 客户端三端 ~8-10h = 18-22h
- polling 优化 (从 2.5s → 1s + 在线状态精化): ~3-4h

**推荐**: **WS 真做** — 跟 D3 同决策

### D6 · OCR 升级值不值

R-B3: Qwen-VL → Paddle / 阿里云 OCR. ~10-14h + 测试集构建.
- 客户当前对扫描件 OCR 准不准没强反馈
- 但 NORTH_STAR § 3.2 原文目标

**推荐**: **拆到 Saga G**, 不卡 E.B 主流程

### D7 · "AI 心智一览" 跨端语义

(对应 SAGA-mobile-round-6 § 4.2.4 的 C 选项)
- mobile MemoryRadar (6 维雷达, "我懂多少") vs web 桑基 ("谁影响谁") — 语义不同
- **C.0**: mobile 独立做雷达 (~14h)
- **C.1**: 保留两者, 明确语义 (~14h)
- **C.2 (推荐)**: mobile 用桑基简化版, 跨端语义一致 (~16h mobile + 跟 web 共用 backend)
- **C.3**: 推迟到 Saga E 收尾后立跨端 saga (~30h)

**推荐**: **C.2 或 C.3**, 不要 C.0/C.1.

---

## 10. 风险点

1. **LLM prompt 工程不可预测** — R-E1 (圆桌)/R-A5 (memory 负反馈)/R-B4 (文档审核)/R-C2 (chapter 抽取) 都依赖 LLM 输出稳定性. 客户演示前 必须有 Kimi 用例覆盖各种边界 (空议程 / 单 AI / 5+ AI / 长 topic / 短 topic).
2. **WebSocket 多 worker scaling** — R-D1 单 worker 简单, 多 worker + Redis 复杂. 生产环境部署时需要预算 Redis 实例成本.
3. **真协同语义 vs 串行模拟** — D4 决定. 串行 ≠ 真协同, 客户可能看出 "AI 是排队发言不是讨论". 需要 Mira 综合环节做到位.
4. **WebRTC (R-E5)** — 浏览器 getUserMedia 兼容性 + 移动端 webview 限制. 不确定性最高, 拆到 P2.
5. **跨端 schema 漂移** — R-D4 TaskDetailOut 抽 shared schema 后, 三端 (桌面/mobile/小程序) 要同步改. 一处改动三处验证.
6. **OCR A/B 评估测试集** — R-B3 需要标注扫描件/手写体 ground truth, 没现成数据集. 拆 G 是对的.
7. **跟 R5.D 时序绑死** — E.B/E.C/E.E 都强依赖 R5.D. R5.D 一延误整 Saga E 延误. **建议: R5.D + E.E 同 Sprint 启动, 把架构铺好.**
8. **memory_extractor negative feedback 累积** — R-A5 长期效果未知. 初期 negative pool 小, 可能反而引入偏差. 需要 PM review 周期性 prompt.

---

## 11. 跟 NORTH_STAR § 7 "不做 5 条" 对齐

| 不做条 | 本 Saga E 对齐情况 |
|---|---|
| 7.1 不做 dark mode | 本 Saga 不引入 dark token. Web 端独占编辑全走 round-6 浅色 |
| 7.2 不硬编码客户专属逻辑 | 所有新表/接口 均 workspace_id 隔离, 不写 `if workspace='福田'` |
| 7.3 不在小程序做编辑功能 | E.A F-A1/F-A4 / E.B F-B1/B2/B3/B4 / E.C F-C3/C4/C5 / E.D F-D1/D2 / E.E F-E4 编辑都在 Web. mobile 仅 R-D4 视图复用 / F-E1 圆桌查看 |
| 7.4 不一次性大改 | 5 个子 Saga 拆 4-5 个 Sprint, 每个独立 ship + Kimi 验收 |
| 7.5 不让 mock 假装真实 | **核心动机** — Saga E 直接终结 NORTH_STAR § 3.5 提到的"永久 1 张 mock". 同时 E.C 终结 PDF/chapter mock |

---

## 12. 总结

| 维度 | 结论 |
|---|---|
| Saga E 当前定义 | PRODUCT_OVERVIEW § 8.2 ~30h, 只覆盖 NORTH_STAR § 3.5 部分 |
| 本文档拆细 | 5 个子 Saga 对齐 NORTH_STAR § 3.1-3.5 五大能力 |
| 总工作量 | P0+P1 必做 ~139-160h (4-5 周 双人), P2 选做 ~70-85h |
| 推荐启动顺序 | E.E (旗舰) → E.A+E.B (记忆/知识 并行) → E.D → E.C |
| 关键依赖 | R5.D (Web 会议室) 未启动 — 阻塞 E.B/C/E. 建议 R5.D + E.E 同 Sprint 启动 |
| 是否替换原 Saga F/H | **是** — Saga F (知识闭环) 合并到 E.A + E.B; Saga H 的 agent_owner 专属页合并到 E.D |
| Kimi 测试用例 | 每 Sprint 一份, 反幻觉额外加 "LLM 输出不允许声称准确, 只复述字面值" |
| PM 必决 | 7 项 (§ 9): 启动顺序 / 向量库 / WS / 圆桌架构 / 任务 push / OCR / 心智一览跨端 |

---

> **本文档不动代码** — review only. 唯一允许新增是本文件. 待 PM 拍板 5 个子 Saga 启动顺序后, 主 Agent 单独立 `SAGA-E-A-*-changelist.md` / `SAGA-E-B-*-changelist.md` 等子文档 给 subagent 实施.
