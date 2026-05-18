/**
 * v27.0-mobile · 移动端 专用 类型.
 *
 * 跟 后端 backend/app/routers/mobile.py 的 Pydantic 一一 对应.
 * 不 跟 桌面 types 复用 — 移动端 数据 形态 独立, 避免 类型 包袱.
 */

export type AIInsightType = "建议" | "风险" | "洞察" | "思路" | "决策建议";

/** 紧凑版 — 卡内 一行 显, 不 含 依据 */
export type AIInsightBrief = {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_nickname: string | null;
  type: AIInsightType;
  content: string;
};

/** 完整版 — 含 依据 + 来源, 智囊 列表 用 */
export type AIInsightFull = AIInsightBrief & {
  evidence: string | null;
  meeting_id: string;
  meeting_title: string | null;
  topic_idx: number | null;
  source_message_id: number | null;
  created_at: string;
};

export type WorkbenchOngoingMeeting = {
  meeting_id: string;
  title: string;
  started_minutes_ago: number;
  current_agenda_idx: number | null;
  total_agenda_items: number;
  latest_insight: AIInsightBrief | null;
};

export type WorkbenchPendingKind = "confirm" | "approve_draft" | "blocked";

export type WorkbenchPendingTask = {
  kind: WorkbenchPendingKind;
  id: string;
  title: string;
  source_meeting_title: string | null;
  insights: AIInsightBrief[];
  cta_label: string;
};

export type WorkbenchOut = {
  ongoing_meetings: WorkbenchOngoingMeeting[];
  pending: WorkbenchPendingTask[];
  todays_insights: AIInsightFull[];
};
