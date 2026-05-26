/**
 * R5.D Web 会议室 in-meeting mock 数据.
 *
 * 设计源: `/tmp/claude-design-round6-web/aimeeting/project/meeting-room-shared.jsx`
 *
 * **复用**: `W_AGENTS` / `W_HUMANS` (from data/agents.ts) — 不另起一份 AI 名单.
 * 这里只放 in-meeting 专属数据: 议程进度 / live transcript 流 / Mira 主持人当下.
 *
 * **后续 Saga E.E 接通 backend**:
 *  - GET /api/meetings/{id}/captions → 替换 MR_MESSAGES
 *  - GET /api/meetings/{id}/rounds → 替换 round-kind 消息
 *  - WS `meeting.phase` 推送 → 实时更新 currentAgendaId
 *
 * 跟 R5.B `W_MEETING_DETAIL` 字段呼应 (decision/action), 但 R5.B 是 post-meeting
 * 回看 (6 tabs); 这里是 in-meeting (live transcript + 控制).
 */

import { W_AGENTS, W_HUMANS, type WAgent, type WHuman } from "../data/agents";

// ────────────────── 类型 ──────────────────

export type MRAgendaItem = {
  id: number;
  title: string;
  state: "done" | "active" | "pending";
  minutes: number;
  remaining?: number; // 仅 active 用
};

export type MRMessageBase = { t: string };

export type MRHumanMessage = MRMessageBase & {
  kind: "human";
  who: string; // W_HUMANS key
  text: string;
  partial?: boolean;
  summon?: string; // W_AGENTS id — 唤醒了某专家
  askHost?: boolean;
  offTopic?: boolean;
};

export type MRDataRow = { label: string; v: string };

export type MRAIMessage = MRMessageBase & {
  kind: "ai";
  who: string; // W_AGENTS id
  body: string;
  data?: MRDataRow[];
  note?: string;
  actions?: string[];
  via?: { kind: "summon"; by: string } | { kind: "host" };
};

export type MRHostItem = { label: string; detail?: string; done?: boolean; loading?: boolean };
export type MRHostAction = { label: string; primary?: boolean; urgent?: boolean };

export type MRHostMessage = MRMessageBase & {
  kind: "host";
  tone: "agenda" | "drift-soft" | "drift" | "drift-strong" | "route" | "timer";
  title?: string;
  body?: string;
  items?: MRHostItem[];
  actions?: MRHostAction[];
  countdown?: string;
};

export type MRRoundExpert = {
  who: string; // W_AGENTS id
  stance: "support" | "caution" | "block";
  done: boolean;
  headline: string;
  summary: string;
  data?: MRDataRow[];
  note?: string;
};

export type MRRoundPoint = {
  stance: "support" | "caution" | "block";
  tag: string;
  text: string;
};

export type MRRoundMessage = MRMessageBase & {
  kind: "round";
  topic: string;
  trigger: { kind: "summon"; by: string };
  done: boolean;
  experts: MRRoundExpert[];
  miraSummary?: {
    verdict: string;
    conflict: boolean;
    points: MRRoundPoint[];
    recommendation: string;
  };
};

export type MRMessage = MRHumanMessage | MRAIMessage | MRHostMessage | MRRoundMessage;

// ────────────────── 出席真人 (in-meeting 状态) ──────────────────

export type MRHumanState = WHuman & { id: string; role: string; speaking: boolean; muted: boolean };

const MR_HUMAN_ROLES: Record<string, { role: string; speaking: boolean; muted: boolean }> = {
  ZK: { role: "PM",   speaking: false, muted: false },
  LM: { role: "设计", speaking: false, muted: false },
  WJ: { role: "工程", speaking: true,  muted: false },
  CY: { role: "工程", speaking: false, muted: false },
  SL: { role: "研究", speaking: false, muted: true  },
};

export const MR_HUMANS_IN_MEETING: Record<string, MRHumanState> = Object.fromEntries(
  Object.entries(MR_HUMAN_ROLES).map(([id, meta]) => {
    const base = W_HUMANS[id];
    if (!base) throw new Error(`MR_HUMANS_IN_MEETING: unknown human id ${id}`);
    return [id, { ...base, id, ...meta }];
  }),
);

// ────────────────── 出席 AI 专家 ──────────────────

export const MR_AI_IDS = ["ARIA", "STRATOS", "LEX", "SAGE"] as const;

export type MRAIId = (typeof MR_AI_IDS)[number];

export const MR_AGENTS_IN_MEETING: Record<string, WAgent & { roleShort: string }> = Object.fromEntries(
  MR_AI_IDS.map((id) => {
    const base = W_AGENTS.find((a) => a.id === id);
    if (!base) throw new Error(`MR_AGENTS_IN_MEETING: unknown agent id ${id}`);
    // 会议室 in-meeting 用 nick 当 role (短)
    const roleShort = id === "ARIA" ? "数据分析师"
                    : id === "STRATOS" ? "产品策略"
                    : id === "LEX" ? "法务合规"
                    : "UX 顾问";
    return [id, { ...base, roleShort }];
  }),
);

// ────────────────── 主持人 Mira ──────────────────

export const MR_HOST = {
  id: "MIRA",
  name: "Mira",
  role: "会议主持人",
  desc: "管议程 · 提醒走神 · 拆问题转给 AI 专家",
  grad: ["#FFB340", "#FF9F0A"] as [string, string],
};

// ────────────────── 议程 ──────────────────

export const MR_AGENDA: MRAgendaItem[] = [
  { id: 1, title: "Q3 OKR 校准",       state: "done",    minutes: 8 },
  { id: 2, title: "搜索模型 A/B 数据", state: "active",  minutes: 15, remaining: 6 },
  { id: 3, title: "协作功能优先级",     state: "pending", minutes: 8 },
  { id: 4, title: "行动项 & 责任人",    state: "pending", minutes: 5 },
];

// ────────────────── Live transcript ──────────────────

export const MR_MESSAGES: MRMessage[] = [
  {
    kind: "host", tone: "agenda", t: "23:02",
    title: "已切换议程",
    body: "议程 1「Q3 OKR 校准」完成 ✓ · 现在进入议程 2:搜索模型 A/B 数据",
  },
  {
    kind: "human", who: "WJ", t: "23:05",
    text: "我先抛个数。B 组(haiku-4.5 + 决策抽取)有用率比 A 高 11.4 个百分点,但延迟多了 380ms,这是上周末跑的 5000 条样本。",
  },
  {
    kind: "human", who: "CY", t: "23:06",
    text: "11 个点已经很大了,但 380ms 听起来不少。用户能感知到吗?",
  },
  {
    kind: "human", who: "WJ", t: "23:07", summon: "ARIA",
    text: "@Aria 帮我看下 P95 在 1.2 秒内的概率,以及当前 SLA 的余量。",
  },
  {
    kind: "ai", who: "ARIA", via: { kind: "summon", by: "WJ" }, t: "23:07",
    body: "P95 延迟分布(近 72 小时,B 组):",
    data: [
      { label: "1.0s 内", v: "73%" },
      { label: "1.2s 内", v: "87%" },
      { label: "1.5s 内", v: "96%" },
    ],
    note: "产品 SLA 是 P95 ≤ 1.5s,当前余量 9pp。建议把 B 组灰度到 20%,延迟可监控、可回滚。",
    actions: ["详细数据", "记入决策"],
  },
  {
    kind: "human", who: "SL", t: "23:09", offTopic: true,
    text: "说到这个 — 我们要不要也聊一下昨天 Hummingbird 客户访谈?他们对延迟其实挺敏感的…",
  },
  {
    kind: "host", tone: "drift-soft", t: "23:09",
    body: "苏蕾的发言偏离当前议程 · 持续观察中",
  },
  {
    kind: "human", who: "CY", t: "23:10", offTopic: true,
    text: "对,他们其实问了三次延迟。我顺便分享下他们用 Otter 那段经历,挺有意思的:他们之前…",
  },
  {
    kind: "host", tone: "drift", t: "23:10",
    title: "讨论持续偏离 · 已 1 分 30 秒",
    body: '"客户访谈"不在本议程内,当前议程「搜索模型 A/B」还剩 4 分钟。',
    actions: [
      { label: "记入待办", primary: true },
      { label: "改为当前议程" },
      { label: "再讨论 1 分钟" },
    ],
  },
  {
    kind: "human", who: "SL", t: "23:11", offTopic: true,
    text: "哦对,他们用 Otter 的时候说摘要太长,然后我们演示的时候 demo 就卡住了,后来 Tom 又…",
  },
  {
    kind: "host", tone: "drift-strong", t: "23:11",
    title: "议程将无法按时完成",
    body: "已连续偏离 2 分 40 秒。当前议程仅剩 2:30,这样下去 B 组灰度决策今天无法落地。",
    countdown: "02:30",
    actions: [
      { label: "立即记入待办,回到原议程", primary: true, urgent: true },
      { label: "议程顺延 5 分钟" },
    ],
  },
  {
    kind: "human", who: "ZK", t: "23:12", askHost: true,
    text: "好,先记入待办吧。@主持人 议程 2 顺延 10 分钟可以吗?顺便帮我问下:这个改动需要多少法务工作量。",
  },
  {
    kind: "host", tone: "route", t: "23:12",
    title: "已拆解周凯的两个请求",
    items: [
      { label: "议程 2 延长 10 分钟", detail: "议程 4 顺延,会议总时长 +10 分钟", done: true },
      { label: '"法务工作量" 转给 Lex', detail: "正在生成答复…", loading: true },
    ],
  },
  {
    kind: "ai", who: "LEX", via: { kind: "host" }, t: "23:13",
    body: "切到 B 组涉及一条隐私政策更新:",
    data: [
      { label: "隐私政策", v: "第 4.2 条" },
      { label: "工作量",   v: "约 2 人日" },
      { label: "前置依赖", v: "Henry 复核同意书 v1" },
    ],
    note: "建议跟下周隐私 review 一起发布,避免拆两次。",
    actions: ["插入会议纪要", "指派给 Henry"],
  },
  {
    kind: "human", who: "ZK", t: "23:13",
    text: "@Aria @Lex @Sage 数据法务都看过了,我想拍板把 B 组直接灰度到 20%。各位从自己的角度给一个综合评估,Mira 帮我汇总成 3 条。",
  },
  {
    kind: "round", t: "23:14",
    topic: "把 B 组灰度到 20%,可推进吗?",
    trigger: { kind: "summon", by: "ZK" },
    done: true,
    experts: [
      {
        who: "ARIA", stance: "support", done: true,
        headline: "数据支持 · 延迟在 SLA 内",
        summary: "B 组在 95% 置信下显著,P95 延迟 1.18s 仍在 1.5s SLA 内,有 9pp 余量;同时已具备自动降级开关。",
        data: [
          { label: "有用率",  v: "+11.4pp" },
          { label: "P95",     v: "1.18s"   },
          { label: "SLA 余量", v: "9pp"     },
        ],
        note: "若 P95 触发 1.5s 阈值,自动回 A 组,预案已就绪。",
      },
      {
        who: "LEX", stance: "caution", done: true,
        headline: "法务可推进 · 需同步隐私更新",
        summary: "灰度到 20% 触发隐私政策第 4.2 条更新(约 2 人日),建议与下周隐私 review 打包发布,避免用户多次接收变更通知。",
        data: [
          { label: "工作量", v: "2 人日"  },
          { label: "截止",   v: "6/3"     },
          { label: "风险",   v: "中"      },
        ],
        note: "单独发布更新可能引发额外问询;打包风险更可控。",
      },
      {
        who: "SAGE", stance: "support", done: true,
        headline: "UX 利好 · 用户对延迟容忍 > 预期",
        summary: "12 位访谈对象中,9 位对 1.5s 内延迟「基本无感」,11 位明显感受到摘要质量提升;NPS 较 A 组 +18。",
        data: [
          { label: "无感知延迟", v: "9/12"  },
          { label: "感知改善",   v: "11/12" },
          { label: "NPS Δ",     v: "+18"   },
        ],
        note: "正向感知量级大于负向延迟感知,放心切。",
      },
    ],
    miraSummary: {
      verdict: "可推进 · 注意法务节奏",
      conflict: false,
      points: [
        { stance: "support", tag: "数据", text: "置信内显著,SLA 内,有自动降级预案" },
        { stance: "caution", tag: "法务", text: "隐私 4.2 条需更新,建议与隐私 review 打包" },
        { stance: "support", tag: "UX",   text: "用户对延迟容忍度高于设计预期" },
      ],
      recommendation: "本周内 20% 灰度,与下周隐私 review 同步发布。Lex 起草隐私更新,Aria 监控降级开关。",
    },
  },
  {
    kind: "human", who: "WJ", t: "23:15", partial: true,
    text: "好的,那我先把灰度配置准备好,等",
  },
];

// ────────────────── 派生数据 ──────────────────

export type MRSpeakerKey = string; // "host" | W_HUMANS id | W_AGENTS id

export function mrSpeakerLabel(k: MRSpeakerKey): string {
  if (k === "host") return MR_HOST.name;
  if (MR_HUMANS_IN_MEETING[k]) return MR_HUMANS_IN_MEETING[k].name;
  if (MR_AGENTS_IN_MEETING[k]) return MR_AGENTS_IN_MEETING[k].name;
  return k;
}

export function mrSpeakerRole(k: MRSpeakerKey): string {
  if (k === "host") return MR_HOST.role;
  if (MR_HUMANS_IN_MEETING[k]) return MR_HUMANS_IN_MEETING[k].role;
  if (MR_AGENTS_IN_MEETING[k]) return MR_AGENTS_IN_MEETING[k].roleShort;
  return "";
}

export function mrMessageSpeakerKey(m: MRMessage): MRSpeakerKey {
  if (m.kind === "host") return "host";
  if (m.kind === "round") return "round";
  return m.who;
}

/** filter helper: 是否该消息在筛选选中集合里展示 */
export function mrMessageMatchesSelected(m: MRMessage, selected: Set<MRSpeakerKey>): boolean {
  if (selected.size === 0) return true;
  if (m.kind !== "round") return selected.has(mrMessageSpeakerKey(m));
  const keys: MRSpeakerKey[] = ["host", ...m.experts.map((e) => e.who)];
  return keys.some((k) => selected.has(k));
}

/** Round 消息: 在筛选激活时, 默认展开哪个 expert (第一个匹配的) */
export function mrRoundInitialOpen(m: MRRoundMessage, selected: Set<MRSpeakerKey>): string | null {
  if (selected.size === 0) return null;
  const e = m.experts.find((x) => selected.has(x.who));
  return e ? e.who : null;
}

/** AI 已发言统计: 用于左侧专家卡 + 顶部 ExpertPill */
export type MRAIUsage = {
  count: number;
  last: string | null;
};

export function getAIUsage(): Record<string, MRAIUsage> {
  const u: Record<string, MRAIUsage> = {};
  MR_AI_IDS.forEach((id) => {
    u[id] = { count: 0, last: null };
  });
  MR_MESSAGES.forEach((m) => {
    if (m.kind === "ai" && u[m.who]) {
      u[m.who].count += 1;
      u[m.who].last = m.body;
    }
    if (m.kind === "round") {
      m.experts.forEach((e) => {
        if (u[e.who]) {
          u[e.who].count += 1;
          u[e.who].last = e.headline;
        }
      });
    }
  });
  return u;
}

/** 时间线高光: agenda 切换 + drift + route + round */
export type MRHighlight = {
  idx: number;
  type: "agenda" | "drift" | "strong" | "route" | "round";
  icon: string;
  color: string;
  label: string;
  title: string;
  t: string;
};

export function getMRHighlights(): MRHighlight[] {
  const hl: MRHighlight[] = [];
  MR_MESSAGES.forEach((m, i) => {
    if (m.kind === "host") {
      if (m.tone === "agenda") {
        const match = (m.body || "").match(/议程\s*(\d+)\s*[:：](.+?)$/);
        hl.push({
          idx: i, type: "agenda", icon: "check", color: "#34C759",
          label: "议程切换",
          title: match ? match[2].trim() : (m.title || ""),
          t: m.t,
        });
      } else if (m.tone === "drift-strong") {
        hl.push({
          idx: i, type: "strong", icon: "compass", color: "#FF3B30",
          label: "强提醒", title: m.title || "", t: m.t,
        });
      } else if (m.tone === "drift") {
        hl.push({
          idx: i, type: "drift", icon: "compass", color: "#FF9F0A",
          label: "偏离提醒", title: m.title || "", t: m.t,
        });
      } else if (m.tone === "route") {
        hl.push({
          idx: i, type: "route", icon: "route", color: "#FF9F0A",
          label: "问题路由", title: m.title || "", t: m.t,
        });
      }
    } else if (m.kind === "round") {
      hl.push({
        idx: i, type: "round", icon: "sparkle", color: "#5E5CE6",
        label: `AI 圆桌 · ${m.experts.length} 位`,
        title: m.topic, t: m.t,
      });
    }
  });
  return hl;
}

/** 决策池 / 行动项 / parking lot / refs — 右侧栏 mock */
export const MR_DECISIONS = [
  { id: "d1", title: "Q3 协作功能延后到 Q4", source: "Stratos 建议", t: "23:01",
    status: "confirmed" as const, tag: "路线图" },
  { id: "d2", title: "议程 2 顺延 10 分钟,议程 4 同步顺延", source: "周凯 + Mira", t: "23:12",
    status: "confirmed" as const, tag: "议程" },
  { id: "d3", title: "B 组灰度到 20%(本周内启动)", source: "AI 圆桌 + Mira 综合", t: "23:14",
    status: "pending" as const, tag: "产品" },
];

export const MR_ACTIONS = [
  { id: "a1", title: "起草隐私政策 4.2 条更新", owner: "LEX",  due: "6/3",  source: "Lex 答复" },
  { id: "a2", title: "监控 B 组降级开关",       owner: "ARIA", due: "实时", source: "AI 圆桌" },
  { id: "a3", title: "复核同意书 v1",           owner: "HR",   due: "本周", source: "Lex 提请" },
  { id: "a4", title: "跟进 Hummingbird 反馈",   owner: "YQ",   due: "下周", source: "跑题转待办" },
];

export const MR_PARKING = [
  { id: "p1", title: "Hummingbird 延迟感受 / 客户访谈复盘", from: "SL", at: "23:09 偏离时记入" },
  { id: "p2", title: "Otter 摘要长度反馈与对标",           from: "CY", at: "23:10 偏离时记入" },
];

export const MR_REFS = [
  { kind: "doc" as const,  title: "PRD: 搜索体验 v3",       sub: "Linear · 王俊 维护" },
  { kind: "data" as const, title: "模型 A/B 实时看板",       sub: "Datadog · live" },
  { kind: "mtg" as const,  title: "上次会议:Q2 产品复盘",    sub: "5/10 · 1h 22m" },
];
