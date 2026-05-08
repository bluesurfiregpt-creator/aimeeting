# Aimeeting · 测试用例（v12）

> **使用说明**：每条用例独立可测；按编号顺序执行；遇到失败把"实际结果"列填上具体现象 + 截图；最后一列填 ✅ 通过 / ❌ 失败 / ⚠️ 部分通过。
>
> **第一次拿到这份文档?** 直接从下面的【系统概览】开始读,5 分钟掌握系统全貌再动手测。

---

## 系统概览(Onboarding,5 分钟入门)

### 1. 这是什么系统?

**Aimeeting** —— **AI Agent + 会议系统**。把会议从「被动记录」升级为「组织决策智能系统」:多 AI 专家参会、记得住、能延续。

**闭环目标(每场会议都跑这条流水线)**:

```
建会 → 录声纹 → 开会 → 实时字幕 → @AI 专家 → 带姓名的纪要 → 长期记忆 → 下场会议会前简报
```

### 2. 用户角色与典型场景

| 角色 | 典型操作 | 在哪些系列里被覆盖 |
|---|---|---|
| **管理员**(创建工作空间者) | 拉人进队、配 Agent、传知识库、看审计 | A · O · F · Q · N |
| **参会人** | 录声纹、开会发言、@专家、纠错说话人、导出纪要 | B · C · D · E · F · R |
| **旁观/复盘者** | 看历史会议、读纪要、看长期记忆、读会前简报 | I · H · J |

### 3. 整体架构

```
┌────────────────────────────────────────────────────────────────────┐
│                     浏览器(Chrome / Edge / Safari)                 │
│  Next.js 15 + React 19 · 实时字幕 / Agent 头像条 / 后台管理        │
└──────────────────┬───────────────────────────────┬─────────────────┘
                   │ HTTPS                          │ WSS (PCM 16kHz)
                   ▼                                ▼
       ┌───────────────────────────────────────────────┐
       │  Nginx (TLS · 反代 /api · /ws · / → Next.js)  │
       └─────────────────┬─────────────────────────────┘
                         ▼
       ┌──────────────────────────────────────────────┐
       │  FastAPI 后端 · 多路由 · WebSocket · SSE 流  │
       │  ─ ASR pipeline   ─ Agent router  ─ Memory   │
       │  ─ Voiceprint id  ─ Orchestrator  ─ Dissent  │
       └────┬─────────────┬─────────────┬─────────────┘
            ▼             ▼             ▼
    ┌─────────────┐  ┌─────────┐  ┌────────────────────┐
    │ PostgreSQL  │  │  Redis  │  │   外部依赖         │
    │ + pgvector  │  │(可选)    │  │ ─ DashScope STT    │
    │             │  │          │  │ ─ DashScope LLM    │
    └─────────────┘  └─────────┘  │ ─ pyannoteAI 声纹   │
                                  │ ─ 阿里云 OSS 音频   │
                                  └────────────────────┘
```

**部署**:服务器 `47.245.92.62` · 域名 `aimeeting.zhzjpt.cn` · Docker Compose + Let's Encrypt 自动续证。

### 4. 关键技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| 前端 | Next.js 15 (App Router) + React 19 + Tailwind 3.4 | SSR + CSR;实时字幕、流式 Agent 气泡、骨架屏 |
| 后端 | FastAPI 0.115 + uvicorn + SQLAlchemy 2 (async) | REST + WebSocket + SSE |
| 数据库 | PostgreSQL 16 + pgvector (cosine 距离) | 多租户表 + 1536 维向量 |
| 缓存 | Redis 7 | 会话级 KV (本地内存兜底) |
| LLM | DashScope (Qwen) 主 / Anthropic / OpenAI / DeepSeek / Gemini 副 | 单点配置 · `/admin/llm` 切换 |
| STT | DashScope paraformer-realtime-v1 | 16kHz 单声道 PCM 流式 |
| 声纹 | pyannoteAI precision-2 | 录入 + diarize + identify;match threshold 0.75 |
| 嵌入 | DashScope text-embedding-v2(1536 维) | KB 文档分块 + 长期记忆 |
| 音频存储 | 阿里云 OSS(新加坡) | 录音 + 声纹音频 |
| 鉴权 | bcrypt + JWT in HttpOnly Cookie(14 天) | 工作空间隔离 |

### 5. 核心数据流

**字幕 → 持久化 → AI 联动**(每场会议的主链路):

```
mic → AudioContext 16kHz Int16 → WS frames → FunASRClient → DashScope
  └→ 实时(non-final)字幕 → 前端灰色光标
  └→ final 字幕
       ├→ 写 meeting_transcript(DB)
       ├→ 推回 WS(transcript_persisted,带 line_id 给前端做纠错锚点)
       ├→ asyncio.create_task(maybe_invoke_agents)  ← 关键词/@ 触发 Agent
       └→ asyncio.create_task(maybe_detect_dissent) ← M2.3 新增,LLM 检测对立观点
```

**声纹识别**(后台 worker,会议结束时收尾):

```
WS PCM 同时缓冲到 in-mem session.pcm_buffer
  → 会议结束(WS close) → pyannote /diarize 拿说话人时间段
  → 对每个 segment 调 /identify 匹配工作空间内的声纹
  → 与 transcript 时间区间求交并集(line overlap ≥ 0.7 才认)
  → 写 speaker_user_id 到 meeting_transcript
  → 推 speakers_updated WS 事件 → 前端 refreshSpeakers
```

**AI 专家触发(四种路径,参考 F · T · U 系列)**:

| 触发 | 入口 | 节流 | 参考 |
|---|---|---|---|
| **关键词** | final 字幕命中 Agent.keywords | 每 Agent 30s/会议 30s 双闸 | F-1 |
| **@ 提及** | final 字幕含 `@专家名` | 同上 | F-2 |
| **手动召唤** | 用户点 Agent 头像 | 不节流 | F-3 |
| **接力推荐**(M2.1) | 上位 Agent 发言完毕,LLM 推下一位 | LLM 一次,90s 自动消失 | T-1 |
| **分歧检测**(M2.3) | LLM 扫近 8 句,识别对立观点 | 25s 检测节流 + 60s 触发后抑制 | U-1 |

### 6. 当前迭代覆盖范围

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 主链路(建会 → 字幕 → 单 Agent → 带姓名纪要) | ✅ 已完成 |
| Phase 2 | 工作空间隔离 / 长期记忆 / 知识库(RAG) | ✅ 已完成 |
| Phase 3 / M2.1 | 多 Agent 接力推荐(Orchestrator V1) | ✅ 已完成 |
| Phase 3 / M2.2 | 知识库 RAG 注入 Agent prompt | ✅ 已完成 |
| **Phase 3 / M2.3** | **分歧检测 + 主动召唤仲裁专家**(本版) | ✅ **本版上线** |
| Phase 3 / M3.x | 全自动主持人 / 自动议程 | ⚪ 计划中 |
| Phase 4 | 跨组织协作 / 公开知识库 | ⚪ 远期 |

### 7. 关键技术约束(测试时**不要**当成 bug)

| 约束 | 现象 | 为什么这么设计 |
|---|---|---|
| **声纹严格模式** | 部分语音被标「未识别」 | 宁缺勿滥(threshold 0.75 + line overlap 0.7 + ≥1s 段);手动纠错可改 |
| **极短会议跳纪要** | < 3 句 final OR < 60 字时不出纪要 | 防止 LLM 编造内容 |
| **声纹用户无密码** | 邓西/幸世杰能被识别但不能登录 | 录声纹只用作识别,不做账号 |
| **工作空间硬隔离** | 跨 workspace 数据完全不可见(包括 Agent / 记忆 / 知识库) | 多租户安全 |
| **WS 重连边界** | 重连期间字幕会丢一小段,JSON 控制消息会被缓冲 | 音频帧不缓冲(防止旧帧打乱时序) |
| **首次进会议页有 0.5s 白屏** | 等 SSR + JS 注水 | 已知;不影响功能 |

### 8. 测试人入门(推荐顺序,完整跑约 60 分钟)

| 步骤 | 系列 | 用时 |
|---|---|---|
| 1. 登录 + 工作空间隔离 | A | ~5 分 |
| 2. 录入 2-3 个人声纹(35-45s/人) | B | ~10 分 |
| 3. 创建会议 + 实时字幕 + 多人对话 | C | ~10 分 |
| 4. 验证声纹自动贴名 + 手动纠错 | D · E | ~10 分 |
| 5. 测 AI 专家四种触发(关键词 / @ / 头像 / 接力 / 分歧) | F · T · **U** | ~15 分 |
| 6. 等会议结束后看自动纪要 | G | ~3 分 |
| 7. 导出 MD / DOCX | R | ~2 分 |
| 8. 看长期记忆 / 会前简报 | H · I | ~5 分 |

> **前置准备**:Chrome 桌面最新版 · 麦克风 · HTTPS 入口(本系统已配 Let's Encrypt,直接开 https://aimeeting.zhzjpt.cn 即可)。

---

## 给 Claude Cowork(自动化测试 Agent)的指南

> 这一节专门为 **Cowork** 这种自动化测试 Agent 写。如果你是人类测试员,跳过即可;但里面的 API 端点速查表对手工 debug 也有用。

### 1. 鉴权 / 登录(必读)

- 入口 `https://aimeeting.zhzjpt.cn`,所有 `/admin/*`、`/meetings/*` 都需要登录。
- 默认测试账号:邮箱 `bluesurfiregpt@gmail.com` / 密码 `aimeeting123`。
- 鉴权机制:`POST /api/auth/login` 返回 `Set-Cookie: aimeeting_session=<JWT>; HttpOnly; Secure; SameSite=Lax; Max-Age=14d`。后续所有请求 `credentials: include` 即可自动带上。
- 登录成功后浏览器跳到首页,右上角文案应是「默认工作空间 · Bluesurfire · 登出」。**Cowork 验证登录是否成功的最稳定方法**:`GET /api/auth/me` 返回 200 + `{user_id, name, email, workspace_id, workspace_name}`(401 即未登录)。
- 401 在前端会自动重定向到 `/login?next=<原路径>`,**不要**当作业务错误。

### 2. API 端点速查表(可直接用 fetch / curl 验证,无需 UI 交互)

| 资源 | 方法 + 路径 | 备注 |
|---|---|---|
| 当前用户 | `GET /api/auth/me` | 鉴权检查首选 |
| 登录 | `POST /api/auth/login` body `{email, password}` | 返回 `{user_id, ...}` 并 set cookie |
| 注册 | `POST /api/auth/register` body `{email, name, password, workspace_name?}` | 自动登录 |
| 用户列表 | `GET /api/users` | 当前 workspace 全部声纹用户 |
| 会议列表 | `GET /api/meetings` | 倒序按创建时间 |
| 会议详情 | `GET /api/meetings/{id}` | `status` ∈ `{scheduled, ongoing, finished, processed}` |
| **会议字幕** | `GET /api/meetings/{id}/result` | ⚠️ **不是** `/transcript` 也不是 `/lines`。返回 `{meeting, lines[], identification_status, identification_message}` |
| 会议纪要 | `GET /api/meetings/{id}/summary` | 返回 `{summary_md, status}`,`status` ∈ `{ready, pending, skipped, unconfigured, failed}` |
| **会议导出** | `GET /api/meetings/{id}/export?format=md\|docx` | ⚠️ **不是** `/export.md`/`/export.docx`,而是 `?format=md` 或 `?format=docx`。响应是文件流 + `Content-Disposition` |
| 会议简报 | `GET /api/meetings/{id}/briefing` | 长期记忆生成的会前提要 |
| 删除会议 | `DELETE /api/meetings/{id}` | 204 |
| 纠错说话人 | `POST /api/meetings/{mid}/transcripts/{lid}/correct-speaker` body `{speaker_user_id}` | `lid` 是 `meeting_transcript.id`(数字) |
| **打字录入** | `POST /api/meetings/{id}/manual-transcript` body `{text, speaker_user_id?}` | **Cowork 主入口** — 不需要 WS / mic 即可注入字幕,触发 Agent / 分歧检测 / 议程监督同 ASR final;返回 `{line_id, speaker_user_id, speaker_name, text}` |
| **创建会议(带议程)** | `POST /api/meetings` body 加 `agenda: [{title, time_budget_min?, note?}]` | **M3.0 起**:有 agenda 才会启动 agenda_monitor 跑题检测和时间预警;agenda 留空则关闭这一层 |
| **行动项列表** | `GET /api/meetings/{id}/actions` | M3.0:summary 生成后约 5-15s 自动填充;包含 manual 添加项 |
| **行动项添加** | `POST /api/meetings/{id}/actions` body `{content, assignee_user_id?, due_at?}` | source_type='manual' |
| **行动项更新** | `PATCH /api/meetings/{id}/actions/{action_id}` body 可含 `{status, content, assignee_user_id, due_at}` | status ∈ open\|done\|cancelled |
| **行动项删除** | `DELETE /api/meetings/{id}/actions/{action_id}` | 204 |
| **Agent 发言历史** | `GET /api/meetings/{id}/agent-messages` | M3.0 Cowork 验证利器:不需订阅 WS 也能看到 Agent 是否真触发了发言(persistent record 来自 meeting_agent_message) |
| **Agenda 同步触发** | `POST /api/meetings/{id}/agenda-monitor/run-now` | **v12 ISSUE-4 修复**:绕过 60s 节流强制跑一次 agenda 检查,返回 `{fired, payload, note}`。CI 可用。无 agenda 或 LLM 判无信号 → fired=false |
| **Audit · 系统检测** | `GET /api/audit?action=dissent.detected` <br> `GET /api/audit?action=agenda.agenda_off_topic` <br> `GET /api/audit?action=agenda.agenda_time_warning` | **v12 ISSUE-2 修复**:每次检测器触发都会写 audit 行,Cowork 不订阅 WS 也能验证 |
| Agent CRUD | `/api/agents` POST/GET, `/api/agents/{id}` PATCH/DELETE | DELETE 后会写 audit log |
| 知识库 CRUD | `/api/knowledge-bases` 同上 |  |
| 文档上传 | `POST /api/knowledge-bases/{kbid}/documents` (multipart `file=...`) | 异步解析,200 返回时 `status=parsing`,稍后变 `ready` |
| LLM Provider 列表 | `GET /api/model-providers` | masked_key 不会泄露完整 key |
| LLM Provider 拉取模型 | `POST /api/model-providers/{provider}/list-models` body `{api_key?, base_url?}` | 留空则用已保存的 |
| 团队成员 | `GET /api/team/members` | 包含 owner / admin / member 角色 |
| 邀请 | `POST /api/team/invitations` body `{email, role}` | 返回含 invite_url + 7d TTL |
| 移除成员 | `DELETE /api/team/members/{user_id}` | **移除自己 → 400** + `cannot remove yourself; transfer ownership first`(v9 修复:之前会 500) |
| 审计日志 | `GET /api/audit?action=&user_id=&limit=&offset=` | 倒序 |
| 找回密码 | `POST /api/auth/password/forgot` body `{email}` | 总是返回成功(防枚举);链接打到后端日志 |
| WebSocket(STT) | `wss://aimeeting.zhzjpt.cn/ws/stt?meeting_id=<id>` | 鉴权走 cookie。发 PCM bytes,收 JSON 事件 |
| 健康检查 | `GET /healthz` | `{ok: true, env: "prod"}`,公开 |

### 3. UI 选择器约定

为方便 Cowork 用 DOM-based 工具(claude-in-chrome、playwright)定位元素,关键交互点都用以下方式可发现:

- **登录按钮**:文案 = `登录` 的 `<button type="submit">`
- **登出按钮**:右上角文案 = `登出`
- **开始会议按钮**(首页):文案 = `开始会议`,点后 `POST /api/meetings` → 跳 `/meeting/<id>`
- **开始会议按钮**(会议页):同样文案,点击后唤起 mic 权限
- **删除按钮**:文案 = `删除`(知识库/会议/Agent 都用同一个文案)。点击后**不会**弹原生 `confirm()`,而是渲染一个 `<div role="dialog" data-testid="confirm-dialog">` 模态框。模态框里有两个按钮:
  - `data-testid="confirm-dialog-confirm"` — 红色,文案「删除」(或 `confirmLabel` 指定的)
  - `data-testid="confirm-dialog-cancel"` — 灰色,文案「取消」
  - 按 Escape 也可关闭。
- **AI 专家头像条**:`<button>` 包含一个圆形头像(背景色 = Agent.color)+ Agent 姓名。
- **拉取模型列表按钮**:文案 = `拉取模型列表 ↻`,在 `/admin/models` 每个 Provider 卡片右上角(Model ID 标签旁)。
- **「设为默认」复选框**:文案 = `设为默认（仅一个 provider 可同时为默认）`
- **会议详情 H1**(v9 起):显示**会议标题**(从 `GET /api/meetings/{id}.title`),不再是写死的「实时字幕 · 异步贴姓名」
- **错误 toast**:右上角浮层,5xx 红色、4xx 琥珀。文案是 FastAPI `detail` 字段(v9 修复:不再泄露 API 路径或原始 502 HTML)
- **Toaster**(全局):挂在 `<body>` 顶层

### 4. 哪些用例 Cowork 可独立完成,哪些需要人 / 物理设备

> **总原则(v11)**:除了 B/C/D 这三个**直接依赖真实人声**的系列外,**所有系列都已具备 REST 驱动路径**,Cowork 可以独立完整跑通。下表的 ❌ 只标真人声音不可绕开的项;凡 ✅ 都给出了具体执行手段。

| 系列 | 自动化能跑? | Cowork 驱动方法(精确到 API / DOM) |
|---|---|---|
| A 账号 | ✅ 全自动 | `POST /api/auth/register \| login` + cookie;`/api/auth/me` 验证登录态 |
| **B 声纹录入** | ❌ **必须人声** | 35-45s 真人朗读音频流;无法用文字模拟。**唯一无法 Cowork 化的系列。** |
| **C 实时字幕(ASR)** | ❌ **必须人声** | 真人麦克风 → DashScope STT;无法用文字模拟。**但「会议生命周期」可用 manual-transcript 模拟整场对话。** |
| **D 声纹识别** | ❌ **必须人声** | 依赖 B 录入 + C 真音频对齐识别;两者都是真人声路径。 |
| E 手动纠错 | ✅ 全自动 | `manual-transcript` 注入若干行 → `correct-speaker` 改 speaker_user_id → `GET /result` 验证 |
| F AI 专家触发 | ✅ 全自动 | manual-transcript 注入命中 keyword 的句子 → `GET /agent-messages` 看是否真发言;手动召唤直接 WS `invoke_agent` |
| G 自动纪要 | ✅ 全自动 | manual-transcript 注入 ≥ 3 句 + ≥ 60 字 → `POST /summary/regenerate` → `GET /summary` 等 status=ready |
| H 长期记忆 | ✅ 全自动 | summary 生成后,`memory_extractor` 后台抽事实;`GET /api/memory` 看条目;`A-5` 间接验证隔离 |
| I 会前简报 | ✅ 全自动 | `GET /api/meetings/{id}/briefing` 直接读;先注入纪要才有内容 |
| J 会议历史 + 删除 | ✅ 全自动 | `GET /api/meetings`、`DELETE /api/meetings/{id}`;**只删 Cowork 自己创建的(`_cowork_*` 前缀)** |
| K LLM/Agent 后台 | ✅ 全自动 | CRUD 全 API 化;`/list-models` 拉模型列表 |
| L 边界 | ⚠️ 部分 | Back/Forward 可在 Chrome MCP 模拟;多浏览器 / iOS Safari 仍需真机 |
| M 错误 toast | ✅ 全自动 | 故意发错误请求(空 body / 错 cookie / 不存在 ID)看 toast 文案 |
| N 审计日志 | ✅ 全自动 | `GET /api/audit?action=...` 直接验证 |
| O 团队管理 | ✅ 全自动 | 邀请创建 / 撤销 / 移除成员全 API 化;接受邀请用第二个 fetch 上下文(独立 cookie jar)模拟新成员 |
| P 找回密码 | ⚠️ 慎跑 | 全自动可跑,但 P-5 会改密码 — **建议先注册 throwaway 账号** |
| Q 知识库 | ✅ 全自动 | CRUD + 文件上传(`Blob` 构造 + `multipart`) |
| R 会议导出 | ✅ 全自动 | `GET /api/meetings/{id}/export?format=md\|docx` 拿 blob,校验 `Content-Disposition` |
| S 连接稳定性 | ⚠️ 限 Chrome MCP | 真实断网需要 Chrome devtools Network → Offline,Cowork 经 chrome-mcp 可跑 |
| T Agent 接力 | ✅ 全自动 | manual-transcript 注入两人对话 → manually invoke 一个 Agent → 等 `agent_recommendation` WS 事件;无 WS 时检查 `meeting_agent_message` 看是否触发了下一位 |
| U 分歧检测 | ✅ 全自动 | manual-transcript 注入对立观点 5-8 句 + 不同 speaker_user_id → 等 25s 节流过 → 通过 WS 收 `dissent_detected` 或检查 audit_log |
| V v8/v9 回归 | ✅ 全自动 | DOM + Console 检查为主;chrome-mcp 跑 |
| **W 文字录入** | ✅ 全自动 | `manual-transcript` REST + UI `data-testid="manual-text-input"` |
| **X M3.0 自动主持人** | ✅ 全自动(**v11 新增**) | 创建会议带 `agenda` → manual-transcript 注入跑题对话 → 等 `agenda_off_topic` 事件 / 检查 banner DOM;`GET /actions` 看抽取的待办;`PATCH` 切换状态 |

### 5. Cowork 测试纪律

1. **测试数据隔离**:Cowork 创建的所有可识别数据**必须**以 `_cowork_` 或 `_test_` 前缀命名(Agent 名 / 知识库名 / 会议标题 / 邀请邮箱),便于事后批量清理。
2. **不动生产数据**:不删不属于自己创建的会议 / 知识库 / Agent;不切换默认 LLM Provider;不改默认账号的密码 / 邮箱。
3. **不点击有风险的按钮**:除非测试用例明确要求,不点「删除工作空间」、「禁用所有 AI 专家」之类影响面大的操作。
4. **测试结束清理**:每条 Cowork 自己创建的资源在测试结束时通过 API DELETE 掉。可以一份汇总日志:「我创建了 X / Y / Z,已清理」。
5. **Toast / 状态推断**:UI 状态变化等待最多 5 秒;长任务(声纹识别、文档解析)轮询时 30 秒上限就退;真等不到就把现状写进「实际结果」字段而不是死等。
6. **抓证据**:失败时同时记录:Console 红字(`mcp__claude-in-chrome__read_console_messages`)、网络请求(`mcp__claude-in-chrome__read_network_requests`)、关键 DOM 截图(`computer screenshot`)。

### 6. Cowork 可直接复用的辅助代码片段

```js
// 1. 验证登录态 (cookie-based)
await fetch('/api/auth/me').then(r => r.json())
// → {user_id, name, ..., workspace_id, workspace_name}

// 2. 创建测试会议(标题以 _cowork_ 开头便于清理)
const m = await fetch('/api/meetings', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: JSON.stringify({title: '_cowork_smoke_' + Date.now(), attendee_user_ids: []}),
}).then(r => r.json())

// 3. 拉取会议字幕(注意是 /result,不是 /transcript)
await fetch(`/api/meetings/${m.id}/result`).then(r => r.json())

// 4. 下载导出文件
const r = await fetch(`/api/meetings/${m.id}/export?format=md`)
console.log(r.headers.get('Content-Disposition'))

// 5. 删除自己创建的会议
await fetch(`/api/meetings/${m.id}`, {method: 'DELETE', credentials: 'include'})

// 6. 文字录入(v10 起,Cowork 主用入口) — 注入一句字幕,触发 Agent
//    speaker_user_id 可选;省略则记为「未识别」
await fetch(`/api/meetings/${m.id}/manual-transcript`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: JSON.stringify({
    text: '产品的合规风险需要法务把关一下',
    speaker_user_id: null,  // 或某个真实 user.id
  }),
}).then(r => r.json())
// → {line_id: 1234, speaker_user_id: null, speaker_name: null, text: '...'}
// 副作用:
//   - meeting_transcript 多一条 final 行(speaker_status='manual')
//   - maybe_invoke_agents 后台跑,匹配 keywords/@ 的 Agent 自动发言(若节流允许)
//   - maybe_detect_dissent 后台跑(节流 25s)
// 验证 Agent 是否真发言:轮询 GET /api/meetings/{id}/result,若有 agent_messages 则成功

// 7. 等 Agent 发言落库后再读纪要内容
//    Agent 持久化存在 meeting_agent_message 表,/result 不直接返回它们;
//    更可靠的方法是直接订阅 WebSocket 拿 agent_message_* 事件流。
```

---

## 版本与变更记录

| 版本 | 时间 | 变更摘要 |
|---|---|---|
| **v12** | 2026-05-08 | **修掉 v11 QA 报告的全部 5 个发现**:① ISSUE-1: `/result` 返回的 line 同时带 `id` 和 `line_id`(POST 一致);② ISSUE-2: dissent + agenda 检测器都写 `audit_log` (`dissent.detected` / `agenda.agenda_off_topic` / `agenda.agenda_time_warning`);manual-transcript 第一次注入时把 `meeting.status` 从 `scheduled` 翻到 `ongoing` + 记 `started_at`;③ ISSUE-4: 新增 `POST /api/meetings/{id}/agenda-monitor/run-now` 同步触发(绕过 60s 节流 + 90s 抑制),返回 banner payload;④ ISSUE-3: action_extractor prompt 重写,加 5 条 NEGATIVE 规则 + 2 个 few-shot,纯闲聊纪要现在返回 `[]`;⑤ ISSUE-5: 跑了一轮 prune_noise_users,删掉 noise 名(脏数据再清理一轮) |
| v11 | 2026-05-08 | 新增「自动主持人」X 系列(M3.0 Multi-Agent V2):① **议程**(meeting.agenda)— 创建会议时填议程项 + 时间预算 → 进入 LLM 监督 ② **主持人 Agent**(role='moderator')每个 workspace 自动建一个 ③ **跑题检测**(`agenda_off_topic`)+ **时间预警**(`agenda_time_warning`)WS 事件 → 主持人 banner ④ **行动项自动抽取**(MeetingActionItem 表 + action_extractor 接在 summary 之后)+ ActionItemsCard UI(勾选完成 / 手动添加 / 删除)⑤ **agent-messages 端点**(Cowork 验证 Agent 是否真发言);**给 Claude Cowork 的指南**重写为「全场景驱动方案」,明确除 B/C/D 三个真声纹系列外,**所有系列都有可执行的 REST 流程** |
| v10 | 2026-05-08 | 新增「文字录入」W 系列(打字录入入口 — 麦克风的替代,亦是 Cowork 全自动测试主力):① 会议页底部新增 `[💬 发言人下拉] [文字框] [发送]` 工具栏(`data-testid="manual-text-input"`);② WS 新增 `text_message` action(走与 ASR final 相同管道,触发 Agent + 分歧检测);③ 新增 REST `POST /api/meetings/{id}/manual-transcript`(无 WS 时也可注入字幕,Cowork 主用此入口);④ 麦权限拒绝时不再断开 WS,自动进入「⌨️ 仅文字模式」让用户继续打字 |
| v9 | 2026-05-08 | 加【给 Claude Cowork 的指南】(API 速查表 / DOM 选择器约定 / 自动化纪律 / 复用代码片段);**v8 测试报告 6 个问题全部修掉**:① 详情页根据 `meeting.status` 切换渲染(已处理 → 直接显示纪要+实录,不再卡在「开始会议」UI);② 详情页 H1 显示真实会议标题(不再写死);③ API 错误 toast/message **不再泄露路径或原始 502 HTML**(自定义 `ApiError` + `friendlyDetail`);④ 三个 `window.confirm()` 全替换成 `<ConfirmDialog data-testid="confirm-dialog">` 应用内模态(自动化可点);⑤ `DELETE /team/members/<self>` 早返回 400(之前 500);⑥ `agent.create/update/delete` 都补上 `audit_log`;⑦ 顺手修了一个找到的脏数据 bug:`POST /api/users` 没邮箱时不再每次新建一行(同名 286 条 hefan 的元凶) |
| v8 | 2026-05-08 | 文档头部加【系统概览】(架构图 / 数据流 / 触发路径 / 测试入门顺序);修复 `audioCapture.ts` 中 `audioWorklet` getter 在 prototype 上访问抛 `Illegal invocation` 的崩溃 bug → 影响 Sprint K.2 后所有进入会议页的用户(C 系列重点回归);加 SSR/CSR 水合 mounted 守卫(防 React #418) |
| v7 | 2026-05-08 | 新增「分歧检测」U 系列(Multi-Agent M2.3:LLM 实时分析最近 8 句对话,识别两位以上参会人就同一话题持对立观点 → 主动召唤适合仲裁的 AI 专家;rose 色 banner,点「召唤<专家>」一键解决) |
| v6 | 2026-05-08 | 新增「Agent 接力」T 系列(Multi-Agent Orchestrator V1:AI 专家发言完毕后系统推荐下一位发言专家;点击直接召唤) |
| v5 | 2026-05-08 | 新增「会议导出」R 系列(MD/DOCX 下载) 和「连接稳定性」S 系列(WS 自动重连); C 系列加入 iOS Safari 提醒条 (C-11); 通用列表加载态升级为 skeleton |
| v4 | 2026-05-07 | 新增「知识库」Q 系列(KB CRUD + 文档上传 + 解析状态 + Agent 引用 KB)；F-2 注解 AI 回答会优先引用知识库片段 |
| v3 | 2026-05-07 | 新增「团队管理」O 系列（邀请/接受/移除）和「找回密码」P 系列；A-4/A-5 注解工作空间隔离仍生效；登录页加「忘记密码」入口 |
| v2 | 2026-05-07 | 新增「错误 toast」「审计日志」两个系列；E 系列加入会议中纠错（E-6）和防覆盖人工纠错（E-7）；J 系列加入删除会议（J-5）；麦克风权限拒绝预期改为 sticky toast |
| v1 | 2026-05-06 | 第一版，覆盖 A-L 12 个系列共约 70 条用例，包含 round-1 bug fix 验证 |

## 测试环境

| 项 | 值 |
|---|---|
| 入口 | https://aimeeting.zhzjpt.cn |
| 默认账号 | `bluesurfiregpt@gmail.com` / `aimeeting123` |
| 默认工作空间 | 默认工作空间（已含 4 Agent · 6 用户 · 9+ 会议 · 165+ 条记忆） |
| 主测浏览器 | Chrome 桌面（最新） |
| 兼容性副测 | Edge 桌面 / macOS Safari / iOS Safari |
| 麦克风 | 任意可用麦克风（建议 USB / 无线耳麦） |
| 测试服务端 | 47.245.92.62(阿里云 ECS · 上海) |

## 关键已知约束（不算 bug）

- 邓西、幸世杰是**声纹用户**（无密码），出现在录入列表但不能登录
- 极短会议（< 3 句 final 字幕 或 < 60 字）会**故意**跳过纪要生成
- 同一工作空间暂不能多人共享（Sprint F.1 已做,见 O 系列）
- 严格模式（v2 round-2 改进）：声纹宁可标"未识别"也不强行匹配，**部分语音"未识别"是预期行为**
- AI 专家自动触发有 30s 节流;分歧检测 25s 节流 + 60s 抑制(防止打扰)
- 进入会议页若看到 chrome `Illegal invocation` 错误 → **已在 v8 修复**,如再现请立即报告

---

## A 系列 · 账号与权限

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **A-1** | 首次访问跳登录 | 1. 清浏览器 cookie<br>2. 访问 `/`、`/admin/agents`、`/meetings` 任一 | 立即跳到 `/login?next=原路径` | | |
| **A-2** | 用默认账号登录 | 1. `/login`<br>2. 输入默认账号密码<br>3. 提交 | 跳回首页；右上角显示「默认工作空间 · Bluesurfire · 登出」 | | |
| **A-3** | 错误密码 | 1. `/login`<br>2. 输入正确邮箱 + 错误密码 | 显示「incorrect email or password」红色错误，留在登录页 | | |
| **A-4** | 注册新账号 | 1. `/register`<br>2. 填邮箱、姓名、6 位以上密码、可选工作空间名 | 注册成功，自动登录，跳到首页；右上角显示**新工作空间名** | | |
| **A-5** | 工作空间隔离 | 1. 用新账号（A-4）登录<br>2. 进 `/admin/agents`、`/admin/memory`、`/meetings`<br>3. 全部应为空 | 三个页面都显示"还没有..."的空态；**看不到**默认工作空间的 4 个 Agent / 165 条记忆 / 9 场会议 | | |
| **A-6** | 切回默认账号 | 1. 登出<br>2. 用 `bluesurfiregpt@gmail.com` 重新登录 | 重新看到所有原数据 | | |
| **A-7** | 关闭浏览器保留登录 | 1. 登录后关浏览器<br>2. 重开访问 `/` | 不需要重登（cookie 14 天有效） | | |
| **A-8** | 登出 | 点右上角「登出」 | 跳回 `/login`；再访问任何页面会再次跳登录 | | |
| **A-9** | 密码长度校验 | 注册时填 < 6 位密码 | 显示"密码至少 6 位" | | |
| **A-10** | 重复邮箱 | 注册一个已存在的邮箱 | 显示"email already registered" | | |

---

## B 系列 · 声纹录入

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **B-1** | 录入新人声纹 | 1. `/enroll`<br>2. 输入姓名（如"测试员A"）<br>3. 点「开始录音」<br>4. 朗读卡片上的小文 35-45 秒<br>5. 点「停止并上传」 | 显示绿色 ✅ 录入成功；下方"已录入的人"列表中出现该人，绿色"声纹已录入"徽标 | | |
| **B-2** | 朗读时间过短 | 录 5 秒就点停止 | 红色 ❌ 失败：「effective speech only X.Xs (need ≥20s)」 | | |
| **B-3** | 静音过多 | 麦克风开着但中途长时间不说话 | 红色 ❌ 失败：「too much silence」 | | |
| **B-4** | 录音过小声 | 离麦克风很远轻声说 | 红色 ❌ 失败：「recording is too quiet」 | | |
| **B-5** | 重新录入已有用户 | 1. 列表中点某人后面的「重新录入」按钮<br>2. 表单顶部出现该用户姓名<br>3. 重录 35s | 显示绿色 ✅ 重新录入成功；旧声纹被自动停用 | | |
| **B-6** | 切换朗读小文 | 录音前点「换一段 ↻」 | 卡片内容立即换成另一段 | | |
| **B-7** | 录音过程中页面状态 | 录音时观察页面 | 进度条按时间填充；卡片高亮蓝色边框；"录音中..."状态文字 | | |
| **B-8** | 录到 60s 自动停止 | 一直录不点停止 | 60 秒到自动停止上传 | | |

---

## C 系列 · 实时字幕

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **C-1** | 创建会议并开始 | 1. 首页<br>2. 输入标题<br>3. 勾选 1-3 个声纹用户<br>4. 点「开始会议」<br>5. 进会议室点「开始会议」按钮<br>6. 浏览器提示麦克风权限 → 允许 | 状态条变绿："已连接，开始说话" | | |
| **C-2** | 字幕实时滚动 | 自然说话 30 秒 | 字幕一边说一边出；非 final 灰色显示 ▌光标，final 后变白色 | | |
| **C-3** | 麦克风权限拒绝（v2 改进） | 拒绝浏览器权限弹窗 | 状态条显示明确错误；**右下角弹一条红色 sticky toast**，文案明确告诉用户怎么操作（"点击地址栏左侧锁/相机图标 → 允许麦克风,然后刷新页面"） | | |
| **C-4** | 多人轮流说话 | 让 2-3 个录过声纹的人轮流说话 | 字幕都正常出，**说话人姓名稍后异步贴上**（见 D 系列） | | |
| **C-5** | 长会议（5 分钟+） | 持续讨论 5+ 分钟 | 字幕一直滚动，无明显延迟（< 3s） | | |
| **C-6** | 中途停顿超 15 秒 | 故意安静 20 秒 | 后端会断开 STT 连接；新说话时自动重连，字幕继续 | | |
| **C-7** | 结束会议 | 点「结束会议」按钮 | 状态条变橙："会议已结束，正在做最后一次声纹识别…" | | |
| **C-8** | 网络中断 | 录音中拔网线 5 秒再插回 | 状态条显示"连接已断开"；不应崩溃 | | |
| **C-9** | 麦克风被占用 | 让别的应用占用麦（如 Zoom 在通话）后开会 | sticky toast 提示："麦克风被其他应用占用,请先关闭它们" | | |
| **C-10** | 没有麦克风设备 | 拔掉所有麦克风后开会 | sticky toast 提示："未检测到可用麦克风。请插上耳麦/麦克风后再试" | | |
| **C-11** | iOS Safari 提示条（v5 新增） | 用 iPhone Safari 打开 `/meeting/<id>` | 字幕区上方出现蓝色 iOS Safari 提示条，告诉用户允许麦权限 + 保持前台 | | |

---

## D 系列 · 声纹识别（**round-2 加严验证**）

> **基线变化**：v2 阈值从 0.7 提到 0.75，要求字幕 70% 时长落在匹配段，过滤 < 1s 的微短段。**结果"未识别"行会比 v1 多一些**，这是预期。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **D-1** | 单人会议姓名贴上 | 1. 创建会议勾选 1 人<br>2. 该人完整朗读 1 分钟 | 字幕前**逐渐**出现彩色姓名（45 秒后） | | |
| **D-2** | 多人会议姓名分清 | 2 人轮流说话 | 不同说话人的字幕前显示**不同人的姓名**，颜色也不同 | | |
| **D-3** | **环境音不被错误归属** | 1. 会议中突然播放视频或电视 30 秒<br>2. 等识别完成 | 视频/电视的字幕**应保持灰色「未识别」**，不应被贴上某个参会人的姓名 | | |
| **D-4** | **未勾选人员的语音不归属其他人** | 1. 会议只勾选 A<br>2. 让 B（已录过声纹但未勾选）说话 30s | B 的字幕**应保持「未识别」**，不应被错误贴上 A 的姓名 | | |
| **D-5** | 完全未录声纹的人说话 | 1. 让一位未在系统录过声纹的人说话 | 字幕保持「未识别」 | | |
| **D-6** | 短句（"嗯"、"对"）识别 | 单人会议中夹杂"嗯"、"对" | 这类极短词大概率「未识别」（属于预期，因为 < 70% 落入声纹段） | | |
| **D-7** | 识别完成时间 | 会议结束后观察 | 通常 10-30s 内识别完成 | | |

---

## E 系列 · 手工纠错说话人（**round-2 改进：会议中也能纠错**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **E-1** | 纠错按钮始终可见 | 任意 final 字幕（白色字） | 每行字幕前的说话人标签**直接是一个可点按钮**（紫框 / 灰框 + ✏️ 图标），不需要 hover | | |
| **E-2** | 改正错误归属 | 1. 找一行被错误归属的字幕<br>2. 点姓名按钮<br>3. 下拉里选正确的人 | 姓名立即更新为新人；下次进入此会议仍显示新姓名 | | |
| **E-3** | 未识别行可点 | 找一行「未识别」灰字 | 也能点开下拉，能选参会人或保持「未识别」 | | |
| **E-4** | 标记为未识别 | 1. 点已有姓名的行<br>2. 选下拉最底「标记为未识别」 | 该行变灰 「未识别」 | | |
| **E-5** | 纠错持久化 | 1. 改完几行<br>2. 刷新页面 | 改的内容仍在 | | |
| **E-6** | **会议进行中纠错（v2 新增）** | 1. 会议**正在进行**（不要点结束）<br>2. 等几句字幕变成 final（白色）<br>3. 点该字幕开头的姓名按钮 | 立刻弹出下拉；选一个人 → 立即生效，**会议继续进行不会被打断** | | |
| **E-7** | **人工纠错不被自动覆盖（v2 新增）** | 1. 会议中纠正一行的说话人<br>2. 继续开会 1-2 分钟（让后台的周期性自动识别再跑 1-2 次）<br>3. 看那行 | 你纠正的姓名**保持不变**，不会被自动识别覆盖回原来的错误 | | |

---

## F 系列 · AI 专家

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **F-1** | 头像条显示 | 创建会议进入会议室（开始之前） | 字幕区上方一排彩色头像（产品/法务/架构/项目推进 4 个） | | |
| **F-2** | 点头像触发发言 | 1. 点「开始会议」<br>2. 说几句话<br>3. 点紫色「产品专家」头像 | 几秒后字幕区出现紫色边的 AI 气泡，回答**有立场**（"我建议..."、"不建议..."） | | |
| **F-3** | 关键词触发 | 1. 会议中说"我们要考虑合规风险" | 应触发**法务专家**（关键词"合规""风险"） | | |
| **F-4** | @ 显式调用 | 1. 会议中说"@产品专家 这个需求怎么看" | 触发产品专家发言 | | |
| **F-5** | AI 思考时头像状态 | F-2 操作后立即看头像 | 该头像**变灰 + 旁边脉冲点**，本次完成前不能再点 | | |
| **F-6** | 限流：30s 内同 Agent 不重触 | 自动触发某 Agent 后，30 秒内再说同样关键词 | 不应再次触发（避免吵） | | |
| **F-7** | 多 Agent 切换 | 依次点不同头像 | 各自正常发言；不同颜色边框 | | |
| **F-8** | 跨会议引用记忆 | 1. 创建标题含"AI 会议系统"的新会议<br>2. 进会议室开始<br>3. 说"我们继续上次的话题"<br>4. 点产品专家 | AI **应主动引用**之前的决策（如"上次决定先做 AI 专家功能"） | | |

---

## G 系列 · 自动纪要

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **G-1** | 正常会议纪要 | 1. 跑一场 1-2 分钟、5+ 句话的会议<br>2. 结束 | 字幕区上方出现「📋 会议纪要」卡片；状态从「生成中…」（黄）变成「✓ 已生成」（绿）；含 8 个二级标题；2-30 秒内完成 | | |
| **G-2** | 极短会议跳过纪要 | 1. 跑一场只说一两句、< 60 字的会议<br>2. 结束 | 纪要卡片显示**「已跳过」灰色徽标 + "实录过短(共 X 句, X 字),未生成纪要"** 的解释；**不应**强行生成 8 节模板 | | |
| **G-3** | 重新生成 | 已有纪要的会议点「重新生成」 | 状态变回「生成中…」；20-30 秒后出新版本 | | |
| **G-4** | 纪要内容质量 | 看 G-1 出的纪要 | 应包含：会议主题（精炼一句）、概览、关键要点、决策（含决策人）、待办（含负责人）、下一步建议 | | |
| **G-5** | 纪要识别废话 | 会议中故意说一些与议题无关的话 | 纪要应将无关内容标注或忽略，不堆进决策/待办 | | |

---

## H 系列 · 长期记忆

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **H-1** | 记忆数累积 | 1. 进 `/admin/memory`<br>2. 记下当前数（应 ≥ 165）<br>3. 跑一场内容丰富的会议<br>4. 等纪要生成（10-30s）+ 抽取（20-40s）<br>5. 刷新 `/admin/memory` | 顶部数字应**变大**（增加 5-15 条不等） | | |
| **H-2** | 按 scope 过滤 | 选 user / project / org | 列表只显示对应 scope 的条目 | | |
| **H-3** | 按关键字过滤 | scope_ref 里输"邓西"或"AI 会议系统" | 只显示该范围的记忆 | | |
| **H-4** | 手工添加记忆 | 1. 填 scope/scope_ref/内容/重要度<br>2. 点添加 | 列表顶部出现新加的条目，标记 source: manual | | |
| **H-5** | 删除记忆 | 任一条目右侧点「删除」 | 二次确认后删除；列表立即更新 | | |
| **H-6** | 工作空间不互通（与 A-5 配合） | 1. 在新工作空间（A-4）打开 `/admin/memory` | 显示空，看不到默认工作空间的 165 条 | | |

---

## I 系列 · 会前简报

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **I-1** | 相关历史会议触发简报 | 1. 创建标题包含"AI 会议系统"或"合规"等已存在主题词的会议<br>2. 进会议室（不要点开始） | 顶部出现琥珀色 💡「会前简报」卡片，包含：上次相关结论 / 仍未关闭的事 / 需要重点关注 | | |
| **I-2** | 无关主题不显示简报 | 创建一个标题完全无关的会议（如"测试 xyz"） | **不显示**简报卡片（因为没有相关历史） | | |
| **I-3** | 简报内容质量 | 看 I-1 的简报 | 内容必须基于真实历史记忆，**不能编造**新事实 | | |

---

## J 系列 · 会议历史 + 删除（**v2 新增 J-5**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **J-1** | 列表加载 | 进 `/meetings` | 显示所有过往会议，按时间倒序 | | |
| **J-2** | 状态徽标 | 看每个会议右侧 | 颜色徽标：未开始 / 进行中(绿) / 刚结束(橙) / 已处理(紫) | | |
| **J-3** | 参会人显示 | 看每行 | 列出参会人姓名 | | |
| **J-4** | 点入详情 | 任一会议点击 | 进入会议详情页（含纪要、字幕） | | |
| **J-5** | **删除会议（v2 新增）** | 1. `/meetings`<br>2. **鼠标移到任一行**<br>3. 右侧出现"删除"按钮，点击<br>4. 确认对话框 | 二次确认后会议消失；该会议的字幕、纪要、音频片段全部删除；**该会议抽出的长期记忆保留**（仍可在 `/admin/memory` 看到） | | |
| **J-6** | 删除后审计可查 | 删除一个会议后进 `/admin/audit` | 顶部能看到一条 `meeting.delete` 记录，含会议标题 | | |

---

## K 系列 · LLM / Agent 后台

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **K-1** | LLM 模型列表 | `/admin/models` | 5 个 provider 卡片：通义千问 / OpenAI / Anthropic / DeepSeek / Gemini | | |
| **K-2** | 切换默认 LLM | 在另一 provider 卡片填 key、点保存、勾「设为默认」 | 该 provider 显示「✓ 当前默认」绿色徽标；下次 AI 专家发言用新模型 | | |
| **K-3** | Agent 列表 | `/admin/agents` | 4 个种子 Agent + 各自颜色 + 关键词 | | |
| **K-4** | 编辑 Agent | 点某 Agent「编辑」，改 persona | 保存后下次发言用新 persona | | |
| **K-5** | 新建 Agent | 填名称、persona、关键词、颜色、保存 | 出现在列表中，可在会议中触发 | | |
| **K-6** | 删除 Agent | 任一 Agent 右侧点「删除」 | 二次确认后删除 | | |

---

## L 系列 · 边界情况 / 兼容性

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **L-1** | 浏览器 Back 按钮 | 进会议中途按浏览器 Back | WebSocket 应正常断开，不卡 | | |
| **L-2** | 切到其他 tab 不刷新 | 会议进行中切到其他 tab 1 分钟后回来 | 字幕仍正常工作 | | |
| **L-3** | 双开同一账号 | 同一账号两个 tab 各开一场会议 | 两场会议互不影响 | | |
| **L-4** | iOS Safari 移动端 | iPhone Safari 打开 `/meeting/...` | 至少能加载页面、能开会、能看字幕（探索性测试） | | |
| **L-5** | macOS Safari | Mac 上 Safari 打开 | 完整流程可用 | | |
| **L-6** | Edge 桌面 | Edge 浏览器打开 | 完整流程可用 | | |
| **L-7** | 极慢网络 | Chrome devtools 限速 Slow 3G 进会议 | 字幕延迟变大但不崩溃 | | |
| **L-8** | 不允许麦克风权限（v2 改进） | 浏览器全局禁用麦克风后开会 | **右下角红色 sticky toast** 写明权限被拒 + 解决步骤 | | |

---

## M 系列 · 错误 toast（**v2 新增**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **M-1** | 服务器 5xx 自动 toast | 1. F12 打开 Network<br>2. 触发任一会写库的操作（如点击删除一个不存在的会议 ID） | 右下角弹红色 toast，含状态码 + 服务端 detail；几秒后自动消失 | | |
| **M-2** | 4xx 警告 toast | 触发一个非 401/404 的 4xx（如填错的 form） | 右下角弹**琥珀色** toast，含 `请求失败 (4xx)` + detail | | |
| **M-3** | toast 手动关闭 | 任一 toast 出现后点右上角 ✕ | 立即消失 | | |
| **M-4** | 多个 toast 堆叠 | 短时间触发多个错误 | 多条 toast 从下往上堆，互不遮挡 | | |
| **M-5** | sticky toast 不自动消失 | 麦克风权限拒绝出现的红 toast（C-3） | 不会自动消失，必须用户点 ✕ | | |
| **M-6** | 401 不弹 toast，跳登录 | 在登录态过期后再操作（或手动删 cookie 再操作） | 不弹 toast；直接跳 `/login?next=...` | | |
| **M-7** | 404 不弹 toast | 访问一个不存在的会议 ID（轮询时常态会有） | 不应该满屏 404 toast 打扰用户 | | |

---

## O 系列 · 团队管理（**v3 新增**）

> **前置条件**：用默认账号 `bluesurfiregpt@gmail.com` 登录（owner 角色）。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **O-1** | 进入团队页 | 顶部导航 → 系统配置 → 团队 | 显示"邀请新成员"表单 + "成员"列表（至少 1 个 owner = 你） | | |
| **O-2** | 生成邀请链接 | 1. 填邮箱（可选,如`alice@x.com`）<br>2. 角色选 member<br>3. 点「生成邀请链接」 | 顶部出现绿色 toast "邀请已生成 · 邀请链接已复制到剪贴板"；右侧出现一条"待接受邀请" | | |
| **O-3** | 复制 / 撤销邀请 | 在邀请条目上点「复制链接」/「撤销」 | 复制：toast 提示已复制；撤销：二次确认后该条消失 | | |
| **O-4** | 在新浏览器接受邀请 | 1. 复制 O-2 的邀请 URL<br>2. 在**无痕窗口**或**另一浏览器**打开<br>3. 自动跳到 `/register?invite=xxx`<br>4. 顶部琥珀色卡片显示「你被邀请加入工作空间「默认工作空间」, 角色: member」<br>5. 填姓名、邮箱、密码注册 | 注册成功 → 自动登录 → 进入**默认工作空间**（不是新建一个）；右上角显示「默认工作空间 · <名字>」 | | |
| **O-5** | 验证新成员能看到老数据 | 接受邀请的账号查看 `/admin/agents` 和 `/admin/memory` | 看到 4 个 Agent + 165+ 条记忆（与 owner 共享） | | |
| **O-6** | 验证 member 不能管理团队 | 接受邀请的账号去 `/admin/team` | "邀请新成员"区域显示"只有 owner 或 admin 可以邀请新成员"；不显示"撤销"/"移出"按钮 | | |
| **O-7** | owner 移出成员 | 1. 切回 owner 账号<br>2. `/admin/team`<br>3. 在新成员条目点「移出」 | 二次确认后该成员消失；该成员再访问 → 401 → 跳登录（其原工作空间已无访问权） | | |
| **O-8** | 邀请已被使用不能再用 | 用 O-4 已使用过的邀请 URL 在另一个浏览器打开 | 红色错误："invite already used" | | |
| **O-9** | 不能移除 owner | owner 账号尝试移除自己（如果 UI 让点） | 报错或前端禁用按钮，提示"cannot remove yourself" | | |
| **O-10** | 邀请变成"已过期" | 后端 7 天 TTL；可前端模拟时间 | 列表显示「已过期」灰色徽标，"复制/撤销"按钮变化合理 | | |

---

## Q 系列 · 知识库管理（**v4 新增**）

> **前置**：默认账号登录，进 `/admin/knowledge`。准备一两个 1-3 MB 的 PDF / DOCX / TXT 用于上传测试。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **Q-1** | 进入知识库页 | 顶部导航「知识库」 | 看到"新建知识库"表单 + "已有知识库"列表（初次为空） | | |
| **Q-2** | 新建知识库 | 1. 名称填「产品文档」<br>2. 简介可填可不填<br>3. 创建 | toast 提示"知识库已创建"; 列表里出现新卡片，0 文档 / 0 分块 | | |
| **Q-3** | 进入 KB 详情 | 点 KB 卡片名 | 跳到 `/admin/knowledge/<id>`，显示 KB 名 + 简介 + "上传文档"按钮 | | |
| **Q-4** | 上传 PDF | 点「上传文档」选一个 PDF（1-3 MB）| toast「已上传 X.pdf · 正在后台解析+向量化」；列表里出现一行，状态徽标先是「解析中」（琥珀），几秒后「向量化」，再过几秒变「✓ 就绪」（绿）；显示字符数 + 分块数 | | |
| **Q-5** | 上传 DOCX | 同 Q-4 但选 DOCX | 同样最终变就绪 | | |
| **Q-6** | 上传 TXT/MD | 同 Q-4 但选 .txt 或 .md | 同样最终就绪 | | |
| **Q-7** | 上传不支持的格式 | 选 .exe / .zip / .png | 红色 toast「unsupported file type」 | | |
| **Q-8** | 上传超过 50MB | 准备一个 60MB 文件 | toast「file too large; max 52428800」 | | |
| **Q-9** | 上传空文件 | 创建一个空的 .txt | toast「empty file」或解析后 status=failed 显示「extracted empty text」 | | |
| **Q-10** | 状态自动刷新 | 上传后不刷新页面 | 每 4 秒自动 polling 状态;无需手动刷 | | |
| **Q-11** | 解析失败重试 | 找一个加密的或 OCR-only 的 PDF 上传，等到失败 | 状态显示「失败」+ 红字错误信息；行尾出现「重试」按钮 | | |
| **Q-12** | 删除文档 | 任一文档点「删除」 | 二次确认后从列表消失；服务器端 OSS 也清理 | | |
| **Q-13** | 删除知识库 | 返回 `/admin/knowledge`，KB 卡片 hover 出现"删除" | 二次确认后 KB + 所有文档 + 所有分块全部删除 | | |
| **Q-14** | 工作空间隔离 | 用 A-4 创建的新账号登录 | `/admin/knowledge` 列表为空，看不到默认空间的 KB | | |
| **Q-15** | 给 Agent 绑定 KB | 1. 回 `/admin/agents` 编辑「产品专家」<br>2. 表单中出现"知识库"区，列出所有 KB<br>3. 勾选刚才的"产品文档"<br>4. 保存 | 保存成功；Agent 卡片显示「📚 已绑定 1 个知识库」 | | |
| **Q-16** | **AI 回答引用 KB（核心 fix）** | 1. 创建一场会议<br>2. 开始会议<br>3. 说一句**与上传文档主题相关**的话（如"这个产品的核心功能是什么"），点「产品专家」头像<br>4. 等 AI 回答 | AI 回答中**引用**上传文档的内容(可能写「《文档名》指出...」或类似引用) | | |
| **Q-17** | 没绑 KB 时不引用 | 1. 解绑 KB <br>2. 再问同样问题 | AI 不会引用文档，回答更通用 | | |
| **Q-18** | 多 KB 同时绑定 | 创建第 2 个 KB 上传不同文档；都绑给某个 Agent | 召唤该 Agent 时，引用从两个 KB 中检索（看回答的文档名） | | |
| **Q-19** | 操作日志记录 | 进 `/admin/audit` | 看到 `kb.create`、`kb.upload`、`kb.delete_document`、`kb.delete` 等记录 | | |

---

## T 系列 · Agent 接力推荐（**v6 新增 · Multi-Agent Orchestrator V1**）

> **概念**：当一位 AI 专家发完言，后端会自动判断"接下来谁说更合适"，把建议显示在头像条下方一条琥珀色 banner 上。**用户决定要不要点**——不会自动接管对话。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **T-1** | 接力推荐出现 | 1. 创建会议（≥ 2 个 Agent，比如产品 + 法务）<br>2. 开始会议<br>3. 说一句产品话题（"这个需求要不要做"）<br>4. 点「产品专家」头像 → AI 回答<br>5. 等回答结束 | 几秒后 avatar 条下方出现 💡 banner，写着「建议接下来由 <某 Agent> 发言 — <短句理由>」 | | |
| **T-2** | 推荐符合上下文 | T-1 中产品专家若提到了"合规"、"法务"、"风险"等 | 推荐应是法务专家（理由如"邓西提到合规风险, 听听法务的"） | | |
| **T-3** | 推荐 banner 颜色 | 看 banner 左边的彩色边 | 颜色应等于推荐专家自身的颜色（产品紫 / 法务琥珀 / 架构天蓝 / 项目推进绿） | | |
| **T-4** | 一键采纳推荐 | 点 banner 右侧「请<Agent>发言」按钮 | banner 立刻消失；该 Agent 头像变忙；几秒后 AI 气泡出现 | | |
| **T-5** | 一键忽略推荐 | 点 banner 右侧 ✕ | banner 消失；不触发任何 Agent | | |
| **T-6** | 推荐自动消失 | 不点任何按钮，等 90 秒 | banner 自动消失（过期） | | |
| **T-7** | 推荐被新发言覆盖 | banner 还在，自己再点别的 Agent 头像 | banner 立刻消失；新 Agent 正常发言 | | |
| **T-8** | 不会推荐刚说话的人 | 反复点同一 Agent 头像几次，看推荐 | 推荐绝不会是刚发完言的那位本身 | | |
| **T-9** | 讨论收敛时不打扰 | AI 回答的是"已收敛 / 等待人决策"类内容 | banner **不会**出现（agent_id=null 时静默） | | |
| **T-10** | 候选名单只来自本工作空间 | 不同工作空间的 Agent | 推荐只可能来自当前 workspace，不会跨租户 | | |
| **T-11** | 会议结束后清除 | 推荐还在，点「结束会议」 | banner 消失；不再出现 | | |

---

## U 系列 · 分歧检测（**v7 新增 · Multi-Agent M2.3**）

> **概念**：每一句 final 字幕落库后,后端用 LLM 扫描最近 8 句对话,如果发现**两个或以上参会人就同一话题持对立观点**,就推一条 ⚖️ rose 色 banner,建议召唤最适合仲裁这一争议的领域专家。**用户决定要不要点**——绝不自动接管。
>
> **节流**:同一会议至多 25s 跑一次扫描;一旦触发,后续 60s 静默(防止同一争议反复打扰)。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **U-1** | 触发分歧 banner | 1. 创建会议(默认工作空间含 4 个 Agent)<br>2. 让两位录过声纹的人就同一话题表达对立观点,如「需求要不要做 / 这次先做 A 还是 B / 数据能不能走出境」<br>3. 自然对话 ~5-8 句 | 几秒后头像条下方出现 ⚖️ rose 色 banner:「检测到分歧 「<topic>」 · <理由>」,右侧按钮「召唤<专家>」 | | |
| **U-2** | 仲裁专家匹配领域 | U-1 中:<br>- 谈"合规/数据/采购"→ 应推荐**法务**<br>- 谈"用户价值/优先级"→ 应推荐**产品**<br>- 谈"技术选型/性能/成本架构"→ 应推荐**架构**<br>- 谈"排期/责任人/交付"→ 应推荐**项目推进** | banner 推荐的专家与争议领域吻合;颜色条匹配该专家颜色 | | |
| **U-3** | 一键召唤 | 点 banner「召唤<专家>」按钮 | banner 立刻消失;该专家头像变忙;几秒后 AI 气泡出现,**立场鲜明地仲裁**(query 含"参会人就「<topic>」存在分歧,请你基于自己的领域给出立场鲜明的判断") | | |
| **U-4** | 一键忽略 | 点 banner 右侧 ✕ | banner 消失;不触发任何 Agent | | |
| **U-5** | 自动消失 | 不点任何按钮等 90 秒 | banner 自动消失 | | |
| **U-6** | 同意/接力**不**算分歧 | 让两人就同一话题**互相同意**(「对」「我也这么想」「就按你说的来」),持续 ~6 句 | 不出 banner(模型应判 has_dissent=false 静默) | | |
| **U-7** | 单人发问**不**算分歧 | 一个人连续问几个问题没人回答 | 不出 banner | | |
| **U-8** | 时间线过短**不**算分歧 | 两人刚开始 1-2 句 | 不出 banner(后端要求 ≥ 3 句 final + ≥ 2 个不同已识别说话人才会送给 LLM) | | |
| **U-9** | 未识别说话人**不**送 LLM | 全部声纹都是"未识别"的会议,即使有对立观点 | 不出 banner(named lines < 3 时直接跳过) | | |
| **U-10** | 60s 抑制窗口 | 一次 banner 触发并被忽略后,继续就同一话题对话 | **60 秒内**不会再出 banner;之后才可能再出(防打扰) | | |
| **U-11** | 25s 检测节流 | 频繁说话(每秒一句 final) | 后端不会每句都调 LLM,日志里看 dissent 检测最多 25s 一次 | | |
| **U-12** | 候选专家**只**来自本工作空间 | 用 A-4 创建的新工作空间(可能没有 Agent,或只有 1 个 Agent) | banner 不会推荐其他工作空间的 Agent;若本 ws 没匹配领域专家则静默 | | |
| **U-13** | 跨工作空间隔离 | 用 A-4 账号在自己工作空间制造分歧 | 不会跨租户用默认工作空间的 4 个专家;若没合适专家就不出 banner | | |
| **U-14** | 会议结束后清除 | banner 还在时点「结束会议」 | banner 消失;不再出现 | | |
| **U-15** | banner 与「Agent 接力」共存 | 同时具备:刚有 Agent 发完言(T-1) + 又出现分歧(U-1) | 两条 banner 可同时显示(琥珀 💡 在上,rose ⚖️ 在下),互不影响,各自独立可点/可关 | | |

---

## R 系列 · 会议导出（**v5 新增**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **R-1** | 导出 Markdown | 1. 进任一已有纪要的会议<br>2. 「会议纪要」卡片右侧点「导出 .md」 | 浏览器下载 `<会议标题>.md`；文件含会议元信息、纪要、实录(带时间戳+姓名)、AI 专家发言 | | |
| **R-2** | 导出 DOCX | 同上点「导出 .docx」 | 下载 `<会议标题>.docx`；用 Word/Pages 打开格式正确：标题分级、列表、待办带 ☐ | | |
| **R-3** | 中文文件名 | 会议标题含中文 | 文件名是中文，不是乱码（Content-Disposition 用 RFC 5987） | | |
| **R-4** | 极短会议导出 | G-2 测过的极短会议导出 .md | 应包含元信息 + 实录(仅 1-2 句)；纪要部分为空(因为已跳过)；不抛错 | | |
| **R-5** | 工作空间隔离 | 用 A-4 的新账号尝试导出别人会议的 ID | 404 / 权限拒绝 | | |

---

## S 系列 · 连接稳定性（**v5 新增**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **S-1** | WS 自动重连 | 1. 开始会议<br>2. 浏览器 devtools 切到 Network 选「Offline」(或拔网线 5s)<br>3. 等几秒后切回 Online | 状态条显示「网络中断,正在重连… (第 N 次)」→ 「✓ 已重连,继续说话」；字幕继续工作（中间会缺一小段是预期） | | |
| **S-2** | 多次重连后给放弃 | 长时间断网（> 60s 多次失败） | 状态条显示「多次重连失败,请检查网络后刷新页面」；不再循环重连 | | |
| **S-3** | 用户主动结束不触发重连 | 点「结束会议」按钮 | 状态条转「会议已结束…」并保持；不会出现"重连中..."的状态变化 | | |
| **S-4** | 重连期间 @ Agent 不丢 | 1. 网络刚断时点 Agent 头像<br>2. 等重连成功 | Agent 在重连后应被触发，AI 气泡正常出现 (sendJson 会被 buffer 直到重连) | | |

---

## P 系列 · 找回密码（**v3 新增**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **P-1** | 登录页有入口 | `/login` 页面底部 | 看到「忘记密码？」链接，点击 → `/forgot-password` | | |
| **P-2** | 提交存在的邮箱 | 1. `/forgot-password`<br>2. 填默认账号邮箱<br>3. 提交 | 显示绿色提示卡："如果该邮箱已注册, 我们已生成一条重置链接(有效期 1 小时)" + "请联系管理员从服务器日志中获取重置链接" | | |
| **P-3** | 提交不存在的邮箱 | 用一个未注册邮箱提交 | **同样**显示成功提示（防止枚举注册邮箱） | | |
| **P-4** | 后端日志含 reset link | 服务端 `docker compose logs backend --tail 20` | 包含 `password reset requested for X; link (valid 1h): https://aimeeting.zhzjpt.cn/reset-password?token=...` 行 | | |
| **P-5** | 用 token 重置密码 | 1. 复制日志中的链接<br>2. 浏览器打开<br>3. 输入新密码 + 确认密码<br>4. 提交 | 跳到首页（自动登录）；右上角是该用户的工作空间 | | |
| **P-6** | 用旧密码登录失败 | 用旧密码登录默认账号 | 红色错误："incorrect email or password" | | |
| **P-7** | 用新密码登录成功 | 用 P-5 的新密码登录 | 成功 | | |
| **P-8** | token 单次使用 | 用 P-5 已用过的链接重新打开 → 提交 | 红色错误："token already used" | | |
| **P-9** | token 过期 | （等 1 小时或后端调短 TTL）用过期 token 重置 | 红色错误："token expired" | | |
| **P-10** | 密码长度校验 | 重置时填 < 6 位密码 | 显示"密码至少 6 位" | | |
| **P-11** | 两次输入不一致 | 重置时两栏填不同 | 显示"两次输入的密码不一致" | | |
| **P-12** | 缺 token 链接 | 直接打开 `/reset-password`（无 token 参数） | 红色提示"链接缺少 token"；"重置密码"按钮置灰 | | |

> **测试结束后**：把 default 账号密码改回 `aimeeting123`（或告诉我新密码），方便后续测试团队继续用。

---

## N 系列 · 审计日志（**v2 新增**）

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **N-1** | 创建会议被记录 | 1. 创建一个会议<br>2. 进 `/admin/audit` | 顶部能看到一条 `meeting.create` 记录，含会议标题、参会人数、操作人姓名、时间 | | |
| **N-2** | 删除会议被记录 | 1. 删除某场会议<br>2. 进 `/admin/audit` | 顶部能看到一条 `meeting.delete` 记录 | | |
| **N-3** | 按 action 过滤 | 在过滤框输入 `meeting.create` | 列表只剩 create 类型 | | |
| **N-4** | 跨工作空间隔离 | 用账号 X 看到工作空间 A 的日志后，切到工作空间 B（A-5 创建的） | 看到的是 B 的日志，**不应**看到 A 的 | | |
| **N-5** | 日志按时间倒序 | 多操作几次后看 `/admin/audit` | 最新的在最上面 | | |
| **N-6** | payload 渲染 | 看 `meeting.create` 详情 | payload JSON 块展开，含 `title`、`attendee_count` 等字段 | | |

---

## V 系列 · v8 回归(关键 bug 防回退)

> **背景**:v8 修复了一个进入会议页就直接抛 `TypeError: Illegal invocation` 的崩溃 bug,根因是 `AudioContext.prototype.audioWorklet`(getter)在原型上访问会触发 getter 但 `this` 不是真实实例,因此抛错。**本系列必跑,确认在所有目标浏览器上不再复现**。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **V-1** | Chrome 桌面进会议页不崩 | 1. Chrome 桌面登录<br>2. 进任一已有会议(`/meeting/<id>`)<br>3. 打开 DevTools Console | 页面正常渲染:看到「开始会议」「结束会议」按钮 + AI 专家头像条;**Console 无任何红字错误** | | |
| **V-2** | Edge 桌面进会议页不崩 | 同 V-1 但用 Edge | 同上 | | |
| **V-3** | macOS Safari 进会议页不崩 | 同 V-1 但用 macOS Safari | 同上(allow audio worklet 检测应返回 true,但不抛错) | | |
| **V-4** | iOS Safari 进会议页不崩 | iOS 真机 Safari 登录 → 进会议页 | 顶部出现蓝色 iOS 提示条;按钮正常;Console 无错 | | |
| **V-5** | 老 Safari(< 14)兼容 | 如有 macOS 11 / iOS 13 设备 → 进会议页 | 因为旧版没有 audioWorklet,此前版本就会进 catch;新版用 `in` 算子,`in` 返回 false,页面照常渲染,只是 `hasAudioWorklet` 为 false | | |
| **V-6** | 隐私模式 / 麦克风未授权 | Chrome 隐私模式登录(凭证仍能用) → 进会议页(还没点开始) | 不应崩;按钮可见;点开始才弹麦权限 | | |
| **V-7** | 不安全上下文(纯 IP/HTTP) | 用 `http://47.245.92.62:3000/meeting/<id>` 直连(若开放) | 不应崩,应明确显示「⚠️ 当前页面不在安全上下文中」红条 | | |
| **V-8** | 水合无 React #418 | 进会议页后 Console 看 React 错误 | **不应**出现 `Minified React error #418`(水合不一致);旧版会出 | | |
| **V-9** | 多次反复进退会议页 | 进 → 返回 → 再进 → 重复 5 次 | 每次都正常渲染;无内存泄漏报错;无重复创建 AudioContext 的警告 | | |
| **V-10** | 已处理会议详情页直接显示纪要 + 实录(v9 P0 回归) | 1. `/meetings` 找一条紫色「已处理」徽标的会议<br>2. 点进详情<br>3. 等加载 | **不应**只看到「开始会议」按钮和会前简报。应直接看到:① H1 显示**会议真实标题**(不是「实时字幕 · 异步贴姓名」);② 「会议纪要」卡片(SummaryCard);③ 字幕实录区有内容;④ 「导出 .md / 导出 .docx」按钮可用 | | |
| **V-11** | 会议详情 H1 是会议标题(v9 UX 回归) | 同 V-10 | H1 文案 = `meeting.title`(如「测试会议 5 月 8 日」),feature 描述「实时字幕 · 异步贴姓名」降级为副标题(更小 / 更灰) | | |
| **V-12** | 错误 toast 不泄露 API 路径 / HTML(v9 P1+P2 回归) | 1. 登出<br>2. 故意用错误密码登录,或注册重复邮箱<br>3. 看右下角 toast | toast 文案应是 FastAPI `detail` 字段(如 `incorrect email or password`、`email already registered`)。**不应**包含 `/api/auth/...`、`401`、`409`、`502 Bad Gateway nginx/...` 等 | | |
| **V-13** | 502 时不渲染 nginx HTML(v9 P1 回归) | 模拟后端瞬时挂掉(可临时 `docker stop aimeeting-backend` 5 秒)再尝试任意操作 | 表单/页面文本里**不应**出现 `<html>`、`502 Bad Gateway`、`nginx/1.18`。只看到友好提示「服务器暂时不可用,请稍后重试」 | | |
| **V-14** | 删除按钮触发应用内模态(v9 P3 回归) | 1. 进 `/admin/agents`<br>2. 在任一 Agent 名旁点「删除」 | **不应**弹原生浏览器 `confirm()` 对话框。应渲染:`<div role="dialog" data-testid="confirm-dialog">` 模态,内含「删除」(`data-testid="confirm-dialog-confirm"`,红色)+「取消」按钮。Esc 也能关。**自动化可点!** | | |
| **V-15** | 知识库 / 会议删除也用同款模态 | 1. `/admin/knowledge` 或 `/meetings` 点删除按钮 | 同 V-14。同一个 ConfirmDialog 组件 | | |
| **V-16** | 删自己 → 400 而非 500(v9 P4 回归) | 1. 用默认账号(owner)在 `/admin/team`<br>2. devtools 直接调 `fetch('/api/team/members/<my_user_id>', {method: 'DELETE'})` | 状态码 **400**,响应 `{"detail":"cannot remove yourself; transfer ownership first"}`。**不应** 500 + 空 body | | |
| **V-17** | agent.create / update / delete 都被审计(v9 P5 回归) | 1. `POST /api/agents` 建 `_cowork_audit_test`<br>2. `PATCH /api/agents/<id>` 改名<br>3. `DELETE /api/agents/<id>`<br>4. `GET /api/audit?action=agent.create` | 三条 audit 记录都能查到:`agent.create` / `agent.update` / `agent.delete`,payload 含 agent name + fields_changed | | |
| **V-18** | 同名声纹用户不再每次新建(v9 数据回归) | 1. 用 `_cowork_user_<ts>` 名调 `POST /api/users {name: '_cowork_user_<ts>'}` 两次<br>2. 第二次返回 | 第二次应返回**第一次创建的 user.id**(同一条),不创建新行。`GET /api/users` 该名只 1 条 | | |

> **如果 V-1 到 V-3 任何一条失败,请立刻把 Console 整段红字 + Network 中的 page-`<hash>`.js URL 截图给我,这是优先级最高的 bug。**
> **v9 P0 回归(V-10/V-11)** 是最容易复现的视觉回归,**任何 Cowork 例行回归首跑都先跑这条**。

---

## W 系列 · 文字录入(v10 新增 · Cowork 自动化主力)

> **背景**:v10 之前,会议室只能用麦克风触发字幕和 AI;**自动化测试不可达**(用例报告 v8 明确点名)。v10 加了「💬 文字录入」工具栏(UI)+ `text_message` WS action(live UX)+ `POST /manual-transcript` REST 端点(Cowork 主入口)。**这一系列必跑 — 让 C/D/E/F/G/T/U 全部 Cowork 化。**

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **W-1** | UI 工具栏渲染 | 1. 进任一会议页(`/meeting/<id>`)<br>2. 看页面底部 | 字幕区下方有一行:`<div data-testid="manual-text-input">` 包含 💬 + `<select data-testid="manual-text-speaker">` + `<input data-testid="manual-text-content">` + `<button data-testid="manual-text-send">发送</button>` | | |
| **W-2** | 已结束会议不显示工具栏 | 进 `status=processed` 会议页 | 工具栏**不渲染**(`data-testid="manual-text-input"` 不存在) — 已经结束了,不允许再补字幕 | | |
| **W-3** | 默认发言人 = 未指定 | 看 select 默认值 | `<option value="">未指定</option>` 选中;其余 option 是 workspace 内所有用户(`<option value="<uuid>">姓名</option>`) | | |
| **W-4** | REST 注入字幕 — 不指定发言人 | `POST /api/meetings/<id>/manual-transcript` body `{"text":"_cowork_smoke 测试"}` | 200,返回 `{line_id, speaker_user_id: null, speaker_name: null, text: "_cowork_smoke 测试"}`;`GET /result` 末尾应有这条;`speaker_status` = `'manual'`(可在 DB 验证) | | |
| **W-5** | REST 注入字幕 — 指定发言人 | 1. `GET /api/users` 拿一个 user.id<br>2. `POST /manual-transcript` body `{"text":"...", "speaker_user_id":"<id>"}` | 返回 `speaker_name` 对得上;`/result` 中该行 `speaker_user_id` 已绑定;后续即使跑声纹识别也**不会**被覆盖(因为 `speaker_status='manual'`) | | |
| **W-6** | 跨工作空间发言人被拒 | 1. A 账号建会议<br>2. 切换到 B 账号 user.id<br>3. A 账号 POST `/manual-transcript` body 含 B 的 user.id | 400 + `speaker_user_id not in this workspace` | | |
| **W-7** | 空文本被拒 | POST body `{"text":""}` 或 `{"text":"   "}` | 400 + `text required` | | |
| **W-8** | UI 输入框 — Enter 发送 | 1. 进 live 会议(已点开始)<br>2. 输入框输入 `测试` 后按 Enter | 字幕区立刻出现「测试」一行(WS 路径,有 echo);文字框被清空 | | |
| **W-9** | UI 发送按钮 | 同上,改用「发送」按钮点击 | 同 W-8 | | |
| **W-10** | UI 文字录入 → 触发 Agent(关键词) | 1. 在 live 会议输入 `产品的合规风险得请法务过一下`(命中法务专家关键词)<br>2. 等 5-10 秒 | 「法务专家」头像变忙(`busy: true` 红点闪);几秒后出现 AI 气泡 | | |
| **W-11** | 文字录入 → 触发分歧检测 | 1. 切换发言人 A 输入「这个先做声纹」<br>2. 切发言人 B 输入「不对,先做 AI 专家」<br>3. 多轮对立 5-8 句(用 `_cowork_*` 用户避免污染)<br>4. 等 25s 节流过 | rose ⚖️ banner 出现:「检测到分歧 「<topic>」 · <理由>」+「召唤<专家>」按钮 | | |
| **W-12** | 麦风权限被拒后仍可文字录入(text-only 模式) | 1. Chrome 设站点麦权限为「阻止」<br>2. 点「开始会议」<br>3. 看 toast | toast 文案「麦克风未启用,可在下方文字框打字录入」(sticky 不消失);状态条 = 「⌨️ 仅文字模式(麦克风未启用)」;**WS 仍连接**;文字录入工具栏可用 | | |
| **W-13** | text-only 模式可触发 AI | 在 W-12 之后输入 `请产品给个建议` | Agent 正常发言(走 WS 路径) | | |
| **W-14** | 已处理会议 REST 注入(后期补字幕) | `POST /manual-transcript` 给一条 status=processed 会议 | 200,行追加(因 `speaker_status='manual'`,后续 identify 不会覆盖)。注意:已处理的纪要不会自动重生成,需调 `/summary/regenerate` | | |
| **W-15** | 节流仍生效 | 在 1 秒内连发 5 条触发关键词的句子 | Agent 自动召唤每 30s/会议节流(F 系列)依然有效;不会被 5 条全部触发 | | |

### Cowork 端到端示例脚本(可直接复制运行)

> 下面这段脚本一次跑完 **W → F → G → H → R** 五个系列的核心路径,作为 Cowork 入门冒烟。需要更宽覆盖时,见后面 **X 系列**示例脚本(议程 + 主持人 + 行动项)。

```js
// 全自动跑:建会议 → 注入 5 句 → 等 Agent → 验证纪要 → 清理
async function coworkSmoke() {
  // 1. 创建会议
  const m = await fetch('/api/meetings', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({title: '_cowork_w_smoke_' + Date.now(), attendee_user_ids: []}),
  }).then(r => r.json());

  // 2. 选两个不同 user.id 模拟两人对话
  const users = await fetch('/api/users').then(r => r.json());
  const [u1, u2] = users.slice(0, 2);

  // 3. 注入 5 句对立观点
  const lines = [
    {speaker: u1.id, text: '我觉得这个需求要先做声纹识别,优先级最高'},
    {speaker: u2.id, text: '不对,我觉得应该先做 AI 专家,声纹只是辅助'},
    {speaker: u1.id, text: '声纹是基础设施,没有它后面都白做'},
    {speaker: u2.id, text: 'AI 专家才是用户真正在意的'},
    {speaker: u1.id, text: '我反对,声纹优先,这事得让法务也过一下合规'},
  ];
  for (const l of lines) {
    await fetch(`/api/meetings/${m.id}/manual-transcript`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({text: l.text, speaker_user_id: l.speaker}),
    });
    await new Promise(r => setTimeout(r, 500));  // 间隔避免 Agent 重叠
  }

  // 4. 拉结果(Agent 是否被触发可在 /result 的 lines 之外通过 WS 监听)
  const result = await fetch(`/api/meetings/${m.id}/result`).then(r => r.json());
  console.log('lines persisted:', result.lines.length);

  // 5. 等 30s 让节流通过 + 触发分歧检测,然后 regenerate summary
  await new Promise(r => setTimeout(r, 30000));
  await fetch(`/api/meetings/${m.id}/summary/regenerate`, {method: 'POST', credentials: 'include'});
  const sum = await fetch(`/api/meetings/${m.id}/summary`).then(r => r.json());
  console.log('summary status:', sum.status);

  // 6. 清理(避免污染生产)
  await fetch(`/api/meetings/${m.id}`, {method: 'DELETE', credentials: 'include'});
  return {ok: true, meetingId: m.id};
}
coworkSmoke();
```

---

## X 系列 · M3.0 自动主持人(v11 新增 · Multi-Agent V2)

> **核心能力**:
> 1. 创建会议时可填**议程项**(title + 可选 time_budget_min);开 agenda monitor。
> 2. 每条 final 字幕(无论来自 ASR 还是 manual-transcript)后,后台 LLM 检查讨论是否偏离当前议程项 / 当前议程项时间预算是否快超。最多 60s 检查一次;触发后 90s 抑制。
> 3. 触发时推 WS 事件 `agenda_off_topic` 或 `agenda_time_warning`;前端渲染琥珀色 banner「召唤主持人」按钮。点击 → 调用 workspace 内 role='moderator' 的内置 Agent。
> 4. 会议处理完毕后,**action_extractor** 在 summary 之上再跑一次 LLM 抽出**结构化行动项**到 `meeting_action_item` 表,UI 在「📌 行动项」卡片以 checkbox 列表展示。

| 编号 | 用例 | 步骤 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| **X-1** | 内置 moderator agent | 1. 进任一 workspace 的 `/admin/agents`<br>2. 看 Agent 列表 | 列表里有一条 name='主持人',color=amber,role='moderator';UI 标了「🛡 内置」;`GET /api/agents` 返回这条带 `role: "moderator"` | | |
| **X-2** | 创建会议时不填议程 | `POST /api/meetings` body 不含 agenda | 200 + `agenda: null`;agenda_monitor 完全不跑(日志中无任何相关 LLM 调用) | | |
| **X-3** | 创建会议时填议程 | `POST /api/meetings` body 含 `agenda: [{title:"合规", time_budget_min:10},{title:"上线计划"}]` | 200 + `agenda` 反映回来;`/api/meetings/{id}` 也读得到 | | |
| **X-4** | UI 议程录入 | 1. 进首页 `data-testid="agenda-section"`<br>2. 在第一行输入「合规风险评估」<br>3. 点击预算栏输 `15`<br>4. 输完第一行后**自动追加**第二行空白 | UI 至少 2 个 `data-testid="agenda-row-N"`;第二行 title 为空时不会随会议提交 | | |
| **X-5** | 议程在会议页可见 | 进有议程的会议页 | 状态栏下方有 `data-testid="agenda-strip"`,显示编号 + title + (Nm) | | |
| **X-6** | 跑题检测触发(**v12 改用 run-now**) | 1. 创建会议 agenda=[{title:"数据出境合规"}]<br>2. manual-transcript 注入 5 句和数据出境**完全无关**的(如「中午吃啥」「假期安排」)<br>3. **`POST /api/meetings/{id}/agenda-monitor/run-now`** | 返回 `{fired:true, payload:{type:"agenda_off_topic", current_agenda_item:"数据出境合规", reason:"..."}}`;`GET /api/audit?action=agenda.agenda_off_topic` 列表里多一条 target_id=meeting_id 的记录 | | |
| **X-7** | 召唤主持人 | X-6 的 banner 出现后点 `data-testid="moderator-accept"` | banner 消失;主持人 Agent 进 busy;`GET /agent-messages` 几秒后多一条 trigger='manual'、agent_id 是 moderator 的发言 | | |
| **X-8** | 时间预警 | 1. 创建会议 agenda=[{title:"产品",time_budget_min:1}]<br>2. 等会议跑过 50s+(可调时间)<br>3. manual-transcript 注入一句 | WS 收到 `agenda_time_warning`;banner data-testid 含 `time_warning` | | |
| **X-9** | 节流生效(60s 检查) | 60 秒内反复注入 manual-transcript | 后端日志中 `agenda_monitor LLM call` 至多 1 次/分钟 | | |
| **X-10** | 触发后抑制 90s | 一次 banner 触发后立刻继续注入跑题句子 | 90 秒内**不再**收到第二条 banner | | |
| **X-11** | 行动项自动抽取 | 1. 创建会议<br>2. manual-transcript 注入 5+ 句对话,内容含「邓西负责整理 PRD」「李法务下周三前出合规意见」<br>3. `POST /summary/regenerate` 等 status=ready<br>4. 5-15s 后 `GET /api/meetings/{id}/actions` | 返回 ≥ 2 条 source_type='summary' 的项,内容含「整理 PRD」「合规意见」;assignee_user_id 若 workspace 内有匹配则绑定,否则 `assignee_name_hint` 含原文姓名 | | |
| **X-12** | UI 行动项卡片 | 进 status=processed 会议页 | `data-testid="action-items-card"` 渲染;每条有 `action-item-{id}` + `action-checkbox-{id}` | | |
| **X-13** | 切换完成状态 | 点 X-12 中某条的 checkbox | `PATCH /actions/{id}` 200;UI 立刻打勾 + 中划线 | | |
| **X-14** | 手动添加行动项 | 输入框输文 + 选发言人 + 点「添加」 | `POST /actions` 200,source_type='manual';卡片立刻多一条 | | |
| **X-15** | 删除行动项 | 点某条 ✕ | `DELETE /actions/{id}` 204;UI 立刻消失 | | |
| **X-16** | regenerate 不破坏 manual 项 | 1. 自动抽取出 N 条<br>2. 手动添加 1 条<br>3. `POST /summary/regenerate` | source_type='summary' 全部被替换;source_type='manual' **保留**;前后行数差 = 重新抽取数 - 旧自动数 | | |
| **X-17** | 跨工作空间发言人被拒 | `POST /actions` body 含其他 workspace 的 user.id | 400 + `assignee_user_id not in this workspace` | | |
| **X-18** | 行动项无议程也工作 | 不填 agenda 创建会议,正常注入对话,生成纪要 | action_extractor 仍然跑(基于 summary,不依赖议程) | | |
| **X-19** | empty extraction 不报错(**v12 prompt 强化**) | 注入 5 句纯闲聊(午餐 / 天气 / 看电影,**无任何工作内容**),regen summary 等 25s | `GET /actions` 返回 `[]`(prompt 中 NEGATIVE 规则 + few-shot 已让 LLM 把闲聊当 empty case 处理);之前的 summary 类项被清空 | | |
| **X-20** | 隔离 | A 账号建会议 → B 账号 `GET /actions/...` | 404(workspace 隔离生效) | | |

### Cowork X 系列驱动脚本(议程 + 跑题 + 行动项)

```js
async function coworkX() {
  // 1. 拿 workspace 用户 id 作 speaker
  const users = await fetch('/api/users').then(r => r.json());
  const [u1, u2] = users.slice(0, 2);

  // 2. 创建带议程的会议
  const m = await fetch('/api/meetings', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({
      title: '_cowork_x_' + Date.now(),
      attendee_user_ids: [],
      agenda: [
        { title: '数据出境合规评估', time_budget_min: 5 },
        { title: '产品上线计划', time_budget_min: 10 },
      ],
    }),
  }).then(r => r.json());
  console.log('meeting created with agenda:', m.agenda);

  // 3. 注入 5+ 句"明显跑题"的对话(议程是合规,内容讲午餐)
  const offTopicLines = [
    '今天中午要不要去新开的那家川菜馆',
    '我还没吃午饭,饿死了',
    '好像隔壁部门今天团建',
    '上周末看了部电影还行',
    '那个新出的游戏挺好玩的',
  ];
  for (const text of offTopicLines) {
    await fetch(`/api/meetings/${m.id}/manual-transcript`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ text, speaker_user_id: u1.id }),
    });
    await new Promise(r => setTimeout(r, 300));
  }

  // 4. 等 60-90s 让 agenda_monitor 跑(也可订阅 WS 实时拿事件)
  console.log('waiting 90s for agenda_monitor to fire…');
  await new Promise(r => setTimeout(r, 90000));

  // 5. 注入"明显待办"的对话
  const todoLines = [
    {speaker: u1.id, text: '邓西负责整理这次的 PRD 文档,周五前给到大家'},
    {speaker: u2.id, text: '李法务下周三前出一份数据出境合规意见'},
    {speaker: u1.id, text: '王架构帮忙调研下 SDK 兼容性'},
  ];
  for (const l of todoLines) {
    await fetch(`/api/meetings/${m.id}/manual-transcript`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ text: l.text, speaker_user_id: l.speaker }),
    });
  }

  // 6. regenerate summary,触发 action_extractor
  await fetch(`/api/meetings/${m.id}/summary/regenerate`, {
    method: 'POST', credentials: 'include',
  });
  // 等 summary + action_extractor 都跑完
  await new Promise(r => setTimeout(r, 25000));

  // 7. 验证抽取的行动项
  const actions = await fetch(`/api/meetings/${m.id}/actions`).then(r => r.json());
  console.log(`extracted ${actions.length} action items:`, actions.map(a => a.content));

  // 8. 切换其中一条为 done
  if (actions[0]) {
    await fetch(`/api/meetings/${m.id}/actions/${actions[0].id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ status: 'done' }),
    });
  }

  // 9. 手动添加一条
  await fetch(`/api/meetings/${m.id}/actions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({ content: '_cowork_x_manual_add_test' }),
  });

  // 10. 检查 Agent 是否被召唤过
  const agentMsgs = await fetch(`/api/meetings/${m.id}/agent-messages`).then(r => r.json());
  console.log(`${agentMsgs.length} agent messages persisted`);

  // 11. 清理
  await fetch(`/api/meetings/${m.id}`, { method: 'DELETE', credentials: 'include' });
  return { ok: true, actionsExtracted: actions.length, agentMessages: agentMsgs.length };
}
coworkX();
```

---

## 测试报告模板

测完后请把这一段填给我：

```
测试人:
测试时间:
测试用例版本: v12
浏览器/系统:
默认账号是否生效: 是 / 否

总用例: __ 条
通过: __ 条
失败: __ 条
部分通过: __ 条

【关键失败】（按用例编号 + 现象 + 截图）
- D-3: ...
- E-1: ...

【建议优化】
- ...

【新发现的 bug（不在用例覆盖范围内）】
- ...
```

---

## 给测试人员的注意事项

1. **每条 bug 报告都要带用例编号 + 截图**，便于复现和回归
2. **一次只跑一场会议**，避免互相干扰；测下一场前刷新页面
3. **字幕区右上角的状态条 + 右下角的 toast** 是问题的第一手线索，遇到异常先记录上面的文字
4. **F12 控制台**报错也请带上（特别是 401/500/CORS 类）
5. **iOS Safari 测试是探索性的**（系统首次支持移动端），暴露的兼容性问题单列一个分类
6. **测多账号隔离时，开两个浏览器或一个浏览器 + 一个无痕窗口**，不要同 cookie 容器开两个 tab
7. **v2 重点关注**：D 系列（声纹严格化效果）+ E 系列（会议中纠错）+ M、N 系列（新功能）
