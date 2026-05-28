# AGENTS.md — Codex 长期 项目 规则

> **目的**: Codex (或 任何 后续 AI agent / 真人) 接手 时 一站式 必读. 整合 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` (Claude 时期 的 守则) + `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` 关键 沉淀 + 实操 经验.
> **强约束**: 这些 是 **PM 拍板 sticky** 规则, 不允许 自动 放宽. 改 必 PM 显式 批.

---

## 1. 项目 技术栈

| 层 | 选型 | 关键 版本 |
|----|------|---------|
| **Frontend** | Next.js 15 (App Router) + React 19 + TypeScript 5 | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/package.json` |
| **UI 风格** | 原生 CSS-in-JS (inline style) + tokens 模块 (W_TOKENS / MR_TOKENS / MR_COLORS), **不用 Tailwind / shadcn** | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/tokens.ts` 等 |
| **Backend** | FastAPI + SQLAlchemy 2.0 (async) + asyncpg | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/requirements.txt`, fastapi 0.115 |
| **DB** | PostgreSQL 16 + pgvector (1536d embedding) | `pgvector/pgvector:pg16` docker image |
| **Cache** | Redis 7-alpine | for session / cache |
| **LLM** | DashScope (qwen / deepseek), 通过 `llm_direct.py` 抽象 | active provider 可 切换, 当前 prod = `deepseek-v4-pro` |
| **Embedding** | DashScope `text-embedding-v2` (1536d, cosine) | `embeddings.py` |
| **ASR** | DashScope `paraformer-realtime-v2` | `routers/audio.py` |
| **声纹** | pyannoteAI (sync identify) | `identify_pipeline.py` |
| **Auth** | JWT cookie + ABAC (workspace_id + role helper) | `auth.py` |
| **Storage** | OSS (aliyun) + 本地 disk fallback | `meeting_attachments.py` |
| **Deploy** | Docker compose + rsync + nginx + certbot | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/*.sh` |
| **小程序** | 微信 原生 (无 vite, 用 微信 IDE 调试) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/wechat-miniprogram/` 浅色化 done, 编辑功能 不做 |

---

## 2. 目录 结构 说明

详 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/HANDOFF.md` § 14. 关键提示:

```
aimeeting/
├── HANDOFF.md / REQUIREMENTS.md / DESIGN_NOTES.md / AGENTS.md  ← 4 个 交接文档 (新加)
├── CLAUDE.md            ← 历史 Claude 守则 (大部分 搬到 AGENTS.md 但留 兼容)
├── README.md            ← 项目门面 (轻, 主指向 NORTH_STAR.md)
├── docs/
│   ├── NORTH_STAR.md    ← **产品宪法 v1.2.4** (813 行) - 必读
│   ├── design/system/DESIGN_SYSTEM.md  ← **视觉宪法** (775 行) - UI 改前必读
│   ├── design/handoffs/                ← design bundle 历史 (Claude Design)
│   ├── design/specs/                   ← saga changelist 历史
│   ├── kimi-tests/                     ← 57 个 Kimi 测试用例 (双盲 + 单元)
│   └── dev-setup.md                    ← 启动 / 部署 指引
├── backend/app/
│   ├── main.py                ← FastAPI app + lifespan (含 demo_seed_v2 自动跑)
│   ├── models.py              ← SQLAlchemy 80+ 表
│   ├── init_db.py             ← DB 初始 + 增量 ALTER migration
│   ├── auth.py                ← JWT + cookie + ABAC
│   ├── auto_meeting_orchestrator.py  ← 全 AI 圆桌 调度
│   ├── agent_router.py        ← hybrid / manual AI 召唤 路由 (5 维)
│   ├── conflict_detector.py   ← NEW-A 简版 立场推翻 LLM judge
│   ├── dissent_detector.py    ← 对立 检测 LLM judge
│   ├── llm_direct.py          ← LLM provider 抽象
│   ├── knowledge_retrieval.py ← RAG retrieve
│   ├── chunker.py             ← 文档 切 chunk
│   ├── demo_seed*.py          ← 兜底 数据
│   └── routers/               ← 30+ endpoint 文件
├── frontend/src/
│   ├── app/
│   │   ├── workstation/       ← Web 工作站 (W_THEME 暗紫)
│   │   ├── meeting/[id]/live/ ← Web 会议室 (MR_TOKENS 双 theme § 7.1.1)
│   │   └── m/                 ← Mobile (MR_COLORS 单 theme 浅)
│   ├── components/web/        ← Web 组件 (含 atoms / workstation / meeting-room)
│   ├── components/mobile/     ← Mobile 组件
│   └── lib/api.ts             ← API client (~3000 行)
├── scripts/
│   ├── blind-test-runner.py   ← 双盲 auto meeting
│   └── blind-test-chat-runner.py
├── deploy/                    ← rsync / docker compose / nginx / certbot
└── wechat-miniprogram/        ← 小程序 原生
```

---

## 3. 开发 命令 (本地 + 部署 + 验证)

### 3.1 本地 启动 (开发 优先)
```bash
# 后端
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 填 DASHSCOPE_API_KEY / DB_URL / REDIS_URL / PLATFORM_ADMIN_EMAILS
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend && npm install
npm run dev  # http://localhost:3000
```

### 3.2 部署 (生产)
```bash
# 一次性 引导
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh         # 仅 同步
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy  # 同步 + 跑 docker compose

# 强制 no-cache rebuild (Docker 偶 cache hit, 见到 \"代码 改了 但 容器 跑老\")
ssh aimeeting-new "cd /opt/aimeeting/deploy && docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>"
```

### 3.3 测试 / Lint / Build
```bash
# Frontend TS 类型 (本项目 主要 用 这个)
cd frontend && ./node_modules/.bin/tsc --noEmit

# Frontend lint
cd frontend && npm run lint

# Frontend build
cd frontend && npm run build

# Backend Python 语法
cd backend && python3 -c "import ast, glob; [ast.parse(open(f).read(), filename=f) for f in glob.glob('app/**/*.py', recursive=True)]"

# Backend pytest (部分 unit)
cd backend && python -m pytest tests/ -v

# 双盲 测试 (Phase A 验收 方式)
export REPO_ROOT=/Users/bluesurfire/Documents/claude/aimeeting
env -u HTTP_PROXY -u HTTPS_PROXY python3 $REPO_ROOT/scripts/blind-test-runner.py \
  --script $REPO_ROOT/docs/kimi-tests/blind-test/scripts/A-double-blind-base.json \
  --email demo.lijg@futian.gov.cn --password demo123 --out /tmp/run.json
```

---

## 4. 编码 规范

### 4.1 Python (backend)
- 类型 hints 必备 (Python 3.12 syntax: `list[str]` 不 `List[str]`)
- async / await 全程 (SQLAlchemy 2.0 async session, asyncpg)
- Pydantic v2 (BaseModel + model_config = ConfigDict)
- 不允许 同步 IO 阻塞 event loop (用 asyncio.to_thread for blocking)
- Logger 用 `logging.getLogger(__name__)` 不 print

### 4.2 TypeScript (frontend)
- 严格模式 (`tsconfig.json strict: true`)
- 不允许 `any` (除 临时 escape hatch, 必标 comment)
- `"use client"` directive 必须 显式 写 (Next 15 默认 server component)
- API 调用走 `lib/api.ts` 的 `api.xxx()` helper, 不直接 `fetch`
- 类型 命名: `xxxOut` (后端返回) / `xxxIn` (请求体)

### 4.3 中文 表达 (NORTH_STAR § 8.8 sticky, PM 多次 提醒)
> 违反 = 立刻 自我 retract 重写

1. **中文之间 不加 空格** — "你怎么选?" 而非 "你 怎么 选?". 例外: 数字 / 英文 / 中点 ` · ` 周围 可空
2. **只用 常用字** — 不允许 "搳/咨/拚/梧/逆中/担收/抵赖年" 这种 罕字. 不确定 换说法
3. **AskUserQuestion 写完 自查** — mental read 一遍, 像 文言文 / 火星文 → 重写
4. **commit message 也别 罕字** — 中文 加空格 + 简洁 OK, 不允许 罕字

### 4.4 Commit message 格式
```
type(version 模块): 简短中文标题

详细 说明
- 列表项 1
- 列表项 2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

`type` ∈ `feat / fix / docs / style / refactor / test / chore`

---

## 5. UI 风格 约束 (DESIGN_SYSTEM § 0.3 强约束)

### 5.1 三套 token 严格 隔离
| 端 | token | 文件 | 默认 theme |
|----|-------|------|----------|
| Web Workstation + 首页 | **W_TOKENS** (暗紫 双 theme) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/tokens.ts` | dark default |
| Web 会议室 (§ 7.1.1) | **MR_TOKENS** (双 theme) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/meeting-room/tokens.ts` | light default |
| Mobile + 小程序 | **MR_COLORS** (单 theme 浅) | `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/mobile/meeting-room/styles.ts` | 永远 light |

### 5.2 跨 token 严禁
```ts
// ❌ 严禁 (mobile 不准 import W_TOKENS)
import { W_TOKENS } from "@/components/web/tokens";

// ❌ 严禁 (workstation 不准 用 MR_COLORS)
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

// ✅ 跨 token 共享 atom 必须 拆 成 两份 (e.g. WAvatar + MAvatar)
```

### 5.3 风格 守门 协议 (NORTH_STAR § 8.2)
任何 代码 改动 (含 review 小改 / debug fix / subagent 委派) **必须**:
1. 读 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` 当前最新版
2. 检查 改动 是否 引入 跟 design system 冲突
3. 冲突 时:
   - 优先 按 design system 改
   - 不能 按 design system 改 的 → commit message 标 `[STYLE-DEVIATION: 具体原因]` 给 PM

### 5.4 dark mode 政策 (NORTH_STAR § 7.1 + § 7.1.1)
- **主流程 全 浅色**, 不做 dark mode
- **例外**: Workstation (W_TOKENS 双 theme) + 会议室 (MR_TOKENS 双 theme, PM 拍板 § 7.1.1)
- Mobile + 小程序 + 其他 Web 页 → 永远 浅色, 严禁 dark

### 5.5 反幻觉 视觉 (NORTH_STAR § 7.5)
- Mock 数据 兜底 时 **必须 显** "演示数据 · ..." pill (紫 tint, 11px 字号)
- 反例: `/workstation/board` 真接 + fallback 但 没 pill, 待修

---

## 6. 状态管理 / API / 数据持久化 约定

### 6.1 状态 管理
- React `useState` + `useEffect` 自己 写 (无 Redux / Zustand / Jotai)
- 跨 component 共享: 提层 + props drilling, 或 Next.js context (当前 仅 `WThemeProvider`)
- 长期 state (会议 transcript / agent 列表 等) 走 backend, **不 client 缓存**

### 6.2 API 调用
- 全部 走 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/lib/api.ts` 的 `api.xxx()` helper
- helper 用 `jget / jpost / jpatch / jdelete` 4 个 内部 函数 (credentials: include + JSON)
- 网络 错误 走 `handleAuthError` (401 跳 /login) + `handleNetworkError`
- 失败 toast 让 上层 catch (api helper 抛 makeError)

### 6.3 数据 持久化
- **DB**: PostgreSQL 主 + pgvector embedding. 改 schema 必加 `init_db.py _COLUMN_MIGRATIONS` 增量 ALTER
- **Session**: JWT cookie `aimeeting_session` (httpOnly + secure on https)
- **客户端 短暂 持久**: sessionStorage (`/m/chat/[id]` 历史 — 关 tab 即清)
- **客户端 长期**: localStorage (`w-theme` 主题持久)
- **OSS**: 文件 上传 (meeting attachment), key 格式 `meeting-attachments/{ws_id}/{att_id}/{filename}`

### 6.4 ABAC + 多租户
- 所有 endpoint 必走 `Depends(get_current_auth)` 拿 `AuthContext`
- 所有 query 必带 `Meeting.workspace_id == auth.workspace.id` (跨 ws 严禁)
- role check 用 `is_leader_or_admin / is_workspace_manager / is_platform_admin` helpers, 不写 if role==xxx 字面比较

---

## 7. 测试 和 验证 方式 (NORTH_STAR § 8.5 + § 8.7 + CLAUDE.md)

### 7.1 每 commit + deploy 完 必出 Kimi 测试用例
- 放 `docs/kimi-tests/<版本号>-kimi.md`
- 顶部 6 条 反幻觉 死规矩 + 唯一账号表 + REPO_ROOT 绝对路径
- T-01 ~ T-N 每用例 4 段 (实际看到 / 判定 / 失败理由 / 证据)
- 模板 见 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/kimi-tests/v26.3-05-kimi.md`

### 7.2 backend AI 行为 → 双盲 (§ 8.7)
- Claude + Kimi 各 跑 同 剧本 → 客观 metric 对账
- 跑 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/scripts/blind-test-runner.py` 或 `blind-test-chat-runner.py`
- 不一致 = 真问题, 一致 = 信任
- Phase A Round 2 GREEN, Phase B 8 KB fix GREEN, Phase C 11/13 等 等 PM Kimi 跑

### 7.3 路径 规范 (§ 8.6 PM 多次 提醒 sticky)
- Kimi 跑 sandbox 没 cwd 上下文 → **任何 文件路径 / 命令 必须 绝对路径**
- 测试用例 顶部 必定义 `REPO_ROOT`:
```bash
export REPO_ROOT=/some/absolute/path/to/aimeeting
```
- 所有 命令 + 文件 引用 用 `$REPO_ROOT/...` 前缀
- ❌ `python3 scripts/runner.py` ✅ `python3 $REPO_ROOT/scripts/runner.py`

### 7.4 自测 vs Kimi 测
- Codex 干完 一个 saga 必 自测 (浏览器 真 走 一遍 主 flow)
- 自测 GREEN 才 commit + deploy
- 出 Kimi 用例 给 PM 跑 跨端 验证

### 7.5 触发时机
- 任何 `feat(*)` / `fix(*)` 落 生产 → 必出 Kimi 用例
- 纯 文档 / 纯 typo / 不影响 外部行为 → 可跳, 但 commit message 标 `[no-kimi-test]`

---

## 8. 注意 事项

### 8.1 测试 账号 (全 项目 共享)
| 角色 | 邮箱 | 密码 | 备注 |
|------|------|------|------|
| system_owner | `bluesurfiregpt@gmail.com` | `aimeeting123` | env 白名单 (PLATFORM_ADMIN_EMAILS) |
| leader | `demo.lijg@futian.gov.cn` | `demo123` | 局长 |
| admin | `demo.chensy@futian.gov.cn` | `demo123` | 物业科长 |
| agent_owner | `demo.fengl@futian.gov.cn` | `demo123` | AI primary user |
| member | `demo.hanx@futian.gov.cn` | `demo123` | 普通员工 |

### 8.2 部署 注意
- 生产: `https://aimeeting.zhzjpt.cn`
- SSH host: `root@47.245.92.62`
- 本机 `aimeeting-new` ssh alias (`~/.ssh/config`, 用 `~/.ssh/aimeeting-new` key)
- SSH 进 prod 读 logs 必须 PM 显式 授权
- Docker layer cache hit 时: `--no-cache` 强 rebuild (见 § 3.2)
- **不准** rsync `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/.env` / `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env` (server-only, exclude 在 `rsync-up.sh`)

### 8.3 PM 拍板 sticky 规则 (改 必 PM 批)
1. § 7.1 不做 dark mode (例外 § 7.1.1 会议室)
2. § 7.2 不硬编码 客户专属 逻辑
3. § 7.3 不在小程序 做 编辑功能
4. § 7.4 不一次性 大改
5. § 7.5 不让 mock 假装 真实
6. § 8.6 Kimi 路径 必 用 `$REPO_ROOT/...`
7. § 8.8 中文表达 4 条 (不加 空格 / 不用 罕字 / 自查 / commit 也别 罕字)

### 8.4 git 安全
- 任何 `feat(*)` / `fix(*)` 落 main 必走 个人 review (Codex 是 单人, 也要 自审 一遍)
- 部署 前 跑 tsc + python syntax check
- 不允许 push --force / 不允许 直接 改 main 历史
- 不允许 secret hardcode (DASHSCOPE_API_KEY 必 走 env)

### 8.5 文件 改动 安全 (HANDOFF § 12)
不要 轻易 动 (PM 兜底 / server-only / 影响 全端):
- `data/` 下 所有 mock 常量 (W_AGENTS / MR_MESSAGES / DEMO_KB / W_PROFILES) — 是 fallback 兜底
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/demo_seed*.py` — workspace 数据
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/.env` / `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env` — server-only
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/auth.py` / `models.py` / `init_db.py` — schema + 权限 (改 必 PM 批 + migration)
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/lib/api.ts` 类型 (改 影响 全 frontend)
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/frontend/src/components/web/tokens.ts` / `meeting-room/tokens.ts` / `mobile/meeting-room/styles.ts` — 三 token 入口

### 8.6 commit 前 必 跑
```bash
# Frontend
cd frontend && ./node_modules/.bin/tsc --noEmit  # exit=0 才 commit

# Backend
cd backend && python3 -c "import ast, glob; [ast.parse(open(f).read(), filename=f) for f in glob.glob('app/**/*.py', recursive=True)]"

# git status check (clean / 改动 都 stage 完)
git status -s
```

---

## 9. 出现 不确定 时 怎么办

1. **跟 NORTH_STAR 对齐** — `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/NORTH_STAR.md` 是 产品 truth source
2. **跟 DESIGN_SYSTEM 对齐** — `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/docs/design/system/DESIGN_SYSTEM.md` 是 视觉 truth source
3. **跟 PM 同步** — 拿 spec / 确认 边界 / 拍 优先级
4. **不允许 自己 加 业务 (NORTH_STAR 没写的)** — 写 单独 saga + PM 拍
5. **改 sticky 规则** (§ 7.1 / § 7.5 / § 8.6 / § 8.8) **必 PM 显式 override**, 不允许 自动 放宽

---

## 10. CLAUDE.md 兼容 (历史 沿用)

`https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` 是 Claude 时期 的 工作守则, 内容 大部分 跟 本 AGENTS.md 一致. 区别:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` 有 一些 历史 saga 经验 (e.g. v1.2.0 P1.2 折叠态 borrow dark token 是反例, 风格守门 由此 沉淀)
- 留 兼容, 不删. Codex 也 可以 看作 参考

如 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/CLAUDE.md` 和 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/AGENTS.md` 冲突, **以 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/AGENTS.md` 为准** (更新).
