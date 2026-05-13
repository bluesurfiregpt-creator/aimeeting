# Aimeeting · AI Agent + 会议系统

> 把会议从"被动记录"升级为"组织决策智能系统"。多 AI 专家参会、记得住、能延续。
> **当前版本 · v26.4 平台超管 · 多租户运营**

## 当前能力(v26.4)

**平台层 · 跨 workspace 超管**(v26.4 新):
- ⚡ 平台超管入口(env 白名单 `PLATFORM_ADMIN_EMAILS` 控制)
- 列出所有租户 workspace + user/agent/meeting 统计 + 状态 + 最后活跃
- 一键代客建空间:生成 owner + 临时密码 + 一次性邀请链接(7 天)
- 跨 workspace 切换(JWT 重发,所有现有 endpoint 自动切到目标 ws)
- 所有超管操作 audit 留痕(`platform_admin=true`),客户能在自己空间 audit 看到

**会议层 · 3 种模式**:
- **human** — 传统真人会议(v17–v25 默认行为)
- **hybrid** — 真人 + AI 专家混合(AI 触发式发言,M3.0 起就有)
- **auto** ★ — **全 AI 自主开会**(v26.3 新):召集人定议题 → AI 主持人 + N 个 AI 专家自动议事 → 召集人裁决分歧 → 决议自动沉淀回 AI 知识库

整链路特性(从 v17 起累计):

- 实时 ASR(DashScope paraformer-v2)+ 声纹识别(pyannoteAI)+ 异步贴姓名
- 多 AI 专家参会,5 维 routing(语义 + KB 知识 + 历史 + 负载 + 可用性)
- 反幻觉纪要(qwen-max + temperature=0 + evidence anchor)
- KB embedding 路由(text-embedding-v2,1536 维)
- 任务办结自动沉淀回 AI 专家 KB(让 AI 真在"学")
- 5 级数据分级 + ABAC + 跨 AI 审批 + 操作审计
- v26.3 召集人模式:整场 45 分钟硬上限(`paused` 不算)、议程项硬上限 6 轮、会后批量裁决分歧
- v26.4 平台超管:跨租户视图 + 代客建空间 + 一次性邀请链接 + 切换 audit 留痕

## 目录结构

```
aimeeting/
├── backend/          # FastAPI 后端:会议、音频、声纹、Agent 路由、记忆
│   ├── app/
│   │   ├── auto_meeting_orchestrator.py   # v26.3 全 AI 调度循环
│   │   ├── auto_meeting_state.py          # v26.3 状态机(7 phase + 9 action)
│   │   ├── consensus_consolidator.py      # v26.3-07 裁决沉淀回 KB
│   │   ├── action_extractor.py            # 纪要 → task 抽取
│   │   ├── task_consolidator.py           # 任务办结 → AI KB
│   │   └── routers/
│   │       ├── super.py                   # v26.4 平台超管 (跨 ws list/create/switch)
│   │       └── ...                        # 其它 FastAPI 路由
│   └── scripts/
│       ├── test_auto_meeting_e2e.py            # v26.3-03 端到端 (用 docker exec 跑)
│       └── test_consensus_consolidator.py      # v26.3-07 沉淀链路 (用 docker exec 跑)
├── frontend/         # Next.js 15 + React 19
│   └── src/app/
│       ├── meeting/[id]/orchestrate/page.tsx   # v26.3 召集人控制台
│       └── super/page.tsx                      # v26.4 平台超管 控制台
├── deploy/           # docker-compose + nginx + TLS
├── docs/
│   ├── v26.3-spec.md                      # v26.3 产品 + 技术 设计 (556 行)
│   ├── v26.3-p0-tasks.md                  # v26.3 P0 拆解 + 9 决策点
│   ├── 客户演示脚本.md                       # 7 幕剧 (v26.3 第 6 幕,v26.4 第 7 幕)
│   └── kimi-tests/                        # 给 Kimi 跑的反幻觉测试用例
└── tests/
    └── cowork_suite.js                    # 浏览器内一键自测(含 V26.3 系列)
```

## 服务端

- 域名:`aimeeting.zhzjpt.cn`
- 第三方依赖:阿里云 DashScope(LLM + STT + Embedding)+ pyannoteAI(声纹)+ 阿里云 OSS + Dify + n8n

## 启动(开发)

详见 [docs/dev-setup.md](docs/dev-setup.md)。

## 部署(生产)

```bash
bash deploy/rsync-up.sh --deploy
```

会自动 rsync 代码到服务器 → docker compose 重建 backend + frontend。

## 测试

**浏览器一键自测**(快):
```js
// F12 在 aimeeting.zhzjpt.cn 控制台:
const r = await runCoworkSuite();
console.log(r.markdown);
```
覆盖 ~160 个端点 + schema + 状态机 case,含 v26.3 系列 7 个(端到端由 Kimi 用例覆盖)。

**Kimi AI 测试**(反幻觉,给 AI 跑):
- `docs/kimi-tests/v26.3-05-kimi.md` — orchestrate 控制台 UI
- `docs/kimi-tests/v26.3-07-kimi.md` — 裁决闭环 + KB 沉淀
- `docs/kimi-tests/v26.3-08-kimi.md` — 45 分钟硬上限
- `docs/kimi-tests/v26.3.1-abac-kimi.md` — 三角色 × 5 动作 ABAC 矩阵
- `docs/kimi-tests/v26.4-platform-admin-kimi.md` — 平台超管 list/create/switch

每份用例都有 6 条反幻觉死规矩 + 强制 JSON 原文复述 + 报告模板。

## 部署 gotcha

`backend/.env` 改完后必须 `docker compose up -d --force-recreate backend`,
**不能** 用 `restart` — 后者不重读 env_file,改了不生效。常见踩坑场景:
新加 `PLATFORM_ADMIN_EMAILS` 但 backend 仍读旧 env(踩过)。

## 版本里程碑

| 版本 | 核心 | 上线时间 |
|---|---|---|
| v17–v24 | 真人会议主链路 + M3.0 AI 旁听 + 声纹 + 反幻觉纪要 | 2025–2026.04 |
| v25 | 业务闭环(任务办结沉淀 + 实录依据 + 客户验收) | 2026.05.10 |
| **v26.0** | Agent-centric 派发(AI 专家主责,人是执行代理) | 2026.05.11 |
| **v26.1** | KB embedding 真正接路由 | 2026.05.11 |
| **v26.2** | 任务办结 → AI 专家 KB 自动沉淀 | 2026.05.11 |
| **v26.3** | **召集人模式 · 全 AI 自主会议** | 2026.05.13 |
| **v26.3.1** | ABAC 补丁(角色权限严格化) | 2026.05.13 |
| **v26.4** ★ | **平台超管 · 多租户运营**(本里程碑) | 2026.05.13 |

更多里程碑细节见 [docs/v26.3-spec.md](docs/v26.3-spec.md) + [CHANGELOG.md](CHANGELOG.md)。
