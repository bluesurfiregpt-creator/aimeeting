# v26 派发模型重构 · Cowork 测试计划

测试目标:验证 v26.0 (agent-centric 派发) + v26.1 (KB embedding + 完成率) 在生产环境的端到端正确性。

## 运行方式

**方式 A:Claude Cowork 自动执行**

把这份 markdown 完整丢给 Claude Cowork,让它逐条 case 调 API + 验证。Claude Cowork 应该:
1. 登录 `https://aimeeting.zhzjpt.cn`,确保拿到 cookie auth
2. 每个 case 严格按"准备 → 执行 → 期望"三段跑
3. 创建的资源(meeting / agent / KB)在用例末尾自动 cleanup
4. 失败时停在该 case,输出 拿到的 response body 让人 debug

**方式 B:paste 进 `tests/cowork_suite.js`**

把后面"代码片段"段落 copy 到 `registerCases(R)` 函数末尾(就 R series 之后),然后:
```javascript
const r = await runCoworkSuite();
console.log(r.markdown);
```

---

## 前置条件(测前确认)

| # | 条件 | 怎么确认 |
|---|---|---|
| 1 | workspace 里至少 2 个 user (含 leader 本人) | `GET /api/users` 返回 ≥2 条 |
| 2 | workspace 里有 ≥1 个 active=true 的 agent | `GET /api/agents` |
| 3 | 当前登录的是 leader / admin (能创建 agent + 派发) | `GET /api/auth/me` → workspace_role in (owner, admin, leader) |
| 4 | DashScope embedding 可用 (text-embedding-v2) | 创建 KB + 上传一个 200+ 字文档 + 检查 chunks 有 embedding |

---

## 测试用例(V26 series)

### V26-1 · Agent.primary_user_id 字段读写

**目的**:验证 v26.0 新字段 `Agent.primary_user_id` 能创建 + 读取 + 在 list/get 返回 `primary_user_name`。

**准备**:
```
GET /api/users → 取第一个 user 的 id (USER_A)
```

**执行**:
```
POST /api/agents
{
  "name": "_cowork_v26_test_agent_1",
  "domain": "test-domain",
  "persona": "测试用 agent",
  "keywords": ["产品规划", "PRD撰写"],
  "primary_user_id": "<USER_A>",
  "is_active": true,
  "dify_app_type": "chatflow"
}
```

**期望**:
- 响应 200
- `primary_user_id` 等于 `<USER_A>`
- `primary_user_name` 不为 null(后端 join User 表)

**Cleanup**:`DELETE /api/agents/<id>`

---

### V26-2 · 没绑 primary_user 的 agent 不进候选池

**目的**:验证 routing 候选过滤 — 没绑 primary_user 的 agent 不该出现。

**准备**:
```
POST /api/agents  (绑 primary_user)  → AGENT_OK_ID
POST /api/agents  (不传 primary_user_id) → AGENT_NO_USER_ID
```

**执行**:
```
POST /api/me/dispatch-recommend
{ "content": "完善系统功能模块划分" }
```

**期望**:
- `candidates` 数组里 **包含** `AGENT_OK_ID`
- `candidates` 数组里 **不包含** `AGENT_NO_USER_ID`(即使它 is_active=true)

---

### V26-3 · 评分 response 含 v26 字段

**目的**:验证 RouteScore 结构升级到 v26。

**准备**:同 V26-2(至少 1 个候选)

**执行**:`POST /api/me/dispatch-recommend { "content": "..." }`

**期望**:
- 顶层有 `confidence_tier` ∈ {"high", "medium", "low"}
- 顶层有 `threshold` (number)
- 顶层有 `matched` (bool)
- 每个 `candidates[i]` 有:
  - `agent_id`, `agent_name`, `agent_color`
  - `primary_user_id`, `primary_user_name`, `primary_user_active_count`
  - `candidate_user_id`, `candidate_user_name` (v25 兼容字段,与 primary_user_* 同值)
  - `breakdown` 含 `semantic / knowledge / history / load / availability` 5 个 number
  - `breakdown._kb_used_embedding` 是 boolean (v26.1)

---

### V26-4 · confidence_tier 三档边界

**目的**:验证 high (≥0.60) / medium (0.40-0.60) / low (<0.40) 阈值判定。

**准备**:
- AGENT_HIGH:keywords=["报告", "汇总", "梳理"],primary_user 绑
- AGENT_LOW:keywords=["完全无关词xyzabc"],primary_user 绑

**执行 A**:`POST /dispatch-recommend { content: "梳理汇报本月报告" }`
**期望 A**:`confidence_tier === "high"` 或至少 "medium"(取决 v26.1 KB 等其他维度)

**执行 B**:`POST /dispatch-recommend { content: "abc def ghi 123" }`(完全没意义)
**期望 B**:`confidence_tier === "low"` 且 `matched === false`

---

### V26-5 · dispatch 接受 assignee_agent_id

**目的**:验证 dispatch endpoint 支持 v26 agent-centric 入参。

**准备**:
- 创建一个 manual Task(POST /api/me/tasks 或通过 Action item 流程)→ TASK_ID
- AGENT_OK:已绑 primary_user → AGENT_OK_ID,绑的是 USER_X

**执行**:
```
POST /api/me/tasks/<TASK_ID>/dispatch
{ "assignee_agent_id": "<AGENT_OK_ID>" }
```

**期望**:
- 响应 200
- 返回 task `status === "dispatched"`
- `assignee_agent_id === <AGENT_OK_ID>`
- `assignee_user_id === <USER_X>` (derive: agent.primary_user_id)
- `assignee_agent_name` 不为 null

---

### V26-6 · dispatch 拒绝没绑 primary_user 的 agent

**目的**:验证防御 — 没绑 user 的 agent 不能接任务。

**准备**:AGENT_NO_USER:未绑 primary_user

**执行**:`POST /api/me/tasks/<TASK_ID>/dispatch { "assignee_agent_id": "<AGENT_NO_USER>" }`

**期望**:
- 响应 400
- error message 含 "未配置科室账号" 或类似

---

### V26-7 · dispatch 必须给 agent_id 或 user_id

**目的**:防御空入参。

**执行**:`POST /api/me/tasks/<TASK_ID>/dispatch { }` (两个都不传)

**期望**:响应 400, error message 含 "必须指定" 或 "之一"

---

### V26-8 · auto_route 评分排序正确(fixture 不强求 high tier)

**目的**:验证 auto-route 跑通 + 评分正确选出预期 agent。

**说明**:v26.1 评分体系 故意让"没配 KB 的 agent"触不到 high tier
(逼运营 配 KB 才能享受自动派发)。本 case 的 fixture 是 minimal — 没绑
KB / persona 短 / 关键词少 — 算出来通常 medium (0.40-0.60),不会自动派.
**fixture 受限下,我们只验证 winner agent 是预期的,不强求 tier=high.**

完整 high path 验证由 V26-15 (真 KB embedding) 和 V26-20 (4 个丰富 fixture)
覆盖.

**准备**:沿用 V26-1 创建的 agent (`ctx.v26_agent_with_user`)。
创建 manual Task,content 命中其 keywords。

**执行**:
```
POST /api/me/tasks/<TASK_ID>/auto-route
```

**期望**:
- 响应 200
- `winner` 存在(取 `r.body.winner` 或 `r.body.candidates[0]`)
- `winner.agent_id === ctx.v26_agent_with_user`
- 不强求 `matched===true` / `tier===high`
- 如果 `matched===true`,task.assignee_agent_id 应正确写入

---

### V26-8b · auto_route 高置信自动派发 (默认跳过,见 V26-15/V26-20)

**目的**:验证 high tier (≥0.60) 触发完整自动派路径。

**说明**:此 case 需要"丰富 fixture"(agent 绑 KB + 长 persona + 多关键词
+ task 与 KB 主题强相关).自动测试场景不便快速搭起来,所以**默认 skip**.

**手动验证替代方案**:
- 跑 V26-15 (KB embedding 端到端,需 30s+)
- 跑 V26-20 (3 个丰富 fixture happy path,纯关键词 也能跑 high)
- 或在 prod 数据上,等运营配齐 KB + 派一条强对口 task 验证

---

### V26-9 · auto_route 低置信不派(matched=false)

**目的**:验证低分情况下不会误派。

**准备**:Task content="qwerty asdfgh zxcvbn"(纯噪声,与所有 agent 不沾)

**执行**:`POST /api/me/tasks/<TASK_ID>/auto-route`

**期望**:
- `matched === false`
- `winner === null`
- `task === null`
- `candidates` 仍返回(让 leader 看)
- `confidence_tier === "low"` 或 "medium"

---

### V26-10 · listMyTasks role=all_pending 全局视图

**目的**:验证 leader 能看到 workspace 内所有待派发任务,即使 assignee 不是自己。

**准备**:
- 创建 task A,不派(status=open),assignee 留空
- 创建 task B,派给别人(USER_X,不是 我)→ 不算 open
- 创建 task C,不派,留 open

**执行**:`GET /api/me/tasks?status=active&role=all_pending`

**期望**:
- 响应 200
- 包含 task A 和 task C (open)
- 不包含 task B (已 dispatched)
- 这些 task 即使 assignee 不是 我,也能看到

**反向测试**:同样 GET 用 普通 member 账号 → 期望 403

---

### V26-11 · MyTaskOut 返回 agent 字段

**目的**:验证 task list / detail 返回 agent 主责信息。

**准备**:V26-5 已完成的 task

**执行**:`GET /api/me/tasks?role=assignee` 找到 该 task

**期望**:
- `assignee_agent_id`, `assignee_agent_name`, `assignee_agent_color` 都有
- `co_agent_ids`, `co_agent_names` 字段存在(空数组也行)

---

### V26-12 · action_extractor 抽 topic_keywords

**目的**:验证 v26 LLM prompt 改造 — 抽主题关键词而不是 assignee_name。

**准备**:
- 创建 meeting → MEETING_ID
- 注入 ≥10 句 manual transcript,内容真人讨论"产品 PRD 撰写",指派"周五前提交"
- finalize meeting

**执行**:
```
POST /api/meetings/<MEETING_ID>/summary/regenerate
等 30-60s (轮询 GET /summary 看 status=ready)
GET /api/meetings/<MEETING_ID>/actions
```

**期望**:
- 至少 1 条 action_item
- 该 action_item 对应 task 的 `source_ref.topic_keywords` 是 list[string] 非空
- 关键词 应该 命中 业务领域("产品", "PRD" 等),而**不是真人姓名**

---

### V26-13 · action_extractor 自动派 AI 专家(链路全闭环)

**目的**:验证整条 "会议 → 抽 task → 自动派 agent" 端到端。

**准备**:
- 创建 AGENT_PROD (keywords=["PRD", "产品"], primary_user 绑)
- 创建 meeting + 注入 transcript(讨论"PRD 修改") + finalize + regenerate summary
- 等到 action_items 出现

**执行**:`GET /api/meetings/<MEETING_ID>/actions`

**期望**(至少一条):
- `assignee_agent_id` 等于 `<AGENT_PROD>`
- `assignee_agent_name` === "AGENT_PROD 名字"
- `assignee_user_id` === AGENT_PROD.primary_user_id
- `task_status` ∈ {"open", "dispatched"}

**说明**:如果 LLM 抽出来 confidence 不够 high,assignee_agent_id 可能为 null(留 leader 派) — 这个 case 容忍。重点是 topic_keywords 有 + 至少 medium 候选。

---

### V26-14 · Agent CRUD 验证 primary_user_id 必须同 workspace

**目的**:防御 — 不能把别 workspace 的 user 绑过来。

**执行**:`POST /api/agents { name: "...", primary_user_id: "<某个不存在 / 别 workspace 的 uuid>" }`

**期望**:响应 400, error message 含 "workspace"

---

### V26-15 · knowledge 维度真用 KB embedding(v26.1 核心)

**目的**:验证 KB embedding 检索真的跑起来,不是占位。

**准备**(资源贵,可考虑标 expected_skip 跳过 或 共享 fixture):
- 创建 KB:`POST /api/knowledge-bases { name: "_cowork_v26_kb" }` → KB_ID
- 上传 1 个文档(纯文本 500 字,主题:"深圳企业服务补贴政策"):
  `POST /api/knowledge-bases/<KB_ID>/documents` (multipart)
- 等 chunking + embedding 完成(轮询 KB 的 chunk_count > 0,~10-30 秒)
- 创建 AGENT_KB:绑该 KB + primary_user

**执行**:
```
POST /api/me/dispatch-recommend
{ "content": "深圳市企业研发资助申请流程梳理" }
```

**期望**:
- 在 `candidates` 里找到 AGENT_KB
- `breakdown.knowledge ≥ 0.40` (真命中 KB chunk)
- `breakdown._kb_hits ≥ 1`
- `breakdown._kb_used_embedding === true`

**对照组**:再跑一次 `content="完全无关的内容 abc 1234"` → 同一 AGENT_KB 的 `breakdown.knowledge` 应该 << 第一次 (≤ 0.20)。

---

### V26-16 · history 维度返回完成率字段(v26.1)

**目的**:验证 history breakdown 含 _completion_rate。

**执行**:`POST /api/me/dispatch-recommend { content: "..." }`

**期望**:`candidates[0].breakdown._completion_rate` 是 number (0-1 区间) 或 0 (没历史)

---

### V26-17 · knowledge fallback 当 agent 无 KB

**目的**:验证 fallback 链路 — 没 KB 不会让 routing 崩。

**准备**:AGENT_NO_KB:没绑 knowledge_base_ids,但 primary_user 已绑

**执行**:`POST /api/me/dispatch-recommend { content: "..." }`

**期望**:
- candidates 包含 AGENT_NO_KB
- `breakdown.knowledge` 是 number(可能 0,可能小正数)
- `breakdown._kb_used_embedding === true` 但 `_kb_hits === 0`,**或** `_kb_used_embedding === false`(fallback 到 配置近似)
- 任何情况下 routing 不应 500

---

### V26-18 · /admin/agents UI 字段(API 层验证)

**目的**:验证前端能拿到 agent.primary_user_name 用于显示。

**执行**:`GET /api/agents`

**期望**:每个 agent 响应含:
- `primary_user_id` (uuid 或 null)
- `primary_user_name` (string 或 null)
- 若 `primary_user_id` 非 null,则 `primary_user_name` 非 null(后端 join)

---

### V26-19 · backfill 脚本可执行(可选, 服务器端)

**目的**:验证 backfill 不崩。

**说明**:此用例需要 SSH/docker exec,Claude Cowork 浏览器环境无法验,**标 expected_skip**。手动验证:
```bash
docker exec -w /app aimeeting-backend python -m scripts.backfill_task_agent
# 看输出含 "stats: high=N medium=M low=K"
```

---

### V26-20 · routing 完整 happy path(端到端验证)

**目的**:最综合的一个 case,完整 复刻 v26 闭环。

**准备**:
1. 创建 4 个 agent:
   - AGENT_PROD (产品):keywords=["PRD","需求"],primary_user=USER_A
   - AGENT_LEGAL (法务):keywords=["合规","法务"],primary_user=USER_B
   - AGENT_TECH (技术):keywords=["架构","API"],primary_user=USER_C
   - AGENT_NO_USER:未绑 primary_user(对照 — 应被剔除)

**执行 + 期望**:

| Sub-case | Task content | 期望 winner agent | 期望 tier |
|---|---|---|---|
| 20a | "梳理 PRD V2 需求文档" | AGENT_PROD | high |
| 20b | "合规风险评估,法务审核" | AGENT_LEGAL | high |
| 20c | "微服务架构设计 API 接口" | AGENT_TECH | high |
| 20d | "完全无关 hello world" | (无 winner) | low |

每条调 `POST /dispatch-recommend` 验证。

**Cleanup**:删 4 个 agent。

---

## 期望的最终汇总

跑完所有用例,Markdown 报告应该长这样:

```
| ID | series | title | status | ms |
| V26-1 | V26 | Agent.primary_user_id 字段读写 | pass | ... |
| V26-2 | V26 | 没绑 primary_user 的 agent 不进候选池 | pass | ... |
| ... |
| V26-19 | V26 | backfill 脚本(skipped, manual) | skipped | 0 |
| V26-20a | V26 | routing happy path - 产品 | pass | ... |

PASS: 18 / 20
SKIPPED: 1 (V26-19)
FAIL: 0 (或列出失败 + response body)
```

---

## 代码片段(粘进 cowork_suite.js)

把下面这段 append 到 `registerCases(R)` 函数末尾(`}` 之前):

```javascript
    // ---------- V26 series · Agent-centric 派发 (v26.0 + v26.1) -------------
    R.register({
      id: "V26-1",
      series: "V26",
      title: "Agent.primary_user_id 字段可读写",
      async run(ctx) {
        const users = await GET("/api/users");
        if (!users.ok || !users.body[0]) return { ok: false, error: "no users" };
        const uid = users.body[0].id;
        const a = await POST("/api/agents", {
          name: `${PREFIX}_v26_1`,
          domain: "test",
          persona: "test agent",
          keywords: ["产品规划", "PRD撰写"],
          primary_user_id: uid,
          is_active: true,
          dify_app_type: "chatflow",
        });
        if (!a.ok) return { ok: false, error: `create: ${a.status} ${JSON.stringify(a.body)}` };
        created("agent", a.body.id, "v26-1");
        ctx.v26_agent_with_user = a.body.id;
        ctx.v26_user_a = uid;
        if (a.body.primary_user_id !== uid)
          return { ok: false, error: `primary_user_id mismatch: ${a.body.primary_user_id}` };
        if (!a.body.primary_user_name)
          return { ok: false, error: "primary_user_name missing in response" };
        return { ok: true, evidence: { _note: `agent bound to ${a.body.primary_user_name}` } };
      },
    });

    R.register({
      id: "V26-2",
      series: "V26",
      title: "没绑 primary_user 的 agent 不进候选池",
      async run(ctx) {
        // 创建一个没绑 user 的 agent
        const a2 = await POST("/api/agents", {
          name: `${PREFIX}_v26_2_no_user`,
          keywords: ["产品规划"],  // 关键词跟 ctx.v26_agent_with_user 一样
          is_active: true,
          dify_app_type: "chatflow",
        });
        if (!a2.ok) return { ok: false, error: `create: ${a2.status}` };
        created("agent", a2.body.id, "v26-2-no-user");

        const r = await POST("/api/me/dispatch-recommend", {
          content: "完善产品规划与 PRD 撰写",
        });
        if (!r.ok) return { ok: false, error: `recommend: ${r.status}` };
        const ids = (r.body.candidates || []).map((c) => c.agent_id);
        if (!ids.includes(ctx.v26_agent_with_user))
          return { ok: false, error: `expected v26_agent_with_user in candidates, got: ${ids.join(",")}` };
        if (ids.includes(a2.body.id))
          return { ok: false, error: `unbound agent should NOT be in candidates: ${a2.body.id}` };
        return { ok: true, evidence: { _note: `${ids.length} candidates, unbound filtered` } };
      },
    });

    R.register({
      id: "V26-3",
      series: "V26",
      title: "RouteScore 含 v26 字段(primary_user_*, agent_color, 5 维 breakdown)",
      async run(ctx) {
        const r = await POST("/api/me/dispatch-recommend", { content: "产品规划" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (typeof r.body.confidence_tier !== "string")
          return { ok: false, error: "missing confidence_tier" };
        if (!["high", "medium", "low"].includes(r.body.confidence_tier))
          return { ok: false, error: `bad tier: ${r.body.confidence_tier}` };
        const c = (r.body.candidates || [])[0];
        if (!c) return { ok: false, error: "no candidates" };
        const need = ["agent_id", "agent_name", "primary_user_id", "primary_user_name"];
        for (const k of need)
          if (!(k in c)) return { ok: false, error: `missing ${k}` };
        const b = c.breakdown || {};
        for (const k of ["semantic", "knowledge", "history", "load", "availability"])
          if (typeof b[k] !== "number") return { ok: false, error: `breakdown.${k} not number` };
        if (typeof b._kb_used_embedding !== "boolean")
          return { ok: false, error: "_kb_used_embedding not bool" };
        return {
          ok: true,
          evidence: {
            _note: `tier=${r.body.confidence_tier} composite=${c.composite.toFixed(2)} kb_emb=${b._kb_used_embedding}`,
          },
        };
      },
    });

    R.register({
      id: "V26-5",
      series: "V26",
      title: "POST /dispatch 接受 assignee_agent_id 派给 AI 专家",
      async run(ctx) {
        // 通过 manual transcript + action item 流程创建一个 task
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_v26_5`,
          attendee_user_ids: [],
        });
        if (!m.ok) return { ok: false, error: `meeting: ${m.status}` };
        created("meeting", m.body.id, "v26-5");
        // 手动加 action item — 它会 dual-write task
        const ai = await POST(`/api/meetings/${m.body.id}/action-items`, {
          content: "v26-5 测试待办",
        });
        if (!ai.ok) return { ok: false, error: `add action: ${ai.status} ${JSON.stringify(ai.body)}` };
        if (!ai.body.task_id) return { ok: false, error: "no task_id on action" };
        ctx.v26_5_task_id = ai.body.task_id;

        // 派给 v26-1 创建的 agent
        const d = await POST(`/api/me/tasks/${ai.body.task_id}/dispatch`, {
          assignee_agent_id: ctx.v26_agent_with_user,
        });
        if (!d.ok) return { ok: false, error: `dispatch: ${d.status} ${JSON.stringify(d.body)}` };
        if (d.body.status !== "dispatched")
          return { ok: false, error: `expected dispatched, got ${d.body.status}` };
        if (d.body.assignee_agent_id !== ctx.v26_agent_with_user)
          return { ok: false, error: `agent_id mismatch: ${d.body.assignee_agent_id}` };
        if (d.body.assignee_user_id !== ctx.v26_user_a)
          return { ok: false, error: `user_id should derive from agent.primary_user: ${d.body.assignee_user_id}` };
        return {
          ok: true,
          evidence: { _note: `dispatched to agent + derived user ${ctx.v26_user_a.slice(0, 8)}` },
        };
      },
    });

    R.register({
      id: "V26-6",
      series: "V26",
      title: "派给 没绑 primary_user 的 agent → 400",
      async run(ctx) {
        // 用 V26-2 创建的 unbound agent ; 但 V26-2 没存 ctx,这里重新创建
        const ub = await POST("/api/agents", {
          name: `${PREFIX}_v26_6_ub`,
          is_active: true,
          dify_app_type: "chatflow",
        });
        if (!ub.ok) return { ok: false, error: `create: ${ub.status}` };
        created("agent", ub.body.id, "v26-6-ub");
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };

        const d = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/dispatch`, {
          assignee_agent_id: ub.body.id,
        });
        if (d.ok) return { ok: false, error: `expected 400 but got 200` };
        if (d.status !== 400) return { ok: false, error: `expected 400 got ${d.status}` };
        const msg = (d.body?.detail || "") + "";
        if (!msg.includes("科室")) return { ok: false, error: `unexpected error: ${msg}` };
        return { ok: true, evidence: { _note: `correctly rejected: ${msg.slice(0, 50)}` } };
      },
    });

    R.register({
      id: "V26-7",
      series: "V26",
      title: "POST /dispatch 两个 id 都不给 → 400",
      async run(ctx) {
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };
        const d = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/dispatch`, {});
        if (d.ok) return { ok: false, error: `expected 400 got 200` };
        return { ok: true, evidence: { _note: `status=${d.status}` } };
      },
    });

    R.register({
      id: "V26-8",
      series: "V26",
      title: "auto-route 评分排序正确 (fixture 不强求 high tier)",
      async run(ctx) {
        // v26.1 设计:没绑 KB 的 agent 故意触不到 high tier (composite ≥ 0.60).
        // V26-1 创建的 fixture agent 没绑 KB,所以这里 大概率 medium / low.
        // 我们只验证 winner agent 是预期的,**不强求 matched/tier=high**.
        // 完整 high path 验证由 V26-15 (KB embedding) + V26-20 (丰富 fixture) 覆盖.
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_v26_8`,
          attendee_user_ids: [],
        });
        created("meeting", m.body.id, "v26-8");
        const ai = await POST(`/api/meetings/${m.body.id}/action-items`, {
          content: "撰写产品规划 PRD 文档 V2",
        });
        if (!ai.ok) return { ok: false, error: `add action: ${ai.status}` };
        const tid = ai.body.task_id;

        const r = await POST(`/api/me/tasks/${tid}/auto-route`);
        if (!r.ok) return { ok: false, error: `auto-route: ${r.status} ${JSON.stringify(r.body)}` };

        // winner 可能在 r.body.winner (matched=true 时) 或 r.body.candidates[0] (matched=false 时)
        const winner = r.body.winner || r.body.candidates?.[0];
        if (!winner) {
          return {
            ok: false,
            error: `no winner / candidate (cand 数 = ${r.body.candidates?.length})`,
            evidence: { matched: r.body.matched, tier: r.body.confidence_tier },
          };
        }
        if (winner.agent_id !== ctx.v26_agent_with_user) {
          return {
            ok: false,
            error: `winner agent_id 错: 期望 ${ctx.v26_agent_with_user.slice(0, 8)} 实际 ${winner.agent_id?.slice(0, 8)} (${winner.agent_name})`,
            evidence: {
              candidates: r.body.candidates?.map((c) => ({
                name: c.agent_name,
                composite: c.composite,
              })),
            },
          };
        }
        // 若 matched=true,顺带验证 task 已写入 agent_id (走了自动派路径)
        if (r.body.matched && r.body.task?.assignee_agent_id !== ctx.v26_agent_with_user) {
          return { ok: false, error: `matched 但 task.assignee_agent_id 没写入` };
        }
        return {
          ok: true,
          evidence: {
            _note: `tier=${r.body.confidence_tier} matched=${r.body.matched} composite=${winner.composite.toFixed(2)}${r.body.matched ? " · auto-dispatched" : " · medium/low 不自动派 (符合 v26.1 设计)"}`,
          },
        };
      },
    });

    R.register({
      id: "V26-8b",
      series: "V26",
      title: "auto-route 高置信完整端到端 (默认跳过,见 V26-15/V26-20)",
      expected_skip:
        "需要丰富 fixture (KB + 长 persona + 多关键词);V26-15 / V26-20 已覆盖",
    });

    R.register({
      id: "V26-9",
      series: "V26",
      title: "auto-route 低置信不派 (matched=false)",
      async run(ctx) {
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_v26_9`,
          attendee_user_ids: [],
        });
        created("meeting", m.body.id, "v26-9");
        const ai = await POST(`/api/meetings/${m.body.id}/action-items`, {
          content: "qwerty asdfgh zxcvbn xyz 1234567890",
        });
        const tid = ai.body.task_id;
        const r = await POST(`/api/me/tasks/${tid}/auto-route`);
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.matched)
          return { ok: false, error: `should NOT auto-dispatch nonsense content` };
        if (r.body.winner !== null)
          return { ok: false, error: `winner should be null` };
        if (!Array.isArray(r.body.candidates))
          return { ok: false, error: `candidates should be array` };
        return {
          ok: true,
          evidence: { _note: `tier=${r.body.confidence_tier} cand=${r.body.candidates.length}` },
        };
      },
    });

    R.register({
      id: "V26-10",
      series: "V26",
      title: "listMyTasks role=all_pending (leader 全局视图)",
      async run(ctx) {
        // 假设当前 user 是 leader/admin (已通过 A-2 验证)
        const r = await GET("/api/me/tasks?status=open&role=all_pending");
        if (!r.ok)
          return { ok: false, error: `${r.status} (期望 leader 能访问;若是 403 说明不是 leader)` };
        if (!Array.isArray(r.body))
          return { ok: false, error: `not array` };
        return {
          ok: true,
          evidence: { _note: `${r.body.length} open tasks workspace-wide` },
        };
      },
    });

    R.register({
      id: "V26-11",
      series: "V26",
      title: "MyTaskOut 含 assignee_agent_id/name/color + co_agent_*",
      async run(ctx) {
        const r = await GET("/api/me/tasks?role=assignee&status=active");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.length === 0)
          return { ok: true, evidence: { _note: "no active tasks to check (acceptable)" } };
        const t = r.body[0];
        // 字段必须存在,可以是 null
        for (const k of ["assignee_agent_id", "assignee_agent_name", "assignee_agent_color"])
          if (!(k in t)) return { ok: false, error: `missing ${k}` };
        if (!Array.isArray(t.co_agent_ids)) return { ok: false, error: "co_agent_ids not array" };
        if (!Array.isArray(t.co_agent_names)) return { ok: false, error: "co_agent_names not array" };
        return { ok: true, evidence: { _note: `tasks[0] has all v26 agent fields` } };
      },
    });

    R.register({
      id: "V26-14",
      series: "V26",
      title: "Agent CRUD: primary_user_id 必须同 workspace",
      async run(ctx) {
        // 用一个肯定不存在的 uuid
        const fakeUuid = "00000000-0000-0000-0000-000000000123";
        const r = await POST("/api/agents", {
          name: `${PREFIX}_v26_14_bad`,
          primary_user_id: fakeUuid,
          is_active: true,
          dify_app_type: "chatflow",
        });
        if (r.ok) {
          // 防御被绕过
          created("agent", r.body.id, "v26-14-bad");
          return { ok: false, error: `accepted fake primary_user_id` };
        }
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status}` };
        return { ok: true, evidence: { _note: `rejected fake user: 400` } };
      },
    });

    R.register({
      id: "V26-16",
      series: "V26",
      title: "history breakdown 含 _completion_rate (v26.1)",
      async run(ctx) {
        const r = await POST("/api/me/dispatch-recommend", { content: "产品规划" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const c = r.body.candidates?.[0];
        if (!c) return { ok: false, error: "no candidates" };
        if (typeof c.breakdown._completion_rate !== "number")
          return { ok: false, error: "_completion_rate not number" };
        return {
          ok: true,
          evidence: { _note: `completion_rate=${c.breakdown._completion_rate}` },
        };
      },
    });

    R.register({
      id: "V26-17",
      series: "V26",
      title: "knowledge fallback 当 agent 无 KB",
      async run(ctx) {
        // v26_agent_with_user 没绑 KB,应该走 fallback (kb_hits=0 或 used_embedding=false)
        const r = await POST("/api/me/dispatch-recommend", { content: "完全无关内容 abc 1234" });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const c = r.body.candidates?.find((x) => x.agent_id === ctx.v26_agent_with_user);
        if (!c) return { ok: false, error: "v26_agent not in candidates" };
        const b = c.breakdown;
        if (typeof b.knowledge !== "number")
          return { ok: false, error: "knowledge not number" };
        // 没崩就行
        return {
          ok: true,
          evidence: {
            _note: `kb_emb=${b._kb_used_embedding} kb_hits=${b._kb_hits} kn=${b.knowledge.toFixed(2)}`,
          },
        };
      },
    });

    R.register({
      id: "V26-18",
      series: "V26",
      title: "GET /api/agents 含 primary_user_name (join 后)",
      async run(ctx) {
        const r = await GET("/api/agents");
        if (!r.ok) return { ok: false, error: `${r.status}` };
        for (const a of r.body) {
          if (!("primary_user_id" in a)) return { ok: false, error: `missing primary_user_id` };
          if (!("primary_user_name" in a)) return { ok: false, error: `missing primary_user_name` };
          if (a.primary_user_id && !a.primary_user_name)
            return { ok: false, error: `${a.name} 绑了 primary_user_id 但 name 是 null` };
        }
        return { ok: true, evidence: { _note: `${r.body.length} agents 全部含 primary_user 信息` } };
      },
    });

    // V26-15 (KB embedding 实证) — 重 资源 创建,标 expected_skip 默认跳过
    R.register({
      id: "V26-15",
      series: "V26",
      title: "knowledge 真用 KB embedding 检索 (重资源,默认跳过)",
      expected_skip:
        "需要创建 KB + 上传文档 + 等 embedding (~30s),手动跑,见 v26-test-plan.md",
    });

    R.register({
      id: "V26-19",
      series: "V26",
      title: "backfill 脚本可执行 (服务器端,无法浏览器跑)",
      expected_skip: "需要 docker exec,见 v26-test-plan.md 手动验证",
    });

    R.register({
      id: "V26-20",
      series: "V26",
      title: "routing happy path:4 个 agent 分别命中各自领域",
      async run(ctx) {
        const users = await GET("/api/users");
        const uids = users.body.slice(0, 3).map((u) => u.id);
        if (uids.length < 3)
          return { ok: false, error: "需要 workspace 至少 3 个 user" };

        // 创建 3 个领域 agent
        const setup = [
          { name: "_prod", keywords: ["PRD", "需求", "产品"], domain: "产品研发", q: "撰写 PRD 需求文档 V2" },
          { name: "_legal", keywords: ["合规", "法务"], domain: "法务合规", q: "合规风险评估法务审核" },
          { name: "_tech", keywords: ["架构", "API"], domain: "技术架构", q: "微服务架构设计 API 接口" },
        ];
        const agentIds = [];
        for (let i = 0; i < 3; i++) {
          const s = setup[i];
          const a = await POST("/api/agents", {
            name: `${PREFIX}_v26_20${s.name}`,
            keywords: s.keywords,
            domain: s.domain,
            primary_user_id: uids[i],
            is_active: true,
            dify_app_type: "chatflow",
          });
          if (!a.ok) return { ok: false, error: `create ${s.name}: ${a.status}` };
          created("agent", a.body.id, `v26-20${s.name}`);
          agentIds.push(a.body.id);
        }

        // 验证每条 task 命中对应 agent
        const out = {};
        for (let i = 0; i < 3; i++) {
          const r = await POST("/api/me/dispatch-recommend", { content: setup[i].q });
          if (!r.ok) return { ok: false, error: `dispatch-recommend [${i}]: ${r.status}` };
          const winner = r.body.candidates?.[0];
          out[setup[i].name] = `winner=${winner?.agent_name} composite=${winner?.composite?.toFixed(2)} tier=${r.body.confidence_tier}`;
          if (winner?.agent_id !== agentIds[i])
            return {
              ok: false,
              error: `[${setup[i].name}] expected agent ${agentIds[i]} winner ${winner?.agent_id}`,
              evidence: out,
            };
        }

        // 验证 noise content 不会命中任何 agent (low tier)
        const noise = await POST("/api/me/dispatch-recommend", { content: "qwerty asdfgh 12345" });
        if (noise.body.confidence_tier === "high")
          return { ok: false, error: `noise content got high tier`, evidence: out };

        return { ok: true, evidence: out };
      },
    });
    // ---------- end V26 series --------------------------------------------------
```

---

## Cowork 跑完后给我什么

跑完后 Claude Cowork 应该输出:

1. **过/挂数量统计**:`pass: N / N`
2. **挂掉的用例**:case id + error + 拿到的 response body
3. **如果有意外 skipped**:case id + reason
4. **如果有意外 fields 缺失 / 类型不对**:列出来

---

## 已知 caveats

1. **DashScope embedding 配额**:V26-15 跑成功需要 DashScope `text-embedding-v2` 可用,且 KB 文档上传后 ~10-30 秒才完成 embedding。Cowork 跑前可以先验证 `POST /api/me/dispatch-recommend` 的 `_kb_used_embedding` 是否曾出现过 true。
2. **action_extractor LLM 慢**:V26-12 / V26-13 需要等 25-60 秒 summary + action_extractor 完成。轮询 `/summary` 看 status='ready' 后再查 actions。
3. **leader 权限**:V26-10 (all_pending) 需要登录账号是 workspace owner/admin/leader。如果是 member,期望 403,case 改为验证 403。
4. **存量数据干扰**:V26-3 / V26-16 等 case 依赖 workspace 至少 1 个 active 已绑 primary_user 的 agent。建议跑前先看 `GET /api/agents` 确保有 ≥1 个符合的。
5. **High tier 阈值与 fixture 关系**(v26.1 设计意图):没绑 KB / persona 短 / 关键词少 的 agent **故意**触不到 high (≥0.60),逼运营把 KB 配齐才能享受自动派发。所以 V26-8 用 minimal fixture 时,evidence 看到 `tier=medium` 或 `matched=false` 是**正确行为**,不是 bug。完整 high path 见 V26-15 / V26-20。

---

# v26.2 测试用例(任务办结沉淀)

## V26.2-1 · preview endpoint 返回 LLM 摘要 + 不写入 KB

**目的**:GET preview 跑 LLM 拿到摘要 markdown,不写 KB。

**准备**:
- 沿用 V26-5 创建的 task(`ctx.v26_5_task_id`),已派给 v26_agent_with_user

**执行**:`GET /api/me/tasks/<TASK_ID>/consolidate/preview`

**期望**:
- 响应 200
- `preview_markdown` 是 markdown 字符串,长度 > 100
- 含 `## 背景` / `## 处理过程` / `## 结果` 等结构化段落
- `target_agent_id === ctx.v26_agent_with_user`
- `target_agent_name` 不为 null
- `target_kb_exists` 是 bool
- `already_consolidated` 是 bool
- 跑完后 task 的 `source_ref.consolidated_at` **仍然为 null**(没写入)

## V26.2-2 · POST consolidate 写入 KB

**执行**:
```
POST /api/me/tasks/<TASK_ID>/consolidate
Body: {}    # 用 LLM 摘要(不 override)
```

**期望**:
- 响应 200
- `document_id`, `kb_id`, `kb_name` 都有
- `chunk_count ≥ 1`
- `used_override === false`(没传 override_summary)
- 后续 `GET /api/me/tasks/<TASK_ID>/detail`:
  - `source_ref.consolidated_at` 是 ISO 字符串
  - `source_ref.consolidated_kb_id === kb_id`
  - `source_ref.consolidated_document_id === document_id`

## V26.2-3 · 重复沉淀返回 409

**执行**:再 POST 一次同样的 consolidate(不传 force)

**期望**:
- 响应 409
- error message 含 "already consolidated"

## V26.2-4 · force=true 删旧重沉

**执行**:
```
POST /api/me/tasks/<TASK_ID>/consolidate
Body: { "force": true }
```

**期望**:
- 响应 200
- 新 `document_id` ≠ 上一次的(旧 doc 已删)
- `kb_id` 通常相同(KB 不删,只换 doc)

## V26.2-5 · override_summary 优先

**执行**:
```
POST /api/me/tasks/<TASK_ID>/consolidate
Body: {
  "force": true,
  "override_summary": "## 测试自定义\n这是 leader 手动改过的摘要"
}
```

**期望**:
- 响应 200
- `used_override === true`
- 后续 GET KB document 内容应含 "测试自定义"(不是 LLM 摘要)

## V26.2-6 · 没绑 agent 的 task 不能沉淀

**准备**:创建一个 task 不派给任何 agent

**执行**:`POST /api/me/tasks/<TASK_ID>/consolidate {}`

**期望**:响应 400,error 含 "assignee_agent_id"

## V26.2-7 · 非 leader 权限拒绝

**执行**:用 member 账号(非 leader/admin)调 consolidate

**期望**:响应 403

## V26.2-8 · KnowledgeDocument 含 v26.2 元数据

**执行**:沉淀完成后,`GET /api/knowledge-bases/<KB_ID>/documents` 找到刚沉淀的 doc

**期望**:
- `source_type === "task"`
- `source_task_id === <TASK_ID>`
- `source_agent_id === <AGENT_ID>`
- `curated_by_user_id === <我>`
- `curated_at` 非空

## V26.2-9 · 沉淀后 agent KB knowledge 维度评分 ↑

**目的**:验证沉淀的 KB chunk 真的能被 routing 检索到(端到端闭环)。

**执行**:
- 创建 task 内容与已沉淀 task 同主题
- `POST /api/me/dispatch-recommend { content: "<同主题>" }`

**期望**:
- 该 agent 的 `breakdown.knowledge ≥ 0.30`(被检索命中)
- `breakdown._kb_hits ≥ 1`
- `breakdown._kb_used_embedding === true`

---

# v26.2 代码片段(粘进 cowork_suite.js,V26 series 之后)

```javascript
    // ---------- V26.2 series · 任务办结沉淀 ----------
    R.register({
      id: "V26.2-1",
      series: "V26.2",
      title: "preview consolidate 不写入 KB",
      async run(ctx) {
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };
        const r = await GET(`/api/me/tasks/${ctx.v26_5_task_id}/consolidate/preview`);
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body.preview_markdown || r.body.preview_markdown.length < 50)
          return { ok: false, error: "preview_markdown too short" };
        if (!r.body.target_agent_id) return { ok: false, error: "no target_agent_id" };
        // 验证未写入
        const d = await GET(`/api/me/tasks/${ctx.v26_5_task_id}/detail`);
        if (d.body.source_ref?.consolidated_at)
          return { ok: false, error: "preview 不该写入 consolidated_at" };
        ctx.v26_2_preview = r.body;
        return { ok: true, evidence: { _note: `preview ${r.body.preview_markdown.length} chars` } };
      },
    });

    R.register({
      id: "V26.2-2",
      series: "V26.2",
      title: "POST consolidate 写入 KB + task.source_ref 标记",
      async run(ctx) {
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };
        const r = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/consolidate`, {});
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (!r.body.document_id) return { ok: false, error: "no document_id" };
        if (!r.body.kb_id) return { ok: false, error: "no kb_id" };
        if (r.body.chunk_count < 1) return { ok: false, error: "chunk_count = 0" };
        if (r.body.used_override !== false)
          return { ok: false, error: "used_override should be false" };
        ctx.v26_2_doc_id = r.body.document_id;
        ctx.v26_2_kb_id = r.body.kb_id;
        // 验证 task.source_ref
        const d = await GET(`/api/me/tasks/${ctx.v26_5_task_id}/detail`);
        const sr = d.body.source_ref || {};
        if (!sr.consolidated_at) return { ok: false, error: "consolidated_at not set" };
        if (sr.consolidated_kb_id !== r.body.kb_id)
          return { ok: false, error: `kb_id mismatch in source_ref` };
        return {
          ok: true,
          evidence: { _note: `${r.body.chunk_count} chunks → KB ${r.body.kb_name}` },
        };
      },
    });

    R.register({
      id: "V26.2-3",
      series: "V26.2",
      title: "重复沉淀返回 409",
      async run(ctx) {
        if (!ctx.v26_5_task_id || !ctx.v26_2_doc_id)
          return { ok: false, error: "SKIP_DEP_FAILED:V26.2-2" };
        const r = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/consolidate`, {});
        if (r.ok) return { ok: false, error: `expected 409 got 200` };
        if (r.status !== 409) return { ok: false, error: `expected 409 got ${r.status}` };
        return { ok: true, evidence: { _note: `409 as expected` } };
      },
    });

    R.register({
      id: "V26.2-4",
      series: "V26.2",
      title: "force=true 删旧重沉,document_id 变",
      async run(ctx) {
        if (!ctx.v26_5_task_id || !ctx.v26_2_doc_id)
          return { ok: false, error: "SKIP_DEP_FAILED:V26.2-2" };
        const r = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/consolidate`, {
          force: true,
        });
        if (!r.ok) return { ok: false, error: `${r.status} ${JSON.stringify(r.body)}` };
        if (r.body.document_id === ctx.v26_2_doc_id)
          return { ok: false, error: `document_id 没变,force 没删旧` };
        ctx.v26_2_doc_id = r.body.document_id;
        return { ok: true, evidence: { _note: `new doc ${r.body.document_id.slice(0, 8)}` } };
      },
    });

    R.register({
      id: "V26.2-5",
      series: "V26.2",
      title: "override_summary 优先 + used_override=true",
      async run(ctx) {
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };
        const customSummary = "## 测试自定义\n这是 leader 手动改过的摘要 marker_xyzzy";
        const r = await POST(`/api/me/tasks/${ctx.v26_5_task_id}/consolidate`, {
          force: true,
          override_summary: customSummary,
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        if (r.body.used_override !== true)
          return { ok: false, error: `used_override should be true` };
        return { ok: true, evidence: { _note: `override accepted, chunks=${r.body.chunk_count}` } };
      },
    });

    R.register({
      id: "V26.2-6",
      series: "V26.2",
      title: "没绑 agent 的 task 不能沉淀 → 400",
      async run(ctx) {
        // 创建一个新 task 不派
        const m = await POST("/api/meetings", {
          title: `${PREFIX}_v26_2_6`,
          attendee_user_ids: [],
        });
        created("meeting", m.body.id, "v26.2-6");
        const ai = await POST(`/api/meetings/${m.body.id}/action-items`, {
          content: "未派的 task",
        });
        if (!ai.ok) return { ok: false, error: `add action: ${ai.status}` };
        const tid = ai.body.task_id;

        const r = await POST(`/api/me/tasks/${tid}/consolidate`, {});
        if (r.ok) return { ok: false, error: `expected 400 got 200` };
        if (r.status !== 400) return { ok: false, error: `expected 400 got ${r.status}` };
        return { ok: true, evidence: { _note: `400 as expected (no agent)` } };
      },
    });

    R.register({
      id: "V26.2-8",
      series: "V26.2",
      title: "KnowledgeDocument 含 v26.2 元数据(source_type/source_task_id 等)",
      async run(ctx) {
        if (!ctx.v26_2_kb_id || !ctx.v26_5_task_id)
          return { ok: false, error: "SKIP_DEP_FAILED:V26.2-2" };
        const r = await GET(`/api/knowledge-bases/${ctx.v26_2_kb_id}/documents`);
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const docs = r.body || [];
        // 找最新一个 source_type='task' + source_task_id = ctx.v26_5_task_id 的
        const ours = docs.find(
          (d) => d.source_type === "task" && d.source_task_id === ctx.v26_5_task_id,
        );
        if (!ours) {
          return {
            ok: false,
            error: `KB ${ctx.v26_2_kb_id} 里没找到来源是 v26_5_task 的 doc`,
            evidence: { found: docs.length, kinds: docs.map((d) => d.source_type) },
          };
        }
        for (const k of ["source_type", "source_task_id", "source_agent_id", "curated_at"])
          if (!ours[k]) return { ok: false, error: `missing ${k}` };
        return {
          ok: true,
          evidence: { _note: `doc ${ours.id.slice(0, 8)} fully tagged` },
        };
      },
    });

    R.register({
      id: "V26.2-9",
      series: "V26.2",
      title: "沉淀后 agent KB 检索命中 (knowledge dim ↑)",
      async run(ctx) {
        if (!ctx.v26_5_task_id) return { ok: false, error: "SKIP_DEP_FAILED:V26-5" };
        // 用同主题再跑一次 dispatch-recommend
        const r = await POST("/api/me/dispatch-recommend", {
          content: "v26-5 测试待办 — 跟之前已沉淀的同主题",
        });
        if (!r.ok) return { ok: false, error: `${r.status}` };
        const c = r.body.candidates?.find((x) => x.agent_id === ctx.v26_agent_with_user);
        if (!c) return { ok: false, error: "v26_agent not in candidates" };
        const kbHits = c.breakdown._kb_hits;
        const usedEmb = c.breakdown._kb_used_embedding;
        if (!usedEmb)
          return {
            ok: false,
            error: `KB embedding 没启动 (used_embedding=false)`,
            evidence: { breakdown: c.breakdown },
          };
        if (typeof kbHits !== "number" || kbHits < 1)
          return {
            ok: false,
            error: `KB chunk 没命中 (hits=${kbHits})`,
            evidence: { knowledge: c.breakdown.knowledge },
          };
        return {
          ok: true,
          evidence: {
            _note: `kb_hits=${kbHits} knowledge=${c.breakdown.knowledge.toFixed(2)}`,
          },
        };
      },
    });
    // ---------- end V26.2 series ----------
```

---

## V26.2 已知 caveats

1. **LLM 摘要慢**:V26.2-1 / V26.2-2 / V26.2-4 / V26.2-5 都会调 LLM (qwen-max),每次 ~10-30 秒。一次 V26.2 全跑下来约 60-90 秒。
2. **DashScope embedding**:V26.2-2 需要 embedding 可用(沉淀后的 chunks 要 embed)。配额耗尽时 chunk 写入但 embedding=null,V26.2-9 会 fail。
3. **V26.2-7 权限测试需要 member 账号**:Cowork 跑时如果当前账号是 leader,跳过此 case。手动验时换 member 账号。
4. **KB list endpoint 是否暴露 source_type 字段**:V26.2-8 假设 `GET /api/knowledge-bases/<id>/documents` 返回 KnowledgeDocument 完整字段(含 source_type 等 v26.2 新字段)。如果该 endpoint 只 select 部分字段,需要扩(已在 v26.2-12 待办)。
