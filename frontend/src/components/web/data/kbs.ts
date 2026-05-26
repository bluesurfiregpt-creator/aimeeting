/**
 * 知识库 mock 数据 — R5.C.
 *
 * 来自 round-6 设计稿 web-workstation.jsx WS_KB, 扩展加文档列表 (mock modal 用).
 *
 * **R5.C scope**: hardcode mock 给 KbPane (KB 列表 + 文档详情 modal).
 * **后续 Saga**: 接 backend kb 表 + chunks API.
 */
export type WKBDoc = {
  id: string;
  name: string;
  type: "pdf" | "word" | "md" | "excel" | "txt" | "ppt";
  size: string;
  pages?: number;
  rows?: number;
  blocks: number;
  uploadedBy: string;       // W_HUMANS id
  uploadedWhen: string;
  citedTimes: number;
};

export type WKB = {
  id: string;
  name: string;
  sub: string;
  owner: string;            // W_AGENTS id
  docs: WKBDoc[];
  byMe?: boolean;
  updated: string;
};

export const W_KBS: WKB[] = [
  {
    id: "kb1",
    name: "福田 物业 法规 + SOP 知识库",
    sub: "[seed_property v1] 福田 物业 demo 用 — 含 深圳 物业 条例 / 维修 资金",
    owner: "FALAO",
    updated: "5/22",
    docs: [
      { id: "d1", name: "深圳市 物业管理条例 2024.pdf", type: "pdf", size: "1.8 MB", pages: 42, blocks: 1, uploadedBy: "ZK", uploadedWhen: "5/22", citedTimes: 18 },
      { id: "d2", name: "维修资金管理办法.pdf", type: "pdf", size: "920 KB", pages: 18, blocks: 1, uploadedBy: "ZK", uploadedWhen: "5/22", citedTimes: 7 },
      { id: "d3", name: "业主大会议事规则.docx", type: "word", size: "240 KB", pages: 12, blocks: 1, uploadedBy: "ZK", uploadedWhen: "5/22", citedTimes: 5 },
    ],
  },
  {
    id: "kb2",
    name: "客户服务体验官 · 种子知识库",
    sub: "由 AI 模板生成器 自动创建,管理人:待指派",
    owner: "ZHAOJIE",
    updated: "5/19",
    docs: [
      { id: "d4", name: "客户投诉应答 SOP v2.md", type: "md", size: "32 KB", blocks: 1, uploadedBy: "SL", uploadedWhen: "5/19", citedTimes: 3 },
    ],
  },
  {
    id: "kb3",
    name: "保险产品策略师 · 种子知识库",
    sub: "保险产品定价、合规 case 索引",
    owner: "BAOXIAN",
    updated: "5/18",
    docs: [
      { id: "d5", name: "保险定价模型 v3.xlsx", type: "excel", size: "2.4 MB", rows: 1240, blocks: 5, uploadedBy: "TM", uploadedWhen: "5/18", citedTimes: 12 },
      { id: "d6", name: "合规案例汇编.pdf", type: "pdf", size: "5.6 MB", pages: 86, blocks: 4, uploadedBy: "HR", uploadedWhen: "5/15", citedTimes: 8 },
      { id: "d7", name: "竞品产品对比.xlsx", type: "excel", size: "1.1 MB", rows: 256, blocks: 2, uploadedBy: "TM", uploadedWhen: "5/12", citedTimes: 4 },
      { id: "d8", name: "保险产品方案 v3.pptx", type: "ppt", size: "8.2 MB", pages: 38, blocks: 2, uploadedBy: "ZK", uploadedWhen: "5/10", citedTimes: 6 },
      { id: "d9", name: "精算手册.pdf", type: "pdf", size: "12 MB", pages: 124, blocks: 1, uploadedBy: "HR", uploadedWhen: "5/03", citedTimes: 9 },
    ],
  },
  {
    id: "kb4",
    name: "互联网获客增长官 · 种子知识库",
    sub: "渠道、漏斗、内容素材库",
    owner: "ZENGZHANG",
    byMe: true,
    updated: "5/20",
    docs: [
      { id: "d10", name: "获客渠道矩阵 v2.xlsx", type: "excel", size: "680 KB", rows: 88, blocks: 4, uploadedBy: "WJ", uploadedWhen: "5/20", citedTimes: 11 },
      { id: "d11", name: "投放策略手册.pdf", type: "pdf", size: "3.4 MB", pages: 56, blocks: 6, uploadedBy: "CY", uploadedWhen: "5/15", citedTimes: 7 },
      { id: "d12", name: "用户裂变案例.md", type: "md", size: "64 KB", blocks: 3, uploadedBy: "CY", uploadedWhen: "5/14", citedTimes: 4 },
      { id: "d13", name: "内容素材库.xlsx", type: "excel", size: "1.8 MB", rows: 420, blocks: 5, uploadedBy: "LM", uploadedWhen: "5/11", citedTimes: 5 },
      { id: "d14", name: "落地页 AB 报告.pdf", type: "pdf", size: "2.2 MB", pages: 24, blocks: 4, uploadedBy: "WJ", uploadedWhen: "5/08", citedTimes: 3 },
      { id: "d15", name: "社群运营 SOP.docx", type: "word", size: "180 KB", pages: 14, blocks: 0, uploadedBy: "SL", uploadedWhen: "5/05", citedTimes: 2 },
      { id: "d16", name: "邮件营销模板.txt", type: "txt", size: "48 KB", blocks: 0, uploadedBy: "WJ", uploadedWhen: "4/28", citedTimes: 1 },
    ],
  },
  {
    id: "kb5",
    name: "数据洞察 · 数小妙 知识库",
    sub: "KPI 字典 / 报表口径 / SQL 模板",
    owner: "SHU",
    byMe: true,
    updated: "5/24",
    docs: [
      { id: "d17", name: "KPI 字典 v4.xlsx", type: "excel", size: "440 KB", rows: 280, blocks: 6, uploadedBy: "WJ", uploadedWhen: "5/24", citedTimes: 24 },
      { id: "d18", name: "报表口径白皮书.pdf", type: "pdf", size: "1.6 MB", pages: 32, blocks: 8, uploadedBy: "WJ", uploadedWhen: "5/22", citedTimes: 19 },
      { id: "d19", name: "SQL 模板库.md", type: "md", size: "120 KB", blocks: 5, uploadedBy: "WJ", uploadedWhen: "5/20", citedTimes: 16 },
      { id: "d20", name: "经典数据案例.docx", type: "word", size: "520 KB", pages: 28, blocks: 4, uploadedBy: "CY", uploadedWhen: "5/18", citedTimes: 11 },
    ],
  },
  {
    id: "kb6",
    name: "财务建模 · Tally 知识库",
    sub: "现金流模板 / 三表勾稽 / 案例集",
    owner: "TALLY",
    byMe: true,
    updated: "5/21",
    docs: [
      { id: "d21", name: "现金流建模模板.xlsx", type: "excel", size: "2.8 MB", rows: 320, blocks: 6, uploadedBy: "TM", uploadedWhen: "5/21", citedTimes: 13 },
      { id: "d22", name: "三表勾稽白皮书.pdf", type: "pdf", size: "1.2 MB", pages: 22, blocks: 4, uploadedBy: "TM", uploadedWhen: "5/19", citedTimes: 9 },
    ],
  },
];
