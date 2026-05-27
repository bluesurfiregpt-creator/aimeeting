# Retrospective — Claude Chat Round 2 KB Fix Verify (commit 1dfb428)

**Date**: 2026-05-28
**Runner**: Claude (自测, 验证 修复 是否 生效)
**Commit**: `1dfb428` `fix(v1.4.0 Phase B · 8 NEW-C KB hits=0): demo_seed_v2 加 KB seed`
**Scripts**: chat-A-mira.json (3 turns) + chat-B-lex.json (3 turns) — 同 Round 1 不变

> 注: 等 PM 跑 Kimi 同 剧本 Round 2 后, 把 跨 sandbox 对账 也 写到 这里.

---

## 1 · 对账 — Round 1 vs Round 2 (Claude self)

### chat-A (Mira)

| Metric | Round 1 Claude | Round 2 Claude | Δ |
|--------|---------------|----------------|---|
| `chat_turns_count` | 3 | 3 | 0 |
| `chat_total_chars` | 2039 | 2240 | +201 |
| `chat_avg_ttfc_s` | 15.07 | 10.78 | -4.29 |
| **`chat_kb_hits_total`** | **0** | **10** | **+10 🎉** |
| `chat_memory_hits_total` | 3 | 2 | -1 (normal jitter) |
| `chat_stance_violations` | 0 | 0 | 0 |
| `chat_stance_strong` 建议 | 3 turns | 3 turns | 0 (不回归) |

### chat-B (Lex)

| Metric | Round 1 Claude | Round 2 Claude | Δ |
|--------|---------------|----------------|---|
| `chat_turns_count` | 3 | 3 | 0 |
| `chat_total_chars` | 1800 | 2400 | +600 (回答 更详细, KB 引用 撑起来) |
| `chat_avg_ttfc_s` | 11.23 | 15.59 | +4.36 (jitter, TTFC 基线 仍 8-12s) |
| **`chat_kb_hits_total`** | **0** | **12** | **+12 🎉** |
| `chat_memory_hits_total` | 3 | 3 | 0 |
| `chat_stance_violations` | 0 | 0 | 0 |

---

## 2 · 关键 判断

### Fix 1 — KB hits 修复 ✅

**结论**: **修复完全 落地, GREEN.**

| 项 | Round 1 | Round 2 | 验证 |
|---|---------|---------|------|
| Lex `knowledge_base_ids` | `NULL` | `{64d9a268-...}` | psql 直接 confirm |
| KB · Lex 文档 | 0 | 3 docs / 5 chunks | psql confirm |
| KB · Lex 嵌入 完整率 | n/a | 5/5 (100%) | psql confirm |
| Lex chat kb_hits | 0 | 12 (4/turn avg) | runner 实测 |

Lex 回答 第 1 turn 引用 3 篇 文档 (《价格法 物业收费透明度》/《物业管理条例 投诉应答时限》/《民法典 业主权益》), 立场 鲜明 "有红线, 而且不止一条", 不和稀泥.

10 个 agent 全部 已 灌 KB (`kbs_created=10`, `kb_documents_created=30`, `kb_chunks_created=35`).

### Fix 2 — TTFC 优化 — 未动 (留作 单独 saga)

Round 2 TTFC 跟 Round 1 同量级 (8-15s 区间), 没改善 也 没恶化.
这是 LLM 调用链 (prompt → model → first token) 的 backend 优化问题, 跟 KB 修复 解耦.
建议 单独 起 saga 排查.

### 立场守门 不回归

Mira `stance_strong` 仍 3 turns 触发 "建议", Lex turn 1 触发 "因为" — 立场鲜明, 不和稀泥.

---

## 3 · 结论

### 评级: 🟢 GREEN — KB hits 修复 完全 落地

| 问题 | Round 1 严重 | Round 2 状态 |
|------|------------|------------|
| KB hits = 0 | 🔴 高 | ✅ 已修复 (Lex 12 / Mira 10 / 0 回归) |
| TTFC 基线 8-12s | 🟡 中 | 未动 (单独 saga) |
| Claude 502 (Round 1 偶发) | 🟢 低 | 未复现 |

### 行动项 (剩余)

1. **[中优] TTFC 优化** — 留作 单独 saga, 不阻塞 NEW-C 收尾
2. **[低优] 跨 sandbox 验证** — PM 跑 Kimi Round 2 同剧本, 把 Kimi metric 写到 retro 表 第 4 节 (待补)

---

## 4 · Kimi Round 2 跨端 对账 (待补)

PM 跑 `docs/kimi-tests/v1.4.0-phase-b-8-kb-fix-round2-kimi.md` 后, 把 Kimi 结果 贴 这.

```
| Metric | Claude R2 | Kimi R2 | 一致? |
|--------|-----------|---------|-------|
| Mira kb_hits | 10 | ?? | ?? |
| Lex kb_hits | 12 | ?? | ?? |
```

如 跨 sandbox 一致 (kb_hits 都 ≥ 10) → 双盲 GREEN, NEW-C 收尾.
