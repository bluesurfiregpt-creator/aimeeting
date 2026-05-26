/**
 * v1.4.0 · Saga M1 · Mobile App v2 atoms barrel export.
 *
 * 跟 v1 (shared/) 隔离, 走 SCHEMA-mobile-v2.md 契约.
 * Saga N/O/P 直接 `import { MAvatar, MAGlowBanner, ... } from "@/components/mobile/v2"`.
 *
 * 命名: 跟设计源 jsx 一致 (MAvatar / MAIBadge / MAvatarStack / MASegmented /
 * MAGlowBanner / MAIcon / MiraPulseNotice / MAEmpty / MAPill / MASection /
 * MeetingFullCard).
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

export type { V2IconName } from "./MAIcon";
export type { V2SegmentedTab } from "./MASegmented";
export type { V2GlowTone, V2GlowChip } from "./MAGlowBanner";
export type { V2PillTone } from "./MAPill";
export type {
  V2Attendee,
  V2AIBadge,
  V2WeekPulseChip,
  V2WeekPulseResponse,
  V2MeetingStatus,
  V2MeetingItem,
  V2MeetingsListResponse,
} from "./types";
