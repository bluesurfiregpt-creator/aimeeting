/**
 * v1.3.0 · Saga · mobile-app-r4-A · today 页 mock data.
 *
 * [TD-NEW: today 决策 + 今天会议 mock]
 * 设计稿: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx 数据段
 *
 * 当前 backend GET /api/m/workbench 只返回:
 *   - ongoing_meetings (进行中)
 *   - pending (等你处理)
 *   - todays_insights (今日 AI 智囊)
 *
 * 但设计稿 today 页要求 4 段:
 *   ✓ Mira 早间简报 (greeting + brief) — 后端无字段, 用 mock
 *   ✓ Live meeting (single) — 走 backend ongoing_meetings[0] (有则显)
 *   ✓ Today snapshot (4 stat) — 走 backend count
 *   ✓ Tab "会议视角":
 *     - 等你处理 → backend pending (有数据)
 *     - 今天会议 4 张 horizontal — 含 done/upcoming, 后端 ongoing_meetings 不全, 用 mock
 *     - AI 智囊 → backend todays_insights (有数据)
 *     - 今天的决策 → 后端 无, 用 mock
 *   ✓ Tab "专家视角" — 6 个固定 AI, hardcode mock (设计稿同)
 *
 * Saga B/C 时 backend 补 today_meetings + today_decisions 接口, 再切.
 */

import type { MockAiId, MockHumanId } from "@/components/mobile/shared/avatars";

export const MA_TODAY = {
  date: "2026 年 5 月 25 日 · 周一",
  greetingTime: "上午",
  todayBrief:
    "今天 3 场会,其中 Q3 路线图 是关键。已为你提取昨天遗留的 4 个未决议题,Mira 建议优先在 10:30 的会上拍板「协作功能是否进入 Q3」。",
};

export type MockMeetingState = "live" | "upcoming" | "done";

export type MockMeetingT = {
  id: string;
  title: string;
  sub: string;
  state: MockMeetingState;
  time: string;
  timeLabel: string;
  duration?: number;
  elapsed?: number;
  startsIn?: string;
  participants: MockHumanId[];
  ais: MockAiId[];
  topic: string;
  miraNote?: string;
  insightCount?: number;
  materials?: number;
  decisionCount?: number;
  actionCount?: number;
};

export const MA_MEETINGS: MockMeetingT[] = [
  {
    id: "m1",
    title: "Q3 路线图对齐",
    sub: "产品组周会",
    state: "live",
    time: "10:30 - 11:30",
    timeLabel: "进行中 · 已 23 分",
    duration: 60,
    elapsed: 23,
    participants: ["ZK", "LM", "WJ", "CY", "SL"],
    ais: ["STRATOS", "ARIA"],
    topic: "Q3 重点路线 · 协作功能取舍",
    miraNote: "Mira 已记录 12 个关键点 · 3 个待你确认",
    insightCount: 7,
    materials: 3,
  },
  {
    id: "m2",
    title: "搜索体验评审 #4",
    sub: "设计走查",
    state: "upcoming",
    time: "14:00 - 14:45",
    timeLabel: "14:00 开始 · 还有 2h 18m",
    startsIn: "2h 18m",
    participants: ["LM", "WJ"],
    ais: ["SAGE"],
    topic: "搜索结果页 v5 · chip 顺序",
    miraNote: "Sage 已预读 Henry 上传的视觉稿,准备了 3 条对比意见",
    materials: 2,
  },
  {
    id: "m3",
    title: "与客户:Hummingbird 反馈",
    sub: "客户访谈",
    state: "upcoming",
    time: "16:30 - 17:30",
    timeLabel: "16:30 开始",
    startsIn: "5h 0m",
    participants: ["ZK", "SL"],
    ais: ["SCOUT"],
    topic: "上线后第一周反馈",
    miraNote: "Scout 整理了对方上次提到的 6 条诉求,会前 10 分钟会推送给你",
    materials: 1,
  },
  {
    id: "m4",
    title: "早间 Standup",
    sub: "团队同步",
    state: "done",
    time: "09:00 - 09:18",
    timeLabel: "已结束 · 09:00",
    participants: ["ZK", "LM", "WJ", "CY", "SL"],
    ais: ["ARIA"],
    topic: "iOS 联调阻塞 · 详情页过场",
    decisionCount: 2,
    actionCount: 3,
  },
];

// Note: MIRA / SHU / FALAO / ZHAOJIE 不在 MOCK_AIS 类型集合内 (那个仅 bundle 6 个 Aria/Stratos/Lex/Sage/Tally/Scout),
// 所以上面 MA_MEETINGS.ais 仅放 bundle 6 个; 设计稿里 host MIRA 是单独以 hostAvatar 显示, 不进 AI 栈.
// today 页 ExpertView 需要展示 6 + 本地 3 = 9 个 (含 SHU/FALAO/ZHAOJIE), 用下面 MA_EXPERTS 单独 hardcode.

export type DecisionT = {
  id: string;
  title: string;
  source: string;
  when: string;
  by: MockHumanId;
};

export const MA_DECISIONS: DecisionT[] = [
  {
    id: "d1",
    title: "本周联调阻塞由王俊接管",
    source: "早间 Standup · 09:18",
    when: "今天 09:18",
    by: "ZK",
  },
  {
    id: "d2",
    title: "详情页过场动画方案二被采纳",
    source: "早间 Standup · 09:18",
    when: "今天 09:18",
    by: "LM",
  },
];

// ─── ExpertView 用的 mock data ───
// 设计稿 ExpertView 列 9 位专家 (6 bundle + 3 本地化 SHU/FALAO/ZHAOJIE).
// hardcode 在这里, 不进 shared/avatars (那是 mock-only namespace, 6 个 bundle).

export type ExpertEntry = {
  id: string;
  name: string;
  role: string;
  grad: [string, string];
  glyph: string;
  sub: string;
  activity: string;
  recent: string[];
  meetingCount: number;
  taskCount: number;
};

export const MA_EXPERTS: ExpertEntry[] = [
  {
    id: "FALAO",
    name: "法老张",
    role: "法规 · 合规",
    grad: ["#FF9F0A", "#FF6482"],
    glyph: "⚖",
    sub: "法规 · 合规 · 政府文件 · 政策法规",
    activity: "3 天前",
    recent: [
      "5/22 开发会议",
      "5/15 与住房建设与土地整备 AI 专家的对话",
      "5/8 数据安全合规风险评估会",
    ],
    meetingCount: 3,
    taskCount: 0,
  },
  {
    id: "SHU",
    name: "数小妙",
    role: "数据 · KPI",
    grad: ["#5E5CE6", "#AF52DE"],
    glyph: "∑",
    sub: "数据 · 报表 · KPI · 数据洞察",
    activity: "今天",
    recent: ["今天 Q3 路线图", "昨天 数据合规风评会", "5/15 Q1 投诉复盘"],
    meetingCount: 3,
    taskCount: 2,
  },
  {
    id: "ZHAOJIE",
    name: "服务赵姐",
    role: "客户体验",
    grad: ["#FF6482", "#FF375F"],
    glyph: "♥",
    sub: "投诉 · 沟通 · 业主满意度 · 客户服务",
    activity: "3 天前",
    recent: ["5/22 客户体验例会", "5/12 增值服务评审"],
    meetingCount: 2,
    taskCount: 0,
  },
  {
    id: "STRATOS",
    name: "Stratos",
    role: "产品策略",
    grad: ["#AF52DE", "#FF375F"],
    glyph: "◆",
    sub: "产品策略 · 路线图 · 取舍",
    activity: "15 分钟前",
    recent: ["今天 Q3 路线图", "上周 产品组周会"],
    meetingCount: 2,
    taskCount: 1,
  },
  {
    id: "ARIA",
    name: "Aria",
    role: "数据分析师",
    grad: ["#0A84FF", "#5E5CE6"],
    glyph: "⌬",
    sub: "A/B · 指标 · 实验设计",
    activity: "18 分钟前",
    recent: ["今天 Q3 路线图", "5/22 A/B 复盘"],
    meetingCount: 4,
    taskCount: 1,
  },
  {
    id: "SAGE",
    name: "Sage",
    role: "UX 顾问",
    grad: ["#FF2D55", "#AF52DE"],
    glyph: "✦",
    sub: "UX · 视觉走查 · 用户心智",
    activity: "昨天",
    recent: ["昨天 搜索体验 #3", "5/18 设计周会"],
    meetingCount: 2,
    taskCount: 1,
  },
];

/** 用 YYYY-MM-DD 周一 中文格式渲染 (本地时间). */
export function formatTodayDate(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const weekIdx = d.getDay(); // 0 = 周日
  const weeks = ["日", "一", "二", "三", "四", "五", "六"];
  return `${yyyy} 年 ${mm} 月 ${dd} 日 · 周${weeks[weekIdx]}`;
}

/** 早 / 上午 / 中午 / 下午 / 晚上. */
export function formatGreetingTime(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "凌晨";
  if (h < 11) return "上午";
  if (h < 13) return "中午";
  if (h < 18) return "下午";
  return "晚上";
}
