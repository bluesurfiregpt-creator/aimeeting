"""
v26.14 推广 demo · 福田物业 主题 数据 seed.

跟 老 scripts/seed_demo.py (技术 产品 主题) 互补 — 这 个 是 给 客户 演示 +
Kimi 写 推广手册 截图 用 的, 全部 用 物业 行业 真实 业务 场景.

种 啥:
  - 5 个 物业 主题 AI 专家 (各 有 nickname / persona / primary_user)
  - 1 个 物业 法规 KB + 5 个 文档 chunk
  - 3 场 已结束 会议 (含 transcript / action_items+evidence / agenda_progress
    / memory_drafts pending+approved / committed memory with source_line_ids)
  - 1 场 进行中 会议 (current_agenda_idx=1, 已 走完 第一项 + 进行 第二项)

幂等: 每 实体 用 SEED_MARKER 标. 重跑 跳 已存在.

跑法 (在 prod 服务器 backend 容器 内):
  docker exec aimeeting-backend python -m scripts.seed_demo_property

或 本地 dev:
  cd backend && python -m scripts.seed_demo_property
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import (
    Agent,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    LongTermMemory,
    Meeting,
    MeetingActionItem,
    MeetingAttendee,
    MeetingTranscript,
    MemoryAgentLink,
    MemoryDraft,
    User,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
logger = logging.getLogger("seed_property")

SEED_MARKER = "[seed_property v1]"


# ============================================================================
# AI 专家 (5 个)
# ============================================================================

DEMO_AGENTS = [
    {
        "name": "数据洞察",
        "nickname": "数小妙",
        "domain": "数据 · 报表 · KPI",
        "persona": (
            "你 是 物业 行业 资深 数据 分析师, 善于 从 工单 / 费用 / 满意度 数据 中 找出 隐藏 模式. "
            "回答 时 必 先 给 数字 (例: '3 月 投诉 比 2 月 +42%'), 再 解读 原因, 最后 给 改进 抓手. "
            "拒绝 凭空 判断 — 没 数据 就 说 '需要 拉 一下 X 报表 才能 答'."
        ),
        "tone": "客观、数字 优先、不空谈",
        "boundary": f"{SEED_MARKER} 不 替代 财务 出具 正式 报表; 不 评论 法规 / 投诉 处理 流程",
        "color": "violet",
        "keywords": ["数据", "报表", "KPI", "趋势", "异常", "环比", "同比"],
        "primary_user_email": "bluesurfiregpt@gmail.com",
    },
    {
        "name": "政策法规",
        "nickname": "法老张",
        "domain": "法规 · 合规 · 政府文件",
        "persona": (
            "你 精通 深圳市 福田区 物业 管理 相关 法规, 包括 《物业 管理 条例》《业主 大会 议事 规则》"
            "《住宅 专项 维修 资金 管理 办法》等. 回答 时 先 点 出 适用 哪条 法规, 再 给 合规 建议. "
            "若 涉及 法律 灰区, 明 说 '这 条 法规 没 覆盖, 建议 走 法律 顾问'."
        ),
        "tone": "审慎、有 依据、避免 空话",
        "boundary": f"{SEED_MARKER} 不 替代 律师 出具 法律 意见 书; 不 评论 业主 个人 纠纷",
        "color": "amber",
        "keywords": ["法规", "合规", "条例", "维修资金", "业主大会", "公示"],
        "primary_user_email": "demo.chensy@futian.gov.cn",
    },
    {
        "name": "物业运营",
        "nickname": "运营李",
        "domain": "运营 · SOP · 现场管理",
        "persona": (
            "你 是 经验 丰富 的 物业 项目 经理, 负责 日常 运营 优化 + 对接 业主 诉求. "
            "回答 时 先 给 标准 流程 (SOP), 再 提 现场 经验 (例: '夏季 蚊虫 高发 时 喷药 频率 提到 周三次'). "
            "重视 '可落地' — 不 给 假大空 方案."
        ),
        "tone": "实用、接地气、强调 落地 步骤",
        "boundary": f"{SEED_MARKER} 不 评论 法规 / 财务 决策; 不 替代 工程师 出 技术 方案",
        "color": "emerald",
        "keywords": ["运营", "SOP", "流程", "巡检", "维保", "现场", "工单"],
        "primary_user_email": "demo.fengl@futian.gov.cn",
    },
    {
        "name": "财务核算",
        "nickname": "财王哥",
        "domain": "财务 · 物业费 · 维修资金",
        "persona": (
            "你 是 物业 财务 主管, 熟悉 物业费 收缴 / 公区 水电 分摊 / 维修 资金 使用. "
            "回答 时 先 给 数字 (含 单价 + 月度 总额), 再 给 财务 建议 + 涉及 的 科目. "
            "不 凭 印象 估算 — 没 数据 就 说 '需要 财务 系统 拉 一下'."
        ),
        "tone": "数字 优先、有 出处",
        "boundary": f"{SEED_MARKER} 不 替代 会计 做 凭证; 不 评论 法规 / 投诉",
        "color": "sky",
        "keywords": ["物业费", "收缴率", "公摊", "维修资金", "成本", "预算"],
        "primary_user_email": "demo.lijg@futian.gov.cn",
    },
    {
        "name": "客户服务",
        "nickname": "服务赵姐",
        "domain": "投诉 · 沟通 · 业主满意度",
        "persona": (
            "你 是 物业 客服 主管, 善于 处理 业主 投诉 + 情绪化 沟通. "
            "回答 时 先 共情 (例: '业主 这 角度 是 合理 的'), 再 给 沟通 话术 + 升级 路径. "
            "对 '情绪 vs 事实' 分得 清 — 不 把 业主 情绪 当 事实."
        ),
        "tone": "温和、有 同理心、不 推卸",
        "boundary": f"{SEED_MARKER} 不 替代 法务 评估 民事 责任; 不 评论 财务",
        "color": "rose",
        "keywords": ["投诉", "客服", "沟通", "满意度", "共情", "升级"],
        "primary_user_email": "demo.hanx@futian.gov.cn",
    },
]


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


async def seed_agents(db: AsyncSession, workspace_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """idempotent — 按 name + workspace 查重."""
    out: dict[str, uuid.UUID] = {}
    for spec in DEMO_AGENTS:
        existing = (
            await db.execute(
                select(Agent).where(
                    Agent.name == spec["name"],
                    Agent.workspace_id == workspace_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            out[spec["name"]] = existing.id
            logger.info("agent skip (exists): %s", spec["name"])
            continue
        primary_user = await _get_user_by_email(db, spec["primary_user_email"])
        a = Agent(
            workspace_id=workspace_id,
            name=spec["name"],
            nickname=spec["nickname"],
            domain=spec["domain"],
            persona=spec["persona"],
            tone=spec["tone"],
            boundary=spec["boundary"],
            color=spec["color"],
            keywords=spec["keywords"],
            is_active=True,
            primary_user_id=primary_user.id if primary_user else None,
        )
        db.add(a)
        await db.flush()
        out[spec["name"]] = a.id
        logger.info("agent added: %s (primary=%s)", spec["name"], spec["primary_user_email"])
    await db.commit()
    return out


# ============================================================================
# KB (1 个 + 几 个 文档)
# ============================================================================

KB_DOCS = [
    {
        "filename": "深圳市 物业 管理 条例 (摘要).md",
        "content": (
            "# 深圳市 物业 管理 条例 摘要\n\n"
            "## 第二章 业主 与 业主 大会\n\n"
            "- 业主 大会 由 物业 管理 区域 内 全体 业主 组成. 业主 大会 决定 下列 事项 须 经 "
            "专有 部分 面积 占 比例 三分之二 以上 业主 同意: 制定 / 修改 业主 大会 议事 规则, "
            "选聘 / 解聘 物业 服务 企业.\n\n"
            "- 涉及 共有 部分 经营 收益 使用 + 物业 服务 合同 签订 + 维修 资金 使用 + 改建 重建 "
            "建筑物 的 事项, 须 经 专有 部分 面积 占 比例 三分之二 以上 业主 同意.\n\n"
            "## 第四章 物业 服务\n\n"
            "- 物业 服务 企业 应当 在 物业 管理 区域 内 显著 位置 设置 公告 栏, 公布 物业 服务 "
            "事项, 服务 标准, 收费 标准, 等. 业主 委员会 应当 监督 物业 服务 企业 履行 义务.\n"
        ),
    },
    {
        "filename": "维修 资金 使用 申请 流程.md",
        "content": (
            "# 福田 区 住宅 专项 维修 资金 使用 流程\n\n"
            "## 适用 范围\n\n"
            "本 流程 适用 于 公共 部位 (含 屋面 / 外墙 / 楼道 / 电梯 / 消防 等) 的 维修 + 更新 + 改造.\n\n"
            "## 申请 步骤\n\n"
            "1. **业委会 / 物业 提出 申请** — 含 维修 项目 + 预算 + 维修 范围 + 拟选 施工 单位\n"
            "2. **公示 7 日** — 楼道 + 微信群 同步\n"
            "3. **业主 表决** — 专有 部分 面积 占 比例 2/3 以上 同意 + 人数 占 比 2/3 以上 同意\n"
            "4. **报 区 房屋 管理 部门 审核** — 5 个 工作日 内\n"
            "5. **审核 通过 后 划款** — 直接 拨付 施工 单位\n"
            "6. **施工 + 验收** — 验收 单 备案\n"
            "7. **决算 公示** — 7 日\n"
        ),
    },
    {
        "filename": "业主 投诉 处理 SOP.md",
        "content": (
            "# 业主 投诉 处理 标准 流程\n\n"
            "## 一级 投诉 (现场 / 客服 电话)\n\n"
            "- 30 分钟 内 现场 / 电话 响应\n- 24 小时 内 给 处理 方案\n- 7 日 内 闭环 + 业主 确认\n\n"
            "## 二级 投诉 (写信 / 公众 号 / 工单)\n\n"
            "- 2 小时 内 客服 主管 接 触\n- 48 小时 内 给 处理 方案\n- 14 日 内 闭环\n\n"
            "## 三级 投诉 (12345 / 媒体 / 监管 转办)\n\n"
            "- 1 小时 内 部 总经理 知晓\n- 24 小时 内 给 业主 + 监管 部门 双 反馈\n- 7 日 内 闭环 + "
            "做 复盘 报告\n\n"
            "## 共性 红线\n\n"
            "- 不 与 业主 争辩 是非, 先 共情, 再 处理\n- 涉及 法律 / 财务 的 一律 升级 客服 主管\n"
            "- 全程 录音 + 工单 记录, 留 痕"
        ),
    },
]


async def seed_kb(
    db: AsyncSession, workspace_id: uuid.UUID, owner_agent_id: uuid.UUID,
) -> uuid.UUID | None:
    kb_name = "福田 物业 法规 + SOP 知识库"
    existing = (
        await db.execute(
            select(KnowledgeBase).where(
                KnowledgeBase.name == kb_name,
                KnowledgeBase.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        logger.info("kb skip (exists): %s", kb_name)
        return existing.id

    kb = KnowledgeBase(
        workspace_id=workspace_id,
        name=kb_name,
        description=f"{SEED_MARKER} 福田 物业 demo 用 — 含 深圳 物业 条例 / 维修 资金 流程 / 投诉 SOP",
        owner_agent_id=owner_agent_id,
    )
    db.add(kb)
    await db.flush()

    # 文档 + 单 chunk (embedding 用 全 0 — 不 影响 看, RAG 用 时 再 重 embed)
    for doc_spec in KB_DOCS:
        doc = KnowledgeDocument(
            kb_id=kb.id,
            workspace_id=workspace_id,
            filename=doc_spec["filename"],
            mime_type="text/markdown",
            status="ready",
            source_type="manual",
        )
        db.add(doc)
        await db.flush()
        # 1 chunk per doc (简化 — 真 用 时 chunk 切分, 这里 整篇 进 一段)
        chunk = KnowledgeChunk(
            document_id=doc.id,
            kb_id=kb.id,
            chunk_index=0,
            content=doc_spec["content"],
            embedding=[0.0] * 1536,
        )
        db.add(chunk)
    await db.commit()
    logger.info("kb added: %s (含 %d 文档)", kb_name, len(KB_DOCS))
    return kb.id


# ============================================================================
# 已结束 会议 (3 场) — 含 完整 transcript + action items + memory drafts
# ============================================================================

# 关键 设计: transcript 行 在 commit 后 拿到 真 行 ID,
# action_item.evidence_anchor_line_ids 用 这些 真 ID (不 是 数组 索引)

FINISHED_MEETINGS = [
    {
        "title": "Q1 业主 投诉 处理 评估 会",
        "days_ago": 25,
        "duration_min": 50,
        "agenda": [
            {"title": "投诉 数据 回顾", "time_budget_min": 15, "note": "Q1 总投诉 数 + 分类"},
            {"title": "重点 案例 复盘", "time_budget_min": 20, "note": "3 个 升级 案例"},
            {"title": "Q2 改进 措施", "time_budget_min": 15, "note": "确定 3 项 抓手"},
        ],
        "attendee_emails": [
            "demo.lijg@futian.gov.cn",
            "demo.chensy@futian.gov.cn",
            "demo.hanx@futian.gov.cn",
        ],
        "attendee_agents": ["数据洞察", "客户服务", "物业运营"],
        # transcript: list of (speaker_email | None, text, agent_name | None)
        # speaker_email NULL + agent_name 不 NULL → AI 发言
        "transcript": [
            ("demo.lijg@futian.gov.cn", "今天 主要 复盘 Q1 投诉 数据 + 看 Q2 怎么 改. 数小妙 你 先 给 数据.", None),
            (None, None, "数据洞察"),  # AI 发言, 见 agent_messages
            ("demo.hanx@futian.gov.cn", "里面 有 3 个 升级 到 12345 的, 都是 同 一批 业主 反复 投诉.", None),
            ("demo.lijg@futian.gov.cn", "哪 一栋?", None),
            ("demo.hanx@futian.gov.cn", "B 栋, 主要 围绕 电梯 异响.", None),
            ("demo.chensy@futian.gov.cn", "电梯 维保 合同 是 不 是 该 重新 评估?", None),
            ("demo.lijg@futian.gov.cn", "维保 公司 要 换. 这 是 第一 个 决策.", None),
            (None, None, "客户服务"),  # AI 发言
            ("demo.lijg@futian.gov.cn", "OK 那 就 这么 办. 第二 个 抓手, 客服 响应 时长 要 缩 — 现在 一级 投诉 平均 45 分钟 才 响应, 目标 拉到 20 分钟 内.", None),
            ("demo.hanx@futian.gov.cn", "20 分钟 我们 现 在 人手 不够 — 需要 加 1 个 客服.", None),
            ("demo.lijg@futian.gov.cn", "加 一个. 韩 雪 你 这 周 出 招聘 计划.", None),
            ("demo.lijg@futian.gov.cn", "第三 个 抓手 — Q2 增 一次 业主 满意度 调查, 给 5 个 关键 维度 打分. 这事 服务赵姐 牵头.", None),
            (None, None, "物业运营"),  # AI 发言
            ("demo.lijg@futian.gov.cn", "好. 三 件 事 我们 都 决了, 散会.", None),
        ],
        "agent_messages": {
            "数据洞察": (
                "Q1 总 投诉 178 件, 比 Q4 +12%. 分类:\n"
                "- 电梯/设施 (62 件, 35%) — 主要 在 B 栋 + C 栋\n"
                "- 卫生/绿化 (43 件, 24%)\n"
                "- 物业费 争议 (28 件, 16%)\n"
                "- 噪音/扰民 (24 件, 13%)\n"
                "- 其他 (21 件, 12%)\n\n"
                "异常 信号: B 栋 电梯 投诉 集中 在 3 月 第二 周 (一周 7 件), 建议 重点 复盘."
            ),
            "客户服务": (
                "B 栋 那 3 个 业主 我 都 接 过 — 共同 诉求 是 '电梯 异响 半年 没 解决'. 建议:\n"
                "1. 立刻 一对一 上门 (我 这 周 排), 表达 重视\n"
                "2. 7 天 内 给 维保 公司 整改 方案 + 业主 共识\n"
                "3. 不 整改 → 直接 换 维保 公司"
            ),
            "物业运营": (
                "Q2 满意度 调查 我 建议 5 个 维度: 设施 维保 / 客服 响应 / 公区 卫生 / 安全 巡检 / 公开 透明. "
                "用 微信 公众号 推 + 物业 群 + 楼下 大屏 三 渠道, 目标 应答 率 ≥ 60%."
            ),
        },
        "action_items": [
            {
                "content": "更换 B 栋 电梯 维保 公司",
                "assignee_email": "demo.fengl@futian.gov.cn",
                "evidence_quote": "维保 公司 要 换. 这 是 第一 个 决策.",
                "transcript_anchor_idx": 6,  # 0-based index in transcript[]
                "topic_keywords": ["电梯", "维保", "B栋"],
                "due_offset_days": 14,
            },
            {
                "content": "客服 响应 时长 拉到 20 分钟 内 (含 招聘 1 名 客服)",
                "assignee_email": "demo.hanx@futian.gov.cn",
                "evidence_quote": "20 分钟 我们 现 在 人手 不够 — 需要 加 1 个 客服.",
                "transcript_anchor_idx": 9,
                "topic_keywords": ["客服", "响应", "招聘"],
                "due_offset_days": 30,
            },
            {
                "content": "Q2 业主 满意度 调查 (5 维度)",
                "assignee_email": "demo.hanx@futian.gov.cn",
                "evidence_quote": "Q2 增 一次 业主 满意度 调查, 给 5 个 关键 维度 打分. 这事 服务赵姐 牵头.",
                "transcript_anchor_idx": 11,
                "topic_keywords": ["满意度", "调查"],
                "due_offset_days": 45,
            },
        ],
        # Memory drafts: 一些 pending, 一些 approved (auto)
        "memory_drafts": [
            {
                "agent_name": "客户服务",
                "content": "B 栋 电梯 维保 一直 是 投诉 重点. 维保 公司 多次 整改 无效 时, 第一 选择 是 换 — 不要 反复 整改 浪费 业主 信任.",
                "status": "pending",
                "evidence_anchor_idx": 7,  # AI 发言 行 index
            },
            {
                "agent_name": "数据洞察",
                "content": "Q1 投诉 同比 上升 时, 优先 看 单栋 + 单分类 异常 集中 — 比 看 总量 更易 找出 抓手.",
                "status": "approved",  # 自动 approve, 用于 演示 已入库 + chip
                "evidence_anchor_idx": 1,
            },
        ],
    },
    {
        "title": "电梯 改造 方案 决策 会",
        "days_ago": 14,
        "duration_min": 55,
        "agenda": [
            {"title": "现状 + 三 家 方案 汇报", "time_budget_min": 15, "note": "永大 / 通力 / 三菱"},
            {"title": "三 家 方案 对比 讨论", "time_budget_min": 25, "note": "成本 / 工期 / 资质"},
            {"title": "决议 + 维修 资金 申请", "time_budget_min": 15, "note": "走 业主 大会 流程"},
        ],
        "attendee_emails": [
            "demo.lijg@futian.gov.cn",
            "demo.chensy@futian.gov.cn",
            "demo.fengl@futian.gov.cn",
            "bluesurfiregpt@gmail.com",
        ],
        "attendee_agents": ["财务核算", "政策法规", "物业运营"],
        "transcript": [
            ("demo.fengl@futian.gov.cn", "今天 议 B 栋 电梯 改造. 现在 三 个 方案: 永大 全 替换 65 万, 通力 大修 38 万, 三菱 全 替换 78 万.", None),
            (None, None, "财务核算"),
            ("demo.chensy@futian.gov.cn", "维修 资金 池 现在 多少?", None),
            ("demo.lijg@futian.gov.cn", "92 万. 走 65 万 + 78 万 都够 — 38 万 大修 也行, 但 5 年 后 还得 再投.", None),
            ("demo.fengl@futian.gov.cn", "我 倾向 永大 — 性价比 最 高 + 当地 维保 网点 密.", None),
            (None, None, "政策法规"),
            ("demo.chensy@futian.gov.cn", "公示 7 天 + 业主 表决 2/3 同意. 我们 业委会 还 在 不 在 任 内?", None),
            ("demo.lijg@futian.gov.cn", "在, 12 月 才 换届.", None),
            ("demo.chensy@futian.gov.cn", "那 走 业主 大会 没 问题. 但 65 万 一笔 大额, 风险 在 业主 群里 有人 反对 拖 进度. 建议 先 在 群里 摸 一下 底.", None),
            (None, None, "物业运营"),
            ("demo.fengl@futian.gov.cn", "OK 那 就 永大 — 我们 走 流程: 这 周 在 业主 群 摸底 + 列 三 家 方案 对比 表, 下 周 公示, 再 下 周 业主 大会 表决.", None),
            ("demo.lijg@futian.gov.cn", "陈 师宇 你 准备 公示 文 + 法规 引用 — 防 业主 质疑 程序.", None),
            ("demo.chensy@futian.gov.cn", "好.", None),
            ("demo.lijg@futian.gov.cn", "决议: 选 永大 65 万 方案, 启动 业主 大会 流程. 散会.", None),
        ],
        "agent_messages": {
            "财务核算": (
                "三 家 财务 对比:\n"
                "- 永大 65 万: 整改 后 维保 年 8 万, 5 年 总 105 万\n"
                "- 通力 大修 38 万: 维保 年 12 万 (老电梯 故障 多), 5 年 总 98 万 — 但 5 年 后 还得 再换\n"
                "- 三菱 78 万: 维保 年 7 万, 5 年 总 113 万, 残值 高\n\n"
                "永大 综合 性价比 最 高. 现 维修 资金 池 92 万, 走 永大 留 27 万 备用 — 安全."
            ),
            "政策法规": (
                "走 维修 资金 必 经 流程:\n"
                "1. 业委会 提 申请 + 公示 7 日\n"
                "2. 业主 表决 — 专有 面积 2/3 + 人数 2/3 双 同意\n"
                "3. 报 福田 区 房屋 管理 部门 审核 (5 工作日)\n"
                "4. 审核 通过 划款\n\n"
                "建议 公示 时 同时 列 三 家 方案 + 财务 对比, 防 业主 质疑 程序 不 透明."
            ),
            "物业运营": (
                "建议 流程: 群 摸底 (3-5 天) → 公示 (7 天) → 业主 大会 (1 天) → 报审 (5 工作日) → 划款 → 施工 (60 天).\n"
                "总 周期 ~85 天. 改造 期 业主 走 楼梯 + 临时 货梯, 客服 提前 沟通."
            ),
        },
        "action_items": [
            {
                "content": "业主 群 摸底 + 准备 三家 方案 对比 表",
                "assignee_email": "demo.fengl@futian.gov.cn",
                "evidence_quote": "这 周 在 业主 群 摸底 + 列 三 家 方案 对比 表, 下 周 公示, 再 下 周 业主 大会 表决.",
                "transcript_anchor_idx": 11,
                "topic_keywords": ["业主群", "摸底", "方案对比"],
                "due_offset_days": 7,
            },
            {
                "content": "公示 文 + 法规 引用 准备",
                "assignee_email": "demo.chensy@futian.gov.cn",
                "evidence_quote": "陈 师宇 你 准备 公示 文 + 法规 引用 — 防 业主 质疑 程序.",
                "transcript_anchor_idx": 12,
                "topic_keywords": ["公示", "法规", "业主大会"],
                "due_offset_days": 14,
            },
            {
                "content": "B 栋 电梯 改造 — 永大 65 万 方案 (走 业主 大会)",
                "assignee_email": "demo.fengl@futian.gov.cn",
                "evidence_quote": "决议: 选 永大 65 万 方案, 启动 业主 大会 流程.",
                "transcript_anchor_idx": 14,
                "topic_keywords": ["电梯改造", "永大", "维修资金"],
                "due_offset_days": 90,
            },
        ],
        "memory_drafts": [
            {
                "agent_name": "财务核算",
                "content": "评估 大型 维修 方案 时, 必 算 5 年 总 持有 成本 (含 维保 + 残值), 不 单看 一次性 投入. 长期 看 全 替换 比 大修 更 经济.",
                "status": "pending",
                "evidence_anchor_idx": 1,
            },
            {
                "agent_name": "政策法规",
                "content": "维修 资金 大额 使用 (≥ 50 万) 公示 时, 必 同时 列 多 家 方案 对比 + 法规 引用, 防 业主 质疑 程序.",
                "status": "pending",
                "evidence_anchor_idx": 5,
            },
        ],
    },
    {
        "title": "数据 安全 合规 风险 评估 会",
        "days_ago": 7,
        "duration_min": 60,
        "agenda": [
            {"title": "合规 要求 解读", "time_budget_min": 20, "note": "个保法 + 数据 出境"},
            {"title": "风险 点 梳理", "time_budget_min": 25, "note": "业主 信息 / 监控"},
            {"title": "整改 计划", "time_budget_min": 15, "note": "Q3 完成"},
        ],
        "attendee_emails": [
            "bluesurfiregpt@gmail.com",
            "demo.chensy@futian.gov.cn",
            "demo.lijg@futian.gov.cn",
        ],
        "attendee_agents": ["政策法规", "数据洞察"],
        "transcript": [
            ("demo.chensy@futian.gov.cn", "今天 复盘 数据 合规. 监管 上 月 抽查 我们 邻 街 物业, 罚了 8 万.", None),
            (None, None, "政策法规"),
            ("demo.chensy@futian.gov.cn", "我们 现在 业主 信息 存 在 哪?", None),
            ("demo.lijg@futian.gov.cn", "物业 系统 + 客服 钉钉 + 还有 一 份 Excel 在 财务 电脑 — 历史 遗留.", None),
            ("demo.chensy@futian.gov.cn", "Excel 那 份 必须 处理 — 这 是 合规 雷.", None),
            (None, None, "数据洞察"),
            ("demo.lijg@futian.gov.cn", "监控 视频 呢? 我 听说 也 有 风险.", None),
            ("demo.chensy@futian.gov.cn", "监控 录像 不能 给 第三方 访问, 包括 业主 自己 也 不能 直接 调 — 必须 走 物业 + 报 公安.", None),
            ("demo.lijg@futian.gov.cn", "OK 三 件 事: 1) Excel 业主 信息 这 月 内 下线 + 迁 系统; 2) 监控 访问 流程 重 申 + 培训 客服; 3) 全 员 数据 合规 培训 一 次.", None),
            ("demo.chensy@futian.gov.cn", "培训 我 来 排.", None),
            ("demo.lijg@futian.gov.cn", "好, 散.", None),
        ],
        "agent_messages": {
            "政策法规": (
                "《个人 信息 保护 法》对 物业 公司 关键 三 点:\n"
                "1. 业主 信息 收集 必 单独 同意 + 告知 用途\n"
                "2. 业主 信息 存储 必 加密 + 访问 权限 分级\n"
                "3. 业主 信息 不 得 提供 给 第三方 (含 关联 公司) 未经 同意\n\n"
                "近 期 福田 区 处罚 案 都 围绕 第 2-3 条 — 重点 排查."
            ),
            "数据洞察": (
                "Excel 业主 信息 估 含 1200+ 条, 主要 是 历史 业主 (现在 物业 系统 已迁 但 老 Excel 没删).\n"
                "建议 一周 内 评估 + 删除 — 不动 它 = 合规 雷."
            ),
        },
        "action_items": [
            {
                "content": "Excel 业主 信息 下线 + 迁 物业 系统",
                "assignee_email": "demo.lijg@futian.gov.cn",
                "evidence_quote": "Excel 业主 信息 这 月 内 下线 + 迁 系统",
                "transcript_anchor_idx": 8,
                "topic_keywords": ["Excel", "业主信息", "合规"],
                "due_offset_days": 30,
            },
            {
                "content": "监控 视频 访问 流程 重申 + 客服 培训",
                "assignee_email": "demo.hanx@futian.gov.cn",
                "evidence_quote": "监控 访问 流程 重 申 + 培训 客服",
                "transcript_anchor_idx": 8,
                "topic_keywords": ["监控", "客服培训"],
                "due_offset_days": 21,
            },
            {
                "content": "全员 数据 合规 培训",
                "assignee_email": "demo.chensy@futian.gov.cn",
                "evidence_quote": "全 员 数据 合规 培训 一 次",
                "transcript_anchor_idx": 8,
                "topic_keywords": ["合规", "培训"],
                "due_offset_days": 30,
            },
        ],
        "memory_drafts": [
            {
                "agent_name": "政策法规",
                "content": "《个保法》对 物业 公司 三 大 风险 点: 1) 业主 信息 未 单独 同意 收集; 2) 信息 未 加密 / 未 分权; 3) 给 第三方 (含 关联 公司) 未经 同意. 整改 优先级 高.",
                "status": "pending",
                "evidence_anchor_idx": 1,
            },
        ],
    },
]


# ============================================================================
# 进行中 会议 (1 场) — 已 走完 第一项 + 进行 第二项
# ============================================================================

ONGOING_MEETING = {
    "title": "本周 物业 周例会 (进行中)",
    "started_minutes_ago": 30,  # 30 分钟 前 开始
    "agenda": [
        {"title": "上周 收尾 复盘", "time_budget_min": 10, "note": "B栋 电梯 进度"},
        {"title": "本周 重点 工作", "time_budget_min": 20, "note": "招聘 + 投诉 处理"},
        {"title": "难点 讨论", "time_budget_min": 15, "note": "财务 缺口 / 业主 群体 事件"},
    ],
    "attendee_emails": [
        "demo.lijg@futian.gov.cn",
        "demo.chensy@futian.gov.cn",
        "demo.fengl@futian.gov.cn",
        "demo.hanx@futian.gov.cn",
    ],
    "attendee_agents": ["数据洞察", "物业运营", "客户服务"],
    # 仅 给 5 行 transcript — 模拟 "进行 中"
    "transcript": [
        ("demo.lijg@futian.gov.cn", "周一 例会, 第一 项 上周 收尾. 永大 电梯 公示 走 完 没?"),
        ("demo.fengl@futian.gov.cn", "公示 已 走 完, 6 天 内 没 业主 反对. 业主 大会 安 排 在 周三."),
        ("demo.lijg@futian.gov.cn", "OK 第一 项 收 — 推进 第二 项: 本周 重点."),
        ("demo.fengl@futian.gov.cn", "投诉 招 1 个 客服 进度 — 简历 收 了 8 份, 周三 面 试."),
        ("demo.hanx@futian.gov.cn", "我 这 周 排 业主 满意度 调查 上线 时间 表."),
    ],
    "current_agenda_idx": 1,  # 第一 项 已完成, 在 第二 项
}


# ============================================================================
# Helpers
# ============================================================================

def _ms_offset(idx: int) -> int:
    """transcript 行 模拟 时间戳 — 每行 间隔 30s."""
    return idx * 30_000


async def _create_meeting_with_transcripts(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    spec: dict,
    user_ids: dict[str, uuid.UUID],
    agent_ids: dict[str, uuid.UUID],
    finished: bool,
) -> tuple[uuid.UUID, list[int]]:
    """创建 meeting + transcript + 返回 transcript line_id 数组 (跟 spec.transcript 一一对应)."""
    if finished:
        started_at = datetime.now(timezone.utc) - timedelta(days=spec["days_ago"])
        ended_at = started_at + timedelta(minutes=spec["duration_min"])
        status = "processed"
    else:
        started_at = datetime.now(timezone.utc) - timedelta(minutes=spec["started_minutes_ago"])
        ended_at = None
        status = "ongoing"

    # 先 看 是否 已 存在 (按 title + workspace 查重)
    existing = (
        await db.execute(
            select(Meeting).where(
                Meeting.title == spec["title"],
                Meeting.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        logger.info("meeting skip (exists): %s", spec["title"])
        # 拉 已有 transcript line_ids
        rows = (
            await db.execute(
                select(MeetingTranscript.id)
                .where(MeetingTranscript.meeting_id == existing.id)
                .order_by(MeetingTranscript.id)
            )
        ).all()
        return existing.id, [r[0] for r in rows]

    # 议程 progress 数据 — 已结束 会议: 全 done; 进行中: 第一项 done, 第 current_idx active
    agenda_progress = []
    if finished:
        # 模拟: 各 议程 项 按 顺序 跑 完, 各 项 实际 用时 ≈ budget * (0.8~1.2 randomish)
        cur_t = started_at
        for i, item in enumerate(spec["agenda"]):
            budget_min = item.get("time_budget_min") or 10
            # 简化: 实际 用时 = budget * 0.95
            actual_min = max(1, int(budget_min * 0.95))
            entry_started = cur_t
            entry_ended = cur_t + timedelta(minutes=actual_min)
            agenda_progress.append({
                "idx": i,
                "started_at": entry_started.isoformat(),
                "ended_at": entry_ended.isoformat(),
                "advanced_by_user_id": str(user_ids.get(spec["attendee_emails"][0])),
                "status": "done",
            })
            cur_t = entry_ended
        current_agenda_idx = len(spec["agenda"])  # 全 完成
    else:
        # 进行中: 第一 项 done, current 项 active, 后面 没 push
        cur_t = started_at
        for i in range(spec["current_agenda_idx"]):
            item = spec["agenda"][i]
            budget_min = item.get("time_budget_min") or 10
            actual_min = max(1, int(budget_min * 0.9))
            agenda_progress.append({
                "idx": i,
                "started_at": cur_t.isoformat(),
                "ended_at": (cur_t + timedelta(minutes=actual_min)).isoformat(),
                "advanced_by_user_id": str(user_ids.get(spec["attendee_emails"][0])),
                "status": "done",
            })
            cur_t = cur_t + timedelta(minutes=actual_min)
        # 当前 active 项
        agenda_progress.append({
            "idx": spec["current_agenda_idx"],
            "started_at": cur_t.isoformat(),
            "ended_at": None,
            "advanced_by_user_id": None,
            "status": "active",
        })
        current_agenda_idx = spec["current_agenda_idx"]

    creator_email = spec["attendee_emails"][0]
    creator_user_id = user_ids.get(creator_email)

    m = Meeting(
        workspace_id=workspace_id,
        title=spec["title"],
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        agenda=spec["agenda"],
        mode="hybrid",
        created_by_user_id=creator_user_id,
        current_agenda_idx=current_agenda_idx,
        agenda_progress=agenda_progress,
        summary_md=f"{SEED_MARKER} 物业 demo 会议 — 用 于 推广 截图.",
    )
    db.add(m)
    await db.flush()

    # 加 attendee (人 + AI)
    for email in spec["attendee_emails"]:
        uid = user_ids.get(email)
        if uid:
            db.add(MeetingAttendee(meeting_id=m.id, user_id=uid))
    for agent_name in spec.get("attendee_agents", []):
        aid = agent_ids.get(agent_name)
        if aid:
            db.add(MeetingAttendee(meeting_id=m.id, agent_id=aid))

    # 加 transcript — 行 ID 顺序 累积
    transcript_line_ids: list[int] = []
    for i, entry in enumerate(spec["transcript"]):
        # entry 形态:
        #   (speaker_email, text, agent_name)
        #   - 真人 行: (email, text, None)
        #   - AI 行: (None, None, agent_name) — 真 文字 来自 agent_messages dict
        #   进行中: (email, text) 两元组 — 简化
        if not finished and len(entry) == 2:
            email, text = entry
            agent_name = None
        else:
            email, text, agent_name = entry

        if agent_name and not text:
            # AI 发言 — 从 agent_messages 取 文本
            agent_messages = spec.get("agent_messages", {})
            text = agent_messages.get(agent_name) or "(seed: 缺 agent 文本)"
            agent_id = agent_ids.get(agent_name)
            line = MeetingTranscript(
                meeting_id=m.id,
                text=text,
                start_ms=_ms_offset(i),
                end_ms=_ms_offset(i) + 8000,
                is_final=True,
                agent_id=agent_id,
                speaker_status="agent",
            )
        else:
            uid = user_ids.get(email) if email else None
            line = MeetingTranscript(
                meeting_id=m.id,
                text=text or "(seed: 缺 文本)",
                start_ms=_ms_offset(i),
                end_ms=_ms_offset(i) + 5000,
                is_final=True,
                speaker_user_id=uid,
                speaker_status="auto_recognized" if uid else "low_confidence",
            )
        db.add(line)
        await db.flush()
        transcript_line_ids.append(line.id)

    await db.commit()
    logger.info(
        "meeting added: %s (status=%s, %d transcript lines)",
        spec["title"], status, len(transcript_line_ids),
    )
    return m.id, transcript_line_ids


async def _seed_action_items(
    db: AsyncSession, meeting_id: uuid.UUID, spec: dict,
    user_ids: dict[str, uuid.UUID],
    transcript_line_ids: list[int],
) -> None:
    """为 spec.action_items 建 MeetingActionItem 行, evidence_anchor_line_ids 用 真 行 ID."""
    for ai_spec in spec.get("action_items", []):
        # 先 查 是否 已有
        existing = (
            await db.execute(
                select(MeetingActionItem).where(
                    MeetingActionItem.meeting_id == meeting_id,
                    MeetingActionItem.content == ai_spec["content"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue
        anchor_idx = ai_spec.get("transcript_anchor_idx")
        if anchor_idx is not None and 0 <= anchor_idx < len(transcript_line_ids):
            anchor_line_ids = [transcript_line_ids[anchor_idx]]
        else:
            anchor_line_ids = None
        assignee_uid = user_ids.get(ai_spec.get("assignee_email"))
        due_at = None
        if "due_offset_days" in ai_spec:
            due_at = datetime.now(timezone.utc) + timedelta(days=ai_spec["due_offset_days"])
        ai_row = MeetingActionItem(
            meeting_id=meeting_id,
            content=ai_spec["content"],
            assignee_user_id=assignee_uid,
            due_at=due_at,
            status="open",
            source_type="summary",
            evidence_quote=ai_spec.get("evidence_quote"),
            evidence_anchor_line_ids=anchor_line_ids,
            topic_keywords=ai_spec.get("topic_keywords"),
        )
        db.add(ai_row)
    await db.commit()


async def _seed_memory_drafts(
    db: AsyncSession, meeting_id: uuid.UUID, workspace_id: uuid.UUID,
    spec: dict,
    agent_ids: dict[str, uuid.UUID],
    user_ids: dict[str, uuid.UUID],
    transcript_line_ids: list[int],
) -> None:
    """为 spec.memory_drafts 建 MemoryDraft (status=pending) 或
    LongTermMemory (status=approved 时 直接 入库 + Memory + Link)."""
    creator_email = spec["attendee_emails"][0]

    for md_spec in spec.get("memory_drafts", []):
        agent_name = md_spec["agent_name"]
        agent_id = agent_ids.get(agent_name)
        if not agent_id:
            continue
        # 取 agent 的 primary_user_id 当 审批人
        agent_row = (
            await db.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one_or_none()
        if not agent_row or not agent_row.primary_user_id:
            continue
        primary_user_id = agent_row.primary_user_id

        anchor_idx = md_spec.get("evidence_anchor_idx")
        anchor_line_ids = None
        if anchor_idx is not None and 0 <= anchor_idx < len(transcript_line_ids):
            anchor_line_ids = [transcript_line_ids[anchor_idx]]

        # 已存在 跳过
        existing = (
            await db.execute(
                select(MemoryDraft).where(
                    MemoryDraft.workspace_id == workspace_id,
                    MemoryDraft.proposed_content == md_spec["content"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue

        if md_spec["status"] == "approved":
            # 直接 入 LongTermMemory + 不 进 draft 池 (跳 审批 — 给 演示 看)
            mem = LongTermMemory(
                workspace_id=workspace_id,
                agent_id=agent_id,
                scope="project",
                scope_ref=str(meeting_id),
                content=md_spec["content"],
                importance=0.7,
                source_type="meeting",
                source_id=str(meeting_id),
                source_meeting_id=meeting_id,
                source_line_ids=anchor_line_ids,
                data_classification="general",
                curated_by_user_id=primary_user_id,
                curated_at=datetime.now(timezone.utc) - timedelta(days=1),
                embedding=[0.0] * 1536,
            )
            db.add(mem)
            await db.flush()
            db.add(MemoryAgentLink(
                memory_id=mem.id, agent_id=agent_id, is_primary=True,
            ))
            logger.info("memory committed: %s (agent=%s)", md_spec["content"][:30], agent_name)
        else:
            draft = MemoryDraft(
                workspace_id=workspace_id,
                source_type="meeting",
                source_meeting_id=meeting_id,
                source_line_ids=anchor_line_ids,
                target_agent_ids=[str(agent_id)],
                primary_user_id=primary_user_id,
                proposed_content=md_spec["content"],
                proposed_scope="project",
                proposed_scope_ref=str(meeting_id),
                proposed_importance=0.7,
                proposed_data_classification="general",
                status="pending",
            )
            db.add(draft)
            logger.info("memory draft pending: %s (agent=%s)", md_spec["content"][:30], agent_name)
    await db.commit()


# ============================================================================
# Main
# ============================================================================

async def main() -> None:
    async with SessionLocal() as db:
        # 找 workspace 通过 owner email
        owner = await _get_user_by_email(db, "bluesurfiregpt@gmail.com")
        if not owner or not owner.workspace_id:
            logger.error("找 不 到 owner / workspace, 退出")
            return
        workspace_id = owner.workspace_id
        logger.info("workspace_id = %s", workspace_id)

        # 拉 全部 涉及 emails 的 user_ids
        all_emails = {"bluesurfiregpt@gmail.com"} | set()
        for spec in FINISHED_MEETINGS:
            all_emails.update(spec["attendee_emails"])
        all_emails.update(ONGOING_MEETING["attendee_emails"])
        for spec in DEMO_AGENTS:
            all_emails.add(spec["primary_user_email"])

        user_ids: dict[str, uuid.UUID] = {}
        for email in all_emails:
            u = await _get_user_by_email(db, email)
            if u:
                user_ids[email] = u.id
            else:
                logger.warning("email 找 不 到 user: %s", email)

        # 1. seed agents
        agent_ids = await seed_agents(db, workspace_id)

        # 2. seed KB (绑 政策法规 AI — 法规 类 知识)
        legal_agent_id = agent_ids.get("政策法规")
        if legal_agent_id:
            await seed_kb(db, workspace_id, legal_agent_id)

        # 3. seed 已结束 meetings
        for spec in FINISHED_MEETINGS:
            mid, line_ids = await _create_meeting_with_transcripts(
                db, workspace_id, spec, user_ids, agent_ids, finished=True,
            )
            await _seed_action_items(db, mid, spec, user_ids, line_ids)
            await _seed_memory_drafts(db, mid, workspace_id, spec, agent_ids, user_ids, line_ids)

        # 4. seed 进行中 meeting
        await _create_meeting_with_transcripts(
            db, workspace_id, ONGOING_MEETING, user_ids, agent_ids, finished=False,
        )

    logger.info("seed_demo_property done.")


if __name__ == "__main__":
    asyncio.run(main())
