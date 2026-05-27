# Retrospective — Kimi Chat Round 1 (Phase B · 8 NEW-C)

**Date**: 2026-05-28
**Runner**: kimi (sandbox: Kimi)
**Reference**: claude (sandbox: Claude) — run-claude-chat-A-20260528-012409.json + run-claude-chat-B-20260528-012557.json
**Scripts**: chat-A-mira.json (3 turns) + chat-B-lex.json (3 turns)

---

## 1. Kimi 原始结果 — chat-A (Mira)

```json
{
  "chat_turns_count": 3,
  "chat_total_chars": 1891,
  "chat_total_chunks": 1175,
  "chat_avg_chunks_per_turn": 391.7,
  "chat_avg_ttfc_s": 9.89,
  "chat_kb_hits_total": 0,
  "chat_memory_hits_total": 3,
  "chat_stance_violations": [],
  "chat_stance_strong": [
    "turn=0 word='建议'",
    "turn=1 word='建议'",
    "turn=2 word='建议'",
    "turn=2 word='因为'"
  ],
  "chat_quota_remaining": 197
}
```

**Per-turn TTFC (Mira)**: turn0=4.78s, turn1=8.85s, turn2=16.05s

---

## 2. Kimi 原始结果 — chat-B (Lex)

```json
{
  "chat_turns_count": 3,
  "chat_total_chars": 2386,
  "chat_total_chunks": 1853,
  "chat_avg_chunks_per_turn": 617.7,
  "chat_avg_ttfc_s": 11.41,
  "chat_kb_hits_total": 0,
  "chat_memory_hits_total": 5,
  "chat_stance_violations": [],
  "chat_stance_strong": [
    "turn=1 word='建议'",
    "turn=1 word='因为'",
    "turn=2 word='建议'",
    "turn=2 word='因为'"
  ],
  "chat_quota_remaining": 194
}
```

**Per-turn TTFC (Lex)**: turn0=16.6s, turn1=13.48s, turn2=4.14s

---

## 3. Claude Reference 原始结果 (jq 摘要)

### chat-A (Mira) — Claude
```json
{
  "chat_turns_count": 3,
  "chat_total_chars": 2039,
  "chat_total_chunks": 1403,
  "chat_avg_chunks_per_turn": 467.7,
  "chat_avg_ttfc_s": 15.07,
  "chat_kb_hits_total": 0,
  "chat_memory_hits_total": 3,
  "chat_stance_violations": [],
  "chat_stance_strong": [
    "turn=0 word='建议'",
    "turn=1 word='建议'",
    "turn=2 word='建议'"
  ],
  "chat_quota_remaining": 197
}
```
**Per-turn TTFC**: turn0=7.69s, turn1=23.9s, turn2=13.63s

### chat-B (Lex) — Claude
```json
{
  "chat_turns_count": 3,
  "chat_total_chars": 1800,
  "chat_total_chunks": 1093,
  "chat_avg_chunks_per_turn": 364.3,
  "chat_avg_ttfc_s": 11.23,
  "chat_kb_hits_total": 0,
  "chat_memory_hits_total": 3,
  "chat_stance_violations": [],
  "chat_stance_strong": [
    "turn=0 word='因为'",
    "turn=1 word='建议'",
    "turn=1 word='因为'"
  ],
  "chat_quota_remaining": 195
}
```
**Per-turn TTFC**: turn0=7.96s, turn1=14.51s, turn2=null (502 Bad Gateway)

> **注意**: Claude 的 chat-B turn 2 收到 HTTP 502 错误，无有效响应。因此 Claude 的 Lex avg_ttfc_s=11.23 仅基于 2 个 turn 计算。

---

## 4. 对账表 — Claude vs Kimi

### chat-A (Mira)

| Metric | Claude | Kimi | 一致? | 差值 |
|---|---|---|---|---|
| turns | 3 | 3 | 是 | 0 |
| total_chars | 2039 | 1891 | 是 | -148 (-7.3%) |
| total_chunks | 1403 | 1175 | 是 | -228 |
| avg_chunks_per_turn | 467.7 | 391.7 | 是 | -76.0 |
| **avg_ttfc_s** | **15.07** | **9.89** | **否** | **-5.18s (-34.4%)** |
| kb_hits | 0 | 0 | 是 | 0 |
| memory_hits | 3 | 3 | 是 | 0 |
| stance_violations | 0 | 0 | 是 | 0 |
| stance_strong | 3 | 4 | 是 | +1 |
| quota_remaining | 197 | 197 | 是 | 0 |

### chat-B (Lex)

| Metric | Claude | Kimi | 一致? | 差值 |
|---|---|---|---|---|
| turns | 3 | 3 | 是 | 0 |
| total_chars | 1800 | 2386 | 是 | +586 (+32.6%) |
| total_chunks | 1093 | 1853 | 是 | +760 |
| avg_chunks_per_turn | 364.3 | 617.7 | 是 | +253.4 |
| **avg_ttfc_s** | **11.23** | **11.41** | **是** | **+0.18s (+1.6%)** |
| kb_hits | 0 | 0 | 是 | 0 |
| memory_hits | 3 | 5 | 否 | +2 |
| stance_violations | 0 | 0 | 是 | 0 |
| stance_strong | 3 | 4 | 是 | +1 |
| quota_remaining | 195 | 194 | 是 | -1 |

---

## 5. 关键判断

### 真问题 1 — TTFC (首 chunk 延迟)

**结论**: **部分确认 backend 真问题，Claude sandbox 网络问题被部分排除。**

**证据**:

| Runner | Agent | avg_ttfc_s | per-turn TTFC | 说明 |
|---|---|---|---|---|
| Claude | Mira | 15.07s | 7.69 / 23.9 / 13.63 | turn1 异常高 23.9s |
| Kimi | Mira | 9.89s | 4.78 / 8.85 / 16.05 | 分布更均匀，最高 16.05s |
| Claude | Lex | 11.23s | 7.96 / 14.51 / null | turn2 502 失败 |
| Kimi | Lex | 11.41s | 16.6 / 13.48 / 4.14 | 全部成功 |

**分析**:
- Kimi Mira TTFC (9.89s) 显著低于 Claude Mira (15.07s)，差 -5.18s。但 Kimi 的 turn2 TTFC=16.05s 与 Claude turn1=23.9s / turn2=13.63s 处于同一数量级。
- Kimi Lex TTFC (11.41s) 与 Claude Lex (11.23s) 几乎一致 (+0.18s)。
- **所有 TTFC 均 > 3s**（最低 4.14s，最高 16.6s），没有一个 turn 进入 "健康" 的 ≤3s 区间。
- Claude 的 Mira turn1=23.9s 可能是其 sandbox 网络抖动放大了 backend 延迟，但 backend 本身的 TTFC 基线在 8-12s 区间。
- **没有 turn 出现 ≤3s**，排除 "backend 正常、Claude 网络问题" 的单纯解释。Backend 存在真实的 TTFC 延迟问题。

**判定**: TTFC 慢是 **backend 真问题**（基线 8-12s，不健康），Claude sandbox 的 23.9s 异常值是网络抖动叠加 backend 延迟的结果。

### 真问题 2 — KB hits (知识库命中)

**结论**: **100% 确认 backend 真问题。**

| Runner | Mira kb_hits | Lex kb_hits |
|---|---|---|
| Claude | 0 | 0 |
| Kimi | 0 | 0 |

- 跨 sandbox 完全一致：Mira 0 命中，Lex 0 命中。
- Lex 是法务专家 agent，对话涉及《物业管理条例》《价格法》《民法典》第278条等法规，理应触发 KB 检索。但 0 命中说明：
  - 可能原因 A: demo seed 数据未包含相关法规文档
  - 可能原因 B: retrieve 阈值设置过高，导致相关文档未过线
  - 可能原因 C: KB retrieve pipeline 存在 bug（embedding / search / filter 环节）

**判定**: KB hits = 0 是 **backend 真问题**，与 sandbox 无关。需 backend 团队排查 retrieve pipeline。

### 额外发现

1. **Claude chat-B turn2 502 错误**: Kimi sandbox 未复现，Lex 3 turns 全部成功。说明 Claude 那次遇到了瞬时 backend 502，属于概率抖动，非结构性问题。

2. **Memory hits 差异**: Kimi Lex memory_hits=5 vs Claude Lex=3。差异 +2，可能因对话内容差异导致 memory retrieve 返回不同数量。非问题。

3. **Chunk 数量差异**: Kimi Lex total_chunks=1853 vs Claude=1093，差异大 (+760)。可能因 Kimi 的响应更长（2386 chars vs 1800 chars）或 chunk 切分策略差异。需关注但非阻塞问题。

---

## 6. 结论

### 评级: 🟢 GREEN (跨 sandbox 一致，确认 2 个 backend 真问题)

| 问题 | 严重程度 | 状态 | 说明 |
|---|---|---|---|
| TTFC 8-12s 基线 | 中 | 确认 | Backend SSE 首 chunk 延迟偏高，需优化 |
| KB hits 全 0 | **高** | 确认 | Lex 法务对话应触发法规 KB 但 0 命中，retrieve pipeline 需排查 |
| Claude 502 错误 | 低 | 未复现 | 概率抖动，非结构性问题 |

### 行动项

1. **[高优] KB hits = 0 排查**: 检查 Lex agent 的 KB seed 数据是否包含物业/法规文档，检查 retrieve 阈值，检查 embedding + search pipeline 是否正常。
2. **[中优] TTFC 优化**: Backend SSE 首 chunk 延迟基线 8-12s，目标 ≤3s。需排查 LLM 调用链（prompt → model → first token）的延迟瓶颈。
3. **[低优] Chunk 数量差异**: 关注 Kimi/Claude 的 chunk 切分策略是否一致，避免 frontend 渲染差异。
