/**
 * Sankey 血缘图 mock 数据 — round-6 R5.B-replace.
 *
 * 4 列: 书架 (KB) → AI 专家 → 长期记忆 → 会议
 *
 * **后端契约** (PM R6.5 拍板用新 path, 跟旧 /api/lineage 区分):
 *   POST /api/lineage/sankey
 *   → {
 *     nodes: [{ id, label, type: 'kb'|'agent'|'memory'|'meeting', meta? }],
 *     links: [{ source: id, target: id, value: number, kind?: string }]
 *   }
 *
 * value: 流量宽度 (引用次数 / 共享强度 / weighting)
 * 注意: ECharts 节点不传 id 字段 (会被当 display fallback), 用 name + 外部 idMap.
 *
 * R5.A scope: hardcode mock. 后端接好后切真实数据 (workspace_id 维度).
 */

import { W_AGENTS } from "./agents";

export type SankeyNodeType = "kb" | "agent" | "memory" | "meeting";

export type SankeyNode = {
  // ECharts 用 name 当 display + id, 所以这里不传 id 给 ECharts
  name: string;
  _internalId: string; // 内部 idMap key
  type: SankeyNodeType;
  itemStyle?: {
    color: string;
    borderColor?: string;
    borderWidth?: number;
  };
  label?: {
    color: string;
    fontSize?: number;
    fontWeight?: number;
  };
  meta?: {
    agentId?: string;
    pages?: number;
    chunks?: number;
    cited?: number;
    source?: string;
    when?: string;
    text?: string;
    updated?: string;
    attendees?: string[];
  };
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  kind?: string; // owns | has | cite (可选语义, ECharts 不用)
};

export type SankeyData = {
  nodes: SankeyNode[];
  links: SankeyLink[];
};

// 列色
export const C_KB = "#7DDEFF";
export const C_AGENT = "#C4B5FD";
export const C_MEM = "#A78BFA";
export const C_MEET = "#FF99B6";

const SANKEY_AGENTS = ["FALAO", "SHU", "ARIA", "STRATOS", "SAGE", "ZHAOJIE", "LEX", "TALLY"];

export function buildSankey(): SankeyData {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const seenNames = new Set<string>();
  const idMap: Record<string, string> = {};

  const addNode = (id: string, label: string, type: SankeyNodeType, color: string, meta?: SankeyNode["meta"]): string => {
    if (seenNames.has(label)) {
      idMap[id] = label;
      return label;
    }
    seenNames.add(label);
    idMap[id] = label;
    nodes.push({
      name: label,
      _internalId: id,
      type,
      itemStyle: { color, borderColor: "rgba(255,255,255,0.30)", borderWidth: 0.5 },
      label: { color: "#fafafc", fontSize: 11, fontWeight: 500 },
      meta,
    });
    return label;
  };

  SANKEY_AGENTS.forEach((agentId) => {
    const agent = W_AGENTS.find((a) => a.id === agentId);
    if (!agent) return;

    const agentColor = agent.grad ? agent.grad[1] : C_AGENT;
    const agentLabel = addNode("a-" + agentId, agent.name, "agent", agentColor, { agentId });

    // 种子知识 (KB → AI)
    const kbs = [
      { name: agent.name + "·种子知识 A", cited: 4, pages: 10, chunks: 6 },
      { name: agent.name + "·种子知识 B", cited: 3, pages: 8, chunks: 4 },
    ];
    kbs.forEach((kb) => {
      const kbLabel = addNode(
        "kb-" + agentId + "-" + kb.name,
        "📚 " + kb.name,
        "kb",
        C_KB,
        { pages: kb.pages, chunks: kb.chunks, cited: kb.cited },
      );
      links.push({ source: kbLabel, target: agentLabel, value: Math.max(2, kb.cited / 2), kind: "owns" });
    });

    // 沉淀经验 (AI → Memory)
    const mems = [
      { text: agent.name + " 沉淀经验 1", cited: 4, source: "种子", when: "初始化" },
      { text: agent.name + " 沉淀经验 2", cited: 3, source: "种子", when: "初始化" },
      { text: agent.name + " 沉淀经验 3", cited: 2, source: "种子", when: "初始化" },
    ];
    mems.forEach((m, i) => {
      const short = m.text.slice(0, 22) + (m.text.length > 22 ? "…" : "");
      const memLabel = addNode("m-" + agentId + "-" + i, "🧠 " + short, "memory", C_MEM, m);
      links.push({ source: agentLabel, target: memLabel, value: Math.max(2, m.cited / 2), kind: "has" });
    });
  });

  // 会议 (col 4) — cited memories
  const MEETINGS = [
    { id: "meet-1", label: "📅 Q3 路线图对齐", cites: ["m-STRATOS-0", "m-ARIA-0", "m-SAGE-1"] },
    { id: "meet-2", label: "📅 A/B 复盘 #4", cites: ["m-ARIA-0", "m-ARIA-1", "m-STRATOS-0"] },
    { id: "meet-3", label: "📅 数据合规风评", cites: ["m-FALAO-2", "m-LEX-0", "m-SHU-2"] },
    { id: "meet-4", label: "📅 Q1 投诉复盘", cites: ["m-SHU-0", "m-ZHAOJIE-1"] },
    { id: "meet-5", label: "📅 维修资金审议", cites: ["m-FALAO-0", "m-FALAO-1", "m-TALLY-0"] },
    { id: "meet-6", label: "📅 客户体验例会", cites: ["m-ZHAOJIE-0", "m-ZHAOJIE-1", "m-SAGE-0"] },
    { id: "meet-7", label: "📅 财务建模会", cites: ["m-TALLY-0", "m-TALLY-1", "m-ARIA-2"] },
    { id: "meet-8", label: "📅 法规更新会", cites: ["m-FALAO-2", "m-LEX-1"] },
  ];

  MEETINGS.forEach((meet) => {
    const meetLabel = addNode(meet.id, meet.label, "meeting", C_MEET);
    meet.cites.forEach((memId) => {
      const memLabel = idMap[memId];
      if (memLabel) {
        links.push({ source: memLabel, target: meetLabel, value: 2, kind: "cite" });
      }
    });
  });

  return { nodes, links };
}
