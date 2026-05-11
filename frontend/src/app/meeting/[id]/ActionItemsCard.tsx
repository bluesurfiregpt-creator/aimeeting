"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ActionComment,
  type ActionItem,
  type User,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * M3.0 Action Items panel — displayed under SummaryCard on `processed` meetings.
 *
 * Shows the auto-extracted TODO list (source_type='summary'), plus any
 * manually-added items, with checkbox toggles for done/open. Polls until
 * the action_extractor finishes (which runs after summary generation).
 *
 * Theme 1 (P0): each row has an expandable comment thread. Clicking the
 * 💬 button toggles the thread; expanding fetches comments lazily so we
 * don't pay N round trips on the initial render. Adding a comment fires
 * `action_comment` notifications to the assignee + prior commenters
 * (server-side), and deleting a comment is author-only.
 */

type CommentState = {
  loaded: boolean;
  loading: boolean;
  items: ActionComment[];
  count: number;
  draft: string;
  posting: boolean;
};

const INITIAL_COMMENT_STATE: CommentState = {
  loaded: false,
  loading: false,
  items: [],
  count: 0,
  draft: "",
  posting: false,
};

export default function ActionItemsCard({ meetingId }: { meetingId: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("");
  const [adding, setAdding] = useState(false);
  // Per-action comment state, keyed by action.id. Expansion is sticky (we
  // keep the loaded items around even when the user collapses the thread)
  // so re-expanding is instant.
  const [comments, setComments] = useState<Record<string, CommentState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const r = await api.listActionItems(meetingId);
      setItems(r);
    } catch (e) {
      console.warn("listActionItems failed", e);
    } finally {
      setLoaded(true);
    }
  }, [meetingId]);

  useEffect(() => {
    void refresh();
    // Poll once at 5s and 15s — covers the gap between summary generation
    // finishing and action_extractor finishing (each is its own LLM call).
    const t1 = window.setTimeout(refresh, 5000);
    const t2 = window.setTimeout(refresh, 15000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [refresh]);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  const toggleStatus = useCallback(
    async (item: ActionItem) => {
      const nextStatus = item.status === "done" ? "open" : "done";
      // Optimistic update — server-side is single PATCH, fast.
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: nextStatus } : p)),
      );
      try {
        await api.patchActionItem(meetingId, item.id, { status: nextStatus });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新失败");
        await refresh();
      }
    },
    [meetingId, refresh],
  );

  const remove = useCallback(
    async (item: ActionItem) => {
      const before = items;
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      try {
        await api.deleteActionItem(meetingId, item.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
        setItems(before);
      }
    },
    [items, meetingId],
  );

  const addItem = useCallback(async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      await api.createActionItem(meetingId, {
        content,
        assignee_user_id: newAssignee || null,
      });
      setNewContent("");
      setNewAssignee("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }, [newContent, newAssignee, adding, meetingId, refresh]);

  // Lazy-load comments for an action when first expanded.
  const ensureComments = useCallback(
    async (actionId: string) => {
      const existing = comments[actionId];
      if (existing && existing.loaded) return;
      setComments((c) => ({
        ...c,
        [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), loading: true },
      }));
      try {
        const r = await api.listActionComments(meetingId, actionId);
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            loaded: true,
            loading: false,
            items: r,
            count: r.length,
          },
        }));
      } catch {
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            loading: false,
          },
        }));
      }
    },
    [comments, meetingId],
  );

  const toggleThread = useCallback(
    (actionId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(actionId)) {
          next.delete(actionId);
        } else {
          next.add(actionId);
          void ensureComments(actionId);
        }
        return next;
      });
    },
    [ensureComments],
  );

  const setDraft = useCallback((actionId: string, value: string) => {
    setComments((c) => ({
      ...c,
      [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), draft: value },
    }));
  }, []);

  const submitComment = useCallback(
    async (actionId: string) => {
      const cur = comments[actionId] ?? INITIAL_COMMENT_STATE;
      const body = cur.draft.trim();
      if (!body || cur.posting) return;
      setComments((c) => ({
        ...c,
        [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), posting: true },
      }));
      try {
        const created = await api.createActionComment(meetingId, actionId, body);
        setComments((c) => ({
          ...c,
          [actionId]: {
            ...(c[actionId] ?? INITIAL_COMMENT_STATE),
            items: [...(c[actionId]?.items ?? []), created],
            count: (c[actionId]?.count ?? 0) + 1,
            draft: "",
            posting: false,
          },
        }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "发送失败");
        setComments((c) => ({
          ...c,
          [actionId]: { ...(c[actionId] ?? INITIAL_COMMENT_STATE), posting: false },
        }));
      }
    },
    [comments, meetingId],
  );

  const deleteComment = useCallback(
    async (actionId: string, commentId: string) => {
      const before = comments[actionId];
      setComments((c) => ({
        ...c,
        [actionId]: {
          ...(c[actionId] ?? INITIAL_COMMENT_STATE),
          items: (c[actionId]?.items ?? []).filter((x) => x.id !== commentId),
          count: Math.max(0, (c[actionId]?.count ?? 0) - 1),
        },
      }));
      try {
        await api.deleteActionComment(meetingId, actionId, commentId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
        if (before) {
          setComments((c) => ({ ...c, [actionId]: before }));
        }
      }
    },
    [comments, meetingId],
  );

  if (!loaded) return null;

  const openCount = items.filter((i) => i.status === "open").length;

  return (
    <section
      data-testid="action-items-card"
      className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📌</span>
          <h2 className="text-base font-medium text-white">行动项</h2>
          <span className="ml-1 rounded-full bg-ink-800 px-2 py-0.5 text-xs text-zinc-400">
            {items.length} 项 · {openCount} 待办
          </span>
        </div>
        {/* v25.11: 清掉 LLM 自动提取的(hallucination 一键清) */}
        <button
          onClick={async () => {
            if (!confirm("清掉本会议 所有 LLM 自动提取的 行动项 + 对应任务?\n\n手动添加的不删.")) return;
            try {
              const r = await api.wipeAutoActions(meetingId);
              toast.success(`✅ 已清 ${r.deleted_actions} 行动项 + ${r.deleted_tasks} 任务`);
              // refresh
              const r2 = await api.listActionItems(meetingId);
              setItems(r2);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "清除失败");
            }
          }}
          className="text-xs text-zinc-500 hover:text-rose-400"
          title="清掉 LLM 自动提取的行动项(如果发现幻觉错误)— 手动添加的不删"
        >
          🗑️ 清自动提取
        </button>
      </header>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          这场会议没有自动抽取出明确的行动项。可以手动添加 ↓
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-800">
          {items.map((item) => {
            const checked = item.status === "done";
            const assignee = item.assignee_name || item.assignee_name_hint;
            const cstate = comments[item.id] ?? INITIAL_COMMENT_STATE;
            const isOpen = expanded.has(item.id);
            return (
              <li
                key={item.id}
                data-testid={`action-item-${item.id}`}
                className="py-2"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    data-testid={`action-checkbox-${item.id}`}
                    checked={checked}
                    onChange={() => toggleStatus(item)}
                    className="h-4 w-4 shrink-0 accent-accent-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={
                        checked
                          ? "line-through text-zinc-500 text-sm"
                          : "text-zinc-100 text-sm"
                      }
                    >
                      {item.content}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      {assignee ? (
                        <span title={item.assignee_user_id ? "已绑定用户" : "仅记录姓名,未绑定"}>
                          {item.assignee_user_id ? "👤" : "❓"} {assignee}
                        </span>
                      ) : (
                        <span className="text-zinc-600">未指定负责人</span>
                      )}
                      {item.due_at ? (
                        <span>📅 {new Date(item.due_at).toLocaleDateString("zh-CN")}</span>
                      ) : null}
                      <span className="text-zinc-700">
                        {item.source_type === "summary" ? "自动抽取" : "手动添加"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleThread(item.id)}
                    data-testid={`action-comments-toggle-${item.id}`}
                    data-expanded={isOpen ? "1" : "0"}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                      isOpen
                        ? "bg-ink-800 text-zinc-200"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                    title="评论"
                  >
                    💬{cstate.count > 0 ? ` ${cstate.count}` : ""}
                  </button>
                  <button
                    onClick={() => remove(item)}
                    className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>

                {isOpen ? (
                  <div
                    className="mt-2 ml-7 rounded-lg border border-ink-800 bg-ink-950/60 p-3"
                    data-testid={`action-comments-thread-${item.id}`}
                  >
                    {cstate.loading && !cstate.loaded ? (
                      <p className="text-xs text-zinc-500">加载评论…</p>
                    ) : cstate.items.length === 0 ? (
                      <p className="text-xs text-zinc-500">还没有评论</p>
                    ) : (
                      <ul className="space-y-2">
                        {cstate.items.map((c) => (
                          <li
                            key={c.id}
                            data-testid={`action-comment-${c.id}`}
                            className="text-xs"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-zinc-300">
                                {c.author_name || "已删除用户"}
                              </span>
                              <span className="text-[10px] text-zinc-600">
                                {new Date(c.created_at).toLocaleString("zh-CN")}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-start gap-2">
                              <p className="flex-1 whitespace-pre-wrap text-zinc-200">
                                {c.content}
                              </p>
                              {c.can_delete ? (
                                <button
                                  type="button"
                                  data-testid={`action-comment-delete-${c.id}`}
                                  onClick={() => deleteComment(item.id, c.id)}
                                  className="shrink-0 text-[10px] text-zinc-600 hover:text-rose-400"
                                  title="删除我的留言"
                                >
                                  删除
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex items-end gap-2">
                      <textarea
                        rows={2}
                        value={cstate.draft}
                        onChange={(e) => setDraft(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            (e.metaKey || e.ctrlKey) &&
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            void submitComment(item.id);
                          }
                        }}
                        data-testid={`action-comment-input-${item.id}`}
                        placeholder="写一条进展或反馈，⌘/Ctrl + ↵ 发送…"
                        className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        data-testid={`action-comment-submit-${item.id}`}
                        onClick={() => void submitComment(item.id)}
                        disabled={!cstate.draft.trim() || cstate.posting}
                        className="shrink-0 rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                      >
                        {cstate.posting ? "发送…" : "发送"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Manual add row */}
      <div className="mt-4 flex items-center gap-2">
        <select
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
          data-testid="action-add-assignee"
          className="shrink-0 rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
        >
          <option value="">未指定</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          data-testid="action-add-content"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void addItem();
            }
          }}
          placeholder="添加一项行动项,回车保存…"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
        />
        <button
          data-testid="action-add-submit"
          onClick={() => void addItem()}
          disabled={!newContent.trim() || adding}
          className="shrink-0 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          {adding ? "添加中…" : "添加"}
        </button>
      </div>
    </section>
  );
}
