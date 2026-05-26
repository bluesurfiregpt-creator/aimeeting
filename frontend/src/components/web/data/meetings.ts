/**
 * 会议详情 mock 数据 — R5.B-meeting.
 *
 * 来自 round-6 设计稿 `web-meeting-detail.jsx` MEETING_DETAIL.
 *
 * **R5.B scope**: 1 个真实会议 (`q3-roadmap`) 全字段 mock, 其他 W_HISTORY_MEETINGS
 * 里的 id 走 fallback (简化版 generic detail).
 *
 * **后端契约** (Saga E 后续接 backend 时):
 *   GET /api/meetings/:id → 此结构完整字段
 *   GET /api/meetings/:id/captions → 字幕列表 (分页)
 *
 * **Saga E.E (AI 圆桌真协同)**: caption 已有 `cites` 字段 + `kind: ai`, 给后续
 * 真协同时 AI 引用 KB / 记忆 留好 hooks. 见 SAGA-E-ai-capabilities-changelist.md.
 */
export type MCaption = {
  t: string; // "10:30:08"
  who: string; // W_HUMANS id 或 W_AGENTS id
  kind: "human" | "ai" | "ai-host";
  agenda?: number;
  text: string;
  cites?: MCaptionCite[];
};

export type MCaptionCite = {
  kind: "kb" | "memory";
  id: string;
  text: string;
  label: string;
};

export type MDecision = {
  id: string;
  title: string;
  by: string; // W_HUMANS id
  when: string;
  from?: string;
};

export type MAction = {
  id: string;
  text: string;
  assignee: string; // W_HUMANS id
  due: string;
  from?: string; // decision id
};

export type MMaterial = {
  id: string;
  name: string;
  type: "pdf" | "word" | "md" | "excel" | "ppt";
  size: string;
  pages?: number;
  rows?: number;
  by: string;
  when: string;
  pre: boolean;
  cited: number;
};

export type MAgenda = {
  id: number;
  title: string;
  minutes: number;
  done: boolean;
};

export type WMeetingDetail = {
  id: string;
  title: string;
  sub: string;
  date: string;
  time: string;
  duration: string;
  status: "live" | "done";
  topic: string;
  agenda: MAgenda[];
  participants: string[];
  ais: string[];
  summary: string;
  summaryStats: {
    decisions: number;
    actions: number;
    citations: number;
    memoriesCreated: number;
  };
  decisions: MDecision[];
  actions: MAction[];
  materials: MMaterial[];
  captions: MCaption[];
};

export const W_MEETING_DETAIL: WMeetingDetail = {
  id: "q3-roadmap",
  title: "Q3 路线图对齐",
  sub: "产品组周会",
  date: "2026/5/25",
  time: "10:30 - 11:30",
  duration: "60 分钟",
  status: "done",
  topic: "Q3 重点路线 · 协作功能取舍",
  agenda: [
    { id: 1, title: "Q3 OKR 校准", minutes: 8, done: true },
    { id: 2, title: "搜索模型 A/B 数据", minutes: 18, done: true },
    { id: 3, title: "协作功能 是否进入 Q3", minutes: 25, done: true },
    { id: 4, title: "行动项 & 责任人", minutes: 9, done: true },
  ],
  participants: ["ZK", "LM", "WJ", "CY", "SL"],
  ais: ["MIRA", "STRATOS", "ARIA"],
  summary:
    "团队对齐 Q3 路线图。基于 STRATOS 取舍论证 + ARIA A/B 数据,决定:① 协作功能延后到 Q4;② B 组摘要模型灰度 20% 流量;③ Q3 主线 = 搜索体验 + 智能摘要。会议产出 3 个决策 + 3 个行动项,触发了 4 次 AI 引用 + 2 条新长期记忆。",
  summaryStats: { decisions: 3, actions: 3, citations: 4, memoriesCreated: 2 },
  decisions: [
    { id: "d1", title: "协作功能延后到 Q4", by: "ZK", when: "11:05", from: "STRATOS 建议" },
    { id: "d2", title: "B 组摘要模型灰度 20% 流量", by: "ZK", when: "10:48", from: "ARIA 数据支撑" },
    { id: "d3", title: "Q3 主线 = 搜索体验 + 智能摘要", by: "ZK", when: "11:08", from: "共识" },
  ],
  actions: [
    { id: "a1", text: "完成 B 组灰度脚本", assignee: "WJ", due: "5/30", from: "d2" },
    { id: "a2", text: "确认搜索新版 chip 顺序", assignee: "LM", due: "6/3" },
    { id: "a3", text: "与 Sage 同步搜索结果页 v5", assignee: "CY", due: "5/29" },
  ],
  materials: [
    {
      id: "f1", name: "Q3 路线图 — 提案 v3.pptx", type: "ppt",
      size: "6.8 MB", pages: 18, by: "ZK", when: "昨天 22:18", pre: true, cited: 6,
    },
    {
      id: "f2", name: "搜索模型 A/B 实验报告.pdf", type: "pdf",
      size: "2.4 MB", pages: 12, by: "WJ", when: "今天 09:42", pre: true, cited: 4,
    },
    {
      id: "f3", name: "5000 条样本数据.xlsx", type: "excel",
      size: "1.1 MB", rows: 5012, by: "WJ", when: "10:38", pre: false, cited: 1,
    },
  ],
  captions: [
    {
      t: "10:30:08", who: "MIRA", kind: "ai-host", agenda: 1,
      text: "议程 1:Q3 OKR 校准 — 8 分钟。请林敏先快速过下 Q1/Q2 完成情况。",
    },
    {
      t: "10:30:35", who: "LM", kind: "human", agenda: 1,
      text: "Q1 完成度 92%,Q2 80%,主要差距在协作功能 ETA 延期。",
    },
    {
      t: "10:31:42", who: "ZK", kind: "human", agenda: 1,
      text: "所以我们要复盘协作功能是否进入 Q3。今天必须给一个结论。",
    },
    {
      t: "10:32:10", who: "STRATOS", kind: "ai", agenda: 1,
      text: "我建议协作功能延后到 Q4。Q3 单独打透搜索 + 摘要两条主线 — 历史数据上每多一条主线 ETA 会滑 18%。",
      cites: [
        {
          kind: "memory",
          id: "STRATOS_M1",
          text: "Q1 协作功能延期主要因为同时开三条线,资源 spread 太薄",
          label: "历史记忆",
        },
      ],
    },
    {
      t: "10:38:14", who: "WJ", kind: "human", agenda: 2,
      text: "我刚把 5000 样本数据传到资料里。@Aria 看下能不能给个结论。",
    },
    {
      t: "10:38:50", who: "ARIA", kind: "ai", agenda: 2,
      text: "在 5000 样本上 B 组有用率 +11.4pp,95% 置信显著。P95 延迟 1.18s,仍在 1.5s SLA 内 — 可以灰度。",
      cites: [
        {
          kind: "kb",
          id: "ARIA_K1",
          text: '"A/B 测试方法手册 v4" 第 3 章关于 P95 SLA 边界',
          label: "书架",
        },
        {
          kind: "memory",
          id: "ARIA_M2",
          text: "样本量 < 1000 时,t 检验比 z 检验更稳健 — 此处 N=5000,使用 z 检验",
          label: "历史记忆",
        },
      ],
    },
    {
      t: "10:42:30", who: "CY", kind: "human", agenda: 2,
      text: "搜索新版的 chip 顺序我下周和 Sage 同步一下,争取周五前确认。",
    },
    {
      t: "10:48:22", who: "ZK", kind: "human", agenda: 2,
      text: "行,B 组灰度 20% 通过。@王俊 5/30 前完成脚本。",
    },
    {
      t: "10:48:30", who: "MIRA", kind: "ai-host", agenda: 2,
      text: "已记录决策:B 组摘要模型灰度 20% 流量,负责人 王俊,5/30。",
    },
    {
      t: "11:05:18", who: "STRATOS", kind: "ai", agenda: 3,
      text: "OK 那我重申:协作功能延后到 Q4。资源集中后 Q3 主线交付确定性更高。",
      cites: [
        {
          kind: "memory",
          id: "STRATOS_M1",
          text: "同 10:32 的资源 spread 推论",
          label: "历史记忆",
        },
      ],
    },
    {
      t: "11:05:40", who: "ZK", kind: "human", agenda: 3,
      text: "同意,协作功能延后到 Q4 — 拍板。",
    },
    {
      t: "11:08:05", who: "MIRA", kind: "ai-host", agenda: 4,
      text: "Q3 主线确认:搜索体验 + 智能摘要。已记入决策 3 个 / 行动 3 个。",
    },
  ],
};

/**
 * 拉平所有 caption 里的 AI 引用 — 用于 CitationsPane.
 *
 * 每条 citation 包含:
 *  - t: 时间戳
 *  - ai: AI id
 *  - agenda: 议程号
 *  - said: AI 当时说的话 (全文)
 *  - source: 引用源 (kb / memory)
 */
export type MCitation = {
  t: string;
  ai: string;
  agenda?: number;
  said: string;
  source: MCaptionCite;
};

export function getMeetingCitations(m: WMeetingDetail): MCitation[] {
  return m.captions
    .filter((c) => c.cites && c.cites.length > 0)
    .flatMap((c) =>
      (c.cites || []).map((src) => ({
        t: c.t,
        ai: c.who,
        agenda: c.agenda,
        said: c.text,
        source: src,
      })),
    );
}
