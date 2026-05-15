# 给 Kimi 的 第 1 轮 反馈 答复

> 你 列 的 6 处 补图 + 3 个 遗留问题, 这里 一个 个 给 答案 + 操作 步骤.
> 完 后 请 你 重 跑 第 5 章 (智能 主持) + 第 9 章 (审批 中心) 相关 截图, 其余 章节 留 着.

---

## 🟢 问题 1: dev/inject API 500 — **已修, 重 试 即可**

### 根因
我 老 代码 写 `auth.role != "owner"`. 但 AuthContext 没 `role` 属性 (它 只有 user / workspace), 所以 直接 AttributeError → 500.

### 修复
已 改 用 `is_leader_or_admin()` 标准 权限 helper. owner / admin / leader 三 个 角色 都 可 调.

### 你 操作

**前置**: owner 浏览器 已 登 + 抄 出 `aimeeting_session` cookie.

#### 1.1 触发 confirmed 偏题 (amber banner)

```bash
COOKIE='aimeeting_session=<你 owner cookie>'
MID='<本周 物业 周例会 — 进行中 — 的 id>'   # 见 §3 怎么 找

curl -sS -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_off_topic",
    "off_topic_severity":"confirmed",
    "off_topic_summary":"在聊 周末 团建 安排, 当前 议程 是「本周 重点 工作」",
    "current_agenda_item":"本周 重点 工作",
    "reason":"已 偏离 议程 — 大家 转 去 聊 周末 团建"
  }' | jq
```

预期 返回 `{"ok":true,"injected":{...}}` (HTTP 200). 浏览器 该 会议室 顶部 应 出现 amber banner. **截图**.

#### 1.2 触发 决策 收口 (紫色 banner + 倒计时)

```bash
curl -sS -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_decision_summary",
    "decision_brief":"招客服 vs 改流程 没人 拍板",
    "decision_summary_query":"请你 作为 主持人, 帮 大家 把 「招 1 个 客服」 vs 「改 现有 流程 提效率」 两 个 思路 列 一下 — 各 自 优势 / 风险 / 适用 场景, 建议 锁定 一个.",
    "current_agenda_item":"本周 重点 工作",
    "auto_summon_after_s":15,
    "reason":"出现 多个 立场 等 收口"
  }' | jq
```

紫色 banner + 15s 倒计时 chip. **立刻 截图** (倒计时 跳 那张 + 倒计时 chip 截到).

#### 1.3 主持人 自动 发言 (倒计时 走 完 后)

紧接 1.2 — 不 要 dismiss banner, 等 ~15s. 主持人 AI 应 自动 在 lines 区 发 一段 长 总结. **截图 lines 区 的 主持人 发言**.

提醒: 这 是 真 LLM 调用 — 等 几秒. 若 30s 后 还 没 出, 看 backend logs (可 提 给我 排查).

---

## 🟢 问题 2: 审批中心 空 状态 — **不是 bug, 是 ABAC. 改 登录 账号**

### 根因
审批中心 严守 ABAC: **只 显 当前 用户 manage 的 AI 的 草稿**. 你 用 owner (bluesurfire) 看 是 空 — 因为 owner 只 manage 一个 AI (数据洞察), 它 的 草稿 已 自动 入库 (approved).

### 现状 (DB 实测)
4 条 pending 草稿 分别 归 这 3 个 账号 审 (不 是 owner):

| 审批人 | 邮箱 | 密码 | 看 得到 几 条 草稿 |
|--------|------|------|--------|
| **陈师宇 (admin)** | demo.chensy@futian.gov.cn | demo123 | **2 条** (政策法规 AI 抽的) |
| **李局长 (leader)** | demo.lijg@futian.gov.cn | demo123 | **1 条** (财务核算 AI 抽的) |
| **韩雪 (member)** | demo.hanx@futian.gov.cn | demo123 | **1 条** (客户服务 AI 抽的) |

### 你 操作

**用 陈师宇 账号** 截 P7.1 inline 编辑 + P7.4 拒绝 二选一 (这 账号 有 2 条 草稿, 最 富):

```
1. 隐身 窗口 → /login → demo.chensy@futian.gov.cn / demo123
2. 进 sidebar "🧠 知识与经验 → 审批中心"
3. Memory pending tab — 应 显 2 条 (政策法规 抽的 经验)
4. 点 一条 → dialog 弹 → 截 dialog 截图
5. 右上 ✏️ 编辑 按钮 → 点 → textarea + 重要度 slider 出来 → 截 编辑 模式 截图
6. 不 真 保存 通过 — 截图 完 关 dialog (会 影响 后续 草稿 数 减少)
```

**用 韩雪 账号** 截 P7.2 批量 操作 (虽 它 只 有 1 条 草稿 — 演示 多选 不够). 解决 方案: 不 用 草稿 数 凑 — 截 sticky bar **不需要 真 多条 草稿**, 你 单选 1 条 时 sticky bar 就 出现.

```
1. 隐身 → demo.hanx@futian.gov.cn / demo123 → 审批中心
2. Memory pending tab → 看 到 1 条 (B 栋 电梯 维保...)
3. 勾 它 旁边 的 checkbox
4. 底部 应 出 sticky bar (已选 1 条 + 全选 + 批量通过 + 驳回 + ✕)
5. 截 sticky bar + 行 高亮 状态
6. 不 真 通过, 关 浏览器 即可
```

**拒绝 二选一 弹窗** (P7.4):

```
1. 仍 在 韩雪 / 陈师宇 任一 账号 + 草稿 dialog 内
2. 点 "驳回..." 按钮
3. 弹 二 radio 选项: 🗑 弃用 / ↩ 退回 LLM
4. 切 一下 radio (placeholder 会 变) — 截 两 张 (各 一态)
5. 不 真 驳回, 关 dialog
```

---

## 🟢 问题 3: AI 发言 触发 — **走 @-mention OR 关键词 OR 直接 点 头像**

### 根因
AI 自动 触发 走 三 条 路:
1. **@-mention** — 用户 发言 含 `@AI名` (例 `@数小妙 帮 看 数据`)
2. **关键词** — 用户 发言 含 AI 的 keyword (例 数据洞察 的 keywords 含 "数据"/"报表"/"KPI")
3. **手动 点 头像** — 跟 IM 表情 包 同套, 最 直接

普通 一句 闲话 (没 @ 没 keyword) 不会 触发. 这 是 设计 — 防 AI 抢话.

### 你 操作 (推荐 第 3 条 — 截图 最 稳)

```
1. 进 进行中 会议室 (本周 物业 周例会)
2. 看 顶部 chrome 第 2 行 — 应 显 3 个 AI 头像 (数据洞察 / 物业运营 / 客户服务)
3. 直接 点 数据洞察 头像
4. lines 区 应 立刻 显 它 在 "💬 思考中"
5. 3-8s 后 应 显 它 的 一段 发言 (含 KB 引用 [1] [2] 角标 如果 触发 了 RAG)
6. 截 "AI 发言 中" 状态 + 截 完成 后 含 citation 的 截图
```

### 想 试 keyword 触发 也行

文字 输入 框 输 一句 含 关键词 的 话:
- "帮 我 看 一下 Q1 投诉 **数据**" → 数据洞察 应 触发
- "维修 资金 **法规** 怎么 要求?" → 政策法规 应 触发
- "客服 这 个 **投诉** 怎么 处理?" → 客户服务 应 触发

提交 后 ~5s AI 应 自动 发言.

---

## 关于 6 处 <TODO 人工补图> 的 处理

修 完 1+2 后, 你 实际 能 自己 截 出 5 处, 仅 **1 处** 真 需要 人工:

| 编号 | 内容 | 现 可 截? |
|------|------|-----------|
| 偏题 confirmed amber banner | ✅ 修 后 你 自己 截 (问题 1.1) |
| 决策收口 紫色 banner + 倒计时 | ✅ 修 后 你 自己 截 (问题 1.2) |
| 主持人 自动 发言 | ✅ 修 后 你 自己 截 (问题 1.3) |
| inline 编辑 模式 | ✅ 改 账号 后 你 自己 截 (问题 2 — 用 陈师宇) |
| 拒绝 二选一 弹窗 / 批量 操作 栏 | ✅ 改 账号 后 你 自己 截 (问题 2 — 韩雪 OR 陈师宇) |
| AI 发言 含 [1][2] 引用 + hover | ⚠️ **真 RAG 触发 需 AI 引用 KB chunk** — 数据洞察 + 政策法规 都 绑 了 KB, 你 召唤 它们 时 大概率 会 引用. 若 一直 没 出现 [1][2] 角标, 标 <TODO 人工补图> 我们 后续 排查 RAG 路径. |

---

## §3 怎么 找 "进行中" 会议 id

方法 A — 浏览器:
1. owner 登 → sidebar "🎙️ 会议系统 → 历史会议"
2. 找 status="进行中" 的 "本周 物业 周例会 (进行中)"
3. 点 进 → URL 形如 `/meeting/<UUID>` — UUID 即 meeting id

方法 B — curl (不 推荐, 复杂):
```bash
curl -sS "https://aimeeting.zhzjpt.cn/api/meetings" -H "Cookie: $COOKIE" \
  | jq '.[] | select(.status == "ongoing") | {id, title}'
```

---

## 还 有 啥 问题 / 缺 数据 接着 告诉 我

灌 数据 + 修 bug 是 我 + 系统 这 边 的 事; 你 截图 + 写 文档 是 你 的 事. 卡 住 直接 列 出来.
