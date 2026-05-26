import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 左表单 (标题/时间/议程/参会人/AI 阵容) + 右 sticky Mira 会前检查卡
export default function NewMeetingPane() {
  return (
    <PlaceholderPane
      title="新建会议"
      sub="表单 · 议程 · AI 阵容 — Mira 实时给你会前检查建议"
      icon="plus"
    />
  );
}
