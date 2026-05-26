import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: Mira priority banner + 三段制 (等你处理 / 跟踪中 / 已完成)
export default function TasksPane() {
  return (
    <PlaceholderPane
      title="我的任务"
      sub="所有 AI 提炼出的 + 主持人指派给你的 待办,按 状态 归三段"
      icon="task"
    />
  );
}
