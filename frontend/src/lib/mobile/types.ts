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

// ---------- 单专家详情页 (Phase 3) ---------------------------------------

export type AgentDetailMeetingItem = {
  meeting_id: string;
  title: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  insights_count: number;
};

export type AgentDetailTaskItem = {
  task_id: string;
  /** P4.3 反查的 ActionItem id, 前端跳 /m/tasks/<action_item_id> 用. null 时不可点. */
  action_item_id: string | null;
  title: string;
  status: string; // open|dispatched|accepted|in_progress|submitted|done|archived|cancelled
  due_at: string | null;
  is_overdue: boolean;
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  created_at: string;
};

export type AgentDetailOut = {
  agent_id: string;
  name: string;
  nickname: string | null;
  domain: string | null;
  color: string | null;
  role: string;
  total_meetings: number;
  total_insights: number;
  last_active: string | null;
  meetings: AgentDetailMeetingItem[];
  tasks: AgentDetailTaskItem[];
  insights: AIInsightFull[];
};

// ---------- 任务闭环视图 -----------------------------------------------

export type MobileTaskKind = "confirm" | "approve_draft" | "tracking" | "done";
export type MobileTaskGroup = "pending" | "tracking" | "done";

export type MobileTaskSourceKind = "action" | "draft";

export type MobileTaskItem = {
  kind: MobileTaskKind;
  id: string;
  /** P4.3: action 类可跳 /m/tasks/<id> 详情; draft 类无详情页. */
  source_kind: MobileTaskSourceKind;
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

export type AgentMini = {
  agent_id: string;
  name: string;
  nickname: string | null;
  domain: string | null;
  color: string | null;
  role: string;
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

  /** P4.2: 会议室已邀请的 AI 专家 (给召 AI sheet 用) */
  attending_agents: AgentMini[];
};

/** Summon AI 响应. 真 AI 回复异步进库, 需 refetch. */
export type SummonAgentOut = {
  accepted: boolean;
  agent_id: string;
  agent_name: string;
};

// ---------- 任务详情页 /m/tasks/[id] (Phase 4.3) -----------------------

export type TaskDetailEvidenceLine = {
  line_id: number;
  text: string;
  speaker_name: string | null;
  at_minute: number;
};

export type TaskDetailComment = {
  id: string;
  author_user_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
  can_delete: boolean;
};

export type TaskDetailOut = {
  // 基本
  action_item_id: string;
  task_id: string | null;
  title: string;
  content: string;
  status: string;
  due_at: string | null;
  is_overdue: boolean;
  created_at: string;
  // 归属
  assignee_user_id: string | null;
  assignee_user_name: string | null;
  assignee_agent_id: string | null;
  assignee_agent_name: string | null;
  assignee_agent_nickname: string | null;
  assignee_name_hint: string | null;
  // 来源
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  source_type: string;
  // 依据
  evidence_quote: string | null;
  evidence_lines: TaskDetailEvidenceLine[];
  // AI 智囊
  insights: AIInsightFull[];
  // 评论
  comments: TaskDetailComment[];
};
