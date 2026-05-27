# SCHEMA · Mobile App v2 (设计稿 W7EBmrwc4z2NJXYWSVbo7Q)

**版本**: v2.0 (Phase 1 锁定)
**锁定日期**: 2026-05-27
**生效范围**: Saga M / N / O / P · 4 sub-saga (~12.5 工程日)
**PM 拍板**: 1=a (仿真业务) · 2=a (写死 6 轴) · 3=a (Mira V1 mock) · 4=a (7 天窗口) · 5=a (backend mock endpoint)

---

## 0. 通用约定

### 命名 / 类型
- **字段命名**: `snake_case` (跟现有 backend 一致)
- **时间**: ISO 8601 UTC 字符串, eg `"2026-05-27T10:30:00Z"`
- **ID**: UUID v4 字符串
- **颜色**: hex 6 位字符串, eg `"#5E5CE6"` (含 #)
- **nullable**: 标注 `?` 或 `| null`. 默认必填

### Enum 约定
- `attendee_type`: `"human"` | `"ai"`
- `urgency`: `"urgent"` | `"today"` | `"week"` | `"none"`
- `insight_type`: `"突破"` | `"决策"` | `"风险"` | `"洞察"` | `"思路"`
- `meeting_status`: `"upcoming"` | `"live"` | `"finished"` | `"processed"`
- `task_status`: `"pending"` | `"in_progress"` | `"tracking"` | `"done"` | `"blocked"`

### Mock data 风格 (PM 1=a 仿真业务)
- 基于福田住建局 demo workspace 真实场景
- AI 引用真实命名: Mira / Stratos / Aria / Saga / Lex / Sage / Phoenix / Aria-7 / Hummingbird / Echo
- 真人引用 demo accounts: 李局长 / 陈科长 / 冯林 / 韩雪
- 会议主题: "Q3 路线图对齐" / "搜索体验评审" / "电梯改造方案决策会" / "协作功能能否进入 Q3" 等

### 接口契约管理 (PM 5=a backend mock endpoint)
- 所有 17 个 `/api/v2/*` endpoint 在 Phase 1 由 backend 实现, 返回写死 mock JSON
- 前端 fetch 真实 URL, Phase 2 backend 替换为真实查询逻辑
- Mock JSON 字段 + 类型 + enum 必须跟本 SCHEMA 一致

---

## 1. AI 专家 / 真人 / Mira 共享数据模型

### `AIAgent` (10 个 AI 专家)

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | |
| `name` | string | "Mira" / "Aria" / "Stratos" |
| `glyph` | string | 单字符 icon: `◎` / `⌬` / `◆` / `§` |
| `gradient_from` | hex | `"#FFB340"` |
| `gradient_to` | hex | `"#FF9F0A"` |
| `role_short` | string | "首席协调 AI" / "工程架构师" |
| `is_moderator` | bool | Mira = true, 其他 false |

**10 个 AI 固定列表** (Phase 1 mock):
```
Mira (◎) #FFB340 → #FF9F0A · 首席协调 AI · moderator
Aria (⌬) #0A84FF → #5E5CE6 · 用户体验
Stratos (◆) #AF52DE → #FF375F · 工程架构
Lex (§) #FF9F0A → #FFB340 · 法规合规
Saga (◐) #34C759 → #1F8A5B · 财务建模
Sage (✦) #5E5CE6 → #AF52DE · 数据洞察
Phoenix (▲) #FF3B30 → #FF6482 · 项目管理
Aria-7 (◉) #30B0C7 → #0A84FF · 产品策略
Hummingbird (♪) #FF6482 → #FF375F · 客户体验
Echo (◇) #BF5AF2 → #5E5CE6 · 知识管理
```

### `HumanUser` (真人头像配色)

| 字段 | 类型 |
|---|---|
| `id` | uuid |
| `name` | string |
| `surname_char` | string | "李" |
| `avatar_color` | hex | 9 色不重复轮转 (见下) |
| `email` | string |
| `role` | string |

**9 色轮转**:
`#FF9F0A` `#34C759` `#5E5CE6` `#FF375F` `#30B0C7` `#AF52DE` `#FF6482` `#0A84FF` `#BF5AF2`

### `Attendee` (会议参与者, 通用 schema)

```json
{
  "type": "human" | "ai",
  "id": "uuid",
  "name": "李局长" | "Mira",
  "color": "#FF9F0A",              // human 用 avatar_color, ai 用 gradient_from
  "glyph": "◎" | null,             // ai 才有, human 是 null
  "gradient_to": "#FF9F0A" | null  // ai 才有
}
```

---

## 2. Saga M — Meetings tab + 全局 polish

### 2.1 `GET /api/v2/meetings/week-pulse` (M3 MiraPulseNotice)

**Mock Response**:
```json
{
  "week_start": "2026-05-25T00:00:00Z",
  "week_end": "2026-05-31T23:59:59Z",
  "meeting_count": 6,
  "summary_text": "本周 6 场会, 搜索体验线吃掉了 4 场",
  "decision_recommendation": "Q3 路线图卡在「协作功能取舍」上, 建议 10:30 拍板, 后补会议由 Stratos 提摘要",
  "chips": [
    { "label": "今日决策", "count": 1, "icon": "📌" },
    { "label": "待同步", "count": 3, "icon": "📥" }
  ]
}
```

### 2.2 `GET /api/v2/meetings` (M3 升级,带 attendees + AI badges + topic)

**Query**: `?status=live|upcoming|finished&limit=20&cursor=...`

**Mock Response**:
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Q3 路线图对齐",
      "topic_summary": "产品组周会 · Q3 重点路线 · 协作功能取舍",
      "status": "live",
      "started_at": "2026-05-27T09:30:00Z",
      "scheduled_for": "2026-05-27T09:30:00Z",
      "ended_at": null,
      "elapsed_minutes": 23,
      "countdown_seconds": null,
      "decision_count": 0,
      "attendees": [
        {"type":"human","id":"u1","name":"周","color":"#FF9F0A","glyph":null,"gradient_to":null},
        {"type":"human","id":"u2","name":"林","color":"#34C759","glyph":null,"gradient_to":null},
        {"type":"human","id":"u3","name":"王","color":"#5E5CE6","glyph":null,"gradient_to":null},
        {"type":"human","id":"u4","name":"陈","color":"#FF375F","glyph":null,"gradient_to":null},
        {"type":"human","id":"u5","name":"沙","color":"#30B0C7","glyph":null,"gradient_to":null}
      ],
      "human_count": 5,
      "ai_count": 3,
      "ai_badges": [
        {"id":"ai1","name":"Aria","glyph":"⌬","gradient_from":"#0A84FF","gradient_to":"#5E5CE6"},
        {"id":"ai2","name":"Stratos","glyph":"◆","gradient_from":"#AF52DE","gradient_to":"#FF375F"},
        {"id":"ai3","name":"Mira","glyph":"◎","gradient_from":"#FFB340","gradient_to":"#FF9F0A"}
      ]
    }
  ],
  "next_cursor": null
}
```

### 2.3 全局 (M8)
- Bottom tab bar 加 `backdrop-filter: blur(24px) saturate(180%)`
- Top Bar 加 subtitle (date / 计数)
- 文案统一: 时间显示从 `"已 9070 min"` 改 `"已 23 分"`

---

## 3. Saga N — Today 页 (M2)

### 3.1 `GET /api/v2/today/brief` (Mira 早间简报)

```json
{
  "id": "brief-2026-05-27",
  "generated_at": "2026-05-27T08:00:00Z",
  "title": "Mira · 早间简报",
  "summary_text": "今天 3 场会议, 其中 Q3 路线图是关键. 已为你提取昨天遗留的 4 个未决议题, Mira 建议优先在 10:30 的会上拍板「协作功能是否进入 Q3」.",
  "chips": [
    {"label":"优先拍板", "color":"#5E5CE6"},
    {"label":"Q3 协作功能", "color":"#7A5AF0"},
    {"label":"预读 Sage 评审稿", "color":"#AF52DE"}
  ],
  "target_meeting_id": "uuid-of-Q3-meeting"
}
```

### 3.2 `GET /api/v2/today/live-meeting`

返回 0 或 1 个当前 live 会议. 复用 §2.2 Meeting 结构, 但加 `mira_note`:

```json
{
  "meeting": { /* same as §2.2 item */ },
  "mira_note": "提议 11:30 前把「协作功能能否进入 Q3」拍板, 后续由 Stratos 提摘要"
}
```

如无 live 会议: `{ "meeting": null, "mira_note": null }`

### 3.3 `GET /api/v2/today/snapshot` (4 格 stat)

```json
{
  "meetings_today": 4,
  "pending_tasks": 3,
  "ai_insights_today": 4,
  "decisions_today": 2
}
```

### 3.4 `GET /api/v2/today/pending-tasks` (等你处理 section)

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "拍板「协作功能能否进入 Q3」",
      "source_meeting": "Q3 路线图对齐",
      "source_meeting_id": "uuid",
      "urgency": "today",
      "ai_source": {"id":"ai2","name":"Stratos","glyph":"◆","color":"#AF52DE"},
      "due_at": "2026-05-27T11:30:00Z",
      "due_display": "今天 11:30"
    },
    {
      "id": "uuid",
      "title": "审核 Sage 搜索结果页 chip 顺序变更",
      "source_meeting": "搜索体验评审",
      "source_meeting_id": "uuid",
      "urgency": "today",
      "ai_source": {"id":"ai6","name":"Sage","glyph":"✦","color":"#5E5CE6"},
      "due_at": "2026-05-27T14:00:00Z",
      "due_display": "今天 14:00"
    },
    {
      "id": "uuid",
      "title": "回复 Hummingbird 关于摘要质量的疑问",
      "source_meeting": "客户访谈",
      "source_meeting_id": "uuid",
      "urgency": "week",
      "ai_source": {"id":"ai9","name":"Hummingbird","glyph":"♪","color":"#FF6482"},
      "due_at": "2026-05-29T18:00:00Z",
      "due_display": "本周"
    }
  ],
  "total_count": 3
}
```

### 3.5 `GET /api/v2/today/insights` (AI 智囊·今日)

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "决策",
      "ai_source": {"id":"ai2","name":"Stratos","glyph":"◆","color":"#AF52DE"},
      "title": "建议把协作功能延后到 Q4 第一双周",
      "body": "Q3 已锁 3 大特性, 协作功能预估 18d, 撞到上线窗口...",
      "source_meeting": "Q3 路线图对齐",
      "source_meeting_id": "uuid",
      "created_at": "2026-05-27T09:50:00Z"
    },
    {
      "id": "uuid",
      "type": "风险",
      "ai_source": {"id":"ai4","name":"Lex","glyph":"§","color":"#FF9F0A"},
      "title": "搜索改版上线前需补合规审查",
      "body": "新增按词典分词逻辑可能触及 PII 处理边界...",
      "source_meeting": "搜索体验评审",
      "source_meeting_id": "uuid",
      "created_at": "2026-05-27T10:15:00Z"
    },
    {
      "id": "uuid",
      "type": "洞察",
      "ai_source": {"id":"ai6","name":"Sage","glyph":"✦","color":"#5E5CE6"},
      "title": "Hummingbird 客户对摘要节奏感反馈强烈",
      "body": "近 7 天 3 位客户提到「想要更短的摘要 + 关键句加粗」",
      "source_meeting": "客户访谈",
      "source_meeting_id": "uuid",
      "created_at": "2026-05-27T11:00:00Z"
    }
  ]
}
```

### 3.6 `GET /api/v2/today/decisions`

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Q3 路线图: 协作功能延后到 Q4 第一双周",
      "decided_at": "2026-05-27T11:35:00Z",
      "meeting_id": "uuid"
    },
    {
      "id": "uuid",
      "title": "搜索改版上线前补 1 周合规审查",
      "decided_at": "2026-05-27T10:45:00Z",
      "meeting_id": "uuid"
    }
  ],
  "total_count": 2
}
```

### 3.7 `GET /api/v2/today/experts` (专家视角列表)

```json
{
  "experts": [
    {
      "id": "ai1",
      "name": "Mira",
      "glyph": "◎",
      "gradient_from": "#FFB340",
      "gradient_to": "#FF9F0A",
      "role_short": "首席协调 AI",
      "last_active_at": "2026-05-27T11:30:00Z",
      "last_active_display": "刚刚",
      "recent_meetings": [
        {"id":"m1","title":"Q3 路线图对齐","joined_at":"2026-05-27T09:30:00Z"},
        {"id":"m2","title":"搜索体验评审","joined_at":"2026-05-26T14:00:00Z"}
      ],
      "task_count": 3
    }
    // ... 共 10 个 AI, 按 last_active_at desc 排序
  ]
}
```

---

## 4. Saga O — Tasks + Memory

### 4.1 `GET /api/v2/tasks/priority-banner` (M4 Mira 优先级 banner)

```json
{
  "urgent_task_count": 1,
  "summary_text": "1 项今日必做 · 11:30 前拍板「协作功能能否进入 Q3」",
  "ai_suggestion_count": 2,
  "ai_suggestion_text": "AI 找到 2 项任务可触发"
}
```

### 4.2 `GET /api/v2/tasks/grouped` (M4 按来源会议分组)

**Query**: `?status=pending|tracking|done`

```json
{
  "groups": [
    {
      "meeting_id": "uuid",
      "meeting_title": "Q3 路线图对齐",
      "tasks": [
        {
          "id": "uuid",
          "title": "拍板「协作功能能否进入 Q3」",
          "urgency": "today",
          "ai_source": {"id":"ai2","name":"Stratos","glyph":"◆","color":"#AF52DE"},
          "due_at": "2026-05-27T11:30:00Z",
          "due_display": "今天 11:30",
          "status": "pending"
        }
      ]
    },
    {
      "meeting_id": "uuid",
      "meeting_title": "搜索体验评审 #4",
      "tasks": [
        {
          "id": "uuid",
          "title": "审核 Sage 搜索结果页 chip 顺序变更",
          "urgency": "today",
          "ai_source": {"id":"ai6","name":"Sage","glyph":"✦","color":"#5E5CE6"},
          "due_at": "2026-05-27T14:00:00Z",
          "due_display": "今天 14:00",
          "status": "pending"
        }
      ]
    },
    {
      "meeting_id": "uuid",
      "meeting_title": "客户访谈",
      "tasks": [
        {
          "id": "uuid",
          "title": "回复 Hummingbird 关于摘要质量的疑问",
          "urgency": "week",
          "ai_source": {"id":"ai9","name":"Hummingbird","glyph":"♪","color":"#FF6482"},
          "due_at": "2026-05-29T18:00:00Z",
          "due_display": "本周",
          "status": "pending"
        }
      ]
    }
  ]
}
```

### 4.3 `GET /api/v2/memory/radar` (M5 雷达图 hero)

**PM 2=a 拍板**: 6 轴写死, 后端按 memory keyword 匹配分类.

```json
{
  "total_memories": 100,
  "total_axes_covered": 6,
  "axes": [
    "数据洞察",
    "产品策略",
    "UX 体验",
    "法规合规",
    "财务建模",
    "客户体验"
  ],
  "my_values": [32, 24, 18, 8, 12, 6],
  "team_values": [28, 30, 22, 14, 16, 10],
  "axis_metrics": [
    {"axis_name": "数据洞察", "my_count": 32, "team_diff": 4, "label": "数据洞察 32"},
    {"axis_name": "财务建模", "my_count": 12, "team_diff": 4, "label": "财务建模 团队+4"}
  ]
}
```

### 4.4 `GET /api/v2/memory/snapshots` (M5 快照 list 升级)

**Query**: `?limit=20&cursor=...`

```json
{
  "items": [
    {
      "id": "uuid",
      "topic": "数据安全合规风险评估会",
      "ai_avatars": [
        {"glyph":"✦","gradient_from":"#5E5CE6","gradient_to":"#AF52DE"},
        {"glyph":"§","gradient_from":"#FF9F0A","gradient_to":"#FFB340"}
      ],
      "types": ["洞察", "建议"],
      "count": 2,
      "source_meeting_id": "uuid",
      "focus_anchor": "agent-12345"
    }
    // ... 25 条 (跟现有 25 条快照对齐)
  ],
  "total_count": 25
}
```

**v1.4.0 Sprint 3 Mobile Part 2 加 `focus_anchor`** (NORTH_STAR § 3.1 v1.1): 出处链回锚点.
推自 group 内最新 insight 的 `source_message_id`, 拼成 `agent-<id>` 字符串.
跟 MeetingTranscriptView `data-mr-key` 严格 一致 — 跳转 URL:
`/m/meetings/<source_meeting_id>?focus=<focus_anchor>&highlight=1` 后, transcript view
滚到锚点 + 黄/紫 高亮闪 3 秒. 老 insight (`source_message_id` NULL) 此字段 `null`,
退到 跳 meeting 不锚定.

### 4.5 `GET /api/v2/memory/drafts` (Sprint 3 Mobile Part 3 · 待审 tab)

**Query**: `?status=pending&limit=50` (status: pending | approved | rejected | expired)

```json
{
  "items": [
    {
      "id": "uuid",
      "proposed_content": "电梯改造的预算上限是 3 亿, 不能突破",
      "source_meeting_id": "uuid",
      "source_meeting_title": "电梯改造方案决策会",
      "target_ais": [
        {"id":"uuid","name":"Lex","glyph":"§","gradient_from":"#FF9F0A","gradient_to":"#FFB340"}
      ],
      "importance": 0.85,
      "data_classification": "internal",
      "created_at": "2026-05-26T10:00:00Z"
    }
  ],
  "pending_count": 3
}
```

**ABAC**: workspace_id filter + (primary_user_id = caller OR is_workspace_manager).
跟老 `/api/memory-drafts` (v26.5-Lineage) 一致.

### 4.6 `GET /api/v2/memory/library` (Sprint 3 Mobile Part 3 · 记忆库 tab)

**Query**: `?axis_tag=数据洞察&limit=50` (axis_tag 可选, 6 个固定 + NULL)

```json
{
  "items": [
    {
      "id": "uuid",
      "content": "客户反馈搜索改版后 P0 投诉 -42%, 体验改善显著",
      "axis_tag": "数据洞察",
      "importance": 0.9,
      "data_classification": "internal",
      "source_meeting_id": "uuid",
      "source_meeting_title": "搜索改版上线复盘会",
      "primary_ai": {
        "id":"uuid","name":"Sage","glyph":"✦",
        "gradient_from":"#5E5CE6","gradient_to":"#AF52DE"
      },
      "created_at": "2026-05-20T14:30:00Z"
    }
  ],
  "total_count": 12,
  "axes_with_count": {
    "数据洞察": 3,
    "产品策略": 5,
    "UX 体验": 2,
    "法规合规": 1,
    "财务建模": 1
  }
}
```

**ABAC**: workspace_id filter (workspace 全员共享, NORTH_STAR § 3.1).

### 4.7 `POST /api/v2/memory/drafts/{id}/approve | /reject` (Sprint 3 Mobile Part 3)

NORTH_STAR § 4.2.1: mobile 允许 approve/reject (审核 ≠ 编辑).

**Approve body**: 无.  **Reject body**: `{"reason": "..."}` (optional).

**Response**:
```json
{
  "id": "uuid",
  "status": "approved",
  "committed_memory_id": "uuid"
}
```

Delegate 到 老 `/api/memory-drafts/{id}/approve|reject` 内部逻辑 (memory_drafts.py:267/336).
v2 wrapper 只 压扁 response shape, 让 mobile 不依赖 老 endpoint url.

---

## 6. Sprint 3 Mobile Part 1 — KB 引用侧栏 (NORTH_STAR § 3.2)

### 6.1 `GET /api/v2/meetings/{meeting_id}/agent-messages/{message_id}/citations`

会议室 AI 发言下方 "引用 N 条 KB" → 弹 KBCitationSheet → 拉此 endpoint.

```json
{
  "message_id": 12345,
  "citations": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "document_filename": "深圳市物业管理条例 2025.pdf",
      "chunk_index": 7,
      "snippet": "第三十二条 物业服务企业应当按照…",
      "distance": 0.32
    }
  ],
  "citations_count": 1
}
```

**ABAC** (双层防穿透):
1. `meeting.workspace_id == auth.workspace.id` — 跨 workspace 抛 404
2. `message.meeting_id == meeting_id` — 跨 meeting 抛 404 (不 leak 存在性)

**字段** (跟老 `AgentCitationOut` meetings.py:3385 复用):
- `chunk_id` — uuid
- `document_id` — uuid (前端 link → `/workspace/kb/documents/<id>`, target="_blank")
- `document_filename` — 显示名 (truncate ellipsis)
- `chunk_index` — int (0-based, 前端显 `段落 #N+1`)
- `snippet` — chunk 原文 (≤500B, frontend `-webkit-line-clamp: 3`)
- `distance` — pgvector cosine 距离 [0, 2), 越小越像. 前端 chip 文案:
  `< 0.35 高度相关` / `< 0.6 相关` / `else 参考` (不显原始数字, 避免技术化).

---

## 5. Saga P — Profile + 新建会议

### 5.1 `GET /api/v2/profile/ai-stats` (M6 AI 智囊统计 hero)

**PM 4=a 拍板**: 7 天窗口

```json
{
  "period_days": 7,
  "total_suggestions": 24,
  "adopted": 18,
  "adoption_rate": 0.75,
  "most_popular_ai": {
    "id": "ai2",
    "name": "Aria",
    "glyph": "⌬",
    "gradient_from": "#0A84FF",
    "gradient_to": "#5E5CE6",
    "adoption_pct": 0.46
  }
}
```

### 5.2 `GET /api/v2/profile/voiceprints-stats` (M6 声纹库 counter)

```json
{
  "count": 6,
  "last_updated_at": "2026-05-22T15:30:00Z",
  "last_updated_display": "上次更新 5 天前"
}
```

### 5.3 `POST /api/v2/mira/draft-meeting` (M7 Mira 描述需求 → 自动配 AI)

**PM 3=a 拍板**: V1 全 mock, 假装思考 1.1s 返回基于关键词的预设结果

**Request**:
```json
{
  "input_text": "下周搜索改版要上线, 我想心里摸底...",
  "input_mode": "text" | "voice"
}
```

**Response** (1.1s 后):
```json
{
  "confidence": 0.85,
  "proposed_title": "搜索改版上线前评审",
  "proposed_topic": "评估搜索改版上线的合规风险 + 体验回归",
  "proposed_agenda": [
    {"label": "合规审查同步", "duration_min": 10, "led_by_ai": "Lex"},
    {"label": "搜索体验回归", "duration_min": 15, "led_by_ai": "Sage"},
    {"label": "决策上线日期", "duration_min": 5, "led_by_ai": "Mira"}
  ],
  "total_duration_min": 30,
  "proposed_ais": [
    {"id":"ai4","name":"Lex","glyph":"§","gradient_from":"#FF9F0A","gradient_to":"#FFB340","reason":"合规审查"},
    {"id":"ai6","name":"Sage","glyph":"✦","gradient_from":"#5E5CE6","gradient_to":"#AF52DE","reason":"搜索体验"},
    {"id":"ai1","name":"Mira","glyph":"◎","gradient_from":"#FFB340","gradient_to":"#FF9F0A","reason":"主持收敛"}
  ],
  "proposed_humans": [
    {"id":"u1","name":"李局长","surname_char":"李","avatar_color":"#FF9F0A"},
    {"id":"u2","name":"陈科长","surname_char":"陈","avatar_color":"#FF375F"}
  ],
  "sample_prompts": [
    "评估搜索改版上线的合规风险",
    "Q3 路线图回顾",
    "客户 Hummingbird 最近一周的反馈"
  ]
}
```

**Sample prompts** (UI 触发的 3 个 chips, 写死跟设计稿一致):
- `"评估搜索改版上线的合规风险"`
- `"Q3 路线图回顾"`
- `"客户 Hummingbird 最近一周的反馈"`

**Agenda 滚轮 picker** (前端写死):
- 时长选项: `[5, 10, 15, 20, 30, 45, 60, 90, 120]` (分钟)

---

## 6. 锁定声明

- 本 schema 是 Phase 1 (Saga M / N / O / P) 的契约
- **任何字段 / enum / 命名修改必须 PM 拍板并更新本文档版本号**
- Phase 2 backend 真接数据时, **只换数据源 (查 DB / 调 LLM), 不动 schema 不动 UI**
- 若 Phase 2 发现 schema 漏字段, 需 PM 拍板加字段后, UI 跟 mock 同步加 — 这是唯一允许的 schema 变动路径

---

## 7. Saga M / N / O / P 范围对照

| Saga | 周 | 用到的 endpoint | 估时 |
|---|---|---|---|
| **M** | W1 | §2.1 week-pulse + §2.2 meetings (升级) | 3.5d (含 M1 atoms + M8 polish) |
| **N** | W2 | §3.1 brief + §3.2 live-meeting + §3.3 snapshot + §3.4 pending-tasks + §3.5 insights + §3.6 decisions + §3.7 experts | 2.5d |
| **O** | W3 | §4.1 priority-banner + §4.2 tasks/grouped + §4.3 memory/radar + §4.4 memory/snapshots | 3d (含 MemoryRadar SVG) |
| **P** | W4 | §5.1 ai-stats + §5.2 voiceprints-stats + §5.3 mira/draft-meeting | 3.5d (含 modal sheet + 滚轮 picker) |

---

> **本文档是 Mobile App v2 truth source.** 任何 Saga changelist / mock data 不一致以本文档为准.
