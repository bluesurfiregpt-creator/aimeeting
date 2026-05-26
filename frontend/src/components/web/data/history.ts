/**
 * 会议历史 mock 数据 — R6.X / round-6.
 *
 * 来自 round-6 设计稿 web-workstation.jsx HISTORY_MEETINGS.
 *
 * **后端契约** (PM R6.6 拍板, 复用现有 /api/meetings GET 加字段):
 *   每条 meeting 加:
 *     state: 'live' | 'done'
 *     decisions: number
 *     actions: number
 *     citations: number
 *     mems: number   // 新沉淀记忆数
 *
 * R5.A scope: hardcode mock. 后端加字段后切真实数据.
 */

export type WMeetingHistory = {
  id: string;
  title: string;
  sub: string;
  date: string;
  time: string;
  topic: string;
  state: "live" | "done";
  participants: string[]; // W_HUMANS id
  ais: string[]; // W_AGENTS id
  decisions: number;
  actions: number;
  citations: number;
  mems: number;
};

export const W_HISTORY_MEETINGS: WMeetingHistory[] = [
  {
    id: "q3-roadmap",
    title: "Q3 路线图对齐",
    sub: "产品组周会",
    date: "今天",
    time: "10:30 - 11:30",
    topic: "Q3 重点路线 · 协作功能取舍",
    state: "live",
    participants: ["ZK", "LM", "WJ", "CY", "SL"],
    ais: ["MIRA", "STRATOS", "ARIA"],
    decisions: 3,
    actions: 3,
    citations: 4,
    mems: 2,
  },
  {
    id: "standup",
    title: "早间 Standup",
    sub: "团队同步",
    date: "今天",
    time: "09:00 - 09:18",
    topic: "iOS 联调阻塞 · 详情页过场",
    state: "done",
    participants: ["ZK", "LM", "WJ", "CY", "SL", "HR", "YQ"],
    ais: ["MIRA", "ARIA"],
    decisions: 2,
    actions: 3,
    citations: 2,
    mems: 1,
  },
  {
    id: "data-compliance",
    title: "数据安全合规风评会",
    sub: "跨部门评审",
    date: "昨天",
    time: "15:00 - 16:30",
    topic: "业主敏感信息留存",
    state: "done",
    participants: ["ZK", "HR", "TM", "RB"],
    ais: ["MIRA", "LEX", "SHU"],
    decisions: 3,
    actions: 4,
    citations: 6,
    mems: 3,
  },
  {
    id: "ab-recap",
    title: "摘要模型 A/B 复盘",
    sub: "数据复盘",
    date: "5/22",
    time: "14:00 - 14:45",
    topic: "B 组延迟 vs 有用率",
    state: "done",
    participants: ["WJ", "CY"],
    ais: ["ARIA", "TALLY"],
    decisions: 1,
    actions: 2,
    citations: 3,
    mems: 1,
  },
  {
    id: "q1-complaints",
    title: "Q1 投诉复盘",
    sub: "运营复盘",
    date: "5/15",
    time: "10:00 - 11:00",
    topic: "单栋 + 单分类抓手",
    state: "done",
    participants: ["ZK", "SL", "YQ"],
    ais: ["MIRA", "SHU", "ZHAOJIE"],
    decisions: 2,
    actions: 5,
    citations: 4,
    mems: 2,
  },
  {
    id: "repair-fund",
    title: "维修资金审议会",
    sub: "合规评审",
    date: "5/12",
    time: "14:00 - 15:30",
    topic: "业主大会 2/3 同意议案",
    state: "done",
    participants: ["ZK", "TM"],
    ais: ["FALAO", "LEX", "TALLY"],
    decisions: 1,
    actions: 2,
    citations: 5,
    mems: 2,
  },
];
