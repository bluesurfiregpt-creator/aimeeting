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
  const id = nextId++;
  const ttl = opts?.ttlMs ?? (kind === "error" ? 8000 : 5000);
  const expiresAt = opts?.sticky ? null : Date.now() + ttl;
  toasts = [...toasts, { id, kind, message, detail: opts?.detail, expiresAt }];
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
