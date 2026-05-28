# phase-d-14-agentic · NEW-D AI agentic 自主跑任务

> 状态: ⏸️ V1.5 推迟 (等 MVP 客户反馈)
> 估时: 5-7d 高风险
> 依赖: Phase C 验收 全 GREEN + 客户 内测 反馈 ≥1 周
> 触发条件: PM 拍 V1.5 启动 (基于客户反馈 优先级排序)
> 对应 NORTH_STAR: § 3.4 + § 6.4 (痛点 8)

---

## 1. 背景

**痛点 8** (NORTH_STAR § 1.4): "任务无人跑 — AI 列出 action items 后, 没人 真实 执行, 沉淀 变 死档."

NEW-D = AI agentic 自主 跑 task — 类 OpenClaude / Anthropic agentic. AI 不只 列 任务, 还 真 调 工具 (邮件 / 日历 / Outlook / Notion / 内部 API) 替 用户 干. 客户 体感: "AI 真替我干活" — 差异化 卖点.

PM 拍 推迟到 V1.5 — 高风险 + 5-7d, 不 阻塞 MVP. 拿 MVP 给 客户 测, 反馈驱动 启动 顺序.

## 2. 目标

AI 专家 在 action_item 抽出 后, 能 在 严格 沙箱 内 调用 ≥1 外部工具 (邮件 / 日历 简单 first) 替 用户 完成 task. 失败 → 标 retry / human review.

## 3. 范围 (V1.5 启动 时 再 细化)

### 3.1 in scope (启动 时 拍)
- backend `agent_router.py` 加 tool calling layer (类 Anthropic claude tool use spec)
- 工具 沙箱: 邮件 send (走 邮件 provider) / 日历 create (Outlook / Google) / Notion page create
- 任务 状态 流: pending → in_progress → done / failed / human_review
- 失败 重试: ≤3 次 (exponential backoff)
- audit log: 每 tool call 全 写 audit (NORTH_STAR § 5)

### 3.2 out of scope (V1.5 第一版)
- 调内部 SaaS API (留 V1.6)
- 多 tool chain (eg "发邮件 → 收到回复 → 再 写日历") — V1.6
- 用户 自定义 tool (留 V2)

## 4. 实施 路径 (V1.5 启动 时 拍)

1. **PM 选 first tool** (邮件 / 日历 / Notion 哪个 客户 痛 最大)
2. **backend tool layer**:
   - 加 `agent_tool_call` 表 (audit + status)
   - 加 `app/agent_tools.py` 抽象 (每 tool 一 class, 走 LLM tool use)
   - 加 endpoint `POST /api/agent-tasks/<task_id>/run` 触发 tool 执行
3. **frontend**:
   - Mobile + Web task 列表 加 "🤖 AI 在跑" indicator
   - 失败 → "需要 你确认" CTA
4. **沙箱 严格** — 任何 tool call 必须 写 audit + 用户 可 撤销
5. **5-7d 跨度** — 分 2-3 sub-saga (tool layer / first tool / UI), 每 sub-saga 必 出 Kimi 用例

## 5. 验收 (V1.5 启动 时 细化)

- Kimi 用例: AI 抽 action_item → 调 first tool → done → 用户 看到 状态 → 撤销 也通
- 客户 demo: 演示 1 个 完整 "AI 替我 干" 闭环

## 6. 风险 / 已知 坑

- **沙箱 边界** — tool 调用 失败 / 死循环 / 滥发邮件 = 真灾难. 必须 audit + 限速 + 人工 confirm
- **5-7d 估时 偏乐观** — Anthropic agentic 自己 都 还 迭代. 真做 可能 10d+
- **Phase A/B/C 不 受 影响** — NEW-D 是 V1.5 独立 saga
- **测试 隔离** — 测试 时 不允许 真 发邮件 / 真 改日历 → 用 mock tool / sandbox env

## 7. 触发 出物 (V1.5 启动 时)

- ≥3 commit (tool layer / first tool / UI)
- ≥3 Kimi 用例
- backend audit 表 + 沙箱 验
- 客户 demo 视频 / 截图

---

> **当前 不要 开干** — 等 Phase C GREEN + 客户内测反馈. PM 决定 启动 时机.
