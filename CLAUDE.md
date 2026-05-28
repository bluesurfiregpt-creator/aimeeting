# Claude 工作守则 · Aimeeting 项目

## 部署 + 测试 流程(强制)

每次 commit + 部署 完成后,必须 顺手 产出一份 **Kimi 测试用例**,放在
`docs/kimi-tests/<版本号>-kimi.md`。

### 为什么
项目验收靠 Kimi 跑自动化,不是人工。所以用例必须给 Kimi 而不是给人,且需要 强反幻觉。

### Kimi 测试用例 模板(参考 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v26.3-05-kimi.md`)

1. **顶部 6 条死规矩**(反幻觉)
   - 只看真实页面 / 真实 HTTP 响应
   - 每步判定必须基于本步实际看到的数据
   - 复述要原文(带引号的精确字符串)
   - 不允许跳步(前一步 fail 则后续 BLOCKED)
   - 不允许编造账号
   - 每用例必须给 4 段:实际看到 / 判定 / 失败理由 / 证据

2. **环境 与 账号**
   - 入口 URL(根 + 涉及到的页面 + API)
   - 唯一账号表(邮箱 + 密码,字面常量)
   - 数据库前置假设(workspace 有 ≥N 个 expert / 有 ≥1 个 moderator / 等)

3. **预检 P-1 ~ P-N**
   - 服务器健康(curl 返回 200)
   - 后端 API 活(curl 返回 401 / 非 5xx)
   - 登录(看到主账号顶栏标识)
   - 任何 P-* fail → 后续 T-* 全 BLOCKED

4. **测试用例 T-01 ~ T-N**(每个含):
   - 前置(依赖哪些 P-* / T-*)
   - 目标(一句话)
   - 步骤(序号列表,精确到点哪个文字的按钮)
   - **Pass 条件**(可机器判定的字面值;HTTP 状态、JSON 字段、DOM 文字)
   - **Fail 条件**(列出常见误放行 / 误拦截 情景)
   - **必须复述**(截图 + 完整 JSON 原文,不允许总结)

5. **报告模板**(Kimi 按这个回)
   - 总结(pass/fail/blocked 计数 + GREEN/YELLOW/RED 结论)
   - 用例明细(每个用例 4 段)
   - 异常/观察(可选)

6. **反幻觉自检清单**(Kimi 提交前自查)
   - 没截图的步骤不允许声称"看到"
   - 不允许把 `phase: "running"` 写成 `phase = 运行中`
   - 不允许出现 `应该 / 通常 / 估计 / 似乎`
   - JSON 复述不允许省略字段

7. **已知不在本次范围**(列已知未实现项,避免 Kimi 误报)

### 命名约定
- 文件:`docs/kimi-tests/<版本号>-kimi.md`,例如 `v26.3-05-kimi.md`、`v26.3-06-kimi.md`
- 版本号:跟 commit 里的 `feat(v26.3-XX)` 一致
- 每次 commit + deploy 完成后,在告诉用户测试地址的同一条消息里,引用该用例文件路径

### 路径规范 — **强约束**(PM 多次提醒 sticky)

Kimi 跑在 sandbox 没有 cwd 上下文 → **任何 文件路径 / 命令 引用 必须 用绝对路径**.

1. **测试用例顶部** 必须 定义 `REPO_ROOT` 变量:
   ```bash
   export REPO_ROOT=/some/absolute/path/to/aimeeting
   ```

2. **所有 命令 + 文件 引用** 用 `$REPO_ROOT/...` 前缀:
   - ✅ `python3 $REPO_ROOT/scripts/runner.py --script $REPO_ROOT/docs/kimi-tests/...json`
   - ❌ `python3 scripts/runner.py` / `cd 后 用 相对路径`

3. **复述 / 输出 路径** 也 用 `$REPO_ROOT/...` 形式.

4. **给 PM 喂 Kimi 的 prompt** 同样规则 — 不允许 写 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/...` 这种 cwd-依赖.

详见 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` § 8.6.

### 触发时机(对 Claude 自己)
- 任何 `feat(*)` / `fix(*)` 落到生产 → 必产出
- 纯文档 / 纯 typo / 不影响外部行为 的改动 → 可跳过,但在 commit message 里写明 `[no-kimi-test]`
- 写 Kimi 用例 / 喂 Kimi prompt 第一步 — set `REPO_ROOT`,所有路径 加 `$REPO_ROOT/`

## 中文表达规范 — **强约束**(PM 多次提醒 2026-05-28 sticky)

PM 反馈:Claude 的 AskUserQuestion 选项 + 部分 commit message 出现"无规律空格 + 火星文 + 罕字错字",像文言文,读起来很怪。

### 4 条规则(违反 = 立刻自我 retract 重写)

1. **中文之间不加空格** — "你怎么选?" 而不是 "你 怎么 选?"。例外:数字、英文、专有名词周围(eg "Phase A · 7 项" 中点前后 可空)、commit message 标题 偶尔分块 OK,但 **AskUserQuestion 选项 + 用户聊天回复 一律 不加空格**。

2. **只用常用字** — 不允许"搳 / 咨 / 拚 / 梧 / 逆中 / 遵 / 担收 / 抵赖年 / 跑事 领域"这种罕字组合。所有动词、名词用常见词:看 / 查 / 跑 / 选 / 想 / 改。不确定时换说法。

3. **AskUserQuestion 写完 自查** — 在调用 tool 前 mental read 一遍 question + 每个 option label + description,**任何 一句 读起来 像 文言文 / 火星文 → 重写**。给用户的不是 commit message,是真人对话。

4. **commit message 也别 火星文** — 项目中文 commit 风格 可以"中文加空格 + 简洁",但 不允许 罕字。stick to 普通话 + 技术词。

### 反例(2026-05-28 触发 sticky 的真原话)

> PM 原话:"你 弹窗 让 我选择 那个 界面,出现了 你 以前 出现过的 文字 内容 有 很多 无规律 的 空格,同时 语言 的 表达 特别 奇怪,有点像 文言文,也 有点像 火星文,是 正常 的 表达 的 句子,我 不知道 是 出现 什么 问题 了。"

(注:PM 这条本身就 加空格 — 但他是反馈我的问题时被影响了,不代表我可以继续。)

### 触发时机

- 写 AskUserQuestion → 自查 1 遍才发
- 写 commit message → checked 没罕字、空格正常 才 git commit
- 写 用户聊天回复 → 同样 自查
- 写 代码注释 → 可以 中文加空格(项目历史风格),但 不允许 罕字

详见 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` § 8.8 (后续 升级 v1.2.4 写入).

## 测试账号(全项目共享)

> v1.3.1 角色对齐 (PM 拍板, 2026-05-26): owner → workspace_creator, manager → agent_owner.
> system_owner 走 env `PLATFORM_ADMIN_EMAILS` 白名单, 不入 membership 表.

| 角色 | 邮箱 | 密码 | 备注 |
|------|------|------|------|
| system_owner | `bluesurfiregpt@gmail.com` | `<SYSTEM_OWNER_PWD>` | 跨 ws 最高权, env 白名单. 同时也是 demo ws 的 workspace_creator (兼任) |
| leader | `demo.lijg@futian.gov.cn` | `demo123` | 局长, workspace 管理员 |
| admin | `demo.chensy@futian.gov.cn` | `demo123` | 物业科长 (科室级权限, 不改 AI/KB/memory) |
| agent_owner | `demo.fengl@futian.gov.cn` | `demo123` | 物业监管 AI 的 primary user (可改自己 AI 的 KB/memory) |
| member | `demo.hanx@futian.gov.cn` | `demo123` | 物业普通员工 (仅查看 + 发起会议) |

## 部署 入口
- 生产:`https://aimeeting.zhzjpt.cn`
- 部署命令:`bash deploy/rsync-up.sh --deploy`
- SSH host:`root@47.245.92.62`(SSH 进生产读 logs 需用户授权)
- SSH 注意:本机有 `aimeeting-new` host alias(`~/.ssh/config`),指向 `~/.ssh/aimeeting-new` 专用 key。如果默认 `~/.ssh/id_ed25519` 被服务器拒,用 `AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy`

## 风格守门协议(强制)

任何代码改动前(包括 review 阶段小改、debug 修复、subagent 委派等),必须:

1. **读 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` 当前最新版**(如果存在)
2. **检查**改动是否引入与 design system 冲突的视觉/交互
3. **如冲突**:
   - 优先按 design system 改
   - 不能按 design system 改的:commit message 标 `[STYLE-DEVIATION: 具体原因]` 给 PM
4. **如不冲突**:正常改

### 为什么(防漂移)
- review 阶段小改动最容易"借用现有代码风格" → 跟 design system 漂移
- v1.2.0 P1.2 折叠态用 dark mode 是典型反例(当时本应浅色化,但借了 AttachmentsSection 原有 dark token)
- 现有代码可能是**老风格**(浅色化前的),不要无脑借鉴

### 约束
- 不要因为"现有代码长这样"就照着写
- 不要因为"scope 严守"跳过 design system check —— scope 是"改哪些文件",不是"按什么风格"
- subagent 委派 prompt 必须 reference `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md`

### 触发时机(对 Claude 自己)
- 任何 `Edit` / `Write` 涉及 `*.tsx` / `*.css` / `*.ts` (UI 相关) → 先读 design system
- subagent prompt 必须明确"按 DESIGN_SYSTEM 实施"
- review 阶段我自己做小改动时:在 commit message 里 reference 用了 design system 的哪一节
