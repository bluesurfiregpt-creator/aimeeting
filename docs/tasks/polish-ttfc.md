# polish-ttfc · AI 第一句话 出口时间 8-12s → <3s

> 状态: pending (可 并行 跟 Sprint S2/S3/S5)
> 估时: 1-2d
> 依赖: 无 (后端 改, 不阻塞 frontend Sprint)
> 触发条件: Sprint S* 跑 期间 Codex / Claude 抽 1d 干
> 对应 NORTH_STAR: § 3.5 (体验优化)

---

## 1. 背景

TTFC (Time To First Char) = 用户 触发 → AI 第一个字 出现. 当前 8-12s. 客户 第一感 "AI 慢", 信任损耗 大.

可能 原因 (待 audit verify):
- LLM API call 串行 等 完整 response (没 streaming)
- agent_router 路由 决策 重 (LLM judge 阈值 check)
- 网络 链路 cold start (DashScope cn-hangzhou → 海外 跨 region)
- frontend 渲染 等 完整 message 才 paint

## 2. 目标

TTFC 8-12s → <3s (中位数). 客户 第一感 "AI 快".

## 3. 范围

### 3.1 in scope
- backend `agent_router.py` 优化:
  - 改 streaming response (SSE / chunked)
  - audit LLM call 串行 → 并行 哪些 可 并
  - 缓存 agent persona / KB embedding 不每次重算
- frontend 改 接 streaming:
  - WS / SSE 接 partial response
  - "AI 正在 输入…" indicator (现 可能 已 有, verify)
- DashScope region 切换 (cn-hangzhou 海外 慢 → ap-southeast-1 / us-west)

### 3.2 out of scope
- WebSocket 替换 2.5s 轮询 (Phase D · #17 单独 saga)
- 多模态 latency (Phase D 多模态)
- agent_router 大重构 (留 V1.6)

## 4. 实施 路径

1. **audit verify** — 跑 测试 meeting, 量化 各 stage latency:
   - 用户 click → backend 收到: ~?ms
   - backend → LLM API: ~?ms
   - LLM API → first chunk: ~?ms (核心 慢点)
   - first chunk → frontend 渲染: ~?ms
2. **优化 优先级 排序** 按 latency 贡献大 → 小
3. **改 streaming** — backend `agent_router.py` LLM call 加 `stream=true`, frontend SSE / WS handler
4. **TS check + smoke + 真 meeting 验 TTFC 中位数**
5. **commit + 部署 + Kimi 用例** (Kimi 跑 TTFC 验)

## 5. 验收

### 自测
- 测试 meeting 触发 AI 发言, 用 stopwatch 测 ≥10 次 TTFC 中位数 <3s

### Kimi 用例
- T-01 ~ T-03 各 1 stage latency 量化 + 中位数 复述

### 客户 体感 (PM 真机)
- 进 测试 meeting @ 1 个 AI, 第一字 <3s 出现

## 6. 风险 / 已知 坑

- **改 streaming 牵连 大** — 后端 + 前端 + 测试 全 改. 一次 改 完不太可能, 拆 2 saga (backend stream / frontend SSE)
- **DashScope cn-hangzhou** — 是 PM 选 的 (国内 合规). 改 region 风险 (Phase B · 8 已 fix OSS region 跨, LLM 类似)
- **agent_router 路由 决策** — Phase A · 2 已 调阈值 (8s/30s → 4s/15s). 再 优化 边际收益 可能 小
- **TTFC vs 准确度 tradeoff** — 太追 latency 可能 牺牲 LLM judge 准确度, 客户 反馈 "AI 蠢了"

## 7. 触发 出物

- ≥2 commit (audit + 改 stream)
- `docs/kimi-tests/v1.4.0-ttfc-kimi.md`
- 部署 + 告 PM 真机 测 TTFC
- 中位数 写 ROADMAP § 6 / NORTH_STAR § 3.5
