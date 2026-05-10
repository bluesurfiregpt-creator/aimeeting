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

/** v23: 把 Response 解析成 (blob, filename) 给前端 anchor click 触发下载用.
 *  filename 优先取 Content-Disposition 的 RFC 5987 形式(filename*=UTF-8''…),
 *  fallback 普通 filename=,再 fallback 调用方传的 default. */
async function parseDownload(
  r: Response,
  defaultName: string,
): Promise<{ blob: Blob; filename: string }> {
  const cd = r.headers.get("Content-Disposition") ?? "";
  let filename = defaultName;
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

/** Theme 1 (P0) → v18: one bell-drawer entry. `payload` shape varies
 *  by `kind`; the UI switches on `kind` to format the line.
 *  `severity` (v18) drives the bell badge / row coloring. */
export type Notification = {
  id: string;
  kind:
    | "action_assigned"
    | "action_due_soon"
    | "action_overdue"
    | "action_comment"
    | "task_dispatched"
    | "task_accepted"
    | "task_returned"
    | "task_completed"
    | "task_submitted"
    | "task_approved"
    | "task_rejected"
    | "access_requested"
    | "access_approved"
    | "access_rejected"
    | "task_co_assigned"
    | "task_co_submitted"
    | "task_co_withdrawn"
    | "task_collaboration_rated"
    | "report_submitted"
    | "alert_fired"
    | "task_dispatch_overdue";
  severity: "normal" | "yellow" | "red" | "purple";
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationList = {
  items: Notification[];
  unread_count: number;
  /** v18: highest severity among ALL unread (not just the first page).
   *  Drives the bell badge color. */
  max_unread_severity: "normal" | "yellow" | "red" | "purple";
};

/** v17 → v19: Task as workspace-level first-class object.
 *  Status enum extends through the 8-state machine; v19 adds
 *  `submitted` (assignee 上报办结申请,等待审核) and `archived`
 *  (已办结归档). */
export type MyTask = {
  id: string;
  title: string | null;
  content: string;
  assignee_user_id: string | null;
  due_at: string | null;
  status:
    | "open"
    | "dispatched"
    | "accepted"
    | "in_progress"
    | "submitted"
    | "done"
    | "archived"
    | "cancelled";
  dispatched_at: string | null;
  dispatched_by_user_id: string | null;
  accepted_at: string | null;
  started_at: string | null;
  /** v21: 数据 5 级分级 */
  data_classification: DataClassification;
  /** v22.5: 协办列表(主责 = assignee_user_id) */
  co_assignees: string[];
  /** v22.5: 已 co-submit 的协办子集(可与 co_assignees 算 diff 找未交) */
  co_submitted_user_ids: string[];
  source_type:
    | "meeting"
    | "manual"
    | "leader_directive"
    | "upper_doc"
    | "cron"
    | "alert"
    | "report";
  source_ref: Record<string, unknown> | null;
  meeting_id: string | null;
  meeting_title: string | null;
  created_at: string;
  updated_at: string;
};

/** v23.5: Task 详情页一次拉全 — 时间线 / 协办进度 / 评分 / 评论. */
export type TaskTimelineEntry = {
  kind:
    | "created"
    | "dispatched"
    | "accepted"
    | "started"
    | "submitted"
    | "done"
    | "archived"
    | "cancelled";
  at: string; // ISO datetime
  actor_user_id: string | null;
  actor_name: string | null;
};

export type TaskCoProgress = {
  co_assignee_user_id: string;
  co_assignee_name: string | null;
  content: string | null;
  submitted_at: string;
};

export type TaskRating = {
  id: string;
  rater_user_id: string;
  rater_name: string | null;
  ratee_user_id: string;
  ratee_name: string | null;
  dimension: "quality" | "collaboration";
  score: number; // 1-5
  comment: string | null;
  created_at: string;
};

export type TaskComment = {
  id: string;
  action_item_id: string;
  author_user_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
};

export type TaskDetail = MyTask & {
  assignee_name: string | null;
  dispatched_by_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  /** uuid 字符串 → 名字(前端按 co_assignees 顺序渲染) */
  co_assignee_names: Record<string, string>;
  timeline: TaskTimelineEntry[];
  co_progress: TaskCoProgress[];
  ratings: TaskRating[];
  comments: TaskComment[];
};

/** v23.5: 会议追溯链 — 这次会议产生了哪些任务. */
export type MeetingTraceTask = {
  task_id: string;
  action_item_id: string;
  title: string | null;
  content: string;
  status: MyTask["status"];
  assignee_user_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  co_assignees: string[];
  data_classification: DataClassification;
  created_at: string;
  updated_at: string;
};

export type MeetingTrace = {
  meeting_id: string;
  meeting_title: string;
  tasks: MeetingTraceTask[];
  total: number;
  by_status: Record<string, number>;
};

/** v19: a leader directive (natural-language instruction) and the LLM-parsed
 *  draft Tasks waiting for the user to confirm/edit/dispatch. */
export type DirectiveDraft = {
  content: string;
  title: string | null;
  assignee_name: string | null;
  assignee_user_id: string | null;
  due_at: string | null;  // ISO date YYYY-MM-DD
};

export type LeaderDirective = {
  id: string;
  content: string;
  status: "draft" | "committed" | "discarded";
  drafts: DirectiveDraft[];
  committed_task_ids: string[];
  parse_error: string | null;
  created_at: string;
};

export type DirectiveCommitTask = {
  content: string;
  title?: string | null;
  assignee_user_id?: string | null;
  due_at?: string | null;  // ISO datetime
  dispatch?: boolean;
  /** v22.5: 协办列表(只在 dispatch=true 时有效;最多 5 人) */
  co_assignees?: string[] | null;
};

export type DirectiveCommitResult = {
  directive_id: string;
  committed_task_ids: string[];
  dispatched_count: number;
};

/** v24.1 #2: 用户主动上报问题 → Task(source_type='report'). */
export type ReportSeverity = "low" | "medium" | "high";

export type CreateReportIn = {
  title?: string | null;
  content: string;
  severity: ReportSeverity;
  /** 可选:这个问题源自哪场会议(让 trace 链路完整) */
  source_meeting_id?: string | null;
};

export type CreateReportOut = {
  task_id: string;
  notified_leaders: number;
};

/** v20: 上级文件触发源 — 上传文件 → 解析 → LLM 拆 Task 草稿. */
export type UpperDoc = {
  id: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
  extracted_text_preview: string | null;
  extracted_text_truncated: boolean;
  status: "draft" | "committed" | "discarded" | "failed";
  drafts: DirectiveDraft[];
  committed_task_ids: string[];
  parse_error: string | null;
  created_at: string;
};

/** v20: 定期巡检触发源 cron 规则. */
export type CronRule = {
  id: string;
  name: string;
  cron_expr: string;
  task_template_content: string;
  task_template_title: string | null;
  task_template_assignee_user_id: string | null;
  auto_dispatch: boolean;
  due_days_after: number | null;
  is_active: boolean;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
};

export type CronRuleInput = {
  name: string;
  cron_expr: string;
  task_template_content: string;
  task_template_title?: string | null;
  task_template_assignee_user_id?: string | null;
  auto_dispatch?: boolean;
  due_days_after?: number | null;
  is_active?: boolean;
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

/** v21: 角色枚举扩展.
 *  - owner / admin — 「领导/管理员」
 *  - leader — admin 的别名(智慧住建偏好)
 *  - expert — 绑定单一 Agent 的「专家权限」(必填 bound_agent_id)
 *  - member — legacy,默认值 */
export type TeamRole =
  | "owner"
  | "admin"
  | "leader"
  | "expert"
  | "member";

export type TeamMember = {
  user_id: string;
  name: string;
  email: string | null;
  role: TeamRole;
  bound_agent_id: string | null;
  bound_agent_name: string | null;
  joined_at: string;
};

/** v21: 数据 5 级分级值. */
export type DataClassification =
  | "core"        // 危害国家安全/公共利益
  | "important"   // 影响公众权益
  | "sensitive"   // 较敏感业务
  | "general"     // 中度敏感(默认)
  | "public";     // 内部/公开

export const CLASSIFICATION_LABELS: Record<DataClassification, string> = {
  core: "核心",
  important: "重要",
  sensitive: "敏感",
  general: "一般",
  public: "公开",
};

export const CLASSIFICATION_BADGE_CLASSES: Record<DataClassification, string> = {
  core: "bg-red-500/20 text-red-300",
  important: "bg-orange-500/20 text-orange-300",
  sensitive: "bg-amber-500/20 text-amber-300",
  general: "bg-zinc-700 text-zinc-300",
  public: "bg-emerald-500/20 text-emerald-300",
};

/** v22: dashboard 一次性聚合返回的所有 KPI / 图表数据. */
export type DashboardOverview = {
  // 顶部 4 KPI 卡
  total_tasks: number;
  pending_review: number;       // status='dispatched'
  overdue_red_purple: number;   // 已逾期 + status 不在终态
  completion_rate_this_month: number; // 0-1

  // 中部 / 底部图表
  by_status: { status: string; count: number }[];
  by_source: { source_type: string; count: number }[];
  workload: {
    user_id: string;
    name: string;
    open_count: number;
    overdue_count: number;
  }[];
  completion_30d: { date: string; completed: number; created: number }[];
  creation_7d: { date: string; completed: number; created: number }[];
  evaluations: {
    user_id: string;
    name: string;
    completion_rate: number;
    on_time_rate: number;
    quality_score: number;
    collaboration_score: number;
    composite: number;
  }[];

  // 元
  period: string;     // 'YYYY-MM'
  role: "leader" | "expert" | "member";
  scope_label: string;
};

/** v24.1: 智慧住建 16 AI 专家 seed 结果. */
export type SeedSCAgentsResult = {
  agents_created: number;
  agents_skipped: number;
  kbs_created: number;
  kbs_skipped: number;
  preset_set: boolean;
};

/** v24.1 #3: 4-维路由 单候选评分. */
export type RouteScore = {
  agent_id: string;
  agent_name: string;
  composite: number;
  breakdown: {
    keyword: number;
    history: number;
    load: number;
    capability: number;
    _hits?: string[];
    _history_count?: number;
    _candidate_load?: number;
  };
  candidate_user_id: string | null;
  candidate_user_name: string | null;
  candidate_user_active_count: number;
};

export type RoutePreview = {
  candidates: RouteScore[];  // 降序
  threshold: number;
  matched: boolean;  // 最高分是否过阈值
};

export type AutoRouteResult = {
  matched: boolean;
  threshold: number;
  winner?: RouteScore | null;
  task?: MyTask | null;  // 派发后的最新 task
  candidates: RouteScore[];
};

/** v24.1 #2: 异常预警 force-check 单条结果. */
export type AlertCheckResult = {
  would_fire: boolean;
  /** 触发了的话:新建的 task_id */
  task_id?: string;
  /** 触发了的话:实际观测值 */
  observed?: number;
  /** 触发了的话:阈值 */
  threshold?: number;
  /** 没触发的话:原因(样本不足 / 未达阈值) */
  reason?: string;
  error?: string;
};

export type AlertForceCheckResult = {
  overdue_rate: AlertCheckResult;
  assignee_overload: AlertCheckResult;
  agent_low_completion: AlertCheckResult;
};

export type SeedEvalResult = {
  period: string;
  inserted: number;
  updated: number;
};

/** v23: Kanban 卡片(Task 的 Kanban 视图变形) */
export type KanbanCard = {
  task_id: string;
  content: string;
  status: string;
  due_at: string | null;
  is_overdue: boolean;
  assignee_user_id: string | null;
  assignee_name: string | null;
  co_assignee_count: number;
  co_submitted_count: number;
  source_type: string;
  created_at: string;
};

export type KanbanColumn = {
  column_id: string;
  column_label: string;
  summary: string;
  cards: KanbanCard[];
};

export type KanbanOut = {
  grouping: "agent" | "user";
  columns: KanbanColumn[];
  period_label: string;
  role: "leader" | "expert" | "member";
  scope_label: string;
  include_closed: boolean;
};

/** v21: 跨 AI 数据访问申请. */
export type AccessRequest = {
  id: string;
  requester_user_id: string;
  target_resource_type: "task" | "kb_document" | "memory" | "agent";
  target_resource_id: string;
  target_owner_user_id: string | null;
  justification: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: string | null;
  decided_at: string | null;
  decided_by_user_id: string | null;
  decision_reason: string | null;
  created_at: string;
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
  // v21: admin 改成员的 role + bound_agent_id
  updateMember: (
    userId: string,
    body: { role?: TeamRole; bound_agent_id?: string | null },
  ) => jpatch<TeamMember>(`/api/team/members/${userId}`, body),
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

  // v23.5: 会议追溯链 — 这次会议产生了哪些 Task + 它们现在的状态
  getMeetingTrace: (id: string) =>
    jget<MeetingTrace>(`/api/meetings/${id}/trace`),

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

  // v17 → v19: Task lifecycle (派发 / 签收 / 退回 / 办理 / 上报 / 办结 / 归档 / 取消)
  listMyTasks: (
    status:
      | "active"
      | "all"
      | "open"
      | "dispatched"
      | "accepted"
      | "in_progress"
      | "submitted"
      | "done"
      | "archived"
      | "cancelled"
      | "pending"
      | "working"
      | "review" = "active",
    role: "assignee" | "reviewer" | "coassignee" = "assignee",
  ) => jget<MyTask[]>(`/api/me/tasks?status=${status}&role=${role}`),
  dispatchTask: (
    taskId: string,
    body: {
      assignee_user_id: string;
      due_at?: string | null;
      note?: string | null;
      co_assignees?: string[] | null;
    },
  ) => jpost<MyTask>(`/api/me/tasks/${taskId}/dispatch`, body),
  acceptTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/accept`, {}),
  returnTask: (taskId: string, reason?: string | null) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/return`, { reason }),
  startTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/start`, {}),
  completeTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/complete`, {}),
  cancelTask: (taskId: string, reason?: string | null) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/cancel`, { reason }),

  // v19: 上报办结申请 + 领导审核 + 归档
  // v22.5: 加 force 参数 — 当未交协办存在时,默认 422 警告;前端 confirm 后带 force=true 重试.
  submitTask: (taskId: string, note?: string | null, force = false) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/submit`, { note, force }),
  approveTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/approve`, {}),
  rejectTask: (taskId: string, reason?: string | null) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/reject`, { reason }),
  archiveTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/archive`, {}),

  // v22.5: 多 AI 协作 — co-submit / co-withdraw / rate
  coSubmitTask: (taskId: string, content?: string | null) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/co-submit`, { content }),
  coWithdrawTask: (taskId: string) =>
    jpost<MyTask>(`/api/me/tasks/${taskId}/co-withdraw`, {}),
  rateTaskCollaboration: (
    taskId: string,
    body: {
      ratee_user_id: string;
      dimension: "quality" | "collaboration";
      score: number; // 1-5
      comment?: string | null;
    },
  ) => jpost<{ ok: boolean }>(`/api/me/tasks/${taskId}/rate`, body),

  // v23.5: Task 详情页 — 一次拉全(基本+时间线+协办+评分+评论)
  getTaskDetail: (taskId: string) =>
    jget<TaskDetail>(`/api/me/tasks/${taskId}/detail`),

  // v24.1 #2: 用户主动上报问题(任何成员可发起,通知 leader/admin)
  createReport: (body: CreateReportIn) =>
    jpost<CreateReportOut>(`/api/me/reports`, body),

  // v19: 领导指令(自然语言)→ Task 草稿 → 批量入库
  createDirective: (content: string) =>
    jpost<LeaderDirective>(`/api/me/directives`, { content }),
  commitDirective: (
    directiveId: string,
    tasks: DirectiveCommitTask[],
  ) =>
    jpost<DirectiveCommitResult>(
      `/api/me/directives/${directiveId}/commit`,
      { tasks },
    ),
  discardDirective: (directiveId: string) =>
    jpostVoid(`/api/me/directives/${directiveId}/discard`, {}),
  listMyDirectives: (limit = 20) =>
    jget<LeaderDirective[]>(`/api/me/directives?limit=${limit}`),

  // v20: 上级文件 → 解析 → LLM 拆 Task 草稿 → 批量入库
  uploadUpperDoc: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jpostForm<UpperDoc>(`/api/me/upper-docs`, fd);
  },
  commitUpperDoc: (upperDocId: string, tasks: DirectiveCommitTask[]) =>
    jpost<DirectiveCommitResult>(
      `/api/me/upper-docs/${upperDocId}/commit`,
      { tasks },
    ),
  discardUpperDoc: (upperDocId: string) =>
    jpostVoid(`/api/me/upper-docs/${upperDocId}/discard`, {}),
  listMyUpperDocs: (limit = 20) =>
    jget<UpperDoc[]>(`/api/me/upper-docs?limit=${limit}`),

  // v22: 看板
  dashboardOverview: () =>
    jget<DashboardOverview>(`/api/dashboard/overview`),
  seedEvalData: (period?: string | null, overwrite = false) =>
    jpost<SeedEvalResult>(`/api/dashboard/seed-eval-data`, {
      period,
      overwrite,
    }),
  // v24.1: 智慧住建 16 AI 专家 + 1:1 KB seed(幂等)
  seedSmartConstructionAgents: () =>
    jpost<SeedSCAgentsResult>(
      `/api/dashboard/seed-smart-construction-agents`,
      {},
    ),
  // v24.1 #2: 手工跑一次 3 条异常预警规则(跳 24h dedup),用于 demo / 调试
  alertsForceCheck: () =>
    jpost<AlertForceCheckResult>(`/api/dashboard/alerts/force-check`, {}),

  // v24.1 #4: 手工跑一次 24h 签收超时扫描(平时 1h 自动)
  dispatchOverdueForceCheck: () =>
    jpost<{ notifications_emitted: number }>(
      `/api/dashboard/dispatch-overdue/force-check`,
      {},
    ),

  // v24.1 #3: 4-维自动派发路由(任何 user 可 preview;leader/admin 可 auto-route)
  previewRoute: (taskId: string) =>
    jget<RoutePreview>(`/api/me/tasks/${taskId}/route-preview`),
  autoRouteTask: (taskId: string) =>
    jpost<AutoRouteResult>(`/api/me/tasks/${taskId}/auto-route`, {}),

  // v23: 看板二期 — Kanban 视图
  kanbanByAgent: (includeClosed = false) =>
    jget<KanbanOut>(
      `/api/dashboard/kanban-by-agent?include_closed=${includeClosed}`,
    ),
  kanbanByUser: (includeClosed = false) =>
    jget<KanbanOut>(
      `/api/dashboard/kanban-by-user?include_closed=${includeClosed}`,
    ),

  // v23: 报表导出 — 返回 (blob, 服务端文件名),前端 anchor.click 触发下载
  downloadMonthlyEvaluation: async (period?: string | null) => {
    const q = period ? `?period=${period}` : "";
    const r = await fetch(backendBase() + `/api/reports/monthly-evaluation${q}`, {
      credentials: "include",
    });
    if (!r.ok) {
      handleAuthError(r.status);
      const text = await r.text().catch(() => "");
      handleNetworkError(`/api/reports/monthly-evaluation`, r.status, text);
      throw makeError(`/api/reports/monthly-evaluation`, r.status, text);
    }
    return parseDownload(r, "monthly-evaluation.xlsx");
  },
  downloadStatusDistribution: async (days = 30) => {
    const r = await fetch(
      backendBase() + `/api/reports/status-distribution?days=${days}`,
      { credentials: "include" },
    );
    if (!r.ok) {
      handleAuthError(r.status);
      const text = await r.text().catch(() => "");
      handleNetworkError(`/api/reports/status-distribution`, r.status, text);
      throw makeError(`/api/reports/status-distribution`, r.status, text);
    }
    return parseDownload(r, `status-distribution-${days}d.xlsx`);
  },

  // v21: 跨 AI 数据访问申请
  createAccessRequest: (body: {
    target_resource_type: "task" | "kb_document" | "memory" | "agent";
    target_resource_id: string;
    justification?: string | null;
  }) => jpost<AccessRequest>(`/api/me/access-requests`, body),
  listMyAccessRequests: (
    role: "requester" | "reviewer" = "requester",
    status: "all" | "pending" | "approved" | "rejected" | "expired" = "all",
    limit = 50,
  ) =>
    jget<AccessRequest[]>(
      `/api/me/access-requests?role=${role}&status=${status}&limit=${limit}`,
    ),
  approveAccessRequest: (
    id: string,
    approval_window_hours?: number | null,
  ) =>
    jpost<AccessRequest>(`/api/me/access-requests/${id}/approve`, {
      approval_window_hours,
    }),
  rejectAccessRequest: (id: string, reason?: string | null) =>
    jpost<AccessRequest>(`/api/me/access-requests/${id}/reject`, { reason }),

  // v20: 定期巡检触发源 cron 规则
  listCronRules: () => jget<CronRule[]>(`/api/cron-rules`),
  createCronRule: (body: CronRuleInput) =>
    jpost<CronRule>(`/api/cron-rules`, body),
  updateCronRule: (id: string, body: Partial<CronRuleInput>) =>
    jpatch<CronRule>(`/api/cron-rules/${id}`, body),
  deleteCronRule: (id: string) => jdelete(`/api/cron-rules/${id}`),
  forceFireCronRule: (id: string) =>
    jpost<{ rule_id: string; task_id: string }>(
      `/api/cron-rules/${id}/force-fire`,
      {},
    ),

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
