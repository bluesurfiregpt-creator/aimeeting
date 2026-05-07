"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MicPermissionError,
  probeAudioCapabilities,
  startAudioCapture,
  type AudioCaptureHandle,
} from "@/lib/audioCapture";
import { toast } from "@/lib/toast";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";
import { api, type Agent, type TranscriptLine } from "@/lib/api";
import BriefingCard from "./BriefingCard";
import SummaryCard from "./SummaryCard";

type LiveLine =
  | {
      kind: "user";
      id: string;
      text: string;
      final: boolean;
      startMs: number | null;
      endMs: number | null;
      // Filled in by speaker identification, asynchronously, possibly
      // multiple times during the meeting as more audio is processed.
      speakerName: string | null;
      speakerUserId: string | null;
      // Stable id from the server's meeting_transcript row — only known
      // after we've fetched /result at least once. Needed to call the
      // correct-speaker endpoint.
      serverLineId: number | null;
    }
  | {
      kind: "agent";
      id: string;
      agentId: string;
      agentName: string;
      agentColor: string;
      text: string;
      done: boolean;
    };

type Phase = "idle" | "live" | "ended";

function backendWsUrl(meetingId: string): string {
  if (typeof window === "undefined") return "";
  const isLocalDev = window.location.hostname === "localhost";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isLocalDev ? "localhost:8000" : window.location.host;
  return `${proto}//${host}/ws/stt?meeting_id=${encodeURIComponent(meetingId)}`;
}

const PALETTE = [
  "text-sky-300",
  "text-emerald-300",
  "text-violet-300",
  "text-rose-300",
  "text-amber-300",
  "text-teal-300",
];
function colorOf(uid: string | null): string {
  if (!uid) return "text-zinc-500";
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Always-visible, click-to-edit speaker label. After the meeting ends, it's
 * a button with a small ✏️ inline so the user knows they can change the
 * attribution — applies to both named lines AND 未识别 lines.
 */
function SpeakerLabel({
  line,
  canEdit,
  isOpen,
  onToggle,
  attendees,
  onPick,
}: {
  line: Extract<LiveLine, { kind: "user" }>;
  canEdit: boolean;
  isOpen: boolean;
  onToggle: () => void;
  attendees: Array<{ id: string; name: string }>;
  onPick: (userId: string | null, name: string | null) => void;
}) {
  const labelText = line.speakerName ?? "未识别";
  const colorClass = colorOf(line.speakerUserId);

  if (!canEdit) {
    if (line.speakerName) {
      return <span className={`mr-3 font-medium ${colorClass}`}>{line.speakerName}</span>;
    }
    if (line.final) {
      return <span className="mr-3 text-xs text-zinc-600">未识别</span>;
    }
    return null;
  }

  return (
    <span className="relative mr-3 inline-block">
      <button
        type="button"
        onClick={onToggle}
        title="点击纠正说话人"
        className={`inline-flex items-center gap-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium transition hover:border-ink-700 hover:bg-ink-800/60 ${
          line.speakerName ? colorClass : "text-zinc-500"
        }`}
      >
        <span>{labelText}</span>
        <span className="text-[10px] opacity-60">✏️</span>
      </button>
      {isOpen && (
        <span className="absolute left-0 top-full z-20 mt-1 inline-flex min-w-[140px] flex-col rounded-lg border border-ink-700 bg-ink-950 p-1 shadow-lg">
          {attendees.length === 0 ? (
            <span className="px-2 py-1 text-xs text-zinc-600">无可选参会人</span>
          ) : (
            attendees.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onPick(a.id, a.name)}
                className="rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-ink-800"
              >
                {a.name}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => onPick(null, null)}
            className="rounded border-t border-ink-800 px-2 py-1 text-left text-xs text-zinc-500 hover:bg-ink-800"
          >
            标记为未识别
          </button>
        </span>
      )}
    </span>
  );
}

function tailwindColor(name: string): string {
  return ({
    violet: "#8b5cf6",
    sky: "#38bdf8",
    emerald: "#34d399",
    amber: "#fbbf24",
    rose: "#fb7185",
    teal: "#2dd4bf",
  } as Record<string, string>)[name] ?? "#8b5cf6";
}

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = use(params);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("待开始");
  const [audioCaps] = useState(() => probeAudioCapabilities());
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  // Agents currently producing a streamed reply (between agent_message_start
  // and agent_message_end). Used to disable / dim their avatar.
  const [busyAgents, setBusyAgents] = useState<Set<string>>(new Set());
  // Sprint J: recommendation from the orchestrator after each agent
  // utterance. null when nothing's recommended right now.
  const [recommendation, setRecommendation] = useState<{
    agent_id: string;
    agent_name: string;
    agent_color: string;
    reason: string;
  } | null>(null);
  const recommendTimerRef = useRef<number | null>(null);
  // Pool of attendees we let users pick from when manually correcting a
  // line's speaker after the meeting. Loaded after stop() because it's
  // only relevant once identification is done.
  const [attendees, setAttendees] = useState<Array<{ id: string; name: string }>>([]);
  const [correctingLineId, setCorrectingLineId] = useState<number | null>(null);

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const socketRef = useRef<SttSocket | null>(null);
  const interimRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Refresh the speaker names by re-fetching /result and merging by start_ms
  // (or by index as a fallback). Triggered by the WS `speakers_updated` event,
  // and once more after the meeting ends.
  const refreshSpeakers = useCallback(async () => {
    try {
      const r = await api.meetingResult(meetingId);
      if (r.lines.length === 0) return;
      setLines((prev) => mergeSpeakers(prev, r.lines));
      if (r.identification_status === "ready") {
        setStatusText("✅ 识别完成");
      }
    } catch (e) {
      console.warn("refreshSpeakers failed", e);
    }
  }, [meetingId]);

  const handleEvent = useCallback((e: SttEvent) => {
    if (e.type === "system") {
      if (e.msg === "ready") setStatusText("已连接，开始说话");
      else setStatusText(`系统：${e.msg}`);
      return;
    }
    if (e.type === "reconnect_state") {
      // Only update status when we're meant to be live; don't override
      // "会议已结束" once the user pressed stop.
      if (phaseRef.current !== "live") return;
      if (e.state === "connecting") {
        setStatusText(
          e.attempt && e.attempt > 0
            ? `网络中断,正在重连… (第 ${e.attempt} 次)`
            : "正在连接…",
        );
      } else if (e.state === "connected") {
        setStatusText(e.attempt && e.attempt > 0 ? "✓ 已重连,继续说话" : "已连接,开始说话");
      } else if (e.state === "lost") {
        setStatusText("连接已断开,准备重连…");
      } else if (e.state === "giving_up") {
        setStatusText("多次重连失败,请检查网络后刷新页面");
      }
      return;
    }
    if (e.type === "speakers_updated") {
      void refreshSpeakers();
      return;
    }
    if (e.type === "transcript_persisted") {
      // Wire the DB line_id onto the local final line that matches by start_ms.
      // This is what unlocks the in-meeting "✏️ correct speaker" affordance.
      setLines((prev) =>
        prev.map((l) =>
          l.kind === "user" && l.final && l.startMs === e.start_ms
            ? { ...l, serverLineId: e.line_id }
            : l,
        ),
      );
      return;
    }
    if (e.type === "agent_recommendation") {
      // Clear any prior recommendation timer
      if (recommendTimerRef.current) {
        window.clearTimeout(recommendTimerRef.current);
      }
      setRecommendation({
        agent_id: e.agent_id,
        agent_name: e.agent_name,
        agent_color: e.agent_color,
        reason: e.reason,
      });
      // Auto-dismiss after 90s — user shouldn't be nagged forever
      recommendTimerRef.current = window.setTimeout(() => {
        setRecommendation(null);
      }, 90_000);
      return;
    }
    if (e.type === "agent_message_start") {
      // A new agent is speaking — dismiss any stale recommendation
      setRecommendation(null);
      setBusyAgents((prev) => {
        if (prev.has(e.agent_id)) return prev;
        const next = new Set(prev);
        next.add(e.agent_id);
        return next;
      });
      setLines((prev) => [
        ...prev,
        {
          kind: "agent",
          id: `a${nextIdRef.current++}`,
          agentId: e.agent_id,
          agentName: e.agent_name,
          agentColor: e.agent_color,
          text: "",
          done: false,
        },
      ]);
      return;
    }
    if (e.type === "agent_message_chunk") {
      setLines((prev) => {
        const draft = prev.slice();
        for (let i = draft.length - 1; i >= 0; i--) {
          const l = draft[i];
          if (l.kind === "agent" && l.agentId === e.agent_id && !l.done) {
            draft[i] = { ...l, text: l.text + e.chunk };
            return draft;
          }
        }
        return prev;
      });
      return;
    }
    if (e.type === "agent_message_end") {
      setBusyAgents((prev) => {
        if (!prev.has(e.agent_id)) return prev;
        const next = new Set(prev);
        next.delete(e.agent_id);
        return next;
      });
      setLines((prev) => {
        const draft = prev.slice();
        for (let i = draft.length - 1; i >= 0; i--) {
          const l = draft[i];
          if (l.kind === "agent" && l.agentId === e.agent_id && !l.done) {
            draft[i] = { ...l, text: e.text || l.text, done: true };
            return draft;
          }
        }
        return prev;
      });
      return;
    }
    if (e.type === "transcript") {
      setLines((prev) => {
        const draft = prev.slice();
        if (e.is_final) {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0 && draft[idx].kind === "user") {
              const cur = draft[idx] as Extract<LiveLine, { kind: "user" }>;
              draft[idx] = {
                ...cur,
                text: e.text,
                final: true,
                startMs: e.start_ts ?? cur.startMs,
                endMs: e.end_ts ?? cur.endMs,
              };
            }
            interimRef.current = null;
          } else {
            draft.push({
              kind: "user",
              id: `f${nextIdRef.current++}`,
              text: e.text,
              final: true,
              startMs: e.start_ts ?? null,
              endMs: e.end_ts ?? null,
              speakerName: null,
              speakerUserId: null,
              serverLineId: null,
            });
          }
        } else {
          if (interimRef.current) {
            const idx = draft.findIndex((l) => l.id === interimRef.current);
            if (idx >= 0 && draft[idx].kind === "user") {
              const cur = draft[idx] as Extract<LiveLine, { kind: "user" }>;
              draft[idx] = { ...cur, text: e.text };
            }
          } else {
            const id = `i${nextIdRef.current++}`;
            interimRef.current = id;
            draft.push({
              kind: "user",
              id,
              text: e.text,
              final: false,
              startMs: e.start_ts ?? null,
              endMs: e.end_ts ?? null,
              speakerName: null,
              speakerUserId: null,
              serverLineId: null,
            });
          }
        }
        return draft;
      });
    }
  }, [refreshSpeakers]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    setStatusText("请求麦克风权限...");
    try {
      const sock = openSttSocket({
        url: backendWsUrl(meetingId),
        onEvent: handleEvent,
        onClose: () => {
          if (phaseRef.current === "live") setStatusText("连接已断开");
        },
      });
      socketRef.current = sock;
      const cap = await startAudioCapture((frame) => sock.send(frame));
      captureRef.current = cap;
      setPhase("live");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof MicPermissionError
          ? err.message
          : err instanceof Error
          ? `启动失败：${err.message}`
          : "启动失败";
      setStatusText(message);
      // Surface to a sticky toast so the user sees it even after navigating
      // their attention elsewhere on the page.
      if (err instanceof MicPermissionError) {
        toast.error("麦克风启动失败", { detail: err.message, sticky: true });
      } else {
        toast.error("启动失败", { detail: message });
      }
      try { socketRef.current?.close(); } catch {}
    }
  }, [phase, meetingId, handleEvent]);

  const stop = useCallback(async () => {
    setStatusText("会议已结束，正在做最后一次声纹识别…");
    setPhase("ended");
    try { await captureRef.current?.stop(); } catch {}
    captureRef.current = null;
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    interimRef.current = null;
    // Load the pool of users so manual correction can offer real names.
    api.listUsers()
      .then((rs) => setAttendees(rs.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => {});
    // Server runs one final identify pass on WS close. Poll until status=ready.
    const poll = async (attemptsLeft: number) => {
      try {
        const r = await api.meetingResult(meetingId);
        setLines((prev) => mergeSpeakers(prev, r.lines));
        if (r.identification_status === "ready") {
          setStatusText("✅ 识别完成");
          return;
        }
        if (r.identification_status === "skipped") {
          setStatusText(`已跳过声纹识别：${r.identification_message ?? ""}`);
          return;
        }
        if (r.identification_status === "failed") {
          setStatusText(`识别失败：${r.identification_message ?? ""}`);
          return;
        }
      } catch (e) {
        console.warn("poll failed", e);
      }
      if (attemptsLeft > 0) {
        window.setTimeout(() => void poll(attemptsLeft - 1), 4000);
      }
    };
    void poll(60); // up to ~4 minutes
  }, [meetingId]);

  useEffect(() => () => {
    captureRef.current?.stop().catch(() => {});
    socketRef.current?.close();
    if (recommendTimerRef.current) {
      window.clearTimeout(recommendTimerRef.current);
    }
  }, []);

  // Pull agents on mount so the avatar bar populates even before "开始会议".
  useEffect(() => {
    api.listAgents().then(
      (rows) => setAgents(rows.filter((a) => a.is_active)),
      (err) => console.warn("listAgents failed", err),
    );
    // Also pre-load the attendee pool so the in-meeting correction
    // dropdown is populated immediately when the first ✏️ is clicked.
    api.listUsers().then(
      (rs) => setAttendees(rs.map((r) => ({ id: r.id, name: r.name }))),
      () => {},
    );
  }, []);

  const invokeAgent = useCallback((agent: Agent) => {
    if (phase !== "live" || !socketRef.current) return;
    if (busyAgents.has(agent.id)) return;
    socketRef.current.sendJson({
      action: "invoke_agent",
      agent_id: agent.id,
    });
  }, [phase, busyAgents]);

  const acceptRecommendation = useCallback(() => {
    if (!recommendation || !socketRef.current || phase !== "live") return;
    if (busyAgents.has(recommendation.agent_id)) return;
    socketRef.current.sendJson({
      action: "invoke_agent",
      agent_id: recommendation.agent_id,
    });
    setRecommendation(null);
  }, [recommendation, phase, busyAgents]);

  const dismissRecommendation = useCallback(() => {
    setRecommendation(null);
  }, []);

  const correctSpeaker = useCallback(
    async (lineId: number, speakerUserId: string | null, displayName: string | null) => {
      try {
        await api.correctSpeaker(meetingId, lineId, speakerUserId);
        setLines((prev) =>
          prev.map((l) =>
            l.kind === "user" && l.serverLineId === lineId
              ? { ...l, speakerUserId, speakerName: displayName }
              : l,
          ),
        );
      } catch (e) {
        console.error("correctSpeaker failed", e);
      } finally {
        setCorrectingLineId(null);
      }
    },
    [meetingId],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">会议室</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">实时字幕 · 异步贴姓名</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← 首页</Link>
      </header>

      <div className="mt-5 flex items-center gap-3">
        <span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            phase === "live"
              ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/50"
              : phase === "ended"
              ? "bg-amber-400"
              : "bg-zinc-600"
          }`}
        />
        <span className="text-sm text-zinc-400">{statusText}</span>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          onClick={start}
          disabled={phase !== "idle"}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          开始会议
        </button>
        <button
          onClick={stop}
          disabled={phase !== "live"}
          className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-300 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-rose-500/10 transition"
        >
          结束会议
        </button>
      </div>

      {phase === "idle" && audioCaps.isIOSSafari ? (
        <div className="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-xs text-sky-200">
          📱 检测到 iOS Safari。开会前请确保:1) 浏览器允许麦克风权限(设置 → Safari → 麦克风);2) 屏幕保持点亮且 Safari 处于前台;3) 点击「开始会议」时直接对着麦克风说话,不要离设备太远。
        </div>
      ) : null}
      {phase === "idle" && !audioCaps.secureContext ? (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-200">
          ⚠️ 当前页面不在安全上下文中(需要 HTTPS)。浏览器禁止访问麦克风,无法开会。
        </div>
      ) : null}
      {phase === "idle" ? <BriefingCard meetingId={meetingId} /> : null}
      {phase === "ended" ? <SummaryCard meetingId={meetingId} /> : null}

      {agents.length > 0 ? (
        <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
          <div className="flex items-center gap-3 overflow-x-auto">
            <span className="shrink-0 text-xs uppercase tracking-wider text-zinc-500">AI 专家</span>
            {agents.map((a) => {
              const busy = busyAgents.has(a.id);
              const enabled = phase === "live" && !busy;
              const color = tailwindColor(a.color ?? "violet");
              return (
                <button
                  key={a.id}
                  onClick={() => invokeAgent(a)}
                  disabled={!enabled}
                  title={
                    phase !== "live"
                      ? `开始会议后,点头像让「${a.name}」基于讨论发言`
                      : busy
                      ? `${a.name} 正在发言…`
                      : `点击让「${a.name}」基于刚才讨论发言`
                  }
                  className={`group relative flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                    enabled
                      ? "border-ink-700 bg-ink-950 hover:border-white/30"
                      : "border-ink-800 bg-ink-950 opacity-60 cursor-not-allowed"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {a.name.slice(0, 1)}
                  </span>
                  <span className="text-sm text-zinc-200">{a.name}</span>
                  {busy && (
                    <span
                      className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </button>
              );
            })}
            <Link
              href="/admin/agents"
              className="ml-auto shrink-0 text-xs text-zinc-500 hover:text-accent-400"
            >
              + 管理 AI 专家
            </Link>
          </div>
        </div>
      ) : null}

      {recommendation && phase === "live" ? (
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-accent-500/40 bg-accent-500/10 px-3 py-2"
          style={{ borderLeftColor: tailwindColor(recommendation.agent_color), borderLeftWidth: 3 }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
            <span className="text-base">💡</span>
            <span>
              建议接下来由
              <span
                className="mx-1 font-medium"
                style={{ color: tailwindColor(recommendation.agent_color) }}
              >
                {recommendation.agent_name}
              </span>
              发言 — <span className="text-zinc-400">{recommendation.reason}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={acceptRecommendation}
              disabled={busyAgents.has(recommendation.agent_id)}
              className="rounded-lg bg-accent-500 px-3 py-1 text-xs font-medium text-white shadow disabled:opacity-50 hover:bg-accent-400 transition"
            >
              请{recommendation.agent_name}发言
            </button>
            <button
              onClick={dismissRecommendation}
              className="text-xs text-zinc-500 hover:text-zinc-300"
              title="忽略"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <section
        ref={scrollRef}
        className="mt-4 h-[55vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            点「开始会议」后开口说话。字幕实时出现，姓名稍后异步贴上。
          </div>
        ) : (
          <ul className="space-y-3">
            {lines.map((l) =>
              l.kind === "user" ? (
                <li
                  key={l.id}
                  className={
                    l.final
                      ? "text-base leading-relaxed text-zinc-100"
                      : "text-base leading-relaxed text-zinc-400"
                  }
                >
                  <SpeakerLabel
                    line={l}
                    canEdit={l.final && l.serverLineId !== null}
                    isOpen={correctingLineId === l.serverLineId}
                    onToggle={() =>
                      setCorrectingLineId(
                        correctingLineId === l.serverLineId ? null : l.serverLineId,
                      )
                    }
                    attendees={attendees}
                    onPick={(uid, name) => correctSpeaker(l.serverLineId!, uid, name)}
                  />
                  <span>{l.text}</span>
                  {!l.final ? <span className="ml-1 animate-pulse">▌</span> : null}
                </li>
              ) : (
                <li
                  key={l.id}
                  className="rounded-lg border border-ink-700 bg-ink-950 p-3 text-base leading-relaxed"
                  style={{ borderLeft: `3px solid ${tailwindColor(l.agentColor)}` }}
                >
                  <span
                    className="mr-2 text-xs font-medium uppercase tracking-wider"
                    style={{ color: tailwindColor(l.agentColor) }}
                  >
                    🤖 {l.agentName}
                  </span>
                  <span className="text-zinc-100 whitespace-pre-wrap">{l.text}</span>
                  {!l.done ? <span className="ml-1 animate-pulse">▌</span> : null}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <footer className="mt-3 text-xs text-zinc-600">
        STT：DashScope · 声纹：pyannoteAI（约 45s 后台识别）· AI 专家：@关键词召唤 或点头像
      </footer>
    </main>
  );
}

/**
 * Merge server-side identified speakers into our local live lines. We match
 * by start_ms — same precision the server stores. Lines without a server
 * counterpart yet keep their existing local state. Lines that gained or
 * changed a speaker are updated in place.
 */
function mergeSpeakers(local: LiveLine[], serverLines: TranscriptLine[]): LiveLine[] {
  if (serverLines.length === 0) return local;
  const byStartMs = new Map<number, TranscriptLine>();
  for (const s of serverLines) {
    if (s.start_ms != null) byStartMs.set(s.start_ms, s);
  }
  let mutated = false;
  const out = local.map((l) => {
    if (l.kind !== "user" || l.startMs == null) return l;
    const s = byStartMs.get(l.startMs);
    if (!s) return l;
    const sameInfo =
      s.speaker_name === l.speakerName &&
      s.speaker_user_id === l.speakerUserId &&
      s.id === l.serverLineId;
    if (sameInfo) return l;
    mutated = true;
    return {
      ...l,
      speakerName: s.speaker_name,
      speakerUserId: s.speaker_user_id,
      serverLineId: s.id,
    };
  });
  return mutated ? out : local;
}
