"""
v25-1 — 客户演示前 数据清除 + 一键 seed.

两个能力(分别由 dashboard.py 暴露 endpoint):
  - wipe_workspace_business_data(): 清除当前 workspace 下所有业务数据,
    保留 user / membership / workspace / model_provider 不动.
  - seed_demo_scenario(): 灌入 5 部门 / 19 demo 用户 / 10 历史会议 /
    30 任务 / 5 上级文件 / 5 领导指令 + 16 AI(复用现有 seed) +
    16 AI 各 3 篇 KB 文档(共 48 篇,带 embedding).

只在 owner / admin 调用.两个端点都返回 summary dict.

为什么 wipe 不删 user:bluesurfiregpt@gmail.com 是当前 caller,删了就登不回去.
其他测试 user 留着也没事(没业务数据挂在他们身上).如要彻底干净,管理员去
/admin/team 手动删.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import hash_password
from .chunker import split_text
from .demo_kb_corpus import DEMO_KB, total_documents
from .embeddings import EmbeddingError, compute_embeddings
from .models import (
    Agent,
    AuditLog,
    CronRule,
    DataAccessRequest,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    LeaderDirective,
    LongTermMemory,
    Meeting,
    MeetingActionItem,
    MeetingActionItemComment,
    MeetingAgentMessage,
    MeetingAttendee,
    MeetingTranscript,
    Notification,
    Task,
    TaskCoProgress,
    TaskCollaborationRating,
    TaskEvaluation,
    TaskPenalty,
    UpperDoc,
    User,
    Voiceprint,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)


# =============================================================================
# WIPE
# =============================================================================


async def wipe_workspace_business_data(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    caller_user_id: uuid.UUID,
    wipe_voiceprints: bool = True,
) -> dict[str, int]:
    """
    清除当前 workspace 的所有业务数据,统计每张表删了几行.

    保留:User / WorkspaceMembership(只把 bound_agent_id 置空) /
          Workspace(preset 清空) / ModelProviderConfig.

    删除顺序 = 子表向父表(避免 FK 报错;有 ondelete=CASCADE 的可省).
    """
    counts: dict[str, int] = {}

    async def _del(model: type, where_clause) -> int:
        res = await session.execute(delete(model).where(where_clause))
        return int(res.rowcount or 0)

    # === Phase 1: 通知 / 审计 / 长期记忆 / 数据请求 / cron — 独立,无外键依赖
    counts["notification"] = await _del(
        Notification, Notification.workspace_id == workspace_id
    )
    counts["audit_log"] = await _del(
        AuditLog, AuditLog.workspace_id == workspace_id
    )
    counts["long_term_memory"] = await _del(
        LongTermMemory, LongTermMemory.workspace_id == workspace_id
    )
    counts["data_access_request"] = await _del(
        DataAccessRequest, DataAccessRequest.workspace_id == workspace_id
    )
    counts["cron_rule"] = await _del(
        CronRule, CronRule.workspace_id == workspace_id
    )

    # === Phase 2: KB 子图(chunk → document → kb)
    # KnowledgeDocument 没有 workspace_id 字段,通过 kb_id → KnowledgeBase scope
    kb_ids_subq = select(KnowledgeBase.id).where(KnowledgeBase.workspace_id == workspace_id)
    counts["knowledge_chunk"] = (
        await session.execute(
            delete(KnowledgeChunk).where(KnowledgeChunk.kb_id.in_(kb_ids_subq))
        )
    ).rowcount or 0
    counts["knowledge_document"] = (
        await session.execute(
            delete(KnowledgeDocument).where(KnowledgeDocument.kb_id.in_(kb_ids_subq))
        )
    ).rowcount or 0
    counts["knowledge_base"] = await _del(
        KnowledgeBase, KnowledgeBase.workspace_id == workspace_id
    )

    # === Phase 3: Task 子图(penalty/coprogress/rating/eval → task)
    counts["task_evaluation"] = await _del(
        TaskEvaluation, TaskEvaluation.workspace_id == workspace_id
    )
    counts["task_penalty"] = await _del(
        TaskPenalty, TaskPenalty.workspace_id == workspace_id
    )
    # TaskCoProgress / TaskCollaborationRating 通过 task → CASCADE
    # 但保险起见,手动按 task in workspace 删
    task_ids_subq = select(Task.id).where(Task.workspace_id == workspace_id)
    counts["task_co_progress"] = (
        await session.execute(
            delete(TaskCoProgress).where(TaskCoProgress.task_id.in_(task_ids_subq))
        )
    ).rowcount or 0
    counts["task_collaboration_rating"] = (
        await session.execute(
            delete(TaskCollaborationRating).where(
                TaskCollaborationRating.task_id.in_(task_ids_subq)
            )
        )
    ).rowcount or 0
    counts["task"] = await _del(Task, Task.workspace_id == workspace_id)

    # === Phase 4: Directive / UpperDoc
    counts["leader_directive"] = await _del(
        LeaderDirective, LeaderDirective.workspace_id == workspace_id
    )
    counts["upper_doc"] = await _del(
        UpperDoc, UpperDoc.workspace_id == workspace_id
    )

    # === Phase 5: Meeting 子图
    meeting_ids_subq = select(Meeting.id).where(Meeting.workspace_id == workspace_id)
    # action item comment via action item
    ai_ids_subq = select(MeetingActionItem.id).where(
        MeetingActionItem.meeting_id.in_(meeting_ids_subq)
    )
    counts["meeting_action_item_comment"] = (
        await session.execute(
            delete(MeetingActionItemComment).where(
                MeetingActionItemComment.action_item_id.in_(ai_ids_subq)
            )
        )
    ).rowcount or 0
    counts["meeting_action_item"] = (
        await session.execute(
            delete(MeetingActionItem).where(
                MeetingActionItem.meeting_id.in_(meeting_ids_subq)
            )
        )
    ).rowcount or 0
    # MeetingAttendee / Transcript / AgentMessage / SpeakerSegment 由 Meeting CASCADE
    counts["meeting"] = await _del(Meeting, Meeting.workspace_id == workspace_id)

    # === Phase 6: Agent — 但要先把 membership.bound_agent_id 置空(虽然有
    #     ondelete="SET NULL",显式置空让逻辑更明晰 + 兼容老数据)
    await session.execute(
        update(WorkspaceMembership)
        .where(WorkspaceMembership.workspace_id == workspace_id)
        .values(bound_agent_id=None)
    )
    counts["agent"] = await _del(Agent, Agent.workspace_id == workspace_id)

    # === Phase 7: Voiceprint(user-scoped,但属于 workspace 成员的清掉)
    if wipe_voiceprints:
        counts["voiceprint"] = (
            await session.execute(
                delete(Voiceprint).where(
                    Voiceprint.user_id.in_(
                        select(WorkspaceMembership.user_id).where(
                            WorkspaceMembership.workspace_id == workspace_id
                        )
                    )
                )
            )
        ).rowcount or 0
    else:
        counts["voiceprint"] = 0

    # === Phase 8: WorkspaceInvitation(待激活的邀请)
    counts["workspace_invitation"] = await _del(
        WorkspaceInvitation, WorkspaceInvitation.workspace_id == workspace_id
    )

    # === Phase 9: 重置 workspace.preset(智慧住建 seed marker 也清)
    await session.execute(
        update(Workspace).where(Workspace.id == workspace_id).values(preset=None)
    )

    await session.commit()

    total = sum(counts.values())
    logger.warning(
        "wipe_workspace_business_data: workspace=%s caller=%s total_rows=%d details=%s",
        workspace_id, caller_user_id, total, counts,
    )
    return counts


# =============================================================================
# SEED
# =============================================================================


# 5 个部门(对齐文档 §2.2)
_DEMO_DEPARTMENTS = [
    "机关党委(办公室)",
    "法制与政务服务科",
    "房地产与租赁管理科",
    "建筑业管理科",
    "物业监管科",
]


# 19 个 demo 用户.password 全部 demo123,bcrypt 一次复用避免循环慢.
# (name, email, role, department, bound_agent_name)
_DEMO_USERS: list[tuple[str, str, str, str, Optional[str]]] = [
    # 1 leader (局长)
    ("李建国", "demo.lijg@futian.gov.cn", "leader", "机关党委(办公室)", None),
    # 4 admin (各分管副局长 / 科长)
    ("张明", "demo.zhangm@futian.gov.cn", "admin", "机关党委(办公室)", None),
    ("王慧敏", "demo.wanghm@futian.gov.cn", "admin", "法制与政务服务科", None),
    ("刘德华", "demo.liudh@futian.gov.cn", "admin", "房地产与租赁管理科", None),
    ("陈思雨", "demo.chensy@futian.gov.cn", "admin", "物业监管科", None),
    # 10 expert (绑定 AI-01 ~ AI-10)
    ("赵伟", "demo.zhaow@futian.gov.cn", "manager", "机关党委(办公室)", "综合事务AI专家"),
    ("钱晓", "demo.qianx@futian.gov.cn", "manager", "法制与政务服务科", "法制政务AI专家"),
    ("孙楠", "demo.sunn@futian.gov.cn", "manager", "房地产与租赁管理科", "房地产与租赁AI专家"),
    ("周燕", "demo.zhouy@futian.gov.cn", "manager", "公共住房建设管理科", "公共住房建设AI专家"),
    ("吴峰", "demo.wuf@futian.gov.cn", "manager", "住房改革与保障科", "住房保障AI专家"),
    ("郑晨", "demo.zhengc@futian.gov.cn", "manager", "建筑业管理科", "建筑业管理AI专家"),
    ("王璐", "demo.wangl@futian.gov.cn", "manager", "房屋安全管理与整治科", "房屋安全AI专家"),
    ("冯磊", "demo.fengl@futian.gov.cn", "manager", "物业监管科", "物业监管AI专家"),
    ("陈瑶", "demo.cheny@futian.gov.cn", "manager", "建设科技与燃气科", "建设科技与燃气AI专家"),
    ("楚天", "demo.chut@futian.gov.cn", "manager", "消防人防管理科", "消防人防AI专家"),
    # 4 member (普通员工)
    ("沈宇", "demo.sheny@futian.gov.cn", "member", "房屋安全管理与整治科", None),
    ("韩雪", "demo.hanx@futian.gov.cn", "member", "物业监管科", None),
    ("杨光", "demo.yangg@futian.gov.cn", "member", "建筑业管理科", None),
    ("朱琳", "demo.zhul@futian.gov.cn", "member", "消防人防管理科", None),
]

# 10 历史会议(各种状态).
_DEMO_MEETINGS: list[dict[str, Any]] = [
    {
        "title": "2026年1月住建局周一例会",
        "status": "finished",
        "days_ago": 7,
        "duration_min": 90,
        "agenda": [
            {"title": "上周工作回顾", "time_budget_min": 20},
            {"title": "本周重点部署", "time_budget_min": 30},
            {"title": "近期督办事项", "time_budget_min": 25},
            {"title": "其他事项", "time_budget_min": 15},
        ],
        "summary_md": (
            "## 周一例会纪要\n\n**主要议题**:春节前安全生产、保障性住房供给、棚改推进\n\n"
            "**决议**:1) 春节前完成所有在建工地大检查;2) 公租房1月放号;3) 棚改片区12月底前签约率达90%."
        ),
        "transcript": [
            ("李建国", "同志们,今天召开本月第一次例会.先请张明同志介绍上周工作."),
            ("张明", "上周共开展工地检查23次,发现隐患89项,已整改62项,剩余27项纳入督办."),
            ("王慧敏", "新出台的物业管理条例征求意见稿已收到反馈87条,法制审查正在进行."),
            ("刘德华", "本月商品房预售许可申请12个,已办结8个,4个在审."),
            ("陈思雨", "物业服务投诉数据环比下降15%,但小散工程纳管率仍偏低,需要重点督办."),
            ("李建国", "几个重点:第一,春节前所有在建工地必须完成安全大检查,不留死角."),
            ("李建国", "第二,公租房放号要严格按摇号办法,公开透明,接受群众监督."),
            ("李建国", "第三,棚改片区签约工作要加大力度,12月底前签约率必须达到90%."),
        ],
        "agent_responses": [
            ("综合事务AI专家", "根据督办系统数据,上周共建立督办事项14项,其中重点督办3项,已办结5项,办结率35.7%.建议对剩余9项加强跟踪."),
            ("建筑业管理AI专家", "本周计划开展工地大检查,涉及在建工程56个,建议优先排查临近春节施工集中的项目,落实假期值班和应急响应."),
        ],
        "action_items": [
            "春节前完成所有在建工地安全大检查",
            "1月15日前公租房第一批放号",
            "棚改片区12月底前签约率达90%",
        ],
    },
    {
        "title": "房屋安全专项整治调度会",
        "status": "finished",
        "days_ago": 14,
        "duration_min": 75,
        "agenda": None,
        "summary_md": "## 房屋安全专项整治调度\n\n**重点**:危旧房屋台账更新、老旧小区电梯加装、房屋鉴定第三方机构监管.\n\n**决议**:本月底前完成全区危旧房屋复核,12月开展电梯加装专项行动.",
        "transcript": [
            ("陈思雨", "今天专题研究房屋安全问题.先请王璐汇报近期摸排情况."),
            ("王璐", "全区已完成12个街道的初步摸排,识别C级以上房屋238栋,其中D级危房12栋."),
            ("沈宇", "12栋D级危房中,8栋已采取避险措施,4栋还在协调中."),
            ("陈思雨", "未采取措施的4栋必须本周内落实!安全无小事,出了事谁都担不起."),
            ("王璐", "我们会立刻协调街道介入,本周内办妥."),
        ],
        "agent_responses": [
            ("房屋安全AI专家", "根据《房屋结构安全鉴定监管办法》,D级危房应立即停止使用并采取避险措施.建议:1)启动应急避险预案;2)安排入住居民临时安置;3)15日内出具加固或拆除方案."),
        ],
        "action_items": [
            "本周内对4栋D级危房采取避险措施",
            "12月开展电梯加装专项行动",
        ],
    },
    {
        "title": "12月物业纠纷调解专题会",
        "status": "finished",
        "days_ago": 21,
        "duration_min": 60,
        "agenda": None,
        "summary_md": "## 物业纠纷调解\n\n**重点**:维修资金使用纠纷、业委会换届投诉.\n\n**决议**:成立维修资金使用专项指导小组,协助业委会规范换届流程.",
        "transcript": [
            ("陈思雨", "本月物业投诉同比上升23%,主要集中在维修资金使用和业委会换届."),
            ("冯磊", "维修资金类投诉17件,业委会换届类9件,我们逐件回访."),
            ("韩雪", "很多业主反映对维修资金使用流程不熟悉,沟通成本高."),
            ("陈思雨", "可以考虑做几个简明的科普视频,把流程讲清楚."),
        ],
        "agent_responses": [
            ("物业监管AI专家", "根据《住宅专项维修资金审批管理办法》,使用维修资金须经2/3业主同意.建议:1)优化业主公示与表决流程;2)建立电子化业主投票系统;3)开展业主权益普及."),
        ],
        "action_items": [
            "制作维修资金使用流程科普视频",
            "成立维修资金使用专项指导小组",
        ],
    },
    {
        "title": "2025年第四季度招标监督汇报会",
        "status": "finished",
        "days_ago": 28,
        "duration_min": 90,
        "agenda": None,
        "summary_md": "## 第四季度招标监督\n\n**重点**:工程招投标违规专项检查发现问题清单.\n\n**决议**:对3家围标企业立案查处,对评标专家库进行清理.",
        "transcript": [
            ("刘德华", "第四季度共监督招标项目47个,发现疑似围标3起,串标1起."),
            ("郑晨", "3起围标涉及深圳市3家施工企业,已联合纪委开展进一步调查."),
            ("杨光", "评标专家库存在被动过的情况,需要清理."),
            ("刘德华", "围标必须严肃处理,这是底线!评标专家库年底前完成清理."),
        ],
        "agent_responses": [
            ("建筑业管理AI专家", "招投标违规可依据《招标投标法》第五十三条处罚.建议:1)对涉事企业列入1-3年内不得参与本区招投标的黑名单;2)依法移送相关线索给市场监督部门."),
        ],
        "action_items": [
            "对3家围标企业立案查处",
            "年底前完成评标专家库清理",
        ],
    },
    {
        "title": "燃气安全整治督办会",
        "status": "ongoing",
        "days_ago": 0,
        "duration_min": 60,
        "agenda": [
            {"title": "近期燃气安全形势", "time_budget_min": 15},
            {"title": "重点单位排查情况", "time_budget_min": 20},
            {"title": "下一步部署", "time_budget_min": 20},
        ],
        "summary_md": None,
        "transcript": [
            ("陈思雨", "进入冬季燃气使用高峰,今天专题研究燃气安全."),
            ("陈瑶", "本月已检查燃气经营企业18家,餐饮场所126家."),
            ("陈瑶", "发现安全隐患32项,其中重大隐患3项,已立即停业整改."),
        ],
        "agent_responses": [
            ("建设科技与燃气AI专家", "依据《燃气安全监管季度方案》,重大隐患必须立即停止使用.建议:1)对重大隐患单位实行驻点监管;2)对反复出现问题的企业列入重点监管."),
        ],
        "action_items": [
            "完成本月燃气安全检查全覆盖",
        ],
    },
    {
        "title": "城市更新听证会:八卦岭片区",
        "status": "finished",
        "days_ago": 35,
        "duration_min": 120,
        "agenda": None,
        "summary_md": "## 八卦岭片区更新听证\n\n**重点**:听取业主意见,讨论补偿方案,确定实施主体.\n\n**决议**:补偿方案修改后再次公示;暂定深圳XX地产为实施主体.",
        "transcript": [
            ("张明", "今天召开八卦岭片区城市更新听证会,共有23位业主代表参加."),
            ("孙楠", "前期摸底,业主意愿同意率82%,补偿方案已收到78条修改意见."),
            ("张明", "补偿方案修改后再次公示7天,达成85%以上同意率方可签约."),
        ],
        "agent_responses": [
            ("城市更新规划AI专家", "依据《城市更新十四五规划》,八卦岭属于第二批重点更新片区.建议:1)细化补偿方案分级标准;2)增加产权调换比例;3)统筹考虑产业升级."),
            ("城市更新项目AI专家", "实施主体审查需具备房地产开发资质、注册资本不低于1亿元、近3年无重大违法违规.建议组织综合评分."),
        ],
        "action_items": [
            "补偿方案修改后再次公示",
            "组织实施主体综合评分",
        ],
    },
    {
        "title": "公共住房供给协调会",
        "status": "ongoing",
        "days_ago": 0,
        "duration_min": 60,
        "agenda": [
            {"title": "本年度供给情况", "time_budget_min": 20},
            {"title": "明年供给计划", "time_budget_min": 30},
        ],
        "summary_md": None,
        "transcript": [
            ("张明", "今年公共住房供给目标5000套,目前已落地3800套."),
            ("周燕", "剩余1200套主要靠4个在建项目,12月底应能全部完成."),
            ("吴峰", "明年保障对象数量将增加约15%,供给压力大."),
        ],
        "agent_responses": [
            ("公共住房建设AI专家", "建议:1)加强配建项目的质量监督;2)优化筹集结构,适当提高收购比例;3)针对人才需求增加合作建设项目."),
        ],
        "action_items": [
            "12月底前完成本年度5000套供给",
            "12月15日前提交明年供给方案",
        ],
    },
    {
        "title": "11月度复盘会",
        "status": "finished",
        "days_ago": 42,
        "duration_min": 90,
        "agenda": None,
        "summary_md": "## 11月月度复盘\n\n**重点**:绩效数据回顾、典型事件复盘、12月工作部署.\n\n**决议**:对3个低于平均的科室约谈;评选11月优秀任务和团队.",
        "transcript": [
            ("李建国", "11月各科室综合得分:房屋安全89,建筑业管理87,法制政务86,物业监管78,房地产与租赁72."),
            ("李建国", "排名靠后两个科室要做检讨,我个别约谈."),
        ],
        "agent_responses": [
            ("住建智脑(全局AI专家)", "11月综合数据显示:全局任务完成率82.3%,及时率76.5%.建议:1)对完成率低的科室开展专项辅导;2)优化协同流程减少跨科室等待."),
        ],
        "action_items": [
            "对低分科室开展约谈",
            "评选11月优秀任务团队",
        ],
    },
    {
        "title": "Q1季度工作规划会",
        "status": "scheduled",
        "days_ago": -3,  # 3 天后
        "duration_min": 120,
        "agenda": [
            {"title": "Q1工作目标", "time_budget_min": 30},
            {"title": "重点项目部署", "time_budget_min": 40},
            {"title": "考核机制完善", "time_budget_min": 30},
            {"title": "其他", "time_budget_min": 20},
        ],
        "summary_md": None,
        "transcript": [],
        "agent_responses": [],
        "action_items": [],
    },
    {
        "title": "2026安全月部署会",
        "status": "scheduled",
        "days_ago": -7,
        "duration_min": 90,
        "agenda": None,
        "summary_md": None,
        "transcript": [],
        "agent_responses": [],
        "action_items": [],
    },
]


# 5 上级文件 — 模拟 LLM 解析后的结果
_DEMO_UPPER_DOCS: list[dict[str, Any]] = [
    {
        "filename": "区委办关于2026年安全生产工作的通知.docx",
        "extracted_text": (
            "为贯彻落实党中央国务院和省委省政府关于安全生产工作的决策部署,扎实推进2026年安全生产工作,"
            "现将有关事项通知如下:一、深刻汲取近期事故教训,绷紧安全生产之弦.二、狠抓重点行业领域专项整治,"
            "包括建筑施工、燃气、消防、危化品.三、严格落实安全生产责任制,严肃事故查处.四、加强应急救援能力建设,"
            "提升应急处置水平.各部门要高度重视,周密部署,确保各项工作落到实处."
        ),
        "drafts": [
            {"title": "组织建筑施工领域专项整治", "assignee_dept": "建筑业管理科", "due_days": 30},
            {"title": "开展燃气安全大检查", "assignee_dept": "建设科技与燃气科", "due_days": 20},
            {"title": "推进消防隐患治理", "assignee_dept": "消防人防管理科", "due_days": 30},
        ],
    },
    {
        "filename": "福田区住建局2026年度重点工作分解方案.docx",
        "extracted_text": (
            "围绕区委十届三次全会精神,结合住建领域实际,2026年重点工作分解如下:"
            "一、保障性住房供给6000套,完成度纳入考核.二、城市更新单元报批8个以上.三、棚改片区签约率95%以上."
            "四、新建绿色建筑达到新建建筑面积80%以上.五、燃气安全事故率下降30%以上."
        ),
        "drafts": [
            {"title": "制定保障性住房6000套供给计划", "assignee_dept": "公共住房建设管理科", "due_days": 15},
            {"title": "推进8个城市更新单元报批", "assignee_dept": "城市更新规划科", "due_days": 90},
        ],
    },
    {
        "filename": "棚改安置房推进意见.pdf",
        "extracted_text": (
            "为加快棚改安置房建设,确保按期交付,提出如下意见:一、建立周调度月通报机制."
            "二、对推进缓慢项目实行专班推进.三、加大金融支持,发挥政策性银行作用.四、严格质量把关,实行终身责任."
        ),
        "drafts": [
            {"title": "建立棚改项目周调度机制", "assignee_dept": "公共住房建设管理科", "due_days": 7},
        ],
    },
    {
        "filename": "深圳市物业管理条例修订征求意见稿.docx",
        "extracted_text": (
            "为完善物业管理制度,结合实际进行修订,主要修订内容包括:一、明确业委会成立和换届流程."
            "二、规范物业服务费定价机制.三、强化维修资金使用监管.四、加大违规物业公司处罚力度.请各区相关部门研究反馈意见."
        ),
        "drafts": [
            {"title": "组织反馈物业管理条例修订意见", "assignee_dept": "物业监管科", "due_days": 10},
        ],
    },
    {
        "filename": "老旧小区改造三年行动计划.pdf",
        "extracted_text": (
            "为改善老旧小区居住条件,提升群众幸福感,制定2026-2028三年行动计划:"
            "一、3年完成120个老旧小区改造.二、整治内容含基础类、完善类、提升类3大类."
            "三、资金筹措中央补助40%、市区40%、产权人20%.四、实行项目化清单化推进."
        ),
        "drafts": [
            {"title": "制定2026年度40个老旧小区改造清单", "assignee_dept": "房屋安全管理与整治科", "due_days": 20},
        ],
    },
]


# 5 领导指令
_DEMO_DIRECTIVES: list[dict[str, Any]] = [
    {
        "content": "请综合事务科牵头,本月底前组织一次全局督查督办工作回顾,梳理督办事项办结情况,提交报告.",
        "drafts": [
            {"title": "组织全局督查督办工作回顾", "assignee_dept": "机关党委(办公室)", "due_days": 15},
        ],
    },
    {
        "content": "近期收到群众反映物业服务质量下降的投诉较多,请物业科开展一次物业行业专项检查,确保服务质量.",
        "drafts": [
            {"title": "开展物业行业专项检查", "assignee_dept": "物业监管科", "due_days": 30},
        ],
    },
    {
        "content": "关于住房保障申请积压问题,请保障科加快审核进度,本月内消化积压申请,并优化流程.",
        "drafts": [
            {"title": "消化住房保障积压申请", "assignee_dept": "住房改革与保障科", "due_days": 25},
            {"title": "优化住房保障申请审核流程", "assignee_dept": "住房改革与保障科", "due_days": 45},
        ],
    },
    {
        "content": "为推进BIM技术应用,请建设科技科牵头制定具体推广方案,争取本季度落地3个BIM示范项目.",
        "drafts": [
            {"title": "制定BIM技术推广方案", "assignee_dept": "建设科技与燃气科", "due_days": 30},
        ],
    },
    {
        "content": "请消防科结合岁末年初特点,开展消防隐患整治督办行动,重点检查商场、地下空间和老旧建筑.",
        "drafts": [
            {"title": "岁末年初消防隐患整治督办", "assignee_dept": "消防人防管理科", "due_days": 20},
        ],
    },
]


async def seed_demo_scenario(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    caller_user_id: uuid.UUID,
    seed_kb_documents: bool = True,
) -> dict[str, Any]:
    """
    一键生成完整 demo 场景.assumes 已经 wipe 过(否则会重复 user email 冲突).

    步骤:
      1. seed 16 AI(复用现有逻辑,但内联以避免循环 import)
      2. 19 demo users + memberships(密码 demo123)
      3. 10 historical meetings + transcripts + agent messages + action items
      4. 5 upper docs + 5 directives + 30 tasks(各状态)
      5. 16 KB × 3 docs = 48 docs + chunks + embeddings(异步嵌入)
    """
    summary: dict[str, Any] = {}
    rng = random.Random(42)  # deterministic

    # ---- Step 1: 16 AI ------------------------------------------------------
    agents_by_name = await _seed_16_agents(session, workspace_id)
    summary["agents"] = len(agents_by_name)

    # 设置 workspace.preset
    ws = (await session.execute(select(Workspace).where(Workspace.id == workspace_id))).scalar_one()
    ws.preset = {
        "kind": "smart_construction",
        "seeded_at": datetime.now(timezone.utc).isoformat(),
        "demo_seeded": True,
    }

    # ---- Step 2: 19 demo users + membership ---------------------------------
    pwd_hash_demo = hash_password("demo123")
    users_by_name: dict[str, User] = {}
    user_emails_skipped = 0

    # 检查已有 demo email,幂等
    existing_emails = {
        r[0]
        for r in (
            await session.execute(
                select(User.email).where(User.email.like("demo.%@futian.gov.cn"))
            )
        ).all()
    }

    for name, email, role, dept, bound_agent_name in _DEMO_USERS:
        if email in existing_emails:
            # 已存在,直接拉出来
            u = (
                await session.execute(select(User).where(User.email == email))
            ).scalar_one()
            users_by_name[name] = u
            user_emails_skipped += 1
            continue
        u = User(
            name=name,
            email=email,
            password_hash=pwd_hash_demo,
            is_active=True,
            department=dept,
            workspace_id=workspace_id,
        )
        session.add(u)
        await session.flush()
        users_by_name[name] = u

        bound_agent_id = None
        if bound_agent_name and bound_agent_name in agents_by_name:
            bound_agent_id = agents_by_name[bound_agent_name].id
        m = WorkspaceMembership(
            workspace_id=workspace_id,
            user_id=u.id,
            role=role,
            bound_agent_id=bound_agent_id,
        )
        session.add(m)

    summary["users_created"] = len(users_by_name) - user_emails_skipped
    summary["users_skipped"] = user_emails_skipped
    await session.flush()

    # ---- Step 3: 10 meetings + transcripts + agent messages + action items --
    meetings_created = 0
    transcripts_created = 0
    agent_msgs_created = 0
    action_items_created = 0
    now = datetime.now(timezone.utc)

    # 用户名 → User obj(下面被 transcript 用)
    user_name_to_obj = users_by_name

    for m_def in _DEMO_MEETINGS:
        days_ago = m_def["days_ago"]
        if days_ago >= 0:
            started = now - timedelta(days=days_ago, minutes=m_def["duration_min"])
            ended = now - timedelta(days=days_ago) if m_def["status"] == "finished" else None
        else:
            started = now + timedelta(days=-days_ago)
            ended = None

        m = Meeting(
            workspace_id=workspace_id,
            title=m_def["title"],
            status=m_def["status"],
            started_at=started,
            ended_at=ended,
            summary_md=m_def["summary_md"],
            agenda=m_def["agenda"],
        )
        session.add(m)
        await session.flush()
        meetings_created += 1

        # attendees: 找 transcript / agent_responses 涉及的用户和 AI
        attendee_user_ids: set[uuid.UUID] = set()
        attendee_agent_ids: set[uuid.UUID] = set()
        for spk_name, _ in m_def["transcript"]:
            u = user_name_to_obj.get(spk_name)
            if u:
                attendee_user_ids.add(u.id)
        for ag_name, _ in m_def["agent_responses"]:
            ag = agents_by_name.get(ag_name)
            if ag:
                attendee_agent_ids.add(ag.id)
        # 加 caller(主帐号)
        attendee_user_ids.add(caller_user_id)

        for uid in attendee_user_ids:
            session.add(MeetingAttendee(meeting_id=m.id, user_id=uid, role="attendee"))
        for aid in attendee_agent_ids:
            session.add(MeetingAttendee(meeting_id=m.id, agent_id=aid, role="ai_expert"))

        # transcripts(模拟时间戳从 0 累加)
        offset_ms = 0
        for spk_name, text in m_def["transcript"]:
            spk_user = user_name_to_obj.get(spk_name)
            duration_ms = max(2000, len(text) * 200)  # ~200ms / 字
            t = MeetingTranscript(
                meeting_id=m.id,
                text=text,
                start_ms=offset_ms,
                end_ms=offset_ms + duration_ms,
                is_final=True,
                speaker_user_id=spk_user.id if spk_user else None,
                speaker_label="auto_recognized",
                speaker_status="confirmed",
                confidence=0.92,
            )
            session.add(t)
            transcripts_created += 1
            offset_ms += duration_ms + 500

        # agent messages
        for ag_name, text in m_def["agent_responses"]:
            ag = agents_by_name.get(ag_name)
            if not ag:
                continue
            session.add(
                MeetingAgentMessage(
                    meeting_id=m.id,
                    agent_id=ag.id,
                    text=text,
                    trigger="keyword",
                    trigger_payload={"hit": "demo_seed"},
                    citations=None,  # demo 暂不构造 citations chip
                )
            )
            agent_msgs_created += 1

        # action items + dual-write task
        for content in m_def["action_items"]:
            ai = MeetingActionItem(
                meeting_id=m.id,
                workspace_id=workspace_id,
                content=content,
                source_type="summary",
                status="open",
            )
            session.add(ai)
            action_items_created += 1

    summary["meetings"] = meetings_created
    summary["transcripts"] = transcripts_created
    summary["agent_messages"] = agent_msgs_created
    summary["action_items"] = action_items_created
    await session.flush()

    # ---- Step 4: 5 upper_docs + 5 directives + 30 tasks ---------------------
    # caller is the leader who creates these
    upper_docs_created = 0
    for ud_def in _DEMO_UPPER_DOCS:
        ud = UpperDoc(
            workspace_id=workspace_id,
            created_by_user_id=caller_user_id,
            filename=ud_def["filename"],
            mime_type="application/octet-stream",
            byte_size=len(ud_def["extracted_text"]) * 3,
            extracted_text=ud_def["extracted_text"],
            parsed_drafts=ud_def["drafts"],
            status="draft",
        )
        session.add(ud)
        upper_docs_created += 1

    directives_created = 0
    for d_def in _DEMO_DIRECTIVES:
        d = LeaderDirective(
            workspace_id=workspace_id,
            created_by_user_id=caller_user_id,
            content=d_def["content"],
            parsed_drafts=d_def["drafts"],
            status="draft",
        )
        session.add(d)
        directives_created += 1

    summary["upper_docs"] = upper_docs_created
    summary["directives"] = directives_created
    await session.flush()

    # 30 tasks, 各状态分布
    # 5 draft / 5 dispatched / 5 in_progress / 5 submitted / 8 approved / 2 returned
    expert_users = [u for u in users_by_name.values() if u.email and "demo." in u.email]
    member_users = expert_users  # 简化:任意 demo user 都可派
    task_titles = [
        "工地安全巡查 — 福田中心区A工地",
        "燃气安全检查 — 餐饮场所第3批",
        "公租房资格审核 — 11月新申请批次",
        "招标投标合规检查 — 4个工程项目",
        "维修资金使用申请审批",
        "BIM应用方案修订",
        "老旧小区改造意见征集",
        "棚改片区签约推进",
        "城市更新听证会准备",
        "保障房分配公示组织",
        "消防设施验收 — XX商业综合体",
        "中介机构信用复评",
        "房屋鉴定机构季度评估",
        "土地征收公示组织",
        "物业纠纷调解专项",
        "工程造价审计抽查",
        "拆除工程安全报监审核",
        "绿色建筑标识申请",
        "棚户区改造户型方案",
        "公共住房项目质量验收",
        "Q4 督办销号工作",
        "公文标准化培训准备",
        "维修资金审批操作手册更新",
        "小散工程纳管率提升",
        "燃气安全宣传月策划",
        "施工许可办理时限优化",
        "消防应急预案演练",
        "物业服务质量月度排名",
        "房屋安全鉴定报告复核",
        "城市更新政策解读",
    ]
    # 注:Task 实际状态机里 'draft' 不存在(用 'open'),'submitted'+'approved' 也不是
    # task.status 真实值;真实 status 集 = {open, dispatched, accepted, in_progress,
    # submitted, done, archived, cancelled}.演示数据贴近真实状态机.
    statuses = (
        ["open"] * 5
        + ["dispatched"] * 5
        + ["in_progress"] * 5
        + ["submitted"] * 5
        + ["done"] * 8
        + ["archived"] * 2
    )
    rng.shuffle(statuses)

    tasks_created = 0
    for i, (title, status) in enumerate(zip(task_titles, statuses)):
        assignee = expert_users[i % len(expert_users)] if expert_users else None
        # due 日期分布:done/archived 全过去;in_progress / submitted 近未来;open 远未来
        if status in ("done", "archived"):
            due = now - timedelta(days=rng.randint(5, 30))
        elif status in ("in_progress", "submitted"):
            due = now + timedelta(days=rng.randint(3, 14))
        elif status == "dispatched":
            due = now + timedelta(days=rng.randint(7, 21))
        else:  # open
            due = now + timedelta(days=rng.randint(14, 45))

        source_type = "meeting" if i < 10 else ("leader_directive" if i < 20 else "upper_doc")
        # v25-bug-fix W-5: submitted/done/archived 任务 给 source_ref.submission_payload
        # 让 任务详情页 「阶段汇报」 4 段能展开,演示更完整.
        source_ref: dict[str, Any] = {"_demo_seed": True, "index": i}
        if status in ("submitted", "done", "archived"):
            assignee_name = assignee.name if assignee else "(未指派)"
            submitted_at = now - timedelta(days=rng.randint(1, 10))
            source_ref["submission_payload"] = {
                "completed": (
                    f"已完成 {title} 主体工作.具体进展:1) 现场情况已摸排;"
                    f"2) 责任主体已明确;3) 整改方案已与相关单位沟通."
                ),
                "problems": (
                    "推进中遇到 个别业主配合度低 / 部分历史资料缺失 等问题,"
                    "已通过协调会议解决.建议后续此类工作前置 30 天通知."
                ),
                "next_steps": (
                    "1) 本周完成最终整改;2) 下周组织验收;3) 整理经验沉淀到 KB,"
                    "供同类任务参考."
                ),
                "evidence_urls": [],
                "submitted_at": submitted_at.isoformat(),
                "submitted_by_name": assignee_name,
            }

        t = Task(
            workspace_id=workspace_id,
            created_by_user_id=caller_user_id,
            title=title,
            content=f"{title}\n\n详情说明:演示任务,完成后会沉淀到知识库,供同类型任务参考.",
            assignee_user_id=assignee.id if assignee else None,
            dispatched_by_user_id=caller_user_id if status != "open" else None,
            dispatched_at=now - timedelta(days=rng.randint(1, 30)) if status != "open" else None,
            accepted_at=now - timedelta(days=rng.randint(1, 25)) if status not in ("open", "dispatched") else None,
            started_at=now - timedelta(days=rng.randint(1, 20)) if status in ("in_progress", "submitted", "done", "archived") else None,
            due_at=due,
            status=status,
            source_type=source_type,
            source_ref=source_ref,
        )
        session.add(t)
        tasks_created += 1

    summary["tasks"] = tasks_created
    await session.flush()

    # ---- Step 5: 16 KB × 3 docs + chunks + embeddings -----------------------
    kb_docs_created = 0
    chunks_created = 0
    if seed_kb_documents:
        # 每个 AI 找它的 KB(name = "KB · {agent_name}")
        kbs = {
            kb.name: kb
            for kb in (
                await session.execute(
                    select(KnowledgeBase).where(KnowledgeBase.workspace_id == workspace_id)
                )
            ).scalars().all()
        }

        # 收集所有要 embed 的 chunks → 批量调 embedding
        all_chunks_to_embed: list[tuple[KnowledgeChunk, str]] = []

        for agent_name, docs in DEMO_KB.items():
            kb = kbs.get(f"KB · {agent_name}")
            if not kb:
                continue
            for filename, title, content in docs:
                doc = KnowledgeDocument(
                    kb_id=kb.id,
                    filename=filename,
                    mime_type="text/markdown",
                    byte_size=len(content.encode("utf-8")),
                    char_count=len(content),
                    chunk_count=0,  # 下面更新
                    status="ready",
                    data_classification="general",
                )
                session.add(doc)
                await session.flush()
                kb_docs_created += 1

                # 切 chunks
                pieces = split_text(content, target_chars=400, overlap_chars=40)
                for idx, piece in enumerate(pieces):
                    chunk = KnowledgeChunk(
                        document_id=doc.id,
                        kb_id=kb.id,
                        chunk_index=idx,
                        content=piece,
                    )
                    session.add(chunk)
                    all_chunks_to_embed.append((chunk, piece))
                    chunks_created += 1
                doc.chunk_count = len(pieces)

        # 批量 embedding(每批 25 个)
        BATCH = 25
        embed_failed = 0
        for i in range(0, len(all_chunks_to_embed), BATCH):
            batch = all_chunks_to_embed[i : i + BATCH]
            texts = [t for _, t in batch]
            try:
                vectors = await compute_embeddings(texts)
                for (chunk, _), vec in zip(batch, vectors):
                    chunk.embedding = vec
            except EmbeddingError as e:
                logger.warning("seed_demo_scenario embedding batch %d failed: %s", i, e)
                embed_failed += len(batch)

        summary["embed_failed"] = embed_failed

    summary["kb_documents"] = kb_docs_created
    summary["kb_chunks"] = chunks_created

    await session.commit()

    logger.info(
        "seed_demo_scenario: workspace=%s caller=%s summary=%s",
        workspace_id, caller_user_id, summary,
    )
    return summary


async def _seed_16_agents(
    session: AsyncSession, workspace_id: uuid.UUID
) -> dict[str, Agent]:
    """复用 dashboard.py 里的 16 AI seed 逻辑(内联避免循环 import)."""
    from .routers.dashboard import _SMART_CONSTRUCTION_AGENTS, _AGENT_COLORS

    existing_agents = (
        await session.execute(
            select(Agent).where(Agent.workspace_id == workspace_id)
        )
    ).scalars().all()
    existing_by_name = {a.name: a for a in existing_agents}

    existing_kbs = (
        await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.workspace_id == workspace_id)
        )
    ).scalars().all()
    existing_kb_by_name = {kb.name: kb for kb in existing_kbs}

    out: dict[str, Agent] = {}
    for i, (code, name, dept, scope_desc, keywords) in enumerate(_SMART_CONSTRUCTION_AGENTS):
        kb_name = f"KB · {name}"
        kb = existing_kb_by_name.get(kb_name)
        if kb is None:
            kb = KnowledgeBase(
                workspace_id=workspace_id,
                name=kb_name,
                description=f"{name} 的独立知识库({dept}).",
            )
            session.add(kb)
            await session.flush()
            existing_kb_by_name[kb_name] = kb

        if name in existing_by_name:
            out[name] = existing_by_name[name]
            continue

        color = _AGENT_COLORS[i % len(_AGENT_COLORS)]
        persona = (
            f"你是「{name}」.{scope_desc}."
            f"\n所属:{dept}."
            f"\n请基于本知识库内容回答用户的问题,不确定时请明确说明."
            f"\n回答需精确,引用必标明出处."
        )
        agent = Agent(
            workspace_id=workspace_id,
            name=name,
            domain=dept[:64] if dept and dept != "—" else None,
            persona=persona,
            tone="专业、严谨、简洁",
            boundary=f"业务范围:{scope_desc}",
            keywords=keywords,
            color=color,
            knowledge_base_ids=[kb.id],
            role="expert",
        )
        session.add(agent)
        await session.flush()
        out[name] = agent
    return out
