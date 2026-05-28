# sprint-s3-mr-right-rail · Web 会议室 右栏 真接

> 状态: **✅ done** (2026-05-28)
> commit: `ccf8522` (代码) + `2046c8b` (Kimi 用例)
> Kimi 验收: **GREEN** (PM 跑过)
> 估时: ~1d (实际 ~1d, 准点)
> 对应 NORTH_STAR: § 6 + § 3.5 (痛点 1 + 6, 客户冲击最大)

---

## 1. 背景

PM 反馈 (2026-05-28): Web 会议室 `/meeting/<id>/live` 已 ship R5.D + 接 mic + STT WS (Phase A · 6), 但 右栏 (AI 共识 / 任务 / 知识引用 / 记忆链) 大部分 hardcoded mock 数据. 客户进会议 看到 假 KB 引用 + 假 任务 = 直接 信任崩塌.

Sprint 阶梯里 S3 客户冲击最大 — 会议 是 产品 核心 现场, 右栏 真接 = 客户 第一眼 真实.

## 2. 目标

把 `/meeting/<id>/live` 右栏 4 大 section (AI 共识 / 任务 / 知识引用 / 记忆链) 全 真接 backend. mock 0 残留. API 失败 / 空 → 显 友好 empty state (反幻觉 NORTH_STAR § 7.5).

## 3. 范围

### 3.1 in scope
- `frontend/src/components/web/meeting-room/MRRightRail.tsx` (或拆分子组件)
- AI 共识: `api.meetingConsensus(meetingId)`
- 任务: `api.meetingTimeline(meetingId)` 过滤 type=task
- 知识引用: `api.meetingAgentMessages(meetingId)` 含 `kb_hits` 字段 (Phase B 已 wire)
- 记忆链: `api.meetingAgentMessages(meetingId)` 含 `memory_chain` 字段

### 3.2 out of scope (留 后续)
- 摄像头 / 举手 UI (V1.5 Phase D)
- WebSocket 替换 2.5s 轮询 (V1.5 Phase D · #17)
- 右栏 drag-resize / collapse 全部 重做 (留 polish)
- Mobile 会议室右栏 (Mobile 真接率已 85%, S 阶段 不动 mobile)

## 4. 实施 路径

1. **盘点 现状** — grep `MRRightRail` + 子组件 找 hardcoded mock 数据 / 假 array. 列 mock 大头清单.
2. **逐 section 真接**:
   - AI 共识 section: useEffect 拉 `/api/meetings/<id>/consensus`
   - 任务 section: useEffect 拉 timeline 过滤 task
   - 知识引用 section: 从 agentMessages 提 kb_hits 渲染
   - 记忆链 section: 从 agentMessages 提 memory_chain 渲染
3. **空态 + 错误态**:
   - loading → skeleton 或 "加载中…"
   - 空 → "暂无 共识 / 任务 / KB 引用 / 记忆链"
   - API 失败 → 加 fallback pill `data-testid="mr-right-fallback"` 标 "演示数据" (反幻觉 § 7.5)
4. **TS check + 自测**:
   - `cd frontend && ./node_modules/.bin/tsc --noEmit` exit 0
   - 浏览器 进 测试 meeting (任意 ws), 4 section 渲染 真数据
5. **commit + 部署 + Kimi 用例**:
   - commit `feat(v1.4.0 Sprint S3): 会议室右栏 4 section 真接 (痛点 1 + 6)`
   - `AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy`
   - 写 `docs/kimi-tests/v1.4.0-sprint-s3-mr-right-rail-kimi.md`

## 5. 验收

### 自测 (PM 5 min)
- 进 `/meeting/<id>/live` (用 测试 meeting `a9714f19-...` 或 demo seed 跑出来的)
- 右栏 4 section 显 真数据 / 真空态, 不显 hardcoded
- 网断 → fallback pill 出现 + 标 "演示数据"

### Kimi 用例
- T-01 ~ T-04 各 1 section
- 每 case: API curl 拿 JSON + 浏览器截 DOM + 字面对比 ≥1 字段
- T-05 网断 fallback pill 验

### 反幻觉 (NORTH_STAR § 7.5)
- 任何 section 失败 → 显 fallback pill, 不 silent fallback hardcoded
- DOM 字段 = API JSON 字面相等

## 6. 风险 / 已知 坑

- **会议室 双 theme** (NORTH_STAR § 7.1.1): 右栏 必须 在 dark + light 都 渲染 OK. 用 W_TOKENS 不要 重新 引 dark token
- **memory_chain 数据** 后端 是否 已 ship — 需 verify `agentMessages` response 包不包 memory_chain. 没的话 留 mock 标 "数据待 backend ship", 不 算 漏
- **2.5s 轮询** 仍 在 (V1.5 才 替), 测试时 别 误判 "数据不更新" 是 bug — 等 1 轮 轮询 再看
- **kb_hits 字段** Phase B · 8 已 ship (1dfb428 + 5613785), demo seed 已 backfill, 应该有

## 7. 触发 出物

- `feat(v1.4.0 Sprint S3): 会议室右栏 真接` commit
- `docs/kimi-tests/v1.4.0-sprint-s3-mr-right-rail-kimi.md`
- 部署 main + 告 PM 验 URL
- ROADMAP § 4 把 S3 改 ✅ + commit hash
