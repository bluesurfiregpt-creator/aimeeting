/**
 * 长期记忆 mock 数据 — R5.C.
 *
 * 来自 round-6 设计稿 web-workstation.jsx WS_MEM, 扩展到 ~10 条 + 增加 cited / scope 字段.
 *
 * **R5.C scope**: hardcode mock 给 MemoryPane (列表 + filter).
 * **后续 Saga**: 接 backend memories 表.
 */
export type WMemoryScope = "项目" | "合规" | "流程" | "决策";

export type WMemory = {
  id: string;
  text: string;
  ai: string;            // W_AGENTS id (归属 AI)
  scope: WMemoryScope;
  when: string;
  source: string;        // 来源 (会议名 / 手工)
  citedTimes: number;    // 被引用次数
  byAuto: boolean;       // 是否 AI 自动入库 (vs 手工)
};

export const W_MEMORIES: WMemory[] = [
  {
    id: "m1",
    text: "处理跨部门合规整改时,必须先确认现有 Excel/Word 等离散存储里的业主敏感信息,再排期整改,防止漏点引发 12345 投诉。",
    ai: "SHU", scope: "项目", when: "2026/5/20",
    source: "数据安全合规风评会", citedTimes: 7, byAuto: true,
  },
  {
    id: "m2",
    text: "Q1 投诉同比上升时,优先看单栋 + 单分类异常集中 — 比看总量更易找出抓手。",
    ai: "SHU", scope: "项目", when: "2026/5/15",
    source: "Q1 投诉复盘", citedTimes: 12, byAuto: true,
  },
  {
    id: "m3",
    text: "赠送的增值服务(如体检)需提前告知有效期和使用方式,否则到期纠纷会进入售后红线。",
    ai: "ZHAOJIE", scope: "项目", when: "2026/5/14",
    source: "客户体验例会", citedTimes: 4, byAuto: true,
  },
  {
    id: "m4",
    text: "法规更新涉及多部门时,先由法老张产出对齐摘要,各部门 24h 内回执,再统一上会。",
    ai: "FALAO", scope: "流程", when: "2026/5/12",
    source: "法规更新例会", citedTimes: 5, byAuto: true,
  },
  {
    id: "m5",
    text: "会议录音默认保留 90 天;外部客户会议需在邀请中显著告知并提供导出。",
    ai: "LEX", scope: "合规", when: "2026/5/08",
    source: "与法务对齐", citedTimes: 9, byAuto: false,
  },
  {
    id: "m6",
    text: "B 组延迟 +320ms 但有用率 +11.4pp 显著,P95 仍在 SLA 内 — 灰度到 20% 是合理选择。",
    ai: "ARIA", scope: "决策", when: "2026/5/22",
    source: "A/B 复盘", citedTimes: 6, byAuto: true,
  },
  {
    id: "m7",
    text: "维修资金 议案需 2/3 业主同意,业委会先行公示 ≥7 天再上会。",
    ai: "FALAO", scope: "合规", when: "2026/5/12",
    source: "维修资金审议会", citedTimes: 3, byAuto: true,
  },
  {
    id: "m8",
    text: "Q1 协作功能延期主要因为同时开三条线,资源 spread 太薄 — 每多一条主线 ETA 滑 18%。",
    ai: "STRATOS", scope: "决策", when: "2026/5/25",
    source: "Q3 路线图对齐", citedTimes: 8, byAuto: true,
  },
  {
    id: "m9",
    text: "样本量 < 1000 时,t 检验比 z 检验更稳健 — 大样本 (>1000) 可改 z。",
    ai: "ARIA", scope: "流程", when: "2026/4/28",
    source: "数据方法论梳理", citedTimes: 11, byAuto: false,
  },
  {
    id: "m10",
    text: "物业费收缴率低于 80% 时,优先做单户回访 + 短信 push,而非全员公告。",
    ai: "CAIWANG", scope: "项目", when: "2026/4/22",
    source: "物业费回收专题", citedTimes: 2, byAuto: true,
  },
];

export const MEMORY_SCOPES: WMemoryScope[] = ["项目", "合规", "流程", "决策"];
