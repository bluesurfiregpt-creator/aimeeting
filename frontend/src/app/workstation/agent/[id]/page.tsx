import { notFound } from "next/navigation";
import { AgentDetailPane } from "@/components/web/workstation/AgentDetailPane";
import { W_AGENTS } from "@/components/web/data/agents";

/**
 * R5.B: AgentDetail (脑内地图 BrainRadar + BrainGraph + 3 tab 明细).
 *
 * dynamic [id] 支持深链 — 校验 id 必须在 W_AGENTS 内. 找不到 → notFound() 404.
 *
 * 6 个核心 AI (Aria / Stratos / Lex / Sage / Tally / Scout) 有完整 profile,
 * 其他 AI 走 genericProfile fallback (从 W_AGENTS intro/tags 推 placeholder).
 *
 * **后端** (Saga E.E 后续): GET /api/agents/:id/profile.
 */
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = W_AGENTS.find((a) => a.id === id);
  if (!agent) notFound();

  return <AgentDetailPane agent={agent} />;
}
