# Changelog · Aimeeting

> 倒序排列(最新在上).每个里程碑给一段 60-200 字的"做了什么 + 为什么".
> 详细 commit 见 `git log`,详细设计见 `docs/v26.3-spec.md` 等。

---

## v26.4 · Platform Admin · 多租户运营 SaaS 平台层 (2026-05-13 GA)

让"乙方运营"角色拥有跨 workspace 的"上帝视角" — 一个邮箱(env 白名单)能看到所有租户 workspace + 一键代客建空间 + 切换进任意 workspace 看 / 改 / 排查问题。把 Aimeeting 从"单租户工具"升级成"可对外授权运营的 SaaS 平台"。

### 主要新东西

- **`PLATFORM_ADMIN_EMAILS`** env(逗号分隔多个邮箱)= 平台超管白名单,不入库
- **`/super` 控制台**:红色 banner + 跨租户 workspace 列表(含 user/agent/meeting 计数 + 状态 + 最后活跃)+ ➕ 创建表单 + "进入 →" 切换
- **代客建空间** 一键产出 3 件凭证:owner 邮箱 + 32 位临时密码 + 一次性邀请链接(7 天有效),复制 微信发给客户即可
- **跨 workspace 切换**:重发 JWT 把 wsid 改成目标 ws + set-cookie,所有现有 `/api/*` endpoint 自动用新 ws,无需新建一套镜像 API
- **审计透明**:所有超管操作的 audit_log payload 自动加 `platform_admin: true` + email,客户在自己 workspace 的操作日志里能完整看到"平台运营今天来过、做了什么"
- **顶栏 ⚡ 入口**:仅 platform admin 可见,身份不随 workspace 切换丢失(基于 email 判定)

### v26.4-fix1 修补(同日)

Platform admin 切到客户 workspace 时,在该 ws 里没 membership 行 → 旧逻辑返 `role="member"` → 所有 `require_leader_or_admin` 端点 403 → 用户视角看到大量 toast.warn。修法:`is_leader_or_admin` 对 platform admin 直接 short-circuit return True;`/api/auth/me` 在 membership 缺失 + caller is platform admin 时 fallback effective_role="owner";前端 super* wrapper 全加 silent 不弹 toast。**不污染客户 user 列表**(不 insert membership 行)。

### 数据模型变更

- `Workspace.status` (active / suspended / archived) + `last_active_at` 字段
- `audit_log` 钩子:platform admin 操作自动打 flag + 顺手更新 `workspace.last_active_at`

### 决策落地(Q1–Q5)

| Q | 决策 |
|---|---|
| Q1 超管身份载体 | C · env var,不入库 |
| Q2 审计 + 隔离 | guard 后端 + middleware 前端,所有写操作 audit |
| Q3 切换语义 | C · 真切换(重发 JWT)+ audit "via superadmin" |
| Q4 数据可见性 | 列表 + 计数 + 状态(写-heavy 留 v26.5) |
| Q5 能做什么 | read + write-light + write-medium |

### 部署 gotcha

`PLATFORM_ADMIN_EMAILS` env 改完后**必须** `docker compose up -d --force-recreate backend`,**不能用** `restart`(后者不重读 env_file)。`backend/.env.example` 已带模板 + 注释警告。

### 未做(留 v26.5)

- workspace suspend / archive / delete(超管 write-heavy)
- 跨 workspace 批量推送 agent / KB 模板
- 计费 / 配额 / LLM 用量 dashboard
- 邮件自动发 invite_url(目前手动复制)

---

## v26.3.1 · ABAC 补丁(角色权限严格化) (2026-05-13)

v26.3 GA 后发现 5 个 ABAC 缺口:v26.3 召集人模式的写端点只做了 workspace 隔离,没接 v25 已经搭好的角色权限。本批补:`POST /api/meetings mode='auto'` + `POST /orchestrate/{start,pause,resume,cancel}` 全部加 `require_leader_or_admin`;前端首页 mode radio / 详情页 banner / orchestrate 控制台 写控件 全部 role-aware(expert/member 看 disabled + 🔒 + 只读视图);所有控件加 `data-testid` 给 Kimi 自动化用。Kimi 12 用例三角色 × 5 动作矩阵 全 GREEN。

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
