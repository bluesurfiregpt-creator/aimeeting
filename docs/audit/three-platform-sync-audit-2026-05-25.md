# 三端冲突清单 · 2026-05-25

> 目的: PM Q7.4 + N2 — 列出 桌面 Web / H5 移动 / 微信小程序原生 三端在 数据 / 功能 / 路径 / 状态同步 / 权限 / UI / 登录 7 个维度的已知冲突, 给后续 Saga 拆分提供依据.
> 端定位准绳: `docs/NORTH_STAR.md` § 4
> 范围: 只读 review, 不动代码, 不动 NORTH_STAR (跟 权限对齐 Saga subagent 并行).
> 输入: `backend/app/models.py`, `backend/app/routers/*`, `backend/app/auth.py`, `backend/app/session_state.py`, `backend/app/notify.py`, `frontend/src/app/m/*`, `frontend/src/app/admin/*`, `frontend/src/app/me/profile/*`, `frontend/src/lib/mobile/*`, `wechat-miniprogram/pages/*`, `wechat-miniprogram/utils/*`, `docs/NORTH_STAR.md`, `docs/PRODUCT_OVERVIEW.md`, `docs/audit/role-permission-audit-2026-05-25.md`.

---

## 0. TL;DR (PM 5 行)

- **共有功能 ~14 项, Web 独占 ~12 项 (编辑全家桶), 小程序"实际"独占 0 项** — 小程序号称无编辑能力, **实际已编辑 9 个 endpoint** (voiceprint CRUD / actions PATCH / memory_drafts approve / decompose-agenda / 记忆决策 等), 跟 NORTH_STAR § 4.2 / § 7.3 直接冲突.
- **UI 一致性最严重**: H5 (`/m/*`) 是 iOS 浅色 `#F2F2F7` (round-3 浅色化 done), 小程序原生 **17 张 wxss 全部是 dark** `#0a0a0c` — **零浅色页面**. 跟 PM round-4 方向反.
- **数据模型一致 (后端 single source of truth), API 路径有冗余**: `/api/m/meetings` (mobile.py 聚合) + `/api/meetings` (老桌面) 共存; 小程序混用两套, 偶尔重复 (例: `decompose-agenda` 走老路径).
- **WS 实时事件**: 桌面 + H5 + 小程序原生 都连 `/ws/stt`, 事件 schema 一致, 但 mobile.py 没有 attachments-ready / kb_sedimentation 等会议外事件 push (P5 缺一致性).
- **登录跨端**: H5 走 cookie session, 小程序原生走 Bearer JWT 30d, 桥 endpoint `/api/auth/exchange-token` 让 cookie ↔ token 互换. 小程序进 webview 时 cookie 用不上 (P3 桥接缺).
- **关键冲突前 5 (P0)**: 见 § 3.

**建议 PM 先聊**: 冲突 D2-#1 (小程序"无编辑"原则 vs 实际 9 写入端点) + D6-#1 (小程序全 dark vs H5 已浅色化) + D3-#1 (`/api/m/*` vs `/api/*` 重叠/混用) + D4-#3 (跨端通知 push 缺失) + D5-#1 (`is_writer = owner||admin||leader` 小程序客户端硬编码,跟新 5 层角色不齐).

---

## 1. 三端功能矩阵

> ✅ = 完整可用, ⚠ = 部分 (mock / 限制), ❌ = 完全没有, 🚫 = 设计如此不做.
> 备注: "桌面 Web" 含 `/admin/*` `/me/profile/*` `/dashboard` `/super` `/meeting/[id]` `/task/[id]`; "H5" 指 `/m/*` (vibe coding staging, 由 webview 渲染); "小程序" 指 `wechat-miniprogram/pages/*` 原生.

| 功能 (列) | 桌面 Web | H5 (`/m/*`) | 小程序原生 | NORTH_STAR § 4 期望 |
|---|---|---|---|---|
| **查看会议列表** | ✅ `/meetings` | ✅ `/m/meetings` | ✅ `pages/meetings_list` | 全端 ✅ |
| **看单场会议** | ✅ `/meeting/[id]` 3 栏 | ✅ `/m/meetings/[id]` 移动收敛 | ✅ `pages/meeting/meeting` 原生 | 全端 ✅ |
| **会议总结** | ✅ `/meeting/[id]` summary 区 | ✅ `/m/meetings/[id]/summary` | ✅ `pages/meeting_summary` | 全端 ✅ |
| **创建会议 (含拆议程 + 上附件)** | ✅ `/meetings` 新建 | ✅ `/m/meetings/new` | ✅ `pages/create/create` 含 wx.chooseMessageFile | 全端 ✅ (小程序 NORTH_STAR § 4.2 明示) |
| **WS 实时 STT + 议程 banner** | ✅ `sttSocket.ts` | ✅ `meetingWsBus.tsx` | ✅ `utils/ws.js` | 全端 ✅ |
| **查看任务列表 / 详情** | ✅ `/task/[id]` | ✅ `/m/tasks/[id]` | ✅ `pages/task_detail` | 全端 ✅ |
| **查看智囊 / insights / 记忆** | ✅ `/me/profile/memory` | ✅ `/m/insights` | ✅ `pages/insights` | 全端 ✅ |
| **看 AI 专家详情 (历史会议 + 任务 + insights)** | ✅ `/me/profile/agents/[id]` | ✅ `/m/agents/[id]` | ✅ `pages/agent_detail` | 全端 ✅ |
| **看通知中心** | ✅ `/me/profile` 区域 | ✅ `/m/notifications` | ✅ `pages/notifications` | 全端 ✅ |
| **看个人档案** | ✅ `/me/profile` | ✅ `/m/me` | ✅ `pages/me` | 全端 ✅ |
| **看声纹列表** | ✅ `/me/profile/voiceprints` | ⚠ `/m/me/voiceprint` (录入跳桌面) | ✅ `pages/voiceprint` | 看 ✅ |
| **审批 memory_draft / 记忆纪要决策** | ✅ `/me/profile/memory` / `/admin/memory` | ✅ `/m/insights` 决策按钮 | ✅ `pages/insights` 决策按钮 + `pages/tasks_list` approve/reject | **⚠ 冲突**: 小程序也能审批 (= 编辑) |
| **修改 task status (开始/完成/驳回/取消)** | ✅ | ⚠ `/m/tasks/[id]` 部分 | ✅ `pages/meeting_summary`, `pages/tasks_list` PATCH `/api/meetings/{id}/actions/{aid}` | **⚠ 冲突**: 修改 task 是编辑 |
| **任务评论 (写 + 删)** | ✅ | ⚠ | ✅ `pages/task_detail` POST + DEL `/comments` | **⚠ 冲突** |
| **录新声纹 (POST users + voiceprints)** | ✅ `/enroll` | ❌ | **✅** `pages/voiceprint` POST `/api/users` + `/api/voiceprints` | **🔥 冲突**: NORTH_STAR § 4.2 + § 7.3 明禁小程序编辑 |
| **删声纹** | ✅ | ❌ | **✅** `pages/voiceprint` DELETE `/api/voiceprints/by-user/{uid}` | **🔥 冲突** |
| **AI 拆议程 (decompose-agenda)** | ✅ POST `/api/meetings/decompose-agenda` | ✅ | ✅ `pages/create` 调老 endpoint (`/api/meetings/decompose-agenda` 而非 `/api/m/*`) | 全端 ✅ 但 路径 重复 (见 D3) |
| **修改议程项 (jump / advance)** | ✅ `/meeting/[id]` orchestrate | ✅ `/m/meetings/[id]` | ⚠ `pages/meeting` 仅 read | 桌面 + H5 ✅, 小程序按 § 4.2 不动 (现状 OK) |
| **/super 跨 workspace 管理** | ✅ `/super` (platform admin) | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **编辑 AI 专家 (persona / KB / boundary)** | ✅ `/me/profile/agents` + `/admin/agents` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **管 AI 知识库 (KB 增删改)** | ✅ `/me/profile/knowledge` + `/admin/knowledge` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **管 AI 记忆 (memory CRUD)** | ✅ `/me/profile/memory` + `/admin/memory` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **workspace 增删改 (owner)** | ✅ `/me/profile/workspace` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **团队管理 (邀请 / 改派 role)** | ✅ `/admin/team` + `/me/profile/team` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **模型 provider / ASR vocab / cron rules / 文档审核** | ✅ `/admin/*` + `/me/profile/*` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **数据访问申请 (5 级 ABAC)** | ✅ `/admin/access-requests` + `/me/profile/access-requests` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **桑基血缘图 (lineage)** | ✅ `/me/profile/lineage` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **审批 task 沉淀草稿 (kb_sedimentation)** | ✅ `/me/profile/sedimentation` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **dashboard (kanban / ask / 看板)** | ✅ `/dashboard/*` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **聊天 (chat 长会话)** | ✅ `/chat/[id]` | ❌ | ❌ | 🚫 Web 独占 ✅ |
| **召唤 AI 进会议 (summon)** | ✅ `/meeting/[id]` | ✅ `/m/meetings/[id]` summon sheet | ✅ `pages/meeting` summon sheet | 全端 ✅ (会议室内召唤 = "发起会议"延伸) |
| **微信聊天文件 picker** | ❌ | ⚠ webview 内 wx.chooseMessageFile via bridge | ✅ `pages/create` 原生 wx.chooseMessageFile | 小程序独有 ✅ (NORTH_STAR § 4.2 列) |
| **微信 OAuth 一键登录** | ❌ | ❌ | ✅ `pages/login` | 小程序独有 ✅ |
| **微信手机号一键登录** | ❌ | ❌ | ✅ `pages/login/onGetPhoneNumber` | 小程序独有 ✅ |
| **隐私协议页** | ❌ (无独立页) | ✅ `/m/privacy` | ⚠ `pages/webview` 跑 `/m/privacy` (没原生页) | H5 ✅, 小程序借 webview (技术债 见 D6-#5) |

**统计**:
- **共有 (三端都有的)**: ~14 项 (会议查看/创建/任务/通知/智囊/详情等)
- **桌面 Web 独占**: ~12 项 (NORTH_STAR § 4.1 + 4.2 明示)
- **小程序"理论"独占**: 3 项 (微信 OAuth / 手机号一键 / 聊天文件 picker)
- **小程序"实际"违规独占编辑**: 至少 5 项 (voiceprint CRUD / actions PATCH / memory_drafts approve+reject / task comments / 创建 users)

---

## 2. 冲突清单 (按 7 个维度)

### D1 · 数据模型一致性

**结论**: 后端 single source of truth — 30+ 表的 schema 三端共用. 没有 schema-level 不一致 (Web 改, 小程序看, 都跑同一份 `models.py`). 但 **wrapper/derived type** 三端各写一份, 有 drift 风险.

#### D1-#1 · `AIInsightFull` 三端定义不同步 [中]

- 后端: `backend/app/routers/mobile.py:57-69` `AIInsightFull` (Pydantic, 11 字段含 `worth_remembering` / `human_decision`)
- H5: `frontend/src/lib/mobile/types.ts:21-33` `AIInsightFull` (TS, 同 11 字段, 注释明示"跟 mobile.py 一一对应")
- 小程序: 无类型定义 (JS), `pages/home/home.js:217-237` 直接读 `ins.meeting_id / ins.topic_idx / ins.content` 等字段, 无类型校验 — 后端 加新字段 三端 不一致 时 小程序 静默丢字段.
- **冲突点**: 没人保证 mobile.py / types.ts / 小程序 home.js 同步. v27.0-mobile P21 加 `worth_remembering` 时, 三端是同 commit 改的 (`b74a09d`), 但下次再加字段没流程保证.
- **影响**: 中 — 现状还行, 但 Saga E 增加 round-table / chapter / KB-citation 字段会爆.

#### D1-#2 · `Agent` 渲染字段三端各自补 [低]

- 后端: `Agent` 表 + `agent_router.py` `AgentOut` (含 `role`, `domain`, `color`, `nickname`, `primary_user_id`, `invoke_count` 等 ~18 字段)
- H5: `frontend/src/lib/api.ts:432` `Agent` (TS, 跟 AgentOut 对齐)
- H5 mobile: `frontend/src/lib/mobile/types.ts:123-133` `AgentWorkCard` (移动专用 — 是 `Agent` 的"简化版 + 派生字段 last_active / tasks summary"), `types.ts:163-176` `AgentDetailOut` (另一套)
- 小程序: 在 `pages/home/home.js:427` `_enrichAgent()` 客户端拼 `_displayName / _showNicknameTag / _summaryLine` 等 ~10 个 UI 字段; `pages/agent_detail/agent_detail.js:96-148` 又拼一套
- **冲突点**: 同一个 `nickname || name` 显示逻辑 三端 各写 一遍 (`frontend AIInsightCard.tsx` / 小程序 `home.js:430` / `agent_detail.js:93`). 改 nickname fallback 规则 时 三处都得改.
- **影响**: 低 — 是技术债, 没引发 用户可见 bug.

#### D1-#3 · `Meeting` mode/status 枚举三端散落 [低]

- 后端: `Meeting.status` String(16) `scheduled|ongoing|finished|processed`, `Meeting.mode` String(16) `human|hybrid|auto` (`backend/app/models.py:325, 364`)
- H5: `frontend/src/lib/mobile/types.ts:86` `MobileMeetingStatus` 含同 4 个值
- 小程序: `pages/agent_detail/agent_detail.js:16-21` `MEETING_STATUS` map (label / tone 各值 hardcode)
- **冲突点**: 没有 enum 约束 (后端用 String), 任一端可以新加 status 写库, 其他端不识别.
- **影响**: 低 — 当前 4 个值 稳定, 演进 时再 review.

---

### D2 · 功能差异

#### D2-#1 · 🔥 小程序"无编辑"原则被实际代码违反 [P0]

**NORTH_STAR § 4.2**: "小程序原生 功能 = 查看 + 发起会议 + 切换 workspace, **无编辑功能**, 编辑全部走 Web."
**NORTH_STAR § 7.3**: "不在小程序做编辑功能 — 任何'在小程序里加个编辑入口'的需求, 默认拒绝."

**实际**:
| 文件 | 行 | 写入操作 | 类型 |
|---|---|---|---|
| `wechat-miniprogram/pages/voiceprint/voiceprint.js` | 166 | `api.post('/api/users', {name})` | 创建 user (= 编辑 workspace 成员) |
| 同上 | 380 | `api.del('/api/voiceprints/by-user/{uid}')` | 删声纹 |
| 同上 (推论) | — | 录音 POST `/api/voiceprints` (代码 5-7 行注释明示) | 录新声纹 |
| `pages/meeting_summary/meeting_summary.js` | 205 | `api.patch('/api/meetings/{mid}/actions/{aid}', {status})` | 改 task 状态 (open → done / cancelled) |
| `pages/tasks_list/tasks_list.js` | 275 | `api.patch(...)` | 同上 PATCH actions |
| `pages/tasks_list/tasks_list.js` | 280 | `api.post('/api/memory-drafts/{id}/approve')` | 批准 记忆纪要 (= 沉淀进 long_term_memory) |
| `pages/tasks_list/tasks_list.js` | 304 | `api.post('/api/memory-drafts/{id}/reject')` | 拒绝 记忆纪要 |
| `pages/insights/insights.js` | 323/352 | `api.patch('/api/m/insights/{id}/decision')` | 标记 insight accepted/rejected (= 编辑 worth_remembering 决策) |
| `pages/task_detail/task_detail.js` | 188 | `api.post('.../actions/{aid}/comments')` | 发任务评论 |
| `pages/task_detail/task_detail.js` | 218 | `api.del('.../comments/{cid}')` | 删评论 |
| `pages/create/create.js` | 321/558/649 | `api.post('/api/meetings/decompose-agenda')`, `api.del('.../attachments/{id}')`, `api.post('/api/meetings')` | 拆议程 / 删附件 / 建会议 (建会议 是 NORTH_STAR 允许的) |

**矛盾解析**:
- 建会议 / decompose-agenda / 删自己刚上传的附件: NORTH_STAR § 4.2 "发起会议" 应该 涵盖 这些 ✅
- 召唤 AI 进会议 (`pages/meeting:701` POST `/api/meetings/{id}/agents`): 也算"发起会议"延伸 ✅
- 任务状态修改 + 评论 + 记忆草稿审批 + insight 决策 + 创 user + 录/删 声纹: **不属于 "发起会议" 范畴**, 是 编辑 ❌
- **NORTH_STAR § 4.2 没说清** "task / draft / insight 决策 算不算编辑". 实际开发把它们归到"工作流推进"而非"配置编辑", 默认放过.

**建议方向 (PM 决策)**:
- **选项 A (严守)**: 把 9 个写入端点从小程序 拆掉, 跳 webview 让用户去 H5/桌面 改. 短期体验差, 长期纯洁.
- **选项 B (放宽 NORTH_STAR)**: 重写 § 4.2 — 小程序允许"工作流推进" (task action + memory 审批 + insight 决策 + 任务评论), 仍禁"配置编辑" (AI/KB/memory/role/workspace 增删改).
- **选项 C (现状默认)**: 啥也不动, 给 § 4.2 加一段"实操延伸" 说明.

**主任 Agent 视角**: 选 B 最务实 — 小程序是终态生产形态 (NORTH_STAR § 4.2), 用户用它处理日常任务流是合理的; "编辑" 应专指 *配置层* (AI persona / KB / memory CRUD / role / workspace).

#### D2-#2 · 桌面 admin 重 vs 移动 user 轻 — 信息架构断裂 [P0]

**现状**:
- 桌面 `/me/profile` 入口 给 leader+ 看, 子页 19 个 (`agents`, `knowledge`, `memory`, `workspace`, `team`, `models`, `cron`, `audit`, `document-audit`, `access-requests`, `sedimentation`, `lineage`, `voiceprints`, `asr`, `demo-data`, `template` 等)
- `/admin` (老入口) 也存在, 12 个子页 (跟 `/me/profile` 部分重复 — `team` / `memory` / `agents` / `knowledge` / `models` / `audit` 等都有两份)
- H5 `/m/me` 只有: 档案 + 工作区 + 关于 + 退出登录 — 没有 agents/KB/memory 管理入口 (跟 NORTH_STAR § 4.1 "桌面 + 移动响应" 矛盾 — 桌面响应模式应能看见所有 leader+ 工具)
- 小程序 `pages/me/me` 跟 H5 一样, 仅 4 行 (档案 + 工作区 + 关于 + 退出)

**冲突点**:
1. **同一份 leader+ 编辑入口 桌面有 2 套** (`/admin` + `/me/profile`), PM 没拍板谁是 truth
2. **leader 在小程序登录后 看不到自己的管理工具**, 必须切到 H5/桌面 — 已在 `docs/PRODUCT_OVERVIEW.md` § 4.3 #5 记为 "🔥 中". NORTH_STAR § 4.4 也明说 "桌面 admin / mobile 信息架构差异 leader 跨端切换断裂".

**影响**: P0 — leader 实际反馈的痛点.

**建议方向**: 桌面端 `/admin` + `/me/profile` 合并到 一个 (PM Q5 候选); 小程序 `/me` 加 "切到 web 端管理" 的引导链接 (打开微信浏览器或 cookie 桥)

#### D2-#3 · 桌面 chat / dashboard 桌面独占 (设计如此) [OK]

- 桌面: `/chat/[id]` (长 AI 对话) + `/dashboard/*` (kanban / ask / 工作站)
- 移动: 没做
- **NORTH_STAR § 4.1** 列了 "桌面主战场 (v17-v25)" — 这两个是 桌面独占, 设计如此 ✅, 不是冲突.

#### D2-#4 · `/m/insights` 改 worth_remembering, 桌面没有相同入口 [中]

- 小程序 + H5: `/api/m/insights/{id}/decision` 接受 `decision: accepted/rejected` (`mobile.py:1290`), 把 insight 决策成是否沉淀进 long_term_memory
- 桌面: 没找到对应入口 — `/admin/memory` 看的是已沉淀的 long_term_memory + memory_draft; insight 决策这一步 在 桌面 UI 找不到
- **冲突点**: 移动比桌面多一个"洞察决策"入口. 跟 NORTH_STAR § 4.1 "桌面全功能 + 独占编辑" 矛盾 — 应该桌面有更多入口, 不是相反.
- **影响**: 中 — 但 不阻塞使用 (leader 可以等到桌面再决策, 或直接在移动改).

#### D2-#5 · 桌面 `/super` 跨 workspace platform_admin 独占 [OK]

- 桌面 `/super` (`backend/app/routers/super.py`) 仅 `bluesurfiregpt@gmail.com` 等 env 白名单的 system_owner 能进
- 移动 / 小程序: 没做
- **NORTH_STAR § 5.3 + § 4.1** 设计如此 ✅, 不是冲突.

---

### D3 · API 路径

#### D3-#1 · `/api/m/*` (mobile.py 聚合) vs `/api/*` (老桌面) 重叠 [P1]

**设计**:
- `mobile.py` 出现 (v27.0-mobile P0+) 是为了"一次拉全聚合数据, 减少移动端 round-trip" (`mobile.py:6-10` 注释明示).
- 老 `meetings.py` / `agents.py` / `me.py` 是桌面用的, 多个独立 endpoint.

**问题**: 小程序 + H5 偶尔混调 — 不一致.

| 操作 | 路径 (小程序实际调用) | 注释 |
|---|---|---|
| 列会议 | `/api/m/meetings` (`pages/meetings_list`) | ✅ 走聚合 |
| 拉单会议详情 (会议室) | `/api/m/meetings/{id}` (`pages/meeting`) | ✅ 走聚合 |
| 拆议程 | `/api/meetings/decompose-agenda` (`pages/create:321`) | ⚠ 走老路径 (mobile.py 没做这个聚合) |
| 建会议 | `/api/meetings` (`pages/create:649`) | ⚠ 老路径 |
| 改 task 状态 | `/api/meetings/{mid}/actions/{aid}` (`pages/meeting_summary:205`) | ⚠ 老路径 |
| 召唤 AI | `/api/meetings/{id}/agents` POST + `/api/m/meetings/{id}/summon` 两份 都用 (`pages/meeting:701, 706`) | **冲突**: 同一操作两个端点都调? |
| 拉 task detail | `/api/m/tasks/{aid}` | ✅ |
| 拉 memory list | `/api/memory` (`pages/insights`) | ⚠ 老路径 |
| 决策 memory_draft | `/api/memory-drafts/{id}/approve` POST (`pages/tasks_list:280`) | ⚠ 老路径 |
| insight 决策 | `/api/m/insights/{id}/decision` PATCH | ✅ |
| 拉通知 | `/api/me/notifications` (`pages/notifications`) | ⚠ 老路径 |

**冲突解析**:
- `mobile.py` 不是完整重写桌面 API, 是 选 性 聚合; 老路径 + 新聚合 共存. 小程序 跟 H5 都得 知道 该 用 哪个.
- **没文档** 说"什么必须 `/api/m/*` 走, 什么走 `/api/*`". 实际是 "随手都行".

**建议方向**: 写一份 `docs/api/mobile-vs-desktop.md`, 列哪些 是 mobile 聚合 (减 round-trip), 哪些 桌面 + 移动 共用 老路径. 不需要 重构.

#### D3-#2 · `/api/meetings/{id}/agents` 双调 (重复邀请?) [低]

- `pages/meeting/meeting.js:701` POST `/api/meetings/{id}/agents` + `:706` POST `/api/m/meetings/{id}/summon` — 看起来是同一个 召唤 操作, 但 两个 endpoint 都 fire?
- 后端: `meetings.py:784` `POST /{meeting_id}/agents` 是 "邀请 AI 进会议" (创建 MeetingAttendee); `mobile.py:763` `POST /meetings/{meeting_id}/summon` 是 "触发 AI 即时发言" (调 LLM)
- **冲突**: 名字像, 行为不同, 小程序代码理解 模糊. 可能 没真冲突, 但难读 → 容易 误改.
- **影响**: 低 — 但 review 时 容易出错.

#### D3-#3 · 文件上传 POST `/api/meetings/attachments` 三端都共用 [OK]

- 桌面: `frontend/src/app/m/meetings/new/page.tsx` 走 multipart
- 小程序: `pages/create/create.js:444` `wx.uploadFile` (同 endpoint, 自动加 Bearer header)
- ✅ 设计良好 — 同一 endpoint 三端共用, 后端 `meeting_attachments.py` 统一处理.

---

### D4 · 状态同步 (实时)

#### D4-#1 · WS `/ws/stt` 三端实现一致 [OK]

- 后端: `session_state.broadcast(meeting_id, payload)` 推给所有连接到该 meeting 的 socket (`session_state.py:78`)
- 桌面: `frontend/src/lib/sttSocket.ts` (复用)
- H5: `frontend/src/lib/mobile/meetingWsBus.tsx` (provider + subscribe pattern)
- 小程序: `wechat-miniprogram/utils/ws.js` (wx.connectSocket + Bearer header in `header.Authorization`)
- 事件 schema 一致: `system / ready / transcript_persisted / agent_message_start / agent_message_chunk / agent_message_end / agents_invited / dissent_detected / agenda_off_topic / agenda_stuck / agenda_time_warning / agenda_decision_summary / agenda_advance_suggested / speakers_updated`
- 三端 dispatch 函数都按相同事件名分发. ✅

#### D4-#2 · 议程 advance / jump 事件 三端可收 [OK]

- 后端 `meetings.py:2250` + `2352` `await session_state.broadcast(m.id, {type:"agenda_advanced", ...})`
- 三端都有 `onAgendaEvent` handler. ✅

#### D4-#3 · 会议外通知 没 WS push, 仅 polling [P1]

- 任务 dispatched / overdue / due_soon / memory_draft pending / kb_sedimentation pending 等 走 `Notification` 表 (`models.py:1145` + `notify.emit_notification`)
- 前端轮询 `GET /api/me/notifications` (小程序 `pages/notifications:130` 调用)
- **没有 WS push** — 用户必须 主动 进 通知页 才看到. 桌面也是 polling.
- **NORTH_STAR § 3.4 "目标"** + `PRODUCT_OVERVIEW.md` § 4.4 #3 已记 "跨端通知 push 没真做" 中级紧.
- **影响**: P1 — 演示 时容易 不实时, 但 不阻塞 功能.

**建议**: WS 推 + 小程序 wx.subscribeMessage 走微信原生通知 (PM Q7.4 N2 + § 4.4 提到的 "跨端 push")

#### D4-#4 · attachment extract_status 三端各自 polling [P2]

- `MeetingAttachment.extract_status: pending → extracting → ready/failed/skipped` (`models.py:488`)
- 桌面/H5: 创建会议时 polling `GET /api/meetings/attachments?draft_id=...`
- 小程序: `pages/create:524` setInterval 5s polling
- **冲突**: 没 WS push, 每端各自轮询. 同一用户 H5 + 小程序 并行打开会重复 polling.
- **影响**: P2 — 浪费带宽 + DB 查询, 但 不阻塞.

#### D4-#5 · kb_sedimentation_draft / memory_draft 通知 三端 不一致 [P1]

- 后端有 emit_notification 但 仅 task_* / action_* / access_* 类 (`notify.py:13-44`)
- memory_draft 创建时 **没有 emit_notification** (我搜了 `memory_drafts.py` 没找到 emit)
- 结果: primary_user 不知道 自己 AI 有待审 memory_draft, 必须 主动进 H5/小程序 看 (`pages/tasks_list` 的待审 tab)
- **影响**: P1 — primary_user 体验差.

---

### D5 · 权限差异

**前置**: 跟 `docs/audit/role-permission-audit-2026-05-25.md` 交叉, 不重复, 这里仅看"跨端权限实施差异".

#### D5-#1 · 小程序客户端硬编码 `isWriter = owner||admin||leader` 跟新 5 层角色不齐 [P1]

- 小程序 `pages/voiceprint/voiceprint.js:105`: `const isWriter = role === 'owner' || role === 'admin' || role === 'leader';`
- 新 5 层角色 (`auth.py:212-243`): `system_owner / workspace_creator / leader / admin / agent_owner / member` — 没有 `owner`, 也没有 `manager`
- 实际 后端 `/api/auth/me` 返 `effective_role` 可能 是 `workspace_creator` (新角色) — 小程序 客户端 判定 `role === 'owner'` 永远 false
- **影响**: P1 — workspace_creator 在 小程序 看 voiceprint 页 时, `isWriter` 计算 错误, 录入按钮可能 不显, 但 实际有权限. 真录入 时 后端 让过 (后端走 ABAC), UI 误锁.

#### D5-#2 · 小程序 me.js role label 用 deprecated `expert` [低]

- `pages/me/me.js:18-32` `ROLE_LABEL` / `ROLE_TONE`:
  ```js
  ROLE_LABEL = { owner: '召集人', leader: '局长', admin: '管理员', expert: '专家', member: '成员' };
  ```
- `expert` 在 v1.3.1 已 deprecated (改 `agent_owner`, 见 `auth.py:347-351`)
- **影响**: 低 — 老用户的 `WorkspaceMembership.role='expert'` 仍存活, 这里没坏; 但 新 register 角色 (`agent_owner` / `workspace_creator`) 显示 fallback 到 raw string.

#### D5-#3 · agents list ABAC 三端表现不一致 [P2]

- 后端 `agents.py:148-159`: leader/admin/owner 看全部 16 AI, `expert` (deprecated 但还有数据) 仅看 self.bound_agent_id, member 看全部基础信息
- 小程序 `pages/create:142` 自己再过滤 `(a) => a.role === 'expert' || a.role === 'moderator'`
- H5 类似
- **冲突**: 客户端再过滤 看似冗余, 但实际 后端 走 ABAC 已经够, 客户端 再加一层 (避免 把 deprecated AI 显出来). 不是冲突, 是 防御性 — OK.

#### D5-#4 · 普通 member 创会议在 mode='auto' 时 403 [OK]

- 后端 `meetings.py:114`: `mode='auto'` 强制 `require_leader_or_admin`
- 客户端 (`pages/create:601`) 提前校验 `selectedExpertCount >= 3` 但 没校验 角色 — 真后端拒时 toast 提示
- **冲突**: 客户端 没显式 显示 "member 不能开 auto 会议" 的 UI hint, 用户填了一堆 才被 403. 不是 critical, 是 UX 损失.
- **影响**: 中 — 体验问题.

---

### D6 · UI 一致性

#### D6-#1 · 🔥 小程序 17 张 wxss 全部 dark, H5/`/m/*` 已浅色化 [P0]

**事实**:
- H5 `/m/*` (`frontend/src/app/m/MobileShell.tsx:82`) `background: #F2F2F7` (iOS systemGroupedBackground)
- 桌面 `/meeting/[id]` round-3 已浅色化 (v1.2.0 P1-P4 done, commit `f217b53`)
- 小程序 17 张 wxss 全部 `page { background: #0a0a0c; }` (验证: `home / meeting / meeting_summary / me / agent_detail / create / insights / login / notifications / meetings_list / tasks_list / task_detail / picker / voiceprint / about / webview` 全部 dark)
- DESIGN_SYSTEM.md § 0 表格里 [bundle] = 浅色 / [现有] = dark, 但 [现有] 部分 现在 仅 指 老桌面 dark (主战场已切浅色); 小程序 跑在 [现有] 老 dark 范式 之下, **从未浅色化过**.

**冲突点**:
- NORTH_STAR § 7.1 "**不做 dark mode**" — 但 small print: "round-4 in-progress" 指 H5 主 tab. 小程序 一直没人 review.
- PM 心智里 "三端浅色化统一" 还没排上 Saga. 17 张 wxss 估算 ~20-30h.

**影响**: P0 — 直接 violate NORTH_STAR § 7.1. 客户 看到的小程序 跟 H5 完全两种风格, 撕裂感强.

**建议方向**: Saga F (新立) "小程序原生浅色化" — 跟 Saga A (round-4 P0 主 tab 浅色化) 联动, 用相同设计 token.

#### D6-#2 · 小程序原生导航 vs H5 PageHeader 风格 不齐 [P1]

- 小程序: 自定义导航栏 (statusBar + navBar 自己算, `pages/home/home.js:71-73 getNavMetrics()`)
- H5 `/m/*`: 用 `frontend/src/components/mobile/PageHeader.tsx` 统一封装
- 视觉细节差: 小程序 nav 不带 brand gradient (round-4 MAGlowBanner), 还是纯灰

**冲突点**: round-4 P0 的 brand gradient + cross-tab brand 还没推到小程序

**影响**: P1 — 视觉一致性中等问题, 小程序 用户感觉 "比 H5 旧"

#### D6-#3 · AI 头像 / 个人色 三端各画 [中]

- 桌面: `frontend/src/components/agents/AgentAvatar.tsx`
- H5: `frontend/src/components/mobile/AgentBadge.tsx`
- 小程序: `pages/home/home.js:472-484` `_agentColorClass` 写死 `{violet:'bar-violet', emerald:'bar-emerald', ...}` map, wxss 里再画
- DESIGN_SYSTEM § 1.4 列了 6 个 AI 渐变, 三端 实施 各画一遍, 容易 drift

**影响**: 中 — 但 不阻塞.

#### D6-#4 · 小程序 voiceprint 录入页 跟 桌面 `/enroll` 流程不齐 [P2]

- 桌面 `/enroll` 是 dedicated 多步骤 wizard
- 小程序 `pages/voiceprint` 是单页 list + recorder
- **冲突**: 同一 业务流程 两套 UX 设计, 三端不齐.
- 而且 这本身 又是 D2-#1 的 编辑功能问题.

#### D6-#5 · 小程序"隐私协议"借 webview 跑 H5 页 [P2]

- `pages/login/login.js:430` `wx.navigateTo({ url: '/pages/webview/webview?path=/m/privacy' })`
- 小程序 用 webview 跑 H5 — 视觉/操作 跟 原生页不齐
- **冲突**: NORTH_STAR § 4.3 "H5 是 staging, 终态翻译到小程序原生" — 这个还是 staging 状态.

#### D6-#6 · 小程序 me.js 用 `version: 'v1.1.0'` hardcode [低]

- `pages/me/me.js:47`: `version: 'v1.1.0'` — 跟 当前 v1.2.0 不齐, 跟 桌面 显示也不齐.
- **影响**: 低 — 但 用户看到 "v1.1.0" 会困惑.

---

### D7 · 登录 / Session

#### D7-#1 · 三套 session 机制 — cookie / Bearer / wx-openid [设计如此]

- **H5 浏览器 (cookie session)**: `/api/auth/login` set httpOnly cookie 14 天 (`auth.py:267`)
- **小程序原生 (Bearer JWT 30 天)**: `/api/auth/token` body 返 JWT (`auth.py:548`)
- **跨端桥 (cookie → token)**: `/api/auth/exchange-token` (`auth.py:582`)
- **小程序 OAuth (wx-openid)**: `/api/auth/wx-login` (`auth.py:869`) + `/api/auth/wx-phone-login` (`auth.py:932`)
- **小程序绑定 (login Bearer + 微信 code → openid)**: `/api/auth/wx-bind` (`auth.py:1017`)
- 后端 `get_current_auth` 同时支持 cookie + Bearer (`auth.py:109-112`) — ✅ 设计良好

**冲突点**: 不是冲突, 是复杂 — 测试时 总要确认"我现在走的哪条". 跟 NORTH_STAR 一致.

#### D7-#2 · 小程序 webview 内 cookie 没桥 [P1]

- 小程序 `pages/webview/webview` 跑 H5 (例: 隐私页, 老 fallback)
- 小程序 已 Bearer 登录, 但 webview 是独立的 浏览器 上下文, 没 H5 cookie
- 用户进 webview 页 时, H5 看到 没登录, 提示登录
- **冲突**: 跨端 session 没共享.
- 已有 `/api/auth/exchange-token` 是反向 (cookie → Bearer), 反过来 (Bearer → cookie 写 webview) 没做.

**影响**: P1 — 现在只有 隐私页用 webview, 其他都原生; 但 PM 想小程序按需 fallback H5 时会撞.

#### D7-#3 · refresh token 流程 仅 小程序有 [低]

- 小程序: `pages/login` + `utils/auth.js:66 refreshToken()` 每次启动 离过期 < 7 天 自动 refresh
- 桌面: cookie 自动续期 (httpOnly + Same-Site, server-side renew)
- H5: 没 refresh 机制 — cookie 过期 用户 重新 login
- **影响**: 低 — H5 14 天 cookie 也够.

#### D7-#4 · 多 workspace 切换 三端表现差 [P2]

- 桌面 + H5: 顶部 workspace 切换 dropdown (`/me/profile` / `MobileShell` Header)
- 小程序: **没有切换 UI** — 用户登录 默认 active workspace, 切换 走 webview 桌面页
- **NORTH_STAR § 4.2 "切换 workspace" 明示 是 小程序功能** — 现状没实施
- **影响**: P2 — leader 跨 workspace 用户 痛点 (现状 ≤ 5 人, 但 长期会爆)

---

## 3. 冲突优先级建议

### P0 (影响生产用户使用)

| # | 冲突 | 维度 | 一句话 |
|---|---|---|---|
| 1 | 小程序 17 张 wxss 全 dark, H5/桌面 已浅色 | D6-#1 | 视觉撕裂, 直接 violate NORTH_STAR § 7.1 |
| 2 | 小程序有 9 个写入端点 vs NORTH_STAR "无编辑" | D2-#1 | 实操 vs 文档 矛盾, PM 必须拍板 选 A/B/C |
| 3 | leader 跨端切换 信息架构断裂 | D2-#2 | 桌面 admin-heavy + 移动 user-heavy, leader 找不到管理工具 |

### P1 (影响开发体验 / 进阶用户)

| # | 冲突 | 维度 | 一句话 |
|---|---|---|---|
| 4 | 小程序客户端 `isWriter = owner || admin || leader` 跟 v1.3.1 新角色不齐 | D5-#1 | workspace_creator 角色被误判 |
| 5 | 跨端 push 通知缺失, 仅 polling | D4-#3, D4-#5 | NORTH_STAR § 3.4 / PRODUCT_OVERVIEW § 4.4 #3 已记 |
| 6 | 小程序 webview 没 Bearer ↔ cookie 桥 | D7-#2 | 隐私页等 fallback 场景 用户得重登 |
| 7 | 小程序原生导航跟 H5 PageHeader 风格不齐 | D6-#2 | round-4 brand gradient 还没推到小程序 |
| 8 | 小程序 me.js 显 deprecated `expert` role 标签 | D5-#2 | 老兼容, 但 新角色 fallback 显 raw |

### P2 (长期债)

| # | 冲突 | 维度 | 一句话 |
|---|---|---|---|
| 9 | 小程序 没 workspace 切换 UI | D7-#4 | 长期 leader 跨 ws 痛点 |
| 10 | `/api/m/*` vs `/api/*` 没文档说明 | D3-#1 | 维护痛, 但 不阻塞 |
| 11 | attachment polling 各端 各自 5s | D4-#4 | 浪费 |
| 12 | AI 头像 + 个人色 三端各画一遍 | D6-#3 | drift 风险 |
| 13 | small mismatch: `version: 'v1.1.0'` hardcode | D6-#6 | 小细节 |
| 14 | 召唤 vs 邀请 双 endpoint 不明 | D3-#2 | review 易错 |
| 15 | AIInsightFull 三端类型同步无流程保证 | D1-#1 | Saga E 加字段时会出问题 |

---

## 4. 建议 Saga 拆分

> 给 PM 参考, 不是 拍板. 跟 Saga A (round-4 P0 主 tab 浅色化) / Saga E (AI 专家核心能力补齐) / Saga · 权限对齐 (in-progress) 协调.

### Saga F · 小程序原生浅色化 [P0]

**范围**: 17 张 wxss 改成 iOS 浅色 + DESIGN_SYSTEM § 0 表格 [bundle] 范式
**依赖**: Saga A 收尾后 (round-4 浅色 token 稳定)
**估算**: ~25h (17 页 × 1.5h)
**对齐 NORTH_STAR**: § 7.1 + § 4.2

### Saga G · 小程序编辑边界澄清 + 收口 [P0]

**第一刀**: PM 拍板 D2-#1 选 A/B/C
**第二刀**: 按选项 修代码 + 改 NORTH_STAR § 4.2 + § 7.3
- A: 拆掉 9 个写入, 跳 webview 让用户 编辑
- B: 重写 NORTH_STAR — 小程序 允许工作流推进 (task/memory/insight 决策 + 评论), 仍禁 配置编辑
- C: NORTH_STAR § 4.2 加"实操延伸" 说明, 默认现状

**估算**: A: ~15h / B: ~3h (改文档 + 加测试覆盖) / C: ~1h
**对齐 NORTH_STAR**: 直接改 NORTH_STAR

### Saga H · 跨端通知 push 真做 [P1]

**范围**: WS push (`session_state.broadcast` 扩到 task/memory_draft 事件) + 小程序 `wx.subscribeMessage` 桥 + 桌面 在线状态判断细化
**依赖**: Saga · 权限对齐 收尾 (notification kind 跟 新 5 层角色 对齐)
**估算**: ~10h
**对齐 NORTH_STAR**: § 3.4 / § 4.4

### Saga I · 移动 leader 信息架构 [P0]

**范围**: 小程序 `pages/me` + H5 `/m/me` 加 "切到 web 管理" 引导 (Bearer → cookie 桥, 见 D7-#2); 桌面 `/admin` vs `/me/profile` 二选一 (PM 拍板)
**依赖**: Saga · 权限对齐 (新 5 层 + admin 范围) 收尾
**估算**: ~12h
**对齐 NORTH_STAR**: § 4.1 + § 4.4

### Saga J · API 文档化 + 三端类型同步流程 [P2]

**范围**: `docs/api/mobile-vs-desktop.md` + `wechat-miniprogram/utils/types.js` (用 jsdoc 跟 ts 同步) + CI 校验 `mobile.py` Pydantic ↔ `types.ts` 同步
**估算**: ~6h
**对齐 NORTH_STAR**: § 8 工作流

### 不立 Saga (现状默认)

- D3-#2 (邀请/召唤双 endpoint): review 阶段加 inline 注释即可
- D6-#6 (`version` hardcode): 顺手 fix
- D7-#3 (refresh 仅小程序有): H5 14 天 cookie 够用, 不动
- D7-#4 (小程序 workspace 切换): 长期 ≤ 5 用户, 列 backlog 即可

---

## 5. 跟 NORTH_STAR § 4 的对齐情况

### 5.1 跟 NORTH_STAR 一致的 (设计如此, 不是冲突)

| 现象 | NORTH_STAR 出处 |
|---|---|
| Web 独占 11 个编辑入口 (`/admin/*` + `/me/profile/*`) | § 4.1 |
| 小程序 / H5 无 expert/KB/memory/workspace 编辑 UI | § 4.2 + § 7.3 |
| 小程序 微信 OAuth / 手机号一键 / 聊天文件 picker 独占 | § 4.2 |
| /super 跨 workspace 桌面 独占 | § 4.1 + § 5.3 |
| 桌面 chat / dashboard 不做移动版 | § 4.1 |
| H5 `/m/*` 当 staging, 终态翻译到小程序原生 | § 4.3 |
| 三端共用一套后端 (~30 表 + 200+ endpoint) | § 4.4 |
| 三套 session 机制 (cookie / Bearer / wx-openid) | § 4.4 + § 4.2 |

### 5.2 真冲突 (要处理, 不是设计如此)

| 冲突 | NORTH_STAR 哪一条违反了 |
|---|---|
| 小程序 17 张全 dark | § 7.1 "不做 dark mode" |
| 小程序 9 个写入端点 | § 4.2 + § 7.3 "小程序无编辑功能" |
| leader 跨端切换 信息架构断裂 | § 4.4 "三端数据同步" |
| 跨端 push 没真做 | § 3.4 (AI 任务执行 — 跨端任务通知)  / § 4.4 |
| 小程序 webview cookie 没桥 | § 4.4 "三端数据同步" 隐含 |
| 小程序客户端 role 判定 hardcode 老 6 角色 | § 2.2 + 权限审计 |

### 5.3 NORTH_STAR § 4.2 模糊点 (需 PM 澄清)

- "无编辑功能" 的定义 边界: task 状态推进 / 评论 / memory_draft 决策 / insight 决策 算不算 编辑?
  - **建议**: 把 "编辑" 限定为 *配置层* (AI persona / KB / memory CRUD / role / workspace), 工作流推进 算"使用". 见 Saga G 选项 B.
- "切换 workspace" 在小程序里 是 必做 还是 长期 backlog? — § 4.2 列了但 没做. 见 D7-#4.

---

## 6. 附录 · 关键代码证据 索引

| 主题 | 文件 | 关键行 |
|---|---|---|
| **后端 endpoint 全列** | `backend/app/routers/mobile.py` | 100, 306, 494, 709, 763, 882, 1069, 1224, 1290, 1425, 1717, 1961 |
| 后端 老 meetings endpoint | `backend/app/routers/meetings.py` | 100 (`POST`), 784 (`/{id}/agents`), 2153 (`agenda-advance`), 2267 (`jump`) |
| 后端 auth | `backend/app/routers/auth.py` | 425 (`/login` cookie), 548 (`/token` Bearer), 582 (`/exchange-token`), 869 (`/wx-login`), 932 (`/wx-phone-login`), 1017 (`/wx-bind`) |
| 后端 role 5 层模型 | `backend/app/auth.py` | 212-243 (`_WORKSPACE_MANAGER_ROLES` / `_WORKSPACE_ADMIN_OR_ABOVE_ROLES`), 293 alias `is_leader_or_admin` |
| 后端 WS broadcast | `backend/app/session_state.py` | 78 (`broadcast(meeting_id, payload)`) |
| 后端 Meeting model | `backend/app/models.py` | 317-395 (Meeting), 244-312 (Agent + primary_user_id), 397-411 (MeetingAttendee), 414-495 (MeetingAttachment), 1145-1183 (Notification) |
| H5 mobile API client | `frontend/src/lib/mobile/api.ts` | 327 行 |
| H5 mobile types | `frontend/src/lib/mobile/types.ts` | 21-33 (AIInsightFull), 123-176 (AgentWorkCard/AgentDetailOut), 304-340 (WorkspaceMember/WorkspaceAgentBrief/CreateMeetingIn) |
| H5 WS bus | `frontend/src/lib/mobile/meetingWsBus.tsx` | 46-113 (provider) |
| H5 MobileShell 浅色 | `frontend/src/app/m/MobileShell.tsx` | 82 (`background: #F2F2F7`) |
| 小程序 API client | `wechat-miniprogram/utils/api.js` | 1-155 (全文; Bearer + LLM timeout / wx.uploadFile) |
| 小程序 auth | `wechat-miniprogram/utils/auth.js` | 1-155 (token storage + 7 天 refresh + `ensureAuth`) |
| 小程序 WS | `wechat-miniprogram/utils/ws.js` | 1-244 (exponential backoff + Bearer header + PCM buffer) |
| 小程序 dark `page { background: #0a0a0c }` | `wechat-miniprogram/pages/*/[name].wxss` | home:4, meeting:3, me:3, meeting_summary:3, agent_detail:3 (17 张全部) |
| 小程序 voiceprint 编辑 | `wechat-miniprogram/pages/voiceprint/voiceprint.js` | 105 (`isWriter` hardcode), 166 (`api.post('/api/users')`), 380 (`api.del('/api/voiceprints/by-user/{uid}')`) |
| 小程序 写入端点列 | (本文 § 2 D2-#1 表) | (汇总自 grep) |
| 小程序 role label deprecated `expert` | `wechat-miniprogram/pages/me/me.js` | 18-32 (ROLE_LABEL/ROLE_TONE) |
| 小程序 `/api/m/*` 调用 | `wechat-miniprogram/pages/home/home.js`, `agent_detail.js`, `task_detail.js`, `insights.js`, `meetings_list.js`, `tasks_list.js`, `meeting/meeting.js`, `create/create.js` | — |
| **现有 权限审计** | `docs/audit/role-permission-audit-2026-05-25.md` | 509 行 (PM 5 层 vs 代码 6 role 已 covered) |
| **现有 现状清单** | `docs/PRODUCT_OVERVIEW.md` § 4.3 #5 (leader 信息架构), § 4.4 #3 (跨端 push) | — |
| NORTH_STAR § 4 端定位 | `docs/NORTH_STAR.md` | 134-167 |
| NORTH_STAR § 7 不做 5 条 | `docs/NORTH_STAR.md` | 226-258 |

---

> **本文档不动代码 不改 NORTH_STAR.md**. 仅做冲突 review.
> 反馈渠道: PM 拍板冲突 D2-#1 / D6-#1 后, 由主 Agent 立 Saga F/G/H/I/J.
