/**
 * Tiny app-wide toast bus. The Toaster component subscribes; api.ts and any
 * other call site just imports `toast.error(...)` / `toast.info(...)`.
 *
 * No external dep — keeping bundle small, behaviour predictable. Toasts auto
 * dismiss after 6s by default; passing `sticky: true` pins them until clicked.
 */

export type ToastKind = "info" | "success" | "warn" | "error";

export type ToastEntry = {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  expiresAt: number | null; // null = sticky
};

type Listener = (toasts: ToastEntry[]) => void;

const listeners = new Set<Listener>();
let toasts: ToastEntry[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

function push(kind: ToastKind, message: string, opts?: { detail?: string; sticky?: boolean; ttlMs?: number }) {
  // v26.5-P0-fix3: dedupe — 同 kind+message+detail 的 toast 如果 还在显示中,
  // 不再重复 push (避免 6 个并发 API 撞同一个错误 → 屏幕堆 6 条相同 toast).
  const detail = opts?.detail;
  const existing = toasts.find(
    (t) => t.kind === kind && t.message === message && t.detail === detail,
  );
  if (existing) return existing.id;

  const id = nextId++;
  const ttl = opts?.ttlMs ?? (kind === "error" ? 8000 : 5000);
  const expiresAt = opts?.sticky ? null : Date.now() + ttl;
  toasts = [...toasts, { id, kind, message, detail, expiresAt }];
  emit();
  if (expiresAt !== null) {
    setTimeout(() => dismiss(id), ttl);
  }
  return id;
}

function dismiss(id: number) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export const toast = {
  info: (msg: string, opts?: { detail?: string; sticky?: boolean }) => push("info", msg, opts),
  success: (msg: string, opts?: { detail?: string; sticky?: boolean }) => push("success", msg, opts),
  warn: (msg: string, opts?: { detail?: string; sticky?: boolean }) => push("warn", msg, opts),
  error: (msg: string, opts?: { detail?: string; sticky?: boolean }) => push("error", msg, opts),
  dismiss,
  subscribe: (l: Listener) => {
    listeners.add(l);
    l(toasts); // immediate snapshot
    return () => { listeners.delete(l); };
  },
};
