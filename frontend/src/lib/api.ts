// REST client. Resolved at runtime so the same bundle works under
// http://localhost:3000 and https://aimeeting.zhzjpt.cn.

function backendBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return ""; // same-origin via nginx
}

import { toast } from "./toast";

// Centralised handler so a 401 anywhere kicks the user back to /login
// without forcing every caller to remember.
function handleAuthError(status: number) {
  if (typeof window === "undefined") return;
  if (status !== 401) return;
  // Don't bounce while we're already on a public auth page
  const path = window.location.pathname;
  if (path === "/login" || path === "/register") return;
  window.location.assign(`/login?next=${encodeURIComponent(path)}`);
}

/**
 * Custom error thrown by the fetch wrappers. Call sites should display
 * `error.message` directly — it always carries a friendly, end-user-readable
 * message (parsed from FastAPI's {detail} shape, or a fallback like
 * "请求失败"). The raw status / path / response body are exposed on the error
 * object for logging but should NOT be shown to users (per v8 test report
 * P1+P2 — login/register pages were leaking these into form error labels).
 */
export class ApiError extends Error {
  status: number;
  path: string;
  rawBody: string;
  constructor(message: string, opts: { status: number; path: string; rawBody: string }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.path = opts.path;
    this.rawBody = opts.rawBody;
  }
}

/** Pull the friendliest message we can find out of an error response.
 *  Order:
 *    1. FastAPI {"detail": "..."}
 *    2. Some endpoints return {"message": "..."}
 *    3. Plain-text body if it's short and looks like text (not HTML)
 *    4. Generic fallback by status code
 *  Never returns the raw HTML 502 page or the bare path/status string. */
function friendlyDetail(status: number, body: string): string {
  const trimmed = (body || "").trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.detail) {
        return Array.isArray(parsed.detail)
          ? parsed.detail.map((d: { msg?: string }) => d?.msg || JSON.stringify(d)).join("; ")
          : String(parsed.detail);
      }
      if (parsed?.message) return String(parsed.message);
    } catch {
      // not JSON — only show as detail if it looks like a short plain message
      const isHtml = /^\s*<(!doctype|html|body)/i.test(trimmed);
      if (!isHtml && trimmed.length <= 200) return trimmed;
    }
  }
  if (status === 401) return "请先登录";
  if (status === 403) return "无权限";
  if (status === 404) return "资源不存在";
  if (status === 409) return "资源冲突";
  if (status === 429) return "请求过于频繁";
  if (status >= 500) return "服务器暂时不可用，请稍后重试";
  return `请求失败（${status}）`;
}

/** Surface non-401 network errors as a toast so users get visible feedback
 *  even when individual call sites silently swallow the throw. */
function handleNetworkError(_path: string, status: number, body: string) {
  if (typeof window === "undefined") return;
  if (status === 401) return; // handled by handleAuthError
  const detail = friendlyDetail(status, body);
  if (status >= 500) {
    toast.error("服务器错误", { detail });
  } else if (status === 404) {
    // 404s are often expected (e.g. polling for a resource) — only toast on
    // explicit user actions. We default to silent here; callers can toast
    // themselves where it matters.
    return;
  } else if (status >= 400) {
    toast.warn(`请求失败 (${status})`, { detail });
  }
}

function makeError(path: string, status: number, body: string): ApiError {
  return new ApiError(friendlyDetail(status, body), { status, path, rawBody: body });
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(backendBase() + path, {
    cache: "no-store",
    credentials: "include",
  });
  if (!r.ok) {
    handleAuthError(r.status);
    const body = await r.text().catch(() => "");
    handleNetworkError(path, r.status, body);
    throw makeError(path, r.status, body);
  }
  return r.json();
}
async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    handleAuthError(r.status);
    const text = await r.text().catch(() => "");
    handleNetworkError(path, r.status, text);
    throw makeError(path, r.status, text);
  }
  return r.json();
}
/** POST that doesn't expect a JSON body in the response (e.g. 204). */
async function jpostVoid(path: string, body: unknown): Promise<void> {
  const r = await fetch(backendBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 204) {
    handleAuthError(r.status);
    const text = await r.text().catch(() => "");
    handleNetworkError(path, r.status, text);
    throw makeError(path, r.status, text);
  }
}

async function jpostForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!r.ok) {
    handleAuthError(r.status);
    const body = await r.text().catch(() => "");
    handleNetworkError(path, r.status, body);
    throw makeError(path, r.status, body);
  }
  return r.json();
}

export type User = {
  id: string;
  name: string;
  email: string | null;
  has_voiceprint: boolean;
  created_at: string;
};

export type Voiceprint = {
  id: string;
  user_id: string;
  pyannote_id: string;
  sample_seconds: number | null;
  version: number;
  is_active: boolean;
  created_at: string;
};

/** M3.0: one row of a meeting's agenda. Optional time_budget_min drives the
 *  agenda-monitor's "time warning" trigger when usage crosses 80%. */
export type AgendaItem = {
  title: string;
  time_budget_min?: number | null;
  note?: string | null;
};

export type Meeting = {
  id: string;
  title: string;
  status: "scheduled" | "ongoing" | "finished" | "processed";
  started_at: string | null;
  ended_at: string | null;
  attendee_user_ids: string[];
  agenda?: AgendaItem[] | null;
};

/** M3.0: a tracked TODO from a meeting (auto-extracted or manually added). */
export type ActionItem = {
  id: string;
  meeting_id: string;
  content: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_name_hint: string | null;
  due_at: string | null;
  status: "open" | "done" | "cancelled";
  source_type: "summary" | "manual" | "agent";
  created_at: string;
  updated_at: string;
};

/** M3.0: one persisted Agent reply in a meeting. Read-only post-hoc — for
 *  Cowork to verify keyword/@-mention triggers fired correctly without
 *  needing to subscribe to the live WS. */
export type AgentMessage = {
  id: number;
  agent_id: string;
  text: string;
  trigger: string | null;
  created_at: string;
};

export type TranscriptLine = {
  /** Back-compat — same value as `line_id`. Kept until callers migrate. */
  id: number;
  /** Canonical name; matches POST /manual-transcript and /correct-speaker URLs. */
  line_id: number;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker_user_id: string | null;
  speaker_label: string | null;
  speaker_name: string | null;
  speaker_status: string | null;
  confidence: number | null;
};

export type MeetingResult = {
  meeting: Meeting;
  lines: TranscriptLine[];
  identification_status: "pending" | "running" | "ready" | "skipped" | "failed";
  identification_message: string | null;
};

export type Agent = {
  id: string;
  name: string;
  avatar_url: string | null;
  domain: string | null;
  persona: string | null;
  tone: string | null;
  boundary: string | null;
  keywords: string[] | null;
  color: string | null;
  dify_app_type: string;
  dify_base_url: string | null;
  dify_workflow_id: string | null;
  knowledge_base_ids: string[] | null;
  is_active: boolean;
  /** M3.0: 'expert' (default, user-configurable) | 'moderator'
   *  (built-in per workspace, drives agenda_monitor banners). */
  role: "expert" | "moderator";
  has_dify_key: boolean;
  created_at: string;
};

export type AgentInput = Partial<Omit<Agent, "id" | "has_dify_key" | "created_at">> & {
  name: string;
  dify_api_key?: string | null;
};

export type ProviderCatalogEntry = {
  name: string;
  label: string;
  default_base_url: string;
  default_model: string;
  api_key_help: string;
  docs_url: string;
};

export type AuditEntry = {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  ts: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  document_count: number;
  chunk_count: number;
  created_at: string;
};

export type KnowledgeDocument = {
  id: string;
  kb_id: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
  status: "uploading" | "parsing" | "embedding" | "ready" | "failed";
  char_count: number | null;
  chunk_count: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type Memory = {
  id: string;
  scope: "user" | "project" | "org";
  scope_ref: string | null;
  content: string;
  importance: number;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
};

export type ProviderConfig = {
  id: string;
  provider: string;
  base_url: string | null;
  model_id: string | null;
  is_active: boolean;
  note: string | null;
  masked_key: string;
  created_at: string;
  updated_at: string;
};

async function jput<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    handleAuthError(r.status);
    const text = await r.text().catch(() => "");
    handleNetworkError(path, r.status, text);
    throw makeError(path, r.status, text);
  }
  return r.json();
}
async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    handleAuthError(r.status);
    const text = await r.text().catch(() => "");
    handleNetworkError(path, r.status, text);
    throw makeError(path, r.status, text);
  }
  return r.json();
}
async function jdelete(path: string): Promise<void> {
  const r = await fetch(backendBase() + path, {
    method: "DELETE",
    credentials: "include",
  });
  if (!r.ok && r.status !== 204) {
    handleAuthError(r.status);
    const text = await r.text().catch(() => "");
    handleNetworkError(path, r.status, text);
    throw makeError(path, r.status, text);
  }
}

/** Theme 1 (P0): one comment on an action item. Append-only — `can_delete`
 *  is true only when the caller is the author. Author + name are nullable
 *  in case the user account was later removed (FK on author_user_id is
 *  ON DELETE SET NULL so the thread doesn't go stale). */
export type ActionComment = {
  id: string;
  action_item_id: string;
  author_user_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
  can_delete: boolean;
};

/** Theme 1 (P0): a row in `/api/me/actions` — adds the meeting title for
 *  display + drops assignee fields (it's always the caller). */
export type MyAction = {
  id: string;
  meeting_id: string;
  meeting_title: string | null;
  content: string;
  due_at: string | null;
  status: "open" | "done" | "cancelled";
  source_type: "summary" | "manual" | "agent";
  created_at: string;
  updated_at: string;
};

/** Theme 1 (P0): one bell-drawer entry. `payload` shape varies by `kind`;
 *  the UI switches on `kind` to format the human-readable line. */
export type Notification = {
  id: string;
  kind:
    | "action_assigned"
    | "action_due_soon"
    | "action_overdue"
    | "action_comment";
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationList = {
  items: Notification[];
  unread_count: number;
};

export type Me = {
  user_id: string;
  name: string;
  email: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  role: string;
};

export type TeamMember = {
  user_id: string;
  name: string;
  email: string | null;
  role: "owner" | "admin" | "member";
  joined_at: string;
};

export type Invitation = {
  id: string;
  email: string | null;
  role: "admin" | "member";
  token: string;
  invite_url: string;
  created_by_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export type InvitePreview = {
  workspace_name: string;
  role: string;
  email: string | null;
  expires_at: string;
};

export const api = {
  // Auth
  register: (body: {
    email: string;
    password: string;
    name: string;
    workspace_name?: string;
    invite_token?: string;
  }) => jpost<Me>("/api/auth/register", body),
  login: (body: { email: string; password: string }) =>
    jpost<Me>("/api/auth/login", body),
  logout: () => jpost<{ ok: boolean }>("/api/auth/logout", {}),
  me: () => jget<Me>("/api/auth/me"),
  invitePreview: (token: string) =>
    jget<InvitePreview>(`/api/auth/invite/${token}`),
  forgotPassword: (email: string) =>
    jpost<{ ok: boolean }>("/api/auth/forgot-password", { email }),
  resetPassword: (token: string, new_password: string) =>
    jpost<Me>("/api/auth/reset-password", { token, new_password }),

  // Team
  listMembers: () => jget<TeamMember[]>("/api/team/members"),
  removeMember: (userId: string) => jdelete(`/api/team/members/${userId}`),
  listInvitations: () => jget<Invitation[]>("/api/team/invitations"),
  createInvitation: (body: { email?: string; role: "admin" | "member" }) =>
    jpost<Invitation>("/api/team/invitations", body),
  revokeInvitation: (id: string) => jdelete(`/api/team/invitations/${id}`),

  listUsers: () => jget<User[]>("/api/users"),
  createUser: (name: string, email?: string) =>
    jpost<User>("/api/users", { name, email }),
  enrollVoiceprint: async (userId: string, pcmBlob: Blob) => {
    const fd = new FormData();
    fd.append("user_id", userId);
    fd.append("audio", pcmBlob, "voice.pcm");
    return jpostForm<Voiceprint>("/api/voiceprints", fd);
  },
  listMeetings: () => jget<Meeting[]>("/api/meetings"),
  deleteMeeting: (id: string) => jdelete(`/api/meetings/${id}`),
  createMeeting: (
    title: string,
    attendeeUserIds: string[],
    agenda?: AgendaItem[] | null,
  ) =>
    jpost<Meeting>("/api/meetings", {
      title,
      attendee_user_ids: attendeeUserIds,
      ...(agenda && agenda.length ? { agenda } : {}),
    }),
  getMeeting: (id: string) => jget<Meeting>(`/api/meetings/${id}`),
  finalizeMeeting: (id: string) => jpost<Meeting>(`/api/meetings/${id}/finalize`, {}),
  meetingResult: (id: string) => jget<MeetingResult>(`/api/meetings/${id}/result`),

  // M3.0 action items
  listActionItems: (meetingId: string) =>
    jget<ActionItem[]>(`/api/meetings/${meetingId}/actions`),
  createActionItem: (
    meetingId: string,
    body: { content: string; assignee_user_id?: string | null; due_at?: string | null },
  ) => jpost<ActionItem>(`/api/meetings/${meetingId}/actions`, body),
  patchActionItem: (
    meetingId: string,
    actionId: string,
    body: Partial<{
      content: string;
      assignee_user_id: string | null;
      due_at: string | null;
      status: "open" | "done" | "cancelled";
    }>,
  ) => jpatch<ActionItem>(`/api/meetings/${meetingId}/actions/${actionId}`, body),
  deleteActionItem: (meetingId: string, actionId: string) =>
    jdelete(`/api/meetings/${meetingId}/actions/${actionId}`),

  // Theme 1 (P0): action item comments
  listActionComments: (meetingId: string, actionId: string) =>
    jget<ActionComment[]>(
      `/api/meetings/${meetingId}/actions/${actionId}/comments`,
    ),
  createActionComment: (meetingId: string, actionId: string, content: string) =>
    jpost<ActionComment>(
      `/api/meetings/${meetingId}/actions/${actionId}/comments`,
      { content },
    ),
  deleteActionComment: (
    meetingId: string,
    actionId: string,
    commentId: string,
  ) =>
    jdelete(
      `/api/meetings/${meetingId}/actions/${actionId}/comments/${commentId}`,
    ),

  // Theme 1 (P0): personal dashboard
  listMyActions: (status: "open" | "all" | "done" = "open") =>
    jget<MyAction[]>(`/api/me/actions?status=${status}`),
  listMyNotifications: (unreadOnly = false, limit = 50) =>
    jget<NotificationList>(
      `/api/me/notifications?unread_only=${unreadOnly}&limit=${limit}`,
    ),
  markNotificationRead: (id: string) =>
    jpostVoid(`/api/me/notifications/${id}/read`, {}),
  markAllNotificationsRead: () =>
    jpostVoid(`/api/me/notifications/read-all`, {}),

  // M3.0 agent message history (Cowork-friendly read-only)
  listAgentMessages: (meetingId: string) =>
    jget<AgentMessage[]>(`/api/meetings/${meetingId}/agent-messages`),

  // Agents
  listAgents: () => jget<Agent[]>("/api/agents"),
  createAgent: (a: AgentInput) => jpost<Agent>("/api/agents", a),
  updateAgent: (id: string, a: Partial<AgentInput>) => jpatch<Agent>(`/api/agents/${id}`, a),
  deleteAgent: (id: string) => jdelete(`/api/agents/${id}`),

  getMeetingBriefing: (id: string) =>
    jget<{ briefing_md: string | null; status: "ready" | "empty" }>(
      `/api/meetings/${id}/briefing`,
    ),
  /**
   * Download a meeting export. Returns the blob and a server-supplied
   * filename (parsed from Content-Disposition). Caller triggers the
   * actual save via an anchor click.
   */
  downloadMeetingExport: async (id: string, format: "md" | "docx") => {
    const r = await fetch(
      backendBase() + `/api/meetings/${id}/export?format=${format}`,
      { credentials: "include" },
    );
    if (!r.ok) {
      handleAuthError(r.status);
      const text = await r.text().catch(() => "");
      handleNetworkError(`/api/meetings/${id}/export`, r.status, text);
      throw makeError(`/api/meetings/${id}/export`, r.status, text);
    }
    const cd = r.headers.get("Content-Disposition") ?? "";
    let filename = `meeting.${format}`;
    // RFC 5987: filename*=UTF-8''<percent-encoded>
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) {
      try {
        filename = decodeURIComponent(star[1]);
      } catch {}
    } else {
      const plain = cd.match(/filename="?([^";]+)"?/i);
      if (plain) filename = plain[1];
    }
    return { blob: await r.blob(), filename };
  },

  listAudit: (action?: string, limit = 200) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (action) q.set("action", action);
    return jget<AuditEntry[]>(`/api/audit?${q.toString()}`);
  },

  // Knowledge base
  listKnowledgeBases: () => jget<KnowledgeBase[]>("/api/knowledge-bases"),
  createKnowledgeBase: (body: { name: string; description?: string }) =>
    jpost<KnowledgeBase>("/api/knowledge-bases", body),
  deleteKnowledgeBase: (id: string) => jdelete(`/api/knowledge-bases/${id}`),
  listKnowledgeDocuments: (kbId: string) =>
    jget<KnowledgeDocument[]>(`/api/knowledge-bases/${kbId}/documents`),
  uploadKnowledgeDocument: async (kbId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jpostForm<KnowledgeDocument>(
      `/api/knowledge-bases/${kbId}/documents`,
      fd,
    );
  },
  deleteKnowledgeDocument: (kbId: string, docId: string) =>
    jdelete(`/api/knowledge-bases/${kbId}/documents/${docId}`),
  reprocessKnowledgeDocument: (kbId: string, docId: string) =>
    jpost<KnowledgeDocument>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/reprocess`,
      {},
    ),

  // Long-term memory
  listMemories: (scope?: string, scopeRef?: string) => {
    const q = new URLSearchParams();
    if (scope) q.set("scope", scope);
    if (scopeRef) q.set("scope_ref", scopeRef);
    const s = q.toString();
    return jget<Memory[]>(`/api/memory${s ? `?${s}` : ""}`);
  },
  createMemory: (m: { scope: string; scope_ref?: string | null; content: string; importance?: number }) =>
    jpost<Memory>("/api/memory", m),
  deleteMemory: (id: string) => jdelete(`/api/memory/${id}`),

  getMeetingSummary: (id: string) =>
    jget<{
      summary_md: string | null;
      status: "pending" | "ready" | "failed" | "unconfigured" | "skipped";
      message?: string | null;
    }>(`/api/meetings/${id}/summary`),
  regenerateMeetingSummary: (id: string) =>
    jpost<{ summary_md: string | null; status: string }>(
      `/api/meetings/${id}/summary/regenerate`,
      {},
    ),

  correctSpeaker: (
    meetingId: string,
    lineId: number,
    speakerUserId: string | null,
  ) =>
    jpost<{ line_id: number; speaker_user_id: string | null; speaker_name: string | null; status: string }>(
      `/api/meetings/${meetingId}/transcripts/${lineId}/correct-speaker`,
      { speaker_user_id: speakerUserId },
    ),

  // Model providers
  providerCatalog: () => jget<ProviderCatalogEntry[]>("/api/model-providers/catalog"),
  listProviderConfigs: () => jget<ProviderConfig[]>("/api/model-providers"),
  saveProviderConfig: (
    provider: string,
    body: { provider: string; api_key: string; base_url?: string; model_id?: string; is_active?: boolean; note?: string },
  ) => jput<ProviderConfig>(`/api/model-providers/${provider}`, body),
  /**
   * Type-a-message endpoint — alternative to mic for the "live UX" path
   * when no WebSocket is attached, and the canonical entry for automation
   * (Claude Cowork). Persists a transcript row and fires Agent + dissent
   * triggers, just like a finalized ASR sentence does.
   */
  postManualTranscript: (
    meetingId: string,
    body: { text: string; speaker_user_id?: string | null },
  ) =>
    jpost<{
      line_id: number;
      speaker_user_id: string | null;
      speaker_name: string | null;
      text: string;
    }>(`/api/meetings/${meetingId}/manual-transcript`, body),

  activateProvider: (provider: string) =>
    jpost<ProviderConfig>(`/api/model-providers/${provider}/activate`, {}),
  deleteProviderConfig: (provider: string) => jdelete(`/api/model-providers/${provider}`),
  listProviderModels: (
    provider: string,
    body: { api_key?: string; base_url?: string },
  ) =>
    jpost<{ models: Array<{ id: string; label?: string | null }> }>(
      `/api/model-providers/${provider}/list-models`,
      body,
    ),
};
