/**
 * v1.4.0 · Saga M + Saga N + Saga O + Saga P · Mobile App v2 schema 类型.
 *
 * 跟 docs/SCHEMA-mobile-v2.md §1 + §2 (Saga M) + §3 (Saga N) + §4 (Saga O) + §5 (Saga P) 一一对应.
 * Phase 1 由 backend /api/v2/* 返回 mock JSON, Phase 2 后端真接时类型不变.
 *
 * 命名 snake_case (跟 backend 一致).
 * 不引入 frontend/src/lib/mobile/types.ts — v2 独立, 避免类型包袱.
 */

// ─────── §1 共享 ───────

/** 真人 / AI 参与者. type 决定 是 human 还是 ai. */
export type V2Attendee = {
  type: "human" | "ai";
  id: string;
  name: string;
  /** human: avatar_color · ai: gradient_from */
  color: string;
  /** ai 才有 */
  glyph: string | null;
  /** ai 才有 */
  gradient_to: string | null;
};

/** AI badge — 精简版 AIAgent, 卡片右下角用. */
export type V2AIBadge = {
  id: string;
  name: string;
  glyph: string;
  gradient_from: string;
  gradient_to: string;
};

// ─────── §2.1 week-pulse ───────

export type V2WeekPulseChip = {
  label: string;
  count: number;
  icon: string;
};

export type V2WeekPulseResponse = {
  week_start: string;
  week_end: string;
  meeting_count: number;
  summary_text: string;
  decision_recommendation: string;
  chips: V2WeekPulseChip[];
};

// ─────── §2.2 meetings ───────

export type V2MeetingStatus =
  | "upcoming"
  | "live"
  | "finished"
  | "processed";

export type V2MeetingItem = {
  id: string;
  title: string;
  topic_summary: string;
  status: V2MeetingStatus;
  started_at: string | null;
  scheduled_for: string;
  ended_at: string | null;
  elapsed_minutes: number | null;
  countdown_seconds: number | null;
  decision_count: number;
  attendees: V2Attendee[];
  human_count: number;
  ai_count: number;
  ai_badges: V2AIBadge[];
};

export type V2MeetingsListResponse = {
  items: V2MeetingItem[];
  next_cursor: string | null;
};

// ─────── §3.1 today/brief ───────

export type V2BriefChip = {
  label: string;
  color: string;
};

export type V2BriefResponse = {
  id: string;
  generated_at: string;
  title: string;
  summary_text: string;
  chips: V2BriefChip[];
  target_meeting_id: string;
};

// ─────── §3.2 today/live-meeting ───────

export type V2LiveMeetingResponse = {
  meeting: V2MeetingItem | null;
  mira_note: string | null;
};

// ─────── §3.3 today/snapshot ───────

export type V2SnapshotResponse = {
  meetings_today: number;
  pending_tasks: number;
  ai_insights_today: number;
  decisions_today: number;
};

// ─────── §3.4 today/pending-tasks ───────

/** 任务 / 洞察 共享 — AI 来源精简 (id/name/glyph/color 一键 render). */
export type V2AISource = {
  id: string;
  name: string;
  glyph: string;
  color: string;
};

export type V2Urgency = "urgent" | "today" | "week" | "none";

export type V2PendingTaskItem = {
  id: string;
  title: string;
  source_meeting: string;
  source_meeting_id: string;
  urgency: V2Urgency;
  ai_source: V2AISource;
  due_at: string;
  due_display: string;
};

export type V2PendingTasksResponse = {
  items: V2PendingTaskItem[];
  total_count: number;
};

// ─────── §3.5 today/insights ───────

export type V2InsightType = "突破" | "决策" | "风险" | "洞察" | "思路";

export type V2InsightItem = {
  id: string;
  type: V2InsightType;
  ai_source: V2AISource;
  title: string;
  body: string;
  source_meeting: string;
  source_meeting_id: string;
  created_at: string;
};

export type V2InsightsResponse = {
  items: V2InsightItem[];
};

// ─────── §3.6 today/decisions ───────

export type V2DecisionItem = {
  id: string;
  title: string;
  decided_at: string;
  meeting_id: string;
};

export type V2DecisionsResponse = {
  items: V2DecisionItem[];
  total_count: number;
};

// ─────── §3.7 today/experts ───────

export type V2ExpertRecentMeeting = {
  id: string;
  title: string;
  joined_at: string;
};

export type V2Expert = {
  id: string;
  name: string;
  glyph: string;
  gradient_from: string;
  gradient_to: string;
  role_short: string;
  last_active_at: string;
  last_active_display: string;
  recent_meetings: V2ExpertRecentMeeting[];
  task_count: number;
};

export type V2ExpertsResponse = {
  experts: V2Expert[];
};

// ─────── §4 Saga O — Tasks + Memory ───────

// §4.1 priority-banner (Mira 优先级 hero)
export type V2PriorityBanner = {
  urgent_task_count: number;
  summary_text: string;
  ai_suggestion_count: number;
  ai_suggestion_text: string;
};

// §4.2 tasks/grouped — 任务状态 + 单 task + 分组
export type V2TaskStatus = "pending" | "tracking" | "done";

export type V2TaskItem = {
  id: string;
  title: string;
  urgency: V2Urgency;
  ai_source: V2AISource;
  due_at: string;
  due_display: string;
  status: V2TaskStatus;
  source_meeting?: string;
  source_meeting_id?: string;
};

export type V2TaskGroup = {
  meeting_id: string;
  meeting_title: string;
  tasks: V2TaskItem[];
};

export type V2TasksGroupedResponse = {
  groups: V2TaskGroup[];
};

// §4.3 memory/radar — 雷达 hero
export type V2RadarAxisMetric = {
  axis_name: string;
  my_count: number;
  team_diff: number;
  label: string;
};

export type V2RadarData = {
  total_memories: number;
  total_axes_covered: number;
  axes: string[];
  my_values: number[];
  team_values: number[];
  axis_metrics: V2RadarAxisMetric[];
};

// §4.4 memory/snapshots — 快照 list 升级
export type V2SnapshotAIAvatar = {
  glyph: string;
  gradient_from: string;
  gradient_to: string;
};

export type V2MemorySnapshot = {
  id: string;
  topic: string;
  ai_avatars: V2SnapshotAIAvatar[];
  types: string[];
  count: number;
  source_meeting_id?: string;
};

export type V2MemorySnapshotsResponse = {
  items: V2MemorySnapshot[];
  total_count: number;
};

// ─────── §5 Saga P — Profile + 新建会议 ───────

// §5.1 profile/ai-stats — Mira AI 智囊 7 天统计 (M6 Profile hero)
export type V2ProfileAIStats = {
  period_days: number;
  total_suggestions: number;
  adopted: number;
  adoption_rate: number;
  most_popular_ai: {
    id: string;
    name: string;
    glyph: string;
    gradient_from: string;
    gradient_to: string;
    adoption_pct: number;
  };
};

// §5.2 profile/voiceprints-stats — 声纹库 counter (M6 Profile row subline)
export type V2ProfileVoiceprintsStats = {
  count: number;
  last_updated_at: string;
  last_updated_display: string;
};

// §5.3 mira/draft-meeting — Mira 描述需求 → 自动配 AI (M7 新建会议)

export type V2MiraDraftRequest = {
  input_text: string;
  input_mode: "text" | "voice";
};

export type V2MiraAgendaItem = {
  label: string;
  duration_min: number;
  led_by_ai: string;
};

export type V2MiraProposedAI = {
  id: string;
  name: string;
  glyph: string;
  gradient_from: string;
  gradient_to: string;
  reason: string;
};

export type V2MiraProposedHuman = {
  id: string;
  name: string;
  surname_char: string;
  avatar_color: string;
};

export type V2MiraDraftResponse = {
  confidence: number;
  proposed_title: string;
  proposed_topic: string;
  proposed_agenda: V2MiraAgendaItem[];
  total_duration_min: number;
  proposed_ais: V2MiraProposedAI[];
  proposed_humans: V2MiraProposedHuman[];
  sample_prompts: string[];
};
