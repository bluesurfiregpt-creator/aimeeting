import { notFound } from "next/navigation";
import { PlaceholderPane } from "@/components/web/workstation";
import { W_AGENTS } from "@/components/web/data/agents";

// R5.B: AgentDetail (脑内地图 BrainRadar + BrainGraph + 3 tab 明细)
// R5.A 仅 placeholder + 校验 id 是否存在 (避免乱链接)
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = W_AGENTS.find((a) => a.id === id);
  if (!agent) notFound();

  return (
    <PlaceholderPane
      title={`AI 专家 · ${agent.name}`}
      sub={`${agent.domain} — 脑内地图 (能力雷达 + 知识图谱) 将在 R5.B Saga 实施`}
      icon="brain"
    />
  );
}
