# Aimeeting · 测试用例（v23.5）

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
- 默认测试账号:邮箱 `bluesurfiregpt@gmail.com` / 密码 `<SYSTEM_OWNER_PWD>`。
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
| **Dissent 同步触发** | `POST /api/meetings/{id}/dissent-detector/run-now` | **v13 新增**:对称 agenda run-now,绕过 25s 节流强制跑一次分歧检测;返回 `{fired, payload}`(payload 含 topic/parties/suggested_agent_id) |
| **Audit · 系统检测** | `GET /api/audit?action=dissent.detected` <br> `GET /api/audit?action=agenda.agenda_off_topic` <br> `GET /api/audit?action=agenda.agenda_time_warning` <br> `GET /api/audit?action=agenda.agenda_stuck` | **v12+v13**:每次检测器触发都会写 audit 行,Cowork 不订阅 WS 也能验证 |
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
| **v23.5** | 2026-05-10 | **消息中心 + 任务详情页 + 会议追溯链(信息密度 3 联动)**:① 后端新端点 `GET /api/me/tasks/{tid}/detail` 一次返回 Task 完整上下文(基本信息 + 时间线 + 协办进度 + 评分 + 评论),批量解析所有 user_id → name(无 N+1);时间线由 5 个时间戳 + 当前 status 综合(audit log 表留 v24+);权限:相关人(assignee / dispatcher / creator / co_assignee)直接放行,其他人走 access_control.can_access(分级 + leader/admin / grant);② 后端新端点 `GET /api/meetings/{mid}/trace` 返回会议沉淀的所有 Task + 状态分布(`{by_status, total, tasks[task_id+action_item_id 双指针]}`),sourcetype='meeting' 反向 join MeetingActionItem.task_id 即得;workspace 内任何人可看(分级在 detail 时再细查);③ 前端 api.ts 加 TaskDetail / MeetingTrace types(含 5 个子 type:TaskTimelineEntry/CoProgress/Rating/Comment/MeetingTraceTask)+ 2 个新方法 getTaskDetail / getMeetingTrace;④ 新页 `/task/[id]`:精品任务详情页(标题 + 状态 + 分级 + 截止 + 元信息 + 协办列表 + 时间线带圆点 + 协办交付卡片 + 评分卡片 + 评论卡片;StarBar 5★ 组件;会议名 deeplink);⑤ 新页 `/messages` 消息中心:3 section(🔥 需要我处理 = 主责待签收/办理 + 审核 + 协办,直接读 /api/me/tasks 三视角合并去重 + 角色徽章;📈 我发起的进展 = task_accepted/returned/completed/co_submitted/co_withdrawn 通知;🔔 系统消息 = 其他通知);全部已读按钮;空状态 placeholder;⑥ 新建 `meeting/[id]/TraceCard.tsx`:会议结束后底部追溯卡(状态徽章统计 + 任务列表,行点击进 /task/[id],trace.total=0 时不渲染节省空间);⑦ NotificationBell 加「查看全部」 → /messages,行 deeplink 优先 /task/[id](task_id 兜底 meeting_id);⑧ AuthHeader 顶栏加 💬 消息中心入口图标(所有角色可见);⑨ /me Task 行(主责 + 协办两处)文字 → /task/[id] 链接;⑩ Cowork GG 系列 6 用例(detail shape / 404 / 派发后含 dispatched_by_name + timeline 'dispatched' / trace shape + 含已知 task / 空 meeting trace / 跨/不存在 meeting 404);两份 baseline.json 刷到 v23.5(总 103 用例,95 ✅ + 8 ⏭️) |
| **v23** | 2026-05-10 | **看板二期 + 报表 Excel 导出 + Playwright headless CI**:① 后端 `/api/dashboard/kanban-by-agent`(每 AI 一列;Task 归属判断:assignee 的 bound_agent → source_ref.agent_id → fallback「未分配」列)+ `/kanban-by-user`(按 assignee 工作量降序 + 「未指派」末尾);两 endpoint 都支持 `include_closed` 默认 false 只展示活跃;② 后端 `routers/reports.py`(全新):`/monthly-evaluation` + `/status-distribution` 用 openpyxl 生成 Excel,RFC 5987 中文文件名,leader-only;月度表带表头加粗 + 冻结首行 + 百分比格式 + 综合分排名;③ main.py 注册 reports router;④ 前端 api.ts 加 KanbanCard/Column/Out 类型 + 6 个新方法 + parseDownload helper(RFC 5987 文件名解析,refactor 旧 export 复用);⑤ 前端 `/dashboard` 主页加 3 张入口卡(AI 专家 Kanban / 科长 Kanban / 报表中心),报表中心仅 leader 可见(member 灰显);⑥ 新建共享组件 `components/KanbanView.tsx`(精品 polish:状态色边 / 截止日色 / 协办进度 chip / hover lift / 三态加载-空-错误);两个 Kanban 子页 thin wrapper 复用;⑦ `/dashboard/reports` 页:月度选择器(过去 12 月)+ 状态分布区间选择(7/14/30/60/90)+ 两个导出按钮(Excel only,精品交付);⑧ T3 CI 升级:`.github/workflows/cowork-headless.yml` workflow_dispatch 触发 + Playwright runner(`tests/playwright-runner.js`)登录 prod 跑全套 cowork_suite,失败时 step 红显;artifact 上传 markdown + json 报告;⑨ 测试 Cowork FF 系列 6 用例(Kanban shape / 工作量降序 / include_closed 切换 / Excel CT 校验 / 多区间 / days 越界拒绝);两份 baseline.json 刷到 v23(总 97 用例,89 ✅ + 8 ⏭️) |
| v22.5 | 2026-05-09 | **多 AI 协作(主责 + 协办,精品 UI)+ 真评价数据回写**:① 模型:Task 加 `co_assignees` JSONB UUID 数组(最多 5 人,不含主责);新表 `task_co_progress`(协办进度报告,UNIQUE on task_id+user_id 防多次插)+ `task_collaboration_rating`(双向评分原子事件,UNIQUE on task+rater+ratee+dimension);② 新模块 `evaluation.py`:`recompute_user_evaluation` 从真实 Task / TaskCollaborationRating 算 4 维分(0-1 归一)→ UPSERT 月度 task_evaluation,真数据**覆盖** v22 seed;③ 端点:`POST /api/me/tasks/{tid}/co-submit`(协办交付,UPSERT 进度行 + 通知主责)/ `co-withdraw`(per Q1 移除自己 + 通知)/ `rate`(per Q4 双向评分,3 种合法 rater→ratee 矩阵:主责↔协办 collaboration / dispatcher→主责 quality);④ `dispatch_task` + `commit_directive` 都接受 `co_assignees`(per Q5 max 5 + workspace 校验 + 不能含主责)+ 给每个协办发 `task_co_assigned` 通知;⑤ `submit_task` per Q2 加 `force` 参数:有未交协办时默认 422 + 错误信息列出待交人,前端 confirm 后 force=true 重试硬过;⑥ `approve_task` 后实时 recompute 主责 + 所有协办的本月评价(真数据上线);⑦ `/api/me/tasks` 加 `role=coassignee` 视角;Task shape 加 `co_assignees` + `co_submitted_user_ids`(批量 join 防 N+1);⑧ Notification 加 4 个新 kind:`task_co_assigned/co_submitted/co_withdrawn/collaboration_rated`;⑨ 前端:DirectivePanel draft 行勾「立即派发」后展开协办多选 chip(按 user 切换,5 人上限 toast);`/me` 加「我的协办」section(青色边框,显示协办进度 N/M,「✓ 提交协办成果」+「退出协办」按钮);submit 422 自动弹 confirm 询问是否 force;**RateDialog 精品 modal**(approve 后弹出,5 分制按钮组 + 评论 + 「稍后再评」+ 「提交评分」);⑩ 测试 Cowork EE 系列 7 用例(dispatch+co_assignees / max 5 / 不含主责 / 非协办 co-submit 403 / submit 未交 422 + force / self-rate 400 / bad dimension+score 400);两份 baseline.json 刷到 v22.5(总 91 用例,83 ✅ + 8 ⏭️) |
| v22 | 2026-05-09 | **看板 Dashboard 雏形(精品交付) + T3 CI 落地**:① 模型:新表 `task_evaluation`(月度 4 维评价 + 累计指标 + (workspace, assignee, period) UNIQUE);② 新 router `/api/dashboard`:聚合 endpoint `/overview` 一次返回 7 个 KPI + 元信息(role + scope_label),含 expert scope 过滤(leader 看全局 / expert 看 bound agent / member 看自己 assignee);`/seed-eval-data` admin-only 智慧住建演示用 seed,deterministic random(同 user_id+period 多次跑结果稳定),含 inserted/updated/overwrite 语义;③ 前端:安装 `recharts` 依赖(~80KB),新页 `/dashboard`(7-segment 精品配色板:primary/warm/cool/green/rose/red/purple/amber);布局:顶部 4 KPI 卡(总任务/待签收/已逾期/本月完成率) + 中部 3 图(状态饼/工作量横条 stacked overdue/30d 完成vs创建折线) + 底部 3 图(触发源饼/7d 创建条/4 维评价雷达 top 3);精品 polish:配色统一、暗色 tooltip、加载/空/错误三态、admin 才显示 🌱 Seed 按钮、手动刷新(不自动轮询);④ AuthHeader 顶栏加 📊 入口,leader/admin/owner/expert 可见,member 隐藏(角色分化曝光);⑤ 测试 Cowork DD 系列 6 用例(overview shape / 30d&7d 点数补齐 / seed 接口 / seed 后 evaluations 非空 4 维 / seed 幂等 / seed overwrite 二次有效);两份 baseline.json 同步刷到 v22(总 84 用例,76 ✅ + 8 ⏭️);⑥ **T3 CI 落地**:`.github/workflows/lint.yml` 新增,PR / push to main 时跑:Python AST · JS 语法 · 两份 baseline.json 一致性 · 两份 cowork_suite.js 一致性 · JSON 合法 · TypeScript noEmit;故意不跑端到端 Cowork(需 headless 浏览器 / 真 prod,留 v23+) |
| v21 | 2026-05-09 | **政务安全基线:角色二分 + 数据 5 级分级 + 跨 AI 共享审批**:① 模型:`workspace_membership.bound_agent_id` FK 加上(`expert` role 必填,其他 NULL);角色枚举扩展为 owner/admin/leader/expert/member(leader=admin 别名);Task / KnowledgeDocument / LongTermMemory 各加 `data_classification` 列(默认 `general`,5 级 core/important/sensitive/general/public);新表 `data_access_request`(requester / target_resource_type / target_resource_id / target_owner / justification / status / expires_at / decided_*);② init_db 加 4 个 ALTER COLUMN 自动迁移现有数据(workspace_membership.bound_agent_id + 三个表的 data_classification);③ 新模块 `auth.py` 角色 helpers(`get_membership_role` / `is_leader_or_admin` / `is_expert` / `expert_bound_agent_id` / `require_leader_or_admin`);④ 新模块 `access_control.py` 中央化 `can_access()`(决策链:leader → owner → low-classification → expert in own range → active grant → 拒);⑤ 新 router `/api/me/access-requests`(create / list 两视角 / approve / reject;通知 owner + 申请人,3 个新 kind:`access_requested`/`approved`/`rejected`);⑥ 关键端点权限收紧:cron-rules CRUD + force-fire `require_leader_or_admin`;`POST /api/me/tasks/{tid}/dispatch` 同样 leader-only;⑦ team router 加 `PATCH /api/team/members/{user_id}`(改 role + bound_agent_id,自我编辑拒,owner 不可改);MemberOut 加 bound_agent_id + bound_agent_name 字段;⑧ 前端:api.ts 加 TeamRole / DataClassification / AccessRequest 类型 + CLASSIFICATION_LABELS/BADGE_CLASSES + 5 个新 API 方法;`/admin/team` 行内编辑 role(下拉 5 选)+ bound_agent(选 expert 时强制必填);`/me` Task 行 sensitive+ 分级显示彩色 badge(general/public 默认隐藏,避免视觉噪声);⑨ 测试:Cowork CC 系列 7 用例(team members shape / self-edit 400 / data_classification 字段 / bogus access target 404 / self-owned 拒 / list shape / owner 权限不被收紧拦截);两份 baseline.json 同步刷到 v21(总 78 用例,70 ✅ + 8 ⏭️);智慧住建文档准入要求 100% 满足(角色二分 ✅ + 数据分级 ✅ + 跨 AI 共享审批 ✅) |
| v20 | 2026-05-09 | **触发源扩展:上级文件 + 定期巡检 cron**:① 模型:新表 `upper_doc`(filename/mime_type/byte_size/extracted_text/parsed_drafts/status/committed_task_ids/parse_error)+ `cron_rule`(name/cron_expr/task_template_*/auto_dispatch/due_days_after/is_active/last_fired_at/fire_count);Task.source_type 扩展支持 `upper_doc` / `cron`(枚举占位 v17 已埋,v20 真正使用);② 上级文件:`POST /api/me/upper-docs`(multipart 上传)→ 复用 doc_parser 抽文本(PDF/DOCX/XLSX/TXT/MD/CSV/JSON/YAML)→ 截断 20K 字 → 复用 directive_parser LLM 拆解 → 返回 drafts;`/commit` 入库 Task(source_type='upper_doc',source_ref={upper_doc_id, filename}),可选 dispatch=true 直接派发;`/discard` 软丢弃;`GET /upper-docs` history;文件**不入 OSS、不入知识库**(纯一次性触发器);③ cron 巡检:新模块 `cron_runner.py`(lifespan loop,默认 60s tick,每分钟扫 is_active=true 的 cron_rule,匹配则 instantiate Task,1 分钟内防重 fire);**简化 cron 解析器**(不依赖 croniter):5 段 `分 时 日 月 周`,支持 数字/`*`/`*/N`/逗号列表;新 router `routers/cron_rules.py`:`GET/POST/PATCH/DELETE /api/cron-rules` + `POST /api/cron-rules/{id}/force-fire`(测试 + 调试用,绕过时间匹配);auto_dispatch + assignee 时,fire 直接进 dispatched 并通知;due_days_after 让模板带相对截止;④ 前端:DirectivePanel 加 mode tab(「文本指令」/「上级文件」),file mode 用 file picker + multipart 上传,后续 draft list / commit / discard 完全复用;新页 `/admin/cron-rules`(列表 + 创建表单 + 行内停用/启用/立即触发/删除,4 个 cron 表达式预设 chip);api.ts 加 UpperDoc / CronRule 类型 + 9 个新方法;⑤ 测试:Cowork BB 系列 7 用例(BB-1 上传 .txt + LLM 拆解 / BB-2 commit 入库 + source_ref 校验 / BB-3 discard + 409 / BB-4 cron CRUD / BB-5 force-fire 入库为 open / BB-6 auto_dispatch + due_days_after / BB-7 非法 cron_expr 400);两份 baseline.json 同步刷到 v20(总 71 用例,63 ✅ + 8 ⏭️);触发源覆盖率从 33% (2/6) → **67% (4/6)** |
| v19 | 2026-05-09 | **领导指令(自然语言→Task)+ 7 态状态机收尾 + /me 状态 tab UI**:① 模型:新表 `leader_directive`(content / parsed_drafts(JSON) / status(draft\|committed\|discarded) / committed_task_ids / parse_error);Task.status 枚举扩展加 `submitted` / `archived`(8 态完整闭环);② 新模块 `directive_parser.py`:复用 action_extractor 的 LLM 调用基建 + `_match_user` + `_parse_due`,prompt 重写为"公文/指令拆解助手"(含 3 个 few-shot,负向规则禁止拆"研究/学习/重视"空话);同步调用,5-15s,失败时 row 仍写入并带 parse_error;③ task_state.py 加 4 个新动作 `submit/approve/reject/archive`,状态机扩展:in_progress→submitted (assignee 上报)、submitted→done (审核通过)、submitted→in_progress (驳回返工)、done→archived (归档)、各活跃态→cancelled;④ 5 个新端点:`POST /api/me/directives` (同步 LLM 拆解返回 drafts) / `POST /directives/{did}/commit` (批量入库 Task,可选 dispatch=true 直接转 dispatched) / `POST /directives/{did}/discard` (软丢弃) / `GET /directives` (history) / `POST /tasks/{tid}/submit|approve|reject|archive` 4 个 lifecycle;权限模型:approve/reject 允许 dispatcher / creator / workspace owner|admin;⑤ `/api/me/tasks` 加 `role=assignee\|reviewer` 参数,reviewer 视角拿到「待我审核」队列(过滤 submitted + 我是 dispatcher 或 creator);status 过滤补 submitted/archived/review;⑥ Notification 加 3 个新 kind:`task_submitted` / `task_approved` / `task_rejected`;⑦ 前端:新建 `DirectivePanel.tsx`(全屏 modal,文本框 → 解析按钮 → draft 列表逐条编辑/选 assignee/选 due/勾选派发 → 全部入库 + toast 反馈),顶栏加 `+` 按钮入口;`/me` 页**重写**:左列任务面板 5 个状态 tab(待签收/办理中/待审核/已完成/全部)+ state-aware action 按钮(签收/退回/开始办理/上报办结/归档,各按 Task.status 动态显示),「待我审核」单独区(reviewer 视角,通过/驳回 inline);⑧ 测试:Cowork AA 系列 8 个用例(指令拆解 / 批量入库 / dispatch=true / discard+409 / 上报办结 / 审核通过 / 驳回返工 / 归档+非法转换 422);两份 baseline.json 同步刷到 v19(总 64 用例,56 ✅ + 8 ⏭️);docs/test-cases.md 头部 v19 + 版本日志 + AA 系列章节 + 报告模板版本号 |
| v18 | 2026-05-09 | **Task 状态机 + 派发签收 + 三级催办**:① 模型扩展:Task 增 `dispatched_at`/`dispatched_by_user_id`/`accepted_at`/`started_at` 时间戳列;状态枚举从 `open|done|cancelled` 扩到 6 态(open / dispatched / accepted / in_progress / done / cancelled),`submitted` 和 `archived` 留给 v19;Notification 增 `severity` 列(normal / yellow / red / purple);② 新模块 `task_state.py`:合法转换表 + `transition()` 把守 + `mirror_to_action_status()`(Task → ActionItem 状态映射,新增 dispatched/accepted/in_progress 全部映射成 ActionItem='open',旧 UI 完全不用改);③ 新端点 `POST /api/me/tasks/{tid}/{dispatch,accept,return,start,complete,cancel}`,各自校验权限(dispatch:同 workspace · accept/start/complete:必须是 assignee · cancel:assignee/dispatcher/creator 任一)、走状态机、镜像到 ActionItem、发对应 kind 通知(`task_dispatched`/`task_accepted`/`task_returned`/`task_completed`,self-* 抑制);④ `due_reminder.py` severity-aware 重写:黄(≤3d 距截止,48h dedup)/红(超时<3d,24h dedup)/紫(超时≥3d,24h dedup,**额外**通知 workspace owner+admin);⑤ `notify.py` 新增 `severity` 参数,dedup 窗口按 severity 不同;⑥ `/api/me/tasks` status 过滤扩展:加 `active`(=open|dispatched|accepted|in_progress,默认值)/ `pending`(=dispatched 待签收) / `working`(=accepted|in_progress 办理中);响应增加 `assignee_user_id` + 4 个状态机时间戳字段;⑦ `/api/me/notifications` 响应增加 `max_unread_severity` 字段(purple > red > yellow > normal),驱动铃铛 badge 颜色;⑧ 前端轻量适配:NotificationBell badge 颜色随 severity 变(rose/amber/red/purple),drawer 内行点颜色同步;api.ts 加 MyTask 类型 + 6 个 lifecycle 方法 + Notification 类型加 4 个新 kind 和 severity 字段;⑨ 测试 Z-6..Z-12(共 7 个新用例:派发 / 签收 / 办理+办结 / 退回 / 非法转换拒绝 / severity 字段稳定 / self-dispatch 抑制),Z-5 重定义为 active/pending/working/all 四种过滤生效校验;baseline 刷到 v18(总 56 用例,48 ✅ + 8 ⏭️) |
| v17 | 2026-05-09 | **Task 一级对象立项(智慧住建翻译层骨架)**:① 新表 `task`(id / workspace_id / title / content / assignee_user_id / created_by_user_id / due_at / status / source_type / source_ref(JSON) / 时间戳),状态 v17 只用 `open|done|cancelled`,`in_progress` 留给 v18 状态机;② 新建 `task_sync.py` helper:`add_action_with_task` / `mirror_patch_to_task` / `delete_task_for_action` / `delete_tasks_for_meeting_summary_actions`,client-side UUID 让 ActionItem ↔ Task 一笔事务交叉指 ID;③ `meeting_action_item.task_id` FK 列加上,`init_db.py` 启动时 backfill 现有所有 ActionItem 一对一映射 Task(source_type='meeting');④ `workspace.preset` JSON 列加上,默认 NULL=「general」,预留 'smart_construction' 等键;⑤ 双写接入:`POST/PATCH/DELETE /api/meetings/{m}/actions` 和 `action_extractor` 自动抽取都同步维护 Task;⑥ 新读端 `GET /api/me/tasks?status=(open|all|done|in_progress)` 返回 Task 列表 + 自动注水 `meeting_id`/`meeting_title`(source_type='meeting' 行);⑦ Notification payload 新增 `task_id` 字段(`action_id` 保留兼容),due_reminder cron / action_assigned / action_comment 都带上;⑧ 测试:Cowork Z 系列 5 用例(Z-1 dual-write 一致 / Z-2 PATCH 镜像 / Z-3 DELETE 级联 / Z-4 meeting_title 注水 / Z-5 in_progress v17 为空);两份 baseline.json 同步刷到 v17(总 49 用例,41 ✅ + 8 ⏭️);⑨ 前端零变更,Y 系列保持绿 |
| v16 | 2026-05-08 | **主题 1 · P0 行动项协作闭环**:① 后端新建表 `meeting_action_item_comment` + `notification`(in-app);② 新 router `/api/me`(`GET /actions`、`GET /notifications`、`POST /notifications/{id}/read`、`POST /notifications/read-all`);③ 行动项评论 CRUD(`/api/meetings/{mid}/actions/{aid}/comments`,作者可删不可改);④ 创建 / 改派行动项时给 assignee 写 `action_assigned`(self-notify 抑制);⑤ FastAPI lifespan 内挂后台 loop(默认 1h tick)生成 `action_due_soon` / `action_overdue`,helper `notify.py` 内 24h 去重;⑥ 前端:顶栏 🔔 NotificationBell + 抽屉(60s 轮询、未读红点、全部已读)、`/me` 个人页(我的待办 open/done 切换 + 通知列表)、ActionItemsCard 每行加可折叠评论线程(💬 计数 / lazy fetch / Cmd+Enter 发送);⑦ 测试:cowork_suite 新增 Y 系列 7 用例(Y-1..Y-7,自动列表 / done 过滤 / 评论 CRUD / 作者-only delete / 通知 shape / self-notify 抑制 / mark-all-read);两份 baseline.json(repo + frontend/public)同步刷到 v16(总 44 用例,36 ✅ + 8 ⏭️)|
| v15 | 2026-05-08 | **P1 · T1 + T2 落地**:① **T1** Cowork 全自动套件(`tests/cowork_suite.js`,29 用例 + 8 expected skip,84-105s 全跑完);套件挂在 `/cowork_suite.js`,任何登录浏览器一句 `runCoworkSuite()` 就能跑 ② **T2** baseline diff:`tests/baseline.json` 是 v14 节点的 frozen 快照,套件运行时**自动 fetch + diff**,5 个分类桶(regressions / fixed / new_passes / new_cases / missing);`r.json.summary.passed_baseline` 是 CI gate 关心的布尔值;markdown 顶部「✅ 与 baseline 一致」/「⚠️ 与 baseline 有偏差」横幅 ③ 套件 fixture 强化:G-1 行长 ≥ 18 字 / 总 ≥ 80 字以避开 backend `MIN_TRANSCRIPT_CHARS=60` 的 skipped 短路;poll 现在识别所有 terminal status(包括 skipped);依赖失败用 `SKIP_DEP_FAILED:<id>` 表示,自动归入 ⏭️ 而不是 ❌ |
| v14 | 2026-05-08 | **修 v13 QA 报告 3 个 NEW-ISSUE**:① **NEW-ISSUE-B/C**(P2):简报顶部「上次会议未完待办」的总数 / 逾期数从原 `len(rows)`(被 LIMIT 截断) 改成独立 `COUNT(*)` 查询;当总数 > 8 时 header 加 `· 显示前 8` 透明化截断 ② **NEW-ISSUE-A**(P3):`prune_noise_users.py` 加 `--force-with-voiceprint` flag,显式覆盖 voiceprint guard;依赖 FK CASCADE 干净删除;跑了一次,删掉 `1` `111` 两条遗留 noise 用户 ③ 修了 prune 脚本的隐性 bug:`Voiceprint.user_id` / `WorkspaceMembership.user_id` / `PasswordResetToken.user_id` 都是 NOT NULL,以前 `_FK_REPOINT` 列表里包含他们,在 force 模式会触发约束违反 → 现在依赖 ondelete=CASCADE 自动级联 |
| v13 | 2026-05-08 | **M3.0 收尾**:① **M3.0.4 僵局检测**:agenda_monitor LLM prompt 新增 `stuck` 信号;新事件类型 `agenda_stuck`,前端橙红色 banner + **5 秒倒计时**,用户不操作则**自动召唤主持人**(更激进的 UX) ② **M3.0.7 跨会议跟进**:`briefing_generator` 把本 workspace 内 `status='open'` 的行动项渲染到简报 markdown **顶部**(逾期项加 ⚠️ 标记) ③ **dissent run-now 同步触发端点**(对称 agenda 的 v12 修复)|
| v12 | 2026-05-08 | **修掉 v11 QA 报告的全部 5 个发现**:① ISSUE-1: `/result` 返回的 line 同时带 `id` 和 `line_id`(POST 一致);② ISSUE-2: dissent + agenda 检测器都写 `audit_log` (`dissent.detected` / `agenda.agenda_off_topic` / `agenda.agenda_time_warning`);manual-transcript 第一次注入时把 `meeting.status` 从 `scheduled` 翻到 `ongoing` + 记 `started_at`;③ ISSUE-4: 新增 `POST /api/meetings/{id}/agenda-monitor/run-now` 同步触发(绕过 60s 节流 + 90s 抑制),返回 banner payload;④ ISSUE-3: action_extractor prompt 重写,加 5 条 NEGATIVE 规则 + 2 个 few-shot,纯闲聊纪要现在返回 `[]`;⑤ ISSUE-5: 跑了一轮 prune_noise_users,删掉 noise 名(脏数据再清理一轮) |
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
| 默认账号 | `bluesurfiregpt@gmail.com` / `<SYSTEM_OWNER_PWD>` |
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

> **测试结束后**：把 default 账号密码改回 `<SYSTEM_OWNER_PWD>`（或告诉我新密码），方便后续测试团队继续用。

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

### 🔥 Cowork 全自动套件(v15+ · 唯一推荐入口)

> **P1·T1 + T2 已落地**:仓库下 [`tests/cowork_suite.js`](../tests/cowork_suite.js) 是 **Cowork 自动化测试唯一主入口**,跑完会:
>
> - 一次性覆盖 A / W / E / F / G / I / J / K / N / Q / R / V / X 13 个系列共 **29 用例 + 8 hard-skip = 37 cases**
> - **自动 fetch [`/baseline.json`](../tests/baseline.json)** 做 diff,把当次结果按 5 个桶分类(`regressions / fixed / new_passes / new_cases / missing`)
> - 产出**结构化 markdown 报告 + JSON**;`r.json.summary.passed_baseline` 是 boolean,**CI gate 直接 key 这个**
> - **全程自动清理**:每个用例创建的资源都标了 `_cowork_suite_<runid>` 前缀,跑完 DELETE 干净
> - 总耗时 ~80-110 秒(LLM 调用为主)

#### 一键跑(在已登录的浏览器 console)

```js
const src = await fetch('/cowork_suite.js?v=' + Date.now()).then(r => r.text());
new Function(src)();                  // 注册 window.runCoworkSuite
const r = await runCoworkSuite();     // 自动 fetch /baseline.json 做 diff
console.log(r.markdown);              // 给人看
console.log(JSON.stringify(r.json));  // 给 CI 用
console.log('passed_baseline:', r.json.summary.passed_baseline);
```

#### 报告结构(markdown 优先级,从上往下)

```
# Aimeeting · Cowork 自动套件回归报告
- 环境 / 时间 / 登录 / 总计 / 运行 ID

## ✅ 与 baseline 一致              ← 或 ⚠️ 与 baseline 有偏差
  baseline frozen 时间 · against XYZ
  - 🔴 regressions: N · 💚 fixed: N · ✨ new passes: N · 🆕 new cases: N · ⚠️ missing: N · stable: N

  ### 🔴 Regressions(必须解决)    ← 当 N>0 才出现,必须立即看
    | 编号 | 之前 | 现在 | 原因 / 错误 |
    ...

  ### 💚 Fixed since baseline: ...
  ### ✨ Newly passing (was skipped): ...
  ### 🆕 New cases (not in baseline): ...
  ### ⚠️ Missing in this run: ...

## ❌ 失败用例                      ← 跨 baseline 一致性,只看本次失败
## 各系列详情                       ← 每系列一张表
## 测试数据清理                     ← DELETE 日志
```

#### 5 个 diff 桶含义

| 桶 | 含义 | 该不该担心 |
|---|---|---|
| **🔴 regressions** | baseline 是 pass 但本次 fail/skipped(或 baseline skipped 本次 fail) | **是 — 必须查** |
| **💚 fixed** | baseline 是 fail 但本次 pass | 庆祝,可考虑更新 baseline |
| **✨ new_passes** | baseline 是 skipped 但本次 pass(基础设施约束解锁了) | 庆祝,看是否进 baseline |
| **🆕 new_cases** | baseline 没有这条,本次有 | 期望中(刚加的用例),记得更新 baseline |
| **⚠️ missing** | baseline 有这条,本次没跑 | 通常是合并冲突 / 重命名,**要查** |

`passed_baseline === true` 当且仅当 `regressions.length === 0 && missing.length === 0`。

#### baseline 怎么更新

当出现合理的 fixed / new_passes / new_cases 时,把当次 `r.json.results` 转成 baseline 形状写回 `tests/baseline.json`(只保留 `{id, series, status}`,sort by id):

```js
// 在 console 里:
const fresh = {
  schema_version: 1,
  frozen_at: new Date().toISOString(),
  frozen_against: 'v15 (commit XXXXXX)',
  cases: r.json.results
    .map(x => ({id: x.id, series: x.series, status: x.status}))
    .sort((a,b) => a.id.localeCompare(b.id)),
};
copy(JSON.stringify(fresh, null, 2));   // 直接进剪贴板
// 然后粘贴到 tests/baseline.json + frontend/public/baseline.json
```

#### 添加新用例

`tests/cowork_suite.js` 的 `registerCases(R)` 里:

```js
R.register({
  id: "Q-99",
  series: "Q",
  title: "短描述",
  async run(ctx, cleanup) {
    return { ok: true, evidence: { _note: "短结论" } };
    // OR { ok: false, error: "what went wrong" }
    // OR { ok: false, error: "SKIP_DEP_FAILED:Q-1" }   ← runner 自动归 skipped
  },
});
```

`ctx` 跨用例共享(比如 G-1 创了个 meeting 给 G-3 / R-1 / R-2 复用)。push `cleanup.push({kind, id})` 会在最后自动 DELETE(`kind` ∈ `{meeting, agent, kb, invitation, action}`)。

#### Hard-skip 列表(已写死在脚本)

| ID | 原因 |
|---|---|
| B 整系列 | 真人朗读 35-45s |
| C 整系列 | 麦克风 ASR |
| D 整系列 | 依赖真人音频 |
| W-12 / W-13 | 浏览器麦权限拒绝 |
| X-22 / X-23 / X-24 | live banner 倒计时 UI(需真浏览器交互) |

这些会以 `⏭️` 形式列在报告 + baseline,**不会**计入 `regressions`。

---

### Cowork 入门示例脚本(简化版 · 仅作教学)

> 下面这段脚本仅展示 **W → F → G → H → R** 五个系列的核心路径骨架,适合理解 Cowork 测试模式。**实际回归请用上面的 `cowork_suite.js`**。

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
| **X-21** | 僵局检测触发(**v13 新增 M3.0.4**) | 1. 创建会议 agenda=[{title:"先做 A 还是 B"}]<br>2. manual-transcript 注入 6 句重复立场对话:邓西「先做 A」/王架构「不,先做 B」交替 3 轮<br>3. `POST /api/meetings/{id}/agenda-monitor/run-now` | 返回 `{fired:true, payload:{type:"agenda_stuck", stuck_summary:..., auto_summon_after_s:5, ...}}`;`GET /api/audit?action=agenda.agenda_stuck` 列表里多一条 target_id=meeting_id | | |
| **X-22** | 僵局 banner 5s 自动召唤(**v13 新增**) | 1. 进 live 会议(已点开始)<br>2. 触发僵局 banner(`data-testid="moderator-banner-stuck"` 出现)<br>3. 看 `data-testid="moderator-countdown"` 倒计时 `5s → 1s`<br>4. **不点任何按钮等 5 秒** | 5 秒到后:banner 自动消失;主持人头像变 busy;几秒后 AI 气泡出现(query 是「请你作为主持人,综合双方观点,给出折中方案...」) | | |
| **X-23** | 僵局 banner ✕ 取消倒计时 | 触发僵局 banner 后立刻点 `data-testid="moderator-dismiss"`(✕) | banner 消失;**不召唤**主持人(检查 `GET /agent-messages` 数量未增) | | |
| **X-24** | 僵局 banner 立刻召唤 | 触发僵局 banner 后点 `data-testid="moderator-accept"`(「立刻召唤」) | 立刻召唤主持人;倒计时 timer 取消(测点击后 2s 内 `agent-messages` 多一条) | | |
| **X-25** | dissent run-now 同步触发(**v13 新增**) | 1. 创建会议<br>2. 注入 6 句对立观点(2 个不同 speaker_user_id)<br>3. `POST /api/meetings/{id}/dissent-detector/run-now` | 返回 `{fired:true, payload:{topic, parties, suggested_agent_id, ...}}`;`/api/audit?action=dissent.detected` 多一条;无需等 25s 节流 | | |
| **X-26** | 跨会议跟进进入简报顶部(**v13 新增 M3.0.7**) | 1. 在会议 A 添加 1-2 个 manual action item(status='open')<br>2. 创建新会议 B (相同 workspace)<br>3. `GET /api/meetings/{B.id}/briefing` | `briefing_md` **以**「## 📌 上次会议未完待办 (N 项)」开头,列出 A 的 open 项,每条 `- **<assignee>** · <content>`;**之后**才是 LLM 生成的「上次/历史相关结论 / 仍未关闭的事 / 需要重点关注」 | | |
| **X-27** | 逾期项加 ⚠️ | 1. 创建一个 due_at 为昨天的 action item(via PATCH `due_at`)<br>2. 创建新会议 → 看简报 | 「上次会议未完待办」标题里出现「**N 项逾期**」;对应行尾有「⚠️ **逾期 Xd**」 | | |
| **X-28** | 已完成 / 已取消项不进简报 | 1. 把所有 open 改成 done 或 cancelled<br>2. 简报 | 简报顶部不再显示「上次会议未完待办」段落(全部清完则段落整段不出) | | |
| **X-29** | 简报 header 总数实时一致(**v14 修复**) | 1. workspace 内 N 个 open 行动项<br>2. PATCH 关掉 K 个<br>3. 创建新会议 → `GET /briefing` | header 文案 `(N-K 项, ...)` **而不是** 旧值 N;header 数字与 list 行数一致(直到 LIMIT=8) | | |
| **X-30** | 简报截断透明化(**v14 新增**) | workspace 内 ≥ 9 个 open 行动项 | header 末尾出现 `· 显示前 8`;list 仍只渲 8 行 | | |
| **X-31** | prune `--force-with-voiceprint`(**v14 新增**) | 1. 创建一个名为 `_x31` 的声纹用户(借 `POST /api/users` 加录入)<br>2. `python prune_noise_users.py --apply --force-with-voiceprint`<br>3. 检查 `/api/users` | `_x31` 不会被删(不在 noise 名规则里);但 `1`、`111`(纯数字 + 有声纹)会被删 | | |

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

## Y 系列 · 主题 1 协作闭环(v16 新增)

> 把行动项从只读看板做成真正的协作闭环 —— 个人待办视图 + 评论线程 + 应用内通知。

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| Y-1 | `GET /api/me/actions?status=open` 返回当前用户分配到的未完成行动项 | 列表包含刚分配给自己的 manual action,字段含 `meeting_title` | ✅ |
| Y-2 | 把 Y-1 的 action `PATCH status=done`,再分别 GET `?status=open` / `?status=done` | open 列表移除该项,done 列表包含该项 | ✅ |
| Y-3 | 行动项评论 CRUD:GET 空 → POST → GET 含新评论 → DELETE → GET 空 | 全程 200/204,作者拿到 `can_delete=true` | ✅ |
| Y-4 | 删除一条不存在的 comment id | 404 / 403,不会 500 | ✅ |
| Y-5 | `GET /api/me/notifications?unread_only=false&limit=10` | items 是数组、`unread_count` 是数字、list-unread ≤ unread_count | ✅ |
| Y-6 | 对自己创建并分配给自己的 action,前后比较 unread_count | 不增加(no-self-notify 规则) | ✅ |
| Y-7 | `POST /api/me/notifications/read-all` 后再 GET | unread_count = 0,所有 items 的 read_at 非空 | ✅ |

**手测点(Cowork 套件之外)**:
- 顶栏 🔔 红点未读数随通知到达更新;打开抽屉 → 单条点击跳转 + 自动标记已读
- `/me` 页两栏:左 我的待办(未完成 / 已完成 切换),右 通知(支持「全部已读」)
- 会议页 ActionItemsCard 每行末尾 💬 + 计数;展开后看到评论线程 + 「写一条进展或反馈,⌘/Ctrl+↵ 发送」
- 通知文案:`action_assigned` /  `action_due_soon` / `action_overdue`(带逾期天数)/ `action_comment`(带作者 + 摘要前 80 字)

**已知限制 / 跳过**:
- 由于单浏览器单 session,Y 系列只能从「调用方视角」校验。跨用户的「assignee 看到通知」「commenter 看到对方提交」需要双账号联调,放到 Cowork 之外的人工冒烟里
- 后台 cron(`due_soon` / `overdue`)默认 1h tick,本轮 Y 用例不主动触发,避免和真实数据互相影响

---

## Z 系列 · v17 Task 一级对象(智慧住建翻译层骨架)

> 把行动项从「会议附属物」升格成 workspace 级 Task 对象,为后续主线(状态机 / 6 种触发源 / 主责协办 / 三级催办)铺路。本轮 UI 无感(零前端改动),全部验证集中在「ActionItem ↔ Task 双写一致性」+「`/api/me/tasks` 新读端」。

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| Z-1 | 创建 manual action,GET `/api/me/tasks` | 找到 Task 行,`source_type=meeting`,`source_ref` 含 meeting_id + action_item_id | ✅ |
| Z-2 | PATCH action `status=done`,再 GET `/me/tasks?status=open` 与 `?status=done` | open 列表无该 Task,done 列表含该 Task(状态镜像) | ✅ |
| Z-3 | DELETE action,再 GET `/me/tasks?status=all` | 列表里完全找不到对应 Task(级联清理无 orphan) | ✅ |
| Z-4 | 创建 meeting + action,GET `/me/tasks` | 行内 `meeting_id` / `meeting_title` 已注水(source_ref join 自动 hydrate) | ✅ |
| Z-5 | GET `/me/tasks?status=in_progress` | 返回 `[]`(v17 ActionItem 镜像不写 in_progress,留给 v18 状态机) | ✅ |

**手测点**:
- 走完一次完整会议(开会 → 文字录入 → 自动纪要 → 自动抽取 action) → /me/tasks 应该看到对应的 source_type='meeting' Task
- 后台启动日志应该出现 `due_reminder tick: due_soon=N overdue=M`,各条 notification 的 payload 里现在带 `task_id`(给 v18 用)

**架构决策**(v17 落地的认知偏移):
- Aimeeting 重心从「会议」偏移到「Task / 工单」,**会议变成 Task 的 6 个触发源之一**(智慧住建场景的 6 触发源:领导指令 / 会议决议 / 上级文件 / 定期巡检 / 异常预警 / 问题上报)
- 「智慧住建」「智慧 XX」都是 Aimeeting 的 workspace 实例,通过 `workspace.preset` 区分子系统行为,**单一代码库,不分叉**
- 现有 `MeetingActionItem` 在 v17 仍是 source-of-truth,Task 与之 1:1 镜像。v18 计划反过来:Task 升为 source-of-truth,ActionItem 退化为 view

### Z-6..Z-12 · v18 状态机 + 派发签收 + 三级催办

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| Z-6 | 创 task,POST `/api/me/tasks/{tid}/dispatch` { assignee, due_at, note } | 200,status=dispatched,dispatched_at + dispatched_by_user_id 都已写 | ✅ |
| Z-7 | 上一步任务 POST `.../accept` | 200,status=accepted,accepted_at 已写 | ✅ |
| Z-8 | 接 Z-7,POST `.../start`(in_progress)+ POST `.../complete`(done);校验 ActionItem 镜像同步 | 全 200,status 链路 in_progress → done;对应 ActionItem.status='done' | ✅ |
| Z-9 | 重新派发一个 task,然后 POST `.../return` { reason } | 200,status=open,assignee_user_id=null | ✅ |
| Z-10 | 在 status=open 的任务上直接 POST `.../accept`(跳过派发) | 422 状态机拒绝 | ✅ |
| Z-11 | GET `/api/me/notifications` | 响应含 `max_unread_severity ∈ {normal,yellow,red,purple}`,每条 item 都有 `severity` 字段 | ✅ |
| Z-12 | 把 task 派给自己(self-dispatch),前后比较 unread_count | 不增加(`task_dispatched` 抑制 self-notify) | ✅ |

**v18 后端启动日志预期**:
```
INFO app.init_db :: DB schema ensured        ← 5 个 ALTER 全部 idempotent 跑通
INFO app.due_reminder :: due_reminder_loop starting; tick=3600s
INFO app.due_reminder :: due_reminder tick: yellow=N red=M purple=K purple_admins=L
                                                                 ^---- 紫灯 escalation 给 owner+admin
```

**手测点**:
- 在已登录页面 `GET /api/me/notifications` 看 `max_unread_severity`(prod 默认账号有几条 red/purple,会驱动铃铛 badge 变红/紫)
- 在 `/me` 页打开抽屉 → 不同 severity 的行点颜色不同(amber/red/purple)
- 在会议页对自己的 action 调 PATCH status='done' 应当继续工作(legacy 直跳路径未被状态机阻断)

---

## AA 系列 · v19 领导指令 + 状态机收尾

> 让 Task 不再只来自会议 ── 用自然语言下达指令 → LLM 拆解 → 用户确认 → 批量入库;同时把 7 态(open / dispatched / accepted / in_progress / submitted / done / archived) + 一个 cancelled 的完整生命周期跑通。

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| AA-1 | POST `/api/me/directives` { content: "请王科长在本周五前提交…" } | 200 + status='draft' + drafts 数组非空 + 无 parse_error | ✅ |
| AA-2 | POST `/api/me/directives/{did}/commit` { tasks: [...] } | 入库 N 条 Task,source_type='leader_directive',source_ref.directive_id 反指 | ✅ |
| AA-3 | commit 时某条带 `dispatch:true` | Task 直接进 status='dispatched',dispatched_at 已写 | ✅ |
| AA-4 | POST `/discard` 一条 draft 指令,再 commit | discard 后状态='discarded',再 commit 返回 409 | ✅ |
| AA-5 | dispatched → accept → start → submit | status 链路完整,最终 status='submitted' | ✅ |
| AA-6 | submitted → POST `/approve`(creator/dispatcher) | status='done',触发 task_approved 通知 | ✅ |
| AA-7 | submitted → POST `/reject` { reason } | status='in_progress',携带 reason,触发 task_rejected 通知 | ✅ |
| AA-8 | done → POST `/archive`,以及 open → POST `/approve`(非法) | archive 200 + status='archived';非法 approve 422 | ✅ |

**手测点(单浏览器无法验证的部分)**:
- 顶栏 `+` 按钮 → 打开 DirectivePanel modal → 输入「李主任,5月15日前完成下半年预算初稿;张科长同步起草招标公告」→ 看到 LLM 拆出 2 条任务草稿,assignee 已自动匹配
- `/me` 页 5 个 tab(待签收/办理中/待审核/已完成/全部),不同状态的 Task 显示不同动作按钮(签收/退回/开始办理/上报办结/归档/等待审核)
- 派发给别人的 Task,在对方账号下铃铛收到 task_dispatched(severity=normal);对方 submit 后,我账号铃铛收到 task_submitted;`/me` 「待我审核」区出现这条任务,可点「通过/驳回」
- 后端启动日志期望出现 `app.init_db :: DB schema ensured`(新表 leader_directive 自动创建,无 ALTER 需要,因为本身是新表)

**架构演进**(v17 → v19 累积):
- v17:Task 升为一级对象(智慧住建翻译层骨架)
- v18:6 态状态机(open / dispatched / accepted / in_progress / done / cancelled) + 派发签收 + 三级催办
- **v19**:8 态状态机(加 submitted / archived) + 第二个触发源「领导指令」(`source_type='leader_directive'`)+ 简化版上报审核流
- 接下来 (v20+):上级文件触发源 + cron 巡检触发源 + 多 AI 协作主责/协办 + 数据 5 级分级 + 角色二分(领导/专家)+ 考核评价 + 看板 + SSO + 触达扩展

---

## BB 系列 · v20 上级文件 + 定期巡检触发源

> 触发源覆盖率从 v19 的 33% (2/6) → 67% (4/6).Aimeeting 不再只来自「会议 + 领导指令」,文件来文 + cron 定时也能造出工单.

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| BB-1 | POST `/api/me/upper-docs` 上传一段 .txt(含两条政务指令风内容) | 200,status='draft',drafts 数组非空,无 parse_error | ✅ |
| BB-2 | POST `/api/me/upper-docs/{did}/commit` { tasks: [...] } | Task 入库,source_type='upper_doc',source_ref.upper_doc_id 反指 | ✅ |
| BB-3 | 上传后 POST `/discard` → 再 commit | discard 后 status='discarded';再 commit 返回 409 | ✅ |
| BB-4 | cron rule create / list / patch is_active=false / delete | 4 步全 200 | ✅ |
| BB-5 | force-fire(auto_dispatch=false) | 立即生成 Task,source_type='cron',source_ref.rule_id 反指,status='open' | ✅ |
| BB-6 | force-fire(auto_dispatch=true + assignee + due_days_after=7) | Task 直接进 dispatched + dispatched_at + due_at 已写 | ✅ |
| BB-7 | POST `/api/cron-rules` cron_expr="bad" | 400 拒绝 | ✅ |

**手测点(单浏览器无法验证的部分)**:
- 顶栏 + 按钮 → DirectivePanel 切「上级文件」tab → 选一份 PDF → 等 10-30s → 看是否拆出 draft
- /admin/cron-rules 页:点「立即触发」→ 看是否在 /me 出现新任务
- 后端启动日志期望:`cron_runner_loop starting; tick=60s` + 触发后 `cron_runner tick: created N task(s)`

**架构演进**(v17 → v20 累积):
- v17:Task 升为一级对象
- v18:6 态状态机 + 派发签收 + 三级催办
- v19:8 态状态机 + 触发源 #1 领导指令 + 简化版上报审核
- **v20**:**触发源 #3 上级文件 + 触发源 #4 定期巡检 cron**;触发源覆盖率 33% → 67%
- 接下来 (v21+):多 AI 协作主责/协办 + 数据 5 级分级 + 角色二分(领导/专家)+ 考核评价 + 看板 + SSO + 触达扩展(企微/飞书/邮件)

---

## CC 系列 · v21 政务安全基线(角色二分 + 数据 5 级分级 + 跨 AI 共享审批)

> 智慧住建文档「二.1 + 二.3」要求的政务**准入**基线全套.做完这一版,Aimeeting 才能进入真实政务环境部署.

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| CC-1 | GET `/api/team/members` | 行含 `role` + `bound_agent_id`(expert 才有值)+ `bound_agent_name` 字段 | ✅ |
| CC-2 | PATCH `/api/team/members/{self_id}` | 400 拒绝(不能改自己的角色) | ✅ |
| CC-3 | 创建 Task,GET `/api/me/tasks` | 行含 `data_classification` 字段,默认值 `general` | ✅ |
| CC-4 | POST `/api/me/access-requests` 用伪造 task uuid | 404(目标资源不存在) | ✅ |
| CC-5 | POST `/api/me/access-requests` 申请自己拥有的 task | 400(您是该资源的拥有者,无需申请) | ✅ |
| CC-6 | GET `/api/me/access-requests?role=requester` | 200 + 数组,shape OK | ✅ |
| CC-7 | owner 角色调 `POST /api/cron-rules`(v21 加了 leader-only 守卫) | 200 通过(owner 是 leader 角色,守卫不拦) | ✅ |

**手测点(单浏览器 / 单账号无法验证的部分)**:
- /admin/team:把另一个 member 改成 `expert` 角色 + 选一个 bound Agent → 该用户重新登录后,只能看到 bound Agent 范围内的 Task / KB
- A 账号(expert)申请访问 B 账号(也是 expert,不同 bound Agent)的 sensitive Task → A 看到 403 + 提示「可发起访问申请」→ B 在「待我审核」section 看到申请 → B 点「批准 24h」→ A 在 24h 内访问 OK
- 改成员 role='expert' 但不选 bound Agent → 后端 400「expert role requires bound_agent_id」
- /me Task 行内现在出现彩色 badge(sensitive=琥珀 / important=橙 / core=红);general/public 不显示 badge

**v21 权限语义表**:

| Caller role | Task 看 | cron-rule CRUD | task dispatch | access-request approve |
|---|---|---|---|---|
| owner / admin / leader | 全部 | ✅ | ✅ | ✅ |
| expert | bound agent 范围 + 自己 assignee | ❌ 403 | ❌ 403 | 仅 target_owner=自己的 |
| member (legacy) | 自己 assignee | ❌ 403 | ❌ 403 | 仅 target_owner=自己的 |

**架构演进**(v17 → v21 累积):
- v17-v20:Task / 状态机 / 触发源 / 三级催办 / 上报审核(以上是「能力」)
- **v21**:角色二分 + 数据分级 + 跨 AI 共享审批(以上是「治理」)
- 接下来 (v22+):多 AI 协作主责/协办 + 看板 + 考核评价 + SSO + 触达扩展(企微/飞书/邮件)

---

## DD 系列 · v22 看板 Dashboard

> 智慧住建文档「四.5 看板」要求.领导首屏 — 一打开就看到全局.精品交付:7-segment 配色 / 6 图 / 加载/空/错误三态 / 角色 scope 过滤.

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| DD-1 | GET `/api/dashboard/overview` | 13 个字段全有(total_tasks / pending_review / overdue_red_purple / completion_rate / by_status[] / by_source[] / workload[] / completion_30d[] / creation_7d[] / evaluations[] / period / role / scope_label),关键字段类型正确 | ✅ |
| DD-2 | overview.completion_30d / creation_7d 长度 | 31 点(0..30 inclusive)/ 8 点;空天补齐为 0(便于折线连续) | ✅ |
| DD-3 | POST `/api/dashboard/seed-eval-data` { overwrite: false } | 200,返回 period + inserted/updated 数字 | ✅ |
| DD-4 | seed 后再 GET overview,看 evaluations | 非空,每条含 4 维 + composite,值在 [0,1] | ✅ |
| DD-5 | seed 第二次调用(overwrite=false) | inserted=0 + updated=0(幂等) | ✅ |
| DD-6 | seed 调用(overwrite=true) | updated > 0 | ✅ |

**手测点(单浏览器无法验证的部分)**:
- 顶栏新增 📊 按钮,owner/admin/leader/expert 可见;以 expert 角色登录,只能看到 bound agent 范围数据(scope_label='我绑定的 AI 专家')
- /dashboard 加载 → KPI 卡精品配色:总任务白 / 待签收琥珀 / 已逾期红 / 本月完成率(>80% 翠绿 / 50-80% 中性 / <50% 琥珀)
- 状态饼图 8 态用统一调色板;工作量横条把 overdue 部分标红 stacked
- 30d 折线:绿=完成、青虚线=创建,鼠标悬停看每天数字
- 4 维雷达:0-100% 量纲,top 3 用户三色叠加显示(蓝 / 绿 / 紫)
- 「🌱 Seed 评价」按钮只在 leader 角色看到;点了之后会 confirm 一次,然后 toast 反馈 +N/M
- 手动刷新按钮(↻),不自动轮询(避免打扰)

**v22 后端启动日志预期**:
```
INFO app.init_db :: DB schema ensured                  ← task_evaluation 表自动建,无 ALTER 需要
INFO app.due_reminder :: due_reminder_loop starting
INFO app.cron_runner  :: cron_runner_loop starting
```

**v22 同时落地了 T3 CI**(`.github/workflows/lint.yml`):
- 触发:push to main + PR
- 检查项:Python AST、JS 语法(两份 cowork_suite)、JSON 合法、两份 baseline 一致、两份 cowork_suite 一致、TypeScript noEmit
- 故意不跑端到端 Cowork(需 headless 浏览器 / 真 prod,留 v23+)

**架构演进**(v17 → v22 累积):
- v17-v20:Task / 状态机 / 触发源 / 三级催办 / 上报审核
- v21:政务安全基线(角色 + 分级 + 审批)
- **v22**:**视图层 1/3 ✅ 看板 + 考核评价 4 维 + T3 CI**(智慧住建文档「四.5」首次落地)
- 接下来 (v22.5):多 AI 协作主责/协办(对 v22 看板的「协作评分」给真数据)
- 接下来 (v23+):剩余触发源(异常预警 + 问题上报)+ 触达扩展(企微/飞书/邮件)+ SSO

---

## EE 系列 · v22.5 多 AI 协作(主责 + 协办)

> 智慧住建文档「四.3 办理上报与多 AI 协作」要求.让 Task 从「独角戏」升级为「结构化团队作战」.4 决策点拍板:协办可退出 / 未交警告但可硬过 / 协办互相可见 / 双向评分 / 5 人上限.

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| EE-1 | dispatch 含 `co_assignees=[user_b]`(主责=me,协办=另一用户) | 200,响应 `co_assignees` 数组含 user_b | ✅ |
| EE-2 | dispatch 协办 6 人 | 400「协办最多 5 人」 | ✅ |
| EE-3 | dispatch 协办包含主责自己 | 400「协办不能包含主责自己」 | ✅ |
| EE-4 | 非协办者(主责自己)调 `/co-submit` | 403「您不在该任务的协办列表里」 | ✅ |
| EE-5 | 主责 submit 未交协办 → 422;再带 force=true 重试 | 第一次 422 + 错误信息;第二次 200 + status='submitted' | ✅ |
| EE-6 | rate 自己 | 400「不能给自己打分」 | ✅ |
| EE-7 | rate dimension='wrong' / score=99 | 都 400 | ✅ |

**手测点(单浏览器无法验证的部分)**:
- DirectivePanel:勾选某 draft 「立即派发」+ 选主责后,**协办 chip 列表自动展开**;点 chip 切换 + 状态变化即时;选 5 人后第 6 个 chip 提示「最多 5 人」
- 双账号 A 派发给 B(主责)+ C(协办);C 在 `/me` 「我的协办」section 看到任务 + 「✓ 提交协办成果」按钮;C 提交后 B 的 `/me` 主任务行能看到「协办进度 1/N」(批量 join,无 N+1)
- B 主责调 submit:如果 C 还没交,弹 confirm「还有 1 个协办未提交,确认强制汇总?」;选「是」后 force=true 通过
- 领导 approve 后弹 **RateDialog**(精品 modal):5 分按钮组 + 评论框,可点「稍后再评」跳过;评分提交后 dashboard 雷达图本月分数立即从真数据来(覆盖 seed)
- 协办收到的 `task_co_assigned` 通知文案:「{派发人} 派发了协作任务给你:{content}」

**v22.5 现在用 v22 看板看效果**:
- 之前(v22)雷达图是 deterministic random seed 假数据,Demo 用
- 现在(v22.5)真实评分数据陆续累积,雷达图会从 seed 缓慢过渡到真数据
- 每次 approve+rate 触发 `recompute_user_evaluation`,实时更新

**架构演进**(v17 → v22.5 累积):
- v17-v20:Task / 状态机 / 触发源 / 三级催办 / 上报审核
- v21:政务安全基线(角色 + 分级 + 审批)
- v22:看板 Dashboard + 4 维评价 seed + T3 CI
- **v22.5**:**多 AI 协作主责/协办 + 真评价数据回写**(智慧住建文档「四.3」+「四.5 真数据」)
- 接下来 (v23+):剩余触发源(异常预警 + 问题上报)+ 派发四维评分 + 触达扩展(企微/飞书/邮件)+ SSO

---

## FF 系列 · v23 看板二期 + 报表 Excel 导出

> 智慧住建文档「四.5 看板」视图层 2/3 + 报表导出.精品交付,Excel only(政务用户拿到后自己挑数据).

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| FF-1 | GET `/api/dashboard/kanban-by-agent` | grouping='agent',columns 非空,role / scope_label 字段就绪 | ✅ |
| FF-2 | GET `/api/dashboard/kanban-by-user` | grouping='user',user 列按 cards 数降序,unassigned 末尾 | ✅ |
| FF-3 | include_closed=false vs true 两次拉 | true 卡片数 ≥ false(终态显示) | ✅ |
| FF-4 | GET `/api/reports/monthly-evaluation` | 200 + Content-Type 含 'spreadsheet' + Content-Disposition='attachment' | ✅ |
| FF-5 | GET `/api/reports/status-distribution?days=7/30/90` | 三个区间各自 200 + Excel CT | ✅ |
| FF-6 | days=3(<7 下限) | 422/400 拒绝 | ✅ |

**手测点(单浏览器无法验证的部分)**:
- /dashboard 顶部 3 张入口卡:AI 专家(青边)/ 科长(绿边)/ 报表中心(琥珀边),member 看到「报表中心」灰显「仅领导/管理员可访问」
- /dashboard/kanban-agents:水平滚动展示 N 列(每列 ≤ 280px);卡片精品 polish:左侧 4px 状态色边、状态 chip、assignee 头像 / 姓名、due 日期(逾期红字)、协办进度 N/M chip
- /dashboard/kanban-users:同样布局但按 assignee 分列;工作量大的排前;「未指派」永远末尾
- /dashboard/reports:选择月份(默认本月)→ 「↓ 导出 Excel」→ 浏览器下载 `月度评价_{workspace}_{YYYY-MM}_{时间戳}.xlsx`,文件打开后:Excel 表头加粗暗灰背景、第 6 行冻结、综合分降序、3-7 列百分比格式
- 状态分布报表:每天一行,8 个状态各自计数 + 当日新建 + 当日完成,2 列冻结
- T3 CI:GitHub Actions 里手动触发 `cowork-headless.yml`(需先在 Settings → Secrets 配 `AIMEETING_TEST_EMAIL/PASSWORD`),Playwright headless 跑全套 97 用例,失败 step 红显 + artifact 上传 markdown 报告

**Excel 文件结构(月度评价)**:
```
A1: 工作空间:{name} (粗体)
A2: 周期:YYYY-MM
A3: 导出时间:YYYY-MM-DD HH:MM
A4: 综合分计算公式说明 (斜体灰)
A6:J6: 表头 (粗体白字 + 暗灰填充 + 居中)
A7+: 数据行,综合分降序;百分比列自动 0.0% 格式
冻结:第 7 行起
```

**架构演进**(v17 → v23 累积):
- v17-v22:Task 中心化 + 状态机 + 触发源 4/6 + 政务安全 + 多 AI 协作 + 看板 Dashboard
- **v23**:**视图层 2/3 ✅ Kanban + 报表 Excel + Headless CI**(智慧住建文档「四.5」继续推进)
- 接下来 (v23.5):消息中心 + 任务详情页(/task/{id}) + 会议追溯链
- 接下来 (v24+):AI 数据分析(LLM eval + 问数 + 自动洞察)+ 任务做透(全局搜索 + 知识沉淀闭环)

---

## GG 系列 · v23.5 消息中心 + 任务详情页 + 会议追溯链

> 用户 4 大方向里的「方向 1 消息中心」+「方向 4 任务做透」+ 「会议沉淀可视化」三联动.信息密度提升:一个页面看完一个事(Task / Meeting),不再逼用户串多个页面拼上下文.

| 用例 | 操作 | 预期 | 状态 |
|---|---|---|---|
| GG-1 | 创建 meeting + action → GET `/api/me/tasks/{tid}/detail` | 200,timeline / co_progress / ratings / comments 都是数组,timeline 含 'created' 事件 | ✅ |
| GG-2 | GET `/api/me/tasks/{nonexistent uuid}/detail` | 404 | ✅ |
| GG-3 | dispatch 后再次 GET detail | 含 assignee_name + dispatched_by_name,timeline 出现 'dispatched' 事件 | ✅ |
| GG-4 | GET `/api/meetings/{mid}/trace`(GG-1 的 meeting) | meeting_id 匹配,total ≥ 1,by_status 是对象,GG-1 task 出现在 tasks 列表,带 task_id + action_item_id 双指针 | ✅ |
| GG-5 | trace 一个空 meeting | total=0,tasks=[] | ✅ |
| GG-6 | trace 不存在的 meeting | 404(workspace 隔离 / not found 统一) | ✅ |

**手测点(单浏览器无法验证的部分)**:
- AuthHeader 顶栏新增 💬 消息中心入口图标(所有角色可见,/messages)
- /messages:3 section 各带数字徽章(rose/cyan/zinc 渐变);需要我处理 = 主责待签收+办理 + 审核 + 协办,行点击 → /task/[id];我发起的进展 = task_accepted/returned/completed/co_submitted/co_withdrawn 通知;系统消息 = 其他;空状态 placeholder「享受短暂的安静 ✨」;全部已读按钮(已读时灰显)
- /task/[id]:精品任务详情页 — 标题 + 状态徽章 + 分级徽章 + 截止日(逾期红);元信息卡(来源 / 主责 / 派发人 / 协办列表带「已交/未交」chip);时间线带圆点(创建→派发→签收→开始→上报办结);协办交付卡片(每个协办一张,含 content);评分卡片(rater→ratee + 维度 + 5★ StarBar + comment);协作评论卡片(MeetingActionItemComment 顺手带过来)
- /meeting/[id]:会议结束后底部出现 🔗 追溯卡(状态徽章统计 + 任务列表),trace.total=0 时不渲染节省空间;每行点击进 /task/[id]
- NotificationBell 抽屉:头部新增「查看全部」 → /messages 链接;每行 deeplink 优先 /task/[id](task_id 兜底 meeting_id)
- /me Task 行(主责 + 协办两处)正文文字现在是 → /task/[id] 链接(hover accent 色)

**架构演进**(v17 → v23.5 累积):
- v17-v23:Task 中心化 + 8 态状态机 + 触发源 4/6 + 政务安全 + 多 AI 协作 + Dashboard + Kanban + 报表 + Headless CI
- **v23.5**:**信息密度联动 — 消息中心 + 任务详情 + 会议追溯**(智慧住建文档「四.1 流程闭环」+「四.5 视图」继续填齐)
- 接下来 (v24+):AI 数据分析(LLM eval + 问数 + 自动洞察)+ 任务做透(全局搜索 + 知识沉淀闭环)+ TaskAuditLog 表(精确时间线)+ 跨任务关联

---

## 测试报告模板

测完后请把这一段填给我：

```
测试人:
测试时间:
测试用例版本: v23.5
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
