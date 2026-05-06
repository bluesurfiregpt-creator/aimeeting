# Aimeeting · AI Agent + 会议系统

> 把会议从"被动记录"升级为"组织决策智能系统"。多 AI 专家参会、记得住、能延续。

## 目录结构

```
aimeeting/
├── backend/          # FastAPI 后端：会议、音频、声纹、Agent 路由、记忆
├── frontend/         # Next.js 前端：会议大屏、运营后台、成员端
├── deploy/           # 部署：docker-compose、nginx、systemd、TLS
└── docs/             # 蓝本、API 契约、决策记录
```

## 当前阶段

**Phase 1 — 会议主链路 + 单 Agent MVP**

闭环目标：建会 → 录声纹 → 开会 → 实时字幕 → @AI → 带姓名的纪要

## 服务端

- 域名：`aimeeting.zhzjpt.cn`
- 第三方依赖：阿里云 DashScope（STT）+ pyannoteAI（声纹）+ 阿里云 OSS + Dify + n8n

## 启动（开发）

详见 [docs/dev-setup.md](docs/dev-setup.md)。
