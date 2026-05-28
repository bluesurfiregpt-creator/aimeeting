# sprint-s2-agent-detail · AgentDetail 1805 行 真接

> 状态: pending
> 估时: ~1d
> 依赖: S4 已 ship (✅), S3 优先 (PM 拍 风险阶梯)
> 触发条件: S3 ship 后
> 对应 NORTH_STAR: § 6 + § 3 五大能力 (痛点 4 核心)

---

## 1. 背景

`frontend/src/components/web/workstation/AgentDetail.tsx` 是 工作站 单个 AI 专家 详情页 (1805 行), 客户 看 AI 的 KB / memory / 立场 / 历史. **痛点 4 核心**: 客户 看 AI 历史 推理 + 沉淀 = 信任. 但 此页 真接率 低, 大部分 hardcoded mock spec.

## 2. 目标

`/workstation/agent/<id>` 全 section (基本信息 / KB / memory / 立场 / 历史) 真接 backend. 用户 看 任一 AI 的 真实 数据.

## 3. 范围

### 3.1 in scope
- `frontend/src/components/web/workstation/AgentDetail.tsx`
- AI 基本信息: `api.getAgent(id)` (含 name / persona / model / 创建时间)
- KB: `api.listAgentKnowledge(agentId)` (Phase B · 8 ship)
- memory: `api.listAgentMemories(agentId)` (含 status / superseded chain)
- 立场: `api.listAgentMessages(agentId)` 提 stance / dissent
- 历史: 跨 meeting 出现的 历史 (用 ws + agentId filter)

### 3.2 out of scope
- AI 编辑 / 创建 / 删除 (留 单独 saga, 涉及权限)
- AI 跑 测试 / debug 工具 (留 single-saga "AI debug 控制台")

## 4. 实施 路径

1. **盘点 mock** — grep `AgentDetail` 找 hardcoded array / spec.
2. **section 拆分 真接** — 按 § 3.1 顺序逐 section.
3. **fallback pill** — 任何 section API 失败 → `data-testid="agent-detail-fallback-pill-<section>"` 标 "演示数据".
4. **memory section 加 superseded chain UI** — 复用 Phase C · 11 ship 的 drawer (`10c506a`).
5. **TS check + 自测 + commit + 部署 + Kimi 用例**.

## 5. 验收

### 自测
- `/workstation/agent/<Lex-id>` (用 demo seed 的 Lex agent)
- 5 section 显 真数据 / 真空态
- 网断 → 5 个 fallback pill 都 出现

### Kimi 用例
- T-01 ~ T-05 各 1 section
- 每 case: API curl + DOM 字面对比

### 反幻觉
- 同 § 7.5

## 6. 风险 / 已知 坑

- **AgentDetail 1805 行 大文件** — 可以 拆 子组件, 但 别 changes 太大. 一次 saga 只 改 真接 + fallback pill 部分
- **stance / dissent 字段** — 后端 是否 在 agentMessages return? 需 verify
- **历史 跨 meeting filter** — 后端 是否 支持 agentId filter? 没的话 加 query param

## 7. 触发 出物

- commit `feat(v1.4.0 Sprint S2): AgentDetail 真接`
- `docs/kimi-tests/v1.4.0-sprint-s2-agent-detail-kimi.md`
- 部署 + 告 PM 验
- ROADMAP § 4 标 ✅
