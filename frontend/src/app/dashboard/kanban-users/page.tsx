"use client";

import KanbanView from "@/components/KanbanView";
import { api } from "@/lib/api";

export default function KanbanUsersPage() {
  return (
    <KanbanView
      title="科长 Kanban"
      hint="按 assignee 分列,工作量降序"
      fetcher={(includeClosed) => api.kanbanByUser(includeClosed)}
      testIdPrefix="kanban-users"
    />
  );
}
