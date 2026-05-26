import { PlaceholderPane } from "@/components/web/workstation";

// R5.B: MeetingDetail (6 tabs: 概览 / 字幕 / 决策 / 行动项 / 资料 / AI 引用)
// R5.A 仅 placeholder, 接受任意 id (实际数据 R5.B 接 backend)
export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PlaceholderPane
      title={`会议详情 · ${id}`}
      sub="6 tabs (概览 / 字幕 / 决策 / 行动项 / 资料 / AI 引用) 将在 R5.B Saga 实施"
      icon="cal"
    />
  );
}
