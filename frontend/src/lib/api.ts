// REST client. Resolved at runtime so the same bundle works under
// http://localhost:3000 and https://aimeeting.zhzjpt.cn.

function backendBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return ""; // same-origin via nginx
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(backendBase() + path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}
async function jpostForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(backendBase() + path, { method: "POST", body: form });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
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
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}
async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}
async function jdelete(path: string): Promise<void> {
  const r = await fetch(backendBase() + path, { method: "DELETE" });
  if (!r.ok && r.status !== 204)
    throw new Error(`${path}: ${r.status} ${await r.text().catch(() => "")}`);
}

export const api = {
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
    jget<{ summary_md: string | null; status: "pending" | "ready" | "failed" | "unconfigured" }>(
      `/api/meetings/${id}/summary`,
    ),
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
