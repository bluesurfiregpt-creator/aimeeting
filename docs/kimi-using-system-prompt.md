# 给 Kimi 的 操作 提示词 — 怎么 聪明 地 用 Aimeeting + 截 出 让 客户 信 的 截图

> 这 是 跟 主 脚本 [kimi-manual-script.md](./kimi-manual-script.md) 配套 的 提示词.
> 主 脚本 告诉 你 写 什么; 这 份 告诉 你 怎么 操作 系统 + 截 好 截图.
>
> 一句话 心法: **不要 像 第一 次 用 软件 那样 乱 点 — 像 一个 已经 用 了 三个月 的 老用户 那样 顺 手 操作, 截图 才 像 真实 业务 而 不 是 demo**.

---

## 1. 进 系统 前 的 5 个 心理 准备

1. **你 不 是 试用 — 你 是 在 演示**. 每 一 屏 都 想象 客户 在 看. 别 截 加载中 / 空状态 (除非 必要).
2. **真实 业务 数据 已 灌 好** — workspace「福田 物业 demo」有 5 个 物业 主题 AI / 3 场 已结束 会议 / 1 场 进行中 / 待审 草稿 / 已入 记忆 全套. 不要 自己 创建 测试 数据 ("test 1" "asdf"), 用 现成 的.
3. **多 角色 同时 开** — 用 Chrome 普通 窗口 + 隐身 窗口 + Firefox, 同时 登 owner / leader / expert 三个 账号. 截 不同 角色 视角 时 不用 反复 登出.
4. **截图 先 想 章节**. 你 写 第 5 章 智能 主持 → 你 要 看到 banner. 先 触发 banner (用 dev/inject), 再 截.
5. **不 确定 时 先 看, 不 要 改**. 进 任一 页面 先 翻 一 圈, 看 数据 长 啥 样, 再 决定 截 哪 块.

---

## 2. 浏览 前 — 先 把 这 几个 东西 摆 出来

### 2.1 三 个 浏览器 / 标签

| 角色 | 干嘛 用 | 邮箱 | 密码 |
|------|---------|------|------|
| **owner** (主) | 截 主页 / AI 详情 / KB / 已入 Memory / 进 任一 会议 | bluesurfiregpt@gmail.com | aimeeting123 |
| **leader** (隐身) | 截 召集人 视角 + 待办 + 推进 议程 | demo.lijg@futian.gov.cn | demo123 |
| **expert (manager)** (Firefox) | 截 审批中心 + 草稿 编辑 / 拒绝 弹窗 | demo.fengl@futian.gov.cn | demo123 |

### 2.2 owner 的 cookie 提前 抄 出来

后面 §5 触发 banner 要 用 curl, 需要 owner 的 `aimeeting_session` cookie:

1. owner 浏览器 进 `https://aimeeting.zhzjpt.cn` 登 完
2. F12 → Application → Cookies → `https://aimeeting.zhzjpt.cn`
3. 找 `aimeeting_session`, 双击 Value 列, Ctrl+C 抄出
4. 存 在 你 旁边 的 文本 文件: `COOKIE='aimeeting_session=eyJ...'` (会 比较 长)

### 2.3 截图 工具 + 命名

- 截图 工具: 你 平台 自带 即可 (mac: Cmd+Shift+4, win: Win+Shift+S)
- 保存 到 一个 `images/` 文件夹
- 命名: `screen-{编号}-{描述}.png`, 例 `screen-01-home.png` `screen-15-banner-confirmed.png`
- 跟 主 脚本 §8.1 表格 一一 对应 (19 张 必截)

---

## 3. 截 主页 + AI 详情 (5 分钟 上手 路径 A)

### 3.1 主页 全景 (截 1)

```
1. owner 进 https://aimeeting.zhzjpt.cn
2. 等 页面 完全 渲 完 (大标题 + AI 卡 grid 全 显)
3. 截 整 屏 (含 顶部 chrome + sidebar + 中央 卡片)
```

**截图 时 注意**:
- 看 sidebar 第 2 块 "🤖 我的 AI 团队" — 应 显 5+ 个 AI 卡片 (数小妙 / 法老张 / 运营李 / 财王哥 / 服务赵姐 + 主持人)
- 卡片 应 显 "N 次使用" — 不 是 0 (如果 都 0, 见 §7 求助)
- 顶部 NotificationBell 可能 有 角标 (待审 N) — 这 是 好 事, 别 点 灭 它

### 3.2 AI 详情 multi-tab (截 2)

```
1. 点 任一 AI 卡片 (推荐 数据洞察 / 法老张 — 内容 最 满)
2. 等 4 个 tab 全 加 完 (工卡 / 知识 / 记忆 / 履历)
3. 默认 工卡 tab — 截 一张 (含 全身像 + 工卡 + 三 stat chip)
4. 点 履历 tab — 列 出 这 AI 参与 过 的 会议 (应 有 2-3 场) — 再 截 一张
```

**重点 看**: hero 右侧 三 chip "📣 召唤 N 次 / 💬 发言 N 行 / 🎙️ 参与 N 场" — 数字 都 不应 为 0.

---

## 4. 截 待办 + 全链 溯源 (★ 路径 B — 必 走)

这 是 用户 最 强 调 的 章节. 把 它 做 漂亮.

### 4.1 找 含 待办 的 会议

```
1. owner OR leader 进 sidebar "🎙️ 会议系统 → 历史会议"
2. 找 status="已结束" 或 "已沉淀" 的 会议, 推荐:
   - "Q1 业主 投诉 处理 评估 会"  (含 3 条 action items)
   - "电梯 改造 方案 决策 会"      (含 3 条 action items)
3. 点 进 → 自动 跳 minutes tab
```

### 4.2 截 待办 卡 + evidence (截 7)

```
1. minutes tab 拉 到 "待办 / Action Items" 卡
2. 应 显 3 条 真实 业务 待办 (例 "更换 B 栋 电梯 维保 公司")
3. 每 条 下方 应 显 evidence_quote 短摘要 (灰色 小字)
4. 截 整 个 待办 卡
```

### 4.3 跳 实录 看 上下文 (截 8) ★

```
1. 选 一 条 待办 (推荐 "更换 B 栋 电梯 维保 公司"), 找 它的 evidence 旁边 的
   "查看 实录上下文 →" 链 (or 类似 文字)
2. 点 → 应 自动 跳 转 到 实录 tab + URL 加 ?focus=<line_ids>
3. 等 滚动 完成, 那 几 行 应 高亮 + 上下 ±3 句 自动 展开
4. 截 实录 高亮 区 + 上下文
```

**给 客户 解 释 的 点** (你 写 章节 时 用):
- 这 不 是 AI 编 的 待办 — 是 第 N 行 真人 对话 直接 抽 出 的
- 你 不 信 AI 时 一键 验证 — 这 是 黑 箱 vs 透明 的 本质 区别
- 半年 后 复盘 这 条 待办 仍 能 跳 回 原话

---

## 5. 截 KB + 长期 经验 (★★ 路径 C — 必 走)

用户 强调 的 第二 大 重点.

### 5.1 KB 详情 (截 9, 10)

```
1. owner sidebar "🧠 知识与经验 → 知识库 (📚 书架)"
2. 列出 KB. 找 "福田 物业 法规 + SOP 知识库" (seed 出 的)
3. 点 进 → 看 文档 列表 (应 显 3 个文档)
4. 截 KB 详情 (含 文档 列表 + 描述 + chunk 数)
5. 点 任一 文档 → 看 chunk 内容 → 截 一张
```

### 5.2 已入 Memory + 出处 chip (截 11, 12) ★

```
1. owner sidebar "🧠 知识与经验 → 长期记忆 (🧠 经验)"
2. 列出 已入 Memory. 找 一条 含 "📝 来自 N 句 → 看 上下文" chip 的
   (推荐: "Q1 投诉 同比 上升 时, 优先 看 单栋 + 单分类 异常 集中..." — 数据洞察 的)
3. 截 一张 Memory 卡 (含 chip)
4. 点 chip → 跳 转 到 半年 前 的 实录 → 高亮 那几行
5. 截 实录 高亮 截图
```

**给 客户 解 释 的 点**:
- AI 半年 后 用 这条 经验 时, 你 一键 验证 来源
- 这 比 "AI 推荐, 信 / 不信" 强 100 倍 — 信 任 建立 在 透明 上, 不 是 概率

### 5.3 审批中心 + inline 编辑 (截 13, 14)

```
1. expert (demo.fengl) 进 sidebar "🧠 知识与经验 → 审批中心"
2. 应 显 顶部 数字 badge — 物业运营 (运营李) AI 应 有 待审 草稿
   (NULL 时 切换 owner 账号 看 — 数据洞察 / 政策法规 / 财务核算 各有 1+ 待审)
3. Memory pending tab → 应 列 出 草稿
4. 点 一条 → dialog 弹
5. 截 dialog 截图 (含 编辑 按钮 ✏️)
6. 点 ✏️ 编辑 → textarea + slider 出来 → 改 几个 字 → 截 编辑 模式 截图
7. 不 一定 真 通过 (会 影响 后续 截图 — 草稿 数 会 减少). 你 截 完 关 dialog 即可.
```

---

## 6. 截 会议室 智能 主持 (★ 路径 D — 用 dev/inject 触发)

这 是 系统 最 闪 的 一节. 必须 截 3-4 张 banner.

### 6.1 找 进行中 会议

```
1. owner sidebar "🎙️ 会议系统 → 历史会议"
2. 找 status="进行中" 的 会议 — 应 有 一场 "本周 物业 周例会 (进行中)"
3. 进 入 → 应 看到 顶部 倒计时 + 议程 strip + AI 头像 + 5 行 transcript
4. URL 复制 — 提 取 meeting_id (例 "abc-def-...")
5. 截 一张 整 个 会议室 主界面 (截 4) — 含 顶部 chrome + 议程 strip + 主对话区
```

### 6.2 触发 三档 偏题 banner

```bash
# 用 owner cookie + meeting id
COOKIE='aimeeting_session=<owner cookie>'
MID='<进行中 会议 id>'

# === 触发 1: confirmed 偏题 (中等 amber banner) ===
curl -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_off_topic",
    "off_topic_severity":"confirmed",
    "off_topic_summary":"在聊 周末 团建 安排, 当前 议程 是「本周 重点 工作」",
    "current_agenda_item":"本周 重点 工作"
  }'
```

→ 浏览器 应 出现 amber banner. **截 15** (confirmed 偏题 banner)

```bash
# === 触发 2: severe 偏题 (全屏 modal + 倒计时) ===
curl -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_off_topic",
    "off_topic_severity":"severe",
    "off_topic_summary":"已 严重 偏离 — 整 整 8 句 在 聊 别公司 八卦",
    "auto_summon_after_s":15
  }'
```

→ 应 出 全屏 紫红 modal + 倒计时. **截** (人工 补图 标 — 主 脚本 §8.1 列了)

注: severe modal 8s 后 自动 召唤 — 你 截 完 立刻 点 "忽略" 取消, 别 让 它 真召唤 (会 让 真 AI 发言 影响 后续 截图).

### 6.3 触发 决策 收口 紫色 banner (截 16, 17) ★

```bash
curl -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_decision_summary",
    "decision_brief":"客服 招聘 vs 改流程 两个 思路 没人 拍板",
    "decision_summary_query":"请你 作为 主持人, 帮 大家 把 「招 1 个 客服」 vs 「改 现有 流程 提效率」 两 个 思路 列 一下 — 各 自 优势 / 风险 / 适用 场景, 建议 锁定 一个.",
    "current_agenda_item":"本周 重点 工作",
    "auto_summon_after_s":15
  }'
```

→ 紫色 banner 出现. **截 16**.

→ 等 ~15s 主持人 自动 用 query 发言 → **截 17** (lines 区 多 一段 长 主持人 发言)

### 6.4 触发 推进 建议 (emerald banner) — 选做

```bash
curl -X POST "https://aimeeting.zhzjpt.cn/api/meetings/$MID/dev/inject-monitor-event" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{
    "event_type":"agenda_advance_suggested",
    "advance_reason":"客服 招聘 + 满意度 调查 都 已 决策, 这项 可收",
    "current_agenda_item":"本周 重点 工作",
    "next_agenda_item":"难点 讨论"
  }'
```

→ 主对话 区 顶部 出 emerald banner — 截 一张.

---

## 7. 截 议程 进度 + 推进 (路径 E)

### 7.1 议程 strip 全态 (截 18)

```
1. 已 在 进行中 会议 (路径 D 同 一场)
2. 顶部 chrome 下方 应 看到 议程 strip:
   ✓ 上周 收尾 复盘 (10m)  →  ● 本周 重点 工作 (X/20m)  →  ○ 难点 讨论 (-/15m)
3. 截 整 个 strip (含 三 项 + 不同 状态)
```

### 7.2 推进 议程 (截 19)

```
1. 同 strip — owner 点 末尾 [推进 →] 按钮
2. 状态 应 即时 变: 第 2 项 转 ✓, 第 3 项 转 ●
3. 截 推进 后 strip 状态
```

---

## 8. 截 本场 收获 (路径 A 截 6)

### 找 一场 已结束 会议 (推荐 "电梯 改造 方案 决策 会")

```
1. 进 → 自动 跳 minutes tab → 顶部 应 显 "🎁 本场 收获" panel
2. 应 显 3 张 stat 卡 (Action Items / Memory 草稿 / KB 草稿 各 N)
3. 截 整 个 panel
4. 点 任一 stat 卡 (例 Memory 草稿) → 应 展开 显 列表
5. 截 展开 后 截图
```

---

## 9. 截 全景 时间线 (chap 11 用)

```
1. 同 一场 已结束 会议 (推荐 "电梯 改造")
2. minutes tab 拉 到 HarvestPanel 下方 → 应 显 "🕒 全景 时间线" panel
3. 应 列 8-15 行 (议程 起止 + AI 事件 + 用户 操作)
4. 截 整 panel
```

---

## 10. 通用 截图 红线 (你 必 守)

| 别 | 该 |
|----|----|
| 截 加载中 (空 框 + spinner) | 等 加载 完 再 截 |
| 截 错误 toast (例 "操作 失败") | 错误 修 完 再 截; 真 显 不 出 时 跳过 |
| 截 dev tools / network 面板 | 关 它 再 截 |
| 截 真 邮箱 / 全名 (即使 demo) | 必要 时 PS 打 个 ▓ |
| 自己 截图 + 顺手 试一下 一些 操作 | 操作 前 想: 这 会 不 会 改 数据 影响 别 的 截图 (例 真 通过 草稿 → 后面 草稿 数 -1) |

**安全 操作** (放心 做): 看 / 切 tab / 跳页 / 点 chip / 点 hover / 调 slider 不 保存 / 进 dialog 又 关 dialog
**风险 操作** (做 前 想想): 真 通过 / 真 拒绝 / 真 advance 议程 / 真 删 / 真 编辑 保存

如果 你 必 操作 (例 截 P7.1 inline 编辑 时 必 进 编辑 模式) — 优先 用 "取消 编辑" 退出 不 改, 截图 完成.

---

## 11. 你 在 写 手册 时 的 节奏 建议

不要 一口气 写 完 11 章. 分 三 轮:

### 轮 1: 截图 + 草稿 (60 分钟)
- 跑 完 §3 ~ §9 全 套 截图
- 给 每 张 截图 写 一句 caption (图 N: ...)
- 给 每 章 写 提纲 (3-4 行 关键 点)

### 轮 2: 填 内容 (90 分钟)
- 按 主 脚本 §7 大纲 填 各 章 文字
- 用 §10 名词 表 (KB→书架, Memory→大脑, RAG→翻 它的 书)
- 第 6 / 7 / 8 章 多 花点 时间 — 这 是 用户 强 调 重点

### 轮 3: 校对 + 自检 (30 分钟)
- 走 一遍 主 脚本 §13 完工 自检 清单
- 检 字数 / 截图 数 / 红线 (没 露 账号 / 没 用 "可能 / 应该")
- 提交 + 末尾 列 你 的 问题 让 人工 答

---

## 12. 卡 住 时 的 求助 路径

写 不下去 / 截图 截 不 出 / 系统 行为 跟 脚本 说 的 不 一致 时, 在 输出 文件 末尾 加 一节 `# 给 人工 的 问题`, 列 你 的 问题. 例:

> ## 给 人工 的 问题
>
> 1. **截图 编号 12 截 不到** — 我 跟 路径 C 走 进 Memory 列表 但 没 找 到 含 chip 的 条. 是 不 是 demo 数据 没 灌 完?
> 2. **第 6 章 想 加 一个 任务 流转 全景 截图** — 系统 哪 里 看 任务 流转? 我 没 找 到 入口.
> 3. **dev/inject 触发 severe modal 后 8s 内 没 截 完 banner 就 自走 了** — 有 办法 把 倒计时 调 长 吗?

人工 会 帮 你 答 + 补 截图 + 调 数据.

---

## 13. 一句 总结 提醒

**你 写 的 不 是 软件 文档. 是 一份 让 客户 心动 的 物料.**

- 客户 看 完 第 3 段 还 没 兴 趣 → 后面 都 白写
- 截图 不 美 / 不 真实 → 客户 觉得 你 在 凑数
- 第 6 / 7 / 8 章 (待办溯源 / KB / Memory) 没 写 透 → 系统 核心 价值 没 立住

写 出 那种 让 政府 / 国企 中层 看 完 想 立刻 给 信息中心 转 的 文档.

加油 Kimi.
