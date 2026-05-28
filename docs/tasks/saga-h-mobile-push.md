# saga-h-mobile-push · 跨端 通知 推送

> 状态: pending (P1, 可 并行)
> 估时: ~10h
> 依赖: 无
> 触发条件: PM 拍 — 客户 反馈 多端 体验 缺 push 时 启动
> 对应 NORTH_STAR: § 4.4 + 跨端 同步

---

## 1. 背景

aimeeting 三端 (Web / Mobile H5 / 小程序原生), 当前 各自 独立, 无 push. 用户 在 Web 收到 任务 / AI 沉淀 → 离开 Web, 没 提醒. 客户 反馈 多端 体验 不闭环.

PM 标 P1 — MVP 不阻塞, 但 客户 测 后 必加.

## 2. 目标

3 端 收 push 通知:
- AI 沉淀 / 任务 分配给 我 → push
- 会议 开始 提醒 → push
- 跨端 状态 同步 → push (eg Web 改了 task, mobile 收 push)

## 3. 范围

### 3.1 in scope
- Web: Web Push API (service worker)
- Mobile H5: Web Push API (跟 Web 共用)
- 小程序原生: 微信 模板消息 / 订阅消息
- backend: notification 表 + push provider 抽象 (Web Push provider / 微信 provider)

### 3.2 out of scope
- 邮件 push (留 V2)
- 短信 push (合规复杂 留 V2)
- 跨端 状态 同步 (留 单独 saga, 涉及 WS 真实 时序)

## 4. 实施 路径

1. **backend**:
   - 加 `notification` 表 (user_id / type / payload / sent_at / read_at)
   - 加 `push_provider` 抽象 (interface: send(user, payload))
   - 实现 Web Push provider + 微信模板消息 provider
2. **frontend Web + Mobile H5**:
   - service worker 注册 + 用户授权
   - subscription endpoint store 到 backend
3. **小程序原生**:
   - 微信 模板消息 (or 订阅消息, 看 微信 当前 政策)
4. **触发 source**:
   - AI 沉淀 写 memory → push
   - task 分配给 me → push
   - 会议 提醒 → push
5. **commit + 部署 + Kimi 用例**

## 5. 验收

### Kimi 用例 (跑前 出)
- T-01 Web 收 push
- T-02 Mobile H5 收 push
- T-03 小程序 收 push
- T-04 通知 历史 列表 真接

### 客户 (PM 真机)
- 在 浏览器 A 改 task, 浏览器 B / Mobile 1 分钟内 收 push

## 6. 风险 / 已知 坑

- **微信 push 政策** — 模板消息 已 被 微信 降级, 订阅消息 要求 用户 主动 订阅. 需 audit 微信 当前 policy
- **Web Push 跨平台 兼容** — Safari / Chrome / 微信 内置 浏览器 不一定 全支持. 列 兼容表
- **服务 worker 注册 时序** — 用户 没 授权 不能 push. 走 onboarding 提示

## 7. 触发 出物

- commit `feat(saga-h): 跨端 push v1`
- `docs/kimi-tests/saga-h-mobile-push-kimi.md`
- 部署 + 告 PM 真机 多端 收 push
- 客户 反馈 闭环 — 加进 ROADMAP § 4.4 注解
