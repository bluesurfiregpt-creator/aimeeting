"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  MicPermissionError,
  probeAudioCapabilities,
  startAudioCapture,
  type AudioCaptureHandle,
} from "@/lib/audioCapture";
import { toast } from "@/lib/toast";
import { openSttSocket, type SttEvent, type SttSocket } from "@/lib/sttSocket";
import { api, type Agent, type AgendaItem, type Me, type TranscriptLine } from "@/lib/api";

// v26.3.1: 谁能 看到/调 裁决按钮.跟后端 require_leader_or_admin 对齐.
const WRITE_ROLES = new Set(["owner", "admin", "leader"]);
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
  // v25.19 #1: 从实录 tab 触发 重生成/重识别 后,把 ++key 传给 SummaryCard
  // 让它重启 polling — 否则 SummaryCard polling 已经停在 ready,看不到新结果.
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);

  // v25.20: 上游处理工具的 进度条 / 帮助面板.
  // 进度条按 估算时长 走(到 95% 停),完成事件(SummaryCard 收到 ready)
  // 把它顶到 100% 并 4 秒后自动收起.
  type UpstreamTaskKind = "regenerate" | "rerun-identify" | "offline-asr";
  type UpstreamTask = {
    kind: UpstreamTaskKind;
    label: string;        // 标题
    description: string;  // 详细说明 LLM 在做啥
    startedAt: number;    // Date.now() ms
    expectedMs: number;   // 估算时长
    completed: boolean;   // 真正确认完成?
    failed?: string;      // 错误原因
  };
  const [upstreamTask, setUpstreamTask] = useState<UpstreamTask | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);

  // 每秒 tick 一次 — 只在 task 跑时跑.
  useEffect(() => {
    if (!upstreamTask) return;
    const h = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(h);
  }, [upstreamTask]);

  // task 完成后 4 秒自动收起
  useEffect(() => {
    if (!upstreamTask || !upstreamTask.completed) return;
    const h = window.setTimeout(() => setUpstreamTask(null), 4000);
    return () => window.clearTimeout(h);
  }, [upstreamTask]);

  // 进度算法:0..95% 按 elapsed / expected,completed 直接 100,failed 80(红)
  const upstreamProgress = useMemo(() => {
    if (!upstreamTask) return 0;
    if (upstreamTask.completed) return 100;
    if (upstreamTask.failed) return 80;
    const elapsed = nowTick - upstreamTask.startedAt;
    const pct = (elapsed / upstreamTask.expectedMs) * 100;
    return Math.min(95, Math.max(2, pct));
  }, [upstreamTask, nowTick]);

  const upstreamElapsedSec = upstreamTask
    ? Math.floor((nowTick - upstreamTask.startedAt) / 1000)
    : 0;

  const startUpstreamTask = useCallback(
    (
      kind: UpstreamTaskKind,
      label: string,
      description: string,
      expectedMs: number,
    ) => {
      setUpstreamTask({
        kind,
        label,
        description,
        startedAt: Date.now(),
        expectedMs,
        completed: false,
      });
      setNowTick(Date.now());
    },
    [],
  );

  // v25.19 #3d: 实录锚点 — 任务详情 / 行动项 通过 ?focus=id1,id2,... 跳进来,
  // 实录页 高亮这些 行 + 滚动 + 展开 ±3 句上下文.
  // 同时若 ?tab=minutes 也支持从外部直接跳到 纪要 tab.
  const searchParams = useSearchParams();
  const focusIds = useMemo<Set<number>>(() => {
    const raw = searchParams?.get("focus") || "";
    if (!raw) return new Set();
    const ids = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return new Set(ids);
  }, [searchParams]);
  // 标记 我们是否已经为这一组 focus 滚动过(避免每次 lines 变化 都重新滚)
  const scrolledForFocusRef = useRef<string | null>(null);
  // 如果 URL 带 ?focus= 且 transcripts 加载完成 → 滚到第一个 focus 行 + 居中.
  // 不在 useMemo 内做 — 需要等 lines 加载.
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
    mode?: "human" | "hybrid" | "auto";   // v26.3
  } | null>(null);
  // v26.3-07f: auto 会议 分歧统计 (横幅显示 + 跳 orchestrate)
  const [autoMeetingInfo, setAutoMeetingInfo] = useState<{
    pendingReviewCount: number;
    reviewedCount: number;
    totalDissents: number;
  } | null>(null);
  // v26.3.1: 当前用户 role,banner 上的"立即裁决"按钮仅 leader_or_admin 可见.
  const [me, setMe] = useState<Me | null>(null);
  const canWrite = !!me && WRITE_ROLES.has(me.role);
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
    // v25.19 #3d: 如果用户从 evidence 跳过来(?focus=...),不要自动滚到底
    // 否则会盖掉 后面要做的 focus 居中滚动.
    if (focusIds.size > 0) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, focusIds]);

  // v25.21: focusIds 非空 → 强制切到 实录 tab.
  // 多层保险:loadMeetingMeta 处已做了不进 minutes,这里再兜底
  // (比如用户在 minutes 中切回 live 的过程中,或 URL 后续才变化的情况).
  useEffect(() => {
    if (focusIds.size > 0) setViewTab("live");
  }, [focusIds]);

  // v25.21: 显式 居中滚动 — 用 父容器(实录 panel 是 overflow-y-auto)
  // 计算 scrollTop,不用 scrollIntoView(嵌套滚动容器里行为不稳).
  const scrollFocusIntoCenter = useCallback(() => {
    if (focusIds.size === 0) return;
    const firstId = Math.min(...Array.from(focusIds));
    const el = document.getElementById(`focus-line-${firstId}`);
    const cont = scrollRef.current;
    if (!el || !cont) return;
    // 行相对于父容器顶部的位置 — 用 getBoundingClientRect 差值最稳
    const elRect = el.getBoundingClientRect();
    const contRect = cont.getBoundingClientRect();
    const offsetWithinCont =
      elRect.top - contRect.top + cont.scrollTop;
    cont.scrollTo({
      top: Math.max(
        0,
        offsetWithinCont - cont.clientHeight / 2 + el.clientHeight / 2,
      ),
      behavior: "smooth",
    });
  }, [focusIds]);

  // v25.21: 锚点 ±2 句作为 上下文 — 显示浅琥珀,提示用户 这是连续对话区域
  const contextLineIds = useMemo<Set<number>>(() => {
    if (focusIds.size === 0) return new Set();
    const userLines = lines.filter(
      (l): l is typeof lines[number] & { serverLineId: number } =>
        l.kind === "user" && l.serverLineId != null,
    );
    const focusedIdx: number[] = [];
    userLines.forEach((l, i) => {
      if (focusIds.has(l.serverLineId)) focusedIdx.push(i);
    });
    const out = new Set<number>();
    focusedIdx.forEach((i) => {
      for (let k = i - 2; k <= i + 2; k++) {
        if (k < 0 || k >= userLines.length) continue;
        const lid = userLines[k].serverLineId;
        if (!focusIds.has(lid)) out.add(lid); // 锚点本身不算上下文
      }
    });
    return out;
  }, [focusIds, lines]);

  // v25.19 #3d → v25.21: 当 transcripts 加载完成(serverLineId 都贴上了)
  // 且至少一个 focus 行已渲染 → 居中滚动 + 标记 scrolled,避免重复滚.
  useEffect(() => {
    if (focusIds.size === 0) return;
    const key = Array.from(focusIds).sort().join(",");
    if (scrolledForFocusRef.current === key) return;
    const hasFocusLine = lines.some(
      (l) =>
        l.kind === "user" &&
        l.serverLineId != null &&
        focusIds.has(l.serverLineId),
    );
    if (!hasFocusLine) return; // 等下一次 lines 更新
    // 延一帧,等 DOM 渲染完
    const tid = window.setTimeout(() => {
      scrollFocusIntoCenter();
      scrolledForFocusRef.current = key;
    }, 120);
    return () => window.clearTimeout(tid);
  }, [focusIds, lines, scrollFocusIntoCenter]);

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
    // v26.3.1: 拉 me 给 banner 用 (确定 是否显示"立即裁决"按钮 vs 只读链)
    api.me().then(
      (meRes) => { if (alive) setMe(meRes); },
      () => {},
    );

    api.getMeeting(meetingId).then(
      (m) => {
        if (!alive) return;
        setMeetingMeta({
          title: m.title,
          status: m.status,
          agenda: m.agenda ?? null,
          attendee_agent_ids: m.attendee_agent_ids ?? [],
          mode: m.mode,
        });
        // v26.3-07f: auto 会议 拉 consensus 统计 (分歧 banner 用)
        if (m.mode === "auto") {
          api.listMeetingConsensus(meetingId).then(
            (cs) => {
              if (!alive) return;
              const withDissent = cs.filter((c) => (c.dissents?.length || 0) > 0);
              const pending = withDissent.filter((c) => c.needs_human_review && !c.reviewed_at);
              const reviewed = withDissent.filter((c) => !!c.reviewed_at);
              const totalDissents = withDissent.reduce(
                (acc, c) => acc + (c.dissents?.length || 0),
                0,
              );
              setAutoMeetingInfo({
                pendingReviewCount: pending.length,
                reviewedCount: reviewed.length,
                totalDissents,
              });
            },
            () => {},
          );
        }
        if (m.status === "processed" || m.status === "finished") {
          setPhase("ended");
          // v25.12-#2: 已结束会议默认 纪要 tab
          // v25.21: 但如果 URL 带 ?focus= (从 任务详情 跳过来看实录依据),
          // 必须留在 live tab — 否则 jump 到纪要 然后用户看不到我们高亮的实录.
          const hasFocus = !!(typeof window !== "undefined" &&
            new URL(window.location.href).searchParams.get("focus"));
          if (!hasFocus) setViewTab("minutes");
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
    <div className="flex h-screen flex-col bg-ink-950">
      {/* v26.10-Room Phase 1: 顶部条 — 标题 + 状态 + 计时 + 关闭 */}
      <MeetingRoomTopBar
        title={meetingMeta?.title}
        mode={meetingMeta?.mode}
        phase={phase}
        statusText={statusText}
        meetingId={meetingId}
        invitedAgentCount={(() => {
          const ids = new Set(meetingMeta?.attendee_agent_ids || []);
          return ids.size > 0 ? agents.filter((a) => ids.has(a.id)).length : 0;
        })()}
      />

      {/* v26.10-Room Phase 1: 三栏 grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏 — 实时转录 (Phase 2 接管, 当前 placeholder) */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900/30 px-3 py-4 lg:block">
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            📝 实时转录
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Phase 2 即将接管: 把 实录 timeline 移到这里, 头像 + 名字 + 角色 +
            时间.
          </p>
          <div className="mt-4 rounded border border-dashed border-ink-700 bg-ink-950 p-3 text-[11px] text-zinc-600">
            目前 完整实录 仍 在 中栏 (功能不变)
          </div>
        </aside>

        {/* 中栏 — 现有 main 内容 (Phase 2 + 3 重组) */}
        <main className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
      {/* v26.10-Room Phase 1.2: 顶部 split — 左 会议元信息 / 右 AI 专家大画廊 */}
      <header className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">会议室</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {meetingMeta?.title || "正在加载…"}
          </h1>
          <p className="mt-1 text-xs text-zinc-500">实时字幕 · 异步贴姓名</p>
        </div>
        {/* v26.10-Room Phase 1.2: AI 专家画廊 (200x200 大头像 + 名字 上下结构 + 横向滚动) */}
        <MeetingAgentGallery
          invitedAgents={(() => {
            const ids = new Set(meetingMeta?.attendee_agent_ids || []);
            return ids.size > 0 ? agents.filter((a) => ids.has(a.id)) : [];
          })()}
          phase={phase}
          busyAgents={busyAgents}
          onInvoke={invokeAgent}
        />
      </header>

      {/* v26.3-07f auto 会议 顶部 banner: 标识 + 跳 orchestrate + 分歧待裁决.
          v26.3-07-fix1: pending 时 banner 整体变 violet,pill 本身可点击直接跳裁决面板. */}
      {meetingMeta?.mode === "auto" && (
        <div
          className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-xs ${
            autoMeetingInfo && autoMeetingInfo.pendingReviewCount > 0
              ? "border-violet-500/40 bg-violet-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
          data-testid="auto-meeting-banner"
        >
          <span className={
            autoMeetingInfo && autoMeetingInfo.pendingReviewCount > 0
              ? "text-violet-200"
              : "text-amber-200"
          }>
            🤖 此会议为 v26.3 召集人模式 · 全 AI 自主开会
          </span>
          {/* v26.3.1: leader/admin/owner 看到可点击"立即裁决"按钮;expert/member 看只读标签 */}
          {autoMeetingInfo && autoMeetingInfo.pendingReviewCount > 0 && canWrite && (
            <Link
              href={`/meeting/${meetingId}/orchestrate`}
              className="rounded-md bg-violet-500 px-2.5 py-1 font-medium text-violet-950 hover:bg-violet-400"
              data-testid="pending-review-pill"
            >
              ⚖️ 立即裁决 {autoMeetingInfo.totalDissents} 处分歧
              ({autoMeetingInfo.pendingReviewCount} 议程) →
            </Link>
          )}
          {autoMeetingInfo && autoMeetingInfo.pendingReviewCount > 0 && !canWrite && me && (
            <span
              className="rounded-md border border-violet-500/30 px-2.5 py-1 text-[11px] text-violet-300"
              data-testid="pending-review-readonly"
              title="仅 owner/admin/leader 角色可裁决"
            >
              🔒 {autoMeetingInfo.totalDissents} 处分歧 待领导裁决
            </span>
          )}
          {autoMeetingInfo && autoMeetingInfo.reviewedCount > 0 && (
            <span className="text-zinc-400">
              ✓ {autoMeetingInfo.reviewedCount} 议程 已裁决
            </span>
          )}
          {/* 仅在没有待裁决时,显示通用 "打开控制台" 链 (避免与 立即裁决 按钮抢眼) */}
          {!(autoMeetingInfo && autoMeetingInfo.pendingReviewCount > 0) && (
            <Link
              href={`/meeting/${meetingId}/orchestrate`}
              className="ml-auto rounded-md bg-amber-500 px-3 py-1 text-amber-950 hover:bg-amber-400"
            >
              打开 Orchestrate 控制台 →
            </Link>
          )}
        </div>
      )}

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

      {/* v26.10-Room Phase 1.2: AI 邀请条 已挪到顶部画廊, 这里 只留按钮 */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
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
        {phase === "ended" ? (
          <SummaryCard
            meetingId={meetingId}
            refreshKey={summaryRefreshKey}
            onStatusChange={(s) => {
              // v25.20: regenerate task 跑时,SummaryCard polling 拿到
              // ready/failed/skipped 即为完成 — 通知进度条跳到 100%.
              setUpstreamTask((t) => {
                if (!t || t.kind !== "regenerate" || t.completed) return t;
                if (s === "ready") return { ...t, completed: true };
                if (s === "failed" || s === "skipped") {
                  return { ...t, failed: s === "failed" ? "LLM 调用失败" : "实录过短,跳过" };
                }
                return t;
              });
            }}
          />
        ) : null}
        {phase === "ended" ? <ActionItemsCard meetingId={meetingId} /> : null}
      </div>

      {/* v25.12-#2: 实录 tab(默认) — 所有 live/idle 期内容 */}
      <div style={{ display: viewTab === "live" ? "block" : "none" }}>

      {/* v25.19 #1 + v25.20: 上游处理工具栏 — phase=ended 时显示.
          v25.20:加进度条 + 帮助面板,让用户知道任务时长 + 何时该用. */}
      {phase === "ended" ? (
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="shrink-0 text-zinc-400">🛠️ 实录处理工具:</span>
            <button
              disabled={!!upstreamTask && !upstreamTask.completed}
              onClick={async () => {
                startUpstreamTask(
                  "regenerate",
                  "🔄 重生成纪要",
                  "LLM (qwen-max) 用反幻觉 prompt 从实录重写纪要 + 重抽行动项 + 长记忆.不改实录文字.",
                  25_000,
                );
                try {
                  await api.regenerateMeetingSummary(meetingId);
                  // 让 SummaryCard 重启 polling — 否则停在 ready 看不到
                  setSummaryRefreshKey((k) => k + 1);
                } catch (e) {
                  setUpstreamTask((t) =>
                    t
                      ? { ...t, failed: e instanceof Error ? e.message : "触发失败" }
                      : t,
                  );
                  toast.error(e instanceof Error ? e.message : "重生成失败");
                }
              }}
              className="rounded-md bg-accent-500/15 px-2.5 py-1 font-medium text-accent-300 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              title="不改实录,只重跑 LLM 生成纪要(qwen-max + 反幻觉 prompt).预计 ~25 秒."
            >
              🔄 重生成纪要
            </button>
            <button
              disabled={!!upstreamTask && !upstreamTask.completed}
              onClick={async () => {
                startUpstreamTask(
                  "rerun-identify",
                  "🔄 重新识别声纹",
                  "重跑 pyannote 切片对齐 + 邻域平滑.基于已录的声纹库重新分配说话人.约 30 秒.",
                  30_000,
                );
                try {
                  const r = await api.rerunIdentify(meetingId);
                  // identify 是同步返回 — 后端返回了就算完成
                  setUpstreamTask((t) => (t ? { ...t, completed: true } : t));
                  toast.success(r.note);
                } catch (e) {
                  setUpstreamTask((t) =>
                    t
                      ? { ...t, failed: e instanceof Error ? e.message : "重识别失败" }
                      : t,
                  );
                  toast.error(e instanceof Error ? e.message : "重识别失败");
                }
              }}
              className="rounded-md bg-amber-500/15 px-2.5 py-1 font-medium text-amber-300 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              title="重跑 pyannote 声纹识别 + 邻域平滑.预计 ~30 秒."
            >
              🔄 重新识别声纹
            </button>
            <button
              disabled={!!upstreamTask && !upstreamTask.completed}
              onClick={async () => {
                if (
                  !confirm(
                    "高清重跑会:\n" +
                      "  1) 用 paraformer-v2 离线高清模型重新转录(2-5 分钟)\n" +
                      "  2) 替换原实录\n" +
                      "  3) 重跑 identify + cleaner + summary\n\n" +
                      "确定继续?",
                  )
                )
                  return;
                startUpstreamTask(
                  "offline-asr",
                  "🎯 高清重跑 ASR",
                  "paraformer-v2 离线模型重新转录全场录音(精度比 realtime 高 20-30%),完后 chain 触发 identify+cleaner+summary.",
                  180_000,
                );
                try {
                  const r = await api.rerunOfflineAsr(meetingId);
                  // ASR 是异步 — 触发成功不代表完成,继续按 timer 走
                  toast.success(`✅ 已提交:${r.next_step}(${r.sentences} 句)`);
                } catch (e) {
                  setUpstreamTask((t) =>
                    t
                      ? { ...t, failed: e instanceof Error ? e.message : "高清重跑失败" }
                      : t,
                  );
                  toast.error(e instanceof Error ? e.message : "高清重跑失败");
                }
              }}
              className="rounded-md bg-orange-500/15 px-2.5 py-1 font-medium text-orange-300 hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              title="离线 paraformer-v2 全量重跑.预计 2-5 分钟."
            >
              🎯 高清重跑 ASR
            </button>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className={
                "ml-auto rounded-md px-2 py-1 text-zinc-500 hover:text-zinc-200 " +
                (showHelp ? "bg-ink-800 text-zinc-200" : "")
              }
              title="这 3 个按钮分别什么情况下点?"
            >
              ❓ 何时用
            </button>
          </div>

          {/* v25.20 帮助面板 — 点 ❓ 何时用 弹出 */}
          {showHelp && (
            <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-[12px] leading-relaxed text-zinc-300">
              <div className="mb-2 text-zinc-500">
                这 3 个按钮 处理顺序:实录 → 说话人 → 纪要。改下游不影响上游。
              </div>
              <ul className="space-y-2">
                <li>
                  <span className="font-medium text-orange-300">🎯 高清重跑 ASR</span>{" "}
                  <span className="text-zinc-500">(最重,2-5 分钟)</span>
                  <div className="mt-0.5 text-zinc-400">
                    实录里出现 <b>大段错字 / 漏字 / 专业术语识别歪</b>。原因:开会时用的是
                    realtime 流式 ASR,牺牲了精度换实时性。这个按钮用离线 paraformer-v2 全量重跑,
                    精度高 20-30%,完后会自动连锁触发 重识别声纹 + 重生成纪要。
                    <br />
                    <span className="text-amber-300">⚠️ 会替换全部实录</span> — 你的手动纠正会丢。
                  </div>
                </li>
                <li>
                  <span className="font-medium text-amber-300">🔄 重新识别声纹</span>{" "}
                  <span className="text-zinc-500">(~30 秒)</span>
                  <div className="mt-0.5 text-zinc-400">
                    实录文字 OK,但 <b>说话人名字 错很多 / 大量 [?]未识别</b>。可能原因:
                    <br />
                    &nbsp;• 缺席成员开会后补录了声纹 — 点这个把他认出来
                    <br />
                    &nbsp;• 你刚调了识别阈值或者改了声纹库
                    <br />
                    &nbsp;• 声纹数据老旧 — 想用最新的算法重跑一次
                    <br />
                    若只是几句错,先用 ✏️ <b>批量纠正(+5 / +10)</b> 更快,这个按钮是大改用的。
                  </div>
                </li>
                <li>
                  <span className="font-medium text-accent-300">🔄 重生成纪要</span>{" "}
                  <span className="text-zinc-500">(~25 秒)</span>
                  <div className="mt-0.5 text-zinc-400">
                    实录 + 说话人 都 OK,只想 <b>重写纪要 + 行动项</b>。常见场景:
                    <br />
                    &nbsp;• 上次纪要看着 hallucinate(瞎编日期/任务) — 用新 prompt 重抽
                    <br />
                    &nbsp;• 你刚改了几个说话人 — 让纪要按新归属重写
                    <br />
                    &nbsp;• 上次失败 / 跳过(实录太短) → 加完手动实录后再试一次
                    <br />
                    它链式触发 LLM 纪要 + 行动项抽取(带 evidence 锚点)+ 长期记忆。
                  </div>
                </li>
              </ul>
            </div>
          )}

          {/* v25.20 进度条 — task 跑时显示 */}
          {upstreamTask && (
            <div
              className={
                "mt-3 rounded-lg border p-3 transition " +
                (upstreamTask.failed
                  ? "border-rose-500/40 bg-rose-500/5"
                  : upstreamTask.completed
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5")
              }
            >
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    "font-medium " +
                    (upstreamTask.failed
                      ? "text-rose-300"
                      : upstreamTask.completed
                      ? "text-emerald-300"
                      : "text-amber-300")
                  }
                >
                  {upstreamTask.failed
                    ? `❌ ${upstreamTask.label} 失败`
                    : upstreamTask.completed
                    ? `✅ ${upstreamTask.label} 完成`
                    : `${upstreamTask.label} 进行中…`}
                </span>
                <button
                  onClick={() => setUpstreamTask(null)}
                  className="text-zinc-500 hover:text-zinc-200"
                  title="收起"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className={
                    "h-full rounded-full transition-all duration-500 " +
                    (upstreamTask.failed
                      ? "bg-rose-400"
                      : upstreamTask.completed
                      ? "bg-emerald-400"
                      : "bg-amber-400")
                  }
                  style={{ width: `${upstreamProgress}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-zinc-500">
                  {upstreamTask.failed
                    ? upstreamTask.failed
                    : `已用 ${upstreamElapsedSec} 秒 / 预计 ${Math.ceil(upstreamTask.expectedMs / 1000)} 秒`}
                </span>
                <span className="text-zinc-500">{Math.round(upstreamProgress)}%</span>
              </div>
              <div className="mt-1 text-[10px] text-zinc-600">{upstreamTask.description}</div>
              {!upstreamTask.completed &&
                !upstreamTask.failed &&
                upstreamProgress >= 95 && (
                  <div className="mt-2 rounded-md bg-ink-950/60 px-2 py-1.5 text-[11px] text-amber-200">
                    💡 估算时间到了,任务可能 还在跑(尤其 LLM 慢时).可以
                    <button
                      onClick={() => {
                        if (upstreamTask.kind === "regenerate" || upstreamTask.kind === "offline-asr") {
                          setViewTab("minutes");
                        }
                      }}
                      className="mx-1 underline underline-offset-2 hover:text-amber-100"
                    >
                      切到「纪要+行动项」tab
                    </button>
                    或刷新页面 看最新结果.
                  </div>
                )}
            </div>
          )}
        </div>
      ) : null}

      {/* v25.21: 锚点 banner — 从 任务详情 / 行动项 跳过来时显示,
          告诉用户 "你看的实录已经定位到 N 句锚点,前后 ±2 是上下文". */}
      {focusIds.size > 0 ? (
        <div className="mt-4 rounded-lg border-l-4 border-amber-400 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📍</span>
              <span>
                你从【任务详情 / 行动项】跳过来 — 已为你定位 实录中{" "}
                <strong className="text-amber-300">{focusIds.size} 句</strong>{" "}
                AI 抽这条待办时引用的真人对话,
                <span className="text-amber-300">琥珀色高亮</span>
                就是锚点;前后 ±2 句作为
                <span className="text-amber-200/70">上下文浅色提示</span>.
              </span>
            </div>
            <button
              onClick={scrollFocusIntoCenter}
              className="shrink-0 rounded-md bg-amber-500/25 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/35"
              title="如果滚开了,点这里把锚点 再次居中到视口"
            >
              📌 重新居中
            </button>
          </div>
        </div>
      ) : null}

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

      {/* v26.10-Room Phase 1.1: 老 邀请 AI 专家 block 已 上移到 按钮行,这里移除 */}

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
                  {userLines.map((l) => {
                    if (l.kind !== "user") return null;
                    // v25.19 #3d + v25.21: 实录锚点 + 上下文 高亮
                    const isFocused =
                      l.serverLineId != null && focusIds.has(l.serverLineId);
                    const isContext =
                      !isFocused &&
                      l.serverLineId != null &&
                      contextLineIds.has(l.serverLineId);
                    return (
                      <li
                        key={l.id}
                        id={
                          l.serverLineId != null
                            ? `focus-line-${l.serverLineId}`
                            : undefined
                        }
                        className={[
                          l.final
                            ? "text-base leading-relaxed text-zinc-100"
                            : "text-base leading-relaxed text-zinc-400",
                          // v25.21 锚点 — 加深背景 + 圆角 + 阴影发光 + ring 强调
                          isFocused
                            ? "relative rounded-lg border-l-4 border-amber-400 bg-amber-500/20 px-3 py-1.5 -mx-2 shadow-md shadow-amber-500/20 ring-1 ring-amber-400/40 transition-colors"
                            : "",
                          // v25.21 上下文 ±2 句 — 浅琥珀 + 左边窄条提示
                          isContext
                            ? "rounded-md border-l-2 border-amber-500/30 bg-amber-500/5 px-3 py-1 -mx-2"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {isFocused && (
                          <span
                            className="absolute -left-3 top-1/2 -translate-y-1/2 select-none text-amber-400"
                            title="AI 抽待办时引用的锚点"
                          >
                            📍
                          </span>
                        )}
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
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 右:AI 专家发言(倒序最新在上)— md+ 占 2/5 */}
            {/* v26.10-Room Phase 2: 第一条 (最新) 用 大焦点卡片, 历史紧凑列表 */}
            <div
              data-testid="agent-panel"
              className="md:col-span-2 h-[55vh] overflow-y-auto rounded-xl border border-violet-500/30 bg-ink-900 p-5"
            >
              <div className="mb-3 flex items-center justify-between border-b border-violet-500/20 pb-2">
                <h2 className="text-sm font-medium text-violet-200">
                  🤖 AI 专家发言
                  {agentLines.some((l) => l.kind === "agent" && !l.done) && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      生成中
                    </span>
                  )}
                </h2>
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
                  {agentLines.map((l, idx) =>
                    l.kind === "agent" ? (
                      <AgentMessageItem
                        key={l.id}
                        line={l}
                        isFocus={idx === 0}
                        agents={agents}
                      />
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

        {/* v26.10-Room Phase 3: 右栏 — 真实数据 (提醒 / AI 建议 / 任务 / 统计) */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900/30 px-3 py-4 xl:block">
          <MeetingRoomRightPanel
            phase={phase}
            moderator={moderator}
            recommendation={recommendation}
            dissent={dissent}
            lines={lines}
            agents={agents}
            meetingMeta={meetingMeta}
            onInvokeAgent={(agentId) => {
              const a = agents.find((x) => x.id === agentId);
              if (a) invokeAgent(a);
            }}
            onDismissModerator={() => setModerator(null)}
            onDismissRecommendation={() => setRecommendation(null)}
          />
        </aside>
      </div>
    </div>
  );
}

// v26.10-Room Phase 1.2: AI 专家画廊 — 200x200 大头像 + 名字 上下结构 + 横向滚动
// 占据中栏顶部 红框区域 (会议元信息 右侧 大片空白).
function MeetingAgentGallery({
  invitedAgents,
  phase,
  busyAgents,
  onInvoke,
}: {
  invitedAgents: Agent[];
  phase: "idle" | "live" | "ended";
  busyAgents: Set<string>;
  onInvoke: (a: Agent) => void;
}) {
  if (invitedAgents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/30 p-6 text-center">
        <p className="text-xs text-zinc-500">
          这场会议 没邀请 AI 专家 — 创建会议时勾选 AI 专家, 它们 就会出现 在这里.
        </p>
        <Link
          href="/me/profile/agents"
          className="mt-2 inline-block text-xs text-accent-400 hover:text-accent-500"
        >
          + 管理 AI 专家
        </Link>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          🤖 参会 AI 专家 · {invitedAgents.length}
        </div>
        {phase !== "live" && (
          <span className="text-[10px] text-zinc-600">
            开始会议后 点头像让 AI 发言
          </span>
        )}
      </div>
      {/* 横向滚动容器 — 多了自动滑动. 卡片 ~80x90 (50x50 头像 + 名字 + 领域) */}
      <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto pb-1 pl-1">
        {invitedAgents.map((a) => {
          const busy = busyAgents.has(a.id);
          const enabled = phase === "live" && !busy;
          const color = tailwindColor(a.color ?? "violet");
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onInvoke(a)}
              disabled={!enabled}
              title={
                phase !== "live"
                  ? `开始会议后, 点头像让「${a.name}」基于讨论发言`
                  : busy
                  ? `${a.name} 正在发言…`
                  : `点击让「${a.name}」基于讨论发言`
              }
              className={`group flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 transition ${
                enabled
                  ? "border-transparent hover:border-white/20 hover:bg-ink-900/50"
                  : busy
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-transparent opacity-60 cursor-not-allowed"
              }`}
            >
              {/* 头像 50x50 */}
              <div
                className="relative overflow-hidden rounded-full"
                style={{
                  width: 50,
                  height: 50,
                  boxShadow: busy
                    ? `0 0 0 2px ${color}, 0 0 8px ${color}80`
                    : `0 0 0 1.5px ${color}40`,
                  background: `linear-gradient(135deg, ${color}30, ${color}10)`,
                }}
              >
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatar_url}
                    alt={a.name}
                    width={50}
                    height={50}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div
                    className="grid h-full w-full place-items-center text-base font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {a.name.slice(0, 1)}
                  </div>
                )}
                {/* 思考/发言中 — 右下角 pulse 圆点 */}
                {busy && (
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <span
                      className="inline-block h-2 w-2 animate-pulse rounded-full ring-1 ring-ink-950"
                      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
                    />
                  </div>
                )}
              </div>
              {/* 名字 + 领域 */}
              <div className="text-center" style={{ maxWidth: 80 }}>
                <div className="truncate text-[11px] font-medium text-zinc-100">
                  {a.name}
                </div>
                {a.domain && !busy && (
                  <div className="truncate text-[9px] text-zinc-500">
                    {a.domain}
                  </div>
                )}
                {busy && (
                  <div className="text-[9px] text-emerald-300">
                    💬 发言中
                  </div>
                )}
              </div>
            </button>
          );
        })}
        <Link
          href="/me/profile/agents"
          className="grid shrink-0 place-items-center self-stretch rounded-lg border border-dashed border-ink-700 px-2 text-[10px] text-zinc-500 hover:border-accent-500/50 hover:text-accent-400"
          title="管理 AI 专家"
        >
          <span>+ 管理</span>
        </Link>
      </div>
    </div>
  );
}

// v26.10-Room Phase 2: AI 发言条目 — 第一条 (isFocus) 用大焦点卡片样式
// 历史紧凑列表. 含 v26.9-Avatar 真实头像 + 引用 citations.
function AgentMessageItem({
  line: l,
  isFocus,
  agents,
}: {
  line: LiveLine & { kind: "agent" };
  isFocus: boolean;
  agents: Agent[];
}) {
  const ag = agents.find((x) => x.id === l.agentId);
  const avatarUrl = ag?.avatar_url;
  const color = tailwindColor(l.agentColor);
  // 焦点卡片 = 大 + 边框颜色 + 渐变背景 (含正在生成时 ring 动画)
  if (isFocus) {
    return (
      <li
        className="relative rounded-xl border-2 p-4 text-sm leading-relaxed shadow-lg transition"
        style={{
          borderColor: color,
          background: `linear-gradient(135deg, ${color}10, ${color}05)`,
          animation: !l.done ? "focusGlow 2s ease-in-out infinite" : undefined,
        }}
        data-testid="agent-focus-card"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2.5">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={l.agentName}
                className="h-10 w-10 rounded-full border-2 object-cover"
                style={{ borderColor: color }}
              />
            ) : (
              <span
                className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {l.agentName.slice(0, 1)}
              </span>
            )}
            <span className="flex flex-col">
              <span
                className="text-sm font-semibold"
                style={{ color }}
              >
                {l.agentName}
              </span>
              <span className="text-[10px] text-zinc-500">
                {l.done ? "已发言" : "正在发言…"}
              </span>
            </span>
          </span>
          {!l.done && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              生成中
            </span>
          )}
        </div>
        <div className="text-base text-zinc-100 whitespace-pre-wrap leading-relaxed">
          {l.text}
          {!l.done ? <span className="ml-1 animate-pulse">▌</span> : null}
        </div>
        {l.done && l.citations && l.citations.length > 0 && (
          <div
            className="mt-3 flex flex-wrap gap-1 border-t pt-2"
            style={{ borderColor: `${color}30` }}
            data-testid="agent-citations"
          >
            <span className="text-[10px] text-zinc-500">📚 引用</span>
            {l.citations.map((c, i) => (
              <span
                key={c.chunk_id}
                title={`${c.snippet}${c.snippet.length >= 240 ? "…" : ""}\n\n相关度: ${(1 - c.distance).toFixed(2)}`}
                className="cursor-help rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-violet-500/40 hover:text-violet-200"
              >
                [{i + 1}]{" "}
                {c.document_filename.length > 24
                  ? c.document_filename.slice(0, 22) + "…"
                  : c.document_filename}
              </span>
            ))}
          </div>
        )}
      </li>
    );
  }
  // 历史 紧凑卡片 (老样式 略缩)
  return (
    <li
      className="rounded-lg border border-ink-700 bg-ink-950 p-2.5 text-xs leading-relaxed opacity-90"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div
        className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wider"
        style={{ color }}
      >
        <span className="flex items-center gap-1.5">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={l.agentName}
              className="h-5 w-5 rounded-full border object-cover"
              style={{ borderColor: color }}
            />
          ) : (
            <span className="text-sm" aria-hidden>🤖</span>
          )}
          <span>{l.agentName}</span>
        </span>
      </div>
      <div className="text-zinc-200 whitespace-pre-wrap line-clamp-3">
        {l.text}
      </div>
      {l.done && l.citations && l.citations.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="text-[9px] text-zinc-500">📚</span>
          {l.citations.slice(0, 3).map((c, i) => (
            <span
              key={c.chunk_id}
              title={c.snippet}
              className="cursor-help rounded-full border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[9px] text-zinc-500"
            >
              [{i + 1}]
            </span>
          ))}
          {l.citations.length > 3 && (
            <span className="text-[9px] text-zinc-600">
              +{l.citations.length - 3}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// v26.10-Room Phase 3: 右栏 — 真实数据展示 (提醒 / 建议 / 任务 / 统计)
function MeetingRoomRightPanel({
  phase,
  moderator,
  recommendation,
  dissent,
  lines,
  agents,
  meetingMeta,
  onInvokeAgent,
  onDismissModerator,
  onDismissRecommendation,
}: {
  phase: "idle" | "live" | "ended";
  moderator: {
    kind: "off_topic" | "time_warning" | "stuck";
    title: string;
    body: string;
    agent_id: string;
    agent_name: string;
    agent_color: string;
    invoke_query: string;
    auto_summon_at_ms: number | null;
  } | null;
  recommendation: {
    agent_id: string;
    agent_name: string;
    agent_color: string;
    reason: string;
  } | null;
  dissent: {
    topic: string;
    parties: string[];
    agent_id: string;
    agent_name: string;
    agent_color: string;
    reason: string;
  } | null;
  lines: LiveLine[];
  agents: Agent[];
  meetingMeta: {
    title: string;
    status: string;
    agenda: AgendaItem[] | null;
    attendee_agent_ids: string[];
    mode?: "human" | "hybrid" | "auto";
  } | null;
  onInvokeAgent: (agentId: string) => void;
  onDismissModerator: () => void;
  onDismissRecommendation: () => void;
}) {
  // v26.10-Room Phase 3: 实时统计 (从 lines 计算)
  const userLines = lines.filter((l) => l.kind === "user");
  const agentLines = lines.filter((l) => l.kind === "agent");
  const speakingAgentIds = new Set(
    agentLines.filter((l) => !l.done).map((l) => l.agentId),
  );
  // 议程信息
  const agenda = meetingMeta?.agenda ?? null;
  const currentAgendaTitle =
    moderator?.kind === "off_topic" || moderator?.kind === "time_warning"
      ? null
      : agenda?.[0]?.title;
  // 任务速览 — 暂时 从 lines 里 简单 抽取 (Phase 3+: 接 真实 action_items endpoint)
  // 这里 用 简单启发: 含 "@" 提及 或 "任务" 关键词 的 实录句
  const taskHints = userLines
    .filter((l) => l.text && (l.text.includes("@") || /任务|工单|跟进|落实/.test(l.text)))
    .slice(-3);

  return (
    <div className="space-y-4">
      {/* 主持人提醒 (高优先级, 进行中才显示) */}
      {phase === "live" && moderator && (
        <ReminderCard
          icon={
            moderator.kind === "off_topic"
              ? "🎯"
              : moderator.kind === "time_warning"
              ? "⏱"
              : "😴"
          }
          tone="amber"
          title={moderator.title}
          body={moderator.body}
          onDismiss={onDismissModerator}
          actionLabel="召唤主持人 →"
          onAction={() => {
            onInvokeAgent(moderator.agent_id);
            onDismissModerator();
          }}
        />
      )}

      {/* 共识分歧提醒 */}
      {phase === "live" && dissent && (
        <ReminderCard
          icon="⚖️"
          tone="rose"
          title={`检测到分歧 · ${dissent.topic}`}
          body={dissent.reason}
        />
      )}

      {/* AI 建议 */}
      {phase === "live" && recommendation && (
        <ReminderCard
          icon="💡"
          tone="violet"
          title={`建议召唤 ${recommendation.agent_name}`}
          body={recommendation.reason}
          onDismiss={onDismissRecommendation}
          actionLabel={`召唤 ${recommendation.agent_name} →`}
          onAction={() => {
            onInvokeAgent(recommendation.agent_id);
            onDismissRecommendation();
          }}
        />
      )}

      {/* 议程进度 */}
      {agenda && agenda.length > 0 && (
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            📋 议程 · {agenda.length} 项
          </div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {agenda.map((item, i) => (
              <li
                key={i}
                className={`flex items-start gap-2 rounded px-2 py-1 ${
                  i === 0 && phase === "live"
                    ? "bg-accent-500/10 text-accent-200"
                    : "text-zinc-400"
                }`}
              >
                <span className="mt-0.5 text-[10px] text-zinc-500">
                  {i + 1}.
                </span>
                <span className="flex-1 truncate">{item.title}</span>
                {item.time_budget_min && (
                  <span className="text-[10px] text-zinc-600">
                    {item.time_budget_min}分
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 任务速览 (Phase 3 简版, 未来 接 真实 action_items endpoint) */}
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            📌 任务与工单
          </div>
          <span className="text-[10px] text-zinc-600">
            {taskHints.length === 0 ? "暂无" : `${taskHints.length} 条`}
          </span>
        </div>
        {taskHints.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-600">
            会议结束 AI 自动提取行动项. 或会议中 说 "@xx 跟进" 触发.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {taskHints.map((l) => (
              <li
                key={l.id}
                className="rounded border border-ink-700 bg-ink-950 p-2 text-[11px] text-zinc-300"
              >
                <div className="line-clamp-2">{l.text}</div>
                <div className="mt-0.5 text-[9px] text-zinc-600">
                  {l.speakerName || "未识别"} ·{" "}
                  {l.startMs != null
                    ? `${Math.floor(l.startMs / 60000)}:${String(Math.floor((l.startMs % 60000) / 1000)).padStart(2, "0")}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 会议统计 */}
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          📊 会议统计
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <StatItem label="发言句数" value={userLines.length} />
          <StatItem label="AI 参与" value={agentLines.length} />
          <StatItem
            label="正在说"
            value={speakingAgentIds.size}
            highlight={speakingAgentIds.size > 0}
          />
          <StatItem label="参会 AI" value={agents.length} />
        </dl>
      </section>

      {/* 引导文字 (空状态) */}
      {phase === "idle" && (
        <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/30 p-3 text-[11px] text-zinc-600">
          <p>会议未开始. 提醒 / 任务 / 建议 将在 进行中 实时弹出.</p>
        </div>
      )}
    </div>
  );
}

function ReminderCard({
  icon,
  tone,
  title,
  body,
  onDismiss,
  actionLabel,
  onAction,
}: {
  icon: string;
  tone: "amber" | "rose" | "violet" | "blue";
  title: string;
  body: string;
  onDismiss?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const cls = {
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-100",
    rose: "border-rose-500/40 bg-rose-500/5 text-rose-100",
    violet: "border-violet-500/40 bg-violet-500/5 text-violet-100",
    blue: "border-sky-500/40 bg-sky-500/5 text-sky-100",
  }[tone];
  const dotCls = {
    amber: "bg-amber-400",
    rose: "bg-rose-400",
    violet: "bg-violet-400",
    blue: "bg-sky-400",
  }[tone];
  return (
    <section
      className={`rounded-xl border p-3 ${cls}`}
      style={{ animation: "slideInRight 0.3s ease-out" }}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full ${dotCls}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {icon} {title}
            </span>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="shrink-0 text-xs opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] opacity-80">{body}</p>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mt-2 rounded-md bg-white/10 px-2.5 py-1 text-[11px] hover:bg-white/20"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded border bg-ink-950/60 p-2 ${
        highlight ? "border-emerald-500/40" : "border-ink-700"
      }`}
    >
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 font-mono text-base ${
          highlight ? "text-emerald-300animate-pulse" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// v26.10-Room Phase 1: 顶部条 — 标题 + 状态徽章 + 计时 + 模式提示 + 返回链接
function MeetingRoomTopBar({
  title,
  mode,
  phase,
  statusText,
  meetingId,
  invitedAgentCount,
}: {
  title?: string;
  mode?: string;
  phase: "idle" | "live" | "ended";
  statusText: string;
  meetingId: string;
  invitedAgentCount: number;
}) {
  // 计时器 (会议开始后累加)
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  useEffect(() => {
    if (phase !== "live") return;
    const start = Date.now() - elapsedMs;
    const t = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const fmtElapsed = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    if (h > 0) {
      return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const statusColor =
    phase === "live"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : phase === "ended"
        ? "bg-zinc-700/30 text-zinc-400 border-zinc-700"
        : "bg-zinc-700/30 text-zinc-400 border-zinc-700";
  const statusLabel =
    phase === "live"
      ? "🟢 实时会议中"
      : phase === "ended"
        ? "⚫ 已结束"
        : "⚪ 待开始";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900/60 px-4 backdrop-blur">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/"
          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200"
          title="返回首页"
        >
          ← 首页
        </Link>
        <span className="shrink-0 text-zinc-700">·</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              会议室
            </span>
            {mode === "auto" && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                AI 自主
              </span>
            )}
          </div>
          <h1 className="truncate text-sm font-medium text-white">
            {title || "正在加载…"}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusColor}`}
          title={statusText}
        >
          {phase === "live" && (
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          )}
          {statusLabel}
          {phase === "live" && (
            <span className="font-mono tabular-nums">
              · {fmtElapsed(elapsedMs)}
            </span>
          )}
        </span>
        {invitedAgentCount > 0 && (
          <span className="hidden rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-300 sm:inline-flex">
            🤖 {invitedAgentCount} AI 专家
          </span>
        )}
        {mode === "auto" && (
          <Link
            href={`/meeting/${meetingId}/orchestrate`}
            className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/25"
          >
            ⚖️ Orchestrate
          </Link>
        )}
      </div>
    </header>
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
