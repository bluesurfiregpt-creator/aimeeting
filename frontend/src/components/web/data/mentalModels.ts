/**
 * 心智模型 strip + drill-through 数据 (mock, 跟 design handoff bundle 一致).
 *
 * 设计稿 reference: docs handoff `mental-strip.jsx` const DRILL.
 *
 * 暂时前端 mock — 等后端 `/api/v2/mental-models/overview` 出来再切换.
 * 每个节点 4 字段:
 *  - label / unit / count / accent  (header)
 *  - sub                            (一句话副标题)
 *  - breakdown                      (分类柱状)
 *  - recent                         (最近条目, 用于穿透)
 */

import type { WMentalIconId } from "../atoms/WMentalIcons";

export type MentalBreakdown = { tag: string; v: number };
export type MentalRecentItem = { name: string; meta: string; updated: string };

export type MentalNode = {
  id: WMentalIconId;
  label: string;
  unit: string;
  count: number;
  accent: string;
  sub: string;
  breakdown: MentalBreakdown[];
  recent: MentalRecentItem[];
  /** 跳转 slug — null 表示该节点不外跳 (eg 会议 是产出, 不跳一个独立 list) */
  slug: string | null;
};

export const MENTAL_NODES: Record<WMentalIconId, MentalNode> = {
  agents: {
    id: "agents",
    label: "AI 专家",
    unit: "位",
    count: 32,
    accent: "#A78BFA",
    sub: "在每场会议里 参与思考 · 你管理",
    slug: "agents",
    breakdown: [
      { tag: "产品策略", v: 5 },
      { tag: "数据分析", v: 4 },
      { tag: "UX 设计", v: 3 },
      { tag: "法务合规", v: 4 },
      { tag: "财务建模", v: 3 },
      { tag: "物业运营", v: 6 },
      { tag: "客户体验", v: 4 },
      { tag: "其他", v: 3 },
    ],
    recent: [
      { name: "Stratos", meta: "产品策略 · 出席 86 次", updated: "昨天" },
      { name: "Aria", meta: "数据分析 · 出席 124 次", updated: "今天" },
      { name: "法老张", meta: "政策法规 · 出席 52 次", updated: "5/22" },
      { name: "Sage", meta: "UX · 出席 64 次", updated: "昨天" },
    ],
  },
  kb: {
    id: "kb",
    label: "书架",
    unit: "本",
    count: 26,
    accent: "#64D2FF",
    sub: "需要时 AI 翻得到的资料 · RAG 召回",
    slug: "kb",
    breakdown: [
      { tag: "物业法规 PDF", v: 8 },
      { tag: "财务模板", v: 5 },
      { tag: "客户访谈纪要", v: 6 },
      { tag: "SOP / 手册", v: 4 },
      { tag: "产品文档", v: 3 },
    ],
    recent: [
      { name: "深圳市物业管理条例 v3.2.pdf", meta: "法老张 · 8.2 MB", updated: "5/22" },
      { name: "2025 物业费收缴 SOP.docx", meta: "运营李 · 1.4 MB", updated: "5/19" },
      { name: "业主访谈 Q2 合集.xlsx", meta: "Scout · 622 KB", updated: "5/15" },
      { name: "产品路线图 H2.md", meta: "Stratos · 88 KB", updated: "5/11" },
    ],
  },
  memory: {
    id: "memory",
    label: "经验",
    unit: "条",
    count: 100,
    accent: "#FFB36E",
    sub: "AI 已经 内化的事 · 自动调用",
    slug: "memory",
    breakdown: [
      { tag: "决策", v: 22 },
      { tag: "风险", v: 14 },
      { tag: "待办", v: 31 },
      { tag: "分歧", v: 9 },
      { tag: "客户偏好", v: 18 },
      { tag: "内部惯例", v: 6 },
    ],
    recent: [
      { name: "Q3 路线图优先放协作功能", meta: "决策 · STRATOS 提炼", updated: "昨天" },
      { name: "搜索结果页 chip 顺序优化", meta: "待办 · SAGE 跟进", updated: "今天" },
      { name: "业主对短信通知偏好高于推送", meta: "客户偏好 · SCOUT", updated: "5/22" },
      { name: "法规更新 24h 内回执", meta: "内部惯例 · FALAO", updated: "5/12" },
    ],
  },
  meet: {
    id: "meet",
    label: "会议",
    unit: "场",
    count: 21,
    accent: "#FF8A4C",
    sub: "产出 上面 两者 · 本月累计",
    slug: null,
    breakdown: [
      { tag: "产品 / 策略", v: 6 },
      { tag: "数据复盘", v: 4 },
      { tag: "法规对齐", v: 3 },
      { tag: "客户访谈", v: 4 },
      { tag: "财务评审", v: 2 },
      { tag: "其他", v: 2 },
    ],
    recent: [
      { name: "Q3 路线图对齐", meta: "6/02 14:00 · 8 人 + 3 AI", updated: "今天" },
      { name: "数据安全合规风险评估会", meta: "5/21 10:00 · 已闭环", updated: "6 天前" },
      { name: "业主访谈 #14", meta: "5/19 16:00 · 纪要已生成", updated: "5/19" },
      { name: "法规更新例会", meta: "5/12 09:30 · 已闭环", updated: "5/12" },
    ],
  },
};

export const MENTAL_NODE_ORDER: WMentalIconId[] = ["agents", "kb", "memory", "meet"];
