# Claude 工作守则 · Aimeeting 项目

## 部署 + 测试 流程(强制)

每次 commit + 部署 完成后,必须 顺手 产出一份 **Kimi 测试用例**,放在
`docs/kimi-tests/<版本号>-kimi.md`。

### 为什么
项目验收靠 Kimi 跑自动化,不是人工。所以用例必须给 Kimi 而不是给人,且需要 强反幻觉。

### Kimi 测试用例 模板(参考 `docs/kimi-tests/v26.3-05-kimi.md`)

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

### 触发时机(对 Claude 自己)
- 任何 `feat(*)` / `fix(*)` 落到生产 → 必产出
- 纯文档 / 纯 typo / 不影响外部行为 的改动 → 可跳过,但在 commit message 里写明 `[no-kimi-test]`

## 测试账号(全项目共享)

| 角色 | 邮箱 | 密码 | 备注 |
|------|------|------|------|
| owner / 召集人 | `bluesurfiregpt@gmail.com` | `aimeeting123` | workspace 拥有者 |
| leader | `demo.lijg@futian.gov.cn` | `demo123` | 局长 |
| admin | `demo.chensy@futian.gov.cn` | `demo123` | 物业科长 |
| expert(bound AI-08) | `demo.fengl@futian.gov.cn` | `demo123` | 物业 expert |
| member | `demo.hanx@futian.gov.cn` | `demo123` | 物业普通员工 |

## 部署 入口
- 生产:`https://aimeeting.zhzjpt.cn`
- 部署命令:`bash deploy/rsync-up.sh --deploy`
- SSH host:`root@47.245.92.62`(SSH 进生产读 logs 需用户授权)
