/**
 * v1.4.0 · Saga M1 + Saga N + Saga O + Saga P-1 · Mobile App v2 atoms barrel export.
 *
 * 跟 v1 (shared/) 隔离, 走 SCHEMA-mobile-v2.md 契约.
 * Saga N/O/P 直接 `import { MAvatar, MAGlowBanner, ... } from "@/components/mobile/v2"`.
 *
 * 命名: 跟设计源 jsx 一致 (MAvatar / MAIBadge / MAvatarStack / MASegmented /
 * MAGlowBanner / MAIcon / MiraPulseNotice / MAEmpty / MAPill / MASection /
 * MeetingFullCard · Saga N 加: MStatTile · MExpertCard ·
 * Saga O 加: MTaskRow · MInsightCard · MMemoryRadar ·
 * Saga P-1 加: MASheet · MScrollPicker · MAIRosterGrid).
 */

export { default as MAvatar } from "./MAvatar";
export { default as MAIBadge } from "./MAIBadge";
export { default as MAvatarStack } from "./MAvatarStack";
export { default as MASegmented } from "./MASegmented";
export { default as MAGlowBanner, Sparkle } from "./MAGlowBanner";
export { default as MAIcon } from "./MAIcon";
export { default as MiraPulseNotice } from "./MiraPulseNotice";
export { default as MAEmpty } from "./MAEmpty";
export { default as MAPill } from "./MAPill";
export { default as MASection } from "./MASection";
export { default as MeetingFullCard } from "./MeetingFullCard";
export { default as MStatTile } from "./MStatTile";
export { default as MExpertCard } from "./MExpertCard";
export { default as MTaskRow } from "./MTaskRow";
export { default as MInsightCard } from "./MInsightCard";
export { default as MMemoryRadar } from "./MMemoryRadar";
export { default as MASheet } from "./MASheet";
export { default as MScrollPicker } from "./MScrollPicker";
export { default as MAIRosterGrid } from "./MAIRosterGrid";

export type { V2IconName } from "./MAIcon";
export type { V2SegmentedTab } from "./MASegmented";
export type { V2GlowTone, V2GlowChip } from "./MAGlowBanner";
export type { V2PillTone } from "./MAPill";
export type { V2StatTone } from "./MStatTile";
export type {
  // §1 共享
  V2Attendee,
  V2AIBadge,
  V2AISource,
  // §2 meetings (Saga M)
  V2WeekPulseChip,
  V2WeekPulseResponse,
  V2MeetingStatus,
  V2MeetingItem,
  V2MeetingsListResponse,
  // §3 today (Saga N)
  V2BriefChip,
  V2BriefResponse,
  V2LiveMeetingResponse,
  V2SnapshotResponse,
  V2Urgency,
  V2PendingTaskItem,
  V2PendingTasksResponse,
  V2InsightType,
  V2InsightItem,
  V2InsightsResponse,
  V2DecisionItem,
  V2DecisionsResponse,
  V2ExpertRecentMeeting,
  V2Expert,
  V2ExpertsResponse,
  // §4 tasks + memory (Saga O)
  V2PriorityBanner,
  V2TaskStatus,
  V2TaskItem,
  V2TaskGroup,
  V2TasksGroupedResponse,
  V2RadarAxisMetric,
  V2RadarData,
  V2SnapshotAIAvatar,
  V2MemorySnapshot,
  V2MemorySnapshotsResponse,
  // §5 profile (Saga P-1)
  V2ProfileAIStats,
  V2ProfileVoiceprintsStats,
  // §5.3 mira/draft-meeting (Saga P-2)
  V2MiraDraftRequest,
  V2MiraAgendaItem,
  V2MiraProposedAI,
  V2MiraProposedHuman,
  V2MiraDraftResponse,
} from "./types";
