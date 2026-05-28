# SECRETS.md — 服务器 / 密钥 / 第三方 API · 目录与 调用方案

> **写于**: 2026-05-28
> **重要约定**: 本文件 **只列 env 变量名 + 调用方案 + 在哪 拿 真值**, **不写 实际 secret 值**.
> 实际 secret 在 server 上 (`/opt/aimeeting/backend/.env` + `/opt/aimeeting/deploy/.env`) 或 PM 个人 1password / 密码管理器, **永远 不入 git**.
> 任何 Codex / 后续 agent 需 实际 值 → 找 PM 单独 拿 + 写 server 上 + chmod 600.

---

## 0. 总览 (一眼 扫读)

| 类别 | 内容 |
|------|------|
| **服务器** | 1 台 阿里云 ECS (`root@47.245.92.62`, `aimeeting-new` ssh alias) |
| **域名** | `aimeeting.zhzjpt.cn` (HTTPS, Let's Encrypt 证书 by certbot) |
| **DB** | PostgreSQL 16 + pgvector (docker, 仅 127.0.0.1:5432) |
| **Cache** | Redis 7-alpine (docker, 仅 127.0.0.1:6379) |
| **第三方** | DashScope (LLM + ASR + Embedding + Qwen-VL OCR) · pyannoteAI (声纹) · 阿里云 OSS (对象存储) · 微信 OAuth (小程序登录) · Dify (Phase 1.5 LLM 网关, 未真用) · Sentry (观测, 可选) · Perplexity (按 workspace 配, ws-scope) |
| **secret 落地** | server `/opt/aimeeting/backend/.env` + `/opt/aimeeting/deploy/.env` (chmod 600) + DB `model_provider_config` / `search_provider_config` 表 (workspace-scope 的 LLM / 搜索 API key) |

---

## 1. 服务器 + SSH

### 1.1 生产 服务器
- **IP**: 阿里云 ECS `47.245.92.62`
- **SSH 用户**: `root`
- **SSH host alias** (本机 `~/.ssh/config`): `aimeeting-new` → 指向 `~/.ssh/aimeeting-new` 专用 key
- **登录命令**:
  - 默认 key: `ssh root@47.245.92.62` (如果 默认 key 被 server 拒, 用 alias)
  - alias: `ssh aimeeting-new`
- **首次 设置 SSH key**: PM 个人 持 `~/.ssh/aimeeting-new` private key. 给 Codex 时 → PM 给 一份 个人 副本 (永不 入 git), 放 `~/.ssh/` chmod 600.
- **必须 PM 显式 授权** 才能 SSH 进 prod 读 logs.

### 1.2 部署 路径 (server 上)
```
/opt/aimeeting/                    # rsync 目标
├── backend/.env                   # server-only secret (chmod 600)
├── deploy/.env                    # server-only secret (chmod 600, POSTGRES_PASSWORD)
└── deploy/docker-compose.yml      # 跑 4 个 container (backend / frontend / postgres / redis)
```

### 1.3 nginx + SSL
- nginx config: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/nginx/aimeeting.conf` (反代 80/443 → docker container)
- SSL 证书: Let's Encrypt 由 certbot 自动续 (server 上 cron). 配置 在 `bootstrap.sh` 一次性 引导.
- 防火墙: `ufw` 仅开 22 / 80 / 443

### 1.4 部署 触发 (PM / Codex 跑)
```bash
# 本机 → server 同步 + 拉起
AIMEETING_HOST=aimeeting-new bash deploy/rsync-up.sh --deploy
```

---

## 2. backend/.env — server 配置 (不入 git)

### 2.1 文件 位置
- **server 真值**: `/opt/aimeeting/backend/.env` (server SSH 进 改)
- **本机 dev**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env` (本机 only, gitignore)
- **模板**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env.example` (入 git, 占位 `replace_me`)
- **rsync 排除**: `deploy/rsync-up.sh` `--exclude='backend/.env'` (避免 误 deploy 覆盖 server 上 的)

### 2.2 完整 env 清单 (按 模块 分)

#### A. App 基础
| 变量名 | 用途 | dev 默认 | server 必填 |
|--------|------|---------|------------|
| `APP_ENV` | env tag (`dev` / `prod`) | `dev` | `prod` |
| `APP_HOST` | bind 地址 | `0.0.0.0` | `0.0.0.0` |
| `APP_PORT` | 端口 | `8000` | `8000` |
| `LOG_LEVEL` | 日志 级别 | `INFO` | `INFO` |
| `CORS_ALLOW_ORIGINS` | 允许 origin (逗号 分隔) | `http://localhost:3000` | `https://aimeeting.zhzjpt.cn` |

#### B. DashScope — 阿里云 灵积 (LLM + ASR + Embedding + Qwen-VL)
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `DASHSCOPE_API_KEY` | DashScope 全 service 统一 key (ASR + Embedding + Qwen-VL OCR) | https://dashscope.console.aliyun.com → API-KEY 管理 |
| `DASHSCOPE_STT_MODEL` | STT 模型, 默认 `paraformer-realtime-v2` | 不必改 |
| `DASHSCOPE_STT_VOCABULARY_ID` | 自定义 词表 (业务 术语, 可选) | DashScope 控制台 创建 vocabulary |

**调用方案**:
- ASR (实时 STT): `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/stt_client.py` 调 `dashscope.audio.asr.Recognition`
- Embedding: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/embeddings.py` 调 `text-embedding-v2` (1536d cosine, 用于 KB chunk + memory)
- Qwen-VL OCR: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/doc_parser.py` 图片 文档 fallback OCR
- LLM (chat / summary / orchestrator): **走 DB `model_provider_config` 表** 而非 env (见 § 5)

#### C. pyannoteAI — 声纹
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `PYANNOTE_API_KEY` | 声纹 识别 + diarization API key | https://pyannote.ai → Dashboard |
| `PYANNOTE_BASE_URL` | 默认 `https://api.pyannote.ai` | 不必改 |

**调用方案**:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/identify_pipeline.py` 调 sync identify (~45s/file)
- 跑 在 会议 结束 后 异步, 给 transcript 贴 speaker_user_id

#### D. 阿里云 OSS — 对象存储
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `OSS_ACCESS_KEY_ID` | OSS access key | https://ram.console.aliyun.com → 子账号 → access key |
| `OSS_ACCESS_KEY_SECRET` | OSS access secret | 同上 (创建 时 一次性 显示) |
| `OSS_BUCKET` | bucket 名 (e.g. `aimeeting-recordings`) | OSS 控制台 → 创 bucket |
| `OSS_ENDPOINT` | bucket endpoint URL | 跟 bucket region 一致 (e.g. `https://oss-ap-southeast-1.aliyuncs.com` 新加坡) |
| `OSS_REGION` | bucket region (e.g. `oss-ap-southeast-1`) | 同上 |

**调用方案**:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/oss_client.py` 封装 `oss2.Bucket`
- 上传: 会议录音 / attachment / 声纹 ref audio. key 格式 `meeting-attachments/{workspace_id}/{att_id}/{filename}`
- ⚠️ **跨 region 403 坑**: bucket `aimeeting-recordings` 在 `ap-southeast-1` (新加坡), endpoint 必须 同 region, 否则 403 AccessDenied (TD-OSS-001 2026-05-26 踩过)

#### E. PostgreSQL
| 变量名 | 用途 | 真值 |
|--------|------|------|
| `DATABASE_URL` | DB 连接串 (asyncpg) | `postgresql+asyncpg://aimeeting:<password>@postgres:5432/aimeeting` (docker 内 hostname=postgres). 实际 password 走 `deploy/.env POSTGRES_PASSWORD` 注入 |

#### F. Redis
| 变量名 | 用途 | 真值 |
|--------|------|------|
| `REDIS_URL` | Redis 连接串 | `redis://redis:6379/0` (docker 内). 暂无 password (内网 only) |

#### G. Auth (JWT cookie)
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `JWT_SECRET` | JWT 签名 secret (32 byte hex) | `openssl rand -hex 32` 生成 一次, 入 server `.env`, 永不 改 (改了 所有 session 失效) |
| `JWT_TTL_DAYS` | token 有效期 (默认 14 天) | 不必改 |
| `COOKIE_SECURE` | 是否 only-https cookie | `true` (prod) / `false` (dev http) |

#### H. 平台 超管 白名单
| 变量名 | 用途 | 真值 |
|--------|------|------|
| `PLATFORM_ADMIN_EMAILS` | 跨 ws 超管 邮箱 白名单 (逗号 分隔) | `bluesurfiregpt@gmail.com,...` (PM 个人 邮箱) |

**注意 部署 坑** (`https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env.example` 注释 明确):
- 改 此项 必须 `docker compose up -d --force-recreate backend` (不是 `restart`)
- restart 不重读 env_file, 改了 没生效

#### I. 微信 OAuth (小程序原生 一键登录)
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `WX_APPID` | 微信 小程序 AppID (公开) | https://mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 |
| `WX_SECRET` | 微信 小程序 AppSecret (私密) | 同上, 显示 时 一次性, 历史泄露 必 reset |
| `WX_CODE2SESSION_URL` | code2Session API (默认 官方) | 不必改 |

**调用方案**:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/routers/auth.py` 的 `/api/auth/wx-login` endpoint
- 任一 为空 → 503 提示 "未配置 微信 OAuth"

#### J. Sentry (可选, 观测)
| 变量名 | 用途 | 在哪 拿 |
|--------|------|--------|
| `SENTRY_DSN` | Sentry 项目 DSN (留空 = no-op) | https://sentry.io → 新 Project type=Python(FastAPI) → Client Keys (DSN) |
| `SENTRY_ENVIRONMENT` | env tag (`prod` / `staging`) | 跟 `APP_ENV` 对齐 |
| `SENTRY_TRACES_SAMPLE_RATE` | 性能 trace 采样率 | 默认 `0.1` (10%) |
| `SENTRY_SEND_DEFAULT_PII` | 是否带 用户 IP / cookies | `false` (安全 默认) |

#### K. Dify (Phase 1.5 LLM 网关, 当前 未用)
| 变量名 | 用途 |
|--------|------|
| `DIFY_API_KEY` | Dify workspace key (Phase 1.5 占位, 当前 backend 仍 直接调 LLM provider) |
| `DIFY_BASE_URL` | 默认 `https://api.dify.ai` |

#### L. 后台 任务 调度 (可选 调优, 一般 不动)
| 变量名 | 默认 |
|--------|------|
| `CRON_RUNNER_TICK_SECONDS` | `60` |
| `DRAFT_EXPIRE_DAYS` | `7` |
| `DRAFT_EXPIRE_TICK_SECONDS` | `3600` |
| `DUE_REMINDER_TICK_SECONDS` | `300` |
| `DEFAULT_LLM_MODEL` | (兜底 fallback, 通常 走 DB provider) |

---

## 3. deploy/.env — Docker compose 配置 (server-only, 不入 git)

### 3.1 文件 位置
- **server 真值**: `/opt/aimeeting/deploy/.env` (chmod 600)
- **模板**: `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/.env.example` (入 git, 仅 含 占位)
- **rsync 排除**: `--exclude='deploy/.env'` (server-only)

### 3.2 内容
| 变量名 | 用途 | 真值 来源 |
|--------|------|---------|
| `POSTGRES_PASSWORD` | docker postgres container 的 `POSTGRES_PASSWORD` env + 跟 `backend/.env DATABASE_URL` 里 的 password 必须 一致 | PM 个人 拍 强密码 一次, 永不 改 (改 = DB 起不来 + DATABASE_URL 同步 改) |

**部署 坑** (rsync `--delete` 不 exclude 时 把 它 删掉, prod 起不来 — 历史 v23.5 踩过).

---

## 4. backend 代码 引用 settings 实际 字段 (audit)

`grep settings\.` 实际 引用 (`https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/config.py`):
- `app_env / log_level / cors_origins_list`
- `dashscope_api_key / dashscope_stt_model / dashscope_stt_vocabulary_id`
- `database_url`
- `oss_access_key_id / oss_access_key_secret / oss_bucket / oss_endpoint`
- `sentry_dsn / sentry_environment / sentry_traces_sample_rate / sentry_send_default_pii`
- (其他 env 通过 `os.getenv` 直接 读, 见 § 2.2 L)

---

## 5. DB 内 workspace-scope 的 secret (不在 env, 在 DB 表)

### 5.1 `model_provider_config` 表 — workspace 级 LLM provider
> 见 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/models.py:1312` `ModelProviderConfig`

| 字段 | 说明 |
|------|------|
| `id` | UUID PK |
| `workspace_id` | UUID FK → workspace (nullable, NULL = 全局 fallback) |
| `provider` | str(32), e.g. `'qwen' / 'openai' / 'deepseek' / 'gemini' / 'claude'` |
| **`api_key`** | **Text — provider 的 LLM API key**. workspace owner / leader 在 Web UI 配 (POST `/api/model-providers`), 入 DB. 改 时 SQL update |
| `base_url` | str(255) optional, override 默认 endpoint |
| `model_id` | str(128) optional, 当前 用的 模型 名 (e.g. `'deepseek-v4-pro'`) |
| `is_active` | bool, 仅 一 workspace 一 `is_active=true` 行 |

**当前 prod 状态**:
```sql
SELECT provider, model_id, is_active, workspace_id IS NULL AS is_global
FROM model_provider_config WHERE is_active=true;
-- → provider='deepseek', model_id='deepseek-v4-pro', is_global=false
```

**调用方案**:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/llm_direct.py` 的 `get_active_provider(db, workspace_id)` 取 active 行
- 调 LLM 走 OpenAI-compat HTTP (Authorization Bearer 头), `stream_chat()` SSE 拉 token
- 所有 LLM 调用 (chat / summary / orchestrator / conflict_detector / dissent_detector / Mira NLU / chapter 抽 等) 都 走 这一层

**改 active LLM** (e.g. deepseek → qwen):
```sql
-- 1. 关 旧 active
UPDATE model_provider_config SET is_active=false WHERE is_active=true AND workspace_id='<ws-id>';
-- 2. 开 新 active (or insert)
UPDATE model_provider_config SET is_active=true WHERE workspace_id='<ws-id>' AND provider='qwen';
```

### 5.2 `search_provider_config` 表 — workspace 级 Perplexity / 搜索 API
> 见 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/models.py:1774` `SearchProviderConfig`

| 字段 | 说明 |
|------|------|
| `provider` | str(32), 当前 仅 `'perplexity'`, 未来 可加 `'tavily' / 'serper' / 'brave'` |
| **`api_key`** | **Text — 搜索 provider API key**. 在哪 拿: https://www.perplexity.ai/settings/api |

**调用方案**:
- `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/app/routers/perplexity_fetch.py` 的 `POST /api/perplexity/fetch` — AI 抓 互联网 资料 入 KB (v26.13.2)
- 走 workspace `perplexity_monthly_quota` 限额 (`workspace.perplexity_monthly_quota` 字段, 默认 100/月)
- 用 完 quota 拒绝, 月初 reset

### 5.3 `voiceprint` 表 (无 key, 仅 embedding)
- 存 用户 声纹 embedding (pyannoteAI 返回 的 vector)
- 不存 用户 真实 音频 (音频 在 OSS, key 存 此 表 `ref_audio_url` 字段)
- 不 算 secret, 但 是 PII (个人 生物 识别), 严 workspace_id 隔离 + ABAC

---

## 6. Frontend 公开 配置 (无 secret)

### 6.1 编译时 env
| 变量名 | 用途 | 来源 |
|--------|------|------|
| `NEXT_PUBLIC_BUILD_VERSION` | 左下角 VersionBadge 显 "构建时间" | `deploy/deploy.sh` 自动 注入 `$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')` |

### 6.2 runtime
Frontend 不直接 持 第三方 API key. 全部 走 backend 代理:
- `/api/agents/{id}/chat` (SSE) → backend → LLM
- `/api/v2/mira/draft-meeting` → backend → LLM
- `/api/meetings/.../attachments` (upload) → backend → OSS

---

## 7. 拿 真值 流程 (Codex 接手 时)

### 7.1 本机 dev 启动 (零 secret 跑通, 部分 功能 mock)
```bash
cd backend
cp .env.example .env
# 编辑 .env 至少 填:
#   DASHSCOPE_API_KEY (要 真 LLM / ASR / embedding 必须)
#   JWT_SECRET (openssl rand -hex 32)
#   DATABASE_URL (本地 PG)
#   REDIS_URL (本地 Redis)
# 其他 留 replace_me — pyannote/OSS/微信/Sentry 不填 → 对应 功能 fallback 或 503
```

### 7.2 拿 server 上 真 .env (PM 个人 给)
- PM 把 `/opt/aimeeting/backend/.env` 内容 通过 安全渠道 给 Codex (1password / 私聊, 不入 git / 不入 issue)
- Codex 写入 本机 `https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/backend/.env` (本机 dev) 或 SSH 进 server 改

### 7.3 拿 SSH key
- PM 把 `~/.ssh/aimeeting-new` private key 给 Codex (一份 副本)
- Codex 放本机 `~/.ssh/aimeeting-new`, `chmod 600`, 加 `~/.ssh/config`:
```
Host aimeeting-new
  HostName 47.245.92.62
  User root
  IdentityFile ~/.ssh/aimeeting-new
```

### 7.4 拿 DB 内 LLM api_key (server 上)
```bash
ssh aimeeting-new "docker exec aimeeting-postgres psql -U aimeeting -d aimeeting -c \"SELECT provider, model_id, base_url FROM model_provider_config WHERE is_active=true;\""
# api_key 字段 不要 cat 出来到本地 / 不要 截屏发图. 必要时 SQL update 在 server 上 改, 别 export
```

### 7.5 改 server .env
```bash
ssh aimeeting-new
cd /opt/aimeeting
vi backend/.env   # 改完 wq
docker compose up -d --force-recreate backend   # 必须 force-recreate, 不是 restart
```

---

## 8. 安全 准则 (sticky)

1. **永远 不 把 实际 secret 写 进 git** — 含 commit message / comment / 文档 / 截图
2. **本机 `.env` chmod 600** (本人 可读, group / other 全 拒)
3. **server `.env` chmod 600** (root 可读, 其他 user 拒)
4. **rsync 必须 exclude** `backend/.env` + `deploy/.env` (`deploy/rsync-up.sh` 已 配)
5. **改 PLATFORM_ADMIN_EMAILS / JWT_SECRET / DB password 必须 `force-recreate`**, restart 不重读 env_file
6. **改 WX_SECRET / OSS keys / DashScope key** 后 PM 必须 把 老 key 在 控制台 revoke (防 历史 泄露)
7. **secret 泄露 流程**: PM 立刻 在 所有 控制台 reset, server `.env` 同步 改, `force-recreate`
8. **任何 PR / commit 含 like-key 字符串 (32+ 字符 hex / `sk-xxx`) 自审 + 拒绝 push** (git pre-commit hook 待 加)
9. **Sentry DSN 虽然 公开 但 不要 散到 公网 仓库** — 防 spam
10. **`/api/super/*` 端点** 仅 `PLATFORM_ADMIN_EMAILS` 白名单 邮箱 能调, 走 audit 留痕

---

## 9. 第三方 服务 控制台 索引 (Codex 拿 真值 / 看 quota / reset 的 入口)

| 服务 | 控制台 入口 | 用途 |
|------|----------|------|
| DashScope | https://dashscope.console.aliyun.com | LLM / ASR / Embedding / Qwen-VL api key 管理 + 月度 quota |
| 阿里云 RAM | https://ram.console.aliyun.com | OSS access key 创 / revoke |
| 阿里云 OSS | https://oss.console.aliyun.com | bucket 管理 + region 查 + 用量 |
| 阿里云 ECS | https://ecs.console.aliyun.com | server 实例 / 安全组 / 重启 |
| pyannoteAI | https://pyannote.ai → Dashboard | 声纹 API key + quota |
| Perplexity | https://www.perplexity.ai/settings/api | 搜索 API key + quota (workspace 级) |
| 微信 公众平台 | https://mp.weixin.qq.com | 小程序 AppID / AppSecret |
| Sentry | https://sentry.io | DSN + 错误 监控 |
| Dify (未用) | https://api.dify.ai | LLM 网关 (Phase 1.5 占位) |
| Let's Encrypt | (server 上 certbot 自动) | HTTPS 证书 自动 续 90 天 |

---

## 10. 紧急 联系

- **生产 down**: SSH 进 `aimeeting-new` → `cd /opt/aimeeting/deploy && docker compose ps` 看哪个 container 挂. `docker compose logs --tail=200 <service>` 看错.
- **DB 数据 误删**: `docker exec aimeeting-postgres pg_dump ...` 备份 → 找 PM 确认 是否 走 OSS backup (`https://github.com/bluesurfiregpt-creator/aimeeting/blob/main/deploy/backup-secrets.sh`)
- **第三方 quota 超**: 控制台 查 + 提升 套餐 / PM 拍板 缩 用量
- **secret 泄露**: PM 立刻 全 控制台 reset + server `.env` 同步 改 + `force-recreate`
- **任何 不确定**: 找 PM (`bluesurfiregpt@gmail.com`)

---

> 本文件 **不入 git? 是 入 git** — 但 **零 secret 实际 值**.
> 任何 后续 改 (新增 第三方 / 改 env 名 / 改 控制台 入口), 直接 edit 此 文件 + commit, 不需要 PM 批 (只要 不写 实际 值).
> 实际 值 由 PM 个人 维护 在 server `.env` + 密码管理器.
