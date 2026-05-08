"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ActionItem, type User } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * M3.0 Action Items panel — displayed under SummaryCard on `processed` meetings.
 *
 * Shows the auto-extracted TODO list (source_type='summary'), plus any
 * manually-added items, with checkbox toggles for done/open. Polls until
 * the action_extractor finishes (which runs after summary generation).
 *
 * The UI intentionally does NOT support full editing in this MVP — just
 * toggle status, add new, and delete. Reassigning / due-date editing can be
 * added in the next iteration once we know how it's used in practice.
 */
export default function ActionItemsCard({ meetingId }: { meetingId: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("");
  const [adding, setAdding] = useState(false);

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
            return (
              <li
                key={item.id}
                data-testid={`action-item-${item.id}`}
                className="flex items-center gap-3 py-2"
              >
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
                  onClick={() => remove(item)}
                  className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                  title="删除"
                >
                  ✕
                </button>
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
