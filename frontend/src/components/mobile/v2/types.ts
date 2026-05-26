/**
 * v1.4.0 · Saga M · Mobile App v2 schema 类型.
 *
 * 跟 docs/SCHEMA-mobile-v2.md §1 + §2 一一对应.
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
