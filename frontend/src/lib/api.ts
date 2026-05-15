// REST client. Resolved at runtime so the same bundle works under
// http://localhost:3000 and https://aimeeting.zhzjpt.cn.

function backendBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return ""; // same-origin via nginx
}

import { toast } from "./toast";

// Centralised handler so a 401 (or known "session is dead" 403) anywhere kicks
// the user back to /login without forcing every caller to remember.
//
// v26.5-P0-fix3: 也处理 403 + "工作空间不存在 / [需重新登录] / 账号已被禁用"
// 这种 死会话 (cookie 还在 但 ws 已删 / 账号禁用 等). 否则前端 6 个并发
// API 调用 同时 撞墙, 堆 6 条 toast 但 顶栏 不渲染 → 用户卡死无路可走.
function handleAuthError(status: number, body?: string) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  // Don't bounce while we're already on a public auth page
  if (path === "/login" || path === "/register") return;
  if (status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(path)}`);
    return;
  }
  // v26.5-P0-fix3: 403 + 已知 死会话 标志 → 也强制 logout
  if (status === 403 && body) {
    if (
      body.includes("工作空间不存在") ||
      body.includes("[需重新登录]") ||
      body.includes("账号已被禁用") ||
      body.includes("账号没有关联工作空间")
    ) {
      // 清 cookie + 跳 /login (没办法直接 await api.logout, location.assign 同步)
      document.cookie = "aimeeting_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      window.location.assign(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
  }
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
 *  even when individual call sites silently swallow the throw.
 *
 *  v26.4-fix4: 后端 4xx detail 用 `[类别] 描述` prefix 标 分类
 *  ([权限不足] / [操作受限] / [资源保护] / [需重新登录]).这里识别 prefix
 *  → toast 用 友好措辞 + 对应类型 (warn/info/error),让用户能区分
 *  "我没权限" vs "系统设计如此" vs "Bug".
 *  详见 docs/error-codes.md. */
function handleNetworkError(_path: string, status: number, body: string) {
  if (typeof window === "undefined") return;
  if (status === 401) return; // handled by handleAuthError
  const detail = friendlyDetail(status, body);
  if (status >= 500) {
    toast.error("服务器错误", { detail });
    return;
  }
  if (status === 404) {
    // 404s are often expected (e.g. polling for a resource) — only toast on
    // explicit user actions. We default to silent here; callers can toast
    // themselves where it matters.
    return;
  }
  if (status < 400) return;

  // 解析 [类别] prefix
  const m = detail.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (m) {
    const cat = m[1];
    const msg = m[2];
    if (cat === "权限不足") {
      toast.warn("权限不足", { detail: msg });
      return;
    }
    if (cat === "操作受限") {
      // 设计性拒绝 — 用 info (蓝) 而不是 warn (黄),告诉用户"不是 bug"
      toast.info("操作受限", { detail: msg });
      return;
    }
    if (cat === "资源保护") {
      toast.warn("资源保护", { detail: msg });
      return;
    }
    if (cat === "需重新登录") {
      toast.error("需重新登录", { detail: msg });
      return;
    }
  }

  // 没 prefix → fallback 老行为
  toast.warn(`请求失败 (${status})`, { detail });
}

function makeError(path: string, status: number, body: string): ApiError {
  return new ApiError(friendlyDetail(status, body), { status, path, rawBody: body });
}

async function jget<T>(path: string, opts?: { silent?: boolean }): Promise<T> {
  const r = await fetch(backendBase() + path, {
    cache: "no-store",
    credentials: "include",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    handleAuthError(r.status, body);
    // v26.4: silent 选项给后台轮询类 endpoint (例 /api/super/*) 用,
    // 避免 非超管 用户视角 撞 403 时 弹 toast.warn.
    if (!opts?.silent) handleNetworkError(path, r.status, body);
    throw makeError(path, r.status, body);
  }
  return r.json();
}
async function jpost<T>(path: string, body: unknown, opts?: { silent?: boolean }): Promise<T> {
  const r = await fetch(backendBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    handleAuthError(r.status, text);
    if (!opts?.silent) handleNetworkError(path, r.status, text);
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
    const text = await r.text().catch(() => "");
    handleAuthError(r.status, text);
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
    const body = await r.text().catch(() => "");
    handleAuthError(r.status, body);
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
  attendee_agent_ids?: string[];  // v25.7-#1: 邀请的 AI 专家
  agenda?: AgendaItem[] | null;
  // v26.3 召集人模式
  mode?: "human" | "hybrid" | "auto";
  auto_state?: Record<string, unknown> | null;
  // v26.14-P5.2: 会议 创建人 — 前端 据此 显/隐 议程 推进 按钮
  created_by_user_id?: string | null;
};

/** v26.14-P5.1: 议程 进度 — agenda 项 + 各 项 时间/状态. */
export type AgendaProgressItem = {
  idx: number;
  title: string;
  time_budget_min?: number | null;
  note?: string | null;
  started_at: string | null;
  ended_at: string | null;
  elapsed_seconds: number | null;
  status: "active" | "done" | "pending";
  advanced_by_user_id: string | null;
};

export type AgendaProgress = {
  current_idx: number | null;
  total_items: number;
  is_complete: boolean;
  has_agenda: boolean;
  items: AgendaProgressItem[];
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
  // v25.14: 关联 Task 的流转状态(行动项 + 流转 合一)
  task_id?: string | null;
  task_status?: string | null;
  task_assignee_name?: string | null;
  task_co_assignees_count?: number;
  // v25.15: 实录依据(LLM 抽时记下的支撑句 — 短摘要预览)
  evidence_quote?: string | null;
  // v25.19: 实录行号锚点 — 前端拿到后 可跳转到 /meeting/{mid}?focus=<ids>
  // 实录页 useSearchParams 读 focus,自动滚动 + 高亮 + 展开上下文 ±3 句.
  evidence_anchor_line_ids?: number[] | null;
  // v26.0: 主责 AI 专家 — 任务真正的主人(科室专家).assignee_user_id 现在
  // 是 agent.primary_user_id (科室账号) 的 derive 字段.UI 优先 显示 agent.
  assignee_agent_id?: string | null;
  assignee_agent_name?: string | null;
  assignee_agent_color?: string | null;
  // v26.0: 协办 AI 专家(若有,会在任务办结时一并吸收知识库)
  co_agent_ids?: string[] | null;
  co_agent_count?: number;
  // v26.0: LLM 抽取时给的主题关键词(用于诊断 + 后续重路由)
  topic_keywords?: string[] | null;
};

/** v24.3 #1: 单条 RAG 引用(KB chunk)— 智慧住建文档 §3.1 引用溯源角标. */
export type AgentCitation = {
  chunk_id: string;
  document_id: string;
  document_filename: string;
  chunk_index: number;
  snippet: string;  // 命中片段前 240 字
  distance: number; // 0-1 cosine distance(越小越相关)
};

/** M3.0: one persisted Agent reply in a meeting. Read-only post-hoc — for
 *  Cowork to verify keyword/@-mention triggers fired correctly without
 *  needing to subscribe to the live WS. */
export type AgentMessage = {
  id: number;
  agent_id: string;
  text: string;
  trigger: string | null;
  /** v24.3 #1: 该回答引用的 KB chunks(0-4 条) */
  citations: AgentCitation[];
  created_at: string;
  /** v26.3-02: 同议程内 reply chain (consensus 收集时填). Hybrid 会议为 null. */
  reply_to_agent_message_id?: number | null;
  /** v26.3-02: 该发言所属议程序号 (auto/hybrid 均填). 旧数据为 null. */
  agenda_idx?: number | null;
};

/** v26.3-02: 每议程一行的 consensus + dissent 记录. 全 AI auto 会议产物;
 *  hybrid 会议暂不写入. */
export type MeetingDissent = {
  point: string;
  summary: string;
  involved_agents: string[];
};

export type MeetingConsensus = {
  id: string;
  agenda_idx: number;
  agenda_title: string | null;
  consensus_md: string | null;
  dissents: MeetingDissent[];
  needs_human_review: boolean;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_decision: string | null;
  /** Adequacy 判断后 agenda 实际跑了几轮 (含 moderator wrap_up). */
  turn_count: number | null;
  /** Orchestrator 估算的 token 数 (None 表示未估算). */
  token_estimate: number | null;
  /** 该议程从 intro 到 wrap_up 的耗时(秒). */
  elapsed_sec: number | null;
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
  /** v26.12-Home: 拟人外号 (可选, 例 "数妙妙"). NULL 时 fallback name. */
  nickname?: string | null;
  avatar_url: string | null;
  // v26.9-Avatar: AI "数字员工" 3 种形象
  full_body_url?: string | null;          // 静态全身 200x388
  full_body_animated_url?: string | null; // 动图全身 200x388
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
  /** v26.0: 该 AI 专家 绑定 的 科室账号 — 任务派给 agent 时,实际接受任务的
   *  user.UI 上 "主责" 显示 agent.name,旁标 "由 <primary_user.name> 操作". */
  primary_user_id?: string | null;
  primary_user_name?: string | null;
  /** v26.12-Home: 累计 调用次数 — 首页 卡片 "1247 次使用" + 最热排序基准. */
  invoke_count?: number;
  created_at: string;
};

/** v26.14-P3: AI 履历 — 该 AI 历史 发言 聚合, 详情页 履历 tab 用. */
export type AgentActivity = {
  total_lines: number;
  total_meetings: number;
  recent_meetings: Array<{
    meeting_id: string;
    title: string;
    status: string;
    started_at: string | null;
    lines_by_agent: number;
  }>;
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
  // v26.5-02a: 归属 AI 信息 (manager 看自己 KB 的徽章 + 决定可写)
  owner_agent_id?: string | null;
  owner_agent_name?: string | null;
  can_write?: boolean;
  // v26.5-Lineage P2: 反向查 — 这个 KB 被哪些 agent 引用 (Agent.knowledge_base_ids 含此 KB)
  referenced_by_agent_ids?: string[];
  referenced_by_agent_names?: string[];
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

// v26.5-Lineage: memory 关联的 agent 简版
export type MemoryAgentBrief = {
  id: string;
  name: string;
  is_primary: boolean;
};

export type Memory = {
  id: string;
  scope: "user" | "project" | "org";
  scope_ref: string | null;
  content: string;
  importance: number;
  source_type: string | null;
  source_id: string | null;
  // v26.5-Lineage: 多对多 agents (替代 单 agent_id/agent_name)
  agents?: MemoryAgentBrief[];
  // 溯源
  source_meeting_id?: string | null;
  source_action_item_id?: string | null;
  curated_by_user_id?: string | null;
  curated_at?: string | null;
  created_at: string;
};

// v26.5-Lineage: Memory 审批草稿
export type MemoryDraft = {
  id: string;
  workspace_id: string;
  source_type: string;
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  source_task_id: string | null;
  source_task_title: string | null;
  target_agent_ids: string[];
  target_agent_names: string[];
  primary_user_id: string;
  proposed_content: string;
  proposed_scope: string;
  proposed_scope_ref: string | null;
  proposed_importance: number;
  proposed_data_classification: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decision_reason: string | null;
  decided_at: string | null;
  committed_memory_id: string | null;
  created_at: string;
};

// v26.6-01: AI 模板生成器 — 单个 agent draft
export type AgentTemplateDraft = {
  name: string;
  domain: string | null;
  persona: string | null;
  keywords: string[];
  color: string | null;
  suggested_kb_seed?: string | null;
  suggested_memory_seeds?: string[];
};

// v26.5-Lineage P2: 数据血缘图
export type LineageNode = {
  id: string;
  type: "meeting" | "upload" | "kb_doc" | "memory" | "agent";
  label: string;
  meta?: Record<string, unknown> | null;
};

export type LineageEdge = {
  source: string;
  target: string;
  kind: "source" | "primary" | "subscriber" | "reference" | "sediment_pending";
  weight?: number;
};

export type LineageOut = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  stats: {
    agents: number;
    kb_docs: number;
    memories: number;
    meetings: number;
    uploads: number;
    // v26.7-04: 待审批草稿数 (kb_sedimentation_draft + memory_draft, status=pending)
    pending_drafts?: number;
  };
};

// v26.5-02c: KB 沉淀审批草稿
export type SedimentationDraft = {
  id: string;
  workspace_id: string;
  task_id: string;
  task_title: string | null;
  target_agent_id: string;
  target_agent_name: string | null;
  target_kb_id: string | null;
  proposed_summary: string;
  curator_user_id: string | null;
  curator_user_name: string | null;
  primary_user_id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decision_reason: string | null;
  decided_at: string | null;
  consolidated_at: string | null;
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
    const text = await r.text().catch(() => "");
    handleAuthError(r.status, text);
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
    const text = await r.text().catch(() => "");
    handleAuthError(r.status, text);
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
    const text = await r.text().catch(() => "");
    handleAuthError(r.status, text);
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
    | "task_dispatch_overdue"
    | "task_penalty"
    | "user_suspended"
    // v26.6-02: v26.5 沉淀审批 5 个新 kind
    | "kb_sedimentation_pending"
    | "kb_sedimentation_approved"
    | "kb_sedimentation_rejected"
    | "memory_draft_pending"
    | "memory_draft_approved"
    | "memory_draft_rejected";
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
  /** v26.0: 主责 AI 专家(任务的真正主人).assignee_user_id 是 agent
   *  绑定 的 科室账号 (= agent.primary_user_id),作为 derive 字段.UI 应该
   *  优先显示 agent name + color + 头像;科员 user 是小字 / 二级信息. */
  assignee_agent_id?: string | null;
  assignee_agent_name?: string | null;
  assignee_agent_color?: string | null;
  /** v26.0: 协办 AI 专家 ids + names */
  co_agent_ids?: string[];
  co_agent_names?: string[];
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

// v26.5-Profile: 简版 agent 信息 — 我作为 primary_user 的 AI 列表
export type MyAgentBrief = {
  id: string;
  name: string;
  color: string | null;
  domain: string | null;
  kb_count: number;
  is_active: boolean;
};

// v26.5-Profile: 任务速览 — 各状态计数
export type MyTaskCounts = {
  pending: number;  // 待签收 (dispatched)
  working: number;  // 办理中 (accepted + in_progress)
  review: number;   // 待审核 (submitted)
  // v26.5-02c: 待我审批的 KB 沉淀数
  kb_sedimentation_pending?: number;
  // v26.5-Lineage: 待我审批的 Memory 草稿数
  memory_draft_pending?: number;
};

export type Me = {
  user_id: string;
  name: string;
  email: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  role: string;
  // v26.5-Profile: 扩展字段 — 老 client 兼容 (Optional)
  department?: string | null;
  primary_agents?: MyAgentBrief[];
  bound_agent_id?: string | null;
  task_counts?: MyTaskCounts | null;
};

/** v21 → v26.5: 角色枚举扩展.
 *  - owner / admin — 「领导/管理员」
 *  - leader — admin 的别名 (智慧住建偏好)
 *  - manager — v26.5 新, 部门 AI 维护人 (取代 v21 expert)
 *  - expert — v21 兼容, deprecated by manager
 *  - member — 默认成员 */
export type TeamRole =
  | "owner"
  | "admin"
  | "leader"
  | "manager"
  | "expert"
  | "member";

export type TeamMember = {
  user_id: string;
  name: string;
  email: string | null;
  role: TeamRole;
  bound_agent_id: string | null;
  bound_agent_name: string | null;
  /** v24.3 #3: 暂停派单截止时间(NULL=未暂停;过去时间=已自动恢复) */
  suspended_until: string | null;
  /** v24.3 #5: ABAC 雏形 — 科室名 + 自定义属性 */
  department: string | null;
  attributes: Record<string, unknown> | null;
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

/** v24.1 #3 → v26.0: agent-centric 4(+1) 维路由 单候选评分.
 *  v25 字段名 (keyword/capability, candidate_user_*) 保留作 兼容,
 *  新前端用 v26 规范字段 (semantic/knowledge/availability, primary_user_*). */
export type RouteScore = {
  agent_id: string;
  agent_name: string;
  agent_color?: string | null;  // v26.0
  composite: number;
  breakdown: {
    // v26.0+ 维度
    semantic?: number;
    knowledge?: number;
    availability?: number;
    // v25 兼容字段名(仍可能在 老 client / 老数据 上看到)
    keyword?: number;
    capability?: number;
    // 共用
    history: number;
    load: number;
    _hits?: string[];
    _history_count?: number;
    _candidate_load?: number;
    // v26.1 诊断字段
    _completion_rate?: number;       // 历史任务完成率 (0-1)
    _kb_hits?: number;               // KB 检索命中 chunk 数
    _kb_used_embedding?: boolean;    // 是否真用了 embedding (false = 退化到配置近似)
  };
  // v25 兼容字段
  candidate_user_id: string | null;
  candidate_user_name: string | null;
  candidate_user_active_count: number;
  // v26.0 规范字段(同一个 user,只是命名清楚 — primary_user = agent 绑的科室账号)
  primary_user_id?: string | null;
  primary_user_name?: string | null;
  primary_user_active_count?: number;
};

export type RoutePreview = {
  candidates: RouteScore[];  // 降序
  threshold: number;
  matched: boolean;  // 最高分是否过阈值
  /** v26.0: high (≥0.60 auto-dispatch) | medium (0.40-0.60 推荐让 leader 确认) | low (<0.40 全手动) */
  confidence_tier?: "high" | "medium" | "low";
};

export type AutoRouteResult = {
  matched: boolean;
  threshold: number;
  winner?: RouteScore | null;
  task?: MyTask | null;  // 派发后的最新 task
  candidates: RouteScore[];
  /** v26.0 */
  confidence_tier?: "high" | "medium" | "low";
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
  // v26.5-Profile: 个人中心 自助 改名 + 改密码
  updateMe: (body: { name?: string }) =>
    jpatch<Me>("/api/auth/me", body),
  changePassword: (body: { old_password: string; new_password: string }) =>
    jpost<{ ok: boolean }>("/api/auth/me/change-password", body),
  invitePreview: (token: string) =>
    jget<InvitePreview>(`/api/auth/invite/${token}`),
  forgotPassword: (email: string) =>
    jpost<{ ok: boolean }>("/api/auth/forgot-password", { email }),
  resetPassword: (token: string, new_password: string) =>
    jpost<Me>("/api/auth/reset-password", { token, new_password }),

  // Team
  listMembers: () => jget<TeamMember[]>("/api/team/members"),
  removeMember: (userId: string) => jdelete(`/api/team/members/${userId}`),
  // v21+v24.3 #5: admin 改成员的 role + bound_agent_id + 科室
  updateMember: (
    userId: string,
    body: {
      role?: TeamRole;
      bound_agent_id?: string | null;
      department?: string | null;
    },
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
    attendeeAgentIds?: string[],  // v25.7-#1
    mode?: "human" | "hybrid" | "auto",  // v26.3
  ) =>
    jpost<Meeting>("/api/meetings", {
      title,
      attendee_user_ids: attendeeUserIds,
      ...(agenda && agenda.length ? { agenda } : {}),
      ...(attendeeAgentIds && attendeeAgentIds.length
        ? { attendee_agent_ids: attendeeAgentIds }
        : {}),
      ...(mode ? { mode } : {}),
    }),
  getMeeting: (id: string) => jget<Meeting>(`/api/meetings/${id}`),
  finalizeMeeting: (id: string) => jpost<Meeting>(`/api/meetings/${id}/finalize`, {}),
  // v26.14-P2: 本场会议 收获 — action items + memory 草稿 + KB 草稿 统计 + 列表
  harvestMeeting: (id: string) =>
    jget<{
      action_items_total: number;
      action_items_open: number;
      action_items_done: number;
      memory_drafts_total: number;
      memory_drafts_pending: number;
      memory_drafts_approved: number;
      kb_drafts_total: number;
      kb_drafts_pending: number;
      kb_drafts_approved: number;
      action_items: Array<{
        id: string;
        content: string;
        status: string;
        assignee_user_name: string | null;
        assignee_name_hint: string | null;
        due_at: string | null;
      }>;
      memory_drafts: Array<{
        id: string;
        proposed_content: string;
        status: string;
        created_at: string;
      }>;
      kb_drafts: Array<{
        id: string;
        proposed_summary_preview: string;
        status: string;
        created_at: string;
      }>;
    }>(`/api/meetings/${id}/harvest`),
  meetingResult: (id: string) => jget<MeetingResult>(`/api/meetings/${id}/result`),
  // v26.11-fix2: 会议室 邀请 新 AI 加入 会议
  inviteMeetingAgents: (
    id: string,
    agent_ids: string[],
  ) =>
    jpost<{
      added: string[];
      already_invited: string[];
      invalid: string[];
      attendee_agent_ids: string[];
    }>(`/api/meetings/${id}/agents`, { agent_ids }),

  // v26.14-P5.1: 议程 进度 + 推进
  getAgendaProgress: (id: string) =>
    jget<AgendaProgress>(`/api/meetings/${id}/agenda-progress`),
  advanceAgenda: (id: string) =>
    jpost<AgendaProgress>(`/api/meetings/${id}/agenda-advance`, {}),
  jumpAgenda: (id: string, idx: number) =>
    jpost<AgendaProgress>(`/api/meetings/${id}/agenda-jump`, { idx }),
  // v26.14-P5.1: dev 工具 — 仅 owner 可调; 测 三档 UI 用
  devInjectMonitorEvent: (
    id: string,
    payload: {
      event_type: "agenda_off_topic" | "agenda_stuck" | "agenda_time_warning";
      off_topic_severity?: "suspected" | "confirmed" | "severe";
      off_topic_summary?: string;
      current_agenda_item?: string;
      suggested_agenda_item?: string;
      stuck_summary?: string;
      auto_summon_after_s?: number;
      time_warning_text?: string;
      elapsed_min?: number;
      reason?: string;
    },
  ) => jpost<{ ok: boolean; injected: Record<string, unknown> }>(
    `/api/meetings/${id}/dev/inject-monitor-event`,
    payload,
  ),

  // v26.3-03: agent messages + consensus
  listMeetingConsensus: (meetingId: string) =>
    jget<MeetingConsensus[]>(`/api/meetings/${meetingId}/consensus`),

  // v26.4 Platform Admin (跨 workspace 平台超管).
  // v26.4-fix1: 全部用 silent — 非超管 user 撞 403 时不弹 toast 干扰.
  // 调用方需要 toast 自己在 catch 里 toast (例 /super page 的 createWorkspace).
  superMe: () =>
    jget<{
      is_platform_admin: boolean;
      email: string | null;
      platform_admin_emails_count: number;
    }>("/api/super/me", { silent: true }),
  superListWorkspaces: (includeArchived = false) =>
    jget<
      Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        preset_name: string | null;
        created_at: string;
        last_active_at: string | null;
        user_count: number;
        agent_count: number;
        meeting_count: number;
      }>
    >(`/api/super/workspaces?include_archived=${includeArchived}`, { silent: true }),
  superCreateWorkspace: (body: {
    name: string;
    owner_email: string;
    owner_name: string;
    temp_password?: string;
    seed_demo?: boolean;
    create_invite?: boolean;
  }) =>
    jpost<{
      workspace_id: string;
      workspace_name: string;
      workspace_slug: string;
      owner_user_id: string;
      owner_email: string;
      temp_password: string | null;
      invite_url: string | null;
    }>("/api/super/workspaces", body, { silent: true }),
  superSwitchWorkspace: (wsId: string) =>
    jpost<{
      workspace_id: string;
      workspace_name: string;
      workspace_slug: string;
      note: string;
    }>(`/api/super/switch/${wsId}`, {}, { silent: true }),

  // v26.3-07: 召集人会后批量裁决分歧 (Q1=A 4选1 + 必填 rationale)
  reviewMeetingConsensus: (
    meetingId: string,
    agendaIdx: number,
    body: {
      reviews: Array<{
        dissent_idx: number;
        action: "pick_a" | "pick_b" | "compromise" | "defer";
        rationale: string;
      }>;
    },
  ) =>
    jpost<MeetingConsensus>(
      `/api/meetings/${meetingId}/consensus/${agendaIdx}/review`,
      body,
    ),

  // v26.3-03: Auto Meeting Orchestrator 控制
  getOrchestrateState: (meetingId: string) =>
    jget<{
      phase: "idle" | "running" | "paused" | "consensus_wait" | "done" | "failed" | "cancelled";
      current_agenda_idx: number;
      current_speaker_agent_id: string | null;
      turn_count: number;
      dissent_count: number;
      started_at: string | null;
      paused_at: string | null;
      last_error: string | null;
      completed_agenda_count: number;
      total_agenda_count: number;
      // v26.3-08: 已 running 累计秒数 (paused 不算) + 整场硬上限
      running_elapsed_sec: number;
      max_meeting_sec: number;
    }>(`/api/meetings/${meetingId}/orchestrate/state`),
  orchestrateStart: (meetingId: string) =>
    jpost(`/api/meetings/${meetingId}/orchestrate/start`, {}),
  orchestratePause: (meetingId: string) =>
    jpost(`/api/meetings/${meetingId}/orchestrate/pause`, {}),
  orchestrateResume: (meetingId: string) =>
    jpost(`/api/meetings/${meetingId}/orchestrate/resume`, {}),
  orchestrateCancel: (meetingId: string) =>
    jpost(`/api/meetings/${meetingId}/orchestrate/cancel`, {}),

  // v25.11: 清掉某会议 LLM 自动提取的 action items(history hallucination 一键清)
  wipeAutoActions: (meetingId: string) =>
    jpost<{ deleted_actions: number; deleted_tasks: number }>(
      `/api/meetings/${meetingId}/action-items/wipe-auto-extracted`,
      {},
    ),

  // v25.18: ⚠️ 完整重置派生数据 — 清掉 summary / action_items / tasks / agent_msgs /
  // speaker_segments / notifications,然后异步重跑 summary → action_extractor.
  // 只保留 实录 + 参会名单.
  resetMeetingDerived: (meetingId: string) =>
    jpost<{
      deleted_actions: number;
      deleted_tasks: number;
      deleted_action_comments: number;
      deleted_agent_messages: number;
      deleted_speaker_segments: number;
      deleted_notifications: number;
      summary_cleared: boolean;
      regenerate_scheduled: boolean;
    }>(`/api/meetings/${meetingId}/derived/reset`, {}),

  // v25.10 Bug C: 批量纠正"此后 N 句"
  batchCorrectSpeaker: (
    meetingId: string,
    fromLineId: number,
    count: number,
    speakerUserId: string | null,
  ) =>
    jpost<{ updated: number; speaker_name: string | null }>(
      `/api/meetings/${meetingId}/transcripts/batch-correct-speaker`,
      { from_line_id: fromLineId, count, speaker_user_id: speakerUserId },
    ),

  // v25.9: workspace 级 ASR 词表 admin
  getAsrVocabulary: () =>
    jget<{
      dashscope_vocab_id: string | null;
      entries: Array<{ text: string; weight: number; lang: string }>;
      last_synced_at: string | null;
      sync_status: string;
      sync_error: string | null;
      target_model: string;
      max_entries: number;
    }>(`/api/asr-vocabulary`),
  saveAsrVocabulary: (entries: Array<string | { text: string; weight?: number; lang?: string }>) =>
    jpost<{
      dashscope_vocab_id: string | null;
      entries: Array<{ text: string; weight: number; lang: string }>;
      last_synced_at: string | null;
      sync_status: string;
      sync_error: string | null;
      target_model: string;
    }>(`/api/asr-vocabulary/save`, { entries }),
  importAsrVocabFromMeeting: (meetingId: string) =>
    jpost<{
      entries: Array<{ text: string; weight: number; lang: string }>;
      dashscope_vocab_id: string | null;
      sync_status: string;
    }>(`/api/asr-vocabulary/import-from-meeting/${meetingId}`, {}),
  resyncAsrVocabulary: () =>
    jpost<{
      dashscope_vocab_id: string | null;
      sync_status: string;
      sync_error: string | null;
      entries: Array<{ text: string; weight: number; lang: string }>;
    }>(`/api/asr-vocabulary/resync`, {}),

  // v25.8-#4: 离线 ASR 复跑(高清,2-5 分钟)
  rerunOfflineAsr: (id: string) =>
    jpost<{
      started: boolean;
      task_id: string | null;
      sentences: number;
      model: string;
      elapsed_s: number;
      next_step: string;
    }>(`/api/meetings/${id}/offline-asr/rerun`, {}),

  // v25.8-#3: 看会议自动收集的 hot words(用户拷贝去 DashScope vocab)
  meetingHotWords: (id: string) =>
    jget<{
      attendee_names: string[];
      agent_keywords: string[];
      kb_titles: string[];
      total: number;
      suggestion: string;
    }>(`/api/meetings/${id}/hot-words`),

  // v25.7-#4: 声纹识别 重跑 + debug
  rerunIdentify: (id: string) =>
    jpost<{ started: boolean; note: string; meeting_status: string }>(
      `/api/meetings/${id}/identify/rerun`,
      {},
    ),
  identifyDebug: (id: string) =>
    jget<{
      meeting_id: string;
      pyannote_job_id: string | null;
      voiceprint_count: number;
      voiceprints: Array<{ user_id: string; user_name: string; label: string; embedding_dim: number }>;
      segment_count_total: number;
      segment_count_kept: number;
      segments: Array<{
        label: string;
        user_id: string | null;
        user_name: string | null;
        start_ms: number;
        end_ms: number;
        duration_ms: number;
        confidence: number;
        status: string;
      }>;
      transcript_lines: number;
      transcript_with_speaker: number;
      transcript_unknown: number;
      threshold_used: number;
      notes: string[];
    }>(`/api/meetings/${id}/identify/debug`),

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

  // v25.22: 通知 治理 — 删单条 / 根源清理 / 孤儿清理
  deleteNotification: (id: string) => jdelete(`/api/me/notifications/${id}`),
  // 删通知 + 关联 action_item + paired task + 跨用户 同 action_id 通知
  cleanupNotificationSource: (id: string) =>
    jpost<{
      notification_deleted: boolean;
      action_item_deleted: boolean;
      task_deleted: boolean;
      related_notifications_deleted: number;
    }>(`/api/me/notifications/${id}/cleanup-source`, {}),
  // 一键扫:payload.action_id 指向 已不存在 action_item 的通知 → 删
  cleanupOrphanNotifications: () =>
    jpost<{
      scanned: number;
      deleted_orphans: number;
    }>(`/api/me/notifications/cleanup-orphans`, {}),

  // v26.2: 任务办结 → AI 专家 KB 沉淀
  previewConsolidateTask: (taskId: string) =>
    jget<{
      preview_markdown: string;
      target_kb_id: string | null;
      target_kb_name: string;
      target_kb_exists: boolean;
      target_agent_id: string;
      target_agent_name: string;
      warnings: string[];
      already_consolidated: boolean;
      consolidated_at: string | null;
    }>(`/api/me/tasks/${taskId}/consolidate/preview`),
  consolidateTask: (
    taskId: string,
    body: {
      override_summary?: string | null;
      force?: boolean;
      target_agent_id?: string | null;
    },
  ) =>
    jpost<{
      document_id: string;
      kb_id: string;
      kb_name: string;
      kb_created: boolean;
      agent_id: string;
      agent_name: string;
      chunk_count: number;
      char_count: number;
      used_override: boolean;
    }>(`/api/me/tasks/${taskId}/consolidate`, body),

  // v17 → v19: Task lifecycle (派发 / 签收 / 退回 / 办理 / 上报 / 办结 / 归档 / 取消)
  // v26.0: role 增 agent_rep (我作为 AI 专家的科室代表) + all_pending (admin 全局待派发)
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
    role:
      | "assignee"
      | "reviewer"
      | "coassignee"
      | "agent_rep"
      | "all_pending" = "assignee",
  ) => jget<MyTask[]>(`/api/me/tasks?status=${status}&role=${role}`),
  // v26.0: dispatchTask 加 assignee_agent_id 字段(派给 AI 专家);assignee_user_id
  // 改为 optional (后端会从 agent.primary_user_id derive)
  dispatchTask: (
    taskId: string,
    body: {
      assignee_agent_id?: string;
      assignee_user_id?: string;
      due_at?: string | null;
      note?: string | null;
      co_assignees?: string[] | null;
      co_agent_ids?: string[] | null;
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
  // v24.1 #5: 阶段性上报模板(智慧住建文档 §4.3)— 结构化 4 段
  submitTaskStructured: (
    taskId: string,
    body: {
      completed?: string | null;
      problems?: string | null;
      next_steps?: string | null;
      evidence_urls?: string[] | null;
      note?: string | null;  // 自由发挥文本(可选)
      force?: boolean;
    },
  ) => jpost<MyTask>(`/api/me/tasks/${taskId}/submit`, body),
  // v24.1 #6: AI 辅助起草汇报 — 5-15s LLM 调用,返回 3 段草稿给 SubmitDialog
  draftSubmission: (taskId: string) =>
    jpost<{
      completed: string;
      problems: string;
      next_steps: string;
      error: string | null;
    }>(`/api/me/tasks/${taskId}/draft-submission`, {}),

  // v24.2 #3: 公文智能审核(LLM 三维:format / wording / policy)
  auditDocument: (text: string, sourceKbDocId?: string | null) =>
    jpost<{
      issues: {
        severity: "high" | "medium" | "low";
        category: "format" | "wording" | "policy";
        location: string;
        issue: string;
        suggestion: string;
      }[];
      overall: string;
      audited_chars: number;
      truncated: boolean;
      fallback_used: boolean;
      error: string | null;
    }>(`/api/me/documents/audit`, {
      text,
      ...(sourceKbDocId ? { source_kb_doc_id: sourceKbDocId } : {}),
    }),
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
  // v24.3 #3: 手工跑一次超时扣分扫描(平时 1h 自动)
  penaltiesForceCheck: () =>
    jpost<{ new_penalties: number }>(
      `/api/dashboard/penalties/force-check`,
      {},
    ),
  // v24.3 #4: 手工跑一次月结评价(平时月初自动)
  monthlyEvalForceRun: (period?: string | null) =>
    jpost<{ period: string; workspaces: number; users: number }>(
      `/api/dashboard/monthly-eval/force-run`,
      { period: period ?? null },
    ),

  // v24.2 #4: 3 个指标的趋势分析(mean/std/z-score/slope/forecast/anomaly)
  trends: (days = 30) =>
    jget<{
      days: number;
      metrics: Record<string, {
        label: string;
        unit: string;
        series: { name: string; value: number }[];
        mean: number;
        std: number;
        current: number;
        z_score: number;
        slope_per_day: number;
        forecast_7d: number;
        anomaly: boolean;
        trend_label: string;
      }>;
    }>(`/api/dashboard/trends?days=${days}`),

  // v24.2 #2: 自然语言问数(LLM 选 7 个预设模板 + recharts 渲染)
  chartQA: (question: string) =>
    jpost<{
      template: string;
      title: string;
      chart_type: "pie" | "bar" | "line";
      data: { name: string; value: number }[];
      params: { window_days?: number; top_n?: number };
      rationale: string | null;
      fallback_used: boolean;
    }>(`/api/dashboard/chart-qa`, { question }),

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
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
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
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
      handleNetworkError(`/api/reports/status-distribution`, r.status, text);
      throw makeError(`/api/reports/status-distribution`, r.status, text);
    }
    return parseDownload(r, `status-distribution-${days}d.xlsx`);
  },
  // v24.3 #2: 日清(date 默认今日)
  downloadDailySummary: async (dateIso?: string | null) => {
    const q = dateIso ? `?date=${dateIso}` : "";
    const r = await fetch(backendBase() + `/api/reports/daily-summary${q}`, {
      credentials: "include",
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
      handleNetworkError(`/api/reports/daily-summary`, r.status, text);
      throw makeError(`/api/reports/daily-summary`, r.status, text);
    }
    return parseDownload(r, `daily-summary-${dateIso || "today"}.xlsx`);
  },
  // v24.3 #2: 周查(week_start 默认本周一)
  downloadWeeklySummary: async (weekStartIso?: string | null) => {
    const q = weekStartIso ? `?week_start=${weekStartIso}` : "";
    const r = await fetch(backendBase() + `/api/reports/weekly-summary${q}`, {
      credentials: "include",
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
      handleNetworkError(`/api/reports/weekly-summary`, r.status, text);
      throw makeError(`/api/reports/weekly-summary`, r.status, text);
    }
    return parseDownload(r, `weekly-summary-${weekStartIso || "this-week"}.xlsx`);
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

  // M3.0 agent message history (Cowork-friendly read-only).
  // v26.3-02: reply_to_agent_message_id + agenda_idx 由 backend 一并返回.
  listAgentMessages: (meetingId: string) =>
    jget<AgentMessage[]>(`/api/meetings/${meetingId}/agent-messages`),

  // Agents
  listAgents: (opts?: {
    q?: string;
    sort?: "new" | "hot";
    domain?: string;
    active_only?: boolean;
  }) => {
    // v26.12-Home: 首页 卡片浏览 用 — 不传 任何 参数 = 老行为 (created_at desc)
    const params = new URLSearchParams();
    if (opts?.q) params.set("q", opts.q);
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.domain) params.set("domain", opts.domain);
    if (opts?.active_only) params.set("active_only", "true");
    const qs = params.toString();
    return jget<Agent[]>(`/api/agents${qs ? `?${qs}` : ""}`);
  },
  getAgent: (id: string) => jget<Agent>(`/api/agents/${id}`),
  createAgent: (a: AgentInput) => jpost<Agent>("/api/agents", a),
  updateAgent: (id: string, a: Partial<AgentInput>) => jpatch<Agent>(`/api/agents/${id}`, a),
  deleteAgent: (id: string) => jdelete(`/api/agents/${id}`),

  // v26.14-P3: AI 履历 — 该 AI 历史 发言 聚合 (workspace 内 任何 成员 可看)
  getAgentActivity: (id: string, limit?: number) =>
    jget<AgentActivity>(
      `/api/agents/${id}/activity${limit ? `?limit=${limit}` : ""}`,
    ),

  // v26.13.2: Search Providers (Perplexity etc.) — 跟 LLM 模型 平行 的 API 配置
  listSearchProviderCatalog: () =>
    jget<Array<{
      name: string;
      label: string;
      default_base_url: string;
      api_key_help: string;
      docs_url: string;
    }>>("/api/search-providers/catalog"),
  listSearchProviderConfigs: () =>
    jget<Array<{
      id: string;
      provider: string;
      base_url: string | null;
      is_active: boolean;
      note: string | null;
      masked_key: string;
      created_at: string;
      updated_at: string;
    }>>("/api/search-providers"),
  saveSearchProviderConfig: (
    provider: string,
    body: {
      provider: string;
      api_key?: string;
      base_url?: string;
      is_active?: boolean;
      note?: string;
    },
  ) => jput(`/api/search-providers/${provider}`, body),
  activateSearchProvider: (provider: string) =>
    jpost(`/api/search-providers/${provider}/activate`, {}),
  deleteSearchProviderConfig: (provider: string) =>
    jdelete(`/api/search-providers/${provider}`),
  testSearchProvider: (provider: string) =>
    jpost<{ ok: boolean; msg: string }>(`/api/search-providers/${provider}/test`, {}),

  // v26.13.2: Perplexity 抓取 触发 — 创建 沉淀草稿
  // v26.13.2-fix4: silent=true — modal 自己 toast "Perplexity 抓取失败" 更具体,
  // 不让 全局 拦截器 弹 "请求失败 (400)" 重复 一次.
  perplexityFetch: (body: {
    kb_id: string;
    agent_id: string;
    query: string;
    recency?: "day" | "week" | "month" | "year" | null;
  }) =>
    jpost<{
      drafts_created: number;
      drafts_skipped_dedup: number;
      quota_used: number;
      quota_remaining: number;
      drafts: Array<{
        id: string;
        proposed_filename: string | null;
        citations_count: number;
      }>;
      primary_url: string | null;
      answer_preview: string;
    }>("/api/knowledge/perplexity-fetch", body, { silent: true }),

  // v26.13.1: AI 私聊 调试模式 — 上传 文件 in-memory 解析 (不存盘)
  parseChatFile: async (file: File): Promise<{
    text: string;
    filename: string;
    char_count: number;
  }> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(backendBase() + "/api/chat/parse-file", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
      throw makeError("/api/chat/parse-file", r.status, text);
    }
    return r.json();
  },
  // v26.9-Avatar: 上传 3 种形象 (头像 / 静态全身 / 动图全身)
  uploadAgentAvatar: async (id: string, file: File): Promise<Agent> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jpostForm<Agent>(`/api/agents/${id}/avatar`, fd);
  },
  uploadAgentFullBody: async (id: string, file: File): Promise<Agent> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jpostForm<Agent>(`/api/agents/${id}/full-body`, fd);
  },
  uploadAgentFullBodyAnimated: async (id: string, file: File): Promise<Agent> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jpostForm<Agent>(`/api/agents/${id}/full-body-animated`, fd);
  },

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
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
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

  /** v25-5: 单场会议纪要 docx 完整版(含议程 / agent 发言 / 待办事项). */
  downloadMeetingMinutes: async (id: string) => {
    const r = await fetch(
      backendBase() + `/api/meetings/${id}/minutes`,
      { credentials: "include" },
    );
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      handleAuthError(r.status, text);
      handleNetworkError(`/api/meetings/${id}/minutes`, r.status, text);
      throw makeError(`/api/meetings/${id}/minutes`, r.status, text);
    }
    const cd = r.headers.get("Content-Disposition") ?? "";
    let filename = `meeting-minutes.docx`;
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
  createKnowledgeBase: (body: {
    name: string;
    description?: string;
    owner_agent_id?: string | null;  // v26.5-02a
  }) => jpost<KnowledgeBase>("/api/knowledge-bases", body),
  // v26.5-02a: 改 KB 名 / 描述 / owner_agent_id
  updateKnowledgeBase: (
    id: string,
    body: { name?: string; description?: string | null; owner_agent_id?: string | null },
  ) => jpatch<KnowledgeBase>(`/api/knowledge-bases/${id}`, body),
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
  listMemories: (scope?: string, scopeRef?: string, agentId?: string) => {
    const q = new URLSearchParams();
    if (scope) q.set("scope", scope);
    if (scopeRef) q.set("scope_ref", scopeRef);
    if (agentId) q.set("agent_id", agentId);  // v26.5-02b
    const s = q.toString();
    return jget<Memory[]>(`/api/memory${s ? `?${s}` : ""}`);
  },
  createMemory: (m: {
    scope: string;
    scope_ref?: string | null;
    content: string;
    importance?: number;
    agent_id?: string | null;     // v26.5-02b deprecated, 兼容
    agent_ids?: string[] | null;  // v26.5-Lineage 多对多
  }) => jpost<Memory>("/api/memory", m),
  deleteMemory: (id: string) => jdelete(`/api/memory/${id}`),

  // v26.5-Lineage: Memory 审批草稿
  listMemoryDrafts: (status?: "pending" | "approved" | "rejected" | "all") => {
    const q = status && status !== "all" ? `?status=${status}` : "";
    return jget<MemoryDraft[]>(`/api/memory-drafts${q}`);
  },
  getMemoryDraft: (id: string) =>
    jget<MemoryDraft>(`/api/memory-drafts/${id}`),
  approveMemoryDraft: (id: string) =>
    jpost<MemoryDraft>(`/api/memory-drafts/${id}/approve`, {}),
  rejectMemoryDraft: (id: string, reason?: string) =>
    jpost<MemoryDraft>(`/api/memory-drafts/${id}/reject`, { reason }),

  // v26.5-Lineage P2: 数据血缘
  getLineage: () => jget<LineageOut>("/api/lineage"),
  getAgentLineage: (agentId: string) =>
    jget<LineageOut>(`/api/lineage/agent/${agentId}`),

  // v26.6-01: AI 模板生成器
  previewAgentTemplate: (body: {
    scenario_description: string;
    count: number;
    with_kb_seed: boolean;
    with_memory_seed: boolean;
  }) => jpost<{
    agents: AgentTemplateDraft[];
    scenario_description: string;
    raw_llm_text: string;
  }>("/api/agent-templates/preview", body),
  commitAgentTemplate: (body: {
    agents: AgentTemplateDraft[];
    candidate_manager_ids?: string[];
  }) => jpost<{
    created: Array<{
      id: string;
      name: string;
      kb_id: string | null;
      kb_doc_id: string | null;
      memory_count: number;
    }>;
    // v26.6-fix1: 同名跳过的 agent
    skipped?: Array<{
      name: string;
      reason: string;
      existing_agent_id: string | null;
    }>;
  }>("/api/agent-templates/commit", body),

  // v26.5-02c: KB 沉淀审批
  listSedimentationDrafts: (status?: "pending" | "approved" | "rejected" | "all") => {
    const q = status && status !== "all" ? `?status=${status}` : "";
    return jget<SedimentationDraft[]>(`/api/sedimentation-drafts${q}`);
  },
  getSedimentationDraft: (id: string) =>
    jget<SedimentationDraft>(`/api/sedimentation-drafts/${id}`),
  approveSedimentationDraft: (id: string) =>
    jpost<SedimentationDraft>(`/api/sedimentation-drafts/${id}/approve`, {}),
  rejectSedimentationDraft: (id: string, reason?: string) =>
    jpost<SedimentationDraft>(`/api/sedimentation-drafts/${id}/reject`, { reason }),

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
