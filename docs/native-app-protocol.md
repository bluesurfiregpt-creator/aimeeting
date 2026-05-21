# Aimeeting 客户端接入协议 v1

面向**小程序原生 / iOS App / Taro / 任何要接 Aimeeting 后端的客户端**实现者。本文档列出所有客户端会用到的 REST endpoint + WebSocket 事件 + 鉴权方式。

H5 端代码不需要看这份文档(直接看 `frontend/src/lib/mobile/api.ts` 即可)。

---

## 0. 基础约定

### 0.1 Base URL

| 环境 | Base URL |
|---|---|
| 生产 | `https://aimeeting.zhzjpt.cn` |
| WebSocket | `wss://aimeeting.zhzjpt.cn` |

### 0.2 鉴权(必读)

后端同时支持**三种鉴权方式**,客户端按场景选:

| 场景 | 方式 | 写在哪 |
|---|---|---|
| H5 浏览器 | Cookie `aimeeting_session` | 浏览器自动随 fetch 发 |
| **小程序原生 / iOS App** | **Authorization: Bearer `<token>`** | header(推荐) |
| 退而求其次(WebSocket 某些 SDK 不支持 header) | `?token=<jwt>` | query param |

**强烈推荐用 Bearer header**。query param 把 token 暴露在 URL 里,反向代理 access log 会记。

### 0.3 错误格式

所有 4xx / 5xx 响应:

```json
{ "detail": "中文友好提示 (可直接显给用户)" }
```

常见状态码:

| Code | 含义 | 客户端动作 |
|---|---|---|
| 401 | token 不存在/失效/过期 | 跳登录页 |
| 403 | 鉴权通过但无权限 | 弹 `detail` 提示,不跳登录 |
| 404 | 资源不存在或不属于当前 workspace | 提示并返回上页 |
| 413 | 上传文件超限 | 提示文件大小限制 |
| 422 | 请求体校验失败(Pydantic) | 提示参数问题 |
| 502 | 上游(LLM / OSS / FunASR)失败 | 重试 1-2 次,仍失败提示 |
| 503 | 服务未配置(如 OSS 没配) | 提示联系管理员 |

### 0.4 时间格式

所有时间字段都是 **UTC ISO 8601**(`2026-05-21T10:30:00.123Z`)。客户端**自己转本地时区**显示。

### 0.5 ID 格式

资源 ID 都是 UUID v4(`bfaf52e4-ba42-4eb6-9577-20a1ffcd4a55`)。Action item / agent message / transcript line 例外,是 bigint。

---

## 1. 鉴权

### 1.1 `POST /api/auth/token` —— 邮箱密码换 token ⭐

**请求**(不需要鉴权):

```json
{ "email": "user@example.com", "password": "..." }
```

**响应** 200:

```json
{
  "token": "eyJhbGciOiJIUzI1NiI...",
  "token_type": "Bearer",
  "expires_at": "2026-06-20T09:07:27.290421Z",
  "user_id": "12728da4-...",
  "workspace_id": "bfaf52e4-...",
  "role": "owner"
}
```

**错误**: 401 邮密错 / 403 账号被禁用

**客户端用法**:

```js
// 小程序
wx.request({
  url: 'https://aimeeting.zhzjpt.cn/api/auth/token',
  method: 'POST',
  data: { email, password },
  success: ({ data }) => {
    wx.setStorageSync('aim_token', data.token);
    wx.setStorageSync('aim_token_exp', data.expires_at);
  }
});
```

Token 默认 30 天有效。客户端每次启动检查 expires_at,距过期 < 7 天调 refresh。

### 1.2 `POST /api/auth/token/refresh` —— 延期换新 token

**请求**(需 Bearer auth,body 空):

```
Authorization: Bearer <current_token>
```

**响应** 200:同 1.1。

**用途**:客户端启动时检测 `expires_at - now < 7 天`,调一次 refresh 拿新 token 替换。

旧 token 不显式作废(JWT 是 stateless),但很快自然过期,风险可控。

### 1.3 `GET /api/auth/me` —— 当前用户信息

**响应** 200:

```json
{
  "user_id": "...",
  "name": "张三",
  "email": "...",
  "workspace_id": "...",
  "workspace_name": "默认工作空间",
  "workspace_slug": "default",
  "role": "owner",
  "department": "物业 / 安保",
  "primary_agents": [{"id":"...", "name":"...", "color":"violet", "domain":"物业", "kb_count":3, "is_active":true}],
  "bound_agent_id": null,
  "task_counts": {"pending":2, "working":1, "review":0, "kb_sedimentation_pending":0, "memory_draft_pending":1}
}
```

客户端启动 + 首页都会用。建议缓存 30 秒。

### 1.4 `POST /api/auth/logout`

**响应** 200 `{ "ok": true }`。清除 cookie(H5 路径用)。小程序原生只需要本地删 token,不必调这个。

---

## 2. 移动端聚合 endpoints(以 `/api/m/` 开头)

这套是**专门为移动端聚合好的**——单次请求拿到首页/详情页所有需要的字段,减少 round trip。

### 2.1 `GET /api/m/workbench` —— 首页今日聚合

返回今日所有 ongoing meeting + 待处理任务 + 今日 AI 产出。

**响应**:

```json
{
  "ongoing_meetings": [{
    "meeting_id": "...",
    "title": "Q1 投诉评估",
    "started_minutes_ago": 12,
    "current_agenda_idx": 1,
    "total_agenda_items": 4,
    "latest_insight": { /* AIInsightBrief */ }
  }],
  "pending": [/* WorkbenchPendingTask 数组 */],
  "todays_insights": [/* AIInsightFull 数组 */]
}
```

### 2.2 `GET /api/m/meetings` —— 会议列表

**响应** `{ items: [MobileMeetingListRow] }`,每条含 `meeting_id / title / status / started_at / ended_at / minutes_total / planned_minutes / agenda_total / current_agenda_idx / users_count / agents_count / insights_count / actions_count`。

### 2.3 `GET /api/m/meetings/{meeting_id}` —— 会议详情 ⭐

会议室主页要的所有字段都在这。

**响应**:

```json
{
  "meeting_id": "...",
  "title": "...",
  "status": "ongoing|scheduled|finished|processed",
  "started_minutes_ago": 12,
  "can_control": true,
  "agenda_items": [{
    "idx": 0, "title": "...", "time_budget_min": 15,
    "status": "done|active|pending", "elapsed_min": 8
  }],
  "current_agenda_idx": 1,
  "is_agenda_complete": false,
  "current_topic_title": "...",
  "current_topic_elapsed_min": 8,
  "current_topic_insights": [/* AIInsightFull */],
  "current_topic_recent_lines": [{"speaker_name":"...", "text":"...", "at_minute":5}],
  "transcript_total": 47,
  "other_topics_count": 2,
  "attending_agents": [{"agent_id":"...", "name":"...", "nickname":"...", "domain":"...", "color":"violet", "role":"expert"}]
}
```

### 2.4 `POST /api/m/meetings/{meeting_id}/start` —— scheduled → ongoing

**响应**: `{ meeting_id, status, started_at }`

### 2.5 `POST /api/m/meetings/{meeting_id}/summon` —— 召唤 AI 发言

**请求**: `{ "agent_id": "..." }`

**响应**: `{ "accepted": true, "agent_id": "...", "agent_name": "..." }`(异步发言会通过 WS 推 `agent_message_*` 事件)

### 2.6 `GET /api/m/meetings/{meeting_id}/transcript` —— 完整转录

**响应**: `{ meeting_id, title, status, started_at, total_user_lines, total_agent_lines, lines: [TranscriptStreamLine] }`

### 2.7 `GET /api/m/tasks` —— 任务列表

返回我的任务 + 待我审核的草稿。

**响应**: `{ me_primary_count, other_participating_count, items: [MobileTaskItem] }`

### 2.8 `GET /api/m/tasks/{action_item_id}` —— 任务详情

含完整 evidence + 评论。

### 2.9 `GET /api/m/agents/workboard` —— AI 专家工卡

**响应**: `{ agents: [AgentWorkCard] }`

### 2.10 `GET /api/m/agents/{agent_id}` —— 单专家详情

含历史会议 + 产出的 insight + 接的任务。

### 2.11 `GET /api/m/insights` —— 记忆模块 (前称智囊)

| Query | 含义 |
|---|---|
| `limit=N` | 默认 30,上限 100 |
| `by_agent=<uuid>` | 仅某专家产出 |
| `by_meeting=<uuid>` | 仅某会议产出 |
| `for_review=true` | **仅 AI 推荐入记忆 + 用户未审**(给"待审" tab 用) |

**响应**: `[AIInsightFull]`

### 2.12 `PATCH /api/m/insights/{id}/decision` —— 待审 insight 拍板

**请求**: `{ "decision": "accepted" }` 或 `{ "decision": "rejected" }`

**响应**: `{ "id": "...", "human_decision": "accepted|rejected", "memory_id": "..." | null }`

accepted 时后端自动 INSERT 一条 `long_term_memory`,返 `memory_id`。

---

## 3. 会议生命周期(`/api/meetings/*`)

### 3.1 `POST /api/meetings` —— 创建会议

**请求**:

```json
{
  "title": "Q1 投诉评估",
  "attendee_user_ids": ["uuid", "..."],
  "attendee_agent_ids": ["uuid", "..."],
  "agenda": [{"title":"...", "time_budget_min":15, "note":"..."}],
  "mode": "human|hybrid|auto",
  "description": "会议背景 brief...",
  "client_draft_id": "前端 uuid (用于关联预先上传的附件)"
}
```

**auto 模式校验**: agenda ≥ 2 项 + attendee_agent_ids 含 ≥ 3 个 active expert。

**响应**: `MeetingOut` 完整字段(id / title / status / mode / agenda / attendee_user_ids / attendee_agent_ids / description / created_by_user_id / 等)

### 3.2 `POST /api/meetings/decompose-agenda` —— AI 拆议程

**请求**:

```json
{
  "brief": "Q1 物业投诉 +35%, 想拆原因 + 拟 Q2 整改, 预算 ≤ 50w",
  "title": "会议名(可选)",
  "target_count": 3,
  "client_draft_id": "如有上传附件,传 draft_id, AI 会读附件内容"
}
```

**响应**:

```json
{ "items": [{"title":"...", "note":"...", "time_budget_min":10}] }
```

3-30 秒 LLM 调用,客户端要显 loading。

### 3.3 `POST /api/meetings/{meeting_id}/finalize` —— 结束会议

**响应**: `MeetingOut`(status: finished)。后端会异步触发:run_identify + run_insight_pipeline(抽快照 + 筛 worth_remembering)。

### 3.4 `POST /api/meetings/{meeting_id}/agents` —— 会议中追加 AI

**请求**: `{ "agent_ids": ["uuid"] }`

**响应**: `{ added: [...], already_invited: [...], invalid: [...], attendee_agent_ids: [...] }`

### 3.5 `POST /api/meetings/{meeting_id}/agenda-advance` —— 推进议程

权限:leader+ 或会议创建人。

### 3.6 `GET /api/meetings/{meeting_id}/summary` —— AI 纪要

**响应**: `{ summary_md: string | null, status: "pending|ready|skipped|failed", message: string | null }`

`status=pending` 时客户端轮询(后端是异步生成的)。

### 3.7 `GET /api/meetings/{meeting_id}/actions` —— 抽出的待办

**响应**: `[ActionItemOut]`,每条含 `content / assignee_user_id / due_at / status / evidence_quote / 等`。

### 3.8 `PATCH /api/meetings/{mid}/actions/{aid}` —— 待办状态机

**请求**: `{ "status": "done|cancelled|in_progress|..." }`

### 3.9 `GET /api/meetings/{meeting_id}/export?format=md|docx` —— 导出

返二进制 blob,Content-Disposition: attachment。客户端用 `wx.downloadFile` 拿。

---

## 4. 会议附件(`/api/meetings/attachments/*`)

### 4.1 `POST /api/meetings/attachments` —— 上传(multipart)⭐

**form fields**:
- `file` (multipart) - 文件二进制
- `client_draft_id` (string, optional) - 前端 uuid,创建会议前用这个关联
- `meeting_id` (uuid, optional) - 直接关联已存在会议

两者**二选一必填**(都给则 meeting_id 优先)。

**响应** `AttachmentOut`:

```json
{
  "id": "...",
  "workspace_id": "...",
  "meeting_id": null | "...",
  "client_draft_id": null | "...",
  "uploader_user_id": "...",
  "filename": "Q1 投诉.pdf",
  "mime": "application/pdf",
  "extension": "pdf",
  "size_bytes": 123456,
  "extract_status": "ready|extracting|skipped|failed",
  "extract_summary": "AI 浓缩的摘要...",
  "last_error": null
}
```

**约束**:
- 单文件 ≤ 50MB,超返 413
- 支持: `.pdf .docx .xlsx .pptx .txt .md .csv .log .json .yaml .yml .jpg .jpeg .png .bmp .tiff .webp .gif`
- 不支持的类型返 400
- 图片会异步走 OCR(extract_status: extracting → ready / skipped)

**小程序用法**:

```js
wx.uploadFile({
  url: 'https://aimeeting.zhzjpt.cn/api/meetings/attachments',
  filePath: tempFilePath, // wx.chooseMessageFile 返的
  name: 'file',
  formData: { client_draft_id: 'xxx' },
  header: { Authorization: `Bearer ${token}` }
});
```

### 4.2 `GET /api/meetings/attachments?draft_id=<uuid>` —— 列 draft 下的

仅上传人本人可见(防别人借 draft_id 偷看)。

### 4.3 `GET /api/meetings/{meeting_id}/attachments` —— 列已挂会议的

同 workspace 任何登录用户可见。

### 4.4 `DELETE /api/meetings/attachments/{attachment_id}`

权限:上传人本人 或 leader+。

---

## 5. 团队 + 专家

### 5.1 `GET /api/team/members` —— 工作区成员列表

**响应**: `[WorkspaceMember]`,每条 `user_id / name / email / role / department`。

leader+ 才能拉。member 角色 403。

### 5.2 `GET /api/agents?active_only=true` —— 工作区 AI 列表

**响应**: `[WorkspaceAgentBrief]`,每条 `id / name / nickname / domain / color / role / is_active`。

---

## 6. WebSocket(`/ws/stt`)⭐

会议室核心实时通道。

### 6.1 建立连接

```
wss://aimeeting.zhzjpt.cn/ws/stt?meeting_id=<uuid>
```

**鉴权**(三选一,推荐 header):

| 方式 | 怎么传 | 备注 |
|---|---|---|
| **Bearer header** | `Authorization: Bearer <token>` | 推荐,小程序 wx.connectSocket header 参数支持 |
| query param | `?token=<jwt>` 加在 URL | fallback,token 会进 access log |
| cookie | 浏览器自动 | 仅 H5 |

**小程序原生**:

```js
wx.connectSocket({
  url: `wss://aimeeting.zhzjpt.cn/ws/stt?meeting_id=${meetingId}`,
  header: { Authorization: `Bearer ${token}` }
});
```

### 6.2 Client → Server 消息

#### 6.2.1 Binary —— PCM 音频帧

直接发 `ArrayBuffer`,格式:**16 kHz mono 16-bit signed PCM little-endian**。

每帧建议 100-500 ms(1600-8000 采样)。

```js
wx.sendSocketMessage({ data: pcmArrayBuffer });
```

#### 6.2.2 Text JSON —— 控制指令

```json
{ "action": "stop" }
```

停止当前 WS 会话(主动断开)。

```json
{ "action": "invoke_agent", "agent_id": "<uuid>", "query": "可选的提问 prompt" }
```

召唤指定 AI 发言。AI 的发言会以 `agent_message_*` 事件流式推回。

```json
{ "action": "text_message", "text": "我要说的话", "speaker_user_id": "<uuid>" }
```

不用麦克风,直接打字代替 ASR final 句子。

### 6.3 Server → Client 事件 ⭐

所有事件都是 JSON text:`{"type": "...", "<其他字段>"}`。

#### 6.3.1 系统类

| `type` | 字段 | 含义 |
|---|---|---|
| `system` | `msg: "ready" \| "auth required" \| "invalid meeting_id" \| "meeting not found" \| "internal_error"` | 系统消息 |

`msg=ready` 表示 ASR 后端就绪,可以开始发 PCM。`auth required` 后 server 会立刻 close。

#### 6.3.2 转录类

| `type` | 字段 | 含义 |
|---|---|---|
| `transcript_persisted` | `line_id, start_ms, end_ms, text, speaker_name, speaker_status` | ASR final 句子已落库(可以渲染到列表)|
| `speakers_updated` | (无 payload) | 声纹识别完成,客户端重新拉 `/api/m/meetings/{id}/transcript` |

#### 6.3.3 AI 发言流式类

AI 发言(无论是被关键词触发、被议程监控召唤、还是被用户 `invoke_agent` 召唤)都走这套流式协议:

| `type` | 字段 | 含义 |
|---|---|---|
| `agent_message_start` | `agent_id, agent_name, agent_nickname, agent_color` | AI 开始说话(渲染气泡 + 紫色脉动光标)|
| `agent_message_chunk` | `agent_id, chunk` | 一段文本 chunk(追加到当前气泡)|
| `agent_message_end` | `agent_id, text` (完整文本), `citations` (引用知识库的 [{chunk_id, kb_id, ...}]) | AI 说完(关脉动光标)|

#### 6.3.4 会议室协作类

| `type` | 字段 | 含义 |
|---|---|---|
| `agents_invited` | `agent_ids: [uuid]` | 新 AI 被邀进会议(刷新 attending_agents)|
| `dissent_detected` | `summary, ...` | AI 自动识别立场分歧(渲红色 banner)|

#### 6.3.5 议程监控类(M3.0 / P16)

6 种 banner,小程序需要渲染对应的 UI:

| `type` | 关键字段 | 用途 |
|---|---|---|
| `agenda_off_topic` | `off_topic_severity` (suspected/confirmed/severe), `off_topic_summary`, `current_agenda_item`, `suggested_agenda_item`, `auto_summon_after_s` | 跑题预警(severe 时 8 秒倒计时后自动召唤主持人)|
| `agenda_stuck` | `stuck_summary`, `auto_summon_after_s: 5` | 议题僵局(5 秒倒计时后自动召唤)|
| `agenda_time_warning` | `time_warning_text`, `elapsed_min` | 议题时间预警 |
| `agenda_decision_summary` | `decision_brief`, `decision_summary_query`, `current_agenda_item`, `auto_summon_after_s: 12` | 多立场无人拍板(12 秒后召唤主持人收口)|
| `agenda_advance_suggested` | `advance_reason`, `current_agenda_item`, `next_agenda_item`, `current_agenda_idx`, `next_agenda_idx` | 建议推进下一议程项 |

### 6.4 断线 / 重连

WebSocket 在弱网会断。小程序原生客户端要做的:

1. `wx.onSocketClose` 监听断开
2. exponential backoff 重连:1s / 2s / 4s / 8s / 16s,上限 60s
3. 重连后客户端**自己重发** `wx.connectSocket` + 鉴权 header
4. **重连不补发音频**(已经过去的语音不要再发)
5. 重连后调 `GET /api/m/meetings/{id}/transcript` 拿断开期间的转录补齐

---

## 7. 错误处理与常见 gotcha

### 7.1 401 处理

任何 endpoint 返 401,客户端要:
1. 清本地 token
2. 跳到登录页
3. 不要试图 refresh(refresh 也会 401)

### 7.2 文件上传超时

50MB 大文件 + 4G 网络,可能要 1-2 分钟。`wx.uploadFile` 默认 60s,改大:

```js
wx.uploadFile({ ..., timeout: 120000 });
```

### 7.3 LLM 慢

- 议程拆解 `/api/meetings/decompose-agenda` 10-30 秒
- 会议结束抽 insight 30-60 秒(异步,不阻塞 finalize endpoint)
- AI 发言 streaming 一般每秒 30-80 字

客户端要做明显的 loading 提示。

### 7.4 WS 第一条 PCM 必须等 `ready`

收到 `{"type":"system","msg":"ready"}` 之后才能开始发 PCM 帧。早发会被 ASR client 忽略。

### 7.5 PCM 格式严格

- 必须 **16000 Hz** sample rate
- 必须 **mono**(1 通道)
- 必须 **16-bit signed**
- 必须 **little-endian**
- 不能是 WAV 容器(只发 raw PCM,没 header)

格式错 ASR 不会报错,只是出来的转录全是乱码。

### 7.6 Agent message `chunk` 字段可能为空字符串

LLM streaming 偶尔出空 chunk,客户端要忽略 `chunk === ""` 的情况。

---

## 8. 完整流程模板(小程序原生)

### 8.1 启动 + 鉴权

```js
// app.js onLaunch
const token = wx.getStorageSync('aim_token');
const exp = wx.getStorageSync('aim_token_exp');
if (!token) {
  // 跳登录页
} else if (exp && (new Date(exp) - Date.now()) < 7 * 24 * 3600 * 1000) {
  // 距过期 < 7 天, refresh
  wx.request({
    url: 'https://aimeeting.zhzjpt.cn/api/auth/token/refresh',
    method: 'POST',
    header: { Authorization: `Bearer ${token}` },
    success: ({ data }) => {
      wx.setStorageSync('aim_token', data.token);
      wx.setStorageSync('aim_token_exp', data.expires_at);
    }
  });
}
```

### 8.2 进入会议室(WS + 录音)

```js
const token = wx.getStorageSync('aim_token');
const socketTask = wx.connectSocket({
  url: `wss://aimeeting.zhzjpt.cn/ws/stt?meeting_id=${meetingId}`,
  header: { Authorization: `Bearer ${token}` }
});

socketTask.onOpen(() => {
  // 等 ready 再开录音
});

socketTask.onMessage(({ data }) => {
  const event = JSON.parse(data);
  switch (event.type) {
    case 'system':
      if (event.msg === 'ready') startRecording();
      break;
    case 'transcript_persisted':
      appendTranscriptLine(event);
      break;
    case 'agent_message_start':
      startAgentBubble(event);
      break;
    case 'agent_message_chunk':
      appendChunkToBubble(event.agent_id, event.chunk);
      break;
    case 'agent_message_end':
      finalizeAgentBubble(event.agent_id, event.text);
      break;
    case 'agenda_off_topic':
      showBanner(event);
      break;
    // ... 其他 agenda_* 事件
  }
});

const recorderManager = wx.getRecorderManager();
recorderManager.onFrameRecorded(({ frameBuffer }) => {
  // frameBuffer 是 ArrayBuffer, 16000 Hz mono PCM
  socketTask.send({ data: frameBuffer });
});

function startRecording() {
  recorderManager.start({
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 256000,
    format: 'PCM',
    frameSize: 5,  // 5 KB 一帧 ≈ 156 ms
  });
}
```

### 8.3 召唤 AI 发言

```js
socketTask.send({
  data: JSON.stringify({
    action: 'invoke_agent',
    agent_id: agentId,
    query: '可选的提问'
  })
});
// 之后会收到 agent_message_start / chunk / end 事件流
```

---

## 9. 版本与变更

| 版本 | 日期 | 说明 |
|---|---|---|
| v1 | 2026-05-21 | 初版,基于 backend v27.0-mobile P21 原生 C-1 |

后端接口变更会保持向后兼容(deprecate 前 2 个版本周期不会立刻删字段)。重大变更会发邮件 + 在本文档头部"破坏性变更"段标注。

---

## 联系

接入过程中遇到本文档没覆盖的场景,联系 `bluesurfiregpt@gmail.com`,我们补文档。
