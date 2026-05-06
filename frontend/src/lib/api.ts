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
  createMeeting: (title: string, attendeeUserIds: string[]) =>
    jpost<Meeting>("/api/meetings", { title, attendee_user_ids: attendeeUserIds }),
  getMeeting: (id: string) => jget<Meeting>(`/api/meetings/${id}`),
  finalizeMeeting: (id: string) => jpost<Meeting>(`/api/meetings/${id}/finalize`, {}),
  meetingResult: (id: string) => jget<MeetingResult>(`/api/meetings/${id}/result`),
};
