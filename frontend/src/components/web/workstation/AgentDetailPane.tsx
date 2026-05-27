"use client";

/**
 * AgentDetail pane — R5.B (round-6, "脑内地图").
 *
 * 内容:
 *  - AgentHero (顶部, 含返回 + 头像 + intro + 5 stat 条)
 *  - 脑内地图 section:
 *     - BrainRadar (左, SVG 6-axes 雷达, 书架 vs 长期记忆 双多边形)
 *     - BrainGraph (右, SVG 节点图 - AI 中心 + KB/记忆/会议 三类节点)
 *  - AgentTabs (底, 3 tab: 长期记忆 / 书架 / 会议)
 *
 * 数据源:
 *  - 3 个 AI (SHU / ARIA / FALAO) 有完整 W_PROFILES
 *  - 其他 AI 走 genericProfile fallback (从 W_AGENTS 推 placeholder)
 *  - PM 任务要求 mock 6 个固定 AI (Aria/Stratos/Lex/Sage/Tally/Scout) 与 R5.A 一致
 *  - W_AGENTS 已涵盖这 6 个 + 更多 — 此处给关键 6 个 (Aria/Stratos/Lex/Sage/Tally/Scout)
 *    补 profile, 其他 fallback
 *
 * **R5.B scope**: UI 优先, mock 数据. 后端契约见 SAGA-E-ai-capabilities-changelist.md.
 *  Saga E.E 后续接 backend 时, 6 个 AI 的真实 KB/memory/meeting 来自 backend.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { W_TOKENS } from "../tokens";
import {
  WCard,
  WButton,
  WIcon,
  WPill,
  WAIBadge,
  WSparkle,
} from "../atoms";
import { W_AGENTS, type WAgent } from "../data/agents";

// ════════════════════════════════════════════
// PROFILE DATA — 6 fully-detailed AI + generic fallback
// ════════════════════════════════════════════

type RadarAxis = {
  id: string;
  label: string;
  kb: number;
  mem: number;
};

type KnowledgeDoc = {
  id: string;
  name: string;
  type: "pdf" | "word" | "md" | "excel" | "ppt";
  pages: number;
  chunks: number;
  cited: number;
  updated: string;
};

type MemoryEntry = {
  id: string;
  text: string;
  cited: number;
  source: string;
  when: string;
};

type AgentMeeting = {
  id: string;
  title: string;
  when: string;
  role: string;
};

type AgentProfile = {
  summonRate: number;
  adoptRate: number;
  axes: RadarAxis[];
  knowledge: KnowledgeDoc[];
  memories: MemoryEntry[];
  meetings: AgentMeeting[];
  connections: [string, string][];
};

const W_PROFILES: Record<string, AgentProfile> = {
  ARIA: {
    summonRate: 124,
    adoptRate: 85,
    axes: [
      { id: "ab", label: "A/B 测试", kb: 10, mem: 14 },
      { id: "metric", label: "指标体系", kb: 8, mem: 10 },
      { id: "causal", label: "因果推断", kb: 6, mem: 5 },
      { id: "stats", label: "统计建模", kb: 9, mem: 8 },
      { id: "viz", label: "可视化", kb: 4, mem: 3 },
      { id: "product", label: "产品理解", kb: 5, mem: 9 },
    ],
    knowledge: [
      { id: "k1", name: "A/B 测试方法手册 v4", type: "pdf", pages: 48, chunks: 32, cited: 56, updated: "5/22" },
      { id: "k2", name: "北极星指标设计文档", type: "word", pages: 14, chunks: 9, cited: 28, updated: "5/15" },
      { id: "k3", name: "统计显著性 cheatsheet", type: "md", pages: 6, chunks: 6, cited: 22, updated: "5/10" },
      { id: "k4", name: "因果推断入门 (Pearl)", type: "pdf", pages: 62, chunks: 28, cited: 12, updated: "4/28" },
      { id: "k5", name: "增长实验案例集", type: "pdf", pages: 32, chunks: 22, cited: 18, updated: "4/22" },
    ],
    memories: [
      { id: "m1", text: "B 组延迟 +320ms 但有用率 +11.4pp 显著,P95 仍在 SLA 内 — 灰度到 20% 是合理选择。", cited: 14, source: "A/B 复盘", when: "5/22" },
      { id: "m2", text: "样本量 < 1000 时,t 检验比 z 检验更稳健。", cited: 9, source: "统计培训", when: "5/15" },
      { id: "m3", text: "北极星指标至少要绑定 1 个反向指标,防止单点优化破坏整体。", cited: 12, source: "指标评审", when: "5/10" },
      { id: "m4", text: 'P 值 < 0.05 不代表"重要",还要看 effect size。', cited: 8, source: "产品周会", when: "5/02" },
      { id: "m5", text: "增长实验失败的占 70%,提前定好 stop loss 是必修课。", cited: 11, source: "增长复盘", when: "4/22" },
      { id: "m6", text: "可视化首选直方图 + 误差棒,比柱状图传递更多信息。", cited: 4, source: "可视化分享", when: "4/15" },
    ],
    meetings: [
      { id: "q3-roadmap", title: "Q3 路线图对齐", when: "今天", role: "主分析" },
      { id: "ab-recap", title: "摘要模型 A/B 复盘", when: "5/22", role: "主分析" },
      { id: "metric-review", title: "指标体系评审", when: "5/10", role: "主分析" },
      { id: "growth-recap", title: "增长实验复盘", when: "4/22", role: "主分析" },
    ],
    connections: [
      ["k1", "m1"], ["k1", "m5"], ["k2", "m3"], ["k3", "m2"], ["k3", "m4"], ["k4", "m3"], ["k5", "m5"],
      ["m1", "q3-roadmap"], ["m1", "ab-recap"], ["m3", "metric-review"], ["m4", "q3-roadmap"], ["m5", "growth-recap"],
    ],
  },
  STRATOS: {
    summonRate: 86,
    adoptRate: 82,
    axes: [
      { id: "roadmap", label: "路线图", kb: 8, mem: 12 },
      { id: "trade", label: "取舍", kb: 6, mem: 10 },
      { id: "okr", label: "OKR 校准", kb: 5, mem: 7 },
      { id: "narrative", label: "叙事力", kb: 4, mem: 6 },
      { id: "market", label: "市场判断", kb: 7, mem: 5 },
      { id: "exec", label: "执行洞察", kb: 5, mem: 8 },
    ],
    knowledge: [
      { id: "k1", name: "PM 入门 (Marty Cagan)", type: "pdf", pages: 64, chunks: 32, cited: 22, updated: "5/18" },
      { id: "k2", name: "北极星指标设计", type: "word", pages: 14, chunks: 9, cited: 18, updated: "5/12" },
      { id: "k3", name: "产品路线图模板", type: "md", pages: 8, chunks: 6, cited: 14, updated: "5/05" },
      { id: "k4", name: "OKR 制定手册", type: "pdf", pages: 24, chunks: 18, cited: 12, updated: "4/22" },
    ],
    memories: [
      { id: "m1", text: "Q1 协作功能延期主要因为同时开三条线,资源 spread 太薄。", cited: 18, source: "Q3 路线图对齐", when: "今天" },
      { id: "m2", text: "同时开三条主线,ETA 每条会滑 18%。", cited: 14, source: "历史复盘", when: "5/15" },
      { id: "m3", text: "路线图取舍先看 RICE,再看叙事。", cited: 11, source: "产品周会", when: "5/02" },
      { id: "m4", text: "资源不够时砍范围,不砍质量。", cited: 9, source: "Q2 复盘", when: "4/28" },
      { id: "m5", text: "OKR 季度初定,中段不改, 末段总结复盘。", cited: 7, source: "OKR 培训", when: "4/15" },
    ],
    meetings: [
      { id: "q3-roadmap", title: "Q3 路线图对齐", when: "今天", role: "主策略" },
      { id: "q2-recap", title: "Q2 路线图复盘", when: "5/02", role: "主策略" },
      { id: "okr-training", title: "OKR 培训", when: "4/15", role: "主讲" },
    ],
    connections: [
      ["k1", "m3"], ["k2", "m1"], ["k3", "m2"], ["k4", "m5"],
      ["m1", "q3-roadmap"], ["m2", "q3-roadmap"], ["m3", "q2-recap"], ["m5", "okr-training"],
    ],
  },
  LEX: {
    summonRate: 31,
    adoptRate: 88,
    axes: [
      { id: "contract", label: "合同审阅", kb: 10, mem: 12 },
      { id: "privacy", label: "隐私合规", kb: 8, mem: 9 },
      { id: "risk", label: "风险评估", kb: 6, mem: 8 },
      { id: "compliance", label: "合规建议", kb: 7, mem: 6 },
      { id: "litigation", label: "诉讼准备", kb: 4, mem: 3 },
      { id: "negotiation", label: "谈判要点", kb: 5, mem: 5 },
    ],
    knowledge: [
      { id: "k1", name: "商事合同标准条款库", type: "word", pages: 42, chunks: 28, cited: 32, updated: "5/20" },
      { id: "k2", name: "数据隐私合规清单", type: "pdf", pages: 18, chunks: 12, cited: 24, updated: "5/12" },
      { id: "k3", name: "常见合同陷阱 100 例", type: "pdf", pages: 56, chunks: 38, cited: 18, updated: "4/28" },
      { id: "k4", name: "个人信息保护法逐条解读", type: "pdf", pages: 48, chunks: 32, cited: 14, updated: "4/15" },
    ],
    memories: [
      { id: "m1", text: "不限责任条款是最高风险,必须高亮提示。", cited: 12, source: "合同审阅会", when: "5/15" },
      { id: "m2", text: "管辖法院条款被忽略时,默认按合同签订地。", cited: 8, source: "合同培训", when: "5/02" },
      { id: "m3", text: "电子签章在企业间合同有效,需保留 timestamp。", cited: 6, source: "技术合规会", when: "4/22" },
      { id: "m4", text: "收集敏感个信前必须取得单独同意。", cited: 11, source: "数据合规风评", when: "昨天" },
      { id: "m5", text: "数据出境路径分 3 种:CAC 评估 / 标准合同 / 认证。", cited: 5, source: "出境评估会", when: "4/05" },
    ],
    meetings: [
      { id: "data-compliance", title: "数据安全合规风评会", when: "昨天", role: "主审" },
      { id: "contract-review", title: "合同审阅例会", when: "5/15", role: "主审" },
    ],
    connections: [
      ["k1", "m1"], ["k1", "m2"], ["k2", "m4"], ["k3", "m3"], ["k4", "m5"],
      ["m1", "contract-review"], ["m4", "data-compliance"],
    ],
  },
  SAGE: {
    summonRate: 64,
    adoptRate: 76,
    axes: [
      { id: "ux", label: "用户体验", kb: 8, mem: 12 },
      { id: "mental", label: "心智模型", kb: 6, mem: 10 },
      { id: "research", label: "用户调研", kb: 5, mem: 6 },
      { id: "ia", label: "信息架构", kb: 7, mem: 7 },
      { id: "interaction", label: "交互设计", kb: 6, mem: 8 },
      { id: "review", label: "走查方法", kb: 4, mem: 5 },
    ],
    knowledge: [
      { id: "k1", name: "心智模型设计 (Indi Young)", type: "pdf", pages: 38, chunks: 22, cited: 18, updated: "5/15" },
      { id: "k2", name: "用户访谈手册", type: "word", pages: 16, chunks: 10, cited: 14, updated: "5/02" },
      { id: "k3", name: "交互走查 checklist", type: "md", pages: 8, chunks: 6, cited: 12, updated: "4/28" },
      { id: "k4", name: "信息架构案例集", type: "pdf", pages: 28, chunks: 18, cited: 8, updated: "4/22" },
    ],
    memories: [
      { id: "m1", text: "用户访谈中, 复述比追问更有信息密度。", cited: 11, source: "用户访谈会", when: "5/15" },
      { id: "m2", text: "心智模型先看任务流, 再看心理模型, 最后才看 UI。", cited: 9, source: "心智模型培训", when: "5/02" },
      { id: "m3", text: "走查时优先看错配 (mis-match) 而不是好做的优化。", cited: 7, source: "交互走查会", when: "4/28" },
      { id: "m4", text: "信息架构改大不动小, 改两层比改三层更有效。", cited: 5, source: "IA 评审", when: "4/15" },
    ],
    meetings: [
      { id: "ux-review", title: "搜索结果页走查", when: "5/15", role: "主走查" },
      { id: "ia-review", title: "IA 重构评审", when: "4/15", role: "主评审" },
    ],
    connections: [
      ["k1", "m2"], ["k2", "m1"], ["k3", "m3"], ["k4", "m4"],
      ["m1", "ux-review"], ["m3", "ux-review"], ["m4", "ia-review"],
    ],
  },
  TALLY: {
    summonRate: 38,
    adoptRate: 80,
    axes: [
      { id: "cashflow", label: "现金流", kb: 9, mem: 11 },
      { id: "scenario", label: "三档情景", kb: 6, mem: 8 },
      { id: "pricing", label: "定价建模", kb: 5, mem: 6 },
      { id: "cost", label: "成本拆解", kb: 7, mem: 7 },
      { id: "valuation", label: "估值", kb: 4, mem: 3 },
      { id: "budget", label: "预算管理", kb: 5, mem: 5 },
    ],
    knowledge: [
      { id: "k1", name: "财务建模手册", type: "pdf", pages: 52, chunks: 32, cited: 22, updated: "5/12" },
      { id: "k2", name: "三档情景分析模板", type: "excel", pages: 12, chunks: 8, cited: 18, updated: "5/05" },
      { id: "k3", name: "SaaS 定价案例集", type: "pdf", pages: 28, chunks: 18, cited: 12, updated: "4/22" },
      { id: "k4", name: "成本拆解 SOP", type: "md", pages: 10, chunks: 6, cited: 8, updated: "4/10" },
    ],
    memories: [
      { id: "m1", text: "任何决策先看 12 个月现金流影响, 而非利润表。", cited: 14, source: "财务月会", when: "5/15" },
      { id: "m2", text: "三档情景(乐观/中性/悲观)中, 悲观档要能 walk away。", cited: 11, source: "情景分析会", when: "5/02" },
      { id: "m3", text: "SaaS 定价首选 per-seat × annual, 月付加 20% premium。", cited: 7, source: "定价评审", when: "4/22" },
      { id: "m4", text: "预算超支 10% 内由部门吸收, 超 10% 上报。", cited: 5, source: "预算会议", when: "4/10" },
    ],
    meetings: [
      { id: "finance-monthly", title: "财务月会", when: "5/15", role: "主报告" },
      { id: "pricing-review", title: "定价评审", when: "4/22", role: "主建模" },
    ],
    connections: [
      ["k1", "m1"], ["k2", "m2"], ["k3", "m3"], ["k4", "m4"],
      ["m1", "finance-monthly"], ["m3", "pricing-review"],
    ],
  },
  SCOUT: {
    summonRate: 42,
    adoptRate: 74,
    axes: [
      { id: "comp", label: "竞品研究", kb: 9, mem: 11 },
      { id: "interview", label: "客户访谈", kb: 7, mem: 9 },
      { id: "trend", label: "市场趋势", kb: 5, mem: 6 },
      { id: "compare", label: "事实对比", kb: 6, mem: 7 },
      { id: "tracker", label: "竞品跟踪", kb: 4, mem: 5 },
      { id: "synthesis", label: "调研综合", kb: 5, mem: 4 },
    ],
    knowledge: [
      { id: "k1", name: "竞品分析框架", type: "pdf", pages: 24, chunks: 16, cited: 18, updated: "5/10" },
      { id: "k2", name: "客户访谈手册", type: "word", pages: 18, chunks: 12, cited: 14, updated: "5/02" },
      { id: "k3", name: "竞品功能对比库", type: "excel", pages: 8, chunks: 6, cited: 11, updated: "4/22" },
      { id: "k4", name: "市场趋势报告 2024", type: "pdf", pages: 36, chunks: 22, cited: 8, updated: "4/15" },
    ],
    memories: [
      { id: "m1", text: "竞品对比先用事实, 再说判断, 不要直接给观点。", cited: 12, source: "竞品复盘", when: "5/10" },
      { id: "m2", text: "客户访谈纪要保留原话比总结更有用。", cited: 9, source: "访谈培训", when: "5/02" },
      { id: "m3", text: "竞品功能 lag 6 个月以上的, 不再纳入主流对比。", cited: 5, source: "竞品评审", when: "4/22" },
    ],
    meetings: [
      { id: "comp-review", title: "竞品季度复盘", when: "5/10", role: "主分析" },
      { id: "interview-prep", title: "客户访谈准备会", when: "5/02", role: "主协调" },
    ],
    connections: [
      ["k1", "m1"], ["k2", "m2"], ["k3", "m3"],
      ["m1", "comp-review"], ["m2", "interview-prep"],
    ],
  },
};

function genericProfile(a: WAgent): AgentProfile {
  const tags = a.tags.slice(0, 6);
  while (tags.length < 6) tags.push("通用");
  return {
    summonRate: a.sum,
    adoptRate: 65,
    axes: tags.slice(0, 6).map((t, i) => ({
      id: "t" + i,
      label: t.length > 4 ? t.slice(0, 4) : t,
      kb: 3 + ((i * 2) % 5),
      mem: 2 + ((i * 3) % 4),
    })),
    knowledge: [
      {
        id: "k1",
        name: `${a.nick || a.name} · 种子知识库`,
        type: "pdf",
        pages: 10,
        chunks: 6,
        cited: 4,
        updated: a.updated || "今天",
      },
    ],
    memories: [
      {
        id: "m1",
        text: a.intro || "尚未沉淀长期记忆 — 多开几场会就有了。",
        cited: 1,
        source: "初始化",
        when: a.updated || "今天",
      },
    ],
    meetings: [],
    connections: [["k1", "m1"]],
  };
}

// ════════════════════════════════════════════
// AgentDetailPane (root)
// ════════════════════════════════════════════
// Sprint 3 Web W2: brain UI (BrainRadar / BrainGraph) **V1 走 mock**.
// 真接 backend `/api/v2/agents/{id}/brain` 推到 Sprint 4 (audit Section 5 V1.5 推迟).
// 决策: backend brain 复杂度 ~6h, 但本 W2 wave ~5d 已紧, 先 V1 mock + 加 demo pill 提示
// "脑图分布是演示数据, 实时数据待 Sprint 4 后端 brain endpoint 上线". 用户清楚, 不假装真接.
export function AgentDetailPane({ agent }: { agent: WAgent }) {
  const profile = W_PROFILES[agent.id] || genericProfile(agent);
  const [showKB, setShowKB] = useState(true);
  const [showMem, setShowMem] = useState(true);

  return (
    <div>
      <AgentHero agent={agent} profile={profile} />

      <section>
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "baseline",
            gap: 9,
            flexWrap: "wrap",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            脑内地图
          </h2>
          <span style={{ fontSize: 13, color: W_TOKENS.textMuted }}>
            雷达 = 能力分布 · 图谱 = 资料/记忆/会议 的关联
          </span>
          {/* Sprint 3 Web W2: brain V1 mock pill — Sprint 4 接 backend brain endpoint */}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "#C4B5FD",
              background: "rgba(124,92,250,0.10)",
              padding: "2px 8px",
              borderRadius: 5,
              letterSpacing: 0.3,
              boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
            }}
          >
            演示数据 · brain 后端待接
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "5fr 6fr",
            gap: 14,
          }}
        >
          <BrainRadar
            axes={profile.axes}
            showKB={showKB}
            showMem={showMem}
            onToggle={(k) =>
              k === "kb" ? setShowKB(!showKB) : setShowMem(!showMem)
            }
          />
          <BrainGraph agentId={agent.id} profile={profile} />
        </div>
      </section>

      <AgentTabs profile={profile} />
    </div>
  );
}

// ════════════════════════════════════════════
// AgentHero (顶部)
// ════════════════════════════════════════════
function AgentHero({
  agent,
  profile,
}: {
  agent: WAgent;
  profile: AgentProfile;
}) {
  const router = useRouter();
  const stats = [
    { label: "召唤次数", value: profile.summonRate, accent: "#C4B5FD" },
    { label: "采纳率", value: profile.adoptRate + "%", accent: W_TOKENS.cyan },
    { label: "长期记忆", value: profile.memories.length, accent: "#C4B5FD" },
    { label: "书架文档", value: profile.knowledge.length, accent: W_TOKENS.cyan },
    { label: "参与会议", value: profile.meetings.length, accent: W_TOKENS.pink },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/workstation/agents")}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: W_TOKENS.textMuted,
          fontSize: 13,
          padding: "4px 0",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 12,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = W_TOKENS.textPrimary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = W_TOKENS.textMuted;
        }}
      >
        <WIcon name="back" size={13} /> 返回 AI 团队
      </button>

      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 16,
          padding: "22px 24px",
          background: `linear-gradient(135deg, ${agent.grad[0]}15 0%, ${agent.grad[1]}25 100%), ${W_TOKENS.surface}`,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 10px 24px ${agent.grad[1]}20`,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -40,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${agent.grad[1]}30 0%, rgba(0,0,0,0) 65%)`,
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: 18,
          }}
        >
          <WAIBadge id={agent.id} size={72} radius={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: -0.8,
                  color: W_TOKENS.textPrimary,
                }}
              >
                {agent.name}
              </h1>
              {agent.nick && agent.nick !== agent.name && (
                <span
                  style={{
                    fontSize: 16,
                    color: W_TOKENS.textMuted,
                    fontWeight: 500,
                  }}
                >
                  · {agent.nick}
                </span>
              )}
              <WPill tone="success">
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#86EFAC",
                    boxShadow: "0 0 6px rgba(34,197,94,0.6)",
                  }}
                />
                启用
              </WPill>
            </div>
            <div
              style={{
                fontSize: 13,
                color: W_TOKENS.textSecondary,
                marginTop: 6,
                lineHeight: 1.5,
                maxWidth: 680,
              }}
            >
              {agent.intro}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
              {agent.tags.map((t) => (
                <WPill key={t} tone="neutral">
                  {t}
                </WPill>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <WButton variant="ghost" size="md" icon="gear">
              编辑人格
            </WButton>
            <WButton
              variant="primary"
              size="md"
              icon="sparkle"
              iconRight="arr-r"
              onClick={() => router.push("/workstation/new")}
            >
              邀请到会议
            </WButton>
          </div>
        </div>

        {/* stats strip */}
        <div
          style={{
            position: "relative",
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
            gap: 10,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                background: "rgba(0,0,0,0.20)",
                borderRadius: 10,
                padding: "11px 14px",
                boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: W_TOKENS.textMuted,
                  letterSpacing: 0.3,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 22,
                  fontWeight: 800,
                  color: s.accent,
                  letterSpacing: -0.5,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════
// BrainRadar — 6 axes SVG, KB vs Memory dual polygon
// ════════════════════════════════════════════
function BrainRadar({
  axes,
  showKB,
  showMem,
  onToggle,
}: {
  axes: RadarAxis[];
  showKB: boolean;
  showMem: boolean;
  onToggle: (k: "kb" | "mem") => void;
}) {
  const W = 480;
  const H = 380;
  const cx = W / 2;
  const cy = 180;
  const R = 122;
  const N = axes.length;
  const max = Math.max(...axes.flatMap((a) => [a.kb, a.mem])) + 1;

  const axesGeom = axes.map((a, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / N;
    return { ...a, angle };
  });

  const pt = (axis: (typeof axesGeom)[number], val: number) => {
    const r = (val / max) * R;
    return [
      Math.cos(axis.angle) * r + cx,
      Math.sin(axis.angle) * r + cy,
    ] as const;
  };
  const ringPts = (lv: number) =>
    axesGeom
      .map((a) => {
        const x = Math.cos(a.angle) * R * lv + cx;
        const y = Math.sin(a.angle) * R * lv + cy;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const polyPts = (key: "kb" | "mem") =>
    axesGeom
      .map((a) => {
        const [x, y] = pt(a, a[key]);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const totalKb = axes.reduce((s, a) => s + a.kb, 0);
  const totalMem = axes.reduce((s, a) => s + a.mem, 0);

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        background:
          "linear-gradient(135deg, #14112a 0%, #1b1735 50%, #221a3c 100%)",
        boxShadow:
          "0 12px 32px rgba(94,92,230,0.18), inset 0 0 0 0.5px rgba(124,92,250,0.18)",
        padding: "20px 22px 22px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 280,
          height: 280,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(100,210,255,0.22) 0%, rgba(0,0,0,0) 65%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -80,
          left: -80,
          width: 240,
          height: 240,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,100,160,0.16) 0%, rgba(0,0,0,0) 65%)",
          pointerEvents: "none",
        }}
      />
      <WSparkle x={26} y={18} size={11} opacity={0.85} />
      <WSparkle x={64} y={42} size={6} opacity={0.55} />
      <WSparkle x="86%" y={26} size={9} opacity={0.7} />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
          }}
        >
          <WIcon name="target" size={16} color="#fff" stroke={1.8} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            能力雷达
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              marginTop: 1,
              letterSpacing: -0.2,
            }}
          >
            这位 AI 擅长什么
          </div>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <LegendToggle
          label="书架知识"
          count={totalKb}
          color={W_TOKENS.cyan}
          active={showKB}
          onToggle={() => onToggle("kb")}
        />
        <LegendToggle
          label="长期记忆"
          count={totalMem}
          color={W_TOKENS.pink}
          active={showMem}
          onToggle={() => onToggle("mem")}
        />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "relative", width: "100%", display: "block" }}
      >
        <defs>
          <radialGradient id="rd-kb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={W_TOKENS.cyan} stopOpacity="0.55" />
            <stop offset="80%" stopColor={W_TOKENS.cyan} stopOpacity="0.20" />
            <stop offset="100%" stopColor={W_TOKENS.cyan} stopOpacity="0.10" />
          </radialGradient>
          <radialGradient id="rd-mem" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#C4B5FD" stopOpacity="0.75" />
            <stop offset="80%" stopColor="#AF52DE" stopOpacity="0.40" />
            <stop offset="100%" stopColor="#AF52DE" stopOpacity="0.20" />
          </radialGradient>
          <radialGradient id="rd-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <filter id="rd-glow">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={R} fill="url(#rd-bg)" />

        {[0.25, 0.5, 0.75, 1].map((L) => (
          <polygon
            key={L}
            points={ringPts(L)}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={L === 1 ? 1 : 0.7}
          />
        ))}
        {axesGeom.map((a, i) => {
          const x2 = Math.cos(a.angle) * R + cx;
          const y2 = Math.sin(a.angle) * R + cy;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x2}
              y2={y2}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={0.7}
            />
          );
        })}

        {showKB && (
          <polygon
            points={polyPts("kb")}
            fill="url(#rd-kb)"
            stroke={W_TOKENS.cyan}
            strokeWidth={1.4}
            strokeOpacity={0.85}
            style={{ filter: "url(#rd-glow)" }}
          />
        )}
        {showMem && (
          <polygon
            points={polyPts("mem")}
            fill="url(#rd-mem)"
            stroke="#C4B5FD"
            strokeWidth={1.6}
            strokeOpacity={0.95}
            style={{ filter: "url(#rd-glow)" }}
          />
        )}

        {showKB &&
          axesGeom.map((a, i) => {
            const [x, y] = pt(a, a.kb);
            return <circle key={"k" + i} cx={x} cy={y} r={3.5} fill="#fff" />;
          })}
        {showMem &&
          axesGeom.map((a, i) => {
            const [x, y] = pt(a, a.mem);
            return (
              <g key={"m" + i}>
                <circle cx={x} cy={y} r={4.5} fill="#fff" opacity={0.95} />
                <circle cx={x} cy={y} r={2.6} fill="#AF52DE" />
              </g>
            );
          })}

        {axesGeom.map((a, i) => {
          const labelR = R + 30;
          const lx = Math.cos(a.angle) * labelR + cx;
          const ly = Math.sin(a.angle) * labelR + cy;
          const cos = Math.cos(a.angle);
          const anchor =
            cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
          return (
            <g key={i}>
              <text
                x={lx}
                y={ly - 2}
                textAnchor={anchor}
                fontSize="11.5"
                fontWeight="600"
                fill="#fff"
                opacity="0.95"
              >
                {a.label}
              </text>
              <text
                x={lx}
                y={ly + 12}
                textAnchor={anchor}
                fontSize="10"
                fill="rgba(255,255,255,0.45)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <tspan fill={W_TOKENS.cyan} fontWeight="600">
                  {a.kb}
                </tspan>
                <tspan fill="rgba(255,255,255,0.30)"> / </tspan>
                <tspan fill="#C4B5FD" fontWeight="600">
                  {a.mem}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LegendToggle({
  label,
  count,
  color,
  active,
  onToggle,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 7,
        background: active
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.04)",
        boxShadow: `inset 0 0 0 0.5px ${active ? "rgba(255,255,255,0.20)" : W_TOKENS.border}`,
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        opacity: active ? 1 : 0.55,
        transition: "opacity 160ms ease",
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}80`,
        }}
      />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "#fff" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </button>
  );
}

// ════════════════════════════════════════════
// BrainGraph — SVG node graph (AI center + 3 node types)
// ════════════════════════════════════════════
type GraphNodeT = {
  id: string;
  kind: "ai" | "kb" | "memory" | "meeting";
  x: number;
  y: number;
  data?: KnowledgeDoc | MemoryEntry | AgentMeeting;
};

function BrainGraph({
  agentId,
  profile,
}: {
  agentId: string;
  profile: AgentProfile;
}) {
  const W = 600;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;

  const center: GraphNodeT = { id: "AI", kind: "ai", x: cx, y: cy };

  const kbAngles = profile.knowledge.map((_, i, arr) => {
    const span = Math.PI * 0.85;
    const start = Math.PI * 0.92;
    return start + (span * i) / Math.max(1, arr.length - 1);
  });
  const kbNodes: GraphNodeT[] = profile.knowledge.map((k, i) => ({
    id: k.id,
    kind: "kb",
    data: k,
    x: cx + Math.cos(kbAngles[i]) * 175,
    y: cy + Math.sin(kbAngles[i]) * 145,
  }));

  const memAngles = profile.memories.map((_, i, arr) => {
    const span = Math.PI * 0.92;
    const start = -Math.PI * 0.46;
    return start + (span * i) / Math.max(1, arr.length - 1);
  });
  const memNodes: GraphNodeT[] = profile.memories.map((m, i) => ({
    id: m.id,
    kind: "memory",
    data: m,
    x: cx + Math.cos(memAngles[i]) * 175,
    y: cy + Math.sin(memAngles[i]) * 140,
  }));

  const meetAngles = profile.meetings.map((_, i, arr) => {
    if (arr.length === 1) return Math.PI / 2;
    const span = Math.PI * 0.65;
    const start = Math.PI * 0.18;
    return start + (span * i) / Math.max(1, arr.length - 1);
  });
  const meetNodes: GraphNodeT[] = profile.meetings.map((t, i) => ({
    id: t.id,
    kind: "meeting",
    data: t,
    x: cx + Math.cos(meetAngles[i]) * 195,
    y: cy + Math.sin(meetAngles[i]) * 170,
  }));

  const all = [center, ...kbNodes, ...memNodes, ...meetNodes];
  const byId = Object.fromEntries(all.map((n) => [n.id, n]));

  const [hov, setHov] = useState<string | null>(null);

  const isActive = (n: GraphNodeT) =>
    !hov ||
    n.id === hov ||
    profile.connections.some(
      ([a, b]) => (a === hov && b === n.id) || (b === hov && a === n.id),
    );

  const implicitEdges = [...kbNodes, ...memNodes, ...meetNodes].map((n) => ({
    from: "AI",
    to: n.id,
  }));

  const semanticEdges = profile.connections.map(([from, to]) => {
    const fromNode = byId[from];
    const kind: "extract" | "create" | "cite" =
      fromNode?.kind === "kb"
        ? "extract"
        : fromNode?.kind === "meeting"
          ? "create"
          : "cite";
    return { from, to, kind };
  });

  const agentGlyph = W_AGENTS.find((x) => x.id === agentId)?.glyph || "◆";

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        background:
          "linear-gradient(135deg, #0e0d1c 0%, #131229 60%, #1a1330 100%)",
        boxShadow:
          "0 12px 32px rgba(0,0,0,0.40), inset 0 0 0 0.5px rgba(255,255,255,0.06)",
        padding: "20px 22px 20px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 60% at 50% 55%, rgba(124,92,250,0.12) 0%, rgba(0,0,0,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <WSparkle x="92%" y={20} size={9} opacity={0.7} />
      <WSparkle x={28} y={42} size={6} opacity={0.5} />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
          }}
        >
          <WIcon name="link" size={16} color="#fff" stroke={1.8} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            知识图谱
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              marginTop: 1,
              letterSpacing: -0.2,
            }}
          >
            书架 → 经验 → 会议 的关系
          </div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
          悬停节点查看关系
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 4,
          fontSize: 11,
          color: "rgba(255,255,255,0.65)",
        }}
      >
        <LegendDot color={W_TOKENS.cyan} label="书架文档" shape="square" />
        <LegendDot color="#C4B5FD" label="长期记忆" shape="circle" />
        <LegendDot color={W_TOKENS.pink} label="会议" shape="hex" />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "relative", width: "100%", display: "block" }}
      >
        <defs>
          <radialGradient id="gh-ai" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#C4B5FD" />
            <stop offset="100%" stopColor="#5E5CE6" />
          </radialGradient>
          <filter id="gh-glow">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        {implicitEdges.map((e, i) => {
          const f = byId[e.from];
          const t = byId[e.to];
          if (!f || !t) return null;
          const active = isActive(t);
          return (
            <line
              key={"i" + i}
              x1={f.x}
              y1={f.y}
              x2={t.x}
              y2={t.y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
              opacity={active ? 1 : 0.25}
            />
          );
        })}

        {semanticEdges.map((e, i) => {
          const f = byId[e.from];
          const t = byId[e.to];
          if (!f || !t) return null;
          const active = isActive(f) || isActive(t);
          const color =
            e.kind === "extract"
              ? W_TOKENS.cyan
              : e.kind === "create"
                ? W_TOKENS.pink
                : "#C4B5FD";
          const mx = (f.x + t.x) / 2;
          const my = (f.y + t.y) / 2;
          const dx = t.x - f.x;
          const dy = t.y - f.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const c1x = mx + nx * 14;
          const c1y = my + ny * 14;
          return (
            <path
              key={"s" + i}
              d={`M ${f.x} ${f.y} Q ${c1x} ${c1y} ${t.x} ${t.y}`}
              stroke={color}
              strokeWidth={active ? 1.4 : 0.8}
              fill="none"
              opacity={active ? 0.75 : 0.22}
              strokeDasharray={e.kind === "cite" ? "3 3" : "none"}
            />
          );
        })}

        <g>
          <circle
            cx={cx}
            cy={cy}
            r={32}
            fill="url(#gh-ai)"
            opacity={0.35}
            style={{ filter: "url(#gh-glow)" }}
          />
          <circle cx={cx} cy={cy} r={24} fill="url(#gh-ai)" />
          <circle
            cx={cx}
            cy={cy}
            r={24}
            fill="none"
            stroke="rgba(255,255,255,0.40)"
            strokeWidth={1.5}
          />
          <text
            x={cx}
            y={cy + 7}
            textAnchor="middle"
            fontSize="22"
            fontWeight="700"
            fill="#fff"
          >
            {agentGlyph}
          </text>
        </g>

        {kbNodes.map((n) => (
          <GraphNode
            key={n.id}
            n={n}
            hov={hov}
            setHov={setHov}
            active={isActive(n)}
            color={W_TOKENS.cyan}
            shape="square"
          />
        ))}
        {memNodes.map((n) => (
          <GraphNode
            key={n.id}
            n={n}
            hov={hov}
            setHov={setHov}
            active={isActive(n)}
            color="#C4B5FD"
            shape="circle"
          />
        ))}
        {meetNodes.map((n) => (
          <GraphNode
            key={n.id}
            n={n}
            hov={hov}
            setHov={setHov}
            active={isActive(n)}
            color={W_TOKENS.pink}
            shape="hex"
          />
        ))}
      </svg>

      {/* hover info bar */}
      <div
        style={{
          position: "relative",
          marginTop: 6,
          minHeight: 36,
          background: "rgba(0,0,0,0.20)",
          borderRadius: 9,
          padding: "8px 12px",
          fontSize: 12,
          color: "rgba(255,255,255,0.80)",
          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.05)",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        {hov
          ? (() => {
              const n = byId[hov];
              if (!n) return null;
              const d = n.data;
              if (n.kind === "kb" && d) {
                const k = d as KnowledgeDoc;
                return (
                  <>
                    <WPill tone="cyan">书架</WPill>
                    <span style={{ color: "#fff", fontWeight: 600 }}>{k.name}</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}>
                      · {k.pages} 页 · {k.chunks} 分块 · 被引用 {k.cited} 次
                    </span>
                  </>
                );
              }
              if (n.kind === "memory" && d) {
                const m = d as MemoryEntry;
                return (
                  <>
                    <WPill tone="accent">记忆</WPill>
                    <span
                      style={{
                        color: "#fff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.text}
                    </span>
                  </>
                );
              }
              if (n.kind === "meeting" && d) {
                const mt = d as AgentMeeting;
                return (
                  <>
                    <WPill tone="pink">会议</WPill>
                    <span style={{ color: "#fff", fontWeight: 600 }}>{mt.title}</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}>
                      · {mt.when} · {mt.role}
                    </span>
                  </>
                );
              }
              return null;
            })()
          : (
            <span style={{ color: "rgba(255,255,255,0.50)" }}>
              <span style={{ color: W_TOKENS.cyan }}>实线 = 提取</span>{" "}
              · <span style={{ color: "#C4B5FD" }}>虚线 = 引用</span>{" "}
              · <span style={{ color: W_TOKENS.pink }}>会议产生新记忆</span>
            </span>
          )}
      </div>
    </div>
  );
}

function GraphNode({
  n,
  hov,
  setHov,
  active,
  color,
  shape,
}: {
  n: GraphNodeT;
  hov: string | null;
  setHov: (id: string | null) => void;
  active: boolean;
  color: string;
  shape: "square" | "circle" | "hex";
}) {
  const r = 10;
  const opacity = active ? 1 : 0.3;
  const ringWidth = hov === n.id ? 2 : 1;
  const ringColor = hov === n.id ? "#fff" : "rgba(255,255,255,0.40)";

  let shapeEl: React.ReactNode;
  if (shape === "square") {
    shapeEl = (
      <rect
        x={n.x - r}
        y={n.y - r}
        width={r * 2}
        height={r * 2}
        rx={3}
        fill={color}
        stroke={ringColor}
        strokeWidth={ringWidth}
      />
    );
  } else if (shape === "hex") {
    const pts = Array.from({ length: 6 })
      .map((_, i) => {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
        return `${(n.x + Math.cos(a) * r).toFixed(1)},${(n.y + Math.sin(a) * r).toFixed(1)}`;
      })
      .join(" ");
    shapeEl = (
      <polygon
        points={pts}
        fill={color}
        stroke={ringColor}
        strokeWidth={ringWidth}
      />
    );
  } else {
    shapeEl = (
      <circle
        cx={n.x}
        cy={n.y}
        r={r}
        fill={color}
        stroke={ringColor}
        strokeWidth={ringWidth}
      />
    );
  }
  return (
    <g
      onMouseEnter={() => setHov(n.id)}
      onMouseLeave={() => setHov(null)}
      style={{ opacity, transition: "opacity 180ms ease", cursor: "pointer" }}
    >
      <circle cx={n.x} cy={n.y} r={r + 8} fill="transparent" />
      {hov === n.id && (
        <circle
          cx={n.x}
          cy={n.y}
          r={r + 4}
          fill={color}
          opacity={0.3}
          style={{ filter: "url(#gh-glow)" }}
        />
      )}
      {shapeEl}
    </g>
  );
}

function LegendDot({
  color,
  label,
  shape,
}: {
  color: string;
  label: string;
  shape: "square" | "circle" | "hex";
}) {
  const r = 5;
  let el: React.ReactNode;
  if (shape === "square") {
    el = <rect x={1} y={1} width={r * 2} height={r * 2} rx={1.5} fill={color} />;
  } else if (shape === "hex") {
    const pts = Array.from({ length: 6 })
      .map((_, i) => {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
        return `${(6 + Math.cos(a) * r).toFixed(1)},${(6 + Math.sin(a) * r).toFixed(1)}`;
      })
      .join(" ");
    el = <polygon points={pts} fill={color} />;
  } else {
    el = <circle cx={6} cy={6} r={r} fill={color} />;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width="12" height="12" viewBox="0 0 12 12">
        {el}
      </svg>
      {label}
    </span>
  );
}

// ════════════════════════════════════════════
// AgentTabs — 长期记忆 / 书架 / 会议 lists
// ════════════════════════════════════════════
function AgentTabs({ profile }: { profile: AgentProfile }) {
  const [tab, setTab] = useState<"memory" | "kb" | "meet">("memory");
  return (
    <section style={{ marginTop: 30 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: W_TOKENS.textPrimary,
            letterSpacing: -0.5,
          }}
        >
          脑内明细
        </h2>
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: W_TOKENS.surface,
            borderRadius: 10,
            boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
          }}
        >
          {[
            { id: "memory" as const, label: `长期记忆 ${profile.memories.length}`, tone: "#C4B5FD" },
            { id: "kb" as const, label: `书架 ${profile.knowledge.length}`, tone: W_TOKENS.cyan },
            { id: "meet" as const, label: `会议 ${profile.meetings.length}`, tone: W_TOKENS.pink },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                height: 30,
                padding: "0 14px",
                borderRadius: 7,
                border: "none",
                background:
                  tab === t.id ? "rgba(255,255,255,0.06)" : "transparent",
                color: tab === t.id ? t.tone : W_TOKENS.textSecondary,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "memory" && (
        <WCard padding={0}>
          {profile.memories.map((m, i) => (
            <MemoryRow
              key={m.id}
              m={m}
              last={i === profile.memories.length - 1}
            />
          ))}
          {profile.memories.length === 0 && (
            <div style={{ padding: 24, color: W_TOKENS.textMuted, fontSize: 13 }}>
              暂无长期记忆
            </div>
          )}
        </WCard>
      )}
      {tab === "kb" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {profile.knowledge.map((k) => (
            <KBDocCard key={k.id} k={k} />
          ))}
        </div>
      )}
      {tab === "meet" && (
        <WCard padding={0}>
          {profile.meetings.map((t, i) => (
            <MeetingRowSmall
              key={t.id}
              t={t}
              last={i === profile.meetings.length - 1}
            />
          ))}
          {profile.meetings.length === 0 && (
            <div style={{ padding: 24, color: W_TOKENS.textMuted, fontSize: 13 }}>
              暂无参与会议
            </div>
          )}
        </WCard>
      )}
    </section>
  );
}

function MemoryRow({ m, last }: { m: MemoryEntry; last: boolean }) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          color: W_TOKENS.textPrimary,
          lineHeight: 1.55,
        }}
      >
        {m.text}
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11.5,
          color: W_TOKENS.textMuted,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
            color: "#C4B5FD",
          }}
        >
          <WIcon name="link" size={11} stroke={2} color="#C4B5FD" />
          被引用 {m.cited} 次
        </span>
        <span>· 来源 {m.source}</span>
        <span>· 入库 {m.when}</span>
      </div>
    </div>
  );
}

function KBDocCard({ k }: { k: KnowledgeDoc }) {
  const TYPE_COLOR: Record<string, string> = {
    pdf: "#E5453A",
    word: "#2B579A",
    md: "#71717a",
    excel: "#1F7244",
    ppt: "#D24726",
  };
  const TYPE_LABEL: Record<string, string> = {
    pdf: "PDF",
    word: "Word",
    md: "MD",
    excel: "Excel",
    ppt: "PPT",
  };
  return (
    <WCard hover padding={14}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 42,
            height: 50,
            borderRadius: 6,
            flexShrink: 0,
            background: TYPE_COLOR[k.type] + "20",
            boxShadow: `inset 0 0 0 1px ${TYPE_COLOR[k.type]}40`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <WIcon name="doc" size={17} color={TYPE_COLOR[k.type]} stroke={1.6} />
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: TYPE_COLOR[k.type],
              letterSpacing: 0.3,
            }}
          >
            {TYPE_LABEL[k.type]}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: W_TOKENS.textPrimary,
              lineHeight: 1.35,
            }}
          >
            {k.name}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: W_TOKENS.textMuted,
              display: "flex",
              flexWrap: "wrap",
              gap: 7,
            }}
          >
            <span>{k.pages} 页</span>
            <span>· {k.chunks} 分块</span>
          </div>
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `0.5px solid ${W_TOKENS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
            }}
          >
            <span
              style={{
                color: "#7DDEFF",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <WIcon name="link" size={10} stroke={2} color="#7DDEFF" />
              被引用 {k.cited} 次
            </span>
            <span style={{ color: W_TOKENS.textFaint }}>{k.updated}</span>
          </div>
        </div>
      </div>
    </WCard>
  );
}

function MeetingRowSmall({ t, last }: { t: AgentMeeting; last: boolean }) {
  return (
    <Link
      href={`/workstation/meeting/${t.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: last ? "none" : `0.5px solid ${W_TOKENS.border}`,
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          background: "rgba(255,100,160,0.10)",
          boxShadow: "inset 0 0 0 0.5px rgba(255,100,160,0.30)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <WIcon name="cal" size={15} color={W_TOKENS.pink} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: W_TOKENS.textPrimary,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: W_TOKENS.textMuted,
            marginTop: 2,
          }}
        >
          {t.when} · 担任 {t.role}
        </div>
      </div>
      <span
        style={{
          color: "#C4B5FD",
          fontSize: 12,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        查看
        <WIcon name="arr-r" size={12} color="#C4B5FD" stroke={2.4} />
      </span>
    </Link>
  );
}

