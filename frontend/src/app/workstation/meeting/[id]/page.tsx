import { MeetingDetailPane } from "@/components/web/workstation/MeetingDetailPane";

/**
 * R5.B: MeetingDetail (6 tabs: 概览 / 字幕 / 决策 / 行动项 / 资料 / AI 引用).
 *
 * dynamic [id]:
 *  - `q3-roadmap` 走完整 mock (W_MEETING_DETAIL)
 *  - 其他 id (如 standup / data-compliance / etc.) 走 fallback (W_HISTORY_MEETINGS 元信息 + 空详情)
 *  - 未知 id 走 generic skeleton (避免 404, 因为 Saga E 接通后所有 id 都会有详情)
 *
 * **后端** (Saga E.E 后续): GET /api/meetings/:id + GET /api/meetings/:id/captions.
 */
export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MeetingDetailPane meetingId={id} />;
}
