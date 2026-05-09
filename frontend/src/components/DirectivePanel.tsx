"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type DirectiveCommitTask,
  type DirectiveDraft,
  type User,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v19 → v20 — 任务源 → LLM 拆解 → 用户确认 → 批量入库
 *
 * 两种 mode(顶部 tab 切换):
 *   text  — 自然语言指令(v19,默认):textarea → 解析 → 草稿
 *   file  — 上级文件(v20):上传 PDF/Word/...等 → 后端抽文本+LLM 拆 → 草稿
 *
 * 一旦有了草稿,两条路径汇合:同样的 draft 列表 UI、同样的逐条编辑/派发,
 * commit/discard 时根据 source.kind 调用不同 endpoint.
 *
 * 由 AuthHeader 顶栏控制开/关.
 */

type SourceObject =
  | { kind: "directive"; id: string; parse_error: string | null }
  | { kind: "upper_doc"; id: string; parse_error: string | null; filename: string };

type Mode = "text" | "file";

type DraftRow = DirectiveDraft & {
  _key: string;
  _dispatch: boolean;
  /** v22.5: per-draft 协办列表(最多 5 人,不能含主责) */
  _co_assignees: string[];
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function draftsToRows(drafts: DirectiveDraft[]): DraftRow[] {
  return drafts.map((d) => ({
    ...d,
    _key: uid(),
    _dispatch: !!d.assignee_user_id,
    _co_assignees: [],
  }));
}

const MAX_CO_ASSIGNEES = 5;

const MODE_LABELS: Record<Mode, string> = {
  text: "文本指令",
  file: "上级文件",
};

export default function DirectivePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [source, setSource] = useState<SourceObject | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Workspace users for assignee dropdown.
  useEffect(() => {
    if (!open) return;
    api.listUsers().then(setUsers).catch(() => {});
  }, [open]);

  // Reset state on close so re-open is clean.
  useEffect(() => {
    if (!open) {
      setMode("text");
      setText("");
      setFile(null);
      setSource(null);
      setDrafts([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  // Switching mode after parsing → reset (next parse should be in the new mode).
  const onModeSwitch = useCallback((m: Mode) => {
    if (m === mode) return;
    if (source !== null) {
      // Discarding silently happens server-side too if user closes;
      // here we just clear the local drafts so the new mode starts fresh.
    }
    setMode(m);
    setSource(null);
    setDrafts([]);
  }, [mode, source]);

  const onParseText = useCallback(async () => {
    const content = text.trim();
    if (!content || parsing) return;
    setParsing(true);
    try {
      const d = await api.createDirective(content);
      setSource({ kind: "directive", id: d.id, parse_error: d.parse_error });
      if (d.parse_error) {
        toast.warn("LLM 拆解失败", { detail: d.parse_error });
      }
      setDrafts(draftsToRows(d.drafts));
      if (d.drafts.length === 0 && !d.parse_error) {
        toast.warn("没有从指令里识别出可执行任务", {
          detail: "试着重写指令,把负责人和截止日期写明确",
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解析失败");
    } finally {
      setParsing(false);
    }
  }, [text, parsing]);

  const onParseFile = useCallback(async () => {
    if (!file || parsing) return;
    setParsing(true);
    try {
      const d = await api.uploadUpperDoc(file);
      setSource({
        kind: "upper_doc",
        id: d.id,
        parse_error: d.parse_error,
        filename: d.filename,
      });
      if (d.parse_error) {
        toast.warn("文件解析或 LLM 失败", { detail: d.parse_error });
      }
      setDrafts(draftsToRows(d.drafts));
      if (d.drafts.length === 0 && !d.parse_error) {
        toast.warn("没有从文件里识别出可执行任务", {
          detail: "确认文件含可读文字,或检查文档结构",
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "文件解析失败");
    } finally {
      setParsing(false);
    }
  }, [file, parsing]);

  const onCommit = useCallback(async () => {
    if (!source || committing) return;
    const cleaned: DirectiveCommitTask[] = drafts
      .filter((d) => (d.content || "").trim().length > 0)
      .map((d) => {
        const willDispatch = d._dispatch && !!d.assignee_user_id;
        // 协办去重 + 排除主责自己(防御性,UI 也应该不出现这种情况)
        const co = willDispatch
          ? Array.from(new Set(d._co_assignees)).filter(
              (u) => u !== d.assignee_user_id,
            )
          : [];
        return {
          content: d.content,
          title: d.title || null,
          assignee_user_id: d.assignee_user_id || null,
          due_at: d.due_at ? `${d.due_at}T00:00:00Z` : null,
          dispatch: willDispatch,
          co_assignees: co.length > 0 ? co : null,
        };
      });
    if (cleaned.length === 0) {
      toast.warn("草稿为空,请至少留一条任务");
      return;
    }
    setCommitting(true);
    try {
      const r =
        source.kind === "directive"
          ? await api.commitDirective(source.id, cleaned)
          : await api.commitUpperDoc(source.id, cleaned);
      toast.success(
        `已入库 ${r.committed_task_ids.length} 条任务`,
        r.dispatched_count > 0
          ? { detail: `其中 ${r.dispatched_count} 条已直接派发` }
          : undefined,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "入库失败");
    } finally {
      setCommitting(false);
    }
  }, [source, drafts, committing, onClose]);

  const onDiscard = useCallback(async () => {
    if (!source) {
      onClose();
      return;
    }
    try {
      if (source.kind === "directive") {
        await api.discardDirective(source.id);
      } else {
        await api.discardUpperDoc(source.id);
      }
    } catch {
      // ignore — close anyway
    }
    onClose();
  }, [source, onClose]);

  const updateDraft = useCallback(
    (key: string, patch: Partial<DraftRow>) => {
      setDrafts((rows) =>
        rows.map((r) => (r._key === key ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const removeDraft = useCallback((key: string) => {
    setDrafts((rows) => rows.filter((r) => r._key !== key));
  }, []);

  const addBlankDraft = useCallback(() => {
    setDrafts((rows) => [
      ...rows,
      {
        _key: uid(),
        _dispatch: false,
        _co_assignees: [],
        content: "",
        title: null,
        assignee_name: null,
        assignee_user_id: null,
        due_at: null,
      },
    ]);
  }, []);

  // v22.5: 切换协办勾选状态(toggle)
  const toggleCoAssignee = useCallback(
    (key: string, userId: string) => {
      setDrafts((rows) =>
        rows.map((r) => {
          if (r._key !== key) return r;
          const isOn = r._co_assignees.includes(userId);
          if (isOn) {
            return { ...r, _co_assignees: r._co_assignees.filter((x) => x !== userId) };
          }
          if (r._co_assignees.length >= MAX_CO_ASSIGNEES) {
            toast.warn(`协办最多 ${MAX_CO_ASSIGNEES} 人`);
            return r;
          }
          return { ...r, _co_assignees: [...r._co_assignees, userId] };
        }),
      );
    },
    [],
  );

  if (!open) return null;

  const showInputArea = source === null;
  const canParseText = mode === "text" && text.trim().length > 0 && !parsing;
  const canParseFile = mode === "file" && file !== null && !parsing;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-8"
      data-testid="directive-panel"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <header className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-medium text-white">下达指令</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              文本或上级文件 → 系统拆解成结构化任务待你确认
            </p>
          </div>
          <button
            type="button"
            onClick={onDiscard}
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >
            关闭
          </button>
        </header>

        {/* Mode tabs */}
        {showInputArea && (
          <div className="mt-4 flex gap-1 rounded-lg border border-ink-700 p-0.5 text-xs">
            {(["text", "file"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeSwitch(m)}
                data-testid={`directive-mode-${m}`}
                className={`flex-1 rounded-md px-3 py-1.5 transition ${
                  mode === m
                    ? "bg-ink-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}

        {/* 输入区 */}
        {showInputArea && (
          <div className="mt-3">
            {mode === "text" ? (
              <>
                <textarea
                  data-testid="directive-input"
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={parsing}
                  placeholder="例如:请王科长在本周五前提交一份小散工程上半年安全检查报告。"
                  className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none disabled:opacity-60"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="directive-parse"
                    onClick={onParseText}
                    disabled={!canParseText}
                    className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                  >
                    {parsing ? "解析中(约 5-15s)…" : "解析"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.json,.yaml,.yml"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={parsing}
                  data-testid="upper-doc-input"
                  className="block w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-zinc-200 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200 hover:file:bg-ink-600 disabled:opacity-60"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  支持 PDF / DOCX / XLSX / TXT / MD / CSV / JSON / YAML,最大 10MB.系统抽取文本后调 LLM 拆解.
                </p>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="upper-doc-parse"
                    onClick={onParseFile}
                    disabled={!canParseFile}
                    className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
                  >
                    {parsing ? "上传 + 解析中(约 10-30s)…" : "上传 + 解析"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 来源摘要 */}
        {source && source.kind === "upper_doc" && (
          <div
            className="mt-4 rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-zinc-400"
            data-testid="upper-doc-source-summary"
          >
            📄 {source.filename}
          </div>
        )}

        {/* 草稿列表 */}
        {source && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm text-zinc-300">
                拆解结果 · {drafts.length} 条任务
              </h3>
              <button
                type="button"
                onClick={addBlankDraft}
                className="text-xs text-zinc-500 hover:text-zinc-200"
              >
                + 加一条
              </button>
            </div>

            {drafts.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">
                {source.parse_error
                  ? `解析未成功:${source.parse_error}`
                  : "没有草稿。可以「+ 加一条」手动添加,或直接关闭."}
              </p>
            ) : (
              <ul
                className="mt-3 divide-y divide-ink-800"
                data-testid="directive-draft-list"
              >
                {drafts.map((d) => (
                  <li
                    key={d._key}
                    className="py-3"
                    data-testid="directive-draft-row"
                  >
                    <textarea
                      rows={2}
                      value={d.content}
                      onChange={(e) =>
                        updateDraft(d._key, { content: e.target.value })
                      }
                      className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
                      data-testid="directive-draft-content"
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <select
                        value={d.assignee_user_id || ""}
                        onChange={(e) =>
                          updateDraft(d._key, {
                            assignee_user_id: e.target.value || null,
                            _dispatch: e.target.value
                              ? d._dispatch
                              : false,
                          })
                        }
                        className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
                        data-testid="directive-draft-assignee"
                      >
                        <option value="">未指定</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      {d.assignee_name && !d.assignee_user_id ? (
                        <span className="text-[10px] text-amber-400">
                          ❓ LLM 识别到「{d.assignee_name}」但未匹配用户,请手选
                        </span>
                      ) : null}
                      <input
                        type="date"
                        value={d.due_at || ""}
                        onChange={(e) =>
                          updateDraft(d._key, { due_at: e.target.value || null })
                        }
                        className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
                        data-testid="directive-draft-due"
                      />
                      <label
                        className={`flex items-center gap-1 ${
                          !d.assignee_user_id ? "opacity-40" : ""
                        }`}
                        title={
                          d.assignee_user_id
                            ? "勾选则入库时直接派发(状态 → dispatched),不勾则入库为 open"
                            : "需要先选 assignee 才能派发"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={d._dispatch && !!d.assignee_user_id}
                          disabled={!d.assignee_user_id}
                          onChange={(e) =>
                            updateDraft(d._key, { _dispatch: e.target.checked })
                          }
                          data-testid="directive-draft-dispatch"
                          className="h-3 w-3 accent-accent-500"
                        />
                        <span>立即派发</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeDraft(d._key)}
                        className="ml-auto text-[10px] text-zinc-600 hover:text-rose-400"
                        data-testid="directive-draft-remove"
                      >
                        删除
                      </button>
                    </div>
                    {/* v22.5: 协办多选 — 仅在选了主责 + 勾了「立即派发」时显示 */}
                    {d._dispatch && d.assignee_user_id ? (
                      <div className="mt-2 rounded-md border border-ink-800 bg-ink-950/50 px-2 py-1.5">
                        <div className="text-[10px] text-zinc-500 mb-1">
                          协办(可选,最多 {MAX_CO_ASSIGNEES} 人;协办方收到通知后可独立提交进度)
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {users
                            .filter((u) => u.id !== d.assignee_user_id)
                            .map((u) => {
                              const checked = d._co_assignees.includes(u.id);
                              return (
                                <button
                                  type="button"
                                  key={u.id}
                                  onClick={() => toggleCoAssignee(d._key, u.id)}
                                  data-testid={`directive-draft-co-${u.id}`}
                                  className={`rounded px-2 py-0.5 text-[10px] border transition ${
                                    checked
                                      ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-200"
                                      : "border-ink-700 bg-ink-900 text-zinc-400 hover:bg-ink-800"
                                  }`}
                                >
                                  {checked ? "✓ " : "+ "}
                                  {u.name}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDiscard}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800"
              >
                丢弃
              </button>
              <button
                type="button"
                data-testid="directive-commit"
                onClick={onCommit}
                disabled={committing || drafts.length === 0}
                className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
              >
                {committing ? "入库中…" : "全部入库"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
