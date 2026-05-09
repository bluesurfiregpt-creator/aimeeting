"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type MyTask,
  type Notification,
  type NotificationList,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v19: personal dashboard, now Task-centric (was MyAction in v16-v18).
 *
 * Layout:
 *   Left  · 我的任务 — 5 tabs (待签收 / 办理中 / 待审核 / 已完成 / 全部),
 *           each row has state-aware action buttons (签收 / 退回 / 开始 /
 *           上报 / 归档 etc.) driven by Task.status.
 *   Left  · 待我审核(submitted) — separate section listing tasks where the
 *           caller is dispatcher/creator and assignee submitted办结申请,
 *           with 通过/驳回 inline actions.
 *   Right · 通知 — bell drawer's full-text view + 全部已读.
 */

type TaskTab =
  | "pending"   // 待签收 (dispatched)
  | "working"   // 办理中 (accepted | in_progress)
  | "review"    // 待审核 (submitted)
  | "done"      // 已完成
  | "all";      // 全部 (active + done — excludes archived/cancelled by default)

const TAB_LABELS: Record<TaskTab, string> = {
  pending: "待签收",
  working: "办理中",
  review: "待审核",
  done: "已完成",
  all: "全部",
};

const TAB_ORDER: TaskTab[] = ["pending", "working", "review", "done", "all"];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

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

function describeNotification(n: Notification): string {
  const p = (n.payload || {}) as Record<string, unknown>;
  const meetingTitle =
    typeof p.meeting_title === "string" ? p.meeting_title : "";
  const content = typeof p.content === "string" ? p.content : "";
  const titlePrefix = meetingTitle ? `《${meetingTitle}》` : "";
  switch (n.kind) {
    case "action_assigned": {
      const by = typeof p.assigned_by === "string" ? p.assigned_by : "";
      const who = by ? `${by} 指派给你：` : "你被指派了行动项：";
      return `${titlePrefix}${who}${content}`;
    }
    case "action_due_soon":
      return `${titlePrefix}行动项即将到期：${content}`;
    case "action_overdue": {
      const days = typeof p.days_overdue === "number" ? p.days_overdue : 0;
      const tail = days > 0 ? `（已逾期 ${days} 天）` : "（已逾期）";
      return `${titlePrefix}行动项${tail}：${content}`;
    }
    case "action_comment": {
      const author = typeof p.author_name === "string" ? p.author_name : "";
      const preview =
        typeof p.comment_preview === "string" ? p.comment_preview : "";
      const action =
        typeof p.action_content === "string" ? p.action_content : "";
      return `${titlePrefix}${author} 在“${action}”下留言：${preview}`;
    }
    case "task_dispatched": {
      const by = typeof p.dispatched_by === "string" ? p.dispatched_by : "";
      return `${titlePrefix}${by ? `${by} 派发给你：` : "新任务："}${content}`;
    }
    case "task_accepted": {
      const by = typeof p.accepted_by === "string" ? p.accepted_by : "";
      return `${by} 已签收任务：${content}`;
    }
    case "task_returned": {
      const by = typeof p.returned_by === "string" ? p.returned_by : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return `${by} 退回任务：${content}${reason ? `（${reason}）` : ""}`;
    }
    case "task_completed": {
      const by = typeof p.completed_by === "string" ? p.completed_by : "";
      return `${by} 已办结：${content}`;
    }
    case "task_submitted": {
      const by = typeof p.submitted_by === "string" ? p.submitted_by : "";
      return `${by} 上报办结申请：${content}`;
    }
    case "task_approved": {
      const by = typeof p.approved_by === "string" ? p.approved_by : "";
      return `${by} 通过审核：${content}`;
    }
    case "task_rejected": {
      const by = typeof p.rejected_by === "string" ? p.rejected_by : "";
      const reason = typeof p.reason === "string" ? p.reason : "";
      return `${by} 驳回:${content}${reason ? `（原因:${reason}）` : ""}`;
    }
    default:
      return n.kind;
  }
}

export default function MePage() {
  const [tab, setTab] = useState<TaskTab>("pending");
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const [reviewQueue, setReviewQueue] = useState<MyTask[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true);

  const [notifs, setNotifs] = useState<NotificationList>({
    items: [],
    unread_count: 0,
    max_unread_severity: "normal",
  });
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadTasks = useCallback(async (t: TaskTab) => {
    setTasksLoading(true);
    try {
      const r = await api.listMyTasks(t, "assignee");
      setTasks(r);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const loadReviewQueue = useCallback(async () => {
    setReviewLoading(true);
    try {
      const r = await api.listMyTasks("review", "reviewer");
      setReviewQueue(r);
    } catch {
      setReviewQueue([]);
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const loadNotifs = useCallback(async () => {
    setNotifsLoading(true);
    try {
      const r = await api.listMyNotifications(false, 100);
      setNotifs(r);
    } catch {
      setNotifs({ items: [], unread_count: 0, max_unread_severity: "normal" });
    } finally {
      setNotifsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks(tab);
  }, [tab, loadTasks]);

  useEffect(() => {
    void loadReviewQueue();
  }, [loadReviewQueue]);

  useEffect(() => {
    void loadNotifs();
  }, [loadNotifs]);

  // ---- task action handlers ------------------------------------------------

  const reload = useCallback(() => {
    void loadTasks(tab);
    void loadReviewQueue();
  }, [tab, loadTasks, loadReviewQueue]);

  const onAccept = useCallback(
    async (t: MyTask) => {
      try {
        await api.acceptTask(t.id);
        toast.success("已签收");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "签收失败");
      }
    },
    [reload],
  );

  const onReturn = useCallback(
    async (t: MyTask) => {
      const reason = window.prompt("退回原因(可选):", "");
      if (reason === null) return;
      try {
        await api.returnTask(t.id, reason);
        toast.success("已退回");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "退回失败");
      }
    },
    [reload],
  );

  const onStart = useCallback(
    async (t: MyTask) => {
      try {
        await api.startTask(t.id);
        toast.success("已开始办理");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "开始失败");
      }
    },
    [reload],
  );

  const onSubmit = useCallback(
    async (t: MyTask) => {
      const note = window.prompt("阶段汇报(可选):", "");
      if (note === null) return;
      try {
        await api.submitTask(t.id, note);
        toast.success("已上报办结申请");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "上报失败");
      }
    },
    [reload],
  );

  const onArchive = useCallback(
    async (t: MyTask) => {
      try {
        await api.archiveTask(t.id);
        toast.success("已归档");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "归档失败");
      }
    },
    [reload],
  );

  const onApprove = useCallback(
    async (t: MyTask) => {
      try {
        await api.approveTask(t.id);
        toast.success("已通过");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "审核失败");
      }
    },
    [reload],
  );

  const onReject = useCallback(
    async (t: MyTask) => {
      const reason = window.prompt("驳回原因:", "");
      if (reason === null) return;
      try {
        await api.rejectTask(t.id, reason);
        toast.success("已驳回返工");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "驳回失败");
      }
    },
    [reload],
  );

  // ---- notification handlers (unchanged from v18) -------------------------

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
    } finally {
      setBusy(false);
    }
  }, [busy, notifs.unread_count]);

  const onNotifClick = useCallback(async (n: Notification) => {
    if (!n.read_at) {
      try {
        await api.markNotificationRead(n.id);
      } catch {}
      setNotifs((d) => ({
        items: d.items.map((x) =>
          x.id === n.id && !x.read_at
            ? { ...x, read_at: new Date().toISOString() }
            : x,
        ),
        unread_count: Math.max(0, d.unread_count - 1),
        max_unread_severity: d.max_unread_severity,
      }));
    }
  }, []);

  // ---- render --------------------------------------------------------------

  function renderTaskRow(t: MyTask, asReviewer: boolean) {
    const isOverdue =
      t.status !== "done" &&
      t.status !== "archived" &&
      t.status !== "cancelled" &&
      t.due_at &&
      new Date(t.due_at) < new Date();
    const meetingId = t.meeting_id;
    return (
      <li
        key={t.id}
        data-testid={`me-task-${t.id}`}
        data-status={t.status}
        className="py-3"
      >
        <div className="flex items-start gap-2">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              STATUS_COLOR[t.status] ?? "bg-zinc-700 text-zinc-300"
            }`}
          >
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-100 break-words">
              {t.content}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
              {meetingId ? (
                <Link
                  href={`/meeting/${meetingId}`}
                  className="hover:text-zinc-200"
                >
                  {t.meeting_title || "会议"}
                </Link>
              ) : (
                <span className="text-zinc-600">
                  {t.source_type === "leader_directive"
                    ? "📋 领导指令"
                    : t.source_type === "manual"
                    ? "✍️ 手动添加"
                    : t.source_type}
                </span>
              )}
              {t.due_at ? (
                <span className={isOverdue ? "text-rose-400" : "text-zinc-500"}>
                  📅 {fmtDate(t.due_at)}
                  {isOverdue ? "（已逾期）" : ""}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {asReviewer ? (
                <>
                  <button
                    onClick={() => onApprove(t)}
                    data-testid={`me-task-approve-${t.id}`}
                    className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-400"
                  >
                    通过
                  </button>
                  <button
                    onClick={() => onReject(t)}
                    data-testid={`me-task-reject-${t.id}`}
                    className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-ink-800"
                  >
                    驳回
                  </button>
                </>
              ) : (
                <>
                  {t.status === "dispatched" && (
                    <>
                      <button
                        onClick={() => onAccept(t)}
                        data-testid={`me-task-accept-${t.id}`}
                        className="rounded-md bg-accent-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-400"
                      >
                        签收
                      </button>
                      <button
                        onClick={() => onReturn(t)}
                        data-testid={`me-task-return-${t.id}`}
                        className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-ink-800"
                      >
                        退回
                      </button>
                    </>
                  )}
                  {t.status === "accepted" && (
                    <button
                      onClick={() => onStart(t)}
                      data-testid={`me-task-start-${t.id}`}
                      className="rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-400"
                    >
                      开始办理
                    </button>
                  )}
                  {t.status === "in_progress" && (
                    <button
                      onClick={() => onSubmit(t)}
                      data-testid={`me-task-submit-${t.id}`}
                      className="rounded-md bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-400"
                    >
                      上报办结
                    </button>
                  )}
                  {t.status === "submitted" && (
                    <span className="text-xs text-violet-400">
                      ⏳ 等待领导审核
                    </span>
                  )}
                  {t.status === "done" && (
                    <button
                      onClick={() => onArchive(t)}
                      data-testid={`me-task-archive-${t.id}`}
                      className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-ink-800"
                    >
                      归档
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 pt-20">
      <h1 className="text-xl font-medium text-white">我的工作台</h1>
      <p className="mt-1 text-sm text-zinc-500">
        我的任务、需我审核的工单,以及最近的通知。
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* 左:任务 */}
        <div className="space-y-6">
          <section
            data-testid="me-tasks-section"
            className="rounded-xl border border-ink-700 bg-ink-900 p-6"
          >
            <header>
              <h2 className="text-base font-medium text-white">我的任务</h2>
              <div className="mt-3 flex flex-wrap gap-1 rounded-lg border border-ink-700 p-0.5 text-xs">
                {TAB_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    data-testid={`me-tasks-tab-${t}`}
                    className={`rounded-md px-2 py-1 ${
                      tab === t
                        ? "bg-ink-800 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {TAB_LABELS[t]}
                  </button>
                ))}
              </div>
            </header>

            {tasksLoading ? (
              <p className="mt-4 text-sm text-zinc-500">加载中…</p>
            ) : tasks.length === 0 ? (
              <p
                className="mt-4 text-sm text-zinc-500"
                data-testid="me-tasks-empty"
              >
                {tab === "pending"
                  ? "没有待签收任务 🎉"
                  : tab === "working"
                  ? "没有办理中任务"
                  : tab === "review"
                  ? "没有等待审核的任务"
                  : tab === "done"
                  ? "暂无已完成任务"
                  : "暂无任务"}
              </p>
            ) : (
              <ul
                className="mt-3 divide-y divide-ink-800"
                data-testid="me-tasks-list"
              >
                {tasks.map((t) => renderTaskRow(t, false))}
              </ul>
            )}
          </section>

          {/* 待我审核 */}
          {(reviewLoading || reviewQueue.length > 0) && (
            <section
              data-testid="me-review-section"
              className="rounded-xl border border-violet-500/30 bg-ink-900 p-6"
            >
              <header className="flex items-center justify-between">
                <h2 className="text-base font-medium text-white">
                  待我审核
                  <span className="ml-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">
                    {reviewQueue.length}
                  </span>
                </h2>
              </header>
              {reviewLoading ? (
                <p className="mt-4 text-sm text-zinc-500">加载中…</p>
              ) : (
                <ul
                  className="mt-3 divide-y divide-ink-800"
                  data-testid="me-review-list"
                >
                  {reviewQueue.map((t) => renderTaskRow(t, true))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* 右:通知(沿用 v18 形态) */}
        <section
          data-testid="me-notifications-section"
          className="rounded-xl border border-ink-700 bg-ink-900 p-6"
        >
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-white">通知</h2>
              {notifs.unread_count > 0 ? (
                <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">
                  {notifs.unread_count} 未读
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={busy || notifs.unread_count === 0}
              data-testid="me-notifications-mark-all"
              className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
            >
              全部已读
            </button>
          </header>

          {notifsLoading ? (
            <p className="mt-4 text-sm text-zinc-500">加载中…</p>
          ) : notifs.items.length === 0 ? (
            <p
              className="mt-4 text-sm text-zinc-500"
              data-testid="me-notifications-empty"
            >
              暂无通知
            </p>
          ) : (
            <ul
              className="mt-3 divide-y divide-ink-800"
              data-testid="me-notifications-list"
            >
              {notifs.items.map((n) => {
                const p = (n.payload || {}) as Record<string, unknown>;
                const meetingId =
                  typeof p.meeting_id === "string" ? p.meeting_id : null;
                const unread = !n.read_at;
                const text = describeNotification(n);
                const inner = (
                  <div
                    className={`flex items-start gap-2 py-2 ${
                      unread ? "" : "opacity-70"
                    }`}
                  >
                    <span
                      className={`mt-1.5 inline-block h-1.5 w-1.5 flex-none rounded-full ${
                        unread ? "bg-rose-400" : "bg-transparent"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-200 break-words">
                        {text}
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-500">
                        {fmtRelative(n.created_at)}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    data-testid={`me-notification-${n.id}`}
                    data-kind={n.kind}
                    data-unread={unread ? "1" : "0"}
                  >
                    {meetingId ? (
                      <Link
                        href={`/meeting/${meetingId}`}
                        onClick={() => onNotifClick(n)}
                        className="block"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNotifClick(n)}
                        className="block w-full text-left"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
