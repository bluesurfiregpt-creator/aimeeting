/**
 * v1.4.0 · Saga M + Saga N · Mobile App v2 schema 类型.
 *
 * 跟 docs/SCHEMA-mobile-v2.md §1 + §2 (Saga M) + §3 (Saga N) 一一对应.
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
