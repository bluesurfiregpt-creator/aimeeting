# 智囊团 · 上线测试与运维指南

适合对象:**测试工程师** + **运维工程师**。

本文档涵盖:
- mp 后台必备配置(运维 / 项目管理者干)
- 生产环境部署与运维(运维干)
- 测试用例与验收标准(测试干)
- 故障排查与应急(运维 + 测试协作)

> 不在本文档范围:产品功能描述(看 `docs/product-needs-v1.md`)、客户端开发协议(看 `docs/native-app-protocol.md`)。

---

## 0. 项目快速档案

| 项 | 值 |
|---|---|
| 产品名 | 智囊团(微信小程序)/ Aimeeting(内部品牌)|
| 微信小程序 AppID | `wx1ed17af888224311` |
| 生产域名 | `https://aimeeting.zhzjpt.cn` |
| WebSocket | `wss://aimeeting.zhzjpt.cn` |
| 生产服务器 | `root@47.245.92.62`(阿里云杭州)|
| 当前版本 | v1.0.0(等微信审核 / 发布中)|
| 隐私协议链接 | `https://aimeeting.zhzjpt.cn/m/privacy` |
| 产品负责人 | bluesurfiregpt@gmail.com |

**产品形态**:微信小程序内部是 **H5 webview 套壳 + 几个原生页(picker / meeting)** 的混合架构。绝大多数页面是 H5;会议室、文件 picker 是原生页,体验更接近 native。

---

## 1. mp 后台配置 checklist(运维 / 项目管理者)

入口:[mp.weixin.qq.com](https://mp.weixin.qq.com),用注册小程序的微信号登录。

### 1.1 基本设置

路径:**设置 → 基本设置**

| 字段 | 当前值 | 备注 |
|---|---|---|
| 小程序名称 | `智囊团` | 1 年限改 5 次,慎重 |
| 服务类目(主)| 商务服务 → 企业管理 | 主类目改一次审核 5 个工作日 |
| 服务类目(副 1)| 工具 → 效率 | |
| 服务类目(副 2)| 商务服务 → 办公 | |
| 头像 | (上传中)| 144×144 PNG,后期换不影响审核 |
| 简介 | `面向团队的 AI 协作会议工作台 — AI 专家 + 真人 实时 协同 决策, 沉淀 议程 / 行动 / 知识` | 60 字内,每月改 5 次 |

### 1.2 服务器域名(必配,小程序原生页必须)

路径:**开发 → 开发管理 → 开发设置 → 服务器域名**

| 类型 | 域名 | 用途 |
|---|---|---|
| **request 合法域名** | `https://aimeeting.zhzjpt.cn` | `wx.request` HTTP 调用(原生页用)|
| **socket 合法域名** | `wss://aimeeting.zhzjpt.cn` | `wx.connectSocket` 实时转录 |
| **uploadFile 合法域名** | `https://aimeeting.zhzjpt.cn` | `wx.uploadFile` 文件上传(picker 页用)|
| **downloadFile 合法域名** | `https://aimeeting.zhzjpt.cn` | 备用 |

**每月最多改 50 次**,别频繁动。

### 1.3 业务域名(web-view 加载 H5 必须)

路径:**开发 → 开发管理 → 开发设置 → 业务域名**

| 域名 | 状态 |
|---|---|
| `https://aimeeting.zhzjpt.cn` | 已配 + 校验通过(校验文件 `K4738T3fFC.txt`)|

**校验文件已部署到 `frontend/public/K4738T3fFC.txt`**,内容 `e009029b8cc96396d01937564fa81bfd`。微信定期回访,**别删这个文件**。

修改业务域名时:
1. mp 后台下载新的 `MP_verify_xxx.txt`
2. 放到 repo 的 `frontend/public/` 目录,提交并部署
3. 确认 `curl https://aimeeting.zhzjpt.cn/<新文件名>.txt` 返 200
4. 回 mp 后台填新域名 + 提交

### 1.4 隐私保护指引(必配,审核硬要求)

路径:**设置 → 服务内容声明 → 用户隐私保护指引**

已提交一份,核心字段:
- **收集信息**:邮箱、姓名、麦克风、操作日志、设备信息
- **第三方 SDK**:阿里云 DashScope(LLM + OCR)/ 阿里云 OSS / pyannoteAI / FunASR / 微信 SDK
- **数据存储**:中国境内
- **完整指引链接**:`https://aimeeting.zhzjpt.cn/m/privacy`

⚠️ **mp 后台填写的内容必须跟 H5 端 `/m/privacy` 全文页一致**——审核员会比对。如果改 H5 隐私协议页,**必须同步改 mp 后台**。

### 1.5 体验账号(给审核员用)

提交审核时填:
- 账号:`demo.lijg@futian.gov.cn`
- 密码:`demo123`
- 角色:leader(局长)
- 说明:在 H5 webview 页面输入邮箱密码登录

**别给 owner 账号(`bluesurfiregpt@gmail.com`)**——owner 权限太大,审核员只是看功能,leader 已足够。

### 1.6 微信开放接口(可选,未启用)

| 接口 | 状态 | 说明 |
|---|---|---|
| 客服消息 | 未启用 | 后续接入企业微信客服 |
| 订阅消息 | 未启用 | 后续接任务到期 / 会议提醒推送 |
| wx.login(无感登录)| 未启用 | 目前用户在 webview 输邮密;后续优化 |

---

## 2. 生产环境配置(运维)

### 2.1 域名与 HTTPS

| 项 | 值 |
|---|---|
| 主域名 | `aimeeting.zhzjpt.cn` |
| ICP 备案 | 已通过(工信部可查)|
| SSL 证书 | nginx 自带 / Let's Encrypt(自动续期)|
| DNS 解析 | A 记录 → `47.245.92.62` |

### 2.2 服务器规格

| 项 | 值 |
|---|---|
| 云厂商 | 阿里云 |
| 区域 | 华东 1(杭州)|
| IP | `47.245.92.62` |
| SSH | `root@47.245.92.62` |
| 操作系统 | Linux(docker 跑服务)|

### 2.3 服务组件

服务全在 docker 里跑,docker-compose 管理:

| 容器 | 端口(本机)| 作用 |
|---|---|---|
| `aimeeting-backend` | 8000 | FastAPI 后端 |
| `aimeeting-frontend` | 3000 | Next.js H5 |
| `aimeeting-postgres` | 5432 | 主数据库(pgvector)|
| `aimeeting-redis` | 6379 | 缓存 / 限流 |

外部通过 nginx 反向代理转发到 backend(API)+ frontend(H5)。

### 2.4 第三方服务依赖

| 服务 | 用途 | 没配会怎样 |
|---|---|---|
| 阿里云 DashScope | LLM(通义千问)+ Qwen-VL OCR | AI 拆议程 / 议程监控 / AI 发言全废 |
| 阿里云 OSS | 文件存储 | 会议录音 / 附件上传 503 |
| pyannoteAI | 声纹识别 | 转录显"说话人未知"|
| FunASR(私有部署)| 语音转文字 | 实时转录全废 |

环境变量在服务器 `.env` 文件配置。**别提交到 git**。

### 2.5 部署命令

部署最新代码到生产:

```bash
# 在本地 repo 根目录
bash deploy/rsync-up.sh --deploy
```

这条命令会:
1. rsync 代码到生产服务器
2. docker compose build + up -d --force-recreate
3. 后端 + 前端 都重启,~ 30 秒

部署期间用户可能体验**短暂 502 / WS 断开重连**(< 10 秒)。**避免高峰期部署**(选凌晨或工作日早上)。

### 2.6 日志位置

| 日志 | 命令 |
|---|---|
| 后端 | `docker logs aimeeting-backend --tail 200 -f` |
| 前端 | `docker logs aimeeting-frontend --tail 200 -f` |
| PG | `docker logs aimeeting-postgres --tail 100` |
| Redis | `docker logs aimeeting-redis --tail 100` |

后端日志含完整 request URL + status code + 应用层 log(LLM 调用 / 议程监控 / WS 推送 等)。生产排查从这里开始。

### 2.7 数据库备份(强烈推荐配置)

⚠️ **当前未配置自动备份**。运维需要尽快做:

```bash
# 推荐:每日 02:00 dump 一次, 保留 7 天
0 2 * * * docker exec aimeeting-postgres pg_dump -U aimeeting aimeeting | gzip > /backup/db-$(date +\%Y\%m\%d).sql.gz
0 3 * * * find /backup -name 'db-*.sql.gz' -mtime +7 -delete
```

OSS 上的会议录音 / 附件 阿里云自动保留,不必额外备份(检查 OSS bucket lifecycle 配置)。

---

## 3. 测试用例(测试工程师)

### 3.1 测试账号(共享)

| 角色 | 邮箱 | 密码 | 备注 |
|---|---|---|---|
| owner | `bluesurfiregpt@gmail.com` | `<SYSTEM_OWNER_PWD>` | workspace 拥有者,全权 |
| leader | `demo.lijg@futian.gov.cn` | `demo123` | 局长(给审核员用的也是这个)|
| admin | `demo.chensy@futian.gov.cn` | `demo123` | 物业科长 |
| expert | `demo.fengl@futian.gov.cn` | `demo123` | 物业 expert(绑定 AI-08)|
| member | `demo.hanx@futian.gov.cn` | `demo123` | 物业普通员工 |

### 3.2 测试环境

- **唯一环境**:生产 `https://aimeeting.zhzjpt.cn`(当前没单独的测试环境)
- **不能跑破坏性测试**(删数据 / 大批量请求)——会影响真实用户
- **创建测试会议时**:标题加 `[TEST]` 前缀,方便事后清理

### 3.3 测试套件 A — H5 移动端(`/m/*`)

入口:浏览器或微信 webview 打开 `https://aimeeting.zhzjpt.cn/m`

#### A-1 登录 + 隐私协议

| 步骤 | 期望 |
|---|---|
| 首次进入 `/m` | 弹隐私协议 modal,有"同意并继续" + "暂不使用" + "查看完整版"链接 |
| 点"查看完整版" | 跳 `/m/privacy` 全文页,9 章节齐全 |
| 返回点"同意并继续" | modal 关闭,看到登录页 |
| 输入 owner 邮密 | 跳 `/m` 主页,顶部显头像 |
| 退出登录 → 重登 | 隐私 modal **不再弹**(localStorage 已记)|

#### A-2 四个主 tab

| Tab | 期望 |
|---|---|
| 今日 | 会议视角 / 专家视角 两个子 tab 都能加载 |
| 会议 | 列出当前 workspace 所有会议,按状态分组 |
| 任务 | 列出我接的任务 + 待我审的草稿 |
| 记忆 | 三个 tab:快照 / 待审 / 记忆库 都能加载 |

#### A-3 创建会议(核心场景)

| 步骤 | 期望 |
|---|---|
| `/m/meetings` → 右上 `+` | 进 `/m/meetings/new` |
| 填标题 + 类型 hybrid + brief 30 字 | 字段保存 |
| 点 "✨ 让 AI 拆议程" | 等 10-30 秒,2-6 个议程项自动出 |
| 邀请 1 个真人 + 2 个 AI | 选好 |
| 点 "创建会议" | 跳详情页,status=ongoing |

#### A-4 会议室(H5 版)

进 ongoing 会议详情页:

| 检查 | 期望 |
|---|---|
| 议程 chip 行 | 显当前进度 |
| 实时转录区 | 显历史转录 |
| WS 状态点 | 绿色 "● 已就绪" |
| 录音控制 | 显麦克风按钮 |
| 召唤面板 | 弹得开,看到在场 AI |
| 议程监控 | 跑题 / 卡壳时 banner 出现(有触发条件,不一定能复现)|

#### A-5 会议附件

| 步骤 | 期望 |
|---|---|
| 创建会议页 → 参考资料 → + 添加文件 | 系统 file picker 弹 |
| 上传 1 个 PDF(< 2MB)| 5-10 秒后状态 `✓ 就绪` + summary 出现 |
| 上传 1 个 .exe | 后端拒,400 `不支持的文件格式` |
| 上传 1 个 > 50MB 文件 | 后端拒 413 |

#### A-6 结束会议 + 总结页

| 步骤 | 期望 |
|---|---|
| 在 ongoing 会议详情页 → 结束会议 | 跳 `/m/meetings/{id}/summary` |
| 等 30-60 秒 | AI 纪要 + 抽出的待办 显出来 |
| 点"确认入库"某条待办 | 通过 |
| 进 `/m/insights` → 待审 tab | 这场会议挑出的 insight 在等审 |
| 点"确认入库" | 该 insight 进 `/m/insights` 记忆库 tab |

### 3.4 测试套件 B — 小程序(套壳 + 原生)

入口:微信里搜「智囊团」(或开发者工具预览)

#### B-1 启动

| 步骤 | 期望 |
|---|---|
| 微信扫预览码 / 进上线版 | 打开小程序,顶栏显「智囊团」|
| 第一次启动 | wx.requirePrivacyAuthorize 弹原生隐私授权 |
| 进 webview | 加载 `https://aimeeting.zhzjpt.cn/m`,H5 模式 |
| 在 webview 内登录 | 同 A-1 |

#### B-2 微信聊天记录文件上传(P19-B 核心)

| 步骤 | 期望 |
|---|---|
| 在小程序内进 `/m/meetings/new` | 看到「💬 从微信聊天记录选」绿色按钮(普通浏览器看不到此按钮)|
| 点击 | 跳原生 picker 页 `pages/picker/picker` |
| 点"选聊天记录里的文件" | 微信弹聊天记录文件选择(需微信号 ≤ 7 天内有收发过文件)|
| 选 1-2 个 PDF | wx.uploadFile 跑,显"已上传"|
| 点"完成 — 回会议页" | 跳回 webview |
| H5 端参考资料区 | 自动出现刚选的文件(visibility-change 触发重拉)|

#### B-3 原生会议室(N-1)

| 步骤 | 期望 |
|---|---|
| 进 ongoing 会议详情页 | 看到紫色横条 "📱 试用 原生 会议室体验" |
| 点"进入 →" | 1-2 秒后跳原生 meeting 页 |
| 顶栏 | 显会议标题 |
| WS 状态点 | 几秒内变 ready |
| 历史转录 | 显出来 |
| 点麦克风按钮 → 允许 | "录音中" 红点脉动 + 计时 |
| 说话 | 转录追加新行 |
| 召唤 AI sheet | 弹得开,列在场 AI |
| 点某 AI | AI 流式气泡出现 |
| 议程 banner(如有触发)| 顶部弹 + 倒计时 + 立刻召唤按钮 |
| 点返回 | 回到 H5 webview 详情页 |

⚠️ **原生会议室 是新功能,可能有未发现的 bug**。重点测!

### 3.5 测试用例报告模板

每个用例跑完按这个格式:

```markdown
### A-3 创建会议
- 操作: 见上
- 实际看到: ...
- 判定: PASS / FAIL / BLOCKED / SKIPPED
- 失败理由 (若有): ...
- 证据: 截图 / Network 截图 / console log
- 影响: 阻塞上线 / 中度 / 低 / 美化
```

提交 bug 到内部 issue tracker。

### 3.6 不在范围(已知未实现 / 不必测)

- 桌面 PC 端(`/`)的复杂功能(团队管理、知识库管理、超管后台)
- 推送通知 / 订阅消息
- wx.login 无感登录
- 反悔删除"已入库"记忆
- 实时议程偏题检测的强制触发(走自然触发即可)
- PPTX OCR(支持但需大量真实样本)
- 离线模式(暂不支持)

---

## 4. 上线流程(项目管理者)

### 4.0 ⚠️ 重要 — 两套发版机制

**别搞混了**:本项目代码分两块,**发版机制完全不同**:

| | H5 + 后端 | 小程序原生代码 |
|---|---|---|
| 代码位置 | `frontend/` + `backend/` | `wechat-miniprogram/` |
| 更新命令 | `bash deploy/rsync-up.sh --deploy` | 微信开发者工具 → 上传 → mp 后台提审 |
| 生效时间 | 3-5 分钟 | 1-3 工作日(审核)+ 用户重启小程序 |
| 用户感知 | 下次刷新就是新版 | 必须冷启小程序才看到新版(微信缓存)|
| 可以小步迭代吗 | ✅ 一天 10 次也行 | ❌ 每次都要审核, 1 周顶多 2-3 次 |

**90% 的 bug fix / 文案改 / 功能调整都改 H5 + 后端**,不需要动小程序代码。

**只有 改了 `wechat-miniprogram/` 目录下的内容**(原生页 / utils / app.json / 隐私指引声明 等),才需要走小程序发版流程。

举例:
- 改 H5 主题色 → 改 `frontend/src/app/globals.css` → `rsync-up.sh` → 5 分钟生效 ✅
- 改 H5 会议室 UI → 同上 ✅
- 改 后端 LLM prompt → 改 `backend/app/*.py` → 同上 ✅
- 改小程序 顶栏标题 → 改 `wechat-miniprogram/app.json` → **要走 4.1-4.3 走一遍** ❌
- 加小程序原生页 → **要走 4.1-4.3 走一遍** ❌
- 改小程序 隐私协议提交内容 → **mp 后台直接改 + 不必发版**(但 H5 的 `/m/privacy` 同步改后部署)

### 4.1 提交审核 checklist

提交前确认:

- [ ] mp 后台配置都填完(1.1-1.5)
- [ ] 测试套件 A + B 全过(关键路径无阻塞 bug)
- [ ] 体验账号能正常登录 + 看到会议列表
- [ ] 隐私协议 H5 页 与 mp 后台版本一致
- [ ] 生产环境稳定运行 ≥ 24 小时
- [ ] 准备好 3 张主功能截图

提交流程:

1. 微信开发者工具 → **上传** → 版本号 `1.0.0` + 备注(列改动)
2. mp 后台 → 版本管理 → 看到"开发版本" → 点 **提交审核**
3. 填:类目确认 / 体验账号 / 备注 / (可选)演示视频
4. 提交后等 1-3 工作日

### 4.2 审核通过 → 发布

通过后会收邮件 + 短信。

1. mp 后台 → 版本管理 → "审核版本" → 点 **发布**
2. 弹框确认 → 即时上线
3. 用户在微信搜「智囊团」即可找到

### 4.3 冷启动 24 小时监控

发布后**第一天**特别关注:

| 指标 | 怎么看 | 阈值 |
|---|---|---|
| 后端 500 错误率 | 后端日志 grep `500\|Exception` | < 1% |
| WS 连接成功率 | 后端日志 grep `ws_stt` | > 95% |
| LLM 失败率 | 后端日志 grep `LlmError` | < 5% |
| 用户登录数 | mp 后台 → 数据 → 访问分析 | — |
| 留存 | mp 后台 → 数据 → 用户留存 | — |
| 用户反馈 | mp 后台 → 反馈 | 24h 内回复 |

### 4.4 应急回滚

如果生产出大问题:

#### 紧急回滚到上个版本(代码层面)

```bash
# 在本地 repo
git log --oneline -5         # 找上个稳定版本的 commit
git checkout <last-good-sha>
bash deploy/rsync-up.sh --deploy
git checkout main             # 别忘切回来
```

#### 紧急回滚小程序版本

- mp 后台 → 版本管理 → 找上一个 "线上版本"
- 不能直接降级(微信不支持),需要 **重新提交一个 hotfix 版本** → 审核 → 发布
- 紧急情况可以申请加急审核(1 年 5 次额度)

#### 用户体验降级方案

如果原生会议室(N-1)有问题,**临时回滚到全 H5**:
1. 改 `frontend/src/components/mobile/NativeMeetingEntry.tsx` → `return null;` 隐藏入口
2. 部署
3. 用户看不到原生入口,继续用 H5 版本会议室

---

## 5. 故障排查手册(运维)

### 5.1 用户反馈 → 怎么定位

用户反馈通常给的是**现象**(打不开、卡了、AI 不说话),你要快速定位是哪一层的问题。

| 用户说 | 优先排查 |
|---|---|
| 进不去 / 白屏 | 域名解析 / nginx / frontend 容器 |
| 登录失败 | backend `/api/auth/login` log + bcrypt verify |
| 转录不出 / WS 断 | `socket 合法域名` 配置 + backend `ws_stt` log |
| 文件上传 503 | OSS 配置 + `meeting_attachments` log |
| AI 不说话 | LLM provider 配置 + `agent_router` log |
| 议程拆解超时 | DashScope 服务状态 + `decompose-agenda` log |

### 5.2 关键错误码

| 错误码 | 含义 | 怎么处理 |
|---|---|---|
| 401 unauthorized | token 失效 | 让用户重登 |
| 403 forbidden | 鉴权通过但无权限 | 看 `detail`,可能 ABAC 限制 |
| 413 too large | 上传文件超 50MB | 用户压缩或拆分 |
| 502 bad gateway | 上游(LLM/OSS/FunASR)挂 | 检查第三方服务状态 |
| 503 service unavailable | 自己服务没配 | 检查环境变量 / 容器状态 |
| WebSocket close 1006 | 连接异常关闭 | 一般弱网,客户端自动重连 |

### 5.3 应急联系

| 角色 | 联系 |
|---|---|
| 产品负责人 / 技术架构 | bluesurfiregpt@gmail.com |
| 微信小程序运营 / mp 后台 | (运维填)|
| 阿里云账号 / DashScope / OSS | (运维填)|

### 5.4 常见运维命令速查

```bash
# 看后端实时日志
docker logs aimeeting-backend --tail 200 -f

# 重启后端(不重启数据库)
docker compose restart backend

# 完整部署 (改了代码后)
bash deploy/rsync-up.sh --deploy

# 进入后端容器排查
docker exec -it aimeeting-backend bash

# DB 查询(慎用,影响生产)
docker exec -it aimeeting-postgres psql -U aimeeting -d aimeeting

# 看 Redis 内容
docker exec -it aimeeting-redis redis-cli

# 看磁盘
df -h
du -sh /var/lib/docker

# 重新加载 nginx(如果改了配置)
nginx -s reload
```

---

## 6. 责任分工

| 工作 | 谁负责 | SLA |
|---|---|---|
| mp 后台日常配置(填字段 / 改名 / 改类目)| 项目管理者 | 工作日 1 天 |
| 代码部署 / 容器运维 | 运维 | 工作日 4 小时 |
| 生产环境故障 P0 / P1 | 运维 + 产品负责人 | 30 分钟响应 |
| 测试用例跑通 / 报 bug | 测试工程师 | 工作日 1 天 |
| 用户在 mp 后台留言反馈 | 项目管理者 | 24 小时回复 |
| 第三方服务接入(DashScope / OSS)| 产品负责人 + 运维 | 按需 |
| 微信小程序提交审核 / 发布 | 产品负责人 | 按需 |

---

## 7. 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0.0 | 2026-05(待审中)| 首版上线 — 完整 H5 + 小程序 webview 套壳 + 原生 meeting 页 / picker 页 |

---

## 8. 附录:相关文档索引

| 文档 | 路径 | 给谁看 |
|---|---|---|
| 产品需求清单(对外)| `docs/product-needs-v1.md` | 客户 / 潜在用户 |
| 客户端接入协议 | `docs/native-app-protocol.md` | 接 SDK 的工程师 |
| 隐私协议(线上)| `https://aimeeting.zhzjpt.cn/m/privacy` | 用户 + 微信审核员 |
| Claude 工作守则 | `CLAUDE.md` | Claude(自动跟随)|
| Kimi 测试用例(历次)| `docs/kimi-tests/*.md` | 自动化测试 |

---

_最近更新:2026-05-21 · 维护:产品负责人_
