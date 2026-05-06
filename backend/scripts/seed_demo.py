"""
Seed realistic demo data so the user can poke at every feature.

What we DON'T seed: voiceprints — those require real audio + a pyannote
roundtrip. Use the existing real users (邓西/幸世杰) for voiceprint-aware
testing.

Idempotency: every row carries a marker (agent.boundary or
meeting.summary_md prefix) so re-running the script tops up missing pieces
instead of duplicating. Safe to invoke any time.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure /app is on sys.path when run from the backend container
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.memory_extractor import extract_and_store_memories
from app.models import (
    Agent,
    Meeting,
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingTranscript,
    User,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
logger = logging.getLogger("seed_demo")


SEED_MARKER = "[seed_demo v1]"


# ---- Agents ------------------------------------------------------------------

DEMO_AGENTS = [
    {
        "name": "产品专家",
        "domain": "产品 · 用户体验",
        "persona": "你是一名资深产品经理,擅长用户价值与商业逻辑判断。回答带强烈个人风格,愿意明确表达「先做 X」「拒绝做 Y」的立场,不绕弯子。",
        "tone": "直率、克制、有判断力",
        "boundary": f"{SEED_MARKER} 不替代设计师做交互细节;不评论商业之外的法务/财务议题",
        "color": "violet",
        "keywords": ["需求", "用户价值", "MVP", "产品", "优先级"],
    },
    {
        "name": "法务专家",
        "domain": "法务 · 合规",
        "persona": "你是一名熟悉政企采购、个人信息保护、数据出境法规的法务顾问。回答时先点出最关键的合规风险,然后给出建议路径。",
        "tone": "审慎、有依据、避免空话",
        "boundary": f"{SEED_MARKER} 只在合规框架内做判断;不替代正式法律意见书",
        "color": "amber",
        "keywords": ["合规", "法务", "风险", "数据出境", "个人信息", "采购"],
    },
    {
        "name": "架构专家",
        "domain": "技术架构",
        "persona": "你是一名后端架构师,擅长分布式、数据库、AI 系统设计。给出方案时强调可演进性、运维复杂度和故障域。",
        "tone": "理性、注重 trade-off",
        "boundary": f"{SEED_MARKER} 不评论纯前端实现细节;不预测具体性能数字,只给量级",
        "color": "sky",
        "keywords": ["架构", "性能", "扩展", "技术选型", "数据库", "故障"],
    },
    {
        "name": "项目推进专家",
        "domain": "项目管理",
        "persona": "你是一名经验丰富的项目经理,关注交付节奏、依赖、责任人是否明确。每次发言都尝试把讨论推到下一个具体行动上。",
        "tone": "推进型、不容忍模糊",
        "boundary": f"{SEED_MARKER} 不参与具体技术取舍;只关心目标-时间-人三件事",
        "color": "emerald",
        "keywords": ["进度", "deadline", "依赖", "责任人", "里程碑", "交付"],
    },
]


async def seed_agents(db: AsyncSession) -> int:
    n_added = 0
    for spec in DEMO_AGENTS:
        existing = (
            await db.execute(select(Agent).where(Agent.name == spec["name"]))
        ).scalar_one_or_none()
        if existing:
            # Refresh persona/keywords if it was a vanilla one
            if not existing.boundary or SEED_MARKER not in (existing.boundary or ""):
                for k, v in spec.items():
                    setattr(existing, k, v)
                logger.info("agent updated: %s", spec["name"])
            continue
        a = Agent(**spec, is_active=True)
        db.add(a)
        n_added += 1
        logger.info("agent added: %s", spec["name"])
    await db.commit()
    return n_added


# ---- Users -------------------------------------------------------------------

DEMO_USER_NAMES = ["张产品", "李法务", "王架构", "赵项目"]


async def seed_users(db: AsyncSession) -> dict[str, uuid.UUID]:
    out: dict[str, uuid.UUID] = {}
    for name in DEMO_USER_NAMES:
        existing = (
            await db.execute(select(User).where(User.name == name))
        ).scalar_one_or_none()
        if existing:
            out[name] = existing.id
            continue
        u = User(name=name)
        db.add(u)
        await db.flush()
        out[name] = u.id
        logger.info("user added: %s", name)
    # Also surface the real user names so meeting transcripts can mix them
    for real in ("邓西", "幸世杰"):
        u = (await db.execute(select(User).where(User.name == real))).scalar_one_or_none()
        if u:
            out[real] = u.id
    await db.commit()
    return out


# ---- Meetings ----------------------------------------------------------------

# Each meeting: (title, started_at_offset_days, attendee_names, transcript [(speaker, text)], summary_md, agent_messages [(agent_name, text)])
DEMO_MEETINGS: list[dict] = [
    {
        "title": "AI 会议系统 · Phase 2 评审",
        "days_ago": 14,
        "attendees": ["张产品", "王架构", "赵项目", "邓西"],
        "transcript": [
            ("张产品", "今天主要评审 Phase 2 的两件事:长期记忆怎么做、Dify 同步层要不要现在做。"),
            ("王架构", "我的建议是先做长期记忆,Dify 同步层放后面。"),
            ("赵项目", "理由?"),
            ("王架构", "记忆是新能力,有用户价值;Dify 同步只是把已有能力的运维做收口,不增加用户感知。"),
            ("张产品", "同意,而且 dify 同步层依赖记忆和知识库的数据形态稳定下来,不应该先做。"),
            ("赵项目", "那记忆这块的负责人是邓西吧?预计什么时候能上线?"),
            ("邓西", "我接,大致 4 天能跑通端到端,会前简报 + Agent 注入两个面都覆盖。"),
            ("王架构", "embedding 选什么?"),
            ("邓西", "DashScope 的 text-embedding-v2,1536 维,共用现有 STT 的 key,不增加供应商。"),
            ("张产品", "OK。第二件事:声纹精度。上次只有 60%,这次必须提到 85% 以上才能给政务客户演示。"),
            ("王架构", "我看了下,主要是 pyannote 模型不对。precision-2 应该能直接拉到 80%+。"),
            ("张产品", "那 precision-2 是付费档吗?"),
            ("邓西", "是,但用量不大,可以先开。"),
            ("赵项目", "决定:升级 precision-2,邓西本周内验证。"),
            ("王架构", "另外还有一个隐忧:precision-2 比 precision-1 严格,会出现「未识别」的情况增多。"),
            ("张产品", "那就配上人工纠错 UI,让用户在结果里点一下改名,这事邓西也一并做。"),
            ("赵项目", "记下:1) 长期记忆,4 天内,邓西。2) precision-2 + 人工纠错,本周,邓西。"),
        ],
        "summary": (
            "## 会议主题\n"
            "AI 会议系统 Phase 2 评审:确定长期记忆与声纹精度优先级\n\n"
            "## 概览\n"
            "本场评审聚焦 Phase 2 两条主线。一致同意先做长期记忆,Dify 同步层延后,理由是用户感知更强且依赖数据形态先稳定。声纹精度方面决议升级 pyannote 至 precision-2 模型,并配套人工纠错 UI 解决严格模型带来的「未识别」增多问题。\n\n"
            "## 关键要点\n"
            "- 长期记忆 embedding 选用 DashScope text-embedding-v2,复用现有 STT key,不增加供应商\n"
            "- precision-2 是 pyannote 付费档,因用量小可启用\n"
            "- 政务客户演示要求声纹准确率 85%+\n\n"
            "## 已形成决策\n"
            "- 先做长期记忆,Dify 同步层后置 — 决策人: 张产品/王架构/赵项目\n"
            "- 声纹链路升级到 pyannote precision-2 — 决策人: 张产品/邓西\n"
            "- 配套人工纠错 UI(用户可在结果中点击改名) — 决策人: 张产品\n\n"
            "## 分歧事项\n"
            "无明显分歧,所有关键议题一致通过\n\n"
            "## 风险提醒\n"
            "- precision-2 比 precision-1 严格,「未识别」case 会增多 — 提出人: 王架构\n"
            "- 政务客户演示对声纹准确率有硬性要求(85%+) — 提出人: 张产品\n\n"
            "## 待办事项\n"
            "- [ ] 长期记忆端到端实现(会前简报 + Agent 注入) — 负责: 邓西, 截止: 4 天内\n"
            "- [ ] precision-2 升级 + 人工纠错 UI — 负责: 邓西, 截止: 本周内\n\n"
            "## 下一步建议\n"
            "- 上线后内部跑 3-5 场真实会议,采集声纹准确率数据\n"
            "- 长期记忆运行一周后回顾抽取质量,必要时调 importance 阈值"
        ),
        "agent_messages": [
            (
                "架构专家",
                "我赞成先做长期记忆。Dify 同步层不创造用户价值,而记忆 + 会前简报这一对功能直接抬高每场会议的边际价值。另外,记忆和知识库的数据形态没稳定之前,过早建同步层等于自找返工。",
            ),
        ],
    },
    {
        "title": "客户合规需求 · 个人信息保护与数据出境",
        "days_ago": 7,
        "attendees": ["李法务", "张产品", "王架构", "幸世杰"],
        "transcript": [
            ("李法务", "今天的议题是政务客户对个人信息保护和数据出境的硬性要求。"),
            ("张产品", "客户具体担心什么?"),
            ("李法务", "主要三块:声纹是否属于敏感个人信息、会议录音是否会出境、谁能看到原始音频。"),
            ("王架构", "声纹按《个保法》是生物识别信息,属于敏感个人信息,处理要单独同意。"),
            ("李法务", "对,所以录入页面必须有明确的告知与勾选同意环节。"),
            ("张产品", "那现在的「录入声纹」页面没有同意框,需要补。"),
            ("王架构", "数据出境这块,我们 OSS bucket 是新加坡,这就是出境。pyannote 服务也在境外。"),
            ("李法务", "政务客户原则上不接受境外存储,必须把 OSS 切到国内地域,pyannote 也要找替代。"),
            ("幸世杰", "pyannote 国内有替代吗?"),
            ("李法务", "阿里云有声纹,精度差一些,但合规没问题。短期可以走数据本地化,加一个开关切供应商。"),
            ("张产品", "决定:我们做一个供应商开关,默认境外 pyannote(精度高);政务客户演示前切到阿里云国内(合规)。"),
            ("王架构", "OSS bucket 这周内迁回杭州。"),
            ("李法务", "另外建议明年 Q1 之前,把所有数据库、对象存储、AI 服务都做一次合规审查。"),
        ],
        "summary": (
            "## 会议主题\n"
            "政务客户合规需求评审:个人信息保护与数据出境合规改造\n\n"
            "## 概览\n"
            "李法务系统梳理了政务客户对个人信息保护和数据出境的硬性要求,确认声纹属于敏感个人信息,需补录入同意环节;OSS 与 pyannote 当前均在境外,不符合政务客户要求。会议决定建立供应商开关机制,并推动数据本地化改造。\n\n"
            "## 关键要点\n"
            "- 声纹依《个保法》属生物识别信息,处理需单独同意\n"
            "- OSS 当前在新加坡,pyannote 服务在境外,均构成数据出境\n"
            "- 阿里云国内声纹方案精度略低但合规\n\n"
            "## 已形成决策\n"
            "- 录入声纹页面增加告知与同意勾选 — 决策人: 张产品/李法务\n"
            "- 实现供应商开关:境外 pyannote(默认高精度)/阿里云国内(政务合规) — 决策人: 张产品\n"
            "- OSS bucket 本周内迁回杭州地域 — 决策人: 王架构\n\n"
            "## 分歧事项\n"
            "无,合规要求无回旋空间\n\n"
            "## 风险提醒\n"
            "- 数据出境违反《个保法》面临监管处罚 — 提出人: 李法务\n"
            "- 阿里云国内声纹精度可能不足以达成 85% 目标 — 提出人: 李法务\n\n"
            "## 待办事项\n"
            "- [ ] 录入页面加同意勾选 + 告知文案 — 负责: 张产品(产品)/邓西(实施), 截止: 下周内\n"
            "- [ ] 供应商开关实现 — 负责: 王架构, 截止: 2 周内\n"
            "- [ ] OSS bucket 杭州迁移 — 负责: 王架构, 截止: 本周内\n"
            "- [ ] 全栈合规审查 — 负责: 李法务/王架构, 截止: 明年 Q1 前\n\n"
            "## 下一步建议\n"
            "- 政务客户演示前完成 OSS 迁移与供应商开关\n"
            "- 评估阿里云国内声纹的实际准确率,制定降级方案"
        ),
        "agent_messages": [
            (
                "法务专家",
                "李法务说的合规要求都是硬底线。声纹作为生物识别信息,处理前必须明示同意,这一点容不得灰色。建议同意书写明:1) 用途仅限会议中说话人识别;2) 保存期限;3) 用户可随时撤销并删除。OSS 出境问题,即使技术成本高也必须切回国内,因为这是定性问题不是程度问题。",
            ),
            (
                "项目推进专家",
                "三件事的优先级建议这样排:本周做 OSS 迁移(技术成本最低、影响最小)、下周做录入页同意(产品接口稳定后实施)、两周内做供应商开关(影响面最广,需充分回归测试)。建议王架构今天就把 OSS 迁移的 PR 开出来,不要积压。",
            ),
        ],
    },
    {
        "title": "Phase 3 启动会 · 多 Agent 协同与 KB 自动同步",
        "days_ago": 2,
        "attendees": ["张产品", "王架构", "赵项目", "邓西", "幸世杰"],
        "transcript": [
            ("张产品", "Phase 3 主线两件事:多 Agent 协同、KB 自动同步。"),
            ("王架构", "多 Agent 协同需要 Orchestrator,Phase 1.5 我们已经预留了接口位置。"),
            ("张产品", "Orchestrator 应该解决什么具体问题?"),
            ("王架构", "现在每次只能一个 Agent 发言。Phase 3 要做的是让多个专家按话题接力 — 比如先法务讲合规、再财务讲预算、最后技术给方案。"),
            ("赵项目", "听起来很有用。但「按话题接力」的判断逻辑怎么做?"),
            ("王架构", "可以用一个轻量的「主持人 Agent」,根据上下文识别该谁发言。"),
            ("邓西", "我有顾虑。这种自动选 Agent 会引入新的不确定性,而当前手动点头像的体验已经很顺。"),
            ("张产品", "邓西的担心合理。建议两件事并行:1) Orchestrator 先做「点一个头像 → 它推荐下一个发言专家」,作为辅助提示,不强制。2) 全自动接力放到 Phase 3 末。"),
            ("赵项目", "关于 KB 自动同步呢?这块跟之前定的 Dify 隐藏后台是一致的吧?"),
            ("张产品", "对。Phase 3 真正的目标是:用户在我们后台上传文档 → 系统自动同步到 Dify Datasets,Agent 调用时透明引用。"),
            ("王架构", "n8n 是更合适的承载,定时把 OA、Notion、Google Drive 的更新拉过来。"),
            ("幸世杰", "n8n 的部署谁负责?"),
            ("王架构", "我来。一周内出 PoC。"),
            ("赵项目", "决定:1) Orchestrator 第一版做推荐式,不强制;2) KB 同步通过 n8n,王架构出 PoC。"),
            ("张产品", "另外补一个:既然要做 KB,我们的 admin/knowledge-bases 页面也要新建。"),
            ("邓西", "我接 admin/knowledge-bases。"),
        ],
        "summary": (
            "## 会议主题\n"
            "Phase 3 启动会:多 Agent 协同(Orchestrator)与 KB 自动同步设计\n\n"
            "## 概览\n"
            "Phase 3 启动评审。Orchestrator 第一版采用「推荐式」而非「自动接力」,避免破坏已成熟的手动点头像体验;全自动接力放至 Phase 3 末再评估。KB 自动同步坚持「Dify 隐身于自研后台之后」的架构原则,通过 n8n 拉通 OA/Notion/Google Drive,Agent 调用 KB 时透明引用。\n\n"
            "## 关键要点\n"
            "- Orchestrator 解决「多个专家按话题接力发言」的复杂场景\n"
            "- Phase 1.5 已预留 Orchestrator 接口位置\n"
            "- 全自动接力存在不确定性风险,采用渐进式推进\n"
            "- KB 同步走 n8n,符合 Dify 隐身原则\n\n"
            "## 已形成决策\n"
            "- Orchestrator 第一版做推荐式(点头像后推荐下一专家),不强制 — 决策人: 张产品/赵项目\n"
            "- 全自动接力评估推迟至 Phase 3 末 — 决策人: 邓西/张产品\n"
            "- KB 自动同步通过 n8n 实现 — 决策人: 王架构/赵项目\n"
            "- 自研 admin/knowledge-bases 后台页面 — 决策人: 张产品\n\n"
            "## 分歧事项\n"
            "- 王架构倾向更激进的「主持人 Agent 自动接力」;邓西担心引入不确定性 — 通过分阶段推进达成共识\n\n"
            "## 风险提醒\n"
            "- Orchestrator 自动选 Agent 可能破坏当前流畅的手动体验 — 提出人: 邓西\n"
            "- n8n 部署引入新运维复杂度 — 提出人: 隐含\n\n"
            "## 待办事项\n"
            "- [ ] Orchestrator 推荐式第一版 — 负责: 王架构, 截止: 待定\n"
            "- [ ] n8n 部署 + KB 同步 PoC — 负责: 王架构, 截止: 1 周内\n"
            "- [ ] admin/knowledge-bases 后台页面 — 负责: 邓西, 截止: 待定\n\n"
            "## 下一步建议\n"
            "- 王架构本周内出 n8n PoC 并 demo\n"
            "- Orchestrator 推荐式 UI 先做 mock,验证体验后再排期实现\n"
            "- 关注用户对自动 Agent 切换的真实接受度"
        ),
        "agent_messages": [
            (
                "架构专家",
                "Orchestrator 的关键不是「能做」,而是「能稳」。建议做成 stateless 的路由层,所有路由决策都基于当前可见上下文,不持久化决策状态 — 这样万一选错也只影响这一次发言,不会污染后续。n8n 这块我倾向自托管而非云服务,毕竟 KB 流是组织的核心数据流。",
            ),
        ],
    },
]


async def seed_meetings(db: AsyncSession, user_ids: dict[str, uuid.UUID], agent_ids: dict[str, uuid.UUID]) -> list[uuid.UUID]:
    """Returns the meeting_ids that were freshly inserted (so we can run
    memory extraction on those)."""
    out: list[uuid.UUID] = []
    now = datetime.now(timezone.utc)
    for spec in DEMO_MEETINGS:
        existing = (
            await db.execute(select(Meeting).where(Meeting.title == spec["title"]))
        ).scalar_one_or_none()
        if existing:
            continue

        started = now - timedelta(days=spec["days_ago"])
        ended = started + timedelta(minutes=18)
        m = Meeting(
            title=spec["title"],
            status="processed",
            started_at=started,
            ended_at=ended,
            summary_md=spec["summary"],
        )
        db.add(m)
        await db.flush()

        # attendees
        for name in spec["attendees"]:
            uid = user_ids.get(name)
            if uid is None:
                continue
            db.add(MeetingAttendee(meeting_id=m.id, user_id=uid))

        # transcripts (fake start_ms by spreading evenly across 18 minutes)
        n_lines = len(spec["transcript"])
        per_line_ms = (18 * 60 * 1000) // max(1, n_lines)
        for i, (speaker_name, text) in enumerate(spec["transcript"]):
            start_ms = i * per_line_ms + 500
            end_ms = start_ms + 3500
            speaker_uid = user_ids.get(speaker_name)
            db.add(
                MeetingTranscript(
                    meeting_id=m.id,
                    text=text,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    is_final=True,
                    speaker_user_id=speaker_uid,
                    speaker_label="auto_recognized" if speaker_uid else "UNKNOWN",
                    speaker_status="auto_recognized" if speaker_uid else "low_confidence",
                    confidence=1.0 if speaker_uid else None,
                )
            )

        # agent messages
        for agent_name, text in spec["agent_messages"]:
            aid = agent_ids.get(agent_name)
            if aid is None:
                continue
            db.add(
                MeetingAgentMessage(
                    meeting_id=m.id,
                    agent_id=aid,
                    text=text,
                    trigger="manual",
                    trigger_payload={"seeded": True},
                )
            )

        out.append(m.id)
        logger.info("meeting added: %s", spec["title"])
    await db.commit()
    return out


# ---- Main --------------------------------------------------------------------

async def main() -> None:
    async with SessionLocal() as db:
        await seed_agents(db)
        agents_rows = (await db.execute(select(Agent))).scalars().all()
        agent_ids = {a.name: a.id for a in agents_rows}
        user_ids = await seed_users(db)
        new_meeting_ids = await seed_meetings(db, user_ids, agent_ids)

    if new_meeting_ids:
        logger.info("running memory extraction on %d new meetings...", len(new_meeting_ids))
        for mid in new_meeting_ids:
            try:
                n = await extract_and_store_memories(mid)
                logger.info("  %s -> %d memories", mid, n)
            except Exception:
                logger.exception("  %s -> extraction failed", mid)

    logger.info("seed_demo done.")


if __name__ == "__main__":
    asyncio.run(main())
