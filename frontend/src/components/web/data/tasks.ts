/**
 * 我的任务 mock 数据 — R5.C.
 *
 * 来自 round-6 设计稿 web-workstation.jsx WS_TASKS, 扩展到 ~14 条 (覆盖 4 列 kanban).
 *
 * **R5.C scope**: hardcode mock 给 BoardPane (kanban 4 列) + TasksPane (列表三段).
 * **后续 Saga**: 接 backend tasks 表 (PM 已批准延后).
 */
import type { WPillTone } from "../atoms";

export type WTaskState = "todo" | "tracking" | "review" | "done";
export type WTaskPriority = "high" | "mid" | "low";

export type WTask = {
  id: string;
  state: WTaskState;
  priority?: WTaskPriority;
  title: string;
  source: string;        // 来源 (会议名 / 跨部门 / 客户)
  sourceAI?: string;     // W_AGENTS id, 派任务的 AI
  assignee?: string;     // W_HUMANS id (默认 = 当前用户)
  due: string;           // 截止 (人类可读)
  dueTone?: WPillTone;
  detail?: string;       // 任务详情 (mock modal 展示)
};

export const W_TASKS: WTask[] = [
  // — todo (等你处理)
  {
    id: "t1", state: "todo", priority: "high",
    title: "拍板「协作功能是否进入 Q3」",
    source: "Q3 路线图对齐", sourceAI: "STRATOS",
    due: "今天 11:30 前", dueTone: "danger",
    detail: "STRATOS 给的判断:目前资源 spread 太薄,建议延后 Q4。需要你在 11:30 之前确认。"
  },
  {
    id: "t2", state: "todo", priority: "mid",
    title: "审核 Sage 的搜索结果页 chip 顺序意见",
    source: "搜索体验评审 #4", sourceAI: "SAGE",
    due: "今天 14:00 前", dueTone: "warn",
    detail: "Sage 建议把主题/时间/参与人 chip 调到前 3 位,理由是用户搜索时优先想看这些维度。"
  },
  {
    id: "t3", state: "todo", priority: "mid",
    title: "回复 Hummingbird 关于摘要长度的疑问",
    source: "客户访谈", sourceAI: "SCOUT",
    due: "今天", dueTone: "neutral",
    detail: "客户反馈摘要太长 (~600 字),希望默认 ≤300 字。需要回复一个折中方案。"
  },
  {
    id: "t4", state: "todo", priority: "low",
    title: "整理 Q2 客户访谈纪要 → 知识库",
    source: "客户访谈周会", sourceAI: "SCOUT",
    due: "本周内", dueTone: "neutral",
  },
  // — tracking (进行中)
  {
    id: "t5", state: "tracking", priority: "mid",
    title: "将 B 组模型灰度到 20% 流量",
    source: "A/B 复盘", sourceAI: "ARIA",
    assignee: "WJ",
    due: "5/30", dueTone: "neutral",
    detail: "B 组有用率 +11.4pp,延迟在 SLA 内。灰度脚本需要 5/30 前 跑通。"
  },
  {
    id: "t6", state: "tracking", priority: "low",
    title: "更新会议录音留存说明书 v2",
    source: "与法务对齐", sourceAI: "LEX",
    assignee: "HR",
    due: "下周一", dueTone: "neutral",
  },
  {
    id: "t7", state: "tracking", priority: "mid",
    title: "确认搜索新版 chip 顺序",
    source: "搜索体验评审", sourceAI: "SAGE",
    assignee: "LM",
    due: "6/3", dueTone: "neutral",
  },
  {
    id: "t8", state: "tracking", priority: "low",
    title: "和 Sage 同步搜索结果页 v5",
    source: "Q3 路线图", sourceAI: "SAGE",
    assignee: "CY",
    due: "5/29", dueTone: "neutral",
  },
  // — review (审核)
  {
    id: "t9", state: "review",
    title: "审核 SHU 的 Q1 投诉异常根因报告",
    source: "Q1 投诉复盘", sourceAI: "SHU",
    assignee: "ZK",
    due: "5/28", dueTone: "warn",
    detail: "SHU 抽取了 单栋 + 单分类 异常点 12 处,需要拍板优先级。"
  },
  {
    id: "t10", state: "review",
    title: "评审 LEX 的数据隐私整改方案",
    source: "数据安全合规", sourceAI: "LEX",
    assignee: "ZK",
    due: "5/29", dueTone: "neutral",
  },
  // — done (已完成)
  {
    id: "t11", state: "done",
    title: "审核数据合规整改方案 + 拍板 Excel 信息处理流程",
    source: "数据安全合规风评会", sourceAI: "LEX",
    due: "6 天前",
  },
  {
    id: "t12", state: "done",
    title: "确认跨部门 Excel/Word 敏感信息排期",
    source: "数据安全合规风评会", sourceAI: "LEX",
    due: "6 天前",
  },
  {
    id: "t13", state: "done",
    title: "维修资金 业主大会 议案撰写",
    source: "维修资金审议会", sourceAI: "FALAO",
    due: "5/12",
  },
  {
    id: "t14", state: "done",
    title: "保险产品定价 v3 评审",
    source: "产品策略月度", sourceAI: "BAOXIAN",
    due: "5/13",
  },
];

export const TASK_COLUMNS: { id: WTaskState; label: string; color: string }[] = [
  { id: "todo",     label: "待办",     color: "#7C5CFA" },
  { id: "tracking", label: "进行中",   color: "#0A84FF" },
  { id: "review",   label: "审核",     color: "#FF9F0A" },
  { id: "done",     label: "已完成",   color: "#22c55e" },
];
