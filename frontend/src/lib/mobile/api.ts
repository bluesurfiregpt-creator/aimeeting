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
  CreateMeetingIn,
  CreateMeetingOut,
  MemoryOut,
  MobileMeetingDetail,
  MobileMeetingsListOut,
  MobileTasksOut,
  MobileTranscriptOut,
  SummonAgentOut,
  TaskDetailComment,
  TaskDetailOut,
  WorkbenchOut,
  WorkspaceAgentBrief,
  WorkspaceMember,
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

  /** P5A: 会议完整转录流 (真人 + AI 合并按时间正序). */
  getMeetingTranscript: (id: string) =>
    jget<MobileTranscriptOut>(`/api/m/meetings/${id}/transcript`),

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

  /** P4.2: 召 AI 专家发言. fire-and-forget — 回复几秒后异步进 DB, 需 refetch detail. */
  summonAgent: (meetingId: string, agentId: string, query?: string) =>
    jsend<SummonAgentOut>(
      "POST",
      `/api/m/meetings/${meetingId}/summon`,
      query ? { agent_id: agentId, query } : { agent_id: agentId },
    ),

  /** P4.2: 结束会议. status ongoing → finished, 后端跑纪要/抽待办 background. */
  finalizeMeeting: (meetingId: string) =>
    jsend<unknown>("POST", `/api/meetings/${meetingId}/finalize`),

  // ===== P4.3 任务详情页 ===================================================

  /** 任务详情聚合 — meta + AI 智囊 + 实录依据 + 评论. id = MeetingActionItem.id. */
  getTaskDetail: (actionItemId: string) =>
    jget<TaskDetailOut>(`/api/m/tasks/${actionItemId}`),

  /** 发评论. 复用桌面 endpoint POST /api/meetings/{mid}/actions/{aid}/comments. */
  postTaskComment: (meetingId: string, actionItemId: string, content: string) =>
    jsend<TaskDetailComment>(
      "POST",
      `/api/meetings/${meetingId}/actions/${actionItemId}/comments`,
      { content },
    ),

  /** 删评论 (作者本人). DELETE /api/meetings/{mid}/actions/{aid}/comments/{cid}. */
  deleteTaskComment: (meetingId: string, actionItemId: string, commentId: string) =>
    jsend<unknown>(
      "DELETE",
      `/api/meetings/${meetingId}/actions/${actionItemId}/comments/${commentId}`,
    ),

  // ===== P4.4: /m/insights 已入库 tab ======================================

  // ===== P9: 新建会议 ======================================================

  /** 工作区成员列表 (leader+ 可见). 给邀真人 picker 用. */
  getWorkspaceMembers: () =>
    jget<WorkspaceMember[]>("/api/team/members"),

  /** 工作区 AI 列表. 给邀 AI picker 用. 仅 active. */
  getWorkspaceAgents: () =>
    jget<WorkspaceAgentBrief[]>("/api/agents?active_only=true"),

  /** 创建会议. 复用桌面 POST /api/meetings, mode 接受 hybrid / auto / human. */
  createMeeting: (payload: CreateMeetingIn) =>
    jsend<CreateMeetingOut>("POST", "/api/meetings", payload),

  // ===== 长期记忆库 (P4.4) ================================================

  /** 长期记忆库列表. 复用桌面 GET /api/memory. 可按 agent_id 筛, 默认 200 条上限. */
  getMemories: (params?: { agent_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.agent_id) q.set("agent_id", params.agent_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<MemoryOut[]>(`/api/memory${qs ? `?${qs}` : ""}`);
  },
  getInsights: (params?: { by_agent?: string; by_meeting?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.by_agent) q.set("by_agent", params.by_agent);
    if (params?.by_meeting) q.set("by_meeting", params.by_meeting);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<AIInsightFull[]>(`/api/m/insights${qs ? `?${qs}` : ""}`);
  },
};
