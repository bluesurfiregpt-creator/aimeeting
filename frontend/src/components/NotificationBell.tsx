"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type Notification, type NotificationList } from "@/lib/api";

/**
 * Theme 1 (P0): bell button + dropdown drawer in the top nav.
 *
 * Polls `/api/me/notifications` every 60s for the unread count + a small
 * page (≤50) of recent items. Polling cadence is intentionally lazy —
 * P0 doesn't push, and a 60s lag matches expectations for "in-app inbox"
 * (vs. the 0-lag chat experience).
 *
 * Click bell → drawer opens, mark-all-read button + per-row click jumps
 * to the linked meeting / action item. Each unread row renders a small
 * dot until clicked (read), giving the user explicit "I've seen this"
 * agency without auto-clearing the badge.
 */

const POLL_INTERVAL_MS = 60_000;

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "刚刚";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function describe(n: Notification): { line: string; href: string | null } {
  const p = (n.payload || {}) as Record<string, unknown>;
  const meetingId = typeof p.meeting_id === "string" ? p.meeting_id : null;
  const taskId = typeof p.task_id === "string" ? p.task_id : null;
  const actionId = typeof p.action_id === "string" ? p.action_id : null;
  const meetingTitle =
    typeof p.meeting_title === "string" ? p.meeting_title : null;
  const content = typeof p.content === "string" ? p.content : "";
  // v23.5: 优先 deeplink 到 /task/[id](详情页),fallback 到 /meeting/[id]
  const href = taskId
    ? `/task/${taskId}`
    : meetingId
      ? `/meeting/${meetingId}`
      : null;
  switch (n.kind) {
    case "action_assigned": {
      const by = typeof p.assigned_by === "string" ? p.assigned_by : "";
      const title = meetingTitle ? `《${meetingTitle}》` : "";
      const who = by ? `${by} 指派给你：` : "你被指派了行动项：";
      return { line: `${title}${who}${content}`.trim(), href };
    }
    case "action_due_soon": {
      const title = meetingTitle ? `《${meetingTitle}》` : "";
      return {
        line: `${title}行动项即将到期：${content}`.trim(),
        href,
      };
    }
    case "action_overdue": {
      const days = typeof p.days_overdue === "number" ? p.days_overdue : 0;
      const title = meetingTitle ? `《${meetingTitle}》` : "";
      const tail = days > 0 ? `（已逾期 ${days} 天）` : "（已逾期）";
      return {
        line: `${title}行动项${tail}：${content}`.trim(),
        href,
      };
    }
    case "action_comment": {
      const author = typeof p.author_name === "string" ? p.author_name : "";
      const preview =
        typeof p.comment_preview === "string" ? p.comment_preview : "";
      const action =
        typeof p.action_content === "string" ? p.action_content : "";
      const title = meetingTitle ? `《${meetingTitle}》` : "";
      return {
        line: `${title}${author} 在“${action}”下留言：${preview}`.trim(),
        href,
      };
    }
    case "task_dispatched": {
      const by = typeof p.dispatched_by === "string" ? p.dispatched_by : "";
      const content = typeof p.content === "string" ? p.content : "";
      const title = meetingTitle ? `《${meetingTitle}》` : "";
      return {
        line: `${title}${by ? `${by} 派发给你：` : "新任务派发：" }${content}`.trim(),
        href,
      };
    }
    case "task_accepted": {
      const by = typeof p.accepted_by === "string" ? p.accepted_by : "";
      const content = typeof p.content === "string" ? p.content : "";
      return { line: `${by} 已签收任务：${content}`.trim(), href };
    }
    case "task_returned": {
      const by = typeof p.returned_by === "string" ? p.returned_by : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      const content = typeof p.content === "string" ? p.content : "";
      return {
        line: `${by} 退回了任务：${content}${reason ? `（${reason}）` : ""}`.trim(),
        href,
      };
    }
    case "task_completed": {
      const by = typeof p.completed_by === "string" ? p.completed_by : "";
      const content = typeof p.content === "string" ? p.content : "";
      return { line: `${by} 已办结：${content}`.trim(), href };
    }
    case "report_submitted": {
      const by = typeof p.reporter_name === "string" ? p.reporter_name : "";
      const sev = typeof p.severity === "string" ? p.severity : "";
      const sevTag = sev === "high" ? "[严重]" : sev === "medium" ? "[一般]" : "[轻微]";
      const title = typeof p.title === "string" ? p.title : "";
      return { line: `${by} 上报问题 ${sevTag}:${title}`.trim(), href };
    }
    case "alert_fired": {
      const title = typeof p.title === "string" ? p.title : "异常预警";
      return { line: title, href };
    }
    case "task_dispatch_overdue": {
      const title = typeof p.title === "string" ? p.title : "";
      const hours = typeof p.hours_overdue === "number" ? p.hours_overdue : 0;
      const role = typeof p.to_role === "string" ? p.to_role : "";
      const prefix = role === "dispatcher" ? "下属未签收" : "请尽快签收";
      return { line: `⏰ ${prefix} (${hours}h):${title}`, href };
    }
    case "task_penalty": {
      const title = typeof p.title === "string" ? p.title : "";
      const sev = typeof p.severity === "string" ? p.severity : "";
      const days = typeof p.days_overdue === "number" ? p.days_overdue : 0;
      const score = typeof p.score_delta === "number" ? p.score_delta : 0;
      const role = typeof p.to_role === "string" ? p.to_role : "";
      const sevTag = sev === "major" ? "[重大]" : "[严重]";
      const prefix = role === "dispatcher" ? "下属任务超时扣分" : "你的任务超时被扣分";
      return { line: `📉 ${prefix} ${sevTag} 超时 ${days}d / ${score} 分:${title}`, href };
    }
    case "user_suspended": {
      const name = typeof p.user_name === "string" ? p.user_name : "";
      const until = typeof p.suspended_until === "string" ? p.suspended_until : "";
      const role = typeof p.to_role === "string" ? p.to_role : "";
      const subj = role === "self" ? "你" : name;
      return {
        line: `🚫 ${subj} 因连续 2 次重大超时被暂停派单,至 ${until.slice(0, 10)}`,
        href,
      };
    }
    // v26.6-02: v26.5 沉淀审批 5 个新 kind 的文案 + 跳转
    case "kb_sedimentation_pending": {
      const taskTitle = typeof p.task_title === "string" ? p.task_title : "";
      const agentName = typeof p.agent_name === "string" ? p.agent_name : "";
      return {
        line: `🔔 KB 沉淀待审批: ${taskTitle ? `《${taskTitle}》` : ""}拟挂给 ${agentName}`,
        href: "/me/profile/sedimentation",
      };
    }
    case "kb_sedimentation_approved": {
      const approver = typeof p.approver_name === "string" ? p.approver_name : "";
      return {
        line: `✅ ${approver} 批准了你提的 KB 沉淀`,
        href: "/me/profile/sedimentation",
      };
    }
    case "kb_sedimentation_rejected": {
      const reviewer = typeof p.reviewer_name === "string" ? p.reviewer_name : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return {
        line: `⛔ ${reviewer} 驳回了你提的 KB 沉淀${reason ? `(${reason})` : ""}`,
        href: "/me/profile/sedimentation",
      };
    }
    case "memory_draft_pending": {
      const taskTitle = typeof p.task_title === "string" ? p.task_title : "";
      const preview = typeof p.summary_preview === "string" ? p.summary_preview.slice(0, 50) : "";
      return {
        line: `🔔 长期记忆待审批: ${taskTitle ? `《${taskTitle}》` : preview}`,
        href: "/me/profile/sedimentation",
      };
    }
    case "memory_draft_approved": {
      const approver = typeof p.approver_name === "string" ? p.approver_name : "";
      return {
        line: `✅ ${approver} 批准了你提的长期记忆`,
        href: "/me/profile/sedimentation",
      };
    }
    case "memory_draft_rejected": {
      const reviewer = typeof p.reviewer_name === "string" ? p.reviewer_name : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return {
        line: `⛔ ${reviewer} 驳回了你提的长期记忆${reason ? `(${reason})` : ""}`,
        href: "/me/profile/sedimentation",
      };
    }
    default:
      return { line: n.kind, href };
  }
}

// v18: severity → badge color class (Tailwind). Higher severity = more urgent.
function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "purple":
      return "bg-purple-500";
    case "red":
      return "bg-red-500";
    case "yellow":
      return "bg-amber-400 text-amber-950";
    default:
      return "bg-rose-500";
  }
}

// v18: severity → unread-row dot color.
function severityDotClass(severity: string): string {
  switch (severity) {
    case "purple":
      return "bg-purple-400";
    case "red":
      return "bg-red-400";
    case "yellow":
      return "bg-amber-400";
    default:
      return "bg-rose-400";
  }
}

export default function NotificationBell() {
  const [data, setData] = useState<NotificationList>({
    items: [],
    unread_count: 0,
    max_unread_severity: "normal",
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listMyNotifications(false, 50);
      setData({
        items: list.items,
        unread_count: list.unread_count,
        max_unread_severity: list.max_unread_severity ?? "normal",
      });
    } catch {
      // 401 / network: bail silently. The api layer already toasts non-401
      // errors; we don't want to spam an idle background poll.
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Click-outside to close the drawer.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onItemClick = useCallback(
    async (n: Notification) => {
      if (!n.read_at) {
        try {
          await api.markNotificationRead(n.id);
        } catch {}
      }
      setData((d) => ({
        items: d.items.map((x) =>
          x.id === n.id && !x.read_at
            ? { ...x, read_at: new Date().toISOString() }
            : x,
        ),
        unread_count: !n.read_at
          ? Math.max(0, d.unread_count - 1)
          : d.unread_count,
        max_unread_severity: d.max_unread_severity,
      }));
    },
    [],
  );

  const onMarkAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      const now = new Date().toISOString();
      setData((d) => ({
        items: d.items.map((x) => (x.read_at ? x : { ...x, read_at: now })),
        unread_count: 0,
        max_unread_severity: "normal",
      }));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const badge = data.unread_count > 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={`通知中心${badge ? `，${data.unread_count} 条未读` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-8 w-8 place-items-center rounded-full border border-ink-700 bg-ink-900/90 text-zinc-300 hover:text-zinc-100"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {badge && (
          <span
            data-testid="notification-bell-badge"
            data-unread-count={data.unread_count}
            data-severity={data.max_unread_severity}
            className={`absolute -right-0.5 -top-0.5 grid min-w-[16px] h-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${severityBadgeClass(data.max_unread_severity)}`}
          >
            {data.unread_count > 99 ? "99+" : data.unread_count}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="notification-drawer"
          className="absolute right-0 top-10 z-40 w-[360px] max-h-[480px] overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <span className="text-xs text-zinc-400">通知</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onMarkAll}
                disabled={busy || data.unread_count === 0}
                data-testid="notification-mark-all-read"
                className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
              >
                全部已读
              </button>
              <Link
                href="/messages"
                onClick={() => setOpen(false)}
                data-testid="notification-view-all"
                className="text-xs text-zinc-500 hover:text-zinc-200"
              >
                查看全部
              </Link>
              <Link
                href="/me"
                onClick={() => setOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-200"
              >
                我的待办
              </Link>
            </div>
          </div>
          <div className="max-h-[428px] overflow-y-auto">
            {data.items.length === 0 ? (
              <div
                className="px-3 py-6 text-center text-xs text-zinc-500"
                data-testid="notification-empty"
              >
                暂无通知
              </div>
            ) : (
              data.items.map((n) => {
                const { line, href } = describe(n);
                const unread = !n.read_at;
                const inner = (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 hover:bg-ink-800 ${
                      unread ? "bg-ink-800/40" : ""
                    }`}
                  >
                    <span
                      className={`mt-1.5 inline-block h-1.5 w-1.5 flex-none rounded-full ${
                        unread ? severityDotClass(n.severity) : "bg-transparent"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-snug text-zinc-200 whitespace-normal break-words">
                        {line}
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {formatRelative(n.created_at)}
                      </div>
                    </div>
                  </div>
                );
                return href ? (
                  <Link
                    href={href}
                    key={n.id}
                    onClick={() => {
                      onItemClick(n);
                      setOpen(false);
                    }}
                    className="block"
                    data-testid="notification-row"
                    data-kind={n.kind}
                    data-unread={unread ? "1" : "0"}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onItemClick(n)}
                    className="block w-full text-left"
                    data-testid="notification-row"
                    data-kind={n.kind}
                    data-unread={unread ? "1" : "0"}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
