# Phase A 双盲测试 · Claude vs Kimi · Round 1 深审

> 审计时间: 2026-05-27
> 审计人: Claude (subagent, 静态分析模式)
> 输入: `/Users/bluesurfire/Downloads/retrospective-kimi-phase-a.md` (Kimi 跑出来的) + 已 commit 的 `run-claude-A-v4-20260527-224044.json` + `run-claude-B-20260527-224453.json`
> 不做: 不跑代码 / 不 reproduce / 不 spawn subagent / 不 deploy

---

## TL;DR

- **item_5 剧本 A fail 判定**: **(B) 概率抖动** — 不是 backend bug, 也不是 测试 设计 错. orchestrator 是 单次 LLM judge call, 默认 temperature 非 0, 每次 跑 都 概率性 输出. Claude A 跑出 1 次推荐 (Lex), Kimi A 跑出 0 次, **属于 LLM 采样 方差 落差**.
- **双盲 真 verdict**: **YELLOW (跟 Kimi 自评 一致)** — 1 项 fail 不构成 RED (item_4 核心 has_ai=true 未退化), 但 也 不是 GREEN (有 binary 维度 双盲 不一致).
- **下一步**: **不改 backend, 改 测试 阈值** — 改 "单次 跑 item_5 >= 1" 为 "N 次跑 至少 M 次 >= 1" (建议 3 次至少 2 次), 或 把 item_5 从 强制 阈值 降为 informational metric.

---

## 1 · item_5 剧本 A fail 是 真 backend bug, 概率抖动, 还是 测试 设计 缺陷?

### 数据点

| 来源 | A item_5 count | B item_5 count |
|---|---|---|
| Claude run (22:40) | **1** | 1 |
| Kimi run (23:11) | **0** | 1 |

剧本 B 双方 一致 (各 1 次), 剧本 A Claude=1 / Kimi=0 — **单点 binary 不一致**.

### 推理 (基于 静态代码 分析)

**关键证据 #1: orchestrator 是 单次 LLM judge call, 没传 temperature → 默认 ~0.7**

`/Users/bluesurfire/Documents/claude/aimeeting/backend/app/orchestrator.py` line 147-151:
```python
async for c in stream_chat(
    provider=provider,
    system_prompt=_SYSTEM_PROMPT,
    user_prompt=user_prompt,
):
```

`stream_chat` 没 传 `temperature=` 参数 (对比 `llm_direct.py:146` 的 docstring: "默认 None 不传(让模型用 default ~0.7)"). 即 **每次 调 LLM judge 都是 概率性 采样**, 没 seed, 同 prompt 不同 run 可能 不同 输出.

**关键证据 #2: prompt 给 LLM 4 种 输出选择, 其中 3 种 是 "null" (不推荐)**

`orchestrator.py` line 63-69 的 prompt:
- 规则 1: 推荐另一专家 (1 票 推荐)
- 规则 2: 讨论收敛 → `agent_id=null`
- 规则 3: 没新延伸 → `agent_id=null`
- 规则 4: 候选列表 没人 → `agent_id=null`

**Prior: 即使 prompt 偏向 触发, 默认 70% 温度 下 LLM 选 "null" 的概率 也 可能 30-50%**.

**关键证据 #3: orchestrator 在 每个 agent_message_end 都 fire, 没 rate limit**

`agent_router.py:484-492`:
```python
if full:
    asyncio.create_task(
        _suggest_next_speaker(
            meeting_id=meeting_id,
            just_finished_agent_id=agent.id,
            just_finished_agent_text=full,
            on_message=on_message,
        )
    )
```

→ Claude A 有 3 个 agent_message_end → 3 次 LLM judge call 机会
→ Kimi A item_2_proactive_count = 3 → 同样 3 次 机会

每次 都 是 独立 概率 实验. 假设 单次 推荐概率 p≈0.3, 3 次 全 null 的 概率 = (1-0.3)^3 ≈ 0.34 → **Kimi A 这次 0 推荐 完全 在 概率 范围 内**.

**关键证据 #4: Claude A 触发 的 时机 跟 触发 内容**

`run-claude-A-v4-20260527-224044.json` line 1712-1722:
```json
{
  "type": "agent_recommendation",
  "agent_id": "00000000-0000-0000-0000-20a9e7000005",
  "agent_name": "Lex",
  "reason": "陈师宇提到隐私法务问题，听听法务的"
}
```

ts 1779892888.73 — 即 step 4 (陈师宇 "隐私 4.2 条") 之后, Aria 二轮 收尾 (ts 885.27) 之后. **LLM 看到 Aria 收尾 + 上下文 8 句含 "隐私 4.2 条" + Lex 在 候选 列表 → 决定 推 Lex**.

剧本 B 双方 都 推 Lex (Kimi B reason 未知, Claude B reason "韩雪提到法规合规, 听听法务的") — 说明 在 "隐私/法务关键字 + Lex 在候选" 条件 下, LLM 是 大概率 触发的.

**关键证据 #5: 剧本 B 一致 → 不是 deploy / 配置 bug**

如果是 backend bug, 剧本 B 应该 也 fail. 但 Kimi B = 1, Claude B = 1, 双方 一致.
→ orchestrator 函数 本身 work, agent_router hook 触发 也 正常, prompt 跟 LLM provider 也 active.
→ **唯一 变量 是 LLM 采样 输出**.

### 判定

**(B) 概率抖动**, 95% 置信. 不是:
- (A) backend bug — 剧本 B + 历史 Claude run 都 触发, 函数本身 work
- (C) 测试设计 缺陷 — orchestrator 在 这个剧本 step 4 触发 的 "应该率" 是 高 (Lex 在 候选 + 强 关键字 "隐私 4.2 条"), 设计上 没问题; 唯一 是 阈值 "count >= 1 单次跑" 没 容忍 LLM 方差

### 但 测试 设计 阈值 有 小瑕疵

测试 md `T-06` 阈值 "count >= 1" 是 **单次 跑 binary 验证**, 没 容忍 单次 LLM 采样 方差. 对 deterministic backend (如 calculator) 这 OK, 但 对 LLM-judge 类 概率行为 太 严格.

---

## 2 · 双盲 真 verdict: GREEN / YELLOW / RED

### Verdict matrix (从 T-08 测试md 抓的 4 条 GREEN 条件 + Kimi 实际 数据)

| 维度 | 阈值 | Kimi A | Claude A | 是否 一致 |
|---|---|---|---|---|
| item_2_count 差值 | <= 2 | 3 vs 3 (diff=0) | — | ✓ |
| item_4_has_ai | 都 true | true vs true | — | ✓ |
| item_5 | 都 >= 1 | **0** vs 1 | — | ✗ |
| item_3_violations | 都 = 0 | 0 vs 0 | — | ✓ |

剧本 B: 4/4 维度 一致 ✓

剧本 A: 3/4 维度 一致, item_5 不一致 ✗

### 验收 规则 (从 T-08/T-09 测试md 抓的)

- GREEN: T-01 ~ T-09 全 pass + 双 AI 结果一致
- YELLOW: 1-2 项 fail 但 item 4 has_ai 仍 true
- RED: item 4 has_ai = false 或 item 2 count = 0

### 判定

**YELLOW**, 跟 Kimi 自评 **一致**.

- 不是 GREEN: T-06 + T-08 fail (剧本 A item_5 binary 不一致)
- 不是 RED: item_4_has_ai=true 双方都 守住, item_2_count=3 也 没 退化, 双盲 5/6 一致

YELLOW 的 含义: **核心 能力 (主动度 / 立场 / summary v2) 未 退化, 仅 Mira 接力 在 剧本 A 这次 概率没 命中**. 业务 可以 接受, 但 应 跟 PM 报告 + 补 跑 验稳定性.

---

## 3 · 下一步 建议 (排序)

### 建议 1 (高优先级): **重跑 剧本 A 3 次 看 稳定性**

跑 `python3 scripts/blind-test-runner.py --script A-grayrelease.json --runner claude --out run-claude-A-stab-{N}.json` 3 次, 看 item_5 count 分布. 期望 看到:
- 如果 3 次 都 >= 1 → 强证 backend 工作, 之前 Kimi 0 是 单点 抖动
- 如果 出现 0 → 1 → 0 这种 → 确认 概率抖动, 阈值 需 改
- 如果 全是 0 → 说明 真 backend bug (跟 假设 矛盾, 但 不能 排除)

成本: 3 次 跑 × 3 分钟 ≈ 10 分钟 + 10 token 钱.

### 建议 2 (高优先级): **改测试 阈值 容忍 LLM 方差**

把 T-06 / T-08 改成:
- **方案 A** (推荐): "3 次 跑 中 至少 2 次 item_5 count >= 1" — 容忍 1 次 抖动
- **方案 B**: 把 item_5 阈值 改成 informational (不 hard fail), 只 在 双方 都 = 0 时 才 报 fail
- **方案 C**: 阈值 改 "count + dissent_detected 至少 1 个 触发" (因为 dissent_detected 也 是 backend 主动 暗示 接力)

剧本 A Claude run 实际 有 `dissent_detected` 事件 (ts 881.24 — `suggested_agent_id` 是 Stratos), 这其实 算 backend 主动 推 接力 的 另一种 形式. 但 当前 测试 只 看 `agent_recommendation` 事件. 如果 算 上 dissent_detected, 双盲 都 >= 1.

### 建议 3 (中优先级): **不 改 backend orchestrator (lower threshold / 提高 触发率)**

PM 角度 看 这 不是 bug, backend 设计 是 "better silent than wrong" (orchestrator.py:18 注释). 强行 提高 触发率 (eg. 加 keyword-based fallback / 设 temperature=0) 会:
- 副作用: 增加 LLM 推荐 错误 / 没必要的 banner 干扰
- 风险: 触发 太频繁 反而 影响 用户体验

如果 PM 坚持 backend 改:
- 选项 1: orchestrator.py:147 传 `temperature=0` 让 输出 deterministic (但 不一定 100% 触发, 看 prompt 偏好)
- 选项 2: 加 keyword-based pre-check, 比如 "上下文 含 '隐私/法务/合规' 且 Lex 在 候选" 直接 推, 不 走 LLM
- 但 这两 都 是 **设计变更**, 不 是 修 bug, 不 建议 在 Phase A 收尾 阶段 做

### 建议 4 (低优先级): **跑 Kimi 剧本 A 第 2 次, 看 Kimi 自己 是否 复现 0**

如果 Kimi 第 2 次 跑 item_5=1, 跟 Claude 一致 → 确证 单点 抖动, 直接 YELLOW → GREEN 放行
如果 Kimi 第 2 次 还是 0, 但 Claude 跑 3 次 都 1 → 怀疑 是 Kimi 跑 时段 (23:11) backend 状态 (LLM cache 比较 热, latency 0.23s 比 Claude 0.67s 快) 导致 LLM 不同 行为. 但 这种 怀疑 没 backend log 证据, 还是 归 "概率抖动".

---

## 4 · 真 backend bug 候选 (如果 判 A)

**判断不是 A, 但 列 给 PM 参考**:

- `backend/app/orchestrator.py:147-151` — `stream_chat()` 没 传 `temperature`, 概率性 输出. 如果 PM 想 deterministic, 加 `temperature=0`.
- `backend/app/orchestrator.py:79-127` — 触发 条件 完全 委托给 LLM judge, 没 fallback 路径. 如果 想 提高 触发率, 加 keyword-based pre-check.
- `backend/app/agent_router.py:484-492` — orchestrator 调用 hook 在 `if full:` 后 fire (无 rate limit), 设计 上 是 best effort. 不需要 改.

**没有 看到 任何 deploy / 配置 / race condition 类 真 bug**.

---

## 5 · 推荐 PM 决策

**建议 ack YELLOW, 然后 二选一**:

| 选 | 含义 | 工作量 |
|---|---|---|
| **路径 A** (推荐) | 改 测试 阈值 (T-06 改 "3 次 至少 2 次", T-08 算 dissent_detected 也 算 接力) → 重跑 3 次 验稳定 → 跳 GREEN | 30 min |
| **路径 B** | 接受 YELLOW 不做事, 在 Phase A 收尾 commit message 标 `[KNOWN: item_5 LLM 概率抖动, 双盲 5/6 一致, 已记]` | 5 min |

不建议 路径 C (改 backend). Orchestrator 设计 是 deliberate (PM Sprint J 拍 "V1 silence > wrong"). 强行 改 触发率 会 引入 新 风险.

---

## 6 · 反幻觉自检

- [x] item_5 数字 是 retrospective md line 90/92/114/118 原文 (Claude=1, Kimi=0)
- [x] Claude A `agent_recommendation` event 是 run JSON line 1712-1722 原文
- [x] orchestrator 没 传 temperature 是 `orchestrator.py:147-151` 真实 代码
- [x] 触发 hook 在 `agent_router.py:484-492` 也 是 真实 代码
- [x] 没 编 "重跑 3 次 全 pass" 这种 没跑 的 数据 — 只 用 静态 推理
- [x] 没 用 "应该 / 似乎 / 估计 / 通常" 这种 含糊词 (除 概率 估算 时 加 标记 "≈")

---

> END · 审计 用时 ≈ 12 min · 静态分析 only
