/**
 * 16 个 AI 专家 hardcode mock — 来自 round-5 设计稿 web-shared.jsx (PM R7 拍板).
 *
 * **R5.A scope**: hardcode 给首页 + 工作站骨架展示用.
 * **后续 Saga**: 接 backend workspace_agents 动态数据 (PM 已批准延后).
 *
 * `byMe: true` = 我管理的 AI (后续接 v1.3.1 后端时, 对应 `agent_owner_id === me`).
 *
 * **不要改 ID** — 跨页 (首页 / 工作站 / agent detail) 引用同一份 id.
 */
export type WAgent = {
  id: string;
  name: string;
  nick: string;
  domain: string;
  tags: string[];
  grad: [string, string]; // 头像渐变 [from, to]
  glyph: string;
  sum: number; // 召唤次数
  updated: string;
  byMe?: boolean;
  intro: string;
};

export const W_AGENTS: WAgent[] = [
  { id: "MIRA",    name: "Mira",     nick: "主持人",     domain: "会议主持",     tags: ["主持", "议程", "总结"], grad: ["#FFB340", "#FF9F0A"], glyph: "◎", sum: 142, updated: "今天", byMe: true, intro: "专长于推进议程、把控时间、复盘共识。出现在每一场会议里,默认开启。" },
  { id: "STRATOS", name: "Stratos",  nick: "战略官",     domain: "产品策略",     tags: ["路线图", "取舍", "优先级"], grad: ["#AF52DE", "#FF375F"], glyph: "◆", sum: 86,  updated: "昨天", byMe: true, intro: "资深产品策略顾问,从 OKR、市场、资源三个维度评估提案,擅长做高优先级取舍。" },
  { id: "ARIA",    name: "Aria",     nick: "数据师",     domain: "数据分析",     tags: ["A/B", "指标", "实验"], grad: ["#0A84FF", "#5E5CE6"], glyph: "⌬", sum: 124, updated: "今天", byMe: true, intro: "十年数据分析经验,会用统计语言回答,先给数字、再给区间、最后给行动建议。" },
  { id: "SHU",     name: "数小妙",   nick: "数据洞察",   domain: "数据 · 报表", tags: ["数据", "报表", "KPI"], grad: ["#5E5CE6", "#AF52DE"], glyph: "∑", sum: 96, updated: "5/23", intro: "物业行业资深数据分析师,善于从工单/费用/满意度数据中找出隐藏模式。回答时必先给数字,再分析。" },
  { id: "SAGE",    name: "Sage",     nick: "UX 顾问",    domain: "UX 设计",      tags: ["交互", "走查", "心智"], grad: ["#FF2D55", "#AF52DE"], glyph: "✦", sum: 64, updated: "昨天", intro: "看产品像看心智模型,擅长拆解用户的认知路径,给出 3 条对比建议而非答案。" },
  { id: "FALAO",   name: "法老张",   nick: "法规",       domain: "政策法规",     tags: ["法规", "合规", "政府文件"], grad: ["#FF9F0A", "#FF6482"], glyph: "⚖", sum: 52, updated: "5/22", intro: "你精通深圳市福田区物业管理相关法规,包括《物业管理条例》《业主大会议事规则》等。回答时先点出适用哪条法规,再给合规建议。" },
  { id: "TALLY",   name: "Tally",    nick: "财务建模",   domain: "财务 · 建模", tags: ["财务", "现金流", "成本"], grad: ["#64D2FF", "#0A84FF"], glyph: "¥", sum: 38, updated: "5/20", intro: "十年财务建模经验。任何决策都先看现金流影响,擅长用「乐观 / 中性 / 悲观」三档情景给你看清楚边界。" },
  { id: "ZHAOJIE", name: "服务赵姐", nick: "客服",       domain: "客户体验",     tags: ["客服", "理赔", "业主满意度"], grad: ["#FF6482", "#FF375F"], glyph: "♥", sum: 58, updated: "5/22", intro: "专长于售前售后客户服务与体验优化,语气耐心、同理心强。只回答客户咨询处理、投诉应对、续保提醒、理赔协助等问题。" },
  { id: "SCOUT",   name: "Scout",    nick: "竞品研究",   domain: "市场 · 竞品", tags: ["竞品", "调研", "客户访谈"], grad: ["#34C759", "#30B0C7"], glyph: "◈", sum: 42, updated: "5/19", intro: "专长于客户访谈纪要 + 竞品功能拆解。会前自动整理对方上次提到的诉求,会中提供事实型对比。" },
  { id: "LEX",     name: "Lex",      nick: "法务",       domain: "法务 · 合规", tags: ["合同", "风险", "隐私"], grad: ["#FFB340", "#FFB340"], glyph: "§", sum: 31, updated: "5/18", intro: '资深法务,擅长合同审阅、数据隐私合规、跨部门风险评估。先点出"风险等级",再给可执行的整改建议。' },
  { id: "CAIWANG", name: "财王哥",   nick: "财务核算",   domain: "财务 · 物业", tags: ["财务", "物业费", "维修资金"], grad: ["#22c55e", "#0A84FF"], glyph: "¥", sum: 28, updated: "5/17", intro: "你是物业财务主管,熟悉物业费收缴、公区水电分摊、维修资金管理。专攻应收率、收缴率、资金合规问题。" },
  { id: "YUNYING", name: "运营李",   nick: "物业运营",   domain: "运营 · SOP",  tags: ["运营", "SOP", "现场管理"], grad: ["#22c55e", "#22c55e"], glyph: "◐", sum: 23, updated: "5/16", intro: "经验丰富的物业项目经理,负责日常运营优化 + 对接业主诉求。回答用 SOP + 时间表,不用务虚。" },
  { id: "SIYU",    name: "私域王",   nick: "私域运营",   domain: "私域 · 社群",  tags: ["私域", "社群", "转化"], grad: ["#34C759", "#22c55e"], glyph: "◇", sum: 19, updated: "5/15", intro: "专长于微信生态内用户运营与转化,语气亲和、注重细节。只回答社群运营、朋友圈营销、1对1跟进、用户分层等私域问题。" },
  { id: "NEIRONG", name: "文小内",   nick: "内容创意",   domain: "内容创作",     tags: ["文案", "海报", "小红书"], grad: ["#FF375F", "#FF6482"], glyph: "✎", sum: 16, updated: "5/14", intro: "资深内容编辑,擅长把产品功能翻译成业主能秒懂的文案。给三版风格(克制/有趣/煽情)。" },
  { id: "BAOXIAN", name: "保险大刘", nick: "保险产品",   domain: "产品策略",     tags: ["保险", "理赔", "产品"], grad: ["#0A84FF", "#5E5CE6"], glyph: "⌘", sum: 14, updated: "5/13", intro: '保险产品策略师。会从精算 + 合规 + 营销三个角度看产品,擅长找产品定价里的"贴近真实"的部分。' },
  { id: "ZENGZHANG", name: "增长冯", nick: "获客增长",   domain: "用户增长",     tags: ["增长", "获客", "流量"], grad: ["#30B0C7", "#0A84FF"], glyph: "↗", sum: 12, updated: "5/12", intro: "专长于互联网流量获取与用户转化,语气务实、数据驱动。只回答线上获客渠道、投放策略、用户裂变、内容营销等增长问题。" },
];

export type WHuman = { name: string; color: string; initials: string };
export const W_HUMANS: Record<string, WHuman> = {
  ZK: { name: "周凯",  color: "#FF9F0A", initials: "周" },
  LM: { name: "林敏",  color: "#34C759", initials: "林" },
  WJ: { name: "王俊",  color: "#5E5CE6", initials: "王" },
  CY: { name: "陈宇",  color: "#FF375F", initials: "陈" },
  SL: { name: "苏蕾",  color: "#30B0C7", initials: "苏" },
  HR: { name: "Henry", color: "#AF52DE", initials: "H" },
  YQ: { name: "叶倩",  color: "#FF6482", initials: "叶" },
  TM: { name: "Tom",   color: "#0A84FF", initials: "T" },
  RB: { name: "Robin", color: "#64D2FF", initials: "R" },
};

// 当前登录用户 mock (后续接 v1.3.1 auth)
export const W_USER = {
  name: "Bluesurfire",
  email: "bluesurfiregpt@gmail.com",
  initials: "B",
  workspace: "默认工作空间",
  role: "workspace_creator" as const, // v1.3.1 角色名, 旧设计稿 "Owner" 改名
};

export const W_CATEGORIES = [
  { id: "all",        label: "全部" },
  { id: "data",       label: "数据 · 报表" },
  { id: "product",    label: "产品 · 策略" },
  { id: "compliance", label: "法规 · 合规" },
  { id: "cx",         label: "客户 · 服务" },
  { id: "finance",    label: "财务 · 建模" },
  { id: "ops",        label: "运营 · SOP" },
  { id: "content",    label: "内容 · 创意" },
  { id: "growth",     label: "增长 · 私域" },
] as const;

// category → matching domain substrings
const CAT_DOMAIN_MAP: Record<string, string[]> = {
  data:       ["数据"],
  product:    ["产品策略"],
  compliance: ["政策法规", "法务"],
  cx:         ["客户体验"],
  finance:    ["财务"],
  ops:        ["运营"],
  content:    ["内容创作"],
  growth:     ["私域", "用户增长"],
};

export function filterAgents(arr: WAgent[], catId: string): WAgent[] {
  if (catId === "all") return arr;
  const needles = CAT_DOMAIN_MAP[catId] || [];
  return arr.filter((a) => needles.some((n) => a.domain.includes(n)));
}

// 对话式发现的 3 个 preset
export type DiscoveryExample = {
  id: string;
  prompt: string;
  summary: string;
  agents: string[];
  agenda: { title: string; minutes: number }[];
  rationale: string;
};

export const W_DISCOVERY_EXAMPLES: DiscoveryExample[] = [
  {
    id: "roadmap",
    prompt: "Q3 路线图复盘,要决定协作功能是否进入这一季",
    summary: "Q3 路线图取舍会",
    agents: ["STRATOS", "ARIA", "SAGE"],
    agenda: [
      { title: "Q3 OKR 校准",         minutes: 8 },
      { title: "搜索 / 摘要 / 协作 三选二", minutes: 18 },
      { title: "行动项 & 责任人",     minutes: 5 },
    ],
    rationale: "Stratos 拆解取舍 → Aria 用 A/B 数据支撑 → Sage 从用户心智反推",
  },
  {
    id: "complaint",
    prompt: "Q1 投诉数据飙升,要找原因并定整改方案",
    summary: "Q1 投诉复盘会",
    agents: ["SHU", "ZHAOJIE", "YUNYING"],
    agenda: [
      { title: "总量 / 按楼栋分布 / 按分类拆解", minutes: 10 },
      { title: "客服一线反馈与典型投诉",         minutes: 12 },
      { title: "整改 SOP + 责任人 + 节点",     minutes: 8 },
    ],
    rationale: "数小妙先用数据指认抓手 → 服务赵姐补客户一线感受 → 运营李给可执行 SOP",
  },
  {
    id: "compliance",
    prompt: "业主敏感数据存储改造,涉及多部门",
    summary: "数据合规风险评估会",
    agents: ["FALAO", "LEX", "SHU"],
    agenda: [
      { title: "现状盘点 · 哪些表存哪些敏感字段", minutes: 12 },
      { title: "适用法规与最低改造范围",         minutes: 10 },
      { title: "排期 · 验收 · 责任人",          minutes: 8 },
    ],
    rationale: "法老张点出适用条款 → Lex 给跨部门风险等级 → 数小妙提供现状数据",
  },
];
