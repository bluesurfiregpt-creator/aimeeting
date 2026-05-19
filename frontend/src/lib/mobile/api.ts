/**
 * v27.0-mobile · 移动端 fetch helper.
 *
 * 极简 — 仅 wrap fetch 加 credentials. 不复用桌面 lib/api.ts 的 jget,
 * 因为那边含全局 toast 路径, 移动端想自己控错误显示.
 */

import type {
  AgentDetailOut,
  AgentsWorkboardOut,
  AIInsightFull,
  MobileMeetingDetail,
  MobileMeetingsListOut,
  MobileTasksOut,
  WorkbenchOut,
} from "./types";

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`${path} → ${r.status}`);
  }
  return (await r.json()) as T;
}

export const mApi = {
  getWorkbench: () => jget<WorkbenchOut>("/api/m/workbench"),
  getMeetingsList: () => jget<MobileMeetingsListOut>("/api/m/meetings"),
  getMeetingDetail: (id: string) =>
    jget<MobileMeetingDetail>(`/api/m/meetings/${id}`),
  getTasks: () => jget<MobileTasksOut>("/api/m/tasks"),
  getAgentsWorkboard: () => jget<AgentsWorkboardOut>("/api/m/agents/workboard"),
  getAgentDetail: (id: string) => jget<AgentDetailOut>(`/api/m/agents/${id}`),
  getInsights: (params?: { by_agent?: string; by_meeting?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.by_agent) q.set("by_agent", params.by_agent);
    if (params?.by_meeting) q.set("by_meeting", params.by_meeting);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<AIInsightFull[]>(`/api/m/insights${qs ? `?${qs}` : ""}`);
  },
};
