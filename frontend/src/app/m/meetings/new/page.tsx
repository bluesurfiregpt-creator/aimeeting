"use client";

/**
 * v27.0-mobile P9 · /m/meetings/new · 新建会议页.
 *
 * 入口:
 *   - /m/meetings 列表页右上角 "+"
 *   - 首页 Hero "今天没会议" 空态加 "新建一场 →"
 *
 * 表单字段:
 *   - title
 *   - 议程 (multi-item: title + time_budget_min)
 *   - mode radio (hybrid: 真人+AI 混合 / auto: 全 AI 自主)
 *   - 邀请真人 (workspace members 多选, leader+ 才能拉成员列表)
 *   - 邀请 AI 专家
 *
 * 创建成功 → 跳 /m/meetings/<新 id>.
 * status="scheduled". 用户进会议室后还得手动开始 (桌面端流程).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import { invalidateCache } from "@/lib/mobile/swrCache";
import type {
  WorkspaceAgentBrief,
  WorkspaceMember,
} from "@/lib/mobile/types";

type AgendaItem = {
  id: string; // 客户端临时 id, 用于 React key
  title: string;
  time_budget_min: string; // 输入框值, 不是 number — 解析时转
};

type Mode = "hybrid" | "auto";

export default function NewMeetingPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [agenda, setAgenda] = useState<AgendaItem[]>([
    { id: crypto.randomUUID(), title: "", time_budget_min: "" },
  ]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgentBrief[] | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // 拉成员 + AI
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [m, a] = await Promise.all([
          mApi.getWorkspaceMembers().catch((e) => {
            // 403 for member role — 用 stub list (含当前 user 自己)
            if (alive) {
              setMembersErr(
                e instanceof Error && e.message.includes("403")
                  ? "仅 leader+ 可看完整成员列表 (你只能邀请 AI)"
                  : e.message,
              );
            }
            return [] as WorkspaceMember[];
          }),
          mApi.getWorkspaceAgents(),
        ]);
        if (!alive) return;
        setMembers(m);
        // 过滤 agents: 只显 expert 类 (不显 moderator 等内置)
        setAgents(a.filter((x) => x.is_active && x.role === "expert"));
      } catch (e) {
        if (alive) {
          setToast({
            kind: "error",
            text: `加载失败: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // === 议程操作 ===
  const addAgenda = () =>
    setAgenda((a) => [
      ...a,
      { id: crypto.randomUUID(), title: "", time_budget_min: "" },
    ]);
  const removeAgenda = (id: string) =>
    setAgenda((a) => (a.length > 1 ? a.filter((x) => x.id !== id) : a));
  const updateAgenda = (id: string, patch: Partial<AgendaItem>) =>
    setAgenda((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // === 选 toggles ===
  const toggleUser = (uid: string) =>
    setSelectedUserIds((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  const toggleAgent = (aid: string) =>
    setSelectedAgentIds((s) => {
      const n = new Set(s);
      if (n.has(aid)) n.delete(aid);
      else n.add(aid);
      return n;
    });

  // === 表单校验 ===
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!title.trim()) errors.push("会议标题不能为空");
    const validAgenda = agenda.filter((it) => it.title.trim().length > 0);
    if (validAgenda.length === 0) {
      errors.push("至少加一个议程项");
    }
    if (mode === "auto") {
      if (validAgenda.length < 2) {
        errors.push("全 AI 自主模式至少需要 2 个议程项");
      }
      if (selectedAgentIds.size < 3) {
        errors.push("全 AI 自主模式至少需要邀请 3 个 AI 专家");
      }
    } else {
      if (selectedUserIds.size + selectedAgentIds.size === 0) {
        errors.push("至少邀请 1 个真人或 AI 专家");
      }
    }
    return { errors, ok: errors.length === 0 };
  }, [title, agenda, mode, selectedAgentIds, selectedUserIds]);

  // === 提交 ===
  const handleSubmit = useCallback(async () => {
    if (creating || !validation.ok) return;
    setCreating(true);
    try {
      const cleanedAgenda = agenda
        .filter((it) => it.title.trim().length > 0)
        .map((it) => {
          const budget = parseInt(it.time_budget_min, 10);
          return {
            title: it.title.trim(),
            time_budget_min:
              Number.isFinite(budget) && budget > 0 ? budget : null,
          };
        });

      const out = await mApi.createMeeting({
        title: title.trim(),
        attendee_user_ids: Array.from(selectedUserIds),
        attendee_agent_ids: Array.from(selectedAgentIds),
        agenda: cleanedAgenda,
        mode,
      });

      // P9 立即开始会议 (scheduled → ongoing). 用户体感 "创建即开始" 一气呵成.
      // 若 start 失败 不阻塞 — 详情页有 fallback 按钮兜底.
      try {
        await mApi.startMeeting(out.id);
      } catch {
        // silent; detail page 仍可手动开始
      }

      // 让会议列表下次切到时重拉
      invalidateCache("m:meetings");
      invalidateCache("m:workbench");
      // 跳新会议详情
      router.push(`/m/meetings/${out.id}`);
    } catch (e) {
      setToast({
        kind: "error",
        text: `创建失败: ${e instanceof Error ? e.message : String(e)}`,
      });
      setCreating(false);
    }
  }, [
    creating,
    validation.ok,
    agenda,
    title,
    selectedUserIds,
    selectedAgentIds,
    mode,
    router,
  ]);

  return (
    <div>
      {/* TopBar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link
          href="/m/meetings"
          className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-semibold text-zinc-50">
          新建会议
        </h1>
      </div>

      <main className="space-y-5 p-4 pb-28">
        {/* === 标题 === */}
        <section>
          <Label>会议标题</Label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: Q1 投诉处理评估会"
            maxLength={120}
            className="mt-2 h-12 w-full rounded-xl border border-ink-800 bg-ink-900 px-4 text-[16px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/60 focus:outline-none"
          />
        </section>

        {/* === 类型 === */}
        <section>
          <Label>会议类型</Label>
          <div className="mt-2 space-y-2">
            <ModeOption
              checked={mode === "hybrid"}
              onSelect={() => setMode("hybrid")}
              title="真人 + AI 混合"
              body="真人开会, AI 旁观或被召出来发言. 大多会议选这个."
            />
            <ModeOption
              checked={mode === "auto"}
              onSelect={() => setMode("auto")}
              title="全 AI 自主讨论"
              body="真人写议程, AI 自己跑. 你只负责 review 结果. 需要 ≥ 2 议程项 + ≥ 3 AI 专家."
            />
          </div>
        </section>

        {/* === 议程 === */}
        <section>
          <div className="flex items-center justify-between">
            <Label>议程 ({agenda.length})</Label>
            <button
              type="button"
              onClick={addAgenda}
              className="text-[14px] font-medium text-accent-400 active:text-accent-300"
            >
              + 加一项
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {agenda.map((item, idx) => (
              <li
                key={item.id}
                className="rounded-xl border border-ink-800 bg-ink-900 p-3"
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[13px] font-medium text-zinc-500 tabular-nums">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) =>
                      updateAgenda(item.id, { title: e.target.value })
                    }
                    placeholder="议题标题"
                    maxLength={100}
                    className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                  />
                  {agenda.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeAgenda(item.id)}
                      className="shrink-0 px-2 text-[18px] text-zinc-500 active:text-rose-400"
                      aria-label="删除"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2 pl-5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="999"
                    value={item.time_budget_min}
                    onChange={(e) =>
                      updateAgenda(item.id, {
                        time_budget_min: e.target.value,
                      })
                    }
                    placeholder="时长"
                    className="h-9 w-16 rounded-lg border border-ink-800 bg-ink-950 px-2 text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/60 focus:outline-none"
                  />
                  <span className="text-[13px] text-zinc-500">分钟 (可选)</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* === 邀请真人 === */}
        <section>
          <Label>
            邀请真人{" "}
            {selectedUserIds.size > 0 ? (
              <span className="text-[13px] text-zinc-500">
                · 已选 {selectedUserIds.size}
              </span>
            ) : null}
          </Label>
          {membersErr ? (
            <p className="mt-2 text-[13px] text-zinc-500">{membersErr}</p>
          ) : members === null ? (
            <p className="mt-2 text-[14px] text-zinc-500">加载中…</p>
          ) : members.length === 0 ? (
            <p className="mt-2 text-[14px] text-zinc-500">没有可邀请的成员</p>
          ) : (
            <ChipGrid
              items={members.map((m) => ({
                id: m.user_id,
                label: m.name,
                sub: m.department || m.role,
              }))}
              selected={selectedUserIds}
              onToggle={toggleUser}
            />
          )}
        </section>

        {/* === 邀请 AI === */}
        <section>
          <Label>
            邀请 AI 专家{" "}
            {selectedAgentIds.size > 0 ? (
              <span className="text-[13px] text-zinc-500">
                · 已选 {selectedAgentIds.size}
              </span>
            ) : null}
          </Label>
          {agents === null ? (
            <p className="mt-2 text-[14px] text-zinc-500">加载中…</p>
          ) : agents.length === 0 ? (
            <p className="mt-2 text-[14px] text-zinc-500">工作区没有 AI 专家</p>
          ) : (
            <ChipGrid
              items={agents.map((a) => ({
                id: a.id,
                label: a.nickname || a.name,
                sub: a.domain || "",
                color: a.color,
              }))}
              selected={selectedAgentIds}
              onToggle={toggleAgent}
            />
          )}
        </section>

        {/* === 校验错误展示 === */}
        {!validation.ok && validation.errors.length > 0 ? (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
            <p className="text-[13px] font-medium text-amber-300">
              ⚠ 还需要:
            </p>
            <ul className="mt-1.5 space-y-1 text-[14px] text-amber-100">
              {validation.errors.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      {/* === Fixed 底部提交 ===
        P18.3: 改 sticky → fixed. sticky 在嵌套 flex / 多 scroll container
        里行为飘忽, 用户报按钮"会随页面拖拽异动". fixed 直接钉 viewport 底,
        永远不动. main 加 pb-28 给 fixed 按钮留位 (button h-12 + padding ~ 100px). */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <button
          type="button"
          onClick={handleSubmit}
          disabled={creating || !validation.ok}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-accent-500 px-4 text-[16px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? "创建中…" : "创建会议"}
        </button>
      </div>

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

// ===== atoms =============================================================

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[14px] font-medium text-zinc-300">{children}</h2>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  body,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${
        checked
          ? "border-accent-500/60 bg-accent-500/10"
          : "border-ink-800 bg-ink-900"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? "border-accent-400" : "border-zinc-600"
        }`}
      >
        {checked ? (
          <span className="h-2.5 w-2.5 rounded-full bg-accent-400" />
        ) : null}
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-zinc-50">{title}</p>
        <p className="mt-1 text-[13px] leading-snug text-zinc-400">{body}</p>
      </div>
    </button>
  );
}

const COLOR_BG: Record<string, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
};

function ChipGrid({
  items,
  selected,
  onToggle,
}: {
  items: Array<{ id: string; label: string; sub?: string; color?: string | null }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((it) => {
        const isSel = selected.has(it.id);
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onToggle(it.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-left transition active:scale-[0.97] ${
                isSel
                  ? "border-accent-500/60 bg-accent-500/15"
                  : "border-ink-800 bg-ink-900"
              }`}
            >
              {it.color !== undefined ? (
                <span
                  className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                    it.color ? COLOR_BG[it.color] || "bg-zinc-600" : "bg-zinc-600"
                  }`}
                />
              ) : null}
              <span className="min-w-0 max-w-[12em] truncate text-[14px] font-medium text-zinc-100">
                {it.label}
              </span>
              {it.sub ? (
                <span className="hidden text-[12px] text-zinc-500 sm:inline">
                  · {it.sub}
                </span>
              ) : null}
              {isSel ? (
                <span className="shrink-0 text-[14px] text-accent-300">✓</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
