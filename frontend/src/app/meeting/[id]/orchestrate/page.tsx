"use client";

/**
 * v26.3-05 召集人 Orchestrate 控制台
 *
 * 实时显示 全 AI 自主会议(mode='auto')的:
 *   - 当前 phase (idle / running / paused / done / failed / cancelled)
 *   - 议程进度 (current_agenda_idx / total_agenda_count + completed)
 *   - 各 AI 专家发言流(按 agenda_idx 分组,reply_to 显示线程)
 *   - 议程共识 + 分歧裁决横幅
 *   - 控制按钮:启动 / 暂停 / 恢复 / 取消
 *
 * 不上 WebSocket — v26.3-05 用 2s 轮询.v26.3-04 (后续) 升级 WS.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  api,
  type Agent,
  type AgentMessage,
  type Me,
  type Meeting,
  type MeetingConsensus,
} from "@/lib/api";
import { toast } from "@/lib/toast";

// v26.3.1: 谁能调 orchestrate 写端点 / 看到 裁决按钮.跟后端 require_leader_or_admin 对齐.
const WRITE_ROLES = new Set(["owner", "admin", "leader"]);

type Phase =
  | "idle"
  | "running"
  | "paused"
  | "consensus_wait"
  | "done"
  | "failed"
  | "cancelled";

type OrchestrateState = {
  phase: Phase;
  current_agenda_idx: number;
  current_speaker_agent_id: string | null;
  turn_count: number;
  dissent_count: number;
  started_at: string | null;
  paused_at: string | null;
  last_error: string | null;
  completed_agenda_count: number;
  total_agenda_count: number;
  // v26.3-08: 整场运行累计 (秒,paused 不算) + 硬上限
  running_elapsed_sec: number;
  max_meeting_sec: number;
};

/** v26.3-08: m:ss 格式化已用 / 上限.例 "12:34". */
function fmtMinSec(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** v26.3-08: 已用 vs 上限 → 颜色三档 (灰/amber/rose). */
function elapsedTone(elapsed: number, max: number): string {
  if (max <= 0) return "text-zinc-400";
  const ratio = elapsed / max;
  if (ratio >= 40 / 45) return "text-rose-300";       // 最后 5 分钟红
  if (ratio >= 30 / 45) return "text-amber-300";      // 30~40 分钟琥珀
  return "text-zinc-400";
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "未启动",
  running: "运行中",
  paused: "已暂停",
  consensus_wait: "等召集人裁决",
  done: "已结束",
  failed: "失败",
  cancelled: "已取消",
};

const PHASE_COLOR: Record<Phase, string> = {
  idle: "bg-zinc-700/40 text-zinc-300",
  running: "bg-emerald-500/15 text-emerald-300",
  paused: "bg-amber-500/15 text-amber-300",
  consensus_wait: "bg-violet-500/15 text-violet-300",
  done: "bg-emerald-600/20 text-emerald-200",
  failed: "bg-rose-500/15 text-rose-300",
  cancelled: "bg-zinc-700/40 text-zinc-500",
};

const AGENT_COLOR_BG: Record<string, string> = {
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-100",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-100",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-100",
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-100",
  fuchsia: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100",
  lime: "border-lime-500/40 bg-lime-500/10 text-lime-100",
};

const POLL_INTERVAL_MS = 2500;
const FINAL_PHASES: Phase[] = ["done", "failed", "cancelled"];


export default function OrchestratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: meetingId } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [state, setState] = useState<OrchestrateState | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [consenses, setConsenses] = useState<MeetingConsensus[]>([]);
  const [agentsById, setAgentsById] = useState<Record<string, Agent>>({});
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // v26.3-07e 分歧裁决 modal
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // v26.3.1: caller 是否有写权限 (启动 / 暂停 / 恢复 / 取消 / 裁决)
  const canWrite = !!me && WRITE_ROLES.has(me.role);

  // 初始加载 meeting + agents + me (一次)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, ags, meRes] = await Promise.all([
          api.getMeeting(meetingId),
          api.listAgents(),
          api.me(),
        ]);
        if (!alive) return;
        setMeeting(m);
        setMe(meRes);
        setAgentsById(Object.fromEntries(ags.map((a) => [a.id, a])));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "加载会议失败");
      }
    })();
    return () => {
      alive = false;
    };
  }, [meetingId]);

  // 轮询 state + messages + consensus
  const fetchAll = useCallback(async () => {
    try {
      const [st, msgs, cs] = await Promise.all([
        api.getOrchestrateState(meetingId),
        api.listAgentMessages(meetingId),
        api.listMeetingConsensus(meetingId),
      ]);
      setState(st);
      setMessages(msgs);
      setConsenses(cs);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "轮询失败");
    }
  }, [meetingId]);

  useEffect(() => {
    fetchAll();
    const h = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(h);
  }, [fetchAll]);

  // 跑到终态后,自动停轮询 (interval 还在跑但快)
  useEffect(() => {
    if (state && FINAL_PHASES.includes(state.phase)) {
      // 跑完仍然让 console 显示;不主动跳转
    }
  }, [state]);

  // 新消息自动滚到底
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const onStart = async () => {
    setBusy(true);
    try {
      await api.orchestrateStart(meetingId);
      toast.success("✅ 已启动 AI 自主会议");
      await fetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动失败");
    } finally {
      setBusy(false);
    }
  };

  const onPause = async () => {
    setBusy(true);
    try {
      await api.orchestratePause(meetingId);
      toast.success("⏸️ 已暂停");
      await fetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "暂停失败");
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    setBusy(true);
    try {
      await api.orchestrateResume(meetingId);
      toast.success("▶️ 已恢复");
      await fetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!confirm("确定取消本场 AI 自主会议?(已产生的发言 / 共识 保留)")) return;
    setBusy(true);
    try {
      await api.orchestrateCancel(meetingId);
      toast.success("❌ 已取消");
      await fetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消失败");
    } finally {
      setBusy(false);
    }
  };

  const agenda = meeting?.agenda || [];
  const currentAgendaTitle =
    state && agenda[state.current_agenda_idx]
      ? agenda[state.current_agenda_idx].title
      : null;
  const currentSpeaker = state?.current_speaker_agent_id
    ? agentsById[state.current_speaker_agent_id]
    : null;

  // 把 messages 按 agenda_idx 分组
  const messagesByAgenda = useMemo(() => {
    const out: Record<number, AgentMessage[]> = {};
    for (const m of messages) {
      const idx = m.agenda_idx ?? -1;
      (out[idx] = out[idx] || []).push(m);
    }
    return out;
  }, [messages]);

  const consensusByAgenda = useMemo(() => {
    const out: Record<number, MeetingConsensus> = {};
    for (const c of consenses) out[c.agenda_idx] = c;
    return out;
  }, [consenses]);

  const totalDissents = useMemo(
    () => consenses.reduce((s, c) => s + (c.dissents?.length || 0), 0),
    [consenses],
  );

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      {/* 顶部 — 标题 + 模式 标记 + 返回 */}
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link
            href={`/meeting/${meetingId}`}
            className="text-xs text-zinc-500 hover:text-accent-400"
          >
            ← 会议详情
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            🤖 {meeting?.title || "AI 自主会议"}
          </h1>
          {meeting?.mode !== "auto" && meeting && (
            <p className="mt-1 text-xs text-rose-400">
              ⚠️ 本会议 mode={meeting.mode},不是 auto.Orchestrate 控制台 仅 auto
              会议可用.
            </p>
          )}
        </div>
        {state && (
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                PHASE_COLOR[state.phase]
              }`}
            >
              {PHASE_LABEL[state.phase]}
            </span>
            <span className="text-xs text-zinc-500">
              {state.completed_agenda_count} / {state.total_agenda_count} 议程完成
            </span>
            {/* v26.3-08: 已用 / 上限,颜色三档.idle 时不显示 (还没启动). */}
            {state.phase !== "idle" && state.max_meeting_sec > 0 && (
              <span
                className={`text-xs tabular-nums ${elapsedTone(
                  state.running_elapsed_sec,
                  state.max_meeting_sec,
                )}`}
                title="整场 running 累计 (paused 时间不算).到 45 分钟会触发硬上限提前 finalize."
              >
                ⏱ {fmtMinSec(state.running_elapsed_sec)} /{" "}
                {fmtMinSec(state.max_meeting_sec)}
              </span>
            )}
          </div>
        )}
      </header>

      {/* 控制条.v26.3.1: 写按钮仅 owner/admin/leader 可见;expert/member read-only. */}
      <section className="mb-6 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && state?.phase === "idle" && (
            <button
              onClick={onStart}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-400 disabled:opacity-50"
              data-testid="ctrl-start"
            >
              🚀 启动 AI 自主讨论
            </button>
          )}
          {canWrite && state?.phase === "running" && (
            <button
              onClick={onPause}
              disabled={busy}
              className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
              data-testid="ctrl-pause"
            >
              ⏸️ 暂停
            </button>
          )}
          {canWrite && state?.phase === "paused" && (
            <button
              onClick={onResume}
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
              data-testid="ctrl-resume"
            >
              ▶️ 恢复
            </button>
          )}
          {canWrite && state && !FINAL_PHASES.includes(state.phase) && (
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
              data-testid="ctrl-cancel"
            >
              ❌ 取消
            </button>
          )}
          {/* read-only 角色 提示 */}
          {!canWrite && me && (
            <span
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-zinc-500"
              data-testid="readonly-hint"
            >
              👁️ 只读视图 · {me.role} 角色无控制权限
            </span>
          )}
          {state && FINAL_PHASES.includes(state.phase) && (
            <Link
              href={`/meeting/${meetingId}`}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-400"
            >
              📋 查看会议详情 / 行动项
            </Link>
          )}
          <div className="ml-auto text-xs text-zinc-500">
            {state?.started_at && (
              <span>
                开始于 {new Date(state.started_at).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
        </div>

        {state?.phase === "running" && currentAgendaTitle && (
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
            <span>🟢 当前议程:</span>
            <span className="text-zinc-200">
              {state.current_agenda_idx + 1}. {currentAgendaTitle}
            </span>
            {currentSpeaker && (
              <>
                <span className="text-zinc-700">·</span>
                <span>🎙️ {currentSpeaker.name} 发言中…</span>
              </>
            )}
            <span className="text-zinc-700">·</span>
            <span>已 {state.turn_count} 轮</span>
          </div>
        )}

        {/* v26.3-08: 超时是 软完成,用 amber 提示而非 rose 报错 */}
        {state?.last_error === "meeting_timeout" && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            ⏱ 本会议因 45 分钟整场硬上限提前 finalize.已完成议程
            {" "}{state.completed_agenda_count}/{state.total_agenda_count},未跑议程可在下次会议带回.
            <br />已完成议程的共识 + 摘要 + 行动项 均正常保留.
          </div>
        )}
        {state?.last_error && state.last_error !== "meeting_timeout" && (
          <div className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            ⚠️ 最近错误:{state.last_error}
          </div>
        )}
      </section>

      {/* 分歧裁决 横幅 (per v26.3 Q3 — 会后批量) */}
      {totalDissents > 0 && state && FINAL_PHASES.includes(state.phase) && (
        <section
          className="mb-6 rounded-xl border-l-4 border-violet-400 bg-violet-500/10 px-4 py-3"
          data-testid="dissent-banner"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-violet-200">
                ⚠️ 本场会议 有 {totalDissents} 处分歧 待你裁决
              </h3>
              <p className="mt-1 text-[11px] text-zinc-400">
                会议跑完后,系统按 v26.3 Q3 决策 D 批量收集分歧 — 由你审阅后写入会议纪要.
                裁决会沉淀回涉及 AI 专家的知识库,影响 它们后续类似议题的判断.
              </p>
              {/* 已裁决进度 */}
              {(() => {
                const pending = consenses.filter(
                  (c) =>
                    (c.dissents?.length || 0) > 0 &&
                    c.needs_human_review &&
                    !c.reviewed_at,
                );
                const reviewed = consenses.filter(
                  (c) => (c.dissents?.length || 0) > 0 && c.reviewed_at,
                );
                return (
                  <p className="mt-1 text-[11px] text-violet-300">
                    待裁决议程 {pending.length} 项 · 已裁决 {reviewed.length} 项
                  </p>
                );
              })()}
            </div>
            {canWrite ? (
              <button
                onClick={() => setReviewModalOpen(true)}
                className="shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-violet-950 hover:bg-violet-400"
                data-testid="open-review-modal"
              >
                ⚖️ 打开裁决面板
              </button>
            ) : (
              <span
                className="shrink-0 rounded-md border border-violet-500/30 px-2.5 py-1 text-[11px] text-violet-300"
                data-testid="readonly-review-hint"
                title="仅 owner/admin/leader 角色可裁决.expert/member 为只读视图."
              >
                🔒 仅领导可裁决
              </span>
            )}
          </div>
        </section>
      )}

      {/* 议程列表 (实时按 agenda_idx 显示发言 + 共识 + 分歧) */}
      <section className="space-y-6">
        {agenda.length === 0 ? (
          <p className="text-sm text-zinc-500">本会议没有议程项 — 无法启动 auto 会议</p>
        ) : (
          agenda.map((item, idx) => {
            const msgs = messagesByAgenda[idx] || [];
            const c = consensusByAgenda[idx];
            const isCurrent =
              state?.phase === "running" && state.current_agenda_idx === idx;
            const isCompleted = c !== undefined;

            return (
              <div
                key={idx}
                data-testid={`agenda-${idx}`}
                className={`rounded-xl border ${
                  isCurrent
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : isCompleted
                    ? "border-ink-700 bg-ink-900"
                    : "border-ink-800 bg-ink-950/50 opacity-70"
                } p-4`}
              >
                <header className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white">
                    {isCurrent
                      ? "🟢"
                      : isCompleted
                      ? "✓"
                      : "⏳"}{" "}
                    议程 {idx + 1}:{item.title}
                  </h3>
                  {c && (
                    <span className="text-[10px] text-zinc-500">
                      {c.turn_count} 轮 · {c.elapsed_sec?.toFixed(0)}s ·
                      {c.dissents.length > 0 ? (
                        <span className="text-violet-300"> {c.dissents.length} 处分歧</span>
                      ) : (
                        <span className="text-emerald-300"> 共识达成</span>
                      )}
                    </span>
                  )}
                </header>

                {/* 发言列表 */}
                {msgs.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {msgs.map((m) => {
                      const ag = agentsById[m.agent_id];
                      const isMod = ag?.role === "moderator";
                      const tone =
                        AGENT_COLOR_BG[ag?.color || "violet"] ||
                        AGENT_COLOR_BG.violet;
                      return (
                        <li
                          key={m.id}
                          className={`rounded-md border-l-2 px-3 py-2 text-xs ${
                            isMod
                              ? "border-zinc-500 bg-ink-950"
                              : tone
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between text-[10px] opacity-80">
                            <span>
                              {isMod ? "🎙️" : "🤖"} {ag?.name || "?"}
                              {m.reply_to_agent_message_id && (
                                <span className="ml-2 text-zinc-500">
                                  → #{m.reply_to_agent_message_id}
                                </span>
                              )}
                            </span>
                            <span className="text-zinc-600">
                              {new Date(m.created_at).toLocaleTimeString(
                                "zh-CN",
                              )}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {m.text}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* 共识 + 分歧 */}
                {c && c.consensus_md && (
                  <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                      📋 共识
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-200">
                      {c.consensus_md}
                    </div>
                  </div>
                )}
                {c && c.dissents.length > 0 && (
                  <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-violet-300">
                      ⚠️ {c.dissents.length} 处分歧(待召集人裁决)
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {c.dissents.map((d, i) => (
                        <li key={i} className="text-xs">
                          <div className="font-medium text-violet-200">
                            • {d.point}
                          </div>
                          <div className="text-zinc-400">{d.summary}</div>
                          {d.involved_agents?.length > 0 && (
                            <div className="mt-0.5 text-[10px] text-zinc-500">
                              涉及:{d.involved_agents.join(" / ")}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </section>

      {err && (
        <p className="mt-6 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {err}
        </p>
      )}

      {/* v26.3-07e 分歧裁决 modal */}
      {reviewModalOpen && (
        <DissentReviewModal
          meetingId={meetingId}
          consenses={consenses}
          agendaItems={agenda}
          agentsById={agentsById}
          onClose={() => setReviewModalOpen(false)}
          onReviewed={() => fetchAll()}
        />
      )}
    </main>
  );
}


// ============================================================================
// v26.3-07e 分歧裁决 Modal
// ============================================================================

const REVIEW_ACTION_LABEL: Record<string, string> = {
  pick_a: "采纳 A 方",
  pick_b: "采纳 B 方",
  compromise: "折衷裁决",
  defer: "搁置 / 待后续",
};

const REVIEW_RATIONALE_MIN = 10;

function DissentReviewModal({
  meetingId,
  consenses,
  agendaItems,
  agentsById,
  onClose,
  onReviewed,
}: {
  meetingId: string;
  consenses: MeetingConsensus[];
  agendaItems: { title?: string }[];
  agentsById: Record<string, Agent>;
  onClose: () => void;
  onReviewed: () => void;
}) {
  // 把 待裁决 (needs_human_review && !reviewed_at) 和 已裁决 分开
  const pending = useMemo(
    () =>
      consenses.filter(
        (c) => (c.dissents?.length || 0) > 0 && c.needs_human_review && !c.reviewed_at,
      ),
    [consenses],
  );
  const reviewed = useMemo(
    () => consenses.filter((c) => (c.dissents?.length || 0) > 0 && c.reviewed_at),
    [consenses],
  );

  // 表单状态:key = `${agendaIdx}-${dissentIdx}` → {action, rationale}
  const [form, setForm] = useState<Record<string, { action?: string; rationale: string }>>({});
  const [submitting, setSubmitting] = useState<number | null>(null); // 正在提交哪个 agendaIdx
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const setField = (agendaIdx: number, dissentIdx: number, patch: Partial<{ action: string; rationale: string }>) => {
    const key = `${agendaIdx}-${dissentIdx}`;
    setForm((prev) => {
      const cur = prev[key] || { rationale: "" };
      return { ...prev, [key]: { ...cur, ...patch } };
    });
  };

  const submit = async (c: MeetingConsensus) => {
    setSubmitErr(null);
    const dissents = c.dissents || [];
    const reviews: { dissent_idx: number; action: "pick_a" | "pick_b" | "compromise" | "defer"; rationale: string }[] = [];
    for (let i = 0; i < dissents.length; i++) {
      const key = `${c.agenda_idx}-${i}`;
      const f = form[key];
      if (!f?.action) {
        setSubmitErr(`议程 ${c.agenda_idx + 1} 第 ${i + 1} 处分歧 还没选 action`);
        return;
      }
      if (!["pick_a", "pick_b", "compromise", "defer"].includes(f.action)) {
        setSubmitErr(`议程 ${c.agenda_idx + 1} 第 ${i + 1} 处 action 非法`);
        return;
      }
      const r = (f.rationale || "").trim();
      if (r.length < REVIEW_RATIONALE_MIN) {
        setSubmitErr(`议程 ${c.agenda_idx + 1} 第 ${i + 1} 处 rationale 太短 (≥${REVIEW_RATIONALE_MIN} 字)`);
        return;
      }
      reviews.push({ dissent_idx: i, action: f.action as "pick_a" | "pick_b" | "compromise" | "defer", rationale: r });
    }
    try {
      setSubmitting(c.agenda_idx);
      await api.reviewMeetingConsensus(meetingId, c.agenda_idx, { reviews });
      toast.success(`议程 ${c.agenda_idx + 1} 裁决完成,正在沉淀到 AI 知识库…`);
      onReviewed();
      // 该议程的表单字段清掉(已落库)
      setForm((prev) => {
        const next = { ...prev };
        for (let i = 0; i < dissents.length; i++) delete next[`${c.agenda_idx}-${i}`];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "裁决失败";
      setSubmitErr(msg);
      toast.error(msg);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      data-testid="dissent-modal"
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-ink-700 bg-ink-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-800 pb-3">
          <h2 className="text-lg font-semibold text-white">
            ⚖️ 召集人 · 分歧批量裁决
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-ink-800 hover:text-white"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <p className="mt-3 text-xs text-zinc-400">
          每个议程项的所有分歧 必须 一起裁决.4 选 1 + 理由 ≥ {REVIEW_RATIONALE_MIN} 字.
          裁决后系统会自动把决议沉淀到涉及 AI 专家的知识库,影响其后续判断.
        </p>

        {submitErr && (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            ⚠️ {submitErr}
          </div>
        )}

        {/* 待裁决 */}
        {pending.length === 0 && (
          <p className="mt-6 text-center text-sm text-zinc-500">
            ✓ 所有分歧 都已 裁决
          </p>
        )}
        {pending.map((c) => {
          const agTitle = c.agenda_title || agendaItems[c.agenda_idx]?.title || `议程 ${c.agenda_idx + 1}`;
          const dissents = c.dissents || [];
          return (
            <section
              key={c.id}
              className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4"
              data-testid={`dissent-card-${c.agenda_idx}`}
            >
              <h3 className="text-sm font-medium text-violet-100">
                议程 {c.agenda_idx + 1}:{agTitle} · {dissents.length} 处分歧
              </h3>
              <ul className="mt-3 space-y-3">
                {dissents.map((d, di) => {
                  const key = `${c.agenda_idx}-${di}`;
                  const f = form[key];
                  const involved = (d.involved_agents || []) as string[];
                  return (
                    <li
                      key={di}
                      className="rounded-md border border-ink-700 bg-ink-900 p-3 text-xs"
                    >
                      <div className="mb-2">
                        <span className="font-semibold text-violet-200">分歧 {di + 1}:</span>{" "}
                        <span className="text-white">{d.point || "(无标题)"}</span>
                      </div>
                      <p className="mb-2 text-zinc-400">
                        <span className="text-zinc-500">立场摘要:</span>
                        {d.summary || "(摘要缺失)"}
                      </p>
                      {involved.length > 0 && (
                        <p className="mb-3 text-zinc-500">
                          涉及专家:{involved.join(" / ")}
                        </p>
                      )}
                      <div className="mb-2 flex flex-wrap gap-2">
                        {(["pick_a", "pick_b", "compromise", "defer"] as const).map((act) => (
                          <label
                            key={act}
                            className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${
                              f?.action === act
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                                : "border-ink-700 text-zinc-400 hover:border-zinc-500"
                            }`}
                          >
                            <input
                              type="radio"
                              name={key}
                              value={act}
                              checked={f?.action === act}
                              onChange={() => setField(c.agenda_idx, di, { action: act })}
                              className="sr-only"
                            />
                            {REVIEW_ACTION_LABEL[act]}
                          </label>
                        ))}
                      </div>
                      <textarea
                        value={f?.rationale || ""}
                        onChange={(e) => setField(c.agenda_idx, di, { rationale: e.target.value })}
                        placeholder={`说明裁决理由 (≥${REVIEW_RATIONALE_MIN} 字)`}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-[11px] text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                      />
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {(f?.rationale || "").trim().length}/{REVIEW_RATIONALE_MIN}+ 字
                      </p>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => submit(c)}
                  disabled={submitting === c.agenda_idx}
                  className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
                  data-testid={`submit-${c.agenda_idx}`}
                >
                  {submitting === c.agenda_idx ? "裁决中…" : "✓ 裁决并归档"}
                </button>
              </div>
            </section>
          );
        })}

        {/* 已裁决 (折叠展示) */}
        {reviewed.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-xs font-medium text-zinc-400">
              ✓ 已裁决 ({reviewed.length})
            </h3>
            <ul className="space-y-1.5">
              {reviewed.map((c) => {
                let parsed: { dissent_idx: number; action: string; rationale: string }[] | null = null;
                try {
                  parsed = c.review_decision ? JSON.parse(c.review_decision) : null;
                } catch {
                  parsed = null;
                }
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-300">
                        议程 {c.agenda_idx + 1}:{c.agenda_title || "?"}
                      </span>
                      <span className="text-zinc-600">
                        {c.reviewed_at ? new Date(c.reviewed_at).toLocaleString("zh-CN") : ""}
                      </span>
                    </div>
                    {parsed && parsed.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-zinc-500">
                        {parsed.map((r, i) => (
                          <li key={i}>
                            分歧 {r.dissent_idx + 1}:
                            <span className="text-emerald-300">{REVIEW_ACTION_LABEL[r.action] || r.action}</span>
                            <span className="text-zinc-600"> · {r.rationale.slice(0, 50)}{r.rationale.length > 50 ? "…" : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="mt-6 flex justify-end border-t border-ink-800 pt-3">
          <button
            onClick={onClose}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-ink-800"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
