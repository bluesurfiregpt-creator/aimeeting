import { PlaceholderPane } from "@/components/web/workstation";

// R5.C: 6 KB 卡片 (文档数 + 分块数 + 拥有的 AI)
export default function KBPane() {
  return (
    <PlaceholderPane
      title="知识库 · 书架"
      sub="所有 AI 专家共用的文档库 · 按 AI / 类型筛选"
      icon="book"
    />
  );
}
