# 开发与部署指引

## 本地开发

### 后端

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 填入 DASHSCOPE_API_KEY 等
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

> Chrome 在 `http://localhost` 下也允许 `getUserMedia`，本地不必自签 SSL；
> 但生产环境必须 HTTPS 才能开麦。

## 服务器部署（aimeeting.zhzjpt.cn）

### 一次性引导

DNS 必须先把 `aimeeting.zhzjpt.cn` 指向服务器 IP，否则 Let's Encrypt HTTP-01 拿不到证书。

```bash
# 在服务器上以 root 运行
mkdir -p /opt/aimeeting && cd /opt/aimeeting
# rsync 整个项目目录到 /opt/aimeeting （bootstrap 脚本会读取 deploy/nginx/aimeeting.conf）
bash /opt/aimeeting/deploy/bootstrap.sh
```

`bootstrap.sh` 会做：

- 安装 Docker / Docker Compose / nginx / certbot / ufw
- 开 22/80/443，关其他
- 下发临时 nginx 配置，过 ACME 拿证书
- 切到正式 nginx 配置（含 wss、API、Next.js 反代）

### 部署 / 升级

```bash
cd /opt/aimeeting/deploy
bash deploy.sh
```

会做 `docker compose build && docker compose up -d`，前端 / 后端 / Postgres / Redis 全部起来。

### 关键路径

- 前端：`https://aimeeting.zhzjpt.cn/` → Next.js（端口 3000）
- WebSocket STT：`wss://aimeeting.zhzjpt.cn/ws/stt` → FastAPI（端口 8000）
- 健康检查：`https://aimeeting.zhzjpt.cn/healthz`

## API Key 清单

| 服务 | 用途 | 何时需要 |
| --- | --- | --- |
| 阿里云 DashScope | 实时语音转写 | Phase 1 必备 |
| pyannoteAI | 声纹识别 | Phase 1 中段 |
| 阿里云 OSS | 录音/声纹音频存储 | Phase 1 中段 |
| LLM（Anthropic / Qwen / DeepSeek） | Agent 推理 | Phase 1 后段 |
| Dify | Agent 编排 | Phase 1 后段 |
| n8n | 数据集成 / 自动化 | Phase 2 |
