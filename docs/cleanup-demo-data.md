# 演示前清场操作指南

⚠️ **本操作不可逆。请严格按顺序执行。**

---

## 清的范围(本次方案)

| 类别 | 清? |
|---|---|
| 用户账号 / 工作区 / 角色 / AI 专家 / 知识库 / LLM 配置 | ❌ 保留 |
| 所有会议 / 转录 / AI 发言 / 待办 / 任务 | ✅ 清 |
| AI 智囊 / 长期记忆 / 草稿 | ✅ 清 |
| 会议附件(元数据 + OSS 对象) | ✅ 清 |
| 声纹(用户重新录即可) | ✅ 清 |
| 通知 / 审计日志 / 数据访问申请 | ✅ 清 |
| OSS:会议录音 / 附件 / 声纹样本 | ✅ 清 |
| OSS:AI 头像 (`agents/` 前缀) | ❌ 保留 |

---

## 准备(运维 或 产品负责人 做)

### 1. SSH 进生产服务器

```bash
ssh root@47.245.92.62
cd /path/to/aimeeting  # 项目目录
```

### 2. 确认服务正在运行

```bash
docker compose ps
```

应看到 backend / frontend / postgres / redis 四个容器都 `Up`。

---

## Step 1 · 数据库 备份(必做)

⚠️ **没备份就清,后悔药贵**。

```bash
# 在生产服务器
mkdir -p /backup
BACKUP_FILE="/backup/db-pre-cleanup-$(date +%Y%m%d-%H%M%S).sql.gz"

docker exec aimeeting-postgres pg_dump -U aimeeting -d aimeeting | gzip > "$BACKUP_FILE"

# 验证备份
ls -lh "$BACKUP_FILE"
gunzip -c "$BACKUP_FILE" | head -5   # 看前 5 行,应是 PostgreSQL dump header
```

把这个文件**记下路径**——万一清错了,这是唯一的救命药。

### (可选)还想下载备份到本地

在本地电脑跑:
```bash
scp root@47.245.92.62:/backup/db-pre-cleanup-*.sql.gz ~/Downloads/
```

---

## Step 2 · Dry-run 看会清多少

```bash
docker exec aimeeting-backend python3 -m backend.scripts.cleanup_demo_data --dry-run
```

输出大概长这样:
```
=== DB Dry-Run (不真清, 仅 报 行数) ===
  meeting_consensus              5 行
  meeting_speaker_segment        42 行
  meeting_agent_message          187 行
  meeting_transcript             523 行
  meeting_attachment             8 行
  meeting_attendee               18 行
  meeting_action_item            34 行
  ai_insight                     61 行
  memory_agent_link              12 行
  memory_draft                   7 行
  long_term_memory               15 行
  ...
  meeting                        14 行
  voiceprint                     6 行
  notification                   89 行
  audit_log                      1247 行
DB 总计 2358 行 待清

=== OSS Dry-Run: meetings/ ===
  (example) meetings/abc.../recording.wav
  共 14 个对象 待清
=== OSS Dry-Run: meeting-attachments/ ===
  (example) meeting-attachments/.../doc.pdf
  共 8 个对象 待清
=== OSS Dry-Run: voiceprints/ ===
  共 6 个对象 待清

============================================================
汇总: DB 2358 行 + OSS 28 对象 (dry-run, 未执行)
```

**核对**:
- 数字看起来对吗?(几百到几千行 = 正常,千万行 = 不对劲,停下来排查)
- 没看到该保留的表(user / workspace / agent / knowledge_base)出现在清单里
- 没看到 OSS 路径出现 `agents/` 前缀

---

## Step 3 · 实际清场

确认 dry-run 输出 OK 后:

```bash
docker exec aimeeting-backend python3 -m backend.scripts.cleanup_demo_data --confirm-i-mean-it
```

会有 5 秒倒计时(可以 Ctrl+C 中止),然后真清。

输出大概:
```
⚠️  本次将真删数据库 + OSS 对象, 不可恢复!
请确认已 pg_dump 备份. 5 秒后开始, Ctrl+C 中止.

=== DB 实际清场 ===
  ✓ meeting_consensus              清 5 行
  ✓ meeting_speaker_segment        清 42 行
  ...
DB 总计 清 2358 行

=== OSS 清场: meetings/ ===
  ✓ 已删 14 (累计 14)
=== OSS 清场: meeting-attachments/ ===
  ✓ 已删 8 (累计 8)
=== OSS 清场: voiceprints/ ===
  ✓ 已删 6 (累计 6)

============================================================
汇总: DB 2358 行 + OSS 28 对象 已清
```

---

## Step 4 · 验证清得对不对

### 4.1 检查保留的表 没动

```bash
docker exec aimeeting-postgres psql -U aimeeting -d aimeeting -c "
SELECT 'user' AS tbl, COUNT(*) FROM \"user\"
UNION ALL SELECT 'workspace', COUNT(*) FROM workspace
UNION ALL SELECT 'workspace_membership', COUNT(*) FROM workspace_membership
UNION ALL SELECT 'agent', COUNT(*) FROM agent
UNION ALL SELECT 'knowledge_base', COUNT(*) FROM knowledge_base
UNION ALL SELECT 'knowledge_document', COUNT(*) FROM knowledge_document;
"
```

应看到这几个表**都还有行**(数值跟清场前一致)。

### 4.2 检查清掉的表 是空的

```bash
docker exec aimeeting-postgres psql -U aimeeting -d aimeeting -c "
SELECT 'meeting' AS tbl, COUNT(*) FROM meeting
UNION ALL SELECT 'task', COUNT(*) FROM task
UNION ALL SELECT 'ai_insight', COUNT(*) FROM ai_insight
UNION ALL SELECT 'long_term_memory', COUNT(*) FROM long_term_memory
UNION ALL SELECT 'meeting_attachment', COUNT(*) FROM meeting_attachment;
"
```

所有数都应该是 `0`。

### 4.3 用 owner 账号 登录验证

打开浏览器进 `https://aimeeting.zhzjpt.cn/m`,用 owner 登录:

| 检查项 | 期望 |
|---|---|
| 登录成功 | ✅(用户表保留)|
| 看到工作区名字 | ✅(workspace 保留)|
| 「会议」tab 列表 | ✅ 空 |
| 「任务」tab 列表 | ✅ 空 |
| 「记忆」三个 tab | ✅ 都空 |
| 「智囊」专家视角 | ✅ 看到 AI 列表(配置保留),但每个 AI 都是 "未参会"/"未分配任务" |
| 创建一场新会议 | ✅ 成功,可邀请 AI |
| 进新会议 → 录音 → 转录 | ✅ 跟新装一样 |

如果以上**任何一项失败** → 别开始客户演示,立刻停下来诊断 / 必要时**用 Step 1 的备份回滚**。

---

## 应急 · 清错了怎么办

如果发现清错了 / 演示账号丢失 / 客户数据被误删 …… 立刻**回滚**:

```bash
# 在生产服务器
gunzip -c /backup/db-pre-cleanup-YYYYMMDD-HHMMSS.sql.gz | docker exec -i aimeeting-postgres psql -U aimeeting -d aimeeting
```

回滚会**覆盖**当前数据库(包括清后新建的任何内容)。

OSS 上的对象**没法回滚**(已经删了)——但 OSS 上的对象不影响功能,只是历史录音 / 附件 不再能播放,演示不受影响。

---

## 时间预估

- Step 1 备份:**1-5 分钟**(取决于数据库大小)
- Step 2 dry-run:**< 30 秒**
- Step 3 实际清:**30 秒 - 2 分钟**(OSS 慢)
- Step 4 验证:**5 分钟**

总共 **10-15 分钟**。

**强烈建议演示前**至少 30 分钟做完所有步骤,留时间应急。

---

## 记录

操作完后,在团队群里 周知一下:

```
[2026-05-XX HH:MM]
✅ 演示前清场完成
- DB 清 XXXX 行
- OSS 清 XX 对象
- 备份在 /backup/db-pre-cleanup-YYYYMMDD-HHMMSS.sql.gz
- 验证: 4 个保留表全在, 5 个清的表全空, owner 登录看到干净工作区

如出问题, 24h 内联系 [产品负责人]
```

---

## 维护

每次清场流程改了(加新表 / 加新 OSS 前缀),同步改这文档 + `backend/scripts/cleanup_demo_data.py`。
