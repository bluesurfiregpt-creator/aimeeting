"use client";

import KanbanView from "@/components/KanbanView";
import { api } from "@/lib/api";

export default function KanbanAgentsPage() {
  return (
    <KanbanView
      title="AI 专家 Kanban"
      hint="按 AI 专家分列(智慧住建 16 集群)"
      fetcher={(includeClosed) => api.kanbanByAgent(includeClosed)}
      testIdPrefix="kanban-agents"
    />
  );
}
