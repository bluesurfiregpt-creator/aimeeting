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
import { api, type Agent, type AgendaItem, type TranscriptLine } from "@/lib/api";
import BriefingCard from "./BriefingCard";
import SummaryCard from "./SummaryCard";
import ActionItemsCard from "./ActionItemsCard";
// v25.14: TraceCard 合并到 ActionItemsCard,不再单独引用
// import TraceCard from "./TraceCard";

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
      // v24.3 #1: 该回答引用的 KB chunks(只在 done=true 时填,WS 末尾事件给)
      citations: import("@/lib/api").AgentCitation[];
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
  onBatchPick,  // v25.10 Bug C: 此后 N 句
}: {
  line: Extract<LiveLine, { kind: "user" }>;
  canEdit: boolean;
  isOpen: boolean;
  onToggle: () => void;
  attendees: Array<{ id: string; name: string }>;
  onPick: (userId: string | null, name: string | null) => void;
  onBatchPick?: (userId: string, name: string, count: number) => void;
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
        <span className="absolute left-0 top-full z-20 inline-flex min-w-[200px] flex-col rounded-lg border border-ink-700 bg-ink-950 p-1 shadow-lg" style={{ marginTop: 4 }}>
          {attendees.length === 0 ? (
            <span className="px-2 py-1 text-xs text-zinc-600">无可选参会人</span>
          ) : (
            attendees.map((a) => (
              <div key={a.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onPick(a.id, a.name)}
                  className="flex-1 rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-ink-800"
                  title="只改这一句"
                >
                  {a.name}
                </button>
                {/* v25.10 Bug C: 批量改后续 5/10 句 */}
                {onBatchPick && (
                  <>
                    <button
                      type="button"
                      onClick={() => onBatchPick(a.id, a.name, 5)}
                      className="rounded px-1.5 py-1 text-[10px] text-amber-400 hover:bg-amber-500/15"
                      title={`将此后 5 句都改为「${a.name}」(解决声纹连续误识)`}
                    >
                      +5
                    </button>
                    <button
                      type="button"
                      onClick={() => onBatchPick(a.id, a.name, 10)}
                      className="rounded px-1.5 py-1 text-[10px] text-amber-400 hover:bg-amber-500/15"
                      title={`将此后 10 句都改为「${a.name}」`}
                    >
                      +10
                    </button>
                  </>
                )}
              </div>
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
  // v25.12-#2: Tab 化 — 实录 / 纪要 两个视图
  const [viewTab, setViewTab] = useState<"live" | "minutes">("live");
  // Meeting metadata loaded on mount so we can:
  //   1. Show the actual meeting title in the H1 (was hardcoded to a feature
  //      description, which confused testers — see report v8 finding 4)
  //   2. Auto-jump straight to "ended" phase when navigating to a meeting
  //      that's already processed/finished, so the SummaryCard + transcript
  //      render instead of the start-meeting UI (report v8 P0 finding)
  const [meetingMeta, setMeetingMeta] = useState<{
    title: string;
    status: string;
    agenda: AgendaItem[] | null;
    attendee_agent_ids: string[];  // v25.10 Bug 1: 邀请的 AI 才显示
  } | null>(null);
  const [audioCaps] = useState(() => probeAudioCapabilities());
  // `mounted` gates browser-only conditional UI (iOS Safari notice, insecure
  // context warning) so SSR + first hydration render identical markup. Without
  // this, the SSR stub (window undefined → secureContext:false, isIOSSafari:false)
  // diverges from CSR (real values) and React throws hydration error #418.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
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
  // Sprint M2.3: dissent banner from dissent_detector after a finalized
  // ASR sentence triggers the LLM-based scan.
  const [dissent, setDissent] = useState<{
    topic: string;
    parties: string[];
    agent_id: string;
    agent_name: string;
    agent_color: string;
    reason: string;
  } | null>(null);
  const dissentTimerRef = useRef<number | null>(null);
  // M3.0: moderator banner — agenda_off_topic / agenda_time_warning /
  // agenda_stuck (M3.0.4). All three share the same slot because only one
  // shows at a time. `auto_summon_at_ms` is set ONLY for stuck — when the
  // wall clock crosses that timestamp the banner auto-summons the moderator
  // (the "more aggressive" UX agreed for stuck specifically).
  const [moderator, setModerator] = useState<{
    kind: "off_topic" | "time_warning" | "stuck";
    title: string;
    body: string;
    agent_id: string;
    agent_name: string;
    agent_color: string;
    invoke_query: string;
    auto_summon_at_ms: number | null;
  } | null>(null);
  const moderatorTimerRef = useRef<number | null>(null);
  // Live countdown display for stuck banners. Refreshed via interval so the
  // banner shows "5 → 4 → 3 → 2 → 1" without re-rendering the parent on
  // every tick (we only re-render this small piece). null = no countdown.
  const [moderatorCountdown, setModeratorCountdown] = useState<number | null>(null);
  const moderatorCountdownIntervalRef = useRef<number | null>(null);
  const moderatorAutoFireTimeoutRef = useRef<number | null>(null);
  // Pool of attendees we let users pick from when manually correcting a
  // line's speaker after the meeting. Loaded after stop() because it's
  // only relevant once identification is done.
  const [attendees, setAttendees] = useState<Array<{ id: string; name: string }>>([]);
  const [correctingLineId, setCorrectingLineId] = useState<number | null>(null);
  // Text-input box (alternative to mic). Lives next to the transcript area.
  // Speaker selection persists across sends so a single user can rapid-fire
  // multiple lines without re-picking. Defaults to "未指定".
  const [textInput, setTextInput] = useState("");
  const [textSpeaker, setTextSpeaker] = useState<string>("");
  const [textSending, setTextSending] = useState(false);

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
    if (e.type === "dissent_detected") {
      if (dissentTimerRef.current) {
        window.clearTimeout(dissentTimerRef.current);
      }
      setDissent({
        topic: e.topic,
        parties: e.parties,
        agent_id: e.suggested_agent_id,
        agent_name: e.suggested_agent_name,
        agent_color: e.suggested_agent_color,
        reason: e.reason,
      });
      dissentTimerRef.current = window.setTimeout(() => {
        setDissent(null);
      }, 90_000);
      return;
    }
    if (
      e.type === "agenda_off_topic" ||
      e.type === "agenda_time_warning" ||
      e.type === "agenda_stuck"
    ) {
      // Wipe any previous banner timers (auto-dismiss / auto-fire / countdown)
      if (moderatorTimerRef.current) window.clearTimeout(moderatorTimerRef.current);
      if (moderatorAutoFireTimeoutRef.current) window.clearTimeout(moderatorAutoFireTimeoutRef.current);
      if (moderatorCountdownIntervalRef.current) window.clearInterval(moderatorCountdownIntervalRef.current);
      moderatorTimerRef.current = null;
      moderatorAutoFireTimeoutRef.current = null;
      moderatorCountdownIntervalRef.current = null;
      setModeratorCountdown(null);

      if (e.type === "agenda_off_topic") {
        setModerator({
          kind: "off_topic",
          title: e.current_agenda_item
            ? `已偏离议程「${e.current_agenda_item}」`
            : "讨论已偏离议程",
          body: e.off_topic_summary || e.reason,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_color: e.moderator_agent_color,
          invoke_query: `请你作为主持人,简短提醒大家回到议程项「${
            e.suggested_agenda_item ?? e.current_agenda_item ?? "原议题"
          }」。`,
          auto_summon_at_ms: null,
        });
      } else if (e.type === "agenda_time_warning") {
        setModerator({
          kind: "time_warning",
          title: "议程时间预算告急",
          body: e.time_warning_text || `已开会 ${e.elapsed_min} 分钟,${e.reason}`,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_color: e.moderator_agent_color,
          invoke_query:
            "请你作为主持人,提醒大家时间快到了,需要尽快推进或锁定结论。",
          auto_summon_at_ms: null,
        });
      } else {
        // M3.0.4 stuck — auto-summon after countdown unless user dismisses
        const seconds = Math.max(2, Math.min(15, e.auto_summon_after_s || 5));
        const fireAt = Date.now() + seconds * 1000;
        setModerator({
          kind: "stuck",
          title: "讨论陷入僵局",
          body: e.stuck_summary || e.reason,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_color: e.moderator_agent_color,
          invoke_query:
            "请你作为主持人,综合双方观点,给出一个折中方案或推进建议,帮我们破局。",
          auto_summon_at_ms: fireAt,
        });
        // Countdown display ticks every 250ms for smooth visual update
        setModeratorCountdown(seconds);
        moderatorCountdownIntervalRef.current = window.setInterval(() => {
          const remain = Math.ceil((fireAt - Date.now()) / 1000);
          setModeratorCountdown(remain > 0 ? remain : 0);
        }, 250);
      }

      // Auto-dismiss banner after 90s if user does nothing (off_topic + time_warning)
      // Stuck has its own auto-fire via auto_summon_at_ms; we don't auto-dismiss it
      // before that fires.
      if (e.type !== "agenda_stuck") {
        moderatorTimerRef.current = window.setTimeout(() => {
          setModerator(null);
        }, 90_000);
      }
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
          citations: [],
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
            draft[i] = {
              ...l,
              text: e.text || l.text,
              done: true,
              // v24.3 #1: 末尾事件带 citations,渲染 chips
              citations: Array.isArray(e.citations) ? e.citations : [],
            };
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
    // Open the WS first — even if mic fails we still want to be able to
    // type (text-only mode). Only close the socket on hard WS failures
    // (which throw immediately on `new WebSocket(...)`).
    let sock: SttSocket | null = null;
    try {
      sock = openSttSocket({
        url: backendWsUrl(meetingId),
        onEvent: handleEvent,
        onClose: () => {
          if (phaseRef.current === "live") setStatusText("连接已断开");
        },
      });
      socketRef.current = sock;
    } catch (err) {
      const message = err instanceof Error ? err.message : "WebSocket 启动失败";
      setStatusText(message);
      toast.error("WebSocket 启动失败", { detail: message });
      return;
    }
    // Now try to attach mic. If it fails (permission denied / no device /
    // not secure context) keep the WS open in text-only mode — user can
    // still type messages and trigger AI agents.
    try {
      const cap = await startAudioCapture((frame) => sock!.send(frame));
      captureRef.current = cap;
      setPhase("live");
    } catch (err) {
      console.warn("audio capture failed; entering text-only mode", err);
      const detail =
        err instanceof MicPermissionError
          ? err.message
          : err instanceof Error
          ? err.message
          : "启动麦克风失败";
      // Tell the user the mic failed but emphasize they can still type.
      setStatusText("⌨️ 仅文字模式(麦克风未启用)");
      toast.warn("麦克风未启用,可在下方文字框打字录入", {
        detail,
        sticky: true,
      });
      setPhase("live");
    }
  }, [phase, meetingId, handleEvent]);

  const stop = useCallback(async () => {
    setStatusText("会议已结束，正在做最后一次声纹识别…");
    setPhase("ended");
    setViewTab("minutes");  // v25.12-#2: 会议结束自动切到纪要 tab
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
    if (dissentTimerRef.current) {
      window.clearTimeout(dissentTimerRef.current);
    }
    if (moderatorTimerRef.current) {
      window.clearTimeout(moderatorTimerRef.current);
    }
    if (moderatorAutoFireTimeoutRef.current) {
      window.clearTimeout(moderatorAutoFireTimeoutRef.current);
    }
    if (moderatorCountdownIntervalRef.current) {
      window.clearInterval(moderatorCountdownIntervalRef.current);
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

  // Load meeting metadata; if the meeting is already finished/processed,
  // jump straight to "ended" phase so SummaryCard + transcript render. Also
  // surface meeting title for the H1.
  useEffect(() => {
    let alive = true;
    api.getMeeting(meetingId).then(
      (m) => {
        if (!alive) return;
        setMeetingMeta({
          title: m.title,
          status: m.status,
          agenda: m.agenda ?? null,
          attendee_agent_ids: m.attendee_agent_ids ?? [],
        });
        if (m.status === "processed" || m.status === "finished") {
          setPhase("ended");
          setViewTab("minutes");  // v25.12-#2: 已结束会议默认 纪要 tab
          setStatusText(m.status === "processed" ? "✅ 已处理" : "已结束");
          // Pre-populate transcript + speaker names so the user sees
          // historical content immediately, not a "请点开始会议" empty state.
          api.meetingResult(meetingId).then(
            (r) => {
              if (!alive) return;
              setLines(
                r.lines.map((l) => ({
                  kind: "user" as const,
                  id: `s${l.id}`,
                  text: l.text,
                  final: true,
                  startMs: l.start_ms,
                  endMs: l.end_ms,
                  speakerName: l.speaker_name,
                  speakerUserId: l.speaker_user_id,
                  serverLineId: l.id,
                })),
              );
            },
            () => {},
          );
        }
      },
      (err) => console.warn("getMeeting failed", err),
    );
    return () => {
      alive = false;
    };
  }, [meetingId]);

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

  const acceptDissent = useCallback(() => {
    if (!dissent || !socketRef.current || phase !== "live") return;
    if (busyAgents.has(dissent.agent_id)) return;
    socketRef.current.sendJson({
      action: "invoke_agent",
      agent_id: dissent.agent_id,
      query: `参会人就「${dissent.topic}」存在分歧,请你基于自己的领域给出立场鲜明的判断`,
    });
    setDissent(null);
  }, [dissent, phase, busyAgents]);

  const dismissDissent = useCallback(() => {
    setDissent(null);
  }, []);

  // M3.0: summon the moderator (built-in agent) to actually intervene.
  // Same shape as acceptDissent — sends invoke_agent over WS with a custom
  // query. The moderator's persona handles the response style.
  const acceptModerator = useCallback(() => {
    if (!moderator || !socketRef.current || phase !== "live") return;
    if (busyAgents.has(moderator.agent_id)) return;
    socketRef.current.sendJson({
      action: "invoke_agent",
      agent_id: moderator.agent_id,
      query: moderator.invoke_query,
    });
    setModerator(null);
  }, [moderator, phase, busyAgents]);

  const dismissModerator = useCallback(() => {
    // Wipe everything — banner, countdown, scheduled auto-fire.
    if (moderatorAutoFireTimeoutRef.current) {
      window.clearTimeout(moderatorAutoFireTimeoutRef.current);
      moderatorAutoFireTimeoutRef.current = null;
    }
    if (moderatorCountdownIntervalRef.current) {
      window.clearInterval(moderatorCountdownIntervalRef.current);
      moderatorCountdownIntervalRef.current = null;
    }
    setModerator(null);
    setModeratorCountdown(null);
  }, []);

  // M3.0.4: when a stuck banner sets `auto_summon_at_ms`, schedule the
  // auto-summon. Runs once when the banner appears and clears itself if
  // the banner changes / dismisses before fire. Aggressive but cancellable
  // — cancel paths: ✕ click, banner replaced by another, phase != live.
  useEffect(() => {
    if (!moderator || moderator.auto_summon_at_ms == null) return;
    if (phase !== "live" || !socketRef.current) return;
    const delay = Math.max(0, moderator.auto_summon_at_ms - Date.now());
    moderatorAutoFireTimeoutRef.current = window.setTimeout(() => {
      // Don't pile on if the moderator is already mid-utterance.
      if (busyAgents.has(moderator.agent_id)) {
        setModerator(null);
        return;
      }
      socketRef.current?.sendJson({
        action: "invoke_agent",
        agent_id: moderator.agent_id,
        query: moderator.invoke_query,
      });
      if (moderatorCountdownIntervalRef.current) {
        window.clearInterval(moderatorCountdownIntervalRef.current);
        moderatorCountdownIntervalRef.current = null;
      }
      setModerator(null);
      setModeratorCountdown(null);
    }, delay);
    return () => {
      if (moderatorAutoFireTimeoutRef.current) {
        window.clearTimeout(moderatorAutoFireTimeoutRef.current);
        moderatorAutoFireTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderator?.auto_summon_at_ms, moderator?.agent_id, moderator?.invoke_query]);

  /**
   * Submit a typed message into the meeting transcript. Two paths:
   *   - WS open (live meeting):  sendJson({action: "text_message", ...}) →
   *     backend echoes a transcript event back instantly so the user sees
   *     their line immediately, plus fires Agent/dissent triggers via the
   *     same WS callbacks (streaming chunks visible in real time).
   *   - WS not open (e.g. user never pressed 开始会议, or mic was denied):
   *     fall back to REST POST /manual-transcript. The line still persists
   *     and Agent triggers fire, but streaming chunks for those Agent
   *     replies won't be visible (they're saved server-side and show up
   *     after refresh). Optimistically append the line to local state.
   */
  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text || textSending) return;
    const speakerId = textSpeaker || null;
    setTextSending(true);
    try {
      if (socketRef.current && phase === "live") {
        socketRef.current.sendJson({
          action: "text_message",
          text,
          speaker_user_id: speakerId,
        });
        // The WS echoes a transcript event back; no optimistic append needed.
      } else {
        const r = await api.postManualTranscript(meetingId, {
          text,
          speaker_user_id: speakerId,
        });
        // Optimistically append since there's no WS to echo for us.
        setLines((prev) => [
          ...prev,
          {
            kind: "user",
            id: `m${nextIdRef.current++}`,
            text,
            final: true,
            startMs: null,
            endMs: null,
            speakerName: r.speaker_name,
            speakerUserId: r.speaker_user_id,
            serverLineId: r.line_id,
          },
        ]);
      }
      setTextInput("");
    } catch (e) {
      toast.error("发送失败", {
        detail: e instanceof Error ? e.message : "未知错误",
      });
    } finally {
      setTextSending(false);
    }
  }, [textInput, textSpeaker, textSending, phase, meetingId]);

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

  // v25.10 Bug C: 此后 N 句 都改为某人 — 一键解决连续误识
  const batchCorrectSpeaker = useCallback(
    async (fromLineId: number, count: number, speakerUserId: string, displayName: string) => {
      try {
        const r = await api.batchCorrectSpeaker(meetingId, fromLineId, count, speakerUserId);
        // 本地 update:把 后续 r.updated 句都改
        setLines((prev) => {
          let remaining = r.updated;
          let started = false;
          return prev.map((l) => {
            if (remaining <= 0) return l;
            if (l.kind !== "user" || l.serverLineId == null) return l;
            if (l.serverLineId === fromLineId) {
              started = true;
            }
            if (started) {
              remaining -= 1;
              return { ...l, speakerUserId, speakerName: displayName };
            }
            return l;
          });
        });
      } catch (e) {
        console.error("batchCorrectSpeaker failed", e);
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
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {meetingMeta?.title || "正在加载…"}
          </h1>
          <p className="mt-1 text-xs text-zinc-500">实时字幕 · 异步贴姓名</p>
        </div>
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

      {/* v25.12-#2: Tab 化 nav — 实录 / 纪要 */}
      <nav className="mt-5 flex gap-1 border-b border-ink-700">
        <button
          onClick={() => setViewTab("live")}
          data-testid="tab-live"
          className={`rounded-t-lg px-4 py-2 text-sm transition ${
            viewTab === "live"
              ? "border-b-2 border-accent-500 text-white"
              : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          📝 实录与发言
        </button>
        <button
          onClick={() => setViewTab("minutes")}
          disabled={phase !== "ended"}
          data-testid="tab-minutes"
          className={`rounded-t-lg px-4 py-2 text-sm transition ${
            viewTab === "minutes"
              ? "border-b-2 border-accent-500 text-white"
              : "text-zinc-500 hover:text-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-40`}
          title={phase === "ended" ? "会议纪要 / 行动项 / 追溯链" : "会议结束后才能查看"}
        >
          📋 纪要 + 行动项
          {phase !== "ended" && (
            <span className="ml-1 text-[10px] text-zinc-600">(会议结束后)</span>
          )}
        </button>
      </nav>

      {/* v25.12-#2: 纪要 tab — 仅 phase=ended */}
      {/* v25.14: TraceCard 合并到 ActionItemsCard(待办与流转 一卡到底)*/}
      <div style={{ display: viewTab === "minutes" ? "block" : "none" }}>
        {phase === "ended" ? <SummaryCard meetingId={meetingId} /> : null}
        {phase === "ended" ? <ActionItemsCard meetingId={meetingId} /> : null}
      </div>

      {/* v25.12-#2: 实录 tab(默认) — 所有 live/idle 期内容 */}
      <div style={{ display: viewTab === "live" ? "block" : "none" }}>

      {mounted && phase === "idle" && audioCaps.isIOSSafari ? (
        <div className="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-xs text-sky-200">
          📱 检测到 iOS Safari。开会前请确保:1) 浏览器允许麦克风权限(设置 → Safari → 麦克风);2) 屏幕保持点亮且 Safari 处于前台;3) 点击「开始会议」时直接对着麦克风说话,不要离设备太远。
        </div>
      ) : null}
      {mounted && phase === "idle" && !audioCaps.secureContext ? (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-200">
          ⚠️ 当前页面不在安全上下文中(需要 HTTPS)。浏览器禁止访问麦克风,无法开会。
        </div>
      ) : null}
      {phase === "idle" ? <BriefingCard meetingId={meetingId} /> : null}

      {/* v25.10 Bug 1: 只显示本会议邀请的 AI 专家(不是 workspace 全部) */}
      {(() => {
        const invitedIds = new Set(meetingMeta?.attendee_agent_ids || []);
        const invitedAgents =
          invitedIds.size > 0
            ? agents.filter((a) => invitedIds.has(a.id))
            : [];
        return invitedAgents.length > 0 ? (
        <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
          <div className="flex items-center gap-3 overflow-x-auto">
            <span className="shrink-0 text-xs uppercase tracking-wider text-zinc-500">
              邀请 AI 专家 · {invitedAgents.length} 个
            </span>
            {invitedAgents.map((a) => {
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
      ) : null;
      })()}

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

      {dissent && phase === "live" ? (
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2"
          style={{ borderLeftColor: tailwindColor(dissent.agent_color), borderLeftWidth: 3 }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
            <span className="text-base">⚖️</span>
            <span className="min-w-0">
              <span className="text-rose-200">检测到分歧</span>
              {dissent.topic ? (
                <span className="ml-1 text-zinc-400">「{dissent.topic}」</span>
              ) : null}
              <span className="mx-1 text-zinc-500">·</span>
              <span className="text-zinc-400">{dissent.reason}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={acceptDissent}
              disabled={busyAgents.has(dissent.agent_id)}
              className="rounded-lg px-3 py-1 text-xs font-medium text-white shadow transition disabled:opacity-50"
              style={{ backgroundColor: tailwindColor(dissent.agent_color) }}
            >
              召唤{dissent.agent_name}
            </button>
            <button
              onClick={dismissDissent}
              className="text-xs text-zinc-500 hover:text-zinc-300"
              title="忽略"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* M3.0: 主持人 banner (off-topic + time warning) */}
      {moderator && phase === "live" ? (
        <div
          data-testid={`moderator-banner-${moderator.kind}`}
          className={
            // Stuck banner is more prominent — orange-red border + soft pulse
            // to telegraph the imminent auto-summon.
            moderator.kind === "stuck"
              ? "mt-3 flex items-center justify-between gap-3 rounded-lg border border-orange-500/60 bg-orange-500/10 px-3 py-2 animate-pulse"
              : "mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"
          }
          style={{ borderLeftColor: tailwindColor(moderator.agent_color), borderLeftWidth: 3 }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
            <span className="text-base">
              {moderator.kind === "off_topic"
                ? "🧭"
                : moderator.kind === "time_warning"
                ? "⏱️"
                : "🔄"}
            </span>
            <span className="min-w-0">
              <span
                className={
                  moderator.kind === "stuck"
                    ? "font-medium text-orange-200"
                    : "font-medium text-amber-200"
                }
              >
                {moderator.title}
              </span>
              <span className="mx-1 text-zinc-500">·</span>
              <span className="text-zinc-400">{moderator.body}</span>
              {moderator.kind === "stuck" && moderatorCountdown !== null ? (
                <span
                  data-testid="moderator-countdown"
                  className="ml-2 rounded bg-orange-500/30 px-1.5 py-0.5 text-xs font-semibold text-orange-100"
                >
                  {moderatorCountdown}s 后自动召唤
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              data-testid="moderator-accept"
              onClick={acceptModerator}
              disabled={busyAgents.has(moderator.agent_id)}
              className={
                moderator.kind === "stuck"
                  ? "rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white shadow transition disabled:opacity-50 hover:bg-orange-400"
                  : "rounded-lg px-3 py-1 text-xs font-medium text-white shadow transition disabled:opacity-50"
              }
              style={
                moderator.kind === "stuck"
                  ? undefined
                  : { backgroundColor: tailwindColor(moderator.agent_color) }
              }
            >
              {moderator.kind === "stuck" ? "立刻召唤" : `召唤${moderator.agent_name}`}
            </button>
            <button
              data-testid="moderator-dismiss"
              onClick={dismissModerator}
              className="text-xs text-zinc-500 hover:text-zinc-300"
              title={moderator.kind === "stuck" ? "取消自动召唤" : "忽略"}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* M3.0: 议程 strip — read-only 显示这场会议的议程项. */}
      {meetingMeta?.agenda && meetingMeta.agenda.length > 0 ? (
        <div
          data-testid="agenda-strip"
          className="mt-3 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs"
        >
          <div className="text-zinc-500">本场议程</div>
          <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {meetingMeta.agenda.map((item, i) => (
              <li key={i} className="text-zinc-300">
                <span className="text-zinc-600">{i + 1}.</span> {item.title}
                {item.time_budget_min ? (
                  <span className="ml-1 text-zinc-600">({item.time_budget_min}m)</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* v25.7-#3: 双面板布局 — 实录(60%) + AI 专家发言(40%) */}
      {(() => {
        const userLines = lines.filter((l) => l.kind === "user");
        const agentLines = lines.filter((l) => l.kind === "agent").slice().reverse();
        return (
          <section className="mt-4 grid gap-4 md:grid-cols-5">
            {/* 左:实录(只有真人 / 未识别) — md+ 占 3/5 */}
            <div
              ref={scrollRef}
              data-testid="transcript-panel"
              className="md:col-span-3 h-[55vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6"
            >
              <div className="mb-3 flex items-center justify-between border-b border-ink-800 pb-2">
                <h2 className="text-sm font-medium text-zinc-300">📝 实录</h2>
                <span className="text-[10px] text-zinc-500">
                  {userLines.length} 句
                </span>
              </div>
              {userLines.length === 0 ? (
                <div className="flex h-[40vh] items-center justify-center text-sm text-zinc-600">
                  点「开始会议」后开口说话。字幕实时出现,姓名稍后异步贴上。
                </div>
              ) : (
                <ul className="space-y-3">
                  {userLines.map((l) =>
                    l.kind === "user" ? (
                      <li
                        key={l.id}
                        className={
                          l.final
                            ? "text-base leading-relaxed text-zinc-100"
                            : "text-base leading-relaxed text-zinc-400"
                        }
                      >
                        {l.startMs != null && (
                          <span
                            className="mr-2 font-mono text-xs text-zinc-500"
                            title={`从会议开始 ${l.startMs}ms`}
                          >
                            [{Math.floor(l.startMs / 60000).toString().padStart(2, "0")}:
                            {Math.floor((l.startMs % 60000) / 1000).toString().padStart(2, "0")}]
                          </span>
                        )}
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
                          onBatchPick={(uid, name, count) =>
                            batchCorrectSpeaker(l.serverLineId!, count, uid, name)
                          }
                        />
                        <span>{l.text}</span>
                        {!l.final ? <span className="ml-1 animate-pulse">▌</span> : null}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>

            {/* 右:AI 专家发言(倒序最新在上)— md+ 占 2/5 */}
            <div
              data-testid="agent-panel"
              className="md:col-span-2 h-[55vh] overflow-y-auto rounded-xl border border-violet-500/30 bg-ink-900 p-5"
            >
              <div className="mb-3 flex items-center justify-between border-b border-violet-500/20 pb-2">
                <h2 className="text-sm font-medium text-violet-200">🤖 AI 专家发言</h2>
                <span className="text-[10px] text-zinc-500">
                  {agentLines.length} 条
                </span>
              </div>
              {agentLines.length === 0 ? (
                <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-center text-xs text-zinc-600">
                  <span className="text-2xl">🤖</span>
                  <p>暂无 AI 发言</p>
                  <p className="text-zinc-700">
                    {`@AI 名 触发 / 关键词命中 / 顶部点 AI 头像 手动 invoke`}
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {agentLines.map((l) =>
                    l.kind === "agent" ? (
                      <li
                        key={l.id}
                        className="rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm leading-relaxed"
                        style={{ borderLeft: `3px solid ${tailwindColor(l.agentColor)}` }}
                      >
                        <div
                          className="mb-1 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider"
                          style={{ color: tailwindColor(l.agentColor) }}
                        >
                          <span>🤖 {l.agentName}</span>
                          {!l.done && (
                            <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
                              生成中…
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-100 whitespace-pre-wrap">
                          {l.text}
                          {!l.done ? <span className="ml-1 animate-pulse">▌</span> : null}
                        </div>
                        {l.done && l.citations && l.citations.length > 0 && (
                          <div
                            className="mt-2 flex flex-wrap gap-1 border-t border-ink-800 pt-2"
                            data-testid="agent-citations"
                          >
                            <span className="text-[10px] text-zinc-500">📚 引用</span>
                            {l.citations.map((c, i) => (
                              <span
                                key={c.chunk_id}
                                title={`${c.snippet}${c.snippet.length >= 240 ? "…" : ""}\n\n相关度: ${(1 - c.distance).toFixed(2)}`}
                                className="cursor-help rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-violet-500/40 hover:text-violet-200"
                              >
                                [{i + 1}] {c.document_filename.length > 24
                                  ? c.document_filename.slice(0, 22) + "…"
                                  : c.document_filename}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>
          </section>
        );
      })()}

      {/* 文字录入(打字)— 麦克风的替代 / 自动化测试入口 */}
      {phase !== "ended" ? (
        <div
          data-testid="manual-text-input"
          className="mt-3 flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2"
        >
          <span className="shrink-0 text-base" title="打字录入(麦克风的替代)">💬</span>
          <select
            data-testid="manual-text-speaker"
            value={textSpeaker}
            onChange={(e) => setTextSpeaker(e.target.value)}
            className="shrink-0 rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-accent-500 focus:outline-none"
            title="发言人身份"
          >
            <option value="">未指定</option>
            {attendees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            data-testid="manual-text-content"
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendText();
              }
            }}
            placeholder={
              phase === "live"
                ? "输入文字也可触发 AI 专家(也可同时说话)…"
                : "输入文字加入字幕(无需 mic),回车发送…"
            }
            className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
          <button
            data-testid="manual-text-send"
            onClick={() => void sendText()}
            disabled={!textInput.trim() || textSending}
            className="shrink-0 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
          >
            {textSending ? "发送中…" : "发送"}
          </button>
        </div>
      ) : null}

      </div>  {/* end of viewTab === "live" wrapper */}

      <footer className="mt-3 text-xs text-zinc-600">
        STT：DashScope · 声纹：pyannoteAI（约 45s 后台识别）· AI 专家:@关键词召唤 或点头像 / 文字打字
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
