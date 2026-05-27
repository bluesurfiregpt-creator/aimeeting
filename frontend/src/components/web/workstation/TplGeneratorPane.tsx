"use client";

/**
 * AI 模板生成器 — R5.B (round-6).
 *
 * 4 步 LLM 拆解流程:
 *  1. 用户输入 (textarea) 或选 preset (3 个: 物业 / SaaS / 律所)
 *  2. LLM 拆解 (mock 5-step thinking 动画, 间隔 420ms)
 *  3. 提案 (3-4 位 AI 专家卡 + 种子知识 + 种子记忆, 可展开/收起/排除)
 *  4. 创建 (sticky bottom bar, 显示入选数 + "创建 N 位 AI" CTA)
 *
 * 数据源:
 *  - 3 个 preset 全字段 mock (来自 round-6 设计稿 TPL_PRESETS)
 *  - 自由输入按关键字模糊匹配 preset (SaaS/产品/增长 → SaaS; 律/合同/合规 → 律所; else → 物业)
 *
 * **R5.B scope**: UI 优先, mock LLM call (setTimeout 2200ms). 后端契约见 Saga E.B.
 *
 * 创建按钮 mock confirm (实际不写数据库).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { W_TOKENS } from "../tokens";
import { WIcon, WPill, WButton, WAIBadge, WSparkle } from "../atoms";
import { PaneHeader } from "./PaneHeader";

// ════════════════════════════════════════════
// PRESETS (3 realistic scenarios with curated teams)
// ════════════════════════════════════════════

type SeedKB = {
  name: string;
  type: "pdf" | "word" | "md" | "excel";
  pages: number;
};

type ProposedAgent = {
  name: string;
  nick: string;
  domain: string;
  glyph: string;
  grad: [string, string];
  tags: string[];
  intro: string;
  seedKB: SeedKB[];
  seedMem: string[];
};

type TplPreset = {
  id: string;
  prompt: string;
  summary: string;
  rationale: string;
  agents: ProposedAgent[];
};

const TPL_PRESETS: TplPreset[] = [
  {
    id: "property",
    prompt: "我们是物业管理公司,需要 AI 协助处理业主投诉、维修资金动用、跨部门合规整改。",
    summary: "物业管理 · 4 位团队",
    rationale: "物业场景三大痛点:业主沟通 / 数据驱动 / 法规合规 — 各配一名 AI 主理,再加一名跨部门主持人。",
    agents: [
      {
        name: "业主沟通官", nick: "Sora", domain: "客户服务 · 投诉处理",
        glyph: "♥", grad: ["#FF6482", "#FF375F"],
        tags: ["投诉", "沟通", "同理心"],
        intro: "专长于业主投诉一线响应。语气耐心、同理心强,先共情再解决。回答时必给\"3 步标准动作 + 预计耗时\",不空谈。",
        seedKB: [
          { name: "业主投诉 SOP 手册 v2", type: "pdf", pages: 18 },
          { name: "常见纠纷应答模板 (60 例)", type: "word", pages: 24 },
          { name: "12345 工单升级流程", type: "md", pages: 6 },
        ],
        seedMem: [
          "面对情绪激动的业主,先共情 30 秒再讲方案。",
          "工单超时的\"投诉密度\"比\"总量\"更有指示意义。",
          "赠送服务到期前 7 天主动告知,投诉率下降 60%。",
        ],
      },
      {
        name: "数小妙", nick: "数据洞察", domain: "数据 · 报表 · KPI",
        glyph: "∑", grad: ["#5E5CE6", "#AF52DE"],
        tags: ["数据", "报表", "看板"],
        intro: "物业行业资深数据分析师,善于从工单/费用/满意度数据中找出隐藏模式。回答时必先给数字,再分析。",
        seedKB: [
          { name: "物业行业数据字典 v3", type: "pdf", pages: 24 },
          { name: "KPI 设计 SOP", type: "word", pages: 8 },
          { name: "SQL 查询模板库", type: "md", pages: 12 },
        ],
        seedMem: [
          "Q1 投诉同比上升时,优先看单栋 + 单分类异常集中。",
          "收缴率不到 85% 的小区,先排查物业费定价。",
          "KPI 看板每月 15 号自动出。",
        ],
      },
      {
        name: "法老张", nick: "法规合规", domain: "法规 · 合规 · 政府文件",
        glyph: "⚖", grad: ["#FF9F0A", "#FF6482"],
        tags: ["法规", "维修资金", "业主大会"],
        intro: "精通深圳市福田区物业管理相关法规。回答时先点出适用哪条法规,再给合规建议。",
        seedKB: [
          { name: "深圳市物业管理条例 (2024)", type: "pdf", pages: 56 },
          { name: "业主大会议事规则模板", type: "word", pages: 12 },
          { name: "住宅专项维修资金管理办法", type: "pdf", pages: 28 },
        ],
        seedMem: [
          "业主大会通过专项资金动用需达到 2/3 业主同意。",
          "紧急维修(电梯/消防)可先动用维修资金后补程序。",
          "法规更新涉及多部门时,先产出对齐摘要再上会。",
        ],
      },
      {
        name: "Mira", nick: "主持人", domain: "会议主持 · 跨域协调",
        glyph: "◎", grad: ["#FFB340", "#FF9F0A"],
        tags: ["主持", "议程", "复盘"],
        intro: "专长于推进议程、把控时间、复盘共识。出现在每一场会议里,默认开启。",
        seedKB: [{ name: "会议主持 SOP", type: "md", pages: 4 }],
        seedMem: ["议程超时 20% 时主动提示。", "决策需在会上拍板,不挂账。"],
      },
    ],
  },
  {
    id: "saas",
    prompt: "我是 SaaS 创业团队的产品经理,需要 AI 协助做产品策略、A/B 实验、用户增长。",
    summary: "SaaS 产品组 · 3 位团队",
    rationale: "产品 → 数据 → 增长 是 SaaS 产品组的黄金三角。三位 AI 各司其职,会议中互相补位。",
    agents: [
      {
        name: "Stratos", nick: "战略官", domain: "产品策略 · 路线图",
        glyph: "◆", grad: ["#AF52DE", "#FF375F"],
        tags: ["路线图", "取舍", "优先级"],
        intro: "资深产品策略顾问,从 OKR、市场、资源三个维度评估提案,擅长做高优先级取舍。",
        seedKB: [
          { name: "PM 入门 (Marty Cagan)", type: "pdf", pages: 64 },
          { name: "北极星指标设计", type: "word", pages: 14 },
          { name: "产品路线图模板", type: "md", pages: 8 },
        ],
        seedMem: [
          "同时开三条主线,ETA 每条会滑 18%。",
          "路线图取舍先看 RICE,再看叙事。",
          "资源不够时砍范围,不砍质量。",
        ],
      },
      {
        name: "Aria", nick: "数据师", domain: "数据 · A/B · 实验",
        glyph: "⌬", grad: ["#0A84FF", "#5E5CE6"],
        tags: ["A/B", "统计", "因果"],
        intro: "十年数据分析经验。用统计语言回答,先给数字、再给区间、最后给行动建议。",
        seedKB: [
          { name: "A/B 测试方法手册 v4", type: "pdf", pages: 48 },
          { name: "统计显著性 cheatsheet", type: "md", pages: 6 },
          { name: "因果推断入门 (Pearl)", type: "pdf", pages: 62 },
        ],
        seedMem: [
          "样本量 < 1000 时,t 检验比 z 检验更稳健。",
          "P 值 < 0.05 不代表\"重要\",还要看 effect size。",
          "增长实验失败的占 70%,先定 stop loss。",
        ],
      },
      {
        name: "Vega", nick: "增长官", domain: "增长 · 获客 · 漏斗",
        glyph: "↗", grad: ["#30B0C7", "#0A84FF"],
        tags: ["增长", "漏斗", "内容"],
        intro: "专长于互联网流量获取与用户转化,数据驱动、务实风格。只回答线上获客渠道、投放策略、内容营销等增长问题。",
        seedKB: [
          { name: "北美 SaaS 增长案例库", type: "pdf", pages: 36 },
          { name: "PLG 漏斗设计模板", type: "word", pages: 12 },
          { name: "AARRR 模型实操", type: "md", pages: 10 },
        ],
        seedMem: [
          "PLG 产品先看激活率,再看付费率。",
          "内容营销 ROI 至少 3 个月起算。",
          "渠道分散不如集中打透一个。",
        ],
      },
    ],
  },
  {
    id: "lawfirm",
    prompt: "我们是中型律所,需要 AI 帮助做合同审阅、案例研究、企业合规咨询。",
    summary: "律所 · 3 位团队",
    rationale: "合同 / 案例 / 合规 是律所三大产品。各配一名 AI 专家,可独立工作也可联会。",
    agents: [
      {
        name: "Lex", nick: "合同审阅", domain: "合同 · 合规 · 风险",
        glyph: "§", grad: ["#FFB340", "#FF9F0A"],
        tags: ["合同", "风险", "隐私"],
        intro: "资深法务,擅长合同审阅。先点出\"风险等级\",再给可执行的整改建议。",
        seedKB: [
          { name: "商事合同标准条款库", type: "word", pages: 42 },
          { name: "数据隐私合规清单", type: "pdf", pages: 18 },
          { name: "常见合同陷阱 100 例", type: "pdf", pages: 56 },
        ],
        seedMem: [
          "不限责任条款是最高风险,必须高亮提示。",
          "管辖法院条款被忽略时,默认按合同签订地。",
          "电子签章在企业间合同有效,需保留 timestamp。",
        ],
      },
      {
        name: "Casey", nick: "案例研究", domain: "案例 · 判例 · 检索",
        glyph: "✦", grad: ["#FF2D55", "#AF52DE"],
        tags: ["判例", "检索", "类案"],
        intro: "擅长找类案 + 判例摘要。回答先给 3-5 条最相关判例 + 一句关键裁判要点。",
        seedKB: [
          { name: "最高法商事判例集 2020-2024", type: "pdf", pages: 88 },
          { name: "类案检索方法论", type: "md", pages: 12 },
        ],
        seedMem: ["类案优先看同级法院近 3 年的。", "裁判要点比全文摘要更重要。"],
      },
      {
        name: "Cipher", nick: "隐私合规", domain: "隐私 · GDPR · 个保法",
        glyph: "⌘", grad: ["#0A84FF", "#5E5CE6"],
        tags: ["GDPR", "个保法", "数据出境"],
        intro: "专攻数据隐私合规。先点出适用法规(GDPR / 个保法 / CCPA),再给合规路径。",
        seedKB: [
          { name: "个人信息保护法逐条解读", type: "pdf", pages: 48 },
          { name: "GDPR 实施细则", type: "pdf", pages: 96 },
          { name: "数据出境安全评估办法", type: "word", pages: 16 },
        ],
        seedMem: [
          "收集敏感个信前必须取得\"单独同意\"。",
          "数据出境路径分 3 种:CAC 评估 / 标准合同 / 认证。",
          "个保法处罚上限是营业额 5%。",
        ],
      },
    ],
  },
];

// ════════════════════════════════════════════
// MAIN PANE
// ════════════════════════════════════════════
type Stage = "idle" | "thinking" | "result";

export function TplGeneratorPane() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<"new" | "augment">("new");
  const [result, setResult] = useState<TplPreset | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const trigger = (preset: TplPreset) => {
    setPrompt(preset.prompt);
    setStage("thinking");
    setResult(null);
    setExcluded(new Set());
    setExpanded(new Set([0]));
    setTimeout(() => {
      setResult(preset);
      setStage("result");
    }, 2200);
  };

  const submit = () => {
    if (!prompt.trim()) return;
    const lower = prompt.toLowerCase();
    let pick = TPL_PRESETS[0];
    if (
      lower.includes("saas") ||
      lower.includes("产品") ||
      lower.includes("增长")
    ) {
      pick = TPL_PRESETS[1];
    } else if (
      lower.includes("律") ||
      lower.includes("合同") ||
      lower.includes("合规")
    ) {
      pick = TPL_PRESETS[2];
    }
    trigger({ ...pick, prompt });
  };

  const reset = () => {
    setStage("idle");
    setResult(null);
    setExcluded(new Set());
  };

  // Sprint 3 Web W2: TplGenerator 暂 mock (Sprint 4 接 LLM preview/commit endpoint).
  // backend api.previewAgentTemplate/commitAgentTemplate 已在, frontend setTimeout 2.2s
  // 模拟 LLM 拆解 — 加 demo pill 提示客户.
  const demoBadge = (
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
      演示数据 · LLM 拆解待接
    </span>
  );

  return (
    <>
      <PaneHeader
        title="AI 模板生成器"
        sub="描述你的场景 — LLM 帮你拆解能力 → 配置 N 位 AI 专家 → 自动挂上种子知识与种子记忆。"
        extra={demoBadge}
      />

      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 16,
          background: W_TOKENS.surface,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 16px 40px rgba(0,0,0,0.30)`,
          marginBottom: stage === "result" ? 24 : 0,
        }}
      >
        <div
          style={{
            height: 2,
            background: W_TOKENS.accentGrad,
            opacity: 0.85,
          }}
        />

        <div
          style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 280,
            height: 280,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,92,250,0.18) 0%, rgba(0,0,0,0) 65%)",
            pointerEvents: "none",
          }}
        />
        <WSparkle x={42} y={20} size={10} opacity={0.8} />
        <WSparkle x={86} y={50} size={6} opacity={0.55} />

        <div
          style={{
            padding: "18px 22px 0",
            display: "flex",
            alignItems: "center",
            gap: 10,
            position: "relative",
          }}
        >
          <WAIBadge id="MIRA" size={28} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: W_TOKENS.textPrimary,
              }}
            >
              告诉我你的团队 / 场景 / 问题 — Mira 帮你拆出 AI 专家阵容
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: W_TOKENS.textMuted,
                marginTop: 1,
              }}
            >
              人格 · 关键词 · 种子知识 · 种子记忆 — 一次生成,可逐条微调
            </div>
          </div>
          {stage === "result" && (
            <WButton variant="ghost" size="sm" onClick={reset}>
              重新开始
            </WButton>
          )}
        </div>

        <div style={{ padding: "14px 22px 0", position: "relative" }}>
          <div
            style={{
              background: W_TOKENS.bg,
              borderRadius: 12,
              boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="例如:我们是物业管理公司,需要 AI 协助处理业主投诉、维修资金、合规法务..."
              style={{
                width: "100%",
                minHeight: 100,
                resize: "none",
                padding: "14px 16px",
                border: "none",
                background: "transparent",
                color: W_TOKENS.textPrimary,
                fontSize: 15,
                lineHeight: 1.55,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                padding: "6px 12px 10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontSize: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <span style={{ color: W_TOKENS.textMuted }}>
                    期望专家数
                  </span>
                  <div style={{ display: "inline-flex", gap: 3 }}>
                    {[2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setCount(n)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          border: "none",
                          background:
                            count === n
                              ? "rgba(124,92,250,0.18)"
                              : "transparent",
                          boxShadow:
                            count === n
                              ? "inset 0 0 0 0.5px rgba(124,92,250,0.40)"
                              : "none",
                          color:
                            count === n ? "#C4B5FD" : W_TOKENS.textMuted,
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: "inherit",
                          cursor: "pointer",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <span style={{ color: W_TOKENS.textMuted }}>模式</span>
                  {(
                    [
                      { id: "new" as const, label: "全新" },
                      { id: "augment" as const, label: "增补现有" },
                    ]
                  ).map((mm) => (
                    <button
                      key={mm.id}
                      type="button"
                      onClick={() => setMode(mm.id)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "none",
                        background:
                          mode === mm.id
                            ? "rgba(124,92,250,0.18)"
                            : "transparent",
                        boxShadow:
                          mode === mm.id
                            ? "inset 0 0 0 0.5px rgba(124,92,250,0.40)"
                            : `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                        color:
                          mode === mm.id
                            ? "#C4B5FD"
                            : W_TOKENS.textSecondary,
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {mm.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: W_TOKENS.textFaint,
                    alignSelf: "center",
                  }}
                >
                  ⌘ Enter 生成
                </span>
                <WButton
                  variant="primary"
                  size="md"
                  icon="sparkle"
                  iconRight="arr-r"
                  onClick={submit}
                >
                  生成团队
                </WButton>
              </div>
            </div>
          </div>

          {stage === "idle" && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 14,
                marginBottom: 4,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 11.5,
                  color: W_TOKENS.textMuted,
                }}
              >
                灵感场景:
              </span>
              {TPL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => trigger(p)}
                  style={{
                    padding: "6px 11px",
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(255,255,255,0.04)",
                    boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
                    color: W_TOKENS.textSecondary,
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "all 140ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(124,92,250,0.10)";
                    e.currentTarget.style.color = "#C4B5FD";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255,255,255,0.04)";
                    e.currentTarget.style.color = W_TOKENS.textSecondary;
                  }}
                >
                  <WIcon name="sparkle" size={11} stroke={2} />
                  {p.summary}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px 22px" }}>
          {stage === "thinking" && <ThinkingPanel />}
        </div>
      </div>

      {stage === "result" && result && (
        <ResultPanel
          result={result}
          excluded={excluded}
          setExcluded={setExcluded}
          expanded={expanded}
          setExpanded={setExpanded}
          onCreated={() => router.push("/workstation/agents")}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════
// THINKING PANEL — 5-step animated
// ════════════════════════════════════════════
function ThinkingPanel() {
  const STEPS = [
    { label: "理解你的场景与目标", sub: "提取关键业务名词 · 识别痛点" },
    { label: "拆解所需能力", sub: "映射到 N 个互补的专家角色" },
    { label: "为每位专家生成人格 + 标签", sub: "语气、风格、回答习惯" },
    { label: "挂上种子知识(书架)", sub: "基础文档 + 流程 SOP" },
    {
      label: "注入种子记忆(经验)",
      sub: "关键事实 + 实操经验,AI 启动即懂",
    },
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStep((s) => Math.min(STEPS.length - 1, s + 1)),
      420,
    );
    return () => clearInterval(t);
  }, [STEPS.length]);

  return (
    <div
      style={{
        borderTop: `0.5px solid ${W_TOKENS.border}`,
        paddingTop: 16,
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 12.5,
          color: "#C4B5FD",
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#C4B5FD",
            animation: "wPulse 1.2s ease-in-out infinite",
          }}
        />
        Mira 正在拆解…
      </div>
      {STEPS.map((s, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "7px 0",
          }}
        >
          {i < step ? (
            <span style={dotDone}>
              <WIcon name="check" size={10} color="#fff" stroke={3} />
            </span>
          ) : i === step ? (
            <span style={dotActive}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#C4B5FD",
                  animation: "wPulse 0.9s ease-in-out infinite",
                }}
              />
            </span>
          ) : (
            <span style={dotIdle} />
          )}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                color: i <= step ? W_TOKENS.textPrimary : W_TOKENS.textFaint,
                transition: "color 200ms ease",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: i <= step ? W_TOKENS.textMuted : W_TOKENS.textFaint,
                marginTop: 2,
                transition: "color 200ms ease",
              }}
            >
              {s.sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const dotDone = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: W_TOKENS.success,
  marginTop: 2,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  flexShrink: 0,
};
const dotActive = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "rgba(124,92,250,0.20)",
  boxShadow: "inset 0 0 0 1.5px #C4B5FD",
  marginTop: 2,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  flexShrink: 0,
};
const dotIdle = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  boxShadow: `inset 0 0 0 1px ${W_TOKENS.border}`,
  marginTop: 2,
  display: "inline-flex" as const,
  flexShrink: 0,
};

// ════════════════════════════════════════════
// RESULT PANEL
// ════════════════════════════════════════════
function ResultPanel({
  result,
  excluded,
  setExcluded,
  expanded,
  setExpanded,
  onCreated,
}: {
  result: TplPreset;
  excluded: Set<number>;
  setExcluded: (s: Set<number>) => void;
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  onCreated: () => void;
}) {
  const included = result.agents.filter((_, i) => !excluded.has(i));
  const totalKB = included.reduce((s, a) => s + a.seedKB.length, 0);
  const totalMem = included.reduce((s, a) => s + a.seedMem.length, 0);

  const toggleEx = (i: number) => {
    const n = new Set(excluded);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setExcluded(n);
  };
  const toggleExp = (i: number) => {
    const n = new Set(expanded);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setExpanded(n);
  };

  const onCreate = () => {
    if (included.length === 0) return;
    // mock confirm — 后续接 backend POST /api/agent-templates/instantiate
    if (
      typeof window !== "undefined" &&
      window.confirm(
        `确定创建 ${included.length} 位 AI?\n种子文档 ${totalKB} 份, 种子记忆 ${totalMem} 条。\n\n(R5.B UI demo, 实际后端 Saga E 后续接通.)`,
      )
    ) {
      onCreated();
    }
  };

  return (
    <>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 14,
          marginBottom: 16,
          background:
            "linear-gradient(135deg, #15102f 0%, #1c1538 50%, #251a40 100%)",
          boxShadow:
            "0 10px 28px rgba(124,92,250,0.22), inset 0 0 0 0.5px rgba(124,92,250,0.20)",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 11,
          animation: "wFadeIn 280ms ease",
          animationFillMode: "forwards",
        }}
      >
        <WSparkle x={32} y={10} size={10} opacity={0.85} />
        <WSparkle x={82} y={36} size={6} opacity={0.55} />
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            flexShrink: 0,
            background: "rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.20)",
          }}
        >
          <WIcon name="sparkle" size={16} color="#fff" stroke={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Mira · 团队提案 · {result.summary}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.85)",
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            {result.rationale}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, paddingRight: 4 }}>
          <Stat label="入选" value={included.length} color="#C4B5FD" />
          <Stat label="种子知识" value={totalKB} color={W_TOKENS.cyan} />
          <Stat label="种子记忆" value={totalMem} color="#FF99B6" />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {result.agents.map((a, i) => (
          <ProposedAgentCard
            key={i}
            a={a}
            idx={i}
            excluded={excluded.has(i)}
            expanded={expanded.has(i)}
            onToggleExclude={() => toggleEx(i)}
            onToggleExpand={() => toggleExp(i)}
          />
        ))}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 5,
          marginTop: 18,
          padding: "14px 16px",
          background: "rgba(13,13,28,0.80)",
          backdropFilter: "blur(16px)",
          borderRadius: 14,
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.borderHover}, 0 -8px 24px rgba(0,0,0,0.30)`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: 13,
            color: W_TOKENS.textSecondary,
            minWidth: 240,
          }}
        >
          <span
            style={{ color: W_TOKENS.textPrimary, fontWeight: 600 }}
          >
            {included.length}
          </span>
          /{result.agents.length} 位入选 · 创建后会自动入库{" "}
          <span style={{ color: W_TOKENS.cyan }}>{totalKB}</span> 文档 +
          <span style={{ color: "#C4B5FD" }}> {totalMem}</span> 记忆
        </div>
        <WButton variant="ghost" size="md" icon="sparkle">
          重新生成
        </WButton>
        <WButton
          variant="primary"
          size="md"
          iconRight="arr-r"
          disabled={included.length === 0}
          onClick={onCreate}
        >
          创建 {included.length} 位 AI
        </WButton>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.55)",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.5,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// PROPOSED AGENT CARD
// ════════════════════════════════════════════
function ProposedAgentCard({
  a,
  idx,
  excluded,
  expanded,
  onToggleExclude,
  onToggleExpand,
}: {
  a: ProposedAgent;
  idx: number;
  excluded: boolean;
  expanded: boolean;
  onToggleExclude: () => void;
  onToggleExpand: () => void;
}) {
  const TYPE_COLOR: Record<string, string> = {
    pdf: "#E5453A",
    word: "#2B579A",
    md: "#71717a",
    excel: "#1F7244",
  };

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        background: W_TOKENS.surface,
        boxShadow: `inset 0 0 0 0.5px ${excluded ? W_TOKENS.border : W_TOKENS.borderHover}`,
        opacity: excluded ? 0.45 : 1,
        transition: "opacity 200ms ease",
        animation: "wFadeIn 320ms ease",
        animationFillMode: "forwards",
        animationDelay: `${idx * 80}ms`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, ${a.grad[0]}, ${a.grad[1]})`,
        }}
      />

      <div
        style={{
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            boxShadow: `0 4px 14px ${a.grad[1]}40`,
          }}
        >
          {a.glyph}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: W_TOKENS.textPrimary,
                letterSpacing: -0.2,
              }}
            >
              {a.name}
            </span>
            {a.nick && a.nick !== a.name && (
              <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>
                · {a.nick}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: W_TOKENS.textMuted }}>
              · {a.domain}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            {a.tags.map((t) => (
              <WPill key={t} tone="neutral">
                {t}
              </WPill>
            ))}
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 13, paddingRight: 6 }}
        >
          <MiniStat
            label="种子知识"
            value={a.seedKB.length}
            color={W_TOKENS.cyan}
          />
          <MiniStat
            label="种子记忆"
            value={a.seedMem.length}
            color="#C4B5FD"
          />
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={onToggleExpand}
            title={expanded ? "收起" : "展开"}
            style={iconBtnSm}
          >
            <WIcon
              name="chev-d"
              size={14}
              color={W_TOKENS.textMuted}
              stroke={2}
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 160ms ease",
              }}
            />
          </button>
          <button type="button" title="重新生成" style={iconBtnSm}>
            <WIcon
              name="sparkle"
              size={13}
              color={W_TOKENS.textMuted}
              stroke={2}
            />
          </button>
          <button
            type="button"
            onClick={onToggleExclude}
            title={excluded ? "加回" : "不要这个"}
            style={iconBtnSm}
          >
            <span
              style={{
                fontSize: 16,
                color: excluded ? "#86EFAC" : "#FCA5A5",
                lineHeight: 1,
              }}
            >
              {excluded ? "+" : "×"}
            </span>
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: `0.5px solid ${W_TOKENS.border}`,
            padding: "16px 18px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 18,
          }}
        >
          <div>
            <SubLabel color="#C4B5FD">人格设定</SubLabel>
            <div
              style={{
                marginTop: 7,
                fontSize: 12.5,
                color: W_TOKENS.textPrimary,
                lineHeight: 1.6,
              }}
            >
              &ldquo;{a.intro}&rdquo;
            </div>
          </div>

          <div>
            <SubLabel color={W_TOKENS.cyan}>种子知识 · 书架</SubLabel>
            <div
              style={{
                marginTop: 7,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {a.seedKB.map((kb, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 9px",
                    borderRadius: 7,
                    background: "rgba(100,210,255,0.06)",
                    boxShadow:
                      "inset 0 0 0 0.5px rgba(100,210,255,0.20)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: "1px 4px",
                      borderRadius: 3,
                      background: TYPE_COLOR[kb.type] || "#71717a",
                      color: "#fff",
                      letterSpacing: 0.3,
                    }}
                  >
                    {kb.type.toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: W_TOKENS.textPrimary,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {kb.name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: W_TOKENS.textMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {kb.pages}p
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SubLabel color="#FF99B6">种子记忆 · 经验</SubLabel>
            <div
              style={{
                marginTop: 7,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {a.seedMem.map((mem, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    padding: "6px 9px",
                    borderRadius: 7,
                    background: "rgba(196,181,253,0.06)",
                    boxShadow:
                      "inset 0 0 0 0.5px rgba(196,181,253,0.20)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: "#C4B5FD",
                      fontWeight: 700,
                      lineHeight: "14px",
                      width: 14,
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: W_TOKENS.textPrimary,
                      lineHeight: 1.5,
                    }}
                  >
                    {mem}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.4,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: W_TOKENS.textMuted,
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SubLabel({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        letterSpacing: 0.5,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

const iconBtnSm = {
  width: 28,
  height: 28,
  borderRadius: 7,
  border: "none",
  background: "rgba(255,255,255,0.04)",
  boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  cursor: "pointer",
  fontFamily: "inherit",
};
