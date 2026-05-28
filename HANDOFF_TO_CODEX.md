# 完整 交接 给 Codex — Aimeeting 项目

> **目的**: 一份 文档 让 Codex 一站式 上手. 整合 6 份 sub-doc 关键 take-aways + 必读 索引 + 第一周 行动 plan.
> **写于**: 2026-05-28 by Claude (前任 AI engineer)
> **生产**: `https://aimeeting.zhzjpt.cn` (跟 main 同步, HEAD `890baf0`)
> **本机 repo root**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/`

---

## 0. 你好 Codex

我是 Claude, 项目 上一任 vibe coding agent. PM 拍板 让你 接手 继续 干. 我 写了 6 份 交接文档 + 整理 了 项目 的 真实 状态 (含 mock vs 真接 全图 audit). 这份 是 master 索引 + 上手 路径.

**3 件事 你 必须 先 接受**:

1. **不要 自己 加 新功能** — NORTH_STAR § 6 已经 把 路径 拍 死. PM 在 § 1.4 列了 8 大客户痛点, § 6.1-6.4 拆 Phase A/B/C/D. 你 干 的 任何 saga 必须 对齐 这 8 痛点, 不允许 自己 想 新 feature.

2. **不要 mock 假装真实** (NORTH_STAR § 7.5) — Mock 数据 必须 加 "演示数据" pill, 不让 客户 当真. 当前 项目 最大 风险 就 是 Web Workstation 8 个页面 全 mock, PM 看到 一眼 喊"假". 我 写 这份 交接 前 启动 了 Sprint S2-S5 修, 只 完成 S1, 剩 S2-S5 留 给 你.

3. **改 sticky 规则 必 PM 显式 批** — § 7.1 不做 dark mode / § 7.5 不让 mock / § 8.6 Kimi 路径 必绝对 / § 8.8 中文表达 4 条. 这些 PM 多次 提醒 后 sticky, 改 必 PM 拍.

---

## 1. 项目 一句话 定位

> **面向中国政企的 AI Agent 协作会议工作台. AI 专家 有 长期记忆, 会议结论 沉淀回 知识库, AI 协助 完成 会后任务.**

不是 录音工具. 是 "组织决策记忆 + AI 任务执行" 闭环 SaaS. 详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` § 1.

**3 层 价值** (按 离开就走不掉 顺序):
1. **AI 专家 有 长期记忆 + 跨会议 延续**
2. **会议结论 沉淀回 知识库** (三层金字塔: 快照 → 待审 → 记忆库)
3. **AI 协助 完成 会后任务** (任务办结 → 沉淀 回 AI KB)

**目标用户**: 中国 政企 中层 (科长 / 局长 / 总监). 例子 demo workspace = 福田区政府 智慧住建局.

---

## 2. 当前 真实 状态 (老实写, 不藏 问题)

### 2.1 完成度 量化

| 层 | 真接率 | 评级 |
|----|--------|------|
| **后端 FastAPI** (17+ V2 endpoint + AI 五大能力 链路) | ~85% | 🟢 GREEN |
| **Mobile `/m/*`** (14 页) | ~85% (12 真接 / 2 混合) | 🟢 GREEN |
| **Web 会议室** `/meeting/[id]/live` | transcript / ASR / 打字 真接 | 🟡 YELLOW (右栏 3 段 mock) |
| **Web Workstation** (15 页) | **~30%** (1 真接 / 6 混合 / **8 全 mock**) | 🔴 **RED · 当前最大风险** |

### 2.2 已 ship 的 (NORTH_STAR § 6)

- ✅ **Phase A** 7 项 + 后置 + 双盲 GREEN (会议跑顺 + 立场守门 + 任务溯源 + Web 接 mic)
- ✅ **Dark mode** 会议室 (§ 7.1.1 PM override 例外, Kimi 10/0/1 skip GREEN)
- ✅ **Phase B · 8 NEW-C** Mobile `/m/chat/[id]` 1-on-1 chat (痛点 7)
- ✅ **Phase B · 9 NEW-A 简版** backend conflict_detector 自动标 superseded (痛点 4)
- ✅ **Phase C · 13** Mira NLU 真接 LLM + AI path 创会 真落库
- ✅ **Phase C · 11 NEW-A 完整版** 撤销 endpoint + chain drawer
- ✅ **Phase C · 10 NEW-B** Topic 一级对象 + 议题线 UI (痛点 5)
- ✅ **Phase C · 12** 文件 chapter LLM 抽 + Mobile FilePreview 3 tab
- ✅ **Sprint S1** `/workstation` 心智一览 真接 4 个 count

### 2.3 当前 最大 风险 (按 客户冲击 排序)

| # | 风险 | 影响 | 修法 |
|---|------|------|------|
| **1** | **Web Workstation 8 个 全 mock** | 客户 登入 一眼 看出 假 | Sprint S2-S5 (~3-4d 共) — **你的 第一周 必做** |
| **2** | **NEW-A 完整版 测试数据 销毁** | drawer 没数据 看不见, Kimi 报 BLOCKED | PM 在 测试 meeting `a9714f19-...` 重新 @ Stratos + Lex 触发 conflict_detector (~10 min PM 手工) |
| **3** | **TTFC 8-12s 基线** | chat / orchestrator 慢, 客户主观 觉得 慢 | 单独 saga, backend LLM 调用链 排查 (~1-2d, 不阻塞 上线) |
| **4** | **`/workstation/topics` 孤立** | NEW-B 真接 GREEN 但 没入口, 客户 进不去 | 加 会议详情页 显 topic 关联 + 创会modal 选 topic dropdown (~0.5d) |

### 2.4 Web Workstation Mock 大头 详表 (Sprint S2-S5 待做)

| Sprint | 路径 | 现状 | 修法 估时 |
|--------|------|------|---------|
| **S2** | `/workstation/agent/[id]` AI 详情 (1805 行) | `W_PROFILES` 6 个 hardcoded 字典 (radar / KB / memory / 出席 全字面) | 接 `api.getAgent + api.listMemories + api.listKnowledgeBases`, ~1d |
| **S3** | Web 会议室 右栏 (MRRightPanel) | `MR_DECISIONS / MR_ACTIONS / MR_PARKING` 3 个 hardcoded 数组 | 接 `api.listMeetingConsensus + listActionItems`, ~1d |
| **S4** | `/workstation/admin` + `/workstation/profile` | admin: 8 行 hardcoded ws 表; profile: 不拉 `/api/auth/me`, `W_USER` 常量 | 加 fetch + render, ~0.5d |
| **S5** | `/workstation/browse` + `/workstation/tpl` | browse: 全 W_AGENTS hardcoded; tpl: 明确标 mock 但 backend 已有 没接 | 真接 现有 endpoint, ~1d |

详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/HANDOFF.md` § 3.1.

---

## 3. 如何 启动 (本地 dev + 生产 deploy)

### 3.1 本地 dev (零 secret 跑通 部分 功能)

```bash
# 前置: PostgreSQL 16+ with pgvector, Redis 7+, Python 3.12, Node 18+

# 后端
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 至少 填 DASHSCOPE_API_KEY + JWT_SECRET, 详 SECRETS.md § 7.1
uvicorn app.main:app --reload --port 8000

# 前端 (另一个 terminal)
cd frontend
npm install
npm run dev   # http://localhost:3000

# 登录: demo.lijg@futian.gov.cn / demo123
```

### 3.2 生产 deploy (一行 命令)

```bash
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy
```

等价: rsync 本地 → server + ssh 跑 `deploy.sh` (docker compose build + force-recreate)

### 3.3 SSH 进 server (PM 显式 授权 后)

```bash
ssh aimeeting-new                                       # 用 ~/.ssh/aimeeting-new key
# 或 ssh root@47.245.92.62 (默认 key)
cd /opt/aimeeting && docker compose ps                  # 看 4 个 container 状态
docker compose logs --tail=200 backend                  # 看 backend 日志
```

### 3.4 Docker layer cache hit 强 rebuild (改了 代码 但 容器 跑老)

```bash
ssh aimeeting-new "cd /opt/aimeeting/deploy && docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>"
```

---

## 4. 必读 文档 索引 (按 优先级)

### 4.1 P0 上手 必读 (按 顺序, 共 ~30 min)

| # | 文件 | 时间 | 用途 |
|---|------|------|------|
| 1 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/HANDOFF_TO_CODEX.md` | (本文件) | master 索引 + 上手 路径 |
| 2 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/HANDOFF.md` | 5 min | 工程交接 — § 3.1 mock 大头清单 + § 7 风险 + § 11-12 哪些文件最重要 / 不要乱动 |
| 3 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/AGENTS.md` | 5 min | 长期 工作 规则 — 三 token 隔离 / 中文表达 4 条 / Kimi 测试 路径规范 |
| 4 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/SECRETS.md` | 5 min | 服务器 + SSH + 第三方 目录 (无 实际 值) — § 7 拿 真值 流程 |
| 5 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/REQUIREMENTS.md` § 4-7 | 5 min | P0 功能 + 页面职责 + 用户完整 流程 |
| 6 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/DESIGN_NOTES.md` § 7-9 | 5 min | 已实现 / 未实现 / 设计 vs 代码 不一致 |
| 7 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` | 5 min | 历史 守则 (跟 AGENTS.md 一致 留兼容) — 反例 + 触发时机 |

### 4.2 P1 深度 reference (干 saga 时 查)

| 文件 | 用途 |
|------|------|
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` | **产品宪法 v1.2.4** (813 行) — § 1.4 / § 3 / § 6 / § 7 / § 8 必读 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` | **视觉宪法** (775 行) — § 0.3 三 token 隔离 / § 10 设计 vs 代码 20 处 冲突 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/dev-setup.md` | 启动 / 部署 详细指引 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/PRODUCT_OVERVIEW.md` | 产品 历史 概览 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/SCHEMA-mobile-v2.md` | Mobile V2 API 契约 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/` | 57 个 Kimi 测试用例 (双盲 + 单元), 模板 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/handoffs/` | design bundle 历史 |
| `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/specs/` | saga changelist 历史 |

---

## 5. 关键 规则 速查 (必须 记)

### 5.1 三 token 严格 隔离 (DESIGN_SYSTEM § 0.3, 违反 PM 拒)

| 端 | token | 文件 | 默认 theme |
|----|-------|------|----------|
| Web Workstation + 首页 | **W_TOKENS** (暗紫 双 theme) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/tokens.ts` | dark default |
| Web 会议室 (§ 7.1.1 例外) | **MR_TOKENS** (双 theme) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/meeting-room/tokens.ts` | light default |
| Mobile + 小程序 | **MR_COLORS** (单 theme 浅 iOS) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/mobile/meeting-room/styles.ts` | 永远 light |

跨 token import 严禁. 跨 token 共享 atom 严禁 — 必须 拆成 两份.

### 5.2 中文 表达 4 条 (NORTH_STAR § 8.8 sticky)

1. **中文之间 不加 空格** (聊天回复 + AskUserQuestion + UI label)
2. **只用 常用字** — 不允许 罕字 (e.g. "搳/拚/梧/逆中/担收")
3. **AskUserQuestion 写完 自查** — 读 起来 像 文言文 / 火星文 → 重写
4. **commit message 也别 罕字**

### 5.3 Kimi 测试 路径 规范 (§ 8.6 sticky)

- 任何 测试用例 顶部 必 `export REPO_ROOT=/Users/bluesurfire/Documents/claude/aimeeting`
- 所有 命令 / 文件 引用 用 `$REPO_ROOT/...`
- ❌ `python3 scripts/runner.py` ✅ `python3 $REPO_ROOT/scripts/runner.py`

### 5.4 反幻觉 (NORTH_STAR § 7.5)

Mock 数据 必加 "演示数据" pill (紫 tint 11px 字号, 文字 e.g. "演示数据 · 暂无真实 workspace 数据"). 当前 `/workstation/board` 缺 pill 待修. 全部 真接 后 删 mock 兜底.

### 5.5 风格 守门 协议 (NORTH_STAR § 8.2)

任何 `Edit` / `Write` 涉及 `*.tsx` / `*.css` / `*.ts` UI 相关:
1. 先 读 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md`
2. 检查 改动 是否 引入 跟 design system 冲突
3. 冲突 时 commit message 标 `[STYLE-DEVIATION: 具体原因]`

### 5.6 commit 前 必 跑

```bash
# Frontend TS 类型 (commit 前 必跑)
cd frontend && ./node_modules/.bin/tsc --noEmit

# Backend Python syntax
cd backend && python3 -c "import ast, glob; [ast.parse(open(f).read(), filename=f) for f in glob.glob('app/**/*.py', recursive=True)]"
```

### 5.7 不做 5 条 (NORTH_STAR § 7, PM 拍 sticky)

1. **不做 dark mode** (主流程 全 浅色, 例外 § 7.1.1 会议室)
2. **不硬编码 客户专属 逻辑** (福田 / 智慧住建 是 workspace 实例, 不是 代码分支)
3. **不在小程序 / Mobile 做 编辑功能** (编辑 AI / KB / memory 必 走 Web)
4. **不一次性 大改** (拆 Saga, 每 saga 独立 ship + 独立 Kimi 验)
5. **不让 mock 假装 真实** (必加 演示数据 pill)

### 5.8 Kimi 测试 用例 必产 (§ 8.5)

任何 `feat(*)` / `fix(*)` 落 生产 → 必出 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/<版本号>-kimi.md`. 顶部 6 条 反幻觉 死规矩 + 唯一账号 + REPO_ROOT.

纯 文档 / 纯 typo → commit message 加 `[no-kimi-test]`.

---

## 6. 推荐 第一周 行动 plan

### 6.1 Day 1 — 上手 + 自测 工作流

1. 读 § 4.1 必读 7 个 文档 (~30 min)
2. 跟 PM 拿 SSH key + `backend/.env` 真值 (走 SECRETS.md § 7)
3. 本机 启动 + 浏览 一遍 `/workstation` + `/m` (~30 min)
4. SSH 进 server 看 docker compose ps (~10 min)

### 6.2 Day 1-2 — Sprint S4 (最简 0.5d)

修 `/workstation/admin` + `/workstation/profile` 真接. 不复杂 但 PM 立刻 看到 真接 效果, 验证 你 的 工作流 (改 → tsc → 浏览器自测 → commit → deploy → Kimi 用例).

**关键**: 自测 必须 真在 浏览器 走一遍, **不只是 backend curl**. 我 前任 多次 在 这点 出错 (curl GREEN 但 UI 仍 mock).

### 6.3 Day 2-3 — Sprint S3 (会议室右栏, 1d)

修 `MRRightPanel` 接 `api.listMeetingConsensus + listActionItems`. 客户 开会 全程 看到 真 决策池 / 行动项 / Parking. **客户冲击 最大**.

### 6.4 Day 3-4 — Sprint S2 (Agent detail, 1d)

修 `/workstation/agent/[id]` (1805 行 重写). 痛点 4 "AI 像新人" 核心 展示页. radar / KB / memory / 出席会议 全接 真接.

### 6.5 Day 4-5 — Sprint S5 (Browse + Tpl, 1d)

修 `/workstation/browse` + `/workstation/tpl`. backend `previewAgentTemplate / commitAgentTemplate` 已有 缺 接.

### 6.6 Day 5 — Kimi 跨端 验证 + 收尾

PM 跑 5 个 Kimi 待跑用例 (`https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-*.md`) 验 跨端 GREEN. 你 收 retro.

### 6.7 Sprint 完后 候选 (PM 拍 优先级)

- TTFC 8-12s 优化 (1-2d backend LLM 调用链 排查)
- NEW-B 议题 集成 到 会议详情 + 创会modal (0.5d)
- NEW-A 测试数据 重灌 (10 min PM 手工触发)
- Mobile superseded 渲染 (0.5d)
- Phase D (NEW-D / WebRTC / WebSocket / 声纹) — V1.5 推迟

---

## 7. 怎么 拿 secret (走 SECRETS.md, 不平移 实际值)

详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/SECRETS.md`. 关键 总结:

### 7.1 你 需要 拿 的 4 个 东西

| 项 | 拿法 |
|----|------|
| **SSH key** (`~/.ssh/aimeeting-new`) | PM 个人 给, 你 放 本机 `~/.ssh/`, chmod 600, 加 `~/.ssh/config` alias |
| **`backend/.env`** 真值 | PM 通过 安全渠道 给 (1password / 私聊), 你 写本机 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env` 或 SSH 进 server 改 |
| **DB 内 LLM api_key** | server 上 SQL update (不 export 出来), 走 `model_provider_config` 表 |
| **测试 账号 / 密码** | 已 文档化 在 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` § 测试账号 (demo 共享, 非 secret) |

### 7.2 安全 准则 (sticky)

1. 永远 不 把 secret 实际值 写 git (含 commit / comment / 截图)
2. `.env` chmod 600 (本人 可读 only)
3. rsync 必 exclude `backend/.env` + `deploy/.env` (脚本已配)
4. 改 `PLATFORM_ADMIN_EMAILS / JWT_SECRET / DB password` → 必 `docker compose up -d --force-recreate backend` (不是 restart)
5. secret 泄露 → PM 立刻 在 控制台 reset, server `.env` 同步 改

### 7.3 第三方 控制台 索引 (SECRETS.md § 9)

| 服务 | 控制台 |
|------|--------|
| DashScope (LLM / ASR / Embedding / Qwen-VL) | https://dashscope.console.aliyun.com |
| 阿里云 OSS | https://oss.console.aliyun.com |
| 阿里云 ECS | https://ecs.console.aliyun.com |
| 阿里云 RAM (子账号 + access key) | https://ram.console.aliyun.com |
| pyannoteAI (声纹) | https://pyannote.ai |
| Perplexity | https://www.perplexity.ai/settings/api |
| 微信 公众平台 | https://mp.weixin.qq.com |
| Sentry (可选 观测) | https://sentry.io |

---

## 8. 工作流 速查

### 8.1 每个 saga 标准 流程

```
1. PM 拍 优先级 (saga 拆 + 估时)
2. 读 NORTH_STAR § 1.4 痛点 + § 6 Phase + § 7 不做清单
3. 读 DESIGN_SYSTEM § 0.3 三 token 隔离 (UI 改时)
4. 改 代码 → tsc + python syntax → 自测 (浏览器 真走 主flow)
5. commit (按 § 8.4 格式 + co-authored 标)
6. push + 部署 (rsync-up.sh --deploy)
7. 出 Kimi 测试用例 (顶部 REPO_ROOT, 6 条死规矩)
8. PM 喂 Kimi 跑 → 收 retro
9. 更新 NORTH_STAR § 6 完成度
```

### 8.2 commit message 格式

```
type(version 模块): 简短中文标题

详细说明
- 列表项 1
- 列表项 2

Co-Authored-By: Codex <noreply@yourcompany.com>
```

`type` ∈ `feat / fix / docs / style / refactor / test / chore`. 纯文档加 `[no-kimi-test]`.

### 8.3 双盲 测试 (NORTH_STAR § 8.7, backend AI 行为 验证)

```bash
export REPO_ROOT=/Users/bluesurfire/Documents/claude/aimeeting
env -u HTTP_PROXY -u HTTPS_PROXY python3 $REPO_ROOT/scripts/blind-test-runner.py \
  --script $REPO_ROOT/docs/kimi-tests/blind-test/scripts/A-double-blind-base.json \
  --email demo.lijg@futian.gov.cn --password demo123 --out /tmp/run.json
```

适用 backend AI 行为 (LLM judge / orchestrator / chat) 验收. 不适用 真音频 / UI 渲染 (留 PM 真测).

---

## 9. 项目 结构 速查

```

├── HANDOFF_TO_CODEX.md     # 本文件 (master 索引)
├── HANDOFF.md              # 工程交接 (详)
├── SECRETS.md              # 服务器 + 第三方 (无 实际 值)
├── REQUIREMENTS.md         # 产品需求
├── DESIGN_NOTES.md         # 设计 交接
├── AGENTS.md               # Codex 长期 规则
├── CLAUDE.md               # 历史 Claude 守则 (兼容)
├── README.md               # 项目门面
├── CHANGELOG.md
├── docs/
│   ├── NORTH_STAR.md       # 产品宪法 v1.2.4 ⭐
│   ├── design/system/DESIGN_SYSTEM.md  # 视觉宪法 ⭐
│   ├── kimi-tests/         # 57 测试用例
│   ├── design/handoffs/    # design bundle 历史
│   ├── design/specs/       # saga changelist 历史
│   └── dev-setup.md
├── backend/                # FastAPI + asyncpg + pgvector + Redis
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py       # SQLAlchemy 80+ 表
│   │   ├── init_db.py      # DB 初始 + ALTER migration
│   │   ├── auth.py         # JWT cookie + ABAC
│   │   ├── auto_meeting_orchestrator.py
│   │   ├── agent_router.py
│   │   ├── conflict_detector.py  (NEW-A 简版)
│   │   ├── dissent_detector.py
│   │   ├── llm_direct.py   # LLM provider 抽象
│   │   ├── knowledge_retrieval.py
│   │   ├── demo_seed_v2.py + demo_kb_corpus_v2.py
│   │   └── routers/        # 30+ endpoint 文件
│   ├── .env.example        (模板, 真 .env 不入 git)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # Next.js 15 + React 19 + TS
│   ├── src/
│   │   ├── app/
│   │   │   ├── workstation/   # 15 页 (W_THEME)
│   │   │   ├── meeting/[id]/live/  # Web 会议室 (MR_TOKENS 双 theme)
│   │   │   └── m/             # Mobile 14 页 (MR_COLORS)
│   │   ├── components/
│   │   │   ├── web/        # W_TOKENS
│   │   │   └── mobile/     # MR_COLORS
│   │   └── lib/api.ts      # API client ~3000 行
│   └── package.json
├── deploy/                 # rsync + docker compose + nginx + certbot
│   ├── rsync-up.sh         # 本地 → server
│   ├── deploy.sh           # server 拉起
│   ├── bootstrap.sh        # 一次性 引导
│   ├── docker-compose.yml
│   └── .env.example        (真 deploy/.env server-only)
├── scripts/
│   ├── blind-test-runner.py
│   └── blind-test-chat-runner.py
├── tests/                  # 部分 pytest
└── wechat-miniprogram/     # 小程序原生 (浅色化 done, 编辑 不做)
```

---

## 10. 当前 5 个 Kimi 待跑 用例 (PM 喂)

PM 跟 Kimi 各跑 同剧本 → 跨端 GREEN 才 信. 当前 5 个 待跑:

| # | 用例 文件 | 测什么 | 备注 |
|---|---------|--------|------|
| 1 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-b-8-kb-fix-round2-kimi.md` | KB hits Round 2 (Lex 12 / Mira 10) | Claude 自测 GREEN, 等 Kimi 跨端 |
| 2 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-b-9-new-a-superseded-kimi.md` | NEW-A 简版 conflict_detector | DB 已有 superseded 数据 |
| 3 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-c-13-mira-nlu-create-meeting-kimi.md` | Mira NLU + 创会 真接 | Claude 自测 GREEN |
| 4 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-c-11-new-a-full-kimi.md` | NEW-A 完整版 撤销 + drawer | ⚠️ 需 PM 重新 触发 conflict 数据 (见 § 2.3 风险 2) |
| 5 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-c-10-new-b-topics-kimi.md` | NEW-B 议题主题 + 议题线 DOM | Claude 自测 5/5 GREEN |

第 6 个 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v1.4.0-phase-c-12-file-preview-kimi.md` 需 PM 先 上传 真 PDF 才能 验.

---

## 11. 数据 模型 速查 (Codex 改 业务 时 必看)

详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/REQUIREMENTS.md` § 10. 关键 20 个 表:

`workspace` → `user` + `workspace_membership` (角色: workspace_creator / leader / admin / agent_owner / member; system_owner 走 env 白名单) → `agent` (含 `knowledge_base_ids` UUID[]) → `meeting` (含 `topic_id` NEW-B / `auto_state` JSON) → `meeting_attendee` / `meeting_transcript` (ASR 真人句) / `meeting_agent_message` (含 `status='active|superseded'` + `superseded_by_message_id` NEW-A) → `meeting_consensus` (auto 议程 共识/分歧) / `meeting_action_item` (含 `evidence_quote` 痛点 3) → `task` (8 态 状态机) / `ai_insight` (含 `worth_remembering` + `human_decision`) → `long_term_memory` (含 `axis_tag` 6 轴) ← `memory_draft` 待审 → `knowledge_base` → `knowledge_document` → `knowledge_chunk` (pgvector 1536d) → `topic` (NEW-B) / `voiceprint` / `model_provider_config` (LLM api_key) / `search_provider_config` (Perplexity api_key) / `system_audit_log`

---

## 12. 联系 / 紧急 处理

### 12.1 PM 联系
- **PM**: `bluesurfiregpt@gmail.com` (env 白名单 system_owner)
- 任何 不确定 / sticky 规则 修改 / 优先级 拍板 → 找 PM

### 12.2 测试 账号 (全项目 共享)

| 角色 | 邮箱 | 密码 | 备注 |
|------|------|------|------|
| system_owner | `bluesurfiregpt@gmail.com` | `aimeeting123` | env 白名单 |
| leader | `demo.lijg@futian.gov.cn` | `demo123` | 局长 |
| admin | `demo.chensy@futian.gov.cn` | `demo123` | 物业科长 |
| agent_owner | `demo.fengl@futian.gov.cn` | `demo123` | AI primary user |
| member | `demo.hanx@futian.gov.cn` | `demo123` | 普通员工 |

### 12.3 紧急 down 处理

```bash
# 看 哪个 container 挂
ssh aimeeting-new "cd /opt/aimeeting/deploy && docker compose ps"

# 看 日志
ssh aimeeting-new "cd /opt/aimeeting/deploy && docker compose logs --tail=200 <service>"

# 重启 单 service
ssh aimeeting-new "cd /opt/aimeeting/deploy && docker compose up -d --force-recreate <service>"

# 滚回 上一版 (git reset + rsync + deploy)
cd /Users/bluesurfire/Documents/claude/aimeeting && git log -5 --oneline
git revert <bad-commit-hash> && git push
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy
```

### 12.4 secret 泄露 流程

1. PM 立刻 在 控制台 reset (DashScope / OSS / pyannoteAI / 微信 / etc — SECRETS.md § 9)
2. SSH 进 server 改 `/opt/aimeeting/backend/.env` 同步 改
3. `docker compose up -d --force-recreate backend`
4. 撤销 历史 commit / push 之后 force-push (慎用, 跟 PM 商量)

---

## 13. 当前 git 状态 + 最近 commit

```
HEAD: 890baf0 docs(handoff): SECRETS.md 单独 列 服务器 / 第三方 API 目录
分支: main (跟 origin/main 同步, working tree clean)
最近 20 commit:
  890baf0 docs(handoff): SECRETS.md (新 secret 目录, 零 实际 值)
  95d0ef3 docs(rules): 宪法 + 守则 文件 相对路径 改 绝对
  8386754 docs(handoff): 4 交接文档 路径 全 改 绝对路径 (79 处)
  5711bce docs(handoff): HANDOFF + REQUIREMENTS + DESIGN_NOTES + AGENTS 交接给 Codex
  9199978 feat(v1.4.0 Sprint S1): /workstation 心智一览 真接 (替 hardcoded count + me name)
  e876d54 fix(v1.4.0 post-Kimi Round 1): read-only ?status_filter= API + 改 Kimi 用例
  53f3a69 feat(v1.4.0 Phase C · 12): 文件预览 真接 + LLM 抽 章节
  f2d03b8 docs(v1.4.0 Phase C · 10 NEW-B): Kimi 用例
  0479778 feat(v1.4.0 Phase C · 10 NEW-B): 议题主题 一级对象 + 议题线 UI
  2e975e6 docs(v1.4.0 Phase C · 11 NEW-A 完整版): Kimi 用例 + Claude 自测 GREEN
  10c506a feat(v1.4.0 Phase C · 11 NEW-A 完整版): 冲突 覆盖 UI drawer + 撤销 endpoint
  ca94c60 feat(v1.4.0 Phase C · 13): Mira NLU 真接 LLM + mobile 新建会议 AI path 真落库
  c51665e feat(v1.4.0 Phase B · 9 NEW-A 简版): LLM judge 检测立场冲突 + 自动标 superseded
  5613785 test(v1.4.0 Phase B · 8 NEW-C KB fix Round 2): Claude 自测 GREEN
  1dfb428 fix(v1.4.0 Phase B · 8 NEW-C KB hits=0): demo_seed_v2 加 KB seed
  c305537 feat(v1.4.0 R5.D 会议室双 theme): 浅色 default + 深色 opt-in (PM § 7.1.1)
  7f4c4d3 docs(north-star v1.2.4 + claude.md): § 8.8 中文表达规范 sticky
  7b842d2 test(v1.4.0 Phase B · 8 NEW-C 双盲 Round 1): chat runner + 剧本
  366b1c4 feat(v1.4.0 Phase B · 8 NEW-C): Mobile 1-on-1 AI 私聊 + 2 入口 (痛点 7)
  25bc6d0 docs(north-star v1.2.3): § 7.1.1 会议室双 theme 例外
```

---

## 14. 一句话 总结

**当前 项目** 90% 后端 完, Mobile 完美, **Web Workstation 是 主战场**. PM 拍 Sprint S2-S5 修 Web mock 大头. 你 接手 第一周 干 这个 + 跑 5 个 Kimi 用例 跨端 GREEN. **不动 sticky 规则** (中文表达 / Kimi 路径 / 不做 5 条), **不写 实际 secret 进 git**, **mock 必加 演示数据 pill**.

读完 § 4.1 7 个 必读 文档 + 拿 PM 给 的 SSH key + `.env` → 第二天 就 可以 上 PR.

祝 vibe coding 顺利. 出 sticky 误判 / 大动作 拿不准 → 直接 找 PM. PM 是 项目 truth source.

— Claude (前任), 2026-05-28
