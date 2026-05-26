import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 16 张 AI 管理卡 (启用 dot + 我管理 pill + 编辑) + 模板生成器入口
export default function AgentsPane() {
  return (
    <PlaceholderPane
      title="AI 专家管理"
      sub="启用 / 编辑 / 调权重 · 由我管理的 AI 优先展示"
      icon="admin"
    />
  );
}
