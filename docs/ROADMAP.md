# aimeeting · 路线图 (ROADMAP)

> **更新**: 2026-05-28 (v2 · Sprint S1-S5 全 ✅ 后)
> **来源**: NORTH_STAR.md § 6 浓缩 + Sprint S1-S5 ship 历史 + commit history 验证
> **配套**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/tasks/` (拆细 task ticket)
>
> **本文档 用途**: 给 PM / Codex / 任何 接手 agent 一眼看清 "我们在 哪条路 + 走了多远 + 下一步".

---

## 0. 一眼扫读

| 阶段 | 客户体感 | 状态 | 跨度 |
|------|---------|------|------|
| **Phase A** · 调优 + UI 打磨 | 客户 第 1 场会 跑顺 | ✅ ship 2026-05-27/28 (含双盲 GREEN) | 6.5d 完成 |
| **Phase B** · NEW-C + NEW-A 简版 | 客户 5-10 场会 + 非会议找 Mira | ✅ ship 2026-05-28 | ~5d 完成 |
| **Phase C** · NEW-B + NEW-A 完 + 文件 + 创会 | MVP 完整可上线 | 🟡 代码 全 ship, **Kimi 验收 待跑 (PM 重灌 数据 进行中)** | ~4d 已写 |
| **Sprint S1-S5** · Web Workstation 真接 | mockup → 真数据 (~30% → ~80%+) | ✅ **全 ship 2026-05-28** (S4/S3 Kimi GREEN, S2/S5 待 Kimi) | 4d 完成 |
| **Phase D** · NEW-D agentic + WebRTC + V2 | "AI 真替我干活" 差异化 | ⏸️ 推迟 V1.5 (拿 MVP 测客户后再排) | ~22d 高风险 |

**当前 MVP 验收 闭环**:
1. Phase C #10 NEW-B + #11 NEW-A 完 + #12 + #13 Kimi 4 用例 GREEN (**仅剩这步**)
2. ~~Sprint S2 + S3 + S5 真接 完~~ ✅ 已 ship 2026-05-28
3. → MVP 可上线给客户 内测

---

## 1. Phase A · 把当前会议跑顺 ✅ ship

> _NORTH_STAR § 6.1, 客户开 第 1 场会 真实顺畅 — 转录 + 多 AI 真发言 + 持立场 + 主持人拉回 + 沉淀有依据._

| # | 项 | commit | 痛点 |
|---|------|--------|------|
| 1+2+3 | MOCK_ROUND_MESSAGES UI 真接 + LLM judge 主动度调优 + 立场守门 prompt | `a269f84` | 1, 2, 6 |
| 4 | summary v2 结构化 (topic 分组 + speaker 立场 + 任务溯源 chip + 跳实录) | `4b6add2` | 3 |
| 5 | Mobile recommendation banner (主持感 + 用户能呼叫) | `ea03001` | 6 |
| 6 | R5.D Web 会议室 接 mic + STT WS | `2a53072` | (Code Archaeology) |
| 7 | 死码清理 + 声纹周期微调 (45s→15s) | `a53cd17` | polish |
| 8 (后置) | 打字输入框 + 角色代发 双端 | `56b2037` | 双盲道路 |
| 9 (验收) | 双盲 Round 2 GREEN (Claude + Kimi) | `1e29205` | NORTH_STAR § 8.7 |

**Phase A 真发现** (双盲 抓出 2 个 真 bug):
- demo_seed_v2.py 缺 keywords 字段 → maybe_invoke_agents 跳过 (修根)
- item_5 metric 漏算 dissent_detected → 误判 YELLOW (Round 2 加 combined)

---

## 2. Phase B · 真 MVP 闭环 ✅ ship

> _NORTH_STAR § 6.2, 客户 5-10 场会 + 平时找 Mira 问问题, AI 不自相矛盾._

| # | 项 | commit | 痛点 |
|---|------|--------|------|
| 8 | NEW-C 非会议 1-on-1 跟 Mira 对话入口 (Mobile + 2 入口) | `366b1c4` | 7 |
| 8 fix | demo_seed_v2 加 KB seed 给 10 英文品牌 agent (修 KB hits=0) | `1dfb428` | 修根 |
| 8 verify | Claude 自测 GREEN (Lex 12 / Mira 10 hits) | `5613785` | § 8.7 |
| 9 | NEW-A 简版 (LLM judge 检测立场冲突 + 自动标 superseded) | `c51665e` | 4 |

---

## 3. Phase C · 完成 MVP 全功能 🟡 代码全 ship, 验收待补

> _NORTH_STAR § 6.3, **MVP 完整可上线给用户内测**. 全功能闭环 + 沉淀质量高 + 议题脉络清晰._

| # | 项 | commit | Kimi 状态 |
|---|------|--------|----------|
| 10 | NEW-B 议题主题 一级对象 + 议题线 UI | `0479778` | 用例 ship (`f2d03b8`), 验收待跑 |
| 11 | NEW-A 完整版 冲突 覆盖 UI drawer + 历史版本 chain + 撤销 endpoint | `10c506a` | Round 1 RED → post-fix (`e876d54`) → 待重跑 |
| 12 | 文件预览 真接 + LLM 抽章节 (替 "预览开发中" 占位) | `53f3a69` | 验收待跑 |
| 13 | Mira NLU 真接 LLM + mobile 新建会议 AI path 真落库 | `ca94c60` | 验收待跑 |

**Phase C 验收 闭环路径**:
1. PM 在 测试 meeting `a9714f19-...` 重新 @ 立场对立 agent 触发 conflict_detector (PM 手工 ~10 min, 重灌 NEW-A 测试数据)
2. Kimi 重跑 #11 用例 (现 用 read-only `?status_filter=superseded` API, 不破坏数据)
3. Kimi 跑 #10 / #12 / #13 用例
4. 4 用例 全 GREEN → Phase C 收尾

详 ticket: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/tasks/phase-c-verify.md`

---

## 4. Sprint S1-S5 · Web Workstation 真接 ✅ 全 ship

> _PM 反馈 (2026-05-28): Web Workstation 大部分 mockup. 真接率 30% → 拉到 ~80%+. 风险阶梯 顺序: 客户冲击大 + 改动小 优先._
> **2026-05-28 收尾**: Sprint S1-S5 全部 ship, 4d 跑完 5 saga.

| Sprint | 项 | 估时 | 状态 |
|--------|-----|-------|------|
| **S1** | `/workstation` 心智一览 真接 (替 hardcoded count + me name) | 0.5d | ✅ ship `9199978` |
| **S2** | `AgentDetail` 1805 行 真接 3 tab (KB + memory + 历史) | 1d | ✅ ship `6ee1552` + Kimi 用例 `a477ec2` |
| **S3** | 会议室右栏 真接 3 section + 2 mock pill (客户冲击最大) | 1d | ✅ ship `ccf8522` + Kimi 用例 `2046c8b` (Kimi GREEN) |
| **S4** | ProfilePane + AdminPane 真接 (替 W_USER + WS_WORKSPACES hardcoded) | 0.5d | ✅ ship `b7ebc47` + Kimi 用例 `c21fce1` (Kimi GREEN) |
| **S5** | BrowsePane 真接 + TplGenerator pill (Sprint 收尾) | 1d | ✅ ship `3a60991` + Kimi 用例 `3618b75` |

**Sprint S 阶段 整体 闭环** ✅ (2026-05-28).

详 ticket: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/tasks/`

---

## 5. Phase D · 差异化 + 高风险 ⏸️ V1.5 推迟

> _NORTH_STAR § 6.4, **不 必 MVP 内做**. 拿当前 MVP 给客户测, 反馈 驱动 Phase D 优先级排序._

| # | 项 | 估时 | 痛点 / 触发 |
|---|------|------|----------|
| 14 | **NEW-D AI agentic 自主跑任务** ("AI 真替我干活") | 5-7d 高风险 | 痛点 8 |
| 15 | WebRTC + 摄像头 + 举手 | 6d 高风险 | § 3.5 多模态 |
| 16 | 声纹 streaming + 跨端 push + V2 auto-relay | 8d | § 3.5 体验优化 |
| 17 | WebSocket 替换 2.5s 轮询 (E.E2) | 3d | § 3.5 P95 5-17s → <500ms |

**Phase D 启动 条件**:
- Phase C 验收 全 GREEN
- Sprint S1-S5 全 ship
- 客户 内测 反馈 收 ≥1 周

---

## 6. 单独 saga (不 in-Phase, 但 待办)

| saga | 项 | 估时 | 客户体感 |
|------|------|------|---------|
| TTFC | AI 第一句话 出口时间 8-12s → <3s | 1-2d | 客户 第一感 |
| Mobile push | 跨端 通知 推送 (Saga H, P1) | 10h | 多端 体验 |
| API 类型 同步 (Saga J, P2) | backend Pydantic → frontend TS 类型 自动生成 | 6h | DX 提升 |
| 编辑边界 澄清 (Saga G, P0) | 小程序 哪些字段 可改 / 不可改 | 1-15h | 小程序 终态 必备 |

---

## 7. 已 dropped / 不做

> _NORTH_STAR § 7, 严守 5 条 不做 + 设计原则 5 条._

- Dark mode (主流程) — 例外: 会议室 双 theme PM override (§ 7.1.1)
- 内置邮件 / 日历 (走 Outlook / Notion 集成)
- 多端 编辑冲突 复杂 CRDT (按 last-write-wins)
- Real-time co-edit (PM 拍: 不 in-MVP)
- 微信 群机器人 (走 Mobile push)

---

## 8. 节奏 + 触发

### 8.1 PM review 间隔
- Phase 间 (A→B / B→C) → PM 全 hands-on review
- Sprint 间 (S* 完 1) → PM 5 min 自验
- Kimi 验收 后 → PM 看 Kimi 报告 → GREEN / RED 拍板

### 8.2 触发 公开 / 收尾
- 任何 `feat(*)` ship → 必出 Kimi 用例 (CLAUDE.md sticky)
- 任何 Phase 完 → NORTH_STAR § 6 标 ✅ + ROADMAP 更新
- 任何 V1.5 推迟项 → § 5 加注 触发条件

### 8.3 dependencies (谁挡谁)
- Phase C #11 Kimi 重跑 ← 等 PM 重灌 测试数据 (~10 min)
- Sprint S2/S3/S5 ← S4 ship 后 解 (S4 ✅ → 可并行 推)
- Phase D #14 NEW-D ← Phase C 全 GREEN + 客户内测反馈

---

## 9. 文档 跳转

- 宪法 / 长期 不变: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md`
- Codex 工程规则: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/AGENTS.md`
- Claude 短期 工作守则: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md`
- 设计 系统: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md`
- 单 task ticket: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/tasks/`
- Kimi 用例: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/`
- 服务器 + Secret 目录: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/SECRETS.md`
