"""
v26.3-01 原型:全 AI 自主会议 端到端 demo.

目标:
  独立脚本,不接 UI / WS / DB 写入(读 DB 拿 agent 信息),纯
  in-memory 跑通调度流程 + 真实 LLM 调用,验证:
    1. moderator AI 主持质量(intro / wrap_up / adequacy 判定)
    2. agent 发言能否 reference 前面观点(prompt 强约束起作用)
    3. consensus collector 能否识别共识 + 分歧
    4. 时长 / token 估算
    5. 5 议程 × 4 agent 全流程 在 max_turns / max_minutes 上限内 收敛

用法:
  在服务器上:
    docker exec -w /app aimeeting-backend python -m scripts.auto_meeting_demo
  默认参数:
    workspace = "Aimeeting 智慧住建系统" 找第一个,或 --workspace-name
    agents    = 自动选 active=True + primary_user_id 非空的 expert agents
    输出      = stdout 边跑边打印 + 写 markdown 报告到 tests/auto-meeting-demo-{ts}.md

  CLI options:
    --workspace-name "..."        默认 第一个 workspace
    --max-experts 4               最多带几个 expert agent
    --dry-run                     mock LLM(不真调,验证调度)
    --output report.md            自定义输出路径
    --skip-consensus              跳过 consensus 收集步骤(快)

退出码:
  0 = 成功
  1 = 配置错误(没找到 workspace / 没足够 active agent)
  2 = LLM 调用失败,会议没跑完(real 模式才会)

【设计决策(来自 v26.3-spec.md)】
  Q1: moderator 默认拉 workspace built-in 'role=moderator' agent (本脚本沿用)
  Q2: max_turns_per_agenda = 6,整场默认 45 分钟无硬上限
  Q3: 分歧 不打断,会后批量裁决(本脚本只收集,不阻塞)
  Q4: 强 prompt + moderator 软监督
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select

# package imports 需 PYTHONPATH 指向 /app
from app.db import SessionLocal
from app.llm_direct import LlmError, get_active_provider, stream_chat
from app.models import Agent, Workspace

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("v26.3-demo")


# ============================================================================
# Demo 配置
# ============================================================================

DEMO_TITLE = "新房产政策下的深圳市公积金管理办法研究"

DEMO_AGENDA = [
    "现行《深圳市公积金管理办法》核心条款梳理",
    "新房产政策(2025 Q1)对公积金缴存 / 提取的潜在影响",
    "管理办法修订方向初步建议",
    "与上位法(《住房公积金管理条例》)的衔接合规性",
    "修订后的实施路径与风险防范",
]

MAX_TURNS_PER_AGENDA = 6
ADEQUACY_CHECK_AFTER_TURN = 3
AGENT_REPLY_MAX_CHARS = 800     # 单次发言 上限
LLM_TIMEOUT_SEC = 60            # 单次 LLM 调用 timeout(估算)

# ============================================================================
# Prompts
# ============================================================================

MODERATOR_SYSTEM = """你是一名严谨的政务会议主持人,代表会议的"流程秩序",
不代表任何科室专家的立场.

风格:
- 中立 — 不站队任何专家,不预设立场,不评价某专家"说得对".
- 简洁 — 不长篇大论,不重复专家说过的话.
- 政务腔 — 用 "建议 / 拟 / 经讨论" 等公文语.避免 "大家好" 之类口语化.
- 严肃 — 会议是正式场合,不开玩笑,不寒暄.

禁止:
- intro 阶段不要直接给结论
- wrap_up 时不要引入新观点(只能总结专家发过的)
- 不要 @ 具体专家催发言
- 不要使用 markdown 标题
- 不要表达情绪
"""

MODERATOR_INTRO_USER = """当前议程项:"{title}"

请用 60-100 字简要陈述议题 + 提出 1-2 个引导问题让在场 AI 专家围绕讨论.
不要给结论,你只是主持."""

MODERATOR_WRAPUP_USER = """议程项:"{title}"

各 AI 专家已发言完毕,以下是讨论记录:
{messages}

请用 100-200 字 收尾总结本议程项的核心结论 / 分歧点.只总结专家发过
的内容,不要引入新观点.准备进入下一议程项."""

MODERATOR_JUDGE_USER = """议程项:"{title}"

已有 {turn_count} 轮发言:
{messages}

请判定本议程项是否已讨论充分(共识达成 或 分歧已清晰).
严格输出 JSON 单行,无任何其他文字:
{{
  "is_adequate": true/false,
  "reason": "<20-40 字理由>",
  "missing_perspectives": ["如不充分,缺什么角度;充分则空数组"]
}}"""


AGENT_REPLY_SYSTEM = """你是 {agent_name},专精 {domain}.

你的人格设定:
{persona}

会议发言风格:
- 100-300 字,简洁锋利,不客套
- 必须 reference 你的知识库 / 经验,可用 [资料 X] 角标 表示
- 不要总结全局(那是主持人的事)
- 不要重复别的专家已说的
"""

AGENT_REPLY_USER = """当前议程项:"{title}"

前面已发言(按时间顺序):
{prev_messages}

请基于你的知识库 + 经验,做以下其一(选一个最合适的):
  1) 【补充】前面没提到的视角(如:实操影响 / 历史经验 / 跨部门衔接)
  2) 【反驳】对某位专家观点提出不同看法 + 理由
  3) 【整合】把前面 2-3 个观点 拢成一个执行方案

100-300 字.直接说观点,不要客套."""


CONSENSUS_SYSTEM = """你是会议秘书,负责从一段政务会议讨论中,
客观识别 共识 与 分歧.

严格规则:
- 共识 = 至少 2 名专家明确表达同意 或 没人反对的观点
- 分歧 = 2+ 名专家 对同一议题 持明显不同立场
- 不要补全 / 演绎 / 提出 专家没说过的观点
- 不能识别 出任何共识或分歧时,如实输出空"""

CONSENSUS_USER = """议程项:"{title}"

完整发言记录(按时间):
{messages}

输出 JSON 单行,无其他文字:
{{
  "consensus": "<markdown 100-300 字 该议程项达成的共识;无则填 '本议程项未达成明确共识'>",
  "dissents": [
    {{
      "point": "<分歧点 一句话>",
      "summary": "<分歧 摘要 30-80 字>",
      "involved_agents": ["<参与分歧的 agent 名字>", ...]
    }},
    ...
  ]
}}

若无分歧,dissents = []."""


# ============================================================================
# 数据结构
# ============================================================================


@dataclass
class Message:
    speaker_id: str           # agent.id 字符串 或 'moderator-<id>'
    speaker_name: str
    role: str                 # 'moderator' | 'expert'
    agenda_idx: int
    content: str
    timestamp: datetime
    duration_sec: float = 0.0
    token_estimate: int = 0   # ~ len(text) / 1.5 (中文)


@dataclass
class AgendaResult:
    idx: int
    title: str
    messages: list[Message] = field(default_factory=list)
    consensus_md: str = ""
    dissents: list[dict] = field(default_factory=list)
    elapsed_sec: float = 0.0
    speaker_seq: list[str] = field(default_factory=list)  # agent name seq
    adequacy_judgment: Optional[dict] = None    # 最后一次 adequacy LLM 返回

    @property
    def has_dissent(self) -> bool:
        return len(self.dissents) > 0


@dataclass
class MeetingResult:
    title: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    agenda_results: list[AgendaResult] = field(default_factory=list)
    moderator_name: str = ""
    experts: list[dict] = field(default_factory=list)
    dry_run: bool = False
    skip_consensus: bool = False
    total_llm_calls: int = 0
    total_chars: int = 0

    @property
    def elapsed_sec(self) -> float:
        end = self.ended_at or datetime.now(timezone.utc)
        return (end - self.started_at).total_seconds()

    @property
    def total_dissents(self) -> int:
        return sum(len(r.dissents) for r in self.agenda_results)


# ============================================================================
# LLM 调用
# ============================================================================


async def _call_llm(
    provider,
    system_prompt: str,
    user_prompt: str,
    *,
    model_override: str = "qwen-max-latest",
    temperature: float = 0.3,
    dry_run: bool = False,
    mock_content: Optional[str] = None,
) -> tuple[str, int, float]:
    """Returns (content, token_estimate, elapsed_sec). Raises LlmError."""
    if dry_run:
        # 用 mock 内容 + 模拟延时
        await asyncio.sleep(0.5)
        c = mock_content or "(dry-run mock 内容)"
        return c, len(c) // 2, 0.5

    t0 = time.time()
    chunks: list[str] = []
    async for chunk in stream_chat(
        provider=provider,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model_override=model_override,
        temperature=temperature,
        top_p=0.7,
    ):
        chunks.append(chunk)
    content = "".join(chunks).strip()
    elapsed = time.time() - t0
    token_est = len(content) // 2  # 中文 ~2 chars/token 粗估
    return content, token_est, elapsed


def _parse_json_strict(s: str) -> Optional[dict]:
    """从可能带 markdown fence 的 LLM 输出里抽 JSON."""
    if not s:
        return None
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


# ============================================================================
# Loaders (DB readonly)
# ============================================================================


async def load_workspace_and_agents(
    workspace_name: Optional[str], max_experts: int
) -> tuple[Workspace, Agent, list[Agent]]:
    """
    Returns (workspace, moderator, experts[]).
    Raises SystemExit(1) on config error.
    """
    async with SessionLocal() as db:
        # 1. workspace
        if workspace_name:
            ws = (
                await db.execute(
                    select(Workspace).where(Workspace.name == workspace_name)
                )
            ).scalar_one_or_none()
        else:
            ws = (
                await db.execute(select(Workspace).order_by(Workspace.created_at))
            ).scalars().first()
        if not ws:
            logger.error("workspace not found (name=%s)", workspace_name)
            sys.exit(1)
        logger.info("使用 workspace: %s (%s)", ws.name, ws.id)

        # 2. moderator (role='moderator')
        moderator = (
            await db.execute(
                select(Agent).where(
                    Agent.workspace_id == ws.id,
                    Agent.role == "moderator",
                    Agent.is_active.is_(True),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not moderator:
            logger.error(
                "workspace %s 缺议程主持 (role=moderator) agent."
                "v26.3 必须有.建议跑 demo_seed.py 或 admin/agents 手动创建.",
                ws.name,
            )
            sys.exit(1)
        logger.info("议程主持: %s", moderator.name)

        # 3. experts (role='expert', active, has primary_user)
        experts = (
            await db.execute(
                select(Agent).where(
                    Agent.workspace_id == ws.id,
                    Agent.role == "expert",
                    Agent.is_active.is_(True),
                    Agent.primary_user_id.is_not(None),
                ).order_by(Agent.created_at).limit(max_experts)
            )
        ).scalars().all()
        if len(experts) < 2:
            logger.error(
                "workspace %s 只有 %d 个 active expert 且绑了 primary_user (需 ≥2).",
                ws.name, len(experts),
            )
            sys.exit(1)
        logger.info("参会专家: %s", " / ".join(a.name for a in experts))

        return ws, moderator, experts


# ============================================================================
# 调度核心
# ============================================================================


def _format_prev_messages(messages: list[Message], window: int = 8) -> str:
    """Format 最近 N 条 message 喂下一个 LLM."""
    if not messages:
        return "(暂无)"
    tail = messages[-window:]
    return "\n\n".join(
        f"【{m.role} · {m.speaker_name}】\n{m.content}"
        for m in tail
    )


def _pick_next_speaker(
    experts: list[Agent], speaker_seq: list[str], messages: list[Message]
) -> Optional[Agent]:
    """
    v26.3-01 简化策略:
      - 优先 没说过的(每人至少 1 次)
      - 都说过了 → 轮转回第 0 个(允许多说)
      - max_turns 由外部循环控制
    """
    spoken = set(speaker_seq)
    unsaid = [a for a in experts if a.id not in spoken]
    if unsaid:
        return unsaid[0]
    # 都说过,轮第二轮 从头
    return experts[len(speaker_seq) % len(experts)]


async def run_agenda_item(
    provider,
    moderator: Agent,
    experts: list[Agent],
    agenda_idx: int,
    title: str,
    *,
    dry_run: bool,
    skip_consensus: bool,
) -> AgendaResult:
    result = AgendaResult(idx=agenda_idx, title=title)
    t_start = time.time()

    # ----------- 1. moderator intro -----------
    print(f"\n{'═' * 72}")
    print(f"📋 议程 {agenda_idx + 1}/{len(DEMO_AGENDA)}: {title}")
    print("═" * 72)

    intro_content, tok, elapsed = await _call_llm(
        provider,
        system_prompt=MODERATOR_SYSTEM,
        user_prompt=MODERATOR_INTRO_USER.format(title=title),
        temperature=0.2,
        dry_run=dry_run,
        mock_content=f"(mock) 本议程项 关注 {title} ...",
    )
    result.messages.append(Message(
        speaker_id=f"moderator-{moderator.id}",
        speaker_name=moderator.name,
        role="moderator",
        agenda_idx=agenda_idx,
        content=intro_content,
        timestamp=datetime.now(timezone.utc),
        duration_sec=elapsed,
        token_estimate=tok,
    ))
    print(f"\n🎙️  {moderator.name} [intro, {elapsed:.1f}s]:")
    print(f"    {intro_content[:200]}{'…' if len(intro_content) > 200 else ''}")

    # ----------- 2. 轮发言 -----------
    speaker_seq_ids: list[str] = []
    for turn in range(MAX_TURNS_PER_AGENDA):
        next_agent = _pick_next_speaker(experts, speaker_seq_ids, result.messages)
        if not next_agent:
            break

        prev_formatted = _format_prev_messages(result.messages)
        sys_prompt = AGENT_REPLY_SYSTEM.format(
            agent_name=next_agent.name,
            domain=next_agent.domain or next_agent.name,
            persona=(next_agent.persona or "(无 persona,使用 domain 兜底)")[:800],
        )
        user_prompt = AGENT_REPLY_USER.format(
            title=title, prev_messages=prev_formatted
        )

        try:
            reply, tok, elapsed = await _call_llm(
                provider,
                system_prompt=sys_prompt,
                user_prompt=user_prompt,
                temperature=0.5,
                dry_run=dry_run,
                mock_content=f"(mock) 我作为 {next_agent.name},认为 ...",
            )
        except LlmError as e:
            logger.warning("[turn %d] agent %s LLM 失败: %s — 跳过", turn, next_agent.name, e)
            continue

        # 截断 (避免 LLM 跑飞)
        if len(reply) > AGENT_REPLY_MAX_CHARS:
            reply = reply[:AGENT_REPLY_MAX_CHARS] + "…"

        result.messages.append(Message(
            speaker_id=str(next_agent.id),
            speaker_name=next_agent.name,
            role="expert",
            agenda_idx=agenda_idx,
            content=reply,
            timestamp=datetime.now(timezone.utc),
            duration_sec=elapsed,
            token_estimate=tok,
        ))
        speaker_seq_ids.append(next_agent.id)
        result.speaker_seq.append(next_agent.name)

        print(f"\n🤖 {next_agent.name} [turn {turn + 1}, {elapsed:.1f}s]:")
        print(f"    {reply[:200]}{'…' if len(reply) > 200 else ''}")

        # ----------- 3. moderator 每 3 轮判 adequate -----------
        if (turn + 1) >= ADEQUACY_CHECK_AFTER_TURN:
            judge_user = MODERATOR_JUDGE_USER.format(
                title=title,
                turn_count=turn + 1,
                messages=_format_prev_messages(result.messages, window=20),
            )
            try:
                jr, _, _ = await _call_llm(
                    provider,
                    system_prompt=MODERATOR_SYSTEM,
                    user_prompt=judge_user,
                    temperature=0.0,
                    dry_run=dry_run,
                    mock_content='{"is_adequate": true, "reason": "(mock)", "missing_perspectives": []}',
                )
            except LlmError as e:
                logger.warning("adequacy 判定 LLM 失败: %s — 继续轮", e)
                continue

            parsed = _parse_json_strict(jr)
            if not parsed:
                logger.warning("adequacy 输出无法解析 JSON: %r", jr[:200])
                continue
            result.adequacy_judgment = parsed
            print(
                f"\n   📊 adequacy 判定: "
                f"{'✓ 充分' if parsed.get('is_adequate') else '⏳ 不充分'} "
                f"— {parsed.get('reason', '')}"
            )
            if parsed.get("is_adequate"):
                break

    # ----------- 4. moderator wrap_up -----------
    wrap_user = MODERATOR_WRAPUP_USER.format(
        title=title,
        messages=_format_prev_messages(result.messages, window=20),
    )
    try:
        wrap, tok, elapsed = await _call_llm(
            provider,
            system_prompt=MODERATOR_SYSTEM,
            user_prompt=wrap_user,
            temperature=0.2,
            dry_run=dry_run,
            mock_content=f"(mock) 经讨论,本议程项 形成共识 ...",
        )
        result.messages.append(Message(
            speaker_id=f"moderator-{moderator.id}",
            speaker_name=moderator.name,
            role="moderator",
            agenda_idx=agenda_idx,
            content=wrap,
            timestamp=datetime.now(timezone.utc),
            duration_sec=elapsed,
            token_estimate=tok,
        ))
        print(f"\n🎙️  {moderator.name} [wrap_up, {elapsed:.1f}s]:")
        print(f"    {wrap[:250]}{'…' if len(wrap) > 250 else ''}")
    except LlmError as e:
        logger.warning("wrap_up 失败: %s", e)

    # ----------- 5. consensus + dissents -----------
    if not skip_consensus and len(result.messages) >= 3:
        cu = CONSENSUS_USER.format(
            title=title,
            messages=_format_prev_messages(result.messages, window=30),
        )
        try:
            cr, _, _ = await _call_llm(
                provider,
                system_prompt=CONSENSUS_SYSTEM,
                user_prompt=cu,
                temperature=0.0,
                dry_run=dry_run,
                mock_content='{"consensus": "(mock 共识)", "dissents": []}',
            )
        except LlmError as e:
            logger.warning("consensus 收集失败: %s", e)
            cr = "{}"
        parsed = _parse_json_strict(cr)
        if parsed:
            result.consensus_md = parsed.get("consensus", "") or ""
            result.dissents = parsed.get("dissents", []) or []

        print(f"\n📋 共识: {result.consensus_md[:200]}{'…' if len(result.consensus_md) > 200 else ''}")
        if result.dissents:
            print(f"\n⚠️  发现 {len(result.dissents)} 处分歧:")
            for d in result.dissents:
                print(f"    • {d.get('point', '?')}: {d.get('summary', '')[:80]}")

    result.elapsed_sec = time.time() - t_start
    return result


# ============================================================================
# Main
# ============================================================================


async def run_demo(
    workspace_name: Optional[str],
    max_experts: int,
    dry_run: bool,
    skip_consensus: bool,
    output_path: Optional[Path],
) -> MeetingResult:
    ws, moderator, experts = await load_workspace_and_agents(workspace_name, max_experts)

    # LLM provider
    if not dry_run:
        async with SessionLocal() as db:
            provider = await get_active_provider(db)
        if not provider:
            logger.error("no active LLM provider — 跑 --dry-run 或 配 model_provider_config")
            sys.exit(2)
    else:
        provider = None

    result = MeetingResult(
        title=DEMO_TITLE,
        started_at=datetime.now(timezone.utc),
        moderator_name=moderator.name,
        experts=[
            {"id": str(a.id), "name": a.name, "domain": a.domain} for a in experts
        ],
        dry_run=dry_run,
        skip_consensus=skip_consensus,
    )

    print(f"\n{'█' * 72}")
    print(f"  📋 v26.3-01 全 AI 自主会议 端到端 demo")
    print(f"  主题: {DEMO_TITLE}")
    print(f"  议程: {len(DEMO_AGENDA)} 项 · 主持: {moderator.name}")
    print(f"  专家: {' / '.join(a.name for a in experts)}")
    print(f"  模式: {'DRY-RUN (mock LLM)' if dry_run else 'REAL (qwen-max)'}")
    print(f"{'█' * 72}")

    for idx, agenda_title in enumerate(DEMO_AGENDA):
        ar = await run_agenda_item(
            provider, moderator, experts, idx, agenda_title,
            dry_run=dry_run, skip_consensus=skip_consensus,
        )
        result.agenda_results.append(ar)

        # 累加统计
        for m in ar.messages:
            result.total_chars += len(m.content)
            result.total_llm_calls += 1
        if not skip_consensus and ar.consensus_md:
            result.total_llm_calls += 1

    result.ended_at = datetime.now(timezone.utc)

    # ---- print summary ----
    _print_summary(result)

    # ---- write report.md ----
    if output_path is None:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = Path(f"tests/auto-meeting-demo-{ts}.md")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _write_report(result, output_path)
    print(f"\n📄 详细报告: {output_path}")

    return result


def _print_summary(result: MeetingResult) -> None:
    print(f"\n{'═' * 72}")
    print(f"  📊 会议结果汇总")
    print(f"{'═' * 72}")
    print(f"  议程项: {len(result.agenda_results)} / 跑完: "
          f"{sum(1 for r in result.agenda_results if r.messages)}")
    print(f"  总耗时: {result.elapsed_sec:.1f} 秒 ({result.elapsed_sec/60:.1f} 分钟)")
    print(f"  LLM 调用: ~{result.total_llm_calls} 次")
    print(f"  总输出: {result.total_chars} 字 (token ~{result.total_chars // 2})")
    print(f"  分歧: {result.total_dissents} 处")
    print()
    for r in result.agenda_results:
        marker = "⚠️" if r.has_dissent else "✓"
        print(f"  {marker} [议程 {r.idx + 1}] {r.title[:50]}")
        print(f"      {len(r.messages)} 条发言 · {r.elapsed_sec:.0f}s · "
              f"分歧 {len(r.dissents)}")


def _write_report(result: MeetingResult, path: Path) -> None:
    lines: list[str] = []
    lines.append(f"# v26.3-01 全 AI 自主会议 demo 报告")
    lines.append("")
    lines.append(f"- **主题**:{result.title}")
    lines.append(f"- **议程**:{len(DEMO_AGENDA)} 项")
    lines.append(f"- **主持**:{result.moderator_name}")
    lines.append(f"- **专家**:{', '.join(e['name'] for e in result.experts)}")
    lines.append(f"- **模式**:{'DRY-RUN (mock LLM)' if result.dry_run else 'REAL (qwen-max-latest)'}")
    lines.append(f"- **开始**:{result.started_at.isoformat()}")
    lines.append(f"- **结束**:{(result.ended_at or datetime.now(timezone.utc)).isoformat()}")
    lines.append(f"- **总耗时**:{result.elapsed_sec:.1f} 秒 ({result.elapsed_sec/60:.1f} 分钟)")
    lines.append(f"- **总分歧**:{result.total_dissents} 处")
    lines.append(f"- **LLM 调用**:~{result.total_llm_calls} 次,~{result.total_chars} 字输出")
    lines.append("")
    lines.append("---")
    lines.append("")

    for r in result.agenda_results:
        lines.append(f"## 议程 {r.idx + 1}:{r.title}")
        lines.append("")
        lines.append(f"- 耗时:{r.elapsed_sec:.1f} 秒")
        lines.append(f"- 发言数:{len(r.messages)}")
        lines.append(f"- 发言顺序:{' → '.join(r.speaker_seq)}")
        if r.adequacy_judgment:
            adq = r.adequacy_judgment
            lines.append(f"- adequacy 判定:{'✓ 充分' if adq.get('is_adequate') else '⏳ 不充分'} — {adq.get('reason', '')}")
        lines.append("")
        lines.append("### 完整发言")
        lines.append("")
        for m in r.messages:
            role_icon = "🎙️" if m.role == "moderator" else "🤖"
            lines.append(f"#### {role_icon} {m.speaker_name} ({m.duration_sec:.1f}s)")
            lines.append("")
            lines.append(m.content)
            lines.append("")

        if r.consensus_md:
            lines.append("### 📋 共识")
            lines.append("")
            lines.append(r.consensus_md)
            lines.append("")

        if r.dissents:
            lines.append("### ⚠️ 分歧(待召集人会后裁决)")
            lines.append("")
            for d in r.dissents:
                lines.append(f"- **{d.get('point', '?')}**")
                lines.append(f"  - 摘要:{d.get('summary', '')}")
                ia = d.get("involved_agents", [])
                if ia:
                    lines.append(f"  - 涉及专家:{', '.join(str(a) for a in ia)}")
            lines.append("")

        lines.append("---")
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description="v26.3-01 全 AI 会议 demo")
    p.add_argument("--workspace-name", default=None, help="workspace 名(默认 取第一个)")
    p.add_argument("--max-experts", type=int, default=4, help="最多带几个 expert(默认 4)")
    p.add_argument("--dry-run", action="store_true", help="mock LLM (验证调度逻辑)")
    p.add_argument("--skip-consensus", action="store_true", help="跳过 consensus 收集步骤")
    p.add_argument("--output", type=str, default=None, help="输出 md 报告路径")
    args = p.parse_args()

    output = Path(args.output) if args.output else None
    try:
        asyncio.run(run_demo(
            workspace_name=args.workspace_name,
            max_experts=args.max_experts,
            dry_run=args.dry_run,
            skip_consensus=args.skip_consensus,
            output_path=output,
        ))
    except KeyboardInterrupt:
        print("\n中断.")
        sys.exit(130)


if __name__ == "__main__":
    main()
