# Changelog · Aimeeting

> 倒序排列(最新在上).每个里程碑给一段 60-200 字的"做了什么 + 为什么".
> 详细 commit 见 `git log`,详细设计见 `docs/v26.3-spec.md` 等。

---

## v26.3 · 召集人模式 · 全 AI 自主会议 (2026-05-13 GA)

让"召集人"这个角色从"主持人"退到"裁决者" — 会议由 moderator AI + N 个 expert AI 自动开,议程逐项跑,有共识落库,有分歧会后批量等召集人 4 选 1 + 写理由裁决。裁决决议自动沉淀回涉及 AI 专家的知识库,下次类似议题 AI 自动调用本次裁决思路 — 真的把会议系统从"工具"升级成"决策助手"。

### 主要新东西

- **召集人模式**(`mode='auto'`):3 种会议模式中新增第三种;创建会议时召集人定议题 + 选 ≥ 3 AI 专家,系统自动跑;不需要人主持
- **45 分钟硬上限**(`MAX_MEETING_SECONDS`):整场 running 累计 ≥ 45 分钟触发软完成;**paused 时间不算**(Q8=B);已完成议程的共识全保留 + 触发 summary + action_extractor 链
- **会后批量裁决**(Q3=D):分歧不打断会议;`POST /api/meetings/{id}/consensus/{idx}/review` 每分歧 4 选 1(采纳 A / B / 折衷 / 搁置)+ 必填理由 ≥ 10 字
- **裁决沉淀回 KB**:LLM 二次生成 4 段 markdown(背景 / 立场对比 / 裁决 / 给未来类似议题的提醒)+ 模板兜底 → `KnowledgeDocument(source_type='consensus_dissent')` 写入 dissent.involved_agents 全部 expert 的 KB
- **Orchestrate 控制台**(`/meeting/{id}/orchestrate`):2.5s 轮询;phase 徽章 + 议程进度 + AI 发言流(按 agenda_idx 分组,reply_to → #N 链)+ 控制按钮(启动 / 暂停 / 恢复 / 取消);⏱ X:XX / 45:00 计时器三档色
- **DissentReviewModal**:终态时 banner 点开 → 列待裁决议程 → 4 radio + textarea(≥10 字)+ 已裁决折叠
- **详情页适配**:`mode='auto'` 时顶部 banner(pending 紫色按钮 ⚖️ 立即裁决,无 pending 琥珀通用链)

### 数据模型变更

- `Meeting.mode` (enum: human/hybrid/auto)+ `auto_state` (JSONB)
- `MeetingConsensus` 新表(UNIQUE meeting_id+agenda_idx,dissents JSON,review_decision)
- `MeetingAgentMessage.reply_to_agent_message_id` + `agenda_idx`
- `auto_state.running_started_at` + `paused_running_seconds` (paused 不算的时长追踪)

### 工程亮点

- **状态机**:7 phase(idle/running/paused/consensus_wait/done/failed/cancelled)× 9 action(start/pause/resume/dissent_wait/dissent_resolve/complete/timeout/fail/cancel),10/10 单元测试 PASS
- **prompt 工程**:5 个 prompt(moderator system/intro/wrap-up/adequacy + agent reply + consensus collector)经 v26.3-01 两轮校准,0 误判分歧 + 3/3 真分歧识别
- **反幻觉**:`extract_and_store_actions(mode='auto')` 跳过"AI 发言不算依据"规则 + 用 summary 替代 transcript 抽 task
- **lifespan resume**:backend 重启时自动扫 phase=running 的 meeting 接着跑

### 测试覆盖

- 浏览器自测 suite:V26.3 系列 7 个 case(创建 / 校验 / state shape / cancel / review 错路径)
- Kimi 反幻觉用例:`v26.3-05-kimi.md`(11 用例)/ `v26.3-07-kimi.md`(10 用例)/ `v26.3-08-kimi.md`(6 用例)
- 端到端 e2e:`scripts/test_auto_meeting_e2e.py` + `scripts/test_consensus_consolidator.py`

### 决策落地(9 个 Q&A)

| Q | 决策 |
|---|---|
| Q1 决议形态 | A · 4 选 1 + 必填 rationale ≥ 10 字 |
| Q2 沉淀范围 | A · involved_agents 全部 expert |
| Q3 沉淀内容形态 | C · LLM 4 段 + 模板兜底 |
| Q4 重跑 action | B · 不重跑 |
| Q5 裁决权限 | A 实操化为 owner/admin/leader 三角色 |
| Q6 超时形态 | B · 软 COMPLETE,保留已跑议程 |
| Q7 可配性 | A · 全局常量 `MAX_MEETING_SECONDS=2700` |
| Q8 paused 算不算 | B · 不算,running 累计 |
| Q9 前端显示 | A · 已用 / 上限 + 颜色三档 |

详见 `docs/v26.3-p0-tasks.md`。

### 已知未实现(留 v26.3.1+)

- WebSocket 实时推送(当前 2.5s 轮询;v26.3-04 deferred)
- KB 引用侧栏(citations 已落数据,UI 未做)
- 跳过议程按钮(spec 提了,未做)
- per-meeting `max_total_seconds` 配置(当前全局常量)
- 已裁决议程改判(当前返 409 不支持改)

---

## v26.2 · 任务办结 → AI 专家 KB 自动沉淀 (2026-05-11)

任务办结时(`status=done`)自动调 LLM 生成 4 段闭环档案(背景 / 处理过程 / 结果 / 关键洞察),embedding 后写入主责 AI 专家的知识库。让 AI 真在"学" — 下次类似任务来时,KB 检索能调出"上次类似情况是这样处理的"。

---

## v26.1 · KB embedding 真正接路由 (2026-05-11)

5 维 routing 中的 knowledge 维度(权重 0.35)从早期占位实现升级为真 KB embedding cosine distance 检索(top-5 chunks,max_distance=0.55)。同时 history 维度加完成率因子("做过但做砸"不算高分,避免反向激励)。

---

## v26.0 · Agent-centric 派发 (2026-05-11)

派发模型从 user-centric 切到 agent-centric:Task.assignee_agent_id 是主责 AI 专家(主),Agent.primary_user_id 指向的 user 是执行代理(辅)。这把"会议系统是面向 AI 集群,人是手脚"这件事在数据模型层落地。

---

## v25 · 业务闭环 + 客户验收 (2026-05-10)

任务实录依据(evidence_quote 锚点回跳)+ AI 流转(智能返回)+ 全局重置 + 反幻觉纪要 + 关键 bug 修复。是 v26 系列前的最后一个稳定大版本,直接面对客户验收。

---

## v17 – v24 · 真人会议主链路

实时 ASR + 声纹识别 + 异步贴姓名 + M3.0 AI 旁听 + 5 级数据分级 + ABAC + 跨 AI 审批 + 操作审计 + Sentry 监控 + LLM 配额。这一段从 0 到 1 把"AI Agent 参会的会议系统"做出来了。

详细 commit 见 git log。
