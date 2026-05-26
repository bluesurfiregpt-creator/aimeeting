import { MeetingHistoryPane } from "@/components/web/workstation";

/**
 * /workstation/history — 会议历史列表 (R6.X, round-6).
 *
 * 替代旧的硬编码 /workstation/meeting/q3-roadmap 侧栏入口.
 * 6 张 mini-stat 卡 + iOS segmented + 搜索 + 卡片网格.
 */
export default function MeetingHistoryRoute() {
  return <MeetingHistoryPane />;
}
