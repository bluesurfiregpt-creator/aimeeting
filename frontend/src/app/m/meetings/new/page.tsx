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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MaterialsInline } from "@/components/mobile/meeting-room/materials";
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
  // v27.0-mobile P19: 议程方向提示 — 给 AI moderator / experts 看 (用户不写也能开会).
  note: string;
  // P19-A.1: 是否展开 note 输入框 (默认折叠避免页面爆炸).
  noteOpen: boolean;
};

type Mode = "hybrid" | "auto";

export default function NewMeetingPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  // v27.0-mobile P19: 会议 brief — auto 模式 强烈建议 填; 也是 AI 拆议程 的 输入.
  const [description, setDescription] = useState("");
  // v27.0-mobile P19-B: 创建前 上传 attachments 用的 stable uuid.
  // useRef + lazy init — 整个页面 session 共用 一个 id, 切换 mode / 改 brief
  // 都不会让它变. 创建会议成功后 后端 会把 这个 draft 下 attachments 关联到新会议.
  const draftIdRef = useRef<string>("");
  if (draftIdRef.current === "") {
    draftIdRef.current = crypto.randomUUID();
  }
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [agenda, setAgenda] = useState<AgendaItem[]>([
    { id: crypto.randomUUID(), title: "", time_budget_min: "", note: "", noteOpen: false },
  ]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgentBrief[] | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // v27.0-mobile P19-A.2: AI 拆议程 状态
  const [decomposing, setDecomposing] = useState(false);
  // 拆议程时 现有 agenda 有内容 — 弹 confirm 让用户决定是否覆盖
  const [decomposeConfirmOpen, setDecomposeConfirmOpen] = useState(false);
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
      {
        id: crypto.randomUUID(),
        title: "",
        time_budget_min: "",
        note: "",
        noteOpen: false,
      },
    ]);
  const removeAgenda = (id: string) =>
    setAgenda((a) => (a.length > 1 ? a.filter((x) => x.id !== id) : a));
  const updateAgenda = (id: string, patch: Partial<AgendaItem>) =>
    setAgenda((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // v27.0-mobile P19-A.2: 让 AI 帮我拆议程.
  // 当前 agenda 有非空标题 → 弹 confirm; 都是空 → 直接覆盖.
  const hasAgendaContent = useMemo(
    () => agenda.some((it) => it.title.trim().length > 0),
    [agenda],
  );

  const doDecompose = useCallback(async () => {
    const brief = description.trim();
    if (brief.length < 10) {
      setToast({ kind: "error", text: "请先把 brief 写够 10 字" });
      return;
    }
    if (decomposing) return;
    setDecomposing(true);
    setDecomposeConfirmOpen(false);
    try {
      const out = await mApi.decomposeAgenda({
        brief,
        title: title.trim() || undefined,
        target_count: 3,
        // v27.0-mobile P19-B: 让 LLM 拆议程 同时 读 已上传附件 内容
        client_draft_id: attachmentCount > 0 ? draftIdRef.current : undefined,
      });
      // 替换现有 agenda — 用 LLM 给的 items
      const nextAgenda: AgendaItem[] = out.items.map((it) => ({
        id: crypto.randomUUID(),
        title: it.title,
        time_budget_min: it.time_budget_min ? String(it.time_budget_min) : "",
        note: it.note || "",
        // 拆出来的 议程 默认 把 note 展开 — 用户能看见 AI 写了啥
        noteOpen: Boolean(it.note),
      }));
      setAgenda(nextAgenda.length > 0 ? nextAgenda : agenda);
      setToast({
        kind: "success",
        text: `AI 已拆出 ${nextAgenda.length} 个议程项,你可继续编辑`,
      });
    } catch (e) {
      setToast({
        kind: "error",
        text: `AI 拆议程失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setDecomposing(false);
    }
  }, [description, decomposing, title, agenda, attachmentCount]);

  const onDecomposeClick = () => {
    if (hasAgendaContent) {
      setDecomposeConfirmOpen(true);
    } else {
      void doDecompose();
    }
  };

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
      // v27.0-mobile P19: auto 模式 brief 强烈建议填 (LLM moderator 否则只看 title 抽象)
      if (description.trim().length < 10) {
        errors.push("全 AI 自主模式建议先写一段诉求 (≥10 字) — AI 才知道讨论什么");
      }
    } else {
      if (selectedUserIds.size + selectedAgentIds.size === 0) {
        errors.push("至少邀请 1 个真人或 AI 专家");
      }
    }
    return { errors, ok: errors.length === 0 };
  }, [title, agenda, mode, selectedAgentIds, selectedUserIds, description]);

  // === 提交 ===
  const handleSubmit = useCallback(async () => {
    if (creating || !validation.ok) return;
    setCreating(true);
    try {
      const cleanedAgenda = agenda
        .filter((it) => it.title.trim().length > 0)
        .map((it) => {
          const budget = parseInt(it.time_budget_min, 10);
          const note = it.note.trim();
          return {
            title: it.title.trim(),
            time_budget_min:
              Number.isFinite(budget) && budget > 0 ? budget : null,
            // v27.0-mobile P19: 议程方向提示 — 空就不发,后端 schema 接受 None
            note: note.length > 0 ? note : null,
          };
        });

      const out = await mApi.createMeeting({
        title: title.trim(),
        attendee_user_ids: Array.from(selectedUserIds),
        attendee_agent_ids: Array.from(selectedAgentIds),
        agenda: cleanedAgenda,
        mode,
        // v27.0-mobile P19: 会议 brief — 空就不发
        description: description.trim() || null,
        // v27.0-mobile P19-B: 把 已上传附件 一起 hop 到 新会议. 后端 update 这个
        // draft 下所有 attachment SET meeting_id=<新>. 没附件 也安全 (rowcount=0).
        client_draft_id: attachmentCount > 0 ? draftIdRef.current : null,
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
    description,
    attachmentCount,
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

        {/* === v27.0-mobile P19: 会议 brief / 诉求 ===
            auto 模式 必填,hybrid / human 选填 (但填了 AI 召出来时也能用).
            UI:
              - auto 模式: 整块 高亮 (border-accent),提示"必填,否则 AI 抓瞎"
              - 其他模式: 灰色 中性 提示
              - 字数 counter (10-2000 字 — 后端 schema 同步)
        */}
        <section>
          <div className="flex items-baseline justify-between">
            <Label>
              会议 brief / 诉求{" "}
              {mode === "auto" ? (
                <span className="text-[12px] font-medium text-accent-400">
                  · 全 AI 模式 必填
                </span>
              ) : (
                <span className="text-[12px] text-zinc-500">· 选填</span>
              )}
            </Label>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {description.length}/2000
            </span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            placeholder={
              mode === "auto"
                ? "写清楚:背景 / 想解决什么问题 / 期望产出 / 已知约束.\n例:Q1 物业投诉同比 +35%,主要集中 在 安保 / 卫生.\n想 拆原因 + 拟 整改 方案,Q2 落地,预算 ≤ 50w."
                : "可选 — 写一段背景给 AI 看. 不写也能开,只是 AI 召出来时 没 context."
            }
            rows={5}
            className={`mt-2 w-full resize-y rounded-xl border bg-ink-900 p-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
              mode === "auto"
                ? "border-accent-500/40 focus:border-accent-500/70"
                : "border-ink-800 focus:border-accent-500/60"
            }`}
          />
          {/* AI 拆议程 入口 — 只在 brief 够长时显 */}
          {description.trim().length >= 10 ? (
            <button
              type="button"
              onClick={onDecomposeClick}
              disabled={decomposing}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1.5 text-[13px] font-medium text-violet-300 active:scale-[0.97] active:bg-violet-500/25 disabled:opacity-50"
              data-testid="ai-decompose-agenda-btn"
            >
              {decomposing ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-violet-300/40 border-t-violet-300" />
                  AI 拆议程中…
                </>
              ) : (
                <>
                  ✨ 让 AI 拆议程
                  {attachmentCount > 0
                    ? ` (用上 ${attachmentCount} 份资料)`
                    : ""}
                </>
              )}
            </button>
          ) : null}
        </section>

        {/* === v1.2.0 Saga: 参考资料 — 用 round-3 风格 inline (MaterialsInline)
             替代 旧 AttachmentsSection. 三页面 视觉 统一 在 round-3. === */}
        <section>
          <MaterialsInline
            draftId={draftIdRef.current}
            mode="edit"
            onAttachmentsChange={setAttachmentCount}
          />
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
                <DurationPicker
                  value={item.time_budget_min}
                  onChange={(v) =>
                    updateAgenda(item.id, { time_budget_min: v })
                  }
                />

                {/* v27.0-mobile P19: 议程方向提示 (note) — 折叠默认隐藏.
                    点 "+ 方向提示" 展开 textarea. */}
                <div className="mt-2 pl-5">
                  {item.noteOpen ? (
                    <div className="space-y-1">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12px] font-medium text-zinc-400">
                          方向提示 (给 AI 看)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateAgenda(item.id, {
                              noteOpen: false,
                              note: "",
                            })
                          }
                          className="text-[11px] text-zinc-500 active:text-zinc-300"
                        >
                          收起
                        </button>
                      </div>
                      <textarea
                        value={item.note}
                        onChange={(e) =>
                          updateAgenda(item.id, {
                            note: e.target.value.slice(0, 200),
                          })
                        }
                        placeholder="例: 重点考虑 Q3 时间窗 + 预算 ≤ 30w"
                        rows={2}
                        className="w-full resize-y rounded-lg border border-ink-800 bg-ink-950 p-2 text-[13px] leading-snug text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/60 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateAgenda(item.id, { noteOpen: true })}
                      className="text-[12px] text-zinc-500 active:text-accent-400"
                    >
                      + 方向提示 (可选)
                    </button>
                  )}
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

      {/* v27.0-mobile P19-A.2: AI 拆议程 — 现有议程有内容 时的 confirm 覆盖.
          fixed inset-0 z-50,bg-black/60 backdrop blur. */}
      {decomposeConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setDecomposeConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-ink-900 p-5"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
          >
            <p className="text-[16px] font-semibold text-zinc-50">
              覆盖现有议程?
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">
              你已填了一些议程项. 让 AI 拆议程会替换它们 — 已有内容会丢失.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDecomposeConfirmOpen(false)}
                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-ink-800 text-[15px] font-medium text-zinc-200 active:scale-[0.98]"
              >
                再想想
              </button>
              <button
                type="button"
                onClick={() => void doDecompose()}
                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-violet-500 text-[15px] font-medium text-white active:scale-[0.98]"
              >
                覆盖
              </button>
            </div>
          </div>
        </div>
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

// ===== Duration Picker =====================================================
// 移动端时长选择: range slider 拖拽大致, chip 快选精准. 不用 native input
// number 因为 mobile 上不友好 (要么没控件, 要么小箭头点不到).
//
// value 是 string (跟外层 form 一致, 空 string = 不设).
// step=5 让拖拽自然落在 5 倍数 (议题时长一般 5/10/15/30/60 这种).

const DURATION_PRESETS = [5, 15, 30, 60];
const DURATION_MAX = 120;

function DurationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const numVal = parseInt(value, 10);
  const v = Number.isFinite(numVal) && numVal > 0 ? numVal : 0;

  return (
    <div className="mt-3 pl-5">
      {/* 当前值显示 */}
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-zinc-300">
          时长:
        </span>
        {v > 0 ? (
          <span className="text-[15px] font-semibold text-accent-300 tabular-nums">
            {v} 分钟
          </span>
        ) : (
          <span className="text-[13px] text-zinc-500">不设 (可选)</span>
        )}
        {v > 0 ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="ml-auto shrink-0 text-[12px] text-zinc-500 active:text-zinc-300"
          >
            清除
          </button>
        ) : null}
      </div>

      {/* range slider */}
      <input
        type="range"
        min={0}
        max={DURATION_MAX}
        step={5}
        value={v}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(n > 0 ? String(n) : "");
        }}
        className="mt-2 w-full accent-accent-500"
        aria-label="议题时长 分钟"
      />
      {/* 刻度提示 */}
      <div className="mt-0.5 flex justify-between text-[10px] text-zinc-600 tabular-nums">
        <span>0</span>
        <span>30</span>
        <span>60</span>
        <span>90</span>
        <span>{DURATION_MAX}</span>
      </div>

      {/* 快选 chip — 一点到位 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((p) => {
          const active = v === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(String(p))}
              className={`inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium transition active:scale-[0.95] ${
                active
                  ? "bg-accent-500 text-white"
                  : "bg-ink-800 text-zinc-300 active:bg-ink-700"
              }`}
            >
              {p}m
            </button>
          );
        })}
      </div>
    </div>
  );
}
