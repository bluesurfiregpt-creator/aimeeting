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

async function jsend<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try {
      const j = await r.json();
      const detail = (j as { detail?: string }).detail;
      if (detail) msg = `${r.status}: ${detail}`;
    } catch {
      // ignore parse failure, use generic msg
    }
    throw new Error(msg);
  }
  if (r.status === 204) return undefined as T;
  // Some endpoints return empty body; guard against JSON parse on empty.
  const text = await r.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const mApi = {
  getWorkbench: () => jget<WorkbenchOut>("/api/m/workbench"),
  getMeetingsList: () => jget<MobileMeetingsListOut>("/api/m/meetings"),
  getMeetingDetail: (id: string) =>
    jget<MobileMeetingDetail>(`/api/m/meetings/${id}`),
  getTasks: () => jget<MobileTasksOut>("/api/m/tasks"),
  getAgentsWorkboard: () => jget<AgentsWorkboardOut>("/api/m/agents/workboard"),
  getAgentDetail: (id: string) => jget<AgentDetailOut>(`/api/m/agents/${id}`),

  // ===== Mobile CTA action endpoints (Phase 4) =============================
  // 复用桌面端 API, 不在 mobile prefix 下加包装 — 减少 surface area.

  /** ActionItem 确认/驳回. status: done | cancelled. */
  patchActionItem: (meetingId: string, actionId: string, status: "done" | "cancelled") =>
    jsend<unknown>("PATCH", `/api/meetings/${meetingId}/actions/${actionId}`, { status }),

  /** Memory 草稿通过 (写入长期记忆). */
  approveMemoryDraft: (draftId: string) =>
    jsend<unknown>("POST", `/api/memory-drafts/${draftId}/approve`),

  /** Memory 草稿驳回. 默认 kind=discard (整条丢弃). */
  rejectMemoryDraft: (draftId: string, feedback?: string) =>
    jsend<unknown>("POST", `/api/memory-drafts/${draftId}/reject`, {
      kind: feedback ? "feedback" : "discard",
      ...(feedback ? { feedback_text: feedback } : {}),
    }),

  /** 推进议程 — current_agenda_idx +1 (或标完成). */
  advanceAgenda: (meetingId: string) =>
    jsend<unknown>("POST", `/api/meetings/${meetingId}/agenda-advance`),
  getInsights: (params?: { by_agent?: string; by_meeting?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.by_agent) q.set("by_agent", params.by_agent);
    if (params?.by_meeting) q.set("by_meeting", params.by_meeting);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<AIInsightFull[]>(`/api/m/insights${qs ? `?${qs}` : ""}`);
  },
};
