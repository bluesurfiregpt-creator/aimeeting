# phase-c-verify · Phase C 4 用例 Kimi 重跑 收尾

> 状态: pending (等 PM 重灌 测试数据 ~10 min)
> 估时: 0.5d (PM 数据 重灌) + 0.5d (Kimi 跑 + 修)
> 依赖: PM 重灌 NEW-A 测试数据 (~10 min 手工)
> 触发条件: PM 在 测试 meeting `a9714f19-...` 重新 @ 立场对立 agent 触发 conflict_detector
> 对应 NORTH_STAR: § 6.3 Phase C MVP 收尾

---

## 1. 背景

Phase C 4 项 代码 全 ship 但 Kimi 验收 待补:
- #10 NEW-B 议题主题 (`0479778` + 用例 `f2d03b8`) — 验收待跑
- #11 NEW-A 完整版 (`10c506a` + 用例 `2e975e6`) — Round 1 RED → post-fix (`e876d54`) → 待重跑
- #12 文件预览 (`53f3a69`) — 验收待跑
- #13 Mira NLU + mobile 创会 (`ca94c60`) — 验收待跑

Phase C 验收 闭环 = MVP 可上线给客户 内测.

#11 Round 1 RED 根因: Kimi 用 POST /restore 探测 132 条 message status, 但 restore 有 side effect (改 superseded → active) 销毁测试数据. post-fix `e876d54` 加了 read-only `?status_filter=superseded` API + 改 Kimi 用例不破坏数据.

## 2. 目标

4 用例 全 GREEN → Phase C ship 真实 闭环 → MVP 完整可上线给客户 内测.

## 3. 范围

### 3.1 in scope
- PM 重灌 测试数据 (在 `https://aimeeting.zhzjpt.cn/meeting/a9714f19-.../live` @ 立场对立 agent, 触发 conflict_detector, ~10 min)
- Kimi 跑 4 用例:
  - `docs/kimi-tests/v1.4.0-phase-c-10-new-b-topics-kimi.md`
  - `docs/kimi-tests/v1.4.0-phase-c-11-new-a-full-kimi.md` (post-fix 版)
  - `docs/kimi-tests/v1.4.0-phase-c-12-preview-kimi.md` (待检 + 可能补)
  - `docs/kimi-tests/v1.4.0-phase-c-13-mobile-create-kimi.md` (待检 + 可能补)
- 任何 用例 RED → Claude / Codex 修后端 / 前端, 再 跑 Kimi

### 3.2 out of scope
- Phase C 新增 项 — 4 项 已 ship 全, 不再 加
- Phase D V1.5 — 推迟

## 4. 实施 路径

1. **PM 准备数据** (PM 手工 10 min)
   - 用 `bluesurfiregpt@gmail.com / <SYSTEM_OWNER_PWD>` 登
   - 进 `/meeting/a9714f19-.../live` (NEW-A 测试 meeting)
   - @ 2 个 立场对立 agent → 触发 conflict_detector → 标 superseded
   - 用 `?status_filter=superseded` curl 验 ≥1 条 superseded

2. **Kimi 跑 4 用例** (PM 喂 Kimi prompt 用 public repo URL):
   ```
   git clone https://github.com/bluesurfiregpt-creator/aimeeting.git
   cat docs/kimi-tests/v1.4.0-phase-c-{10,11,12,13}-*.md
   按用例顺序 跑, 报告 各 用例 4 段
   ```

3. **Kimi 报告 回来**:
   - 全 GREEN → ROADMAP § 3 标 ✅ + 通告 PM "Phase C 闭环, MVP 可内测"
   - 任何 RED → 看 Kimi 报告 复现 真问题, Claude / Codex 修, 再跑

4. **触发 Phase D 讨论** (PM 决定):
   - Phase D #14 NEW-D 开 / 不开
   - 或 拿 MVP 给客户 内测 1 周 再 排 Phase D 顺序

## 5. 验收

### Kimi 4 用例 全 GREEN
- 每 用例 报告 顶 "结论: GREEN"
- 每 case 4 段 (实际看到 / 判定 / 失败理由 / 证据) 齐全

### MVP 闭环 信号
- 客户 demo 流程: 创会 (#13) → 开会 议题脉络 (#10) → 沉淀 不矛盾 (#11) → 文件 预览 (#12) → 全 不挂

## 6. 风险 / 已知 坑

- **测试数据 重灌**: PM 手工 必须 重新 触发 conflict, 不允许 用 旧数据 — Round 1 已 销毁
- **#11 Kimi 用例 强约束 read-only**: 不允许 用 POST /restore 探测. 用例 顶 已 标
- **mobile 创会 #13** Kimi 用例 是否 已 ship? 若没, 这 task 含 写 用例 + 跑

## 7. 触发 出物

- Kimi 报告 4 份 (PM 喂 给 Kimi 后, paste 回 Claude)
- 任何 修后 commit (fix(v1.4.0 phase-c-NN): ...)
- ROADMAP § 3 标 ✅
- 通告 PM "MVP 闭环, 可内测"
- 触发 Phase D 讨论
