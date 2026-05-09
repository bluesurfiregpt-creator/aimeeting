"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CronRule, type CronRuleInput, type User } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * v20 — /admin/cron-rules
 *
 * 列表 + 创建表单(底部) + 行内开关 / 删除 / 立即触发(测试用).
 *
 * cron_expr 简化版语法说明就在创建表单里给出常用例子,用户不必背 cron 知识.
 */

const PRESETS: { label: string; cron: string }[] = [
  { label: "每天早 9 点", cron: "0 9 * * *" },
  { label: "每周一早 9 点", cron: "0 9 * * 1" },
  { label: "每月 1 号早 9 点", cron: "0 9 1 * *" },
  { label: "工作日早 9 点", cron: "0 9 * * 1,2,3,4,5" },
];

const EMPTY_INPUT: CronRuleInput = {
  name: "",
  cron_expr: "0 9 * * 1",
  task_template_content: "",
  task_template_title: null,
  task_template_assignee_user_id: null,
  auto_dispatch: true,
  due_days_after: 7,
  is_active: true,
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
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

export default function CronRulesPage() {
  const [rules, setRules] = useState<CronRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<CronRuleInput>(EMPTY_INPUT);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, us] = await Promise.all([
        api.listCronRules(),
        api.listUsers(),
      ]);
      setRules(rs);
      setUsers(us);
    } catch {
      // api.ts already toasts non-401 errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = useCallback(async () => {
    if (creating) return;
    if (!draft.name.trim() || !draft.task_template_content.trim()) {
      toast.warn("请填写名称 + 任务内容模板");
      return;
    }
    setCreating(true);
    try {
      await api.createCronRule({
        ...draft,
        name: draft.name.trim(),
        cron_expr: draft.cron_expr.trim(),
        task_template_content: draft.task_template_content.trim(),
        task_template_title: draft.task_template_title?.trim() || null,
      });
      setDraft(EMPTY_INPUT);
      await load();
      toast.success("已创建");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }, [draft, creating, load]);

  const onToggleActive = useCallback(
    async (r: CronRule) => {
      try {
        await api.updateCronRule(r.id, { is_active: !r.is_active });
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新失败");
      }
    },
    [load],
  );

  const onDelete = useCallback(
    async (r: CronRule) => {
      if (!window.confirm(`删除规则「${r.name}」?已 instantiate 的 Task 不会被清理.`)) return;
      try {
        await api.deleteCronRule(r.id);
        await load();
        toast.success("已删除");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
      }
    },
    [load],
  );

  const onForceFire = useCallback(
    async (r: CronRule) => {
      try {
        const out = await api.forceFireCronRule(r.id);
        toast.success("已立即触发", { detail: `Task ${out.task_id.slice(0, 8)}…` });
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "触发失败");
      }
    },
    [load],
  );

  return (
    <div data-testid="cron-rules-page">
      <p className="text-sm text-zinc-500">
        定期巡检触发源:按 cron 表达式自动 instantiate 工单,触发后会进入相应 assignee 的待办列表.
      </p>

      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6">
        <h2 className="text-base font-medium text-white">规则列表</h2>
        {loading ? (
          <p className="mt-3 text-sm text-zinc-500">加载中…</p>
        ) : rules.length === 0 ? (
          <p
            className="mt-3 text-sm text-zinc-500"
            data-testid="cron-rules-empty"
          >
            还没有定期规则。在下方表单创建一条试试.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-800" data-testid="cron-rules-list">
            {rules.map((r) => {
              const assigneeName =
                users.find((u) => u.id === r.task_template_assignee_user_id)?.name ||
                "未指定";
              return (
                <li
                  key={r.id}
                  data-testid={`cron-rule-${r.id}`}
                  className="py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            r.is_active ? "bg-emerald-400" : "bg-zinc-600"
                          }`}
                        />
                        <span className="text-sm font-medium text-zinc-100">
                          {r.name}
                        </span>
                        <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                          {r.cron_expr}
                        </code>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400 break-words">
                        {r.task_template_content}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
                        <span>👤 {assigneeName}</span>
                        {r.due_days_after ? <span>⏱ {r.due_days_after}d 截止</span> : null}
                        {r.auto_dispatch ? <span className="text-amber-400">自动派发</span> : null}
                        <span>已触发 {r.fire_count} 次</span>
                        <span>上次:{fmtRelative(r.last_fired_at)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => onToggleActive(r)}
                        data-testid={`cron-rule-toggle-${r.id}`}
                        className="text-xs text-zinc-400 hover:text-zinc-100"
                      >
                        {r.is_active ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onForceFire(r)}
                        data-testid={`cron-rule-force-fire-${r.id}`}
                        className="text-xs text-accent-400 hover:text-accent-300"
                        title="不等 cron,立即生成一条 Task"
                      >
                        立即触发
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(r)}
                        className="text-xs text-zinc-500 hover:text-rose-400"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6">
        <h2 className="text-base font-medium text-white">新建定期规则</h2>
        <div className="mt-4 grid gap-3">
          <label className="text-xs text-zinc-400">
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例:每周一安全巡检"
              data-testid="cron-rule-name"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <label className="text-xs text-zinc-400">
            cron 表达式(分 时 日 月 周;支持 数字 / * / */N / 逗号列表)
            <input
              type="text"
              value={draft.cron_expr}
              onChange={(e) => setDraft({ ...draft, cron_expr: e.target.value })}
              placeholder="例:0 9 * * 1(每周一上午 9 点)"
              data-testid="cron-rule-expr"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 font-mono focus:border-accent-500 focus:outline-none"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setDraft({ ...draft, cron_expr: p.cron })}
                  className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-ink-800"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </label>
          <label className="text-xs text-zinc-400">
            任务内容模板
            <textarea
              rows={2}
              value={draft.task_template_content}
              onChange={(e) =>
                setDraft({ ...draft, task_template_content: e.target.value })
              }
              placeholder="例:提交本周小散工程现场巡查报告"
              data-testid="cron-rule-content"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-zinc-400">
              负责人(可选)
              <select
                value={draft.task_template_assignee_user_id || ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    task_template_assignee_user_id: e.target.value || null,
                    auto_dispatch: e.target.value ? draft.auto_dispatch : false,
                  })
                }
                data-testid="cron-rule-assignee"
                className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-accent-500 focus:outline-none"
              >
                <option value="">未指定</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-400">
              截止天数(可选,1-365)
              <input
                type="number"
                min={1}
                max={365}
                value={draft.due_days_after ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    due_days_after: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                placeholder="7"
                className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent-500 focus:outline-none"
              />
            </label>
          </div>
          <label
            className={`flex items-center gap-2 text-xs text-zinc-400 ${
              !draft.task_template_assignee_user_id ? "opacity-40" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={draft.auto_dispatch && !!draft.task_template_assignee_user_id}
              disabled={!draft.task_template_assignee_user_id}
              onChange={(e) => setDraft({ ...draft, auto_dispatch: e.target.checked })}
              data-testid="cron-rule-auto-dispatch"
              className="h-3 w-3 accent-accent-500"
            />
            <span>触发时自动派发(直接进 dispatched 状态,通知负责人)</span>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              data-testid="cron-rule-create"
              className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
            >
              {creating ? "创建中…" : "创建"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
