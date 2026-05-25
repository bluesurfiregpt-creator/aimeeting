# aimeeting · NORTH_STAR (产品宪法 v1)

> **版本**: v1.0
> **生效日期**: 2026-05-25
> **来源**: PM 7 问对齐 + 4 处分散意图合并升级 (`docs/product-needs-v1.md` + `docs/v26.3-spec.md` + `docs/v26.5-role-redesign-spec.md` + `README.md`)
> **演进机制**: 每个 Saga 收尾时反思, 由 PM 决策升级版本 (见第 9 节)
> **本文档是产品 truth source** — 任何 Saga changelist / spec 必须先对齐 NORTH_STAR, 不一致以 NORTH_STAR 为准.

---

## 0. TL;DR (一页扫读)

1. **产品定位**: 面向 **中国政企** 的 **AI Agent 协作会议工作台**. AI 专家**有长期记忆**, 会议结论沉淀回知识库, AI 协助完成**会后任务**.
2. **用户**: AI 专家(expert)是虚拟实体, 不是真人; 真人用户分 **4 个权限层级** — owner / leader / admin / member.
3. **核心差异**: 不是会议录音工具, 是有"组织决策记忆 + AI 任务执行"闭环的 SaaS 系统; **AI 五大能力**是产品灵魂(记忆/知识/数据/任务执行/会议表现).
4. **架构**: multi-tenant SaaS, **每个 workspace 完全独立**(logo / 名称 / 用户 / 声纹 / AI 专家 / 数据), 不硬编码客户专属逻辑.
5. **三端**: Web 全功能(含独占编辑) + 小程序原生(只查看 + 发起会议) + H5 (vibe coding 阶段测试用, 终态翻译到小程序).
6. **当前阶段**: 收尾 round-4 Saga A (主 tab 浅色化), 启动 **Saga E (AI 专家核心能力补齐)** → 暂停 Saga B/C/D.
7. **不做清单**: dark mode / 客户专属硬编码 / 小程序编辑 / 一次性大改 / mock 假装真实.

---

## 1. 产品定位

### 1.1 一句话

> **面向中国政企的 AI Agent 协作会议工作台. AI 专家能有长期记忆, 会议结论沉淀回知识库, 并能协助完成会后任务.**
>
> _(来源: PM Q1 升级版, 取代 `README.md` 老一句话 + `product-needs-v1.md` 一句话)_

### 1.2 三层价值

按"产品差异化 → 离开就走不掉"的顺序排:

1. **AI 专家有长期记忆 + 跨会议延续** — 不是一次性助手, 是有上下文的同事. 三个月前那场会的结论, 这次开会 AI 自动调出来 (`product-needs-v1.md` § 2.2).
2. **会议结论沉淀回知识库** — 一年开 200 场会, 不再"讨论过但忘了在哪". 三层金字塔 (快照 → 待审 → 记忆库), AI 筛 90% + 人拍板 (`product-needs-v1.md` § 2.1).
3. **AI 协助完成会后任务** — 决策完不止"派任务", AI 真正执行: 任务办结 → 自动沉淀回 AI KB → 下次类似任务调出"上次怎么处理" (v26.2 task_consolidator + v26.5-Lineage).

### 1.3 跟同类产品的差异

| 同类品类 | 同类做的 | aimeeting 多做的 |
|---|---|---|
| **腾讯会议 / 飞书妙记** | 录音 + 转录 + 纪要 | 多 AI 专家发言 + 知识库沉淀 + 任务派发 + 召集人模式(全 AI 自主) |
| **ChatGPT / Claude** | 1v1 私聊 | N 个 AI 在一场会里相互讨论 + 综合输出 + 召唤新 AI |
| **政务工单系统** | 工单流转 + 派人 | "组织决策 + 知识沉淀 + 数据 5 级 ABAC" 收在一起, 从工具走向决策助手 |

_(反推自 `docs/PRODUCT_OVERVIEW.md` § 1.2 + `docs/product-needs-v1.md` 主题一-四, 不硬猜)_

---

## 2. 用户与角色

### 2.1 AI Agent (expert) — 产品灵魂

> **expert = AI Agent 专家** (Aria / Stratos / Mira 等), 是 **虚拟实体**, 不是真人用户. 5 个核心能力见第 3 节.

- **moderator AI** (内置, Mira): 每个 workspace 一个, 不可删, 不接 task. 负责会议秩序 + 议程推进 + 共识收敛.
- **领域 AI**: workspace owner / admin 配置, 数量不限. 持 KB + persona + tone + boundary + `primary_user_id`.
- **数字员工形象** (v26.9+): 头像 / 全身 / 动图 + 短名 nickname + 个人渐变色, 跟真人有强视觉区分.

### 2.2 真人用户 — 4 个权限层级

> 简化自 `docs/v26.5-role-redesign-spec.md` 5 角色矩阵(把 manager 收回 admin/expert 范畴, 见 7.5 未决问题).

| 角色 | 范围 | 主要权限 | Web 编辑 | 小程序 / H5 |
|---|---|---|---|---|
| **owner** | 系统全局 | 所有 workspace + 角色 + AI + KB + 记忆 增删改查 | 独占 | 仅查看 |
| **leader** | 单 workspace | workspace 最高权限, 管所有 AI / KB / 任务 / 成员 | 独占 | 仅查看 |
| **admin** | workspace 内科室 | 科室人员管理 + 发起会议 + 管自己 primary 的 AI | 独占(科室范围) | 查看 + 发起会议 |
| **member** | 单 workspace | 仅查看 + 发起会议 | 不编辑 | 查看 + 发起会议 |

**关键不变量**:
- AI(expert) 跟真人是**两套实体**, 不混用. 老代码字段 `role='expert'` 指 manager 类型真人(v26.5 后已重命名, 字段名仍兼容).
- "manager / expert(真人) / 普通用户" 统称 **普通用户**, 放在 admin / member 范畴内.
- `Agent.primary_user_id` 推荐指向 owner/leader/admin, 不指向 member.

_(来源: PM Q2 简化版 + v26.5 spec 矩阵, 现状代码仍叫 expert)_

---

## 3. AI 专家核心能力 (产品差异化)

> **这是产品灵魂. 任何不增强这五项的 Saga, 优先级都应该排在后面.**
> _(来源: PM Q3 五点)_

### 3.1 长期记忆 (Memory)

**现状**: 三层金字塔已落地 (快照 ai_insight → 待审 memory_draft → 记忆库 long_term_memory + pgvector 1536d). Memory ↔ Agent 多对多 (memory_agent_link) v26.5-Lineage 已 GA.

**目标**:
- 出处链回 + 跳回原文 + 高亮 3 秒 (`product-needs-v1.md` § v1.1 路线)
- 记忆库反悔删除
- 跨会议自动调用 (AI 发言时引用过往记忆 + 一键跳查证)

### 3.2 知识沉淀 (Knowledge)

**现状**: KB 文档 (PDF/Word/Excel/PPT/图片 OCR) + chunk + embedding 已落. 任务办结 → AI KB 自动沉淀 (4 段闭环档案) v26.2 已落.

**目标**:
- KB 引用侧栏 (citations 已在库, UI 没做) — 会议室点 AI 发言弹出引用的 KB chunk
- OCR 准确度提升(扫描件/手写体, 接更专业 OCR)
- 公文智能审核 v24.2#3 已落, 看是否扩到通用

### 3.3 数据沉淀方案 (Data)

**现状**: 5 级数据分级 (core/important/sensitive/general/public) + 跨 AI 访问申请 + 操作 audit v24.0 已落. 桑基血缘图 + AI 数据中心 v26.5-Lineage-P2 已落.

**目标**:
- 真实 PDF / PPT / Excel 预览 (现在是 mock hardcoded 渲染) — 接 backend extract_summary / extract_text
- chapter / highlights 自动提取 (会议室章节 sheet 现是 mock)
- 待补: 数据导出 + 第三方系统对接 SOP

### 3.4 任务执行 (Task Execution)

**现状**: Task 一级对象 + 8 态状态机 + 4 维自动派发 + 多 AI 协作(主责 + 协办 + 双向评分) + 月度评价 v17-v23 已落. v26.0 升级为 agent-centric (AI 主责, 真人是 AI 的"手脚").

**目标**:
- expert / manager 角色专属 UX ("我跟我的 AI 协作" page, 现没做)
- 任务办结 → AI KB 沉淀的审批流(kb_sedimentation_draft v26.5-02c 已落)的体验打磨
- 跨端任务通知 push (现在 polling + 在线状态判断粗)

### 3.5 在会议中的表现优化 (Meeting Performance)

**现状**: AI routing 5 维(语义 + KB + 历史 + 负载 + 可用性) v26.1, agenda_monitor (偏题/时间/僵局) m3.0 + v26.14-P4, 反幻觉纪要(qwen-max + temperature=0 + evidence anchor) v25.7, 召集人模式 auto v26.3 GA.

**目标 (最高优)**:
- **AI 圆桌真协同** — 当前 RoundMessage 永久 1 张固定 mock (TD2 PM 决策). 这是 PM 旗舰功能, 必须真做.
- WebSocket 实时推送 (现 2.5s 轮询)
- 字幕 / 摄像头 / 举手 真实硬件接入(现仅 UI toggle)
- 跳过议程 / 已裁决议程改判 / per-meeting max_total_seconds

---

## 4. 端定位

### 4.1 Web 端 (桌面 + 移动响应)

**功能**: 全功能, **独占编辑能力**:
- 普通查看 / 发起会议 / 切换 workspace
- **expert (AI Agent) 编辑** (独占!)
- **AI 知识库管理 增删改** (独占!)
- **AI 记忆管理 增删改** (独占!)
- **owner workspace 增删改查** (独占!)

**形态**: 桌面 + 平板 + 手机浏览器 都跑. 当前路径:
- `/admin/*` `/me/*` `/dashboard` `/super` `/meeting/[id]` — 桌面主战场 (v17-v25)
- `/m/*` — 移动响应模式

### 4.2 小程序原生 (终态生产形态)

**功能**: 查看 + 发起会议 + 切换 workspace
**无编辑功能** (编辑全部走 Web).

**形态**: 微信原生壳(v1.1.0 已 4 tab 全转原生) + webview fallback + 微信 OAuth 一键登录 + 手机号一键登录 + 微信聊天记录文件直传(`wx.chooseMessageFile`).

### 4.3 H5 (`/m/*`) — vibe coding 阶段的 staging

**用途**: vibe coding 阶段的 **测试 / 验证工具**. **不是终态**, 是 staging.
**生命周期**: Saga 验证流稳定后, 翻译到小程序原生 (用户体验最佳).

### 4.4 三端数据同步原则

- **目标**: 三端跑同一套后端 (~30 表 + 200+ endpoint), 数据完全同步.
- **现状**: 目前有些功能逻辑不自洽 / 冲突 (例: 桌面 admin / mobile 信息架构差异 leader 跨端切换断裂; 跨端通知 push 没真做; 离线编辑场景未明确).
- **演进**: 后续按 Saga 逐个处理, 不一次性大改.

_(来源: PM Q7)_

---

## 5. SaaS 架构原则 (multi-tenant)

> _(来源: PM Q6)_

### 5.1 workspace = SaaS 用户

每个 workspace 完全独立:
- **logo / 名称** — 独立品牌
- **用户管理员** — 独立 owner / leader / admin / member
- **声纹** — 独立(`voiceprint` 表 workspace_id 隔离, phase-a + v27.0-P22)
- **AI 专家** — 独立 agent 集合, 不跨 workspace
- **数据** — 严格隔离, 所有业务表 workspace_id + middleware 拦截

### 5.2 智慧住建 = SaaS 通用模板的一个实例

> "智慧住建是政府客户通用模板, 等于是 SaaS 中的一个用户, 一个独立 workspace."

- 不是产品分支, **不硬编码**客户专属逻辑.
- `workspace.preset='smart_construction'` 走政府版预设(16 AI + 月度评价 + cron + 上级文件触发源), 但本质是 workspace 的属性, 不是代码分叉.
- 未来"福田 / 罗湖 / 龙岗 / 任何客户" = 新 workspace 实例, 复用同一份代码 + preset.

### 5.3 平台超管 = 跨 workspace 操作

`/super` (v26.4) 给乙方代建 + 跨 workspace 切换 + audit 留痕. 客户在自己 workspace 也能看到超管动作 audit.

---

## 6. 当前阶段目标 (3 条)

> _(来源: PM Q5 决策, 2026-05-25)_

### 6.1 收尾 Saga A — round-4 P0 主 tab 浅色化

- **状态**: in-progress (`feature/mobile-app-r4-A` 分支)
- **范围**: 4 主 tab + 通知中心浅色化 + MAGlowBanner 跨 tab brand + 共享头像/Icon 提层
- **不破坏**: 会议室 (round-3 done) / 总结页 (round-3 done) 不动
- **估算**: 剩 ~30h

### 6.2 启动 Saga E — AI 专家核心能力补齐

> **PM 决策**: round-4 B/C/D 暂停, 转 Saga E. 理由: 客户看到的是"漂亮 UI 包着 mock 数据" — PM 自己说的"没实现预期".

子项(参考 `docs/PRODUCT_OVERVIEW.md` § 8.2 Saga E):
1. **E.1 AI 圆桌真协同** — 多 AI 真实轮发 + Mira 综合 (取代 1 张 mock), ~15-20h, **P0 旗舰**
2. **E.2 真实 PDF / PPT / Excel 预览** — 接 extract_summary / extract_text 渲染, ~8h, **P0**
3. **E.3 真人 attendee API + 头像 stack** — 解锁会议室真人筛选 / 多人头像, ~6h, **P0**

### 6.3 立 NORTH_STAR.md + 接进 CLAUDE.md 工作流

- 本文档(就是这次).
- 把 NORTH_STAR.md 写入 `CLAUDE.md` "风格守门协议" 下方一节, 每个 Saga 启动前必读 § 1 / § 7.
- "不做" 5 条进 review checklist.

---

## 7. 明确不做 (5 条, 保护方向)

> 根据 PM 多次反馈 + commit 反推 + 风格守门协议. 任何 Saga / spec 跟这 5 条冲突, 默认拒绝, 除非 PM 显式拍板 override.

### 7.1 不做 dark mode

round-4 全面切换到 iOS 浅色 (会议室 round-3 done, 主 tab round-4 in-progress). **不允许**新写 dark token / 借鉴老 dark 代码.
- 例外: 必须 dark 的(eg. 模态过渡黑底)在 commit message 标 `[STYLE-DEVIATION: 具体原因]`.
- 反例: v1.2.0 P1.2 折叠态借了 AttachmentsSection 老 dark token, 是错误案例 (`CLAUDE.md` 风格守门协议).

### 7.2 不硬编码客户专属逻辑

智慧住建 / 福田 / 任何客户都是 **workspace 实例**, 不是产品分支.
- 不允许 `if workspace.name == '福田住建局'` 这种代码.
- preset 是 workspace 属性, 走 `workspace.preset='xxx'` 配置, 不是代码分叉.

### 7.3 不在小程序做编辑功能

小程序 / H5 仅 **查看 + 发起会议 + 切换 workspace**.
- expert / AI 知识库 / AI 记忆 / workspace 增删改查 **必须**走 Web.
- 任何"在小程序里加个编辑入口"的需求, 默认拒绝.

### 7.4 不一次性大改

大需求拆 Saga, 每 Saga 独立 ship + 独立 Kimi 验收.
- round-4 拆 A/B/C/D 4 个子 Saga 是正例.
- 不允许"一个 PR 改 50 个文件改 5 个模块".

### 7.5 不让 mock 数据假装真实

- 有 mock 必须在 UI 上标"演示"或在文档明示.
- 客户演示用 mock 时, PM 必须知情.
- 不允许 "TD2 PM 决策" 这种 mock 长期占位却没出口规划 (eg. AI 圆桌 mock 已超过 2 周, 进 Saga E 必出口).

---

## 8. 工作流约定 (跟 CLAUDE.md 一致)

### 8.1 主-从架构

主 Agent (PM 决策) + subagent 隔离实施. PM 拍板, Claude 实施.

### 8.2 风格守门协议

任何 `Edit` / `Write` 涉及 `*.tsx` / `*.css` / `*.ts` UI 相关:
1. 读 `docs/design/system/DESIGN_SYSTEM.md` 当前最新版
2. 检查改动是否引入与 design system 冲突的视觉/交互
3. 冲突: 优先按 design system 改, 不能改的在 commit message 标 `[STYLE-DEVIATION: 原因]`
4. subagent 委派 prompt 必须 reference DESIGN_SYSTEM.md

### 8.3 Saga 拆分 + 改动清单 + 渐进合并

- 大需求拆 Saga → 每 Saga 独立 ship.
- Saga 落地前必有 `docs/design/specs/SAGA-*.md` changelist 文档.
- 改动清单 → PM 批准 → 实施.

### 8.4 commit message 含版本号 + Phase 标

`feat(v1.2.0 P4): xxx` / `fix(v1.2.0 P1.2): xxx`. 纯文档加 `[no-kimi-test]`.

### 8.5 Kimi 测试用例必产

任何 `feat(*)` / `fix(*)` 落到生产 → 必产出 `docs/kimi-tests/<版本>-kimi.md`, 6 条死规矩反幻觉. 见 `CLAUDE.md` § 部署+测试流程.

---

## 9. 演进机制

> NORTH_STAR 不是一次完美, 是逐步演进.

### 9.1 每个 Saga 收尾时反思

PM + Claude 同步问 3 个问题:
1. 这次学到的新约束要不要进 NORTH_STAR? (新"不做"项 / 新价值排序 / 新角色定义)
2. 当前 "不做" 5 条需不需要调整? (例: 某条 override 了多次, 该重写)
3. "三层价值" 排序对吗? (例: 客户反馈说"任务执行"比"长期记忆"更打动他, 该不该调?)

### 9.2 升级流程

- 主 Agent 整理"反思清单" → PM 拍板 → 主 Agent 写 vX.X+1 升级
- 旧版本保留在 git history, NORTH_STAR.md 顶部 "版本" 行更新.
- 每个 minor 升级在第 0 节 TL;DR 加一行 "v1.x 改动".

### 9.3 跟 CLAUDE.md 的接口

- CLAUDE.md "风格守门协议" 下面加一节 "**NORTH_STAR 守门**":
  - 任何 Saga 启动前必读 § 1 (定位) + § 7 (不做)
  - 任何 spec 写完跟 NORTH_STAR 对齐
- CLAUDE.md review checklist 加入 "不做 5 条" 检查项.

---

## 10. 附录 · 引用证据

| 章节 | 来源 |
|---|---|
| § 1.1 一句话 | PM Q1 升级版 (2026-05-25 对话) |
| § 1.2 三层价值 | PM Q1 升级版 + `product-needs-v1.md` 主题一-四 |
| § 1.3 同类差异 | `docs/PRODUCT_OVERVIEW.md` § 1.2 反推 |
| § 2.1 AI Agent | PM Q2 + v26.9 数字员工 + m3.0 moderator + v26.5 spec |
| § 2.2 真人 4 角色 | PM Q2 + `v26.5-role-redesign-spec.md` 矩阵 |
| § 3 五大核心能力 | PM Q3 五点 |
| § 4 三端 | PM Q7 + `v1.1.0-deploy-guide.md` 小程序原生 + `v27.0-mobile-*` 移动 H5 |
| § 5 SaaS 架构 | PM Q6 + `v26.4 平台超管` + `workspace.preset` 模型 |
| § 6 当前阶段 | PM Q5 决策 + `SAGA-mobile-app-round-4-changelist.md` |
| § 7 不做 5 条 | PM 多次反馈反推 + `CLAUDE.md` 风格守门协议 |
| § 8 工作流 | `CLAUDE.md` 现行约定 |

---

> **本文档不动代码**, 是产品宪法. 任何 Saga changelist / spec / commit 跟 NORTH_STAR 冲突, 默认拒绝, 除非 PM 显式 override.
> **反馈渠道**: PM 直接 edit 本文档 + commit 升级版本号 (vX.Y).
