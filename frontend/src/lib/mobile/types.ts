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

// ---------- 会议完整转录流 (Phase 5A) -----------------------------------

export type TranscriptStreamLine = {
  kind: "user" | "agent";
  id: number;
  text: string;
  at_minute: number;
  created_at: string;
  // user
  speaker_name: string | null;
  speaker_status: string | null;
  // agent
  agent_id: string | null;
  agent_name: string | null;
  agent_nickname: string | null;
  agent_color: string | null;
  trigger: string | null;
  citations_count: number;
};

export type MobileTranscriptOut = {
  meeting_id: string;
  title: string;
  status: string;
  started_at: string | null;
  total_user_lines: number;
  total_agent_lines: number;
  lines: TranscriptStreamLine[];
};

// ---------- P17: 会议总结页 (结束后跳的页) -----------------------------

/** GET /api/meetings/{id}/summary 返回 */
export type MeetingSummaryOut = {
  summary_md: string | null;
  status: "pending" | "ready" | "skipped" | "failed" | string;
  message?: string | null;
};

/** GET /api/meetings/{id}/actions 返回的简化版 (mobile 用) */
export type MeetingActionItemBrief = {
  id: string;
  meeting_id: string;
  content: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_name_hint: string | null;
  due_at: string | null;
  status: string;
  source_type: string;
  evidence_quote: string | null;
  assignee_agent_id: string | null;
  assignee_agent_name: string | null;
  assignee_agent_color: string | null;
};

// ---------- P9: 新建会议 / 邀人邀 AI -------------------------------------

/** GET /api/team/members 返回 */
export type WorkspaceMember = {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
  department: string | null;
};

/** GET /api/agents 返回的 mini brief — mobile 用 */
export type WorkspaceAgentBrief = {
  id: string;
  name: string;
  nickname: string | null;
  domain: string | null;
  color: string | null;
  role: string;          // "expert" | "moderator"
  is_active: boolean;
};

/** POST /api/meetings 请求 body */
export type CreateMeetingIn = {
  title: string;
  attendee_user_ids: string[];
  attendee_agent_ids: string[];
  agenda: Array<{
    title: string;
    time_budget_min?: number | null;
    note?: string | null;
  }>;
  mode: "hybrid" | "auto" | "human";
  /** v27.0-mobile P19: 会议 brief — auto 模式 强烈建议 填. */
  description?: string | null;
};

/** POST /api/meetings 响应 */
export type CreateMeetingOut = {
  id: string;
  title: string;
  status: string;
  mode: string;
};

// ---------- P19-A.2: AI 拆议程 -------------------------------------------

/** POST /api/meetings/decompose-agenda 请求 */
export type DecomposeAgendaIn = {
  brief: string;
  title?: string | null;
  target_count?: number;
};

/** 一行拆出来的 议程项 */
export type DecomposedAgendaItem = {
  title: string;
  note: string | null;
  time_budget_min: number | null;
};

/** POST /api/meetings/decompose-agenda 响应 */
export type DecomposeAgendaOut = {
  items: DecomposedAgendaItem[];
};

// ---------- 长期记忆库 (Phase 4.4 — /m/insights 已入库 tab) ------------

export type MemoryAgentBrief = {
  id: string;
  name: string;
  is_primary: boolean;
};

export type MemoryOut = {
  id: string;
  scope: string;           // 'user' | 'project' | 'org'
  scope_ref: string | null;
  content: string;
  importance: number;
  source_type: string | null;
  source_id: string | null;
  agents: MemoryAgentBrief[];
  source_meeting_id: string | null;
  source_action_item_id: string | null;
  source_line_ids: number[] | null;
  curated_by_user_id: string | null;
  curated_at: string | null;
  created_at: string;
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
