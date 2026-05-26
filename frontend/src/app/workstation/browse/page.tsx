import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 复用首页 AgentMarketplace 风格, 在工作站里再呈现一份
export default function BrowsePane() {
  return (
    <PlaceholderPane
      title="AI 卡片浏览"
      sub="所有 AI 专家 · 类目快切 + 搜索 + 热度排序"
      icon="sparkle"
    />
  );
}
