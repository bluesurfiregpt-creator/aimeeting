"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type MyAction,
  type Notification,
  type NotificationList,
} from "@/lib/api";

/**
 * Theme 1 (P0): personal dashboard.
 *
 * Two columns on desktop, stacked on mobile:
 *   - 我的待办 — open action items across the workspace, grouped by meeting
 *     so the user can see "this came from《产品周会》" without clicking
 *     through. Tab-toggle to "已完成" for closure history.
 *   - 通知 — same dataset as the bell drawer but rendered with full text
 *     instead of preview, and with a "全部已读" affordance.
 *
 * Both sections re-fetch when the page mounts; we don't poll here because
 * the bell already polls and a personal dashboard doesn't need realtime.
 * A "刷新" button gives the user explicit control on long-lived tabs.
 */

type ActionTab = "open" | "done";

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
    default:
      return n.kind;
  }
}

export default function MePage() {
  const [actionsTab, setActionsTab] = useState<ActionTab>("open");
  const [actions, setActions] = useState<MyAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [notifs, setNotifs] = useState<NotificationList>({
    items: [],
    unread_count: 0,
  });
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadActions = useCallback(async (tab: ActionTab) => {
    setActionsLoading(true);
    try {
      const r = await api.listMyActions(tab);
      setActions(r);
    } catch {
      setActions([]);
    } finally {
      setActionsLoading(false);
    }
  }, []);

  const loadNotifs = useCallback(async () => {
    setNotifsLoading(true);
    try {
      const r = await api.listMyNotifications(false, 100);
      setNotifs(r);
    } catch {
      setNotifs({ items: [], unread_count: 0 });
    } finally {
      setNotifsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActions(actionsTab);
  }, [actionsTab, loadActions]);

  useEffect(() => {
    void loadNotifs();
  }, [loadNotifs]);

  const onToggleAction = useCallback(
    async (a: MyAction) => {
      const next = a.status === "done" ? "open" : "done";
      // Optimistic — fall back on failure.
      setActions((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, status: next } : x)),
      );
      try {
        await api.patchActionItem(a.meeting_id, a.id, { status: next });
        // Re-load: when the user toggles in the "open" tab, the row should
        // disappear (and vice versa for "done"). Cheap re-fetch is simpler
        // than maintaining two lists.
        await loadActions(actionsTab);
      } catch {
        await loadActions(actionsTab);
      }
    },
    [actionsTab, loadActions],
  );

  const onMarkAll = useCallback(async () => {
    if (busy || notifs.unread_count === 0) return;
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifs((d) => ({
        items: d.items.map((x) => (x.read_at ? x : { ...x, read_at: now })),
        unread_count: 0,
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
      }));
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 pt-20">
      <h1 className="text-xl font-medium text-white">我的待办</h1>
      <p className="mt-1 text-sm text-zinc-500">
        分配给你的行动项，以及最近的通知。
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* 我的待办 */}
        <section
          data-testid="me-actions-section"
          className="rounded-xl border border-ink-700 bg-ink-900 p-6"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-base font-medium text-white">行动项</h2>
            <div className="flex gap-1 rounded-lg border border-ink-700 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActionsTab("open")}
                data-testid="me-actions-tab-open"
                className={`rounded-md px-2 py-1 ${
                  actionsTab === "open"
                    ? "bg-ink-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                未完成
              </button>
              <button
                type="button"
                onClick={() => setActionsTab("done")}
                data-testid="me-actions-tab-done"
                className={`rounded-md px-2 py-1 ${
                  actionsTab === "done"
                    ? "bg-ink-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                已完成
              </button>
            </div>
          </header>

          {actionsLoading ? (
            <p className="mt-4 text-sm text-zinc-500">加载中…</p>
          ) : actions.length === 0 ? (
            <p
              className="mt-4 text-sm text-zinc-500"
              data-testid="me-actions-empty"
            >
              {actionsTab === "open"
                ? "你目前没有待办的行动项 🎉"
                : "暂无已完成的行动项"}
            </p>
          ) : (
            <ul
              className="mt-3 divide-y divide-ink-800"
              data-testid="me-actions-list"
            >
              {actions.map((a) => {
                const checked = a.status === "done";
                const isOverdue =
                  !checked && a.due_at && new Date(a.due_at) < new Date();
                return (
                  <li
                    key={a.id}
                    data-testid={`me-action-${a.id}`}
                    className="flex items-start gap-3 py-2"
                  >
                    <input
                      type="checkbox"
                      data-testid={`me-action-checkbox-${a.id}`}
                      checked={checked}
                      onChange={() => onToggleAction(a)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={
                          checked
                            ? "text-sm line-through text-zinc-500"
                            : "text-sm text-zinc-100"
                        }
                      >
                        {a.content}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                        <Link
                          href={`/meeting/${a.meeting_id}`}
                          className="hover:text-zinc-200"
                        >
                          {a.meeting_title || "未命名会议"}
                        </Link>
                        {a.due_at ? (
                          <span
                            className={
                              isOverdue ? "text-rose-400" : "text-zinc-500"
                            }
                          >
                            📅 {fmtDate(a.due_at)}
                            {isOverdue ? "（已逾期）" : ""}
                          </span>
                        ) : null}
                        <span className="text-zinc-700">
                          {a.source_type === "summary" ? "自动" : "手动"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 通知 */}
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
