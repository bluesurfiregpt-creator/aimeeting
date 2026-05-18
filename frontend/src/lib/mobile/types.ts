/**
 * v27.0-mobile · 移动端专用类型.
 *
 * 跟后端 backend/app/routers/mobile.py 的 Pydantic 一一对应.
 * 不跟桌面 types 复用 — 移动端数据形态独立, 避免类型包袱.
 */

export type AIInsightType = "建议" | "风险" | "洞察" | "思路" | "决策建议";

/** 紧凑版 — 卡内一行显, 不含依据 */
export type AIInsightBrief = {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_nickname: string | null;
  type: AIInsightType;
  content: string;
};

/** 完整版 — 含依据 + 来源, 智囊列表用 */
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

// ---------- 单场会议推进视图 -----------------------------------------

export type MobileMeetingAgendaItem = {
  idx: number;
  title: string;
  time_budget_min: number | null;
  status: "done" | "active" | "pending";
  elapsed_min: number | null;
};

export type MobileMeetingHumanLine = {
  speaker_name: string;
  text: string;
  at_minute: number;
};

// ---------- 会议列表 -----------------------------------------------------

export type MobileMeetingStatus = "ongoing" | "scheduled" | "finished" | "processed";

export type MobileMeetingListRow = {
  meeting_id: string;
  title: string;
  status: MobileMeetingStatus | string;
  started_at: string | null;
  ended_at: string | null;
  minutes_total: number | null;
  planned_minutes: number | null;
  agenda_total: number;
  current_agenda_idx: number | null;
  users_count: number;
  agents_count: number;
  insights_count: number;
  actions_count: number;
};

export type MobileMeetingsListOut = {
  items: MobileMeetingListRow[];
};

// ---------- 专家工卡墙 ---------------------------------------------------

export type AgentRecentMeetingBrief = {
  meeting_id: string;
  title: string;
  started_at: string | null;
};

export type AgentTasksSummary = {
  total: number;
  open_count: number;
  done_count: number;
  overdue_count: number;
};

export type AgentWorkCard = {
  agent_id: string;
  name: string;
  nickname: string | null;
  domain: string | null;
  color: string | null;
  role: string;
  recent_meetings: AgentRecentMeetingBrief[];
  tasks: AgentTasksSummary;
  last_active: string | null;
};

export type AgentsWorkboardOut = {
  agents: AgentWorkCard[];
};

// ---------- 任务闭环视图 -----------------------------------------------

export type MobileTaskKind = "confirm" | "approve_draft" | "tracking" | "done";
export type MobileTaskGroup = "pending" | "tracking" | "done";

export type MobileTaskItem = {
  kind: MobileTaskKind;
  id: string;
  title: string;
  group: MobileTaskGroup;
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  created_at: string;
  age_days: number | null;
  insights: AIInsightBrief[];
  cta_primary: string | null;
  cta_secondary: string | null;
};

export type MobileTasksOut = {
  me_primary_count: number;
  other_participating_count: number;
  items: MobileTaskItem[];
};

export type MobileMeetingDetail = {
  meeting_id: string;
  title: string;
  status: string;
  started_minutes_ago: number;
  can_control: boolean;

  agenda_items: MobileMeetingAgendaItem[];
  current_agenda_idx: number | null;
  is_agenda_complete: boolean;

  current_topic_title: string | null;
  current_topic_elapsed_min: number | null;
  current_topic_insights: AIInsightFull[];
  current_topic_recent_lines: MobileMeetingHumanLine[];

  transcript_total: number;
  other_topics_count: number;
};
