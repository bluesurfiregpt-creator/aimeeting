# docs/tasks/ · 单 task ticket 目录

> 跟 `docs/ROADMAP.md` 配套. ROADMAP 给 一眼路线图, 这里 给 拆细的 单 task 行动指令.

## 0. 用途

- 任何 Codex / Claude 接手 一个 task → 先读 对应 ticket
- 每 ticket 自闭包 — 不读 别的 文档 也 能 干

## 1. 单 ticket 结构 (强约束)

```
# <task-id> · <一句话标题>

> 状态: pending / in-flight / done / blocked
> 估时: ~Nd
> 依赖: <task-id 列表>
> 触发条件: <什么前提满足后开干>
> 对应 NORTH_STAR: § X.Y 痛点 N

## 1. 背景
为什么 这个 task 存在. PM 反馈 / 调研 结论 / commit 历史 抓出来的 痛点.

## 2. 目标
一句话, 客户体感 + 反幻觉边界.

## 3. 范围 (强 fence)
### 3.1 in scope
- ...
### 3.2 out of scope (留 下一 task)
- ...

## 4. 实施 路径
1. <步骤 1, 含 文件路径>
2. <步骤 2>
...

## 5. 验收
- 自测: <可机器判定的 字面值>
- Kimi 用例: docs/kimi-tests/<file>.md (跑前 出)
- 反幻觉: 没 fallback hardcoded / 看到 真值

## 6. 风险 / 已知 坑
- ...

## 7. 触发的 出 物
- commit (feat / fix / docs)
- Kimi 用例 (CLAUDE.md sticky)
- 部署 + 告 PM 验
```

## 2. 当前 ticket 索引

> 按 PM 拍 风险阶梯顺序 + 依赖.

| ticket | 状态 | 估时 | 客户体感 |
|--------|------|------|---------|
| `sprint-s3-mr-right-rail.md` | pending (推荐 next) | 1d | 客户冲击最大 (会议室右栏 真数据) |
| `sprint-s2-agent-detail.md` | pending | 1d | 痛点 4 核心 (Agent KB/memory 真接) |
| `sprint-s5-browse-tpl.md` | pending | 1d | Browse + Tpl 入口 真接 |
| `phase-c-verify.md` | pending (等 PM 重灌 数据) | 0.5d (PM) + 0.5d (Kimi) | MVP 验收 闭环 4 用例 |
| `phase-d-14-agentic.md` | ⏸️ V1.5 (等 MVP 客户反馈) | 5-7d 高风险 | "AI 真替我干活" 差异化 |
| `polish-ttfc.md` | pending (并行) | 1-2d | AI 第一句话 8-12s → <3s |
| `saga-h-mobile-push.md` | pending (并行) | 10h | 跨端 通知 |

## 3. 更新约定

- ticket ship → 状态 改 `done` + 加 commit hash + push (不 delete file)
- ticket blocked → 状态 改 `blocked` + 写 阻塞 原因
- 新加 ticket → 按结构走 + 加进 § 2 索引
- 完成 不 移到 archive — 保留 上下文 给 后续 同类 task

## 4. 跟 ROADMAP 关系

ROADMAP = "我们在 哪条路 + 走了多远"
tasks/ = "下一步 怎么 走 (单个 task 的 具体动作)"

ROADMAP § N (Phase / Sprint) → 链 到 这里 单个 ticket. ticket 不重复 ROADMAP 的 全景, 只 包 单 task 的 自闭包 上下文.
