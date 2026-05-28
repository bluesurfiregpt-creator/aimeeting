# sprint-s5-browse-tpl · Browse + Tpl 真接

> 状态: pending
> 估时: ~1d
> 依赖: S4 ship (✅)
> 触发条件: S3 + S2 ship 后 (Sprint 阶梯尾)
> 对应 NORTH_STAR: § 6 + § 4.1 Web 端 入口完整

---

## 1. 背景

Web Workstation 两 入口:
- `BrowsePane` (`/workstation/browse`) — 跨 ws 浏览 AI agent 市场
- `TemplatePane` (`/workstation/tpl`) — 会议 模板库

两 pane 当前 大部分 hardcoded mock spec. Sprint 阶梯尾 — 客户冲击 弱 (用户 不会 第一眼 进 这俩), 但 Web Workstation 真接 闭环 必须 收掉.

## 2. 目标

两 pane 真接 backend. 用户 看到 真实 agent / template list.

## 3. 范围

### 3.1 in scope
- `frontend/src/components/web/workstation/BrowsePane.tsx`
  - 跨 ws agent 列表: `api.publicListAgents()` (或 类似 跨 ws read)
- `frontend/src/components/web/workstation/TemplatePane.tsx`
  - 模板 列表: `api.listMeetingTemplates()` (verify endpoint 存在)
  - 创建会议 from template (verify wire)

### 3.2 out of scope
- Browse 跨 ws "申请加入" 流程 (留 Saga · marketplace)
- 模板 编辑 / 创建 UI (留 单独 saga)

## 4. 实施 路径

1. **盘点 mock** — grep `BrowsePane` + `TemplatePane`
2. **API 验** — 后端 endpoint 是否 存在? 没的话 加 mock note
3. **逐 pane 真接** + fallback pill
4. **TS check + 自测 + commit + 部署 + Kimi 用例**

## 5. 验收

### 自测
- `/workstation/browse` 显 真 agent list (跨 ws or own ws)
- `/workstation/tpl` 显 真 template list
- 网断 → 两 pane 都 显 fallback pill

### Kimi 用例
- T-01 Browse API + DOM
- T-02 Tpl API + DOM
- T-03 网断 fallback

## 6. 风险 / 已知 坑

- **模板 后端 endpoint** 可能 不存在 — 需 backend audit 先. 没的话 加 mock + 标 "数据待 backend ship"
- **公开 agent 列表** 权限 — 哪些 agent 可 跨 ws 看? 需 后端 ABAC 验

## 7. 触发 出物

- commit `feat(v1.4.0 Sprint S5): Browse + Tpl 真接`
- `docs/kimi-tests/v1.4.0-sprint-s5-browse-tpl-kimi.md`
- 部署 + 告 PM 验
- ROADMAP § 4 标 ✅
- Sprint 整体 ✅ 闭环
