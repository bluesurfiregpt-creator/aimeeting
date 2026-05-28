# HANDOFF.md — 工程交接 (Claude → Codex)

> **写于**: 2026-05-28
> **当前 HEAD**: `9199978` (feat: /workstation 心智一览 真接)
> **当前分支**: `main` (working tree clean, 已 push origin)
> **当前生产**: `https://aimeeting.zhzjpt.cn` (跟 main 同步, 最新 deploy 已上)
> **本文档目的**: 把项目当前 真实 状态交接给 Codex 继续 vibe coding, 不藏问题

---

## 0. TL;DR

- 后端 (FastAPI + PostgreSQL + pgvector + Redis) **完成度 ~85%**, 17+ V2 endpoint 真接, AI 五大能力链路 都 跑通
- 前端 **Mobile (`/m/*`) 真接率 ~85%** (14 页 / 12 真接 + 2 混合)
- 前端 **Web Workstation 真接率 ~30%** (15 页 / 1 真接 + 6 混合 + **8 全 mock**) — **当前最大风险**
- 前端 **Web 会议室** transcript / ASR / 打字 真接, **右栏 3 段 全 mock**
- 整体 **能启动 + 能 demo + 能开真会**, 但 Web Workstation 部分页 客户 一眼 看出 是 占位

**最近一次 PM 反馈** (2026-05-28): "前端页面 大部分 还是 mockup, 并没有接 后端接口 和 逻辑, 我 非常 担心 和 疑惑"

**已 启动 修复** (Sprint S1-S5, 仅 完成 S1):
- ✅ **S1**: `/workstation` 心智一览根 真接 (`9199978`)
- ⏸ **S2**: `/workstation/agent/[id]` AI 详情真接 (未做, 1d)
- ⏸ **S3**: 会议室右栏 3 段 真接 (未做, 1d)
- ⏸ **S4**: `/workstation/admin` + `/workstation/profile` 真接 (未做, 0.5d)
- ⏸ **S5**: `/workstation/browse` + `/workstation/tpl` 真接 (未做, 1d)

---

## 1. 当前 项目 做到 哪一步

### 1.1 大方向
- 产品定位见 `REQUIREMENTS.md` 或 `docs/NORTH_STAR.md` § 1
- MVP = NORTH_STAR § 6 的 Phase A + B + C 全部 ship — 当前 **代码已 ship, 但 Web Workstation mock 大头未消除**

### 1.2 NORTH_STAR § 6 完成度

| Phase | 项 | 代码 ship | Kimi 跨端验证 | 真客户用上 |
|---|---|---|---|---|
| **A · 1-7+后置** | 7+1 项 (会议跑顺) | ✅ 全 ship | ✅ 双盲 Round 2 GREEN | ✅ |
| **A · 双盲** | Claude + Kimi 各跑 | ✅ | ✅ | — |
| **Dark mode** (会议室例外) | § 7.1.1 PM override | ✅ ship | ✅ Kimi 10/0/1 skip GREEN | ✅ |
| **B · 8 NEW-C** (1-on-1 chat) | Mobile `/m/chat/[id]` | ✅ ship | ✅ Kimi KB fix Round 2 GREEN | ✅ |
| **B · 9 NEW-A 简版** (冲突 superseded) | backend conflict_detector + frontend chip | ✅ ship | ✅ Kimi GREEN (msg 715/718 真 superseded) | ✅ |
| **C · 13** (Mira NLU + 创会真接) | Mobile `/m/meetings/new` AI tab | ✅ ship | ⏸ Kimi 未验 | ✅ Claude 自测 真创建 meeting |
| **C · 11** NEW-A 完整版 (撤销 + chain drawer) | backend restore + frontend drawer | ✅ ship | ⚠️ Kimi 2 报告 BLOCKED (见 § 8) | — |
| **C · 10** NEW-B (议题主题 + 议题线) | backend topics + workstation/topics | ✅ ship | ⏸ Kimi 未验 | — (孤立, 没入口跳转) |
| **C · 12** (文件预览 + LLM 抽章节) | backend extract-chapters + mobile FilePreview 3 tab | ✅ ship | ⏸ 需 真 PDF 上传 才能 验 | — |
| **Sprint S1** Web 真接 (心智一览) | ✅ ship `9199978` | ⏸ | ✅ Claude 自测 真 count (42/278/316/7) | ✅ |
| **Sprint S2-S5** Web 真接 | ⏸ 未做 | — | — | — |

### 1.3 推迟项 (PM 拍 V1.5 后做)
- **TTFC 8-12s 优化** (Round 1 中优, backend LLM 调用链 排查)
- **Mobile 化 superseded 渲染** (一致性 0.5d)
- **Web FilePreview** (本次 仅 Mobile, Web 端 文件详情 二期)
- **Phase D**: NEW-D AI agentic / WebRTC / WebSocket 替 2.5s 轮询 / 声纹 streaming

---

## 2. 已完成 功能

### 2.1 后端 (`backend/app/`)
- ✅ FastAPI app + auto OpenAPI + JWT cookie auth (`auth.py`)
- ✅ PostgreSQL + pgvector + Alembic-style migration (`init_db.py`)
- ✅ ASR + STT WS (DashScope paraformer-v2, `routers/audio.py` + `meetings.py` WS)
- ✅ 声纹 (pyannoteAI sync `identify_pipeline.py`)
- ✅ Multi-AI 圆桌 orchestrator (`auto_meeting_orchestrator.py` 7 phase + 9 action)
- ✅ Agent router (`agent_router.py` 5 维 routing + LLM judge proactive)
- ✅ Dissent detector (`dissent_detector.py` LLM 检测对立 → 推荐专家)
- ✅ Conflict detector (`conflict_detector.py` LLM 检测后续推翻 → 标 superseded)
- ✅ Insight / Action / Memory 抽取 (`insight_extractor.py` + `action_extractor.py` + `memory_classifier.py`)
- ✅ KB / RAG (`knowledge_retrieval.py` cosine threshold 0.55, `chunker.py` 400/40 overlap, DashScope text-embed-v2 1536d)
- ✅ Topic 一级对象 + 议题线 (`routers/topics.py` 6 endpoint)
- ✅ Mira NLU 真接 (`routers/v2_mira.py` 替 mock asyncio.sleep)
- ✅ 文件 extract + chapter LLM 抽 (`routers/meeting_attachments.py` POST extract-chapters)
- ✅ ABAC + audit (`auth.py` is_leader_or_admin + `audit.py` system_audit_log)
- ✅ Demo seed (`demo_seed.py` 16 中文 agent / `demo_seed_v2.py` 10 英文品牌 agent + KB)
- ✅ 平台超管 (`routers/super.py` 跨 workspace 切换)

### 2.2 前端 — Mobile (`frontend/src/app/m/*`)
- ✅ 14 页 / 12 真接 + 2 混合 (具体见 § 3 表)
- ✅ 全 浅色 iOS (MR_COLORS 单 theme, 不开 dark mode)
- ✅ Saga M/N/O/P (Phase 2 W1-W4) 17 V2 endpoint 接通
- ✅ NEW-C 新加 `/m/chat/[id]` 1-on-1 chat (SSE + sessionStorage)

### 2.3 前端 — Web 部分页
- ✅ Web 会议室 `/meeting/[id]/live` transcript / ASR / 打字 / superseded chip
- ✅ Web 会议室 双 theme (浅默认 / 深 opt-in, § 7.1.1)
- ✅ `/workstation/topics` 列表 + 详情 (NEW-B 真接)
- ✅ `/workstation` 心智一览 (S1 真接 count + me name)
- ✅ `/workstation/meeting/[id]` / `/history` / `/tasks` / `/approve` / `/memory` / `/kb` (混合 — 真接 + fallback mock + 演示数据 pill)
- ✅ `/workstation/new` 创会 (提交 真接)
- ✅ `/workstation/agents` 列表 (真接 + fallback)
- ✅ `/workstation/board` kanban (真接 + fallback, **但 没 演示数据 pill**)

---

## 3. 半成品功能 / 全 mock 页

### 3.1 Web Workstation Mock 大头 (PM 看 一眼 喊 "假" 的 优先级)

| # | 路径 | 现状 | 阻塞影响 | 估时 |
|---|------|------|---------|------|
| **#1** | `/workstation/agent/[id]` AI 详情 (1805 行) | `W_PROFILES` 6 个 hardcoded 字典 (radar / KB / memory / 出席 全字面) | 痛点 4 "AI 像新人" 核心展示页 完全假 | 1d |
| **#2** | 会议室右栏 (`MRRightPanel`) | `MR_DECISIONS / MR_ACTIONS / MR_PARKING` 3 个 hardcoded 数组 | 客户 开会 全程 看 4 条 死决策 / 3 死行动项 | 1d |
| **#3** | `/workstation/admin` 超管 | 8 行 hardcoded workspace 表 含 2026/5/22 字面 | leader+ 登入 一眼 穿帮 | 0.3d |
| **#4** | `/workstation/profile` 身份 | 不拉 `/api/auth/me`, `W_USER` 常量 | 邮箱/角色/部门 写死, 跟真用户不一致 | 0.2d |
| **#5** | `/workstation/browse` AI 市场 | 全 `W_AGENTS + W_CATEGORIES` 写死 | 订阅 CTA 仅 client state, 刷新就丢 | 0.7d |
| **#6** | `/workstation/tpl` AI 生成器 | 明确标 mock + 演示数据 pill, 但 backend `previewAgentTemplate/commitAgentTemplate` 已存在没接 | 客户能预期, 但 backend 已有 缺接 | 0.5d |
| **#7** | `/workstation/graph` 桑基 | LineagePane 混合 (真接 `/api/lineage/sankey`), 但 上游 显示 仍 mock | 跟 #1 心智一览 同源, S1 fix 已部分 cover | — |

### 3.2 Mobile 混合 (低 risk)
- `/m/meetings/[id]` (会议室) — transcript 真接, 但 `MOCK_HUMANS` 用于 FilterSheet speaker 列表 + 参与人 avatar 元信息. backend 不返这些元数据时 fallback 用. 优先级低.
- `/m/meetings/new` Custom tab — 提交 mock `onCreated("mock-meeting")`. AI tab 真接 (S1.4 已 fix). Custom tab 二期 接.

### 3.3 已 ship 但 没被 PM / 客户 用到
- **`/workstation/topics`** 真接 GREEN, 但 **没入口跳转** — sidebar 加了, 但 会议详情页 (MeetingDetailPane) 没显示 topic 关联. **客户根本看不到议题主题**.
- **NEW-A 完整版 撤销 + drawer** 真接 GREEN, 但需要 DB 里 有 `status='superseded'` 数据才能看见. **Kimi Round 1 probe 副作用 把数据销毁了** (见 § 8), 当前 DB 0 行 superseded → 前端 看不到 drawer.
- **Phase C · 12 文件预览 3 tab** 真接 GREEN, 但 demo workspace 没 `extract_status='ready'` 文件 → 前端 看到 "抽取中…" / "未识别" placeholder, **没法 demo**.

---

## 4. 未完成 功能

### 4.1 Sprint S1-S5 (Web Workstation 真接)
S1 已 ship, S2-S5 未做 — 见 § 3.1 表 #1-#6.

### 4.2 NORTH_STAR Phase D (PM 拍 V1.5)
- NEW-D AI agentic 自主跑任务 (5-7d 高风险)
- WebRTC + 摄像头 + 举手 (6d 高风险)
- WebSocket 替换 2.5s 轮询 (3d, P95 5-17s → <500ms)
- 声纹 streaming + 跨端 push (8d)

### 4.3 单独 saga 留着
- **TTFC 8-12s 基线 优化** (NORTH_STAR Round 1 中优, backend LLM 调用链 prompt → model → first token 排查, ~1-2d)
- **NEW-B 议题主题 集成 到 会议详情页** (显示 "本会议 议题: X" + 跳议题线, ~0.5d)
- **NEW-A 完整版 测试数据** 重新填 (PM 在 NEW-A 测试 meeting 注入 conflict_detector 自然产生 superseded, ~10min 人工)
- **Mobile superseded 渲染** (Mobile MeetingTranscriptView 也 灰化 + chip, ~0.5d)
- **Web FilePreview** (KnowledgeDocument 章节抽 + Web 端 attachment 详情, ~1d)

---

## 5. 代码能不能 启动

### 5.1 本地启动 (开发)
✅ 能启动. 详 `docs/dev-setup.md`. 简版:

```bash
# 前置: PostgreSQL 14+ with pgvector, Redis 7+, Python 3.12, Node 18+

# 后端
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 填 DASHSCOPE_API_KEY / DB_URL / REDIS_URL / PLATFORM_ADMIN_EMAILS
uvicorn app.main:app --reload --port 8000

# 前端 (另一个 terminal)
cd frontend
npm install
npm run dev   # http://localhost:3000

# 访问 http://localhost:3000, 用 demo.lijg@futian.gov.cn / demo123 登录
```

### 5.2 生产 (Docker compose)
✅ 能启动. 详 `docs/dev-setup.md` + `deploy/rsync-up.sh`:

```bash
# 服务器一次性引导
mkdir -p /opt/aimeeting && cd /opt/aimeeting
bash /opt/aimeeting/deploy/bootstrap.sh   # Docker + nginx + certbot

# 后续 deploy
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy
# 等价: rsync 本地 → 服务器 + ssh 跑 deploy.sh (docker compose build + force-recreate)
```

---

## 6. 安装 / 启动 / 测试命令

### 6.1 安装
```bash
# 后端
cd backend && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# 前端
cd frontend && npm install
```

### 6.2 启动 (开发)
```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# 前端
cd frontend && npm run dev      # http://localhost:3000
```

### 6.3 启动 (生产)
```bash
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy
```

### 6.4 构建
```bash
cd frontend && npm run build    # next build
```

### 6.5 测试 / Lint
```bash
# Frontend TypeScript 类型检查 (本项目实际用)
cd frontend && ./node_modules/.bin/tsc --noEmit

# Frontend lint
cd frontend && npm run lint     # next lint

# Backend Python 语法
cd backend && python3 -c "import ast, glob; [ast.parse(open(f).read(), filename=f) for f in glob.glob('app/**/*.py', recursive=True)]"

# Backend pytest (有部分 test, 在 tests/)
cd backend && python -m pytest tests/ -v

# 双盲测试 (Phase A 验收方式, 见 docs/NORTH_STAR.md § 8.7)
export REPO_ROOT=/path/to/aimeeting
env -u HTTP_PROXY -u HTTPS_PROXY python3 $REPO_ROOT/scripts/blind-test-runner.py \
  --script $REPO_ROOT/docs/kimi-tests/blind-test/scripts/A-double-blind-base.json \
  --email demo.lijg@futian.gov.cn --password demo123 --out /tmp/run.json

# Kimi 用例 (PM 跑, sandbox 没 Docker, 见 docs/kimi-tests/)
```

---

## 7. 已知 bug / 报错 / 风险

### 7.1 P0 风险 (PM 已知 + 担心)
1. **Web Workstation 8 个页面 全 mock** (见 § 3.1) — 客户 一眼 看出. **当前最大风险**.
2. **TTFC 8-12s 基线** (Round 1 双盲 中优 backend 真问题) — chat / orchestrator 都受影响, 客户主观 觉得 慢.

### 7.2 P1 风险
3. **NEW-A 完整版 测试数据 缺失** — Kimi Round 1 probe 副作用销毁了, 当前 DB 0 行 superseded. 已 ship `?status_filter=superseded` read-only API + 改 Kimi 用例, 但 数据 没 重灌. 修法: PM 在 测试 meeting `a9714f19-...` 重新 @ 立场对立 agent.
4. **`/workstation/topics` 孤立** — 议题主题真接 GREEN, 但 会议详情页没显示 topic 关联 + 创会modal 没选 topic 入口. 客户进不去这个功能.
5. **Phase C · 12 文件预览** Kimi 没验 — 需 demo workspace 先 上传 真 PDF (extract_status='ready'), Kimi 才能 跑 用例.
6. **Phase B · 9 简版 T-02 N/A** — 自然 auto meeting 议程 不冲突 不会触发 conflict_detector, Kimi 测试 标 N/A. 这 不是 bug 是 设计如此.

### 7.3 P2 风险
7. **DashScope LLM 偶发 502** (Claude Round 1 chat-B turn 2 502, Kimi 未复现 = 概率抖动).
8. **frontend ToolSearch ttl 5min 缓存窗口** — 不影响功能, 但 dev 体验 .

### 7.4 已 fix 的 历史 风险
- `demo_seed_v2.py` 缺 keywords (Phase A 双盲 Round 1 抓出, ship `a269f84`)
- KB hits = 0 (NEW-C Round 1 抓出, demo_seed_v2 没给 10 英文 agent 配 KB, ship `1dfb428` 真 LLM verify Lex 12 / Mira 10 hits)
- conflict_detector 用 restore endpoint 探 status 销毁数据 (Kimi 反馈, ship `e876d54` 加 read-only ?status_filter=)

---

## 8. 最近 做过的 重要 改动 (最近 20 commit)

```
9199978 feat(v1.4.0 Sprint S1): /workstation 心智一览 真接 (替 hardcoded count + me name)
e876d54 fix(v1.4.0 post-Kimi Round 1): read-only ?status_filter= API + 改 Kimi 用例 不破坏数据
53f3a69 feat(v1.4.0 Phase C · 12): 文件预览 真接 + LLM 抽 章节 (替 "预览开发中" 占位)
f2d03b8 docs(v1.4.0 Phase C · 10 NEW-B): Kimi 用例 — T-01 ~ T-06 含 backend API + DOM 议题线
0479778 feat(v1.4.0 Phase C · 10 NEW-B): 议题主题 一级对象 + 议题线 UI (痛点 5)
2e975e6 docs(v1.4.0 Phase C · 11 NEW-A 完整版): Kimi 用例 + Claude 自测 GREEN
10c506a feat(v1.4.0 Phase C · 11 NEW-A 完整版): 冲突 覆盖 UI drawer + 历史版本 chain + 撤销 endpoint
ca94c60 feat(v1.4.0 Phase C · 13): Mira NLU 真接 LLM + mobile 新建会议 AI path 真落库
c51665e feat(v1.4.0 Phase B · 9 NEW-A 简版): LLM judge 检测立场冲突 + 自动标 superseded
5613785 test(v1.4.0 Phase B · 8 NEW-C KB fix Round 2): Claude 自测 GREEN, Lex 12 / Mira 10 hits
1dfb428 fix(v1.4.0 Phase B · 8 NEW-C KB hits=0): demo_seed_v2 加 KB seed 给 10 英文品牌 agent
c305537 feat(v1.4.0 R5.D 会议室双 theme): 浅色 default + 深色 opt-in (PM 拍 § 7.1.1)
7f4c4d3 docs(north-star v1.2.4 + claude.md): § 8.8 中文表达规范 — PM 提醒后 sticky
7b842d2 test(v1.4.0 Phase B · 8 NEW-C 双盲 Round 1): chat runner + 剧本 + Claude 跑通
366b1c4 feat(v1.4.0 Phase B · 8 NEW-C): Mobile 1-on-1 AI 私聊 + 2 入口 (痛点 7)
25bc6d0 docs(north-star v1.2.3): § 7.1.1 会议室双 theme 例外 — PM 显式 override § 7.1
d6e0174 docs(north-star v1.2.2): Phase A 收尾 + § 8.7 双盲测试机制 沉淀
1e29205 test(v1.4.0 Phase A 双盲 Round 2): runner item_5 改 combined (recommend + dissent)
530babb style(v1.4.0 R5.D 舞台中央): 灰海白岛 + 紫色 hairline + active speaker 光带
4adefc0 docs(north-star v1.2.1): § 8.6 Kimi 测试用例 路径规范 — REPO_ROOT 强约束
```

---

## 9. 做过但 失败 / 放弃 的 方案

| 方案 | 当时 想做 | 为什么 放弃 | 留 痕 |
|------|---------|---------|------|
| **NEW-A 完整版 撤销 用 WS push** | 撤销 后 立刻 通知 其他 在线 用户 | 实现复杂 ≥ 0.5d 增量, 简版 走 2.5s 轮询 已 work | commit `10c506a` notes |
| **NEW-A 完整版 link chain 链式 显式** | A → B → C 显式 渲染 | 现有 walk recursive 已够, 真用例 一般 ≤ 2 跳 | 留二期 |
| **NEW-B many-to-many topic-meeting** | 1 个 meeting 跨 N 议题 | MVP 简化为 1 meeting 1 topic | 二期 加 junction 表 |
| **Phase C · 12 PDF.js 真渲染** | pixel-perfect PDF preview | 体积 大 + 不在 2d 内. 现 用 extract_text + 章节 摘要 | 二期 |
| **darkmode subagent 跑 10min stall** | 委托 subagent 全做 dark mode | watchdog kill (600s no progress). Claude 自己接手 | 历史 |
| **Kimi probe status via POST /restore** | 用 restore endpoint 探 message status | 写操作 = 销毁数据, ship `e876d54` 改 GET 探 | Kimi 报告 1+3 RED |
| **Web FilePreview 本次干** | Phase C · 12 同时 接 Web | 本次 仅 Mobile, 缩 scope | 二期 |

---

## 10. 推荐 Codex **第一优先级** 处理什么

### 10.1 必做 (PM 已 启动 Sprint, 半 完)
1. **Sprint S2-S5 Web Workstation 真接** (~3-4d, 见 § 3.1)
   - S4 先做 (Profile + Admin, 0.5d, 最快 ship 给 PM 看到效果)
   - S3 (会议室右栏) 客户冲击最大, 1d
   - S2 (Agent detail) 最大单页 1805 行, 1d, 但 痛点 4 核心
   - S5 (Browse + Tpl) 1d
2. **NEW-A 测试数据 重灌** (10min) — PM 在 测试 meeting `a9714f19-...` 重新 @ Stratos + Lex (立场对立), 让 conflict_detector 自然触发, 然后 PM 再 让 Kimi 跑 Phase C · 11 用例

### 10.2 高优 (Codex 之后 接手)
3. **NEW-B 议题集成到 会议详情页** (0.5d) — MeetingDetailPane 加 "议题: X →" 链接
4. **创会 modal 加 topic 选 dropdown** (0.5d)
5. **TTFC 8-12s 优化** (1-2d backend LLM 调用链 排查 — prompt 大 / 模型选 / first-token latency)

### 10.3 低优 (V1.5)
- Phase D 4 个 saga (NEW-D agentic / WebRTC / WS 替轮询 / 声纹 streaming)
- Web FilePreview
- Mobile superseded 渲染

---

## 11. 哪些 文件 最 重要

| 文件 | 为什么 | 改 风险 |
|------|--------|--------|
| `docs/NORTH_STAR.md` | **产品宪法**, 任何 saga 跟它 对齐 | 改 需 PM 批 + 升 版本 |
| `CLAUDE.md` | 工作守则 + Kimi 测试规范 + 中文表达 § 8.8 + 风格守门 § 8.2 | 改 需 PM 批 |
| `docs/design/system/DESIGN_SYSTEM.md` | 视觉/交互 truth source, 含 W_TOKENS / MR_COLORS 双 token 隔离规则 | UI 改 必先读 |
| `backend/app/models.py` | 数据模型 SQLAlchemy, 改 schema 必 加 migration to `init_db.py` `_COLUMN_MIGRATIONS` | 高风险 |
| `backend/app/init_db.py` | DB 初始化 + 增量 migration (idempotent ALTER) | 改 必 PM 批 |
| `backend/app/auth.py` | JWT + cookie + ABAC + role helper (is_leader_or_admin 等) | 高风险 |
| `backend/app/auto_meeting_orchestrator.py` | 全 AI 圆桌调度 7 phase 状态机 | 改 影响 整 auto 会议 |
| `backend/app/agent_router.py` | hybrid/manual 模式 AI 召唤 路由 (5 维) | 改 影响 hybrid 全部 |
| `backend/app/conflict_detector.py` | NEW-A 简版 LLM judge 自动 标 superseded | 新加, 跟 dissent_detector 同 pattern |
| `backend/app/llm_direct.py` | LLM provider 抽象 (deepseek / qwen / 等), 所有 LLM 调用 都走 它 | 改 影响 全 LLM |
| `frontend/src/lib/api.ts` | 前端 API client (~3000 行), 类型 + jget/jpost 等 helper | 改 影响 全 frontend |
| `frontend/src/components/web/tokens.ts` | W_TOKENS 双 theme (workstation 暗紫 + light) | 改 必 全 web 测 |
| `frontend/src/components/web/meeting-room/tokens.ts` | MR_TOKENS 会议室 双 theme (浅 default + 深 opt-in, § 7.1.1) | 改 必 走 design 守门 |
| `frontend/src/components/mobile/meeting-room/styles.ts` | MR_COLORS 单 theme, 移动端 永远 浅色 iOS | 改 必 PM 批 |

---

## 12. 哪些 文件 不要 轻易 动

- **任何 `data/` 下 mock 常量文件** (W_AGENTS / MR_MESSAGES / DEMO_KB / MOCK_HUMANS / W_PROFILES 等) — 它们 是 fallback 兜底, 但 当 backend 没数据时 客户看到的. **不要单独删** 必须 同步 真接 + 加"演示数据" pill.
- **`backend/app/demo_seed*.py`** — workspace 兜底 数据. 改 会 影响 demo workspace + Kimi 测试.
- **`deploy/.env`** (server-only, 含 POSTGRES_PASSWORD) — `deploy/rsync-up.sh` exclude 它防 误删, 改 必 ssh 进 server 改.
- **`backend/.env`** — DASHSCOPE_API_KEY / JWT_SECRET 等. local 有, server 有, 不入 git.
- **任何 `frontend/src/components/web/data/*`** + **`frontend/src/components/mobile/.../data.ts`** — 同上 mock 兜底.
- **`frontend/src/components/web/atoms/WPage.tsx` + `WThemeProvider.tsx`** — workstation 主壳 + 主题. 改 风险高.
- **`backend/app/main.py` lifespan 启动** — 含 demo_seed_v2 自动 fire, 改顺序 会 boot 失败.

---

## 13. 当前 未提交 改动 说明

✅ **`git status` clean**, 无 未提交 改动.

最近 一次 commit 是 `9199978` (Sprint S1 心智一览 真接), 已 push 到 `origin/main`, 已 deploy 到 生产 (`https://aimeeting.zhzjpt.cn`).

---

## 14. 项目 重要 路径 速查

```
aimeeting/
├── HANDOFF.md          # 本文件 (Claude → Codex 工程交接)
├── REQUIREMENTS.md     # 产品需求交接
├── DESIGN_NOTES.md     # 设计交接
├── AGENTS.md           # Codex 长期工作规则
├── CLAUDE.md           # Claude 的工作守则 (历史, 内容大部分搬到 AGENTS.md)
├── README.md           # 项目门面 (轻, 主指向 NORTH_STAR.md)
├── docs/
│   ├── NORTH_STAR.md   # 产品宪法 v1.2.4 (813 行, 必读 § 1.4 痛点 8 / § 6 Phase / § 7 不做清单)
│   ├── design/
│   │   ├── system/DESIGN_SYSTEM.md   # 视觉宪法 (775 行)
│   │   ├── handoffs/                  # design bundle 历史 (Claude Design / Figma)
│   │   └── specs/                     # saga changelist 历史
│   ├── kimi-tests/                    # 57 个 kimi 测试用例 (双盲 / 单元)
│   │   ├── v1.4.0-*.md                # 最近 (Phase A-C)
│   │   └── blind-test/                # 双盲 scripts + retro
│   └── dev-setup.md                   # 启动指引
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app + 中间件 + lifespan
│   │   ├── models.py                  # SQLAlchemy 模型 (~80 表)
│   │   ├── init_db.py                 # DB 初始 + ALTER migration
│   │   ├── auth.py                    # JWT + cookie + ABAC
│   │   ├── auto_meeting_orchestrator.py
│   │   ├── agent_router.py
│   │   ├── conflict_detector.py       # NEW-A 简版 (新加)
│   │   ├── dissent_detector.py
│   │   ├── llm_direct.py              # LLM provider (deepseek/qwen)
│   │   ├── knowledge_retrieval.py     # RAG retrieve
│   │   ├── chunker.py                 # 文档切 chunk
│   │   ├── demo_seed_v2.py            # 10 英文品牌 agent + KB
│   │   ├── demo_kb_corpus_v2.py       # 10 agent × 3 doc KB 语料 (新加)
│   │   └── routers/
│   │       ├── auth.py / agents.py / meetings.py / users.py / ...
│   │       ├── topics.py              # NEW-B (新加)
│   │       ├── v2_mira.py             # Mira NLU 真接 (改写)
│   │       └── meeting_attachments.py # 文件 + chapter 抽 (扩展)
│   ├── requirements.txt               # 29 行 deps
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx               # 首页 (W_THEME)
│   │   │   ├── workstation/           # Web 工作站 15 页 (W_THEME)
│   │   │   │   ├── page.tsx           # 心智一览 (S1 真接, 真 count + me name)
│   │   │   │   ├── topics/            # NEW-B (新加, 真接)
│   │   │   │   ├── agent/[id]/        # AI 详情 (全 mock W_PROFILES, S2 待做)
│   │   │   │   ├── meeting/[id]/      # 混合
│   │   │   │   └── ...                # browse / tpl / admin / profile 等
│   │   │   ├── meeting/[id]/live/     # Web 会议室 (transcript 真接 + 右栏 mock)
│   │   │   └── m/                     # Mobile (MR_COLORS)
│   │   │       ├── page.tsx           # /m today (真接)
│   │   │       ├── meetings/          # 会议列表 + 详情 + 新建 (真接)
│   │   │       ├── chat/[id]/         # NEW-C 1-on-1 (新加, SSE 真接)
│   │   │       ├── tasks/             # 任务 (真接)
│   │   │       ├── insights/          # memory radar (真接)
│   │   │       └── me/                # 我的 + 声纹 (真接)
│   │   ├── components/
│   │   │   ├── web/                   # Web 组件 (W_TOKENS 暗紫 + light)
│   │   │   │   ├── tokens.ts          # W_TOKENS
│   │   │   │   ├── WThemeProvider.tsx
│   │   │   │   ├── atoms/             # WPage / WIcon / WSparkle
│   │   │   │   ├── meeting-room/      # 会议室 (R5.D + 双 theme)
│   │   │   │   │   ├── tokens.ts      # MR_TOKENS (双 theme)
│   │   │   │   │   ├── MRThemeToggle.tsx
│   │   │   │   │   ├── MRSupersededDrawer.tsx  # NEW-A 完整版 (新加)
│   │   │   │   │   └── ...
│   │   │   │   ├── workstation/       # MentalModelPane / AgentDetailPane / etc
│   │   │   │   └── data/              # W_AGENTS / W_PROFILES / W_HUMANS (mock 兜底)
│   │   │   └── mobile/                # Mobile 组件 (MR_COLORS 单 theme)
│   │   │       ├── meeting-room/      # Materials + FilePreview + transcript
│   │   │       └── ...
│   │   └── lib/
│   │       └── api.ts                 # API client + 类型 (~3000 行)
│   └── package.json                   # Next.js 15 + React 19
├── deploy/
│   ├── rsync-up.sh                    # 本地 rsync 到 server
│   ├── deploy.sh                      # server 端 docker compose 拉起
│   ├── bootstrap.sh                   # 一次性 server 初始化
│   ├── docker-compose.yml
│   └── nginx/
├── scripts/
│   ├── blind-test-runner.py           # 双盲 auto meeting runner
│   └── blind-test-chat-runner.py      # 双盲 1-on-1 chat runner
├── tests/                             # 部分 pytest test
└── wechat-miniprogram/                # 小程序原生 (浅色化 ship 但 编辑 不做)
```

---

## 15. PM 跟 Codex 联系方式

- **生产 URL**: `https://aimeeting.zhzjpt.cn`
- **SSH host**: `root@47.245.92.62` (或 `~/.ssh/config` alias `aimeeting-new`)
- **测试账号** (全项目共享, 见 `CLAUDE.md` § 测试账号):
  - leader: `demo.lijg@futian.gov.cn` / `demo123`
  - admin: `demo.chensy@futian.gov.cn` / `demo123`
  - agent_owner: `demo.fengl@futian.gov.cn` / `demo123`
  - member: `demo.hanx@futian.gov.cn` / `demo123`
  - system_owner: `bluesurfiregpt@gmail.com` / `aimeeting123` (env 白名单)
- **Demo workspace**: `bfaf52e4-ba42-4eb6-9577-20a1ffcd4a55` (默认工作空间, ws_creator = 李局长)
