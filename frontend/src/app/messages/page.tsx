"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  type MyTask,
  type Notification,
  type NotificationList,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v23.5 — /messages 消息中心.
 *
 * 一页看完「关于我的全部信息」,3 个 section:
 *   1. 需要我处理   — 主责待签收/办理 + 我作为审核 + 我作为协办
 *                     (Tasks 数据源 — 比通知更权威,旧任务也能看到)
 *   2. 我发起的进展 — 我派发/创建的任务的最新进展 (Notifications)
 *   3. 系统消息     — 其他通知(评分 / 访问申请 / 评论等)
 *
 * 哲学:这不重复 /me 的操作能力 — /me 干活,/messages 巡视.
 * 角色感知:无论 leader / member,Section 1 永远在最上(最紧迫).
 * Leader 看到的 section 2 里行项更多(因为派发的多).
 */

const STATUS_LABEL: Record<string, string> = {
  open: "未派发",
  dispatched: "待签收",
  accepted: "已签收",
  in_progress: "办理中",
  submitted: "待审核",
  done: "已完成",
  archived: "已归档",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-zinc-700 text-zinc-300",
  dispatched: "bg-amber-500/20 text-amber-300",
  accepted: "bg-cyan-500/20 text-cyan-300",
  in_progress: "bg-sky-500/20 text-sky-300",
  submitted: "bg-violet-500/20 text-violet-300",
  done: "bg-emerald-500/20 text-emerald-300",
  archived: "bg-zinc-800 text-zinc-500",
  cancelled: "bg-zinc-800 text-zinc-500 line-through",
};

/**
 * 通知 kind → bucket 路由表.
 *   progress = 我作为发起人/dispatcher 收到的进度反馈
 *   system   = 其他(评分 / 访问申请 / 评论 / 给我的指派等)
 *
 * 注:task_dispatched / task_co_assigned / task_submitted (作为 reviewer)
 * 也会作为「Task 行」出现在 section 1,所以这里把它们扔 system 当做
 * 「freshness 提醒」而不是 progress.
 */
const NOTI_BUCKET: Record<string, "progress" | "system"> = {
  task_accepted: "progress",
  task_returned: "progress",
  task_completed: "progress",
  task_co_submitted: "progress",
  task_co_withdrawn: "progress",
  // 其他全部 system(默认)
};

function fmtRelative(iso: string): string {
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

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

/** 从 notification.payload 里挖出可点击的 task_id(若有) */
function notiTaskId(n: Notification): string | null {
  const p = (n.payload || {}) as Record<string, unknown>;
  const v = p.task_id;
  return typeof v === "string" ? v : null;
}

function notiMeetingId(n: Notification): string | null {
  const p = (n.payload || {}) as Record<string, unknown>;
  const v = p.meeting_id;
  return typeof v === "string" ? v : null;
}

/** 同 NotificationBell.describe — 拿一行人类可读的描述. */
function describeNotification(n: Notification): string {
  const p = (n.payload || {}) as Record<string, unknown>;
  const meetingTitle =
    typeof p.meeting_title === "string" ? p.meeting_title : "";
  const content = typeof p.content === "string" ? p.content : "";
  const titlePrefix = meetingTitle ? `《${meetingTitle}》` : "";
  switch (n.kind) {
    case "action_assigned": {
      const by = typeof p.assigned_by === "string" ? p.assigned_by : "";
      const who = by ? `${by} 指派给你:` : "你被指派了行动项:";
      return `${titlePrefix}${who}${content}`;
    }
    case "action_due_soon":
      return `${titlePrefix}行动项即将到期:${content}`;
    case "action_overdue": {
      const days = typeof p.days_overdue === "number" ? p.days_overdue : 0;
      const tail = days > 0 ? `(已逾期 ${days} 天)` : "(已逾期)";
      return `${titlePrefix}行动项${tail}:${content}`;
    }
    case "action_comment": {
      const author = typeof p.author_name === "string" ? p.author_name : "";
      const preview =
        typeof p.comment_preview === "string" ? p.comment_preview : "";
      const action =
        typeof p.action_content === "string" ? p.action_content : "";
      return `${titlePrefix}${author} 在「${action}」下留言:${preview}`;
    }
    case "task_dispatched": {
      const by = typeof p.dispatched_by === "string" ? p.dispatched_by : "";
      return `${titlePrefix}${by ? `${by} 派发给你:` : "新任务:"}${content}`;
    }
    case "task_accepted": {
      const by = typeof p.accepted_by === "string" ? p.accepted_by : "";
      return `${by} 已签收任务:${content}`;
    }
    case "task_returned": {
      const by = typeof p.returned_by === "string" ? p.returned_by : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return `${by} 退回任务:${content}${reason ? `(${reason})` : ""}`;
    }
    case "task_completed": {
      const by = typeof p.completed_by === "string" ? p.completed_by : "";
      return `${by} 已办结:${content}`;
    }
    case "task_submitted": {
      const by = typeof p.submitted_by === "string" ? p.submitted_by : "";
      return `${by} 上报办结申请:${content}`;
    }
    case "task_approved": {
      const by = typeof p.approved_by === "string" ? p.approved_by : "";
      return `${by} 通过审核:${content}`;
    }
    case "task_rejected": {
      const by = typeof p.rejected_by === "string" ? p.rejected_by : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return `${by} 驳回:${content}${reason ? `(原因:${reason})` : ""}`;
    }
    case "task_co_assigned": {
      const by = typeof p.dispatched_by === "string" ? p.dispatched_by : "";
      const coordinator =
        typeof p.coordinator_name === "string" ? p.coordinator_name : "";
      return `${by} 邀请你协办${coordinator ? `(主责:${coordinator})` : ""}:${content}`;
    }
    case "task_co_submitted": {
      const co = typeof p.co_assignee_name === "string" ? p.co_assignee_name : "";
      const preview = typeof p.preview === "string" ? p.preview : "";
      return `${co} 已交协办${preview ? `:${preview}` : ""}(${content})`;
    }
    case "task_co_withdrawn": {
      const co = typeof p.co_assignee_name === "string" ? p.co_assignee_name : "";
      return `${co} 退出了协办:${content}`;
    }
    case "task_collaboration_rated": {
      const rater = typeof p.rater_name === "string" ? p.rater_name : "";
      const dim = typeof p.dimension === "string" ? p.dimension : "";
      const score = typeof p.score === "number" ? p.score : 0;
      const dimLabel = dim === "quality" ? "质量" : "协作";
      return `${rater} 给你打了 ${dimLabel} 分 ${score}/5:${content}`;
    }
    case "report_submitted": {
      const by = typeof p.reporter_name === "string" ? p.reporter_name : "";
      const sev = typeof p.severity === "string" ? p.severity : "";
      const sevTag = sev === "high" ? "[严重]" : sev === "medium" ? "[一般]" : "[轻微]";
      const title = typeof p.title === "string" ? p.title : "";
      const preview = typeof p.preview === "string" ? p.preview : "";
      return `📢 ${by} 上报问题 ${sevTag}:${title}${preview ? ` — ${preview}` : ""}`;
    }
    case "alert_fired": {
      const title = typeof p.title === "string" ? p.title : "异常预警";
      const ak = typeof p.alert_kind === "string" ? p.alert_kind : "";
      return `🚨 [${ak}] ${title}`;
    }
    default:
      return n.kind;
  }
}

function NotiRow({ n }: { n: Notification }) {
  const taskId = notiTaskId(n);
  const meetingId = notiMeetingId(n);
  const href = taskId ? `/task/${taskId}` : meetingId ? `/meeting/${meetingId}` : null;
  const unread = !n.read_at;
  const inner = (
    <div
      className={`flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 ${unread ? "ring-1 ring-rose-400/30" : ""}`}
      data-testid="message-noti-row"
      data-kind={n.kind}
      data-unread={unread ? "1" : "0"}
    >
      <span
        className={`mt-1.5 inline-block h-1.5 w-1.5 flex-none rounded-full ${unread ? "bg-rose-400" : "bg-zinc-700"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs leading-snug text-zinc-200">
          {describeNotification(n)}
        </div>
        <div className="mt-1 text-[10px] text-zinc-500">
          {fmtRelative(n.created_at)}
        </div>
      </div>
    </div>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}

function TaskRow({ t, badge }: { t: MyTask; badge?: string | null }) {
  const overdue =
    t.due_at &&
    new Date(t.due_at).getTime() < Date.now() &&
    t.status !== "done" &&
    t.status !== "archived" &&
    t.status !== "cancelled";
  return (
    <Link
      href={`/task/${t.id}`}
      className="block"
      data-testid="message-task-row"
      data-status={t.status}
    >
      <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 hover:bg-ink-800">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_COLOR[t.status] || STATUS_COLOR.open}`}
          >
            {STATUS_LABEL[t.status] || t.status}
          </span>
          {badge && (
            <span className="rounded-full border border-ink-600 px-2 py-0.5 text-[10px] text-zinc-400">
              {badge}
            </span>
          )}
          {t.due_at && (
            <span
              className={`text-[10px] ${overdue ? "font-medium text-rose-400" : "text-zinc-500"}`}
            >
              截止 {fmtDate(t.due_at)}
              {overdue && " (已逾期)"}
            </span>
          )}
        </div>
        <div className="mt-1.5 line-clamp-2 text-xs text-zinc-200">
          {t.title || t.content}
        </div>
        {t.meeting_title && (
          <div className="mt-1 text-[10px] text-zinc-500">
            来自《{t.meeting_title}》
          </div>
        )}
      </div>
    </Link>
  );
}

type ActionableTask = { task: MyTask; badge: string };

export default function MessagesPage() {
  // Section 1 source — 三个 task list 合并去重
  const [pendingMine, setPendingMine] = useState<MyTask[]>([]); // 主责 待签收/办理
  const [reviewMine, setReviewMine] = useState<MyTask[]>([]);    // 审核
  const [coMine, setCoMine] = useState<MyTask[]>([]);            // 协办
  const [tasksLoading, setTasksLoading] = useState(true);

  // Section 2/3 source — notifications
  const [notifs, setNotifs] = useState<NotificationList>({
    items: [],
    unread_count: 0,
    max_unread_severity: "normal",
  });
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        api.listMyTasks("active", "assignee"),
        api.listMyTasks("review", "reviewer"),
        api.listMyTasks("active", "coassignee"),
      ]);
      setPendingMine(a.filter((t) =>
        ["dispatched", "accepted", "in_progress"].includes(t.status),
      ));
      setReviewMine(b);
      setCoMine(c);
    } catch {
      // already toasted by api layer
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const loadNotifs = useCallback(async () => {
    setNotifsLoading(true);
    try {
      const list = await api.listMyNotifications(false, 100);
      setNotifs(list);
    } catch {
      /* noop */
    } finally {
      setNotifsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadNotifs();
  }, [loadTasks, loadNotifs]);

  const onMarkAll = useCallback(async () => {
    if (busy || notifs.unread_count === 0) return;
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifs((d) => ({
        items: d.items.map((x) => (x.read_at ? x : { ...x, read_at: now })),
        unread_count: 0,
        max_unread_severity: "normal",
      }));
      toast.success("已全部标记为已读");
    } catch {
      /* api already toasts */
    } finally {
      setBusy(false);
    }
  }, [busy, notifs.unread_count]);

  // Section 1: 合并 + 去重(主责 / 审核 / 协办 重叠时一次显示)
  const actionable = useMemo<ActionableTask[]>(() => {
    const seen = new Set<string>();
    const out: ActionableTask[] = [];
    for (const t of pendingMine) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ task: t, badge: "主责" });
    }
    for (const t of reviewMine) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ task: t, badge: "审核" });
    }
    for (const t of coMine) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ task: t, badge: "协办" });
    }
    return out;
  }, [pendingMine, reviewMine, coMine]);

  // Section 2 + 3: notifications by bucket
  const { progressNotis, systemNotis } = useMemo(() => {
    const progress: Notification[] = [];
    const system: Notification[] = [];
    for (const n of notifs.items) {
      const bucket = NOTI_BUCKET[n.kind] || "system";
      if (bucket === "progress") progress.push(n);
      else system.push(n);
    }
    return { progressNotis: progress, systemNotis: system };
  }, [notifs.items]);

  return (
    <main
      className="mx-auto max-w-3xl px-4 py-12 pt-20"
      data-testid="messages-page"
    >
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">消息中心</h1>
          <p className="mt-1 text-xs text-zinc-500">
            把跟你有关的事汇总到一页 · 巡视而非操作 · 操作请到{" "}
            <Link href="/me" className="text-accent-300 hover:text-accent-200">
              /我的
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkAll}
          disabled={busy || notifs.unread_count === 0}
          data-testid="messages-mark-all-read"
          className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {notifs.unread_count > 0
            ? `全部已读 (${notifs.unread_count})`
            : "无未读"}
        </button>
      </header>

      {/* Section 1: 需要我处理 */}
      <section
        className="mb-8"
        data-testid="messages-section-actionable"
        data-count={actionable.length}
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <span>🔥 需要我处理</span>
          {actionable.length > 0 && (
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300">
              {actionable.length}
            </span>
          )}
        </h2>
        {tasksLoading ? (
          <div className="text-xs text-zinc-500">加载中…</div>
        ) : actionable.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-xs text-zinc-500"
            data-testid="messages-actionable-empty"
          >
            暂无需要处理的任务 — 享受短暂的安静 ✨
          </div>
        ) : (
          <div className="space-y-2">
            {actionable.map((a) => (
              <TaskRow key={a.task.id} t={a.task} badge={a.badge} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: 我发起的进展 */}
      <section
        className="mb-8"
        data-testid="messages-section-progress"
        data-count={progressNotis.length}
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <span>📈 我发起的进展</span>
          {progressNotis.length > 0 && (
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300">
              {progressNotis.length}
            </span>
          )}
        </h2>
        {notifsLoading ? (
          <div className="text-xs text-zinc-500">加载中…</div>
        ) : progressNotis.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-xs text-zinc-500"
            data-testid="messages-progress-empty"
          >
            暂无进展更新
          </div>
        ) : (
          <div className="space-y-2">
            {progressNotis.map((n) => (
              <NotiRow key={n.id} n={n} />
            ))}
          </div>
        )}
      </section>

      {/* Section 3: 系统消息 */}
      <section
        className="mb-8"
        data-testid="messages-section-system"
        data-count={systemNotis.length}
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <span>🔔 系统消息</span>
          {systemNotis.length > 0 && (
            <span className="rounded-full bg-zinc-600/40 px-2 py-0.5 text-[10px] text-zinc-300">
              {systemNotis.length}
            </span>
          )}
        </h2>
        {notifsLoading ? (
          <div className="text-xs text-zinc-500">加载中…</div>
        ) : systemNotis.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-xs text-zinc-500"
            data-testid="messages-system-empty"
          >
            暂无系统消息
          </div>
        ) : (
          <div className="space-y-2">
            {systemNotis.map((n) => (
              <NotiRow key={n.id} n={n} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
