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

/** Surface non-401 network errors as a toast so users get visible feedback
 *  even when individual call sites silently swallow the throw. */
function handleNetworkError(path: string, status: number, body: string) {
  if (typeof window === "undefined") return;
  if (status === 401) return; // handled by handleAuthError
  // Try to extract a useful message from FastAPI's {"detail": "..."} shape
  let detail = body.slice(0, 200);
  try {
    const parsed = JSON.parse(body);
    if (parsed?.detail) detail = String(parsed.detail);
  } catch {}
  if (status >= 500) {
    toast.error("服务器错误", { detail: `${status} ${path} :: ${detail}` });
  } else if (status === 404) {
    // 404s are often expected (e.g. polling for a resource) — only toast on
    // explicit user actions. We default to silent here; callers can toast
    // themselves where it matters.
    return;
  } else if (status >= 400) {
    toast.warn(`请求失败 (${status})`, { detail: `${path} :: ${detail}` });
  }
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(backendBase() + path, {
    cache: "no-store",
    credentials: "include",
  });
  if (!r.ok) {
    handleAuthError(r.status);
    handleNetworkError(path, r.status, "");
    throw new Error(`${path}: ${r.status}`);
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
    const body = await r.text().catch(() => "");
    handleNetworkError(path, r.status, body);
    throw new Error(`${path}: ${r.status} ${body}`);
  }
  return r.json();
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
    throw new Error(`${path}: ${r.status} ${body}`);
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

export type Meeting = {
  id: string;
  title: string;
  status: "scheduled" | "ongoing" | "finished" | "processed";
  started_at: string | null;
  ended_at: string | null;
  attendee_user_ids: string[];
};

export type TranscriptLine = {
  id: number;
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
    const body = await r.text().catch(() => "");
    handleNetworkError(path, r.status, body);
    throw new Error(`${path}: ${r.status} ${body}`);
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
    const body = await r.text().catch(() => "");
    handleNetworkError(path, r.status, body);
    throw new Error(`${path}: ${r.status} ${body}`);
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
    throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
  }
}

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
  createMeeting: (title: string, attendeeUserIds: string[]) =>
    jpost<Meeting>("/api/meetings", { title, attendee_user_ids: attendeeUserIds }),
  getMeeting: (id: string) => jget<Meeting>(`/api/meetings/${id}`),
  finalizeMeeting: (id: string) => jpost<Meeting>(`/api/meetings/${id}/finalize`, {}),
  meetingResult: (id: string) => jget<MeetingResult>(`/api/meetings/${id}/result`),

  // Agents
  listAgents: () => jget<Agent[]>("/api/agents"),
  createAgent: (a: AgentInput) => jpost<Agent>("/api/agents", a),
  updateAgent: (id: string, a: Partial<AgentInput>) => jpatch<Agent>(`/api/agents/${id}`, a),
  deleteAgent: (id: string) => jdelete(`/api/agents/${id}`),

  getMeetingBriefing: (id: string) =>
    jget<{ briefing_md: string | null; status: "ready" | "empty" }>(
      `/api/meetings/${id}/briefing`,
    ),

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
  activateProvider: (provider: string) =>
    jpost<ProviderConfig>(`/api/model-providers/${provider}/activate`, {}),
  deleteProviderConfig: (provider: string) => jdelete(`/api/model-providers/${provider}`),
};
