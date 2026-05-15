"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
      /** v26.12-Home: 拟人外号 (可空). bubble 渲染 时 nickname 主 + name 副. */
      agentNickname: string | null;
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
  const router = useRouter();
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
    created_by_user_id?: string | null;   // v26.14-P5.2
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
    agent_nickname?: string | null;  // v26.12-Home: banner 优先 显 nickname
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
    agent_nickname?: string | null;  // v26.12-Home
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
    kind: "off_topic" | "time_warning" | "stuck" | "advance_suggested";
    // v26.14-P4.3: off_topic 的 三档 严重度 — 仅 kind=off_topic 有效, 其他 kind 留 undefined.
    //   suspected: 角落 轻提示, 不打断
    //   confirmed: 中等 banner (老 默认)
    //   severe:    全屏 modal + auto_summon 倒计时
    severity?: "suspected" | "confirmed" | "severe";
    title: string;
    body: string;
    agent_id: string;
    agent_name: string;
    agent_nickname?: string | null;  // v26.12-Home
    agent_color: string;
    invoke_query: string;
    auto_summon_at_ms: number | null;
  } | null>(null);
  const moderatorTimerRef = useRef<number | null>(null);
  // v26.14-P4.3: 偏题 历史 — 抽屉 里 列 本场 所有 off_topic 事件 (含 已 dismissed 的).
  // 让 用户 知道 "AI 监测 在 工作" + 过去 几次 提醒 啥 内容.
  const [topicHistory, setTopicHistory] = useState<
    Array<{
      ts: number;
      severity: "suspected" | "confirmed" | "severe";
      summary: string;
      current_agenda_item: string | null;
      suggested_agenda_item: string | null;
    }>
  >([]);
  // Live countdown display for stuck banners. Refreshed via interval so the
  // banner shows "5 → 4 → 3 → 2 → 1" without re-rendering the parent on
  // every tick (we only re-render this small piece). null = no countdown.
  const [moderatorCountdown, setModeratorCountdown] = useState<number | null>(null);
  const moderatorCountdownIntervalRef = useRef<number | null>(null);
  const moderatorAutoFireTimeoutRef = useRef<number | null>(null);
  // v26.11-fix2: 邀请 AI 弹窗 开关 — 点 "+ 邀请 AI" 按钮 → 打开 InviteAgentsModal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  // v26.14-P4.1-fix: 离开 会议室 二选一 modal — "回到工作台 / 结束整场"
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  // v26.14-P5.2: 议程 进度 — 老 是 read-only strip; 现 升级 到 进度条 + 推进
  const [agendaProgress, setAgendaProgress] = useState<
    import("@/lib/api").AgendaProgress | null
  >(null);
  const [advancing, setAdvancing] = useState(false);

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
    if (e.type === "agents_invited") {
      // v26.11-fix2: 有人 邀请 了 新 AI — 更新 meetingMeta.attendee_agent_ids
      // 触发 AI 画廊 重渲染. 同时 拉 listAgents 兜底 (新 agent 可能 之前
      // 没在 agents state 里, 比如 上次进会议 后 workspace 新建了 一个).
      setMeetingMeta((prev) =>
        prev
          ? { ...prev, attendee_agent_ids: e.attendee_agent_ids }
          : prev,
      );
      api.listAgents().then(
        (rows) => setAgents(rows.filter((a) => a.is_active)),
        () => {},
      );
      if (e.agent_ids.length > 0) {
        toast.info(`已邀请 ${e.agent_ids.length} 位 AI 加入会议`);
      }
      return;
    }
    if (e.type === "agenda_advanced") {
      // v26.14-P5.2: 议程 推进 — 全 房间 同步, 自己 advance 也 收 此 event.
      // 重新 拉 agenda-progress (含 各 项 时间戳) — 老 state 立刻 失效.
      api.getAgendaProgress(meetingId).then(
        (p) => setAgendaProgress(p),
        () => { /* silent */ },
      );
      // 提示 (自己 推进 + 别人 推进 都 显, 让 共识 可见)
      if (e.is_complete) {
        toast.info(`议程 已 全部 走完 (由 ${e.advanced_by_user_name} 推进)`);
      } else {
        toast.info(`议程 推进 到 第 ${e.to_idx + 1} 项 (由 ${e.advanced_by_user_name})`);
      }
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
        agent_nickname: e.agent_nickname ?? null,  // v26.12-Home
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
        agent_nickname: e.suggested_agent_nickname ?? null,  // v26.12-Home
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
      e.type === "agenda_stuck" ||
      e.type === "agenda_advance_suggested"
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
        // v26.14-P4.3: 根据 severity 分 三档 渲染.
        // 老 后端 不带 severity 时 兼容 视为 "confirmed" (中等强度).
        const severity = e.off_topic_severity ?? "confirmed";
        // 落 历史 — 任何 severity 都 入抽屉, 让 用户 看到 监测 在 工作
        setTopicHistory((prev) =>
          [
            {
              ts: Date.now(),
              severity,
              summary: e.off_topic_summary || e.reason,
              current_agenda_item: e.current_agenda_item,
              suggested_agenda_item: e.suggested_agenda_item,
            },
            ...prev,
          ].slice(0, 20),
        );
        // severe 严重时 加 自动 召唤 倒计时 (跟 stuck 同套), 但 走 off_topic 路径
        const severeAutoSummonAt =
          severity === "severe" && e.auto_summon_after_s
            ? Date.now() + Math.max(2, Math.min(15, e.auto_summon_after_s)) * 1000
            : null;
        setModerator({
          kind: "off_topic",
          severity,
          title: e.current_agenda_item
            ? `已偏离议程「${e.current_agenda_item}」`
            : "讨论已偏离议程",
          body: e.off_topic_summary || e.reason,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_nickname: e.moderator_agent_nickname ?? null,  // v26.12-Home
          agent_color: e.moderator_agent_color,
          invoke_query: `请你作为主持人,简短提醒大家回到议程项「${
            e.suggested_agenda_item ?? e.current_agenda_item ?? "原议题"
          }」。`,
          auto_summon_at_ms: severeAutoSummonAt,
        });
        // severe 时 启 倒计时 显示 (跟 stuck 同套机制)
        if (severeAutoSummonAt !== null) {
          const initialSec = Math.ceil((severeAutoSummonAt - Date.now()) / 1000);
          setModeratorCountdown(initialSec);
          moderatorCountdownIntervalRef.current = window.setInterval(() => {
            const remain = Math.ceil((severeAutoSummonAt - Date.now()) / 1000);
            setModeratorCountdown(remain > 0 ? remain : 0);
          }, 250);
        }
      } else if (e.type === "agenda_time_warning") {
        setModerator({
          kind: "time_warning",
          title: "议程时间预算告急",
          body: e.time_warning_text || `已开会 ${e.elapsed_min} 分钟,${e.reason}`,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_nickname: e.moderator_agent_nickname ?? null,  // v26.12-Home
          agent_color: e.moderator_agent_color,
          invoke_query:
            "请你作为主持人,提醒大家时间快到了,需要尽快推进或锁定结论。",
          auto_summon_at_ms: null,
        });
      } else if (e.type === "agenda_advance_suggested") {
        // v26.14-P5.3: LLM 觉得 当前 项 已 收口, 建议 推进 下一项. controller
        // 见 "立刻 推进" 按钮 走 acceptModerator (我们 把 invoke_query 替成 调
        // advance API — 但 acceptModerator 只调 invoke_agent. 为了 复用 现有
        // 渲染, 这里 反而 不让 acceptModerator 触发 advance — 让 用户 在 strip
        // 顶部 主动 点 "推进" 按钮. 这条 banner 仅 "知会 + 引导" 作用.)
        const cur = e.current_agenda_item;
        const nxt = e.next_agenda_item;
        const titleText = nxt
          ? `建议 推进 → 「${nxt}」`
          : "建议 推进 (无 下一项)";
        const bodyText = e.advance_reason
          || (cur ? `「${cur}」似已收口` : "当前 议程项 似已收口");
        setModerator({
          kind: "advance_suggested",
          title: titleText,
          body: bodyText,
          agent_id: e.moderator_agent_id,
          agent_name: e.moderator_agent_name,
          agent_nickname: e.moderator_agent_nickname ?? null,
          agent_color: e.moderator_agent_color,
          // invoke_query 用于 老 路径 "召唤 主持人" — 但 我们 advance banner 上
          // 的 立刻 推进 按钮 直接 调 advanceAgendaCb 不走 召唤. invoke_query
          // 留个 fallback 文案 (老 acceptModerator 在 advance kind 也 不会 调用).
          invoke_query: `请你作为主持人,提醒大家当前议程项${
            cur ? `「${cur}」` : ""
          }似乎已经收口,可以推进到下一项${nxt ? `「${nxt}」` : ""}了。`,
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
          agent_nickname: e.moderator_agent_nickname ?? null,  // v26.12-Home
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

      // v26.14-P5.3 auto-dismiss 策略 (扩展 P4.3):
      //   - suspected off_topic: 12s 自动消失 (轻提示)
      //   - advance_suggested: 60s 自动消失 (用户 可慢慢决定)
      //   - confirmed off_topic / time_warning: 90s 自动消失 (老默认)
      //   - severe off_topic: 不 自动 dismiss (auto_summon 接管)
      //   - stuck: 不 自动 dismiss (auto_summon 接管)
      const hasAutoFire =
        e.type === "agenda_stuck" ||
        (e.type === "agenda_off_topic" && e.off_topic_severity === "severe");
      if (!hasAutoFire) {
        let autoDismissMs = 90_000;
        if (e.type === "agenda_off_topic" && e.off_topic_severity === "suspected") {
          autoDismissMs = 12_000;
        } else if (e.type === "agenda_advance_suggested") {
          autoDismissMs = 60_000;
        }
        moderatorTimerRef.current = window.setTimeout(() => {
          setModerator(null);
        }, autoDismissMs);
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
          // v26.12-Home: 后端 push agent_nickname; 没传 fallback null
          agentNickname: e.agent_nickname ?? null,
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

  // v26.11-fix1: 重进 ongoing 会议 时,用户 手动 点 🎙️ 恢复录音 走这里.
  // start() 自带 idle 守卫 (不能 当 live → live 用), 所以 单独 一个 resume.
  // 逻辑 同 start() 第二段 (开 WS + 麦克风), 但 不 setPhase (已经 live 了).
  const resume = useCallback(async () => {
    if (phase !== "live") return;
    if (socketRef.current) return; // 已经 连着 — 不要 重连
    setStatusText("请求麦克风权限...");
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
    try {
      const cap = await startAudioCapture((frame) => sock!.send(frame));
      captureRef.current = cap;
      setStatusText("🎙️ 录音已恢复");
    } catch (err) {
      console.warn("audio capture failed on resume; entering text-only mode", err);
      const detail =
        err instanceof MicPermissionError
          ? err.message
          : err instanceof Error
          ? err.message
          : "启动麦克风失败";
      setStatusText("⌨️ 仅文字模式(麦克风未启用)");
      toast.warn("麦克风未启用,可在下方文字框打字录入", {
        detail,
        sticky: true,
      });
    }
  }, [phase, meetingId, handleEvent]);

  const stop = useCallback(async () => {
    setStatusText("会议已结束，正在做最后一次声纹识别…");
    setPhase("ended");
    setViewTab("minutes");  // v25.12-#2: 会议结束自动切到纪要 tab
    // v26.11-fix1: 显式 finalize — 通知 后端 把 meeting.status 设 finished.
    // 以前 依赖 WS close 自动 finished 是 bug (切页/网断 都会误判).
    api.finalizeMeeting(meetingId).catch((err) => {
      console.warn("finalizeMeeting failed", err);
    });
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
          created_by_user_id: m.created_by_user_id ?? null,
        });
        // v26.14-P5.2: 初次 拉 议程 进度 (静默 fallback — 老 会议 没 progress 也不挂)
        if (m.agenda && m.agenda.length > 0) {
          api.getAgendaProgress(meetingId).then(
            (p) => { if (alive) setAgendaProgress(p); },
            () => { /* silent — 老 会议 / 权限 问题 都 不打扰 */ },
          );
        }
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
        } else if (m.status === "ongoing") {
          // v26.11-fix1: 重进 "ongoing" 会议时,phase 直接进 live,
          // 拉历史 transcript 给用户看. 但 不 自动 重连 麦克风 — 用户必须
          // 手动点 "🎙️ 恢复录音" (避免 静默 把 麦克风 打开).
          setPhase("live");
          setStatusText("会议进行中,点击 🎙️ 恢复录音 继续");
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

  // v26.14-P5.2: 推进 议程 到 下一项 (按钮 仅 leader+ / 创建人 见)
  const advanceAgendaCb = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      const p = await api.advanceAgenda(meetingId);
      // 自己 这台 立刻 显, 别人 走 WS event 同步
      setAgendaProgress(p);
    } catch (err) {
      // api.ts 已 toast 错误 (含 rate-limit 429); 这里 静默
      void err;
    } finally {
      setAdvancing(false);
    }
  }, [advancing, meetingId]);
  // v26.14-P5.2: 跳到 任一 议程项 (用户 点 strip 上 别项)
  const jumpAgendaCb = useCallback(
    async (idx: number) => {
      if (advancing) return;
      setAdvancing(true);
      try {
        const p = await api.jumpAgenda(meetingId, idx);
        setAgendaProgress(p);
      } catch (err) {
        void err;
      } finally {
        setAdvancing(false);
      }
    },
    [advancing, meetingId],
  );

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
      {/* v26.10-Room Phase 1: 顶部条 — 标题 + 状态 + 计时 + 关闭
          v26.14-fix1: 控件行 (开始/结束/恢复/AI画廊/邀请) 合并到 顶部 chrome 第二排,
          中栏 顶部 那 ~80px 让出 给 主对话区. */}
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
        // v26.14-fix1: 控件行 props
        onStart={start}
        onStop={stop}
        onResume={resume}
        showResumeButton={phase === "live" && !socketRef.current}
        invitedAgents={(() => {
          const ids = new Set(meetingMeta?.attendee_agent_ids || []);
          return ids.size > 0 ? agents.filter((a) => ids.has(a.id)) : [];
        })()}
        busyAgents={busyAgents}
        onInvokeAgent={invokeAgent}
        onInviteClick={() => setInviteModalOpen(true)}
        // v26.14-P4.1: 倒计时 中央 — 计划总时 = sum(agenda.time_budget_min)
        plannedTotalMinutes={(() => {
          const items = meetingMeta?.agenda || [];
          let total = 0;
          for (const item of items) {
            if (typeof item.time_budget_min === "number" && item.time_budget_min > 0) {
              total += item.time_budget_min;
            }
          }
          return total > 0 ? total : null;
        })()}
        // v26.14-P4.1-fix: 替代 老 ← 首页 直跳
        onLeaveClick={() => setLeaveModalOpen(true)}
      />

      {/* v26.10-Room Phase 1: 三栏 grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* v26.10-Room P5.1: 左栏 — 实时转录 timeline (从中栏 移过来) */}
        <aside className="scrollbar-thin hidden w-80 shrink-0 flex-col border-r border-ink-800 bg-ink-900/30 lg:flex">
          <MeetingTranscriptSidebar
            lines={lines.filter((l) => l.kind === "user")}
            phase={phase}
            scrollRef={scrollRef}
            focusIds={focusIds}
            correctingLineId={correctingLineId}
            setCorrectingLineId={setCorrectingLineId}
            attendees={attendees}
            correctSpeaker={correctSpeaker}
            batchCorrectSpeaker={batchCorrectSpeaker}
            recommendation={recommendation}
            dissent={dissent}
          />
        </aside>

        {/* 中栏 — 现有 main 内容
            v26.14-fix1: 老 header (开始/结束/AI画廊/邀请) 已 全部 移到 顶部 chrome 第二排,
            中栏 顶部 现在 直接 接 内容, 多 ~80px 给 主对话区. */}
        <main className="flex-1 overflow-y-auto px-6 py-4 min-w-0">

      {/* v26.11-fix2: 邀请 AI 弹窗 — 多选 workspace 内 未邀请 的 AI →
          调 inviteMeetingAgents → 后端 写 MeetingAttendee + 广播.
          自己 也会 收到 agents_invited event → 关掉 modal + 刷 gallery. */}
      {inviteModalOpen && (
        <InviteAgentsModal
          meetingId={meetingId}
          allAgents={agents}
          invitedAgentIds={meetingMeta?.attendee_agent_ids || []}
          onClose={() => setInviteModalOpen(false)}
        />
      )}

      {/* v26.14-P4.1-fix: 离开 会议室 二选一 modal */}
      {leaveModalOpen && (
        <LeaveMeetingModal
          phase={phase}
          onClose={() => setLeaveModalOpen(false)}
          onLeaveContinue={async () => {
            // 回到工作台 — 关 自己的 录音 + WS, 不调 finalize.
            // 别 参会人 的 WS / 后端 状态 不动, 会议 仍 ongoing.
            try { await captureRef.current?.stop(); } catch {}
            captureRef.current = null;
            try { socketRef.current?.close(); } catch {}
            socketRef.current = null;
            setLeaveModalOpen(false);
            router.push("/");
          }}
          onLeaveEnd={async () => {
            // 结束 整场 会议 — 走 现有 stop() (调 finalize + 清 WS), 然后 跳走.
            try { await stop(); } catch {}
            setLeaveModalOpen(false);
            router.push("/");
          }}
        />
      )}

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

      {/* v26.10-Room P5.5: 老 状态指示 + [开始/结束] 按钮 全部 上移到 header 行,
          会议室/标题/计时/状态 全部 已在 顶部 chrome (MeetingRoomTopBar).
          这里 不再 重复展示, 节省 ~150px 纵向空间. */}

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
        {/* v26.14-P2: 顶部 "本场收获" panel — 让 用户 看到 这场 会 给 AI 留下 啥 */}
        {phase === "ended" ? <HarvestPanel meetingId={meetingId} /> : null}
        {/* v26.14-P5.4: 全景 时间线 — 议程 进度 + AI 事件 时序 合一 */}
        {phase === "ended" ? <MeetingTimelinePanel meetingId={meetingId} /> : null}
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
                {/* v26.12-Home: nickname 优先, fallback name */}
                {recommendation.agent_nickname?.trim() || recommendation.agent_name}
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
              请{recommendation.agent_nickname?.trim() || recommendation.agent_name}发言
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
              {/* v26.12-Home: nickname 优先 */}
              召唤{dissent.agent_nickname?.trim() || dissent.agent_name}
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

      {/* v26.14-P4.3: 三档 off_topic 提醒 — 跟 stuck / time_warning 共用 state.
            - severe (off_topic):    全屏 modal + 模糊背景 + 倒计时 (后面 JSX 单独 渲)
            - confirmed (off_topic): 中等 banner (老 默认 amber)
            - suspected (off_topic): 细窄 角落 toast, 没大 CTA, 12s 自走
            - stuck:                 orange + pulse + 倒计时 (老 默认)
            - time_warning:          中等 banner (老 默认 amber) */}
      {moderator && phase === "live" && !(moderator.kind === "off_topic" && moderator.severity === "severe") ? (
        moderator.kind === "advance_suggested" ? (
          // v26.14-P5.3: 推进 建议 banner — 主色 emerald (前进 感), 主 CTA "立刻 推进"
          // (仅 controller 见, 直接 调 advance API, 不走 召唤)
          <div
            data-testid="moderator-banner-advance_suggested"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2"
            style={{ borderLeftColor: tailwindColor(moderator.agent_color), borderLeftWidth: 3 }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
              <span className="text-base">🚀</span>
              <span className="min-w-0">
                <span className="font-medium text-emerald-200">{moderator.title}</span>
                <span className="mx-1 text-zinc-500">·</span>
                <span className="text-zinc-400">{moderator.body}</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(() => {
                // controller 才 见 "立刻 推进" 按钮
                const canControl =
                  !!me &&
                  (WRITE_ROLES.has(me.role) ||
                    (meetingMeta?.created_by_user_id &&
                      me.user_id === meetingMeta.created_by_user_id));
                if (!canControl) return null;
                return (
                  <button
                    data-testid="advance-suggested-accept"
                    onClick={async () => {
                      await advanceAgendaCb();
                      setModerator(null);
                    }}
                    disabled={advancing}
                    className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-medium text-white shadow transition disabled:opacity-50 hover:bg-emerald-400"
                  >
                    立刻 推进 →
                  </button>
                );
              })()}
              <button
                data-testid="moderator-dismiss"
                onClick={dismissModerator}
                className="text-xs text-zinc-500 hover:text-zinc-300"
                title="稍后 (60s 后 自动 消失)"
              >
                稍后
              </button>
            </div>
          </div>
        ) : moderator.kind === "off_topic" && moderator.severity === "suspected" ? (
          // 轻提示 — 细窄一行, 没大 CTA, 用户 可 直接 关
          <div
            data-testid="moderator-banner-off_topic-suspected"
            className="mt-3 flex items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2 text-zinc-400">
              <span>👀</span>
              <span className="truncate">
                <span className="text-zinc-300">可能 偏题:</span> {moderator.body}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={acceptModerator}
                disabled={busyAgents.has(moderator.agent_id)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
              >
                召唤 {moderator.agent_nickname?.trim() || moderator.agent_name}
              </button>
              <button
                data-testid="moderator-dismiss"
                onClick={dismissModerator}
                className="text-zinc-600 hover:text-zinc-300"
                title="忽略"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          // 中等 banner (confirmed off_topic / time_warning / stuck) — 老 渲染
          <div
            data-testid={`moderator-banner-${moderator.kind}`}
            className={
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
                {moderator.kind === "stuck"
                  ? "立刻召唤"
                  : `召唤${moderator.agent_nickname?.trim() || moderator.agent_name}`}
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
        )
      ) : null}

      {/* v26.14-P4.3: 严重偏题 全屏 modal — severity=severe 时 走 此路径,
            模糊背景 + 中央卡片 + 倒计时, 给 用户 强烈 阻断 感. */}
      {moderator && phase === "live" && moderator.kind === "off_topic" && moderator.severity === "severe" ? (
        <div
          data-testid="moderator-modal-severe"
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-md p-4 animate-[slideInDown_180ms_ease-out]"
        >
          <div
            className="w-full max-w-md rounded-2xl border-2 border-rose-500/60 bg-ink-900 p-5 shadow-[0_0_60px_rgba(244,63,94,0.3)]"
            style={{ borderLeftColor: tailwindColor(moderator.agent_color), borderLeftWidth: 4 }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="text-2xl">🚨</span>
              <h2 className="text-base font-semibold text-rose-200">严重 偏题</h2>
              {moderatorCountdown !== null ? (
                <span className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 text-xs font-semibold text-rose-100">
                  {moderatorCountdown}s 后 自动 召唤
                </span>
              ) : null}
            </div>
            <div className="space-y-2 text-sm text-zinc-300">
              <p className="font-medium text-zinc-100">{moderator.title}</p>
              <p className="text-xs leading-5 text-zinc-400">{moderator.body}</p>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                data-testid="moderator-accept"
                onClick={acceptModerator}
                disabled={busyAgents.has(moderator.agent_id)}
                className="flex-1 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-rose-400 disabled:opacity-50"
              >
                立刻 召唤 {moderator.agent_nickname?.trim() || moderator.agent_name}
              </button>
              <button
                data-testid="moderator-dismiss"
                onClick={dismissModerator}
                className="rounded-lg border border-ink-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                title="取消 自动 召唤"
              >
                忽略
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* v26.14-P5.2: 议程 进度 strip — 老 read-only 升级 推进式.
            - 显 各 项 状态 (active 绿 / done 灰勾 / pending 灰)
            - 当前 项 显 实/预 时间 (如 12/15m)
            - 超时 红色
            - 末 加 推进 / 跳转 按钮 (controller 才 见) */}
      {meetingMeta?.agenda && meetingMeta.agenda.length > 0 ? (
        <AgendaProgressStrip
          agenda={meetingMeta.agenda}
          progress={agendaProgress}
          phase={phase}
          canControl={(() => {
            // leader+ OR 会议 创建人 可控
            if (!me) return false;
            if (WRITE_ROLES.has(me.role)) return true;
            if (
              meetingMeta?.created_by_user_id &&
              me.user_id === meetingMeta.created_by_user_id
            ) return true;
            return false;
          })()}
          advancing={advancing}
          onAdvance={advanceAgendaCb}
          onJump={jumpAgendaCb}
        />
      ) : null}

      {/* v25.7-#3: 双面板布局 — 实录(60%) + AI 专家发言(40%) */}
      {(() => {
        const userLines = lines.filter((l) => l.kind === "user");
        const agentLines = lines.filter((l) => l.kind === "agent").slice().reverse();
        return (
          // v26.10-Room P5.1: lg+ 屏 实录 已移到左栏, 中栏只剩 AI 发言区 (全宽);
          // 小屏 (<lg) fallback 双列 (老布局).
          <section className="mt-4 grid gap-4 md:grid-cols-5 lg:grid-cols-1">
            {/* 左:实录(只有真人 / 未识别) — md+ 占 3/5;lg+ 隐藏 (已移到左栏 aside) */}
            <div
              ref={scrollRef}
              data-testid="transcript-panel"
              className="md:col-span-3 h-[55vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-6 lg:hidden"
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

            {/* AI 专家发言区 — md+ 占 2/5; lg+ 全宽 (因为实录已移到左栏) */}
            {/* v26.10-Room Phase 2: 第一条 (最新) 用 大焦点卡片, 历史紧凑列表 */}
            <div
              data-testid="agent-panel"
              className="md:col-span-2 h-[55vh] overflow-y-auto rounded-xl border border-violet-500/30 bg-ink-900 p-5 lg:col-span-1 lg:h-[60vh]"
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
            meetingId={meetingId}
            moderator={moderator}
            recommendation={recommendation}
            dissent={dissent}
            lines={lines}
            agents={agents}
            meetingMeta={meetingMeta}
            // v26.14-P4.3: 偏题 历史 抽屉 — 让 用户 看到 监测 在 工作
            topicHistory={topicHistory}
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

// v26.11-fix2: 邀请 AI 弹窗 — 多选 workspace 内 未邀请 的 AI, 调
// inviteMeetingAgents 后端 写 MeetingAttendee + 广播.
// 收到 后 自己 也会 走 agents_invited event handler (统一 reducer, 不 重复 setState).
// ============================================================================
// v26.14-P4.1-fix: 离开 会议室 二选一 modal
// ============================================================================
// 老 ← 首页 直跳 — 但 实际 用户 离开 时 心里 想 的 是 两件 不同 事:
//   (a) 我 暂离 一下 — 别人 + AI 继续 开会, 我 待会回来
//   (b) 我 想 散会 — 整场 结束, 进入 沉淀 / 复盘
// 直跳 等于 默认 (a) 但 不告诉 用户. 这里 显式 让 用户 选.
//
// 实现 注意:
//   (a) onLeaveContinue: 关 自己 WS + 麦克风 → router.push("/")
//       不 调 finalize, status 仍 ongoing. 别 参会人 WS 不动 (per-user WS).
//       本机 字幕 / 录音 停止 (因离开 会议室 — 但 这 是 客户端 的 事, 后端 状态 不变).
//   (b) onLeaveEnd: 调 stop() (现有, 内含 finalize) → router.push("/")
//       Meeting.status='finished'. 别人 客户端 通过 polling 或 WS close 发现.

function LeaveMeetingModal({
  phase,
  onClose,
  onLeaveContinue,
  onLeaveEnd,
}: {
  phase: "idle" | "live" | "ended";
  onClose: () => void;
  onLeaveContinue: () => void;
  onLeaveEnd: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // phase=ended 时 不需要 选 — 已经 结束 了, 仅 显 "回到工作台"
  const isAlreadyEnded = phase === "ended";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">离开 会议室</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {isAlreadyEnded ? (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              本场 会议 已 结束. 你 可以 安全 回 工作台.
            </p>
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                await onLeaveContinue();
              }}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-accent-400 disabled:opacity-50"
            >
              💼 回到 工作台
            </button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-500">你 想 怎么 做?</p>

            <div className="space-y-2">
              {/* 选项 A: 回到工作台 — 会议继续 */}
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  await onLeaveContinue();
                }}
                disabled={busy}
                data-testid="leave-continue"
                className="flex w-full items-start gap-3 rounded-lg border border-ink-700 bg-ink-950 px-4 py-3 text-left transition hover:border-accent-500 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-xl">💼</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-100">
                    回到 工作台
                    <span className="ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-200">
                      会议 继续
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
                    其他 参会人 + AI <span className="text-zinc-300">不受影响</span>, 继续 录音 / 触发.
                    你 这台 主机 的 录音 + 字幕 会 停 (因 离开 会议室).
                    之后 可以 回来 继续.
                  </p>
                </div>
                <span className="text-zinc-600">→</span>
              </button>

              {/* 选项 B: 结束整场 */}
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("⚠️ 确定 结束 整场 会议? 所有 人 + AI 都 会 停, 不可 撤销.")) return;
                  setBusy(true);
                  await onLeaveEnd();
                }}
                disabled={busy}
                data-testid="leave-end"
                className="flex w-full items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-left transition hover:border-rose-500/60 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-xl">⛔</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-100">
                    结束 整场 会议
                    <span className="ml-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-medium text-rose-200">
                      不可 撤销
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
                    所有 人 + AI 都 停, 进入 <span className="text-zinc-300">已结束 状态</span>.
                    之后 是 复盘 + 沉淀 阶段 (查看 纪要 / 审批 草稿 / 等).
                  </p>
                </div>
                <span className="text-rose-300">→</span>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                disabled={busy}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InviteAgentsModal({
  meetingId,
  allAgents,
  invitedAgentIds,
  onClose,
}: {
  meetingId: string;
  allAgents: Agent[];
  invitedAgentIds: string[];
  onClose: () => void;
}) {
  const invitedSet = new Set(invitedAgentIds);
  const candidates = allAgents.filter(
    (a) => a.is_active && !invitedSet.has(a.id) && a.role !== "moderator",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.inviteMeetingAgents(meetingId, Array.from(selected));
      if (r.added.length > 0) {
        toast.success(`已邀请 ${r.added.length} 位 AI 加入会议`);
      }
      if (r.invalid.length > 0) {
        toast.warn(`${r.invalid.length} 位 AI 邀请失败 (workspace 不匹配或未激活)`);
      }
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error("邀请失败", { detail });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">
            邀请 AI 加入本场会议
          </h2>
          <button
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
        {candidates.length === 0 ? (
          <div className="rounded-lg border border-ink-800 bg-ink-950 px-4 py-6 text-center text-xs text-zinc-500">
            该 workspace 没有 可邀请 的 AI 专家
            <br />
            (全部 已在 会议中, 或 未激活)
          </div>
        ) : (
          <div className="scrollbar-thin max-h-72 overflow-y-auto">
            <ul className="space-y-1.5">
              {candidates.map((a) => {
                const on = selected.has(a.id);
                const color = tailwindColor(a.color ?? "violet");
                // v26.12-Home: 邀请 modal 也 nickname 优先 (跟 首页 卡片 一致)
                const dn = a.nickname?.trim() || a.name;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        on
                          ? "border-accent-500 bg-accent-500/10"
                          : "border-ink-800 bg-ink-950 hover:border-ink-700"
                      }`}
                    >
                      <div
                        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
                        style={{
                          background: a.avatar_url
                            ? undefined
                            : color,
                          boxShadow: `0 0 0 1.5px ${color}40`,
                        }}
                      >
                        {a.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.avatar_url}
                            alt={dn}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          dn.slice(0, 1)
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-100">
                          {dn}
                          {a.nickname?.trim() && (
                            <span className="ml-1 text-[10px] text-zinc-500">
                              ｜ {a.name}
                            </span>
                          )}
                        </div>
                        {a.domain && (
                          <div className="truncate text-[10px] text-zinc-500">
                            {a.domain}
                          </div>
                        )}
                      </div>
                      <span
                        className={`grid h-4 w-4 place-items-center rounded border ${
                          on
                            ? "border-accent-500 bg-accent-500 text-[10px] text-white"
                            : "border-ink-700"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">
            已选 {selected.size} / {candidates.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-ink-800 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={submitting || selected.size === 0}
              className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "邀请中…" : "确认邀请"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// v26.14-P5.2: 议程 进度 strip — 推进式 + 一键 advance + 跳转
// ============================================================================
// 老 read-only strip (仅 标题 + 预算分钟) → 推进式:
//   - 各 项 显 状态 (active 绿圆 / done 灰勾 / pending 灰圈)
//   - 当前 active 项 显 实/预 时间, 超时 红色
//   - controller (leader+ OR 创建人) 见 "推进 →" 按钮 + 各 项 可点 (跳转)
//   - 议程 全部 走完 显 "✓ 议程 已完成" hint, 推进 按钮 灰
function AgendaProgressStrip({
  agenda,
  progress,
  phase,
  canControl,
  advancing,
  onAdvance,
  onJump,
}: {
  agenda: AgendaItem[];
  progress: import("@/lib/api").AgendaProgress | null;
  phase: "idle" | "live" | "ended";
  canControl: boolean;
  advancing: boolean;
  onAdvance: () => void;
  onJump: (idx: number) => void;
}) {
  // v26.14-P5.2: 自 tick 30s — 让 active 项 elapsed 数字 自走 不依赖 后端 refetch
  const [tickNonce, setTickNonce] = useState(0);
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setTickNonce((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [phase]);
  // 没 progress (老 会议 OR 还没 init) 时 fallback 老 read-only 显示
  const items = progress?.items;
  const currentIdx = progress?.current_idx ?? null;
  const isComplete = progress?.is_complete ?? false;
  const showControls = canControl && phase === "live" && !!progress?.has_agenda;
  // tickNonce 只 用于 触发 re-render (elapsed_seconds 算 from started_at)
  void tickNonce;

  return (
    <div
      data-testid="agenda-strip"
      className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">本场议程</span>
          {isComplete && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
              ✓ 已完成
            </span>
          )}
        </div>
        <ol className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1.5">
          {agenda.map((item, i) => {
            const prog = items?.[i];
            const isActive = currentIdx === i && !isComplete;
            const isDone = prog?.status === "done" || (currentIdx !== null && i < currentIdx);
            // 当前项 — 实/预 时间. active 时 client-side 算 (跟 tickNonce 自走);
            // done 时 用 server snapshot (固定 不变).
            let elapsedMin: number | null = null;
            if (isActive && prog?.started_at) {
              const ms = Date.now() - new Date(prog.started_at).getTime();
              elapsedMin = Math.max(0, Math.floor(ms / 60000));
            } else if (prog?.elapsed_seconds != null) {
              elapsedMin = Math.floor(prog.elapsed_seconds / 60);
            }
            const budgetMin = item.time_budget_min ?? null;
            const overBudget =
              isActive && elapsedMin !== null && budgetMin !== null && elapsedMin >= budgetMin;
            const warningBudget =
              isActive && elapsedMin !== null && budgetMin !== null
                ? elapsedMin / budgetMin >= 0.8 && !overBudget
                : false;

            const dotIcon = isDone ? "✓" : isActive ? "●" : "○";
            const dotColor = isDone
              ? "text-zinc-500"
              : isActive
              ? overBudget
                ? "text-rose-400"
                : warningBudget
                ? "text-amber-400"
                : "text-emerald-400"
              : "text-zinc-600";
            const titleColor = isDone
              ? "text-zinc-500 line-through"
              : isActive
              ? "text-zinc-100 font-medium"
              : "text-zinc-400";

            const timeStr = isActive
              ? budgetMin
                ? `${elapsedMin ?? 0}/${budgetMin}m`
                : elapsedMin !== null
                ? `${elapsedMin}m`
                : ""
              : isDone && elapsedMin !== null
              ? `${elapsedMin}m`
              : budgetMin
              ? `${budgetMin}m`
              : "";

            const clickable = showControls && !isActive && !isComplete;
            const Comp = clickable ? "button" : "span";

            return (
              <li key={i} className="flex items-center gap-1">
                <Comp
                  type={clickable ? "button" : undefined}
                  onClick={clickable ? () => onJump(i) : undefined}
                  disabled={clickable ? advancing : undefined}
                  title={clickable ? `跳到 第 ${i + 1} 项` : undefined}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                    clickable
                      ? "transition hover:bg-ink-800 disabled:opacity-50"
                      : ""
                  }`}
                >
                  <span className={`text-xs ${dotColor}`}>{dotIcon}</span>
                  <span className={titleColor}>{item.title}</span>
                  {timeStr && (
                    <span
                      className={
                        overBudget
                          ? "text-rose-400 font-medium"
                          : warningBudget
                          ? "text-amber-400"
                          : "text-zinc-600"
                      }
                    >
                      ({timeStr})
                    </span>
                  )}
                </Comp>
                {i < agenda.length - 1 && (
                  <span className="text-zinc-700">→</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* 推进 按钮 — controller + live + 仍有 下一项 */}
      {showControls && !isComplete && currentIdx !== null && currentIdx < agenda.length - 1 && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={advancing}
          data-testid="agenda-advance-btn"
          className="shrink-0 self-start rounded-lg bg-accent-500 px-2.5 py-1 text-[11px] font-medium text-white shadow transition hover:bg-accent-400 disabled:opacity-50"
          title="把 当前项 标记 完成, 进 下一项"
        >
          推进 →
        </button>
      )}
      {showControls && !isComplete && currentIdx !== null && currentIdx === agenda.length - 1 && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={advancing}
          data-testid="agenda-finish-btn"
          className="shrink-0 self-start rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50"
          title="完成 最后一项 — 议程 即 全部 走完"
        >
          ✓ 完成 末项
        </button>
      )}
    </div>
  );
}

// v26.10-Room Phase 1.2: AI 专家画廊 — 200x200 大头像 + 名字 上下结构 + 横向滚动
// 占据中栏顶部 红框区域 (会议元信息 右侧 大片空白).
// v26.11-fix2: "+管理" → "+邀请 AI" — 不再 跳 admin, 而是 弹 InviteAgentsModal,
// 直接 给 当前 会议 加 AI (写 MeetingAttendee + WS 广播).
function MeetingAgentGallery({
  invitedAgents,
  phase,
  busyAgents,
  onInvoke,
  onInviteClick,
}: {
  invitedAgents: Agent[];
  phase: "idle" | "live" | "ended";
  busyAgents: Set<string>;
  onInvoke: (a: Agent) => void;
  onInviteClick: () => void;
}) {
  // v26.10-Room P5.5: 紧凑空状态 (inline, 不再撑高)
  if (invitedAgents.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span>🤖 未邀请 AI 专家</span>
        <button
          type="button"
          onClick={onInviteClick}
          className="text-accent-400 hover:text-accent-500"
        >
          + 邀请 AI
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
        🤖 AI · {invitedAgents.length}
      </span>
      {/* v26.10-Room P5.5: 横向滚动容器 紧凑 inline 模式 — 卡片 ~70x70 (50x50 头像 + 名字小字) */}
      <div className="scrollbar-thin flex flex-1 gap-2 overflow-x-auto">
        {invitedAgents.map((a) => {
          const busy = busyAgents.has(a.id);
          const enabled = phase === "live" && !busy;
          const color = tailwindColor(a.color ?? "violet");
          // v26.12-Home: nickname 优先 显示 (有的话). title hover 仍 显 完整 name (职务) — 让用户 一眼 知 谁
          const displayName = a.nickname?.trim() || a.name;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onInvoke(a)}
              disabled={!enabled}
              title={
                phase !== "live"
                  ? `开始会议后, 点头像让「${displayName}」基于讨论发言`
                  : busy
                  ? `${displayName} 正在发言…`
                  : `点击让「${displayName}」基于讨论发言${a.nickname ? ` (${a.name})` : ""}`
              }
              // v26.14-P4.1-fix2: 横向 紧凑 — 28x28 头像 + 名字 inline,
              // 总高 ~36px 安全 嵌进 chrome Row 2 (h-12=48px). 老 80x90 会 溢出.
              className={`group flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-1.5 transition ${
                enabled
                  ? "border-transparent hover:border-white/20 hover:bg-ink-900/50"
                  : busy
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-transparent opacity-60 cursor-not-allowed"
              }`}
            >
              {/* 头像 28x28 — 老 50x50 加 上下 标签 撑高 90px 溢出 chrome */}
              <div
                className="relative shrink-0 overflow-hidden rounded-full"
                style={{
                  width: 28,
                  height: 28,
                  boxShadow: busy
                    ? `0 0 0 1.5px ${color}, 0 0 6px ${color}80`
                    : `0 0 0 1px ${color}40`,
                  background: `linear-gradient(135deg, ${color}30, ${color}10)`,
                }}
              >
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatar_url}
                    alt={displayName}
                    width={28}
                    height={28}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div
                    className="grid h-full w-full place-items-center text-[11px] font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {displayName.slice(0, 1)}
                  </div>
                )}
                {/* 思考/发言中 — 右下角 pulse 圆点 */}
                {busy && (
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <span
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full ring-1 ring-ink-950"
                      style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
                    />
                  </div>
                )}
              </div>
              {/* 名字 inline — 仅 一行, 超长 truncate. 详细 信息 (name/domain) 由 title hover 显. */}
              <span
                className={`truncate text-[11px] font-medium ${
                  busy ? "text-emerald-200" : "text-zinc-100"
                }`}
                style={{ maxWidth: 80 }}
              >
                {displayName}
                {busy ? " 💬" : ""}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onInviteClick}
          className="grid shrink-0 place-items-center self-stretch rounded-lg border border-dashed border-ink-700 px-2 text-[10px] text-zinc-500 hover:border-accent-500/50 hover:text-accent-400"
          title="邀请 AI 加入本场会议"
        >
          <span>+ 邀请 AI</span>
        </button>
      </div>
    </div>
  );
}

// v26.10-Room P5.1: 左栏 转录 timeline (从中栏 抽出)
// 维持 老 transcript-panel 所有功能:
//   focusIds 高亮 / SpeakerLabel 编辑 / 时间戳 / context 锚点 上下文
function MeetingTranscriptSidebar({
  lines,
  phase,
  scrollRef,
  focusIds,
  correctingLineId,
  setCorrectingLineId,
  attendees,
  correctSpeaker,
  batchCorrectSpeaker,
  recommendation: _recommendation,
  dissent: _dissent,
}: {
  lines: LiveLine[];
  phase: "idle" | "live" | "ended";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusIds: Set<number>;
  correctingLineId: number | null;
  setCorrectingLineId: (id: number | null) => void;
  attendees: Array<{ id: string; name: string }>;
  correctSpeaker: (lineId: number, uid: string | null, name: string | null) => void;
  batchCorrectSpeaker: (lineId: number, count: number, uid: string, name: string) => void;
  recommendation: unknown;
  dissent: unknown;
}) {
  // 同 老 transcript-panel: 计算 context 锚点 (focus ±2 句作为上下文)
  // 简化: 这里 不计算 contextLineIds (老逻辑在父组件,这里读 props focusIds 即可)
  const userLines = lines.filter((l) => l.kind === "user");
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-800 bg-ink-900/80 px-3 py-2.5 backdrop-blur">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-300">
          📝 实时转录
        </h2>
        <span className="text-[10px] text-zinc-500">{userLines.length} 句</span>
      </div>
      <div
        ref={scrollRef}
        data-testid="transcript-panel-sidebar"
        className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3"
      >
        {userLines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-zinc-600">
            <span className="text-2xl">🎙️</span>
            <p>
              {phase === "idle"
                ? "点「开始会议」后开口说话, 字幕实时出现"
                : phase === "live"
                ? "字幕实时出现, 姓名稍后异步贴上"
                : "本场会议未产生转录"}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {userLines.map((l) => {
              if (l.kind !== "user") return null;
              const isFocused =
                l.serverLineId != null && focusIds.has(l.serverLineId);
              return (
                <li
                  key={l.id}
                  id={
                    l.serverLineId != null
                      ? `focus-line-${l.serverLineId}-sidebar`
                      : undefined
                  }
                  className={[
                    l.final
                      ? "text-[13px] leading-relaxed text-zinc-100"
                      : "text-[13px] leading-relaxed text-zinc-400",
                    isFocused
                      ? "relative -mx-1 rounded-md border-l-2 border-amber-400 bg-amber-500/15 px-2 py-1 ring-1 ring-amber-400/30"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isFocused && (
                    <span
                      className="absolute -left-2 top-1.5 select-none text-[10px] text-amber-400"
                      title="AI 抽待办时引用的锚点"
                    >
                      📍
                    </span>
                  )}
                  <div className="flex items-baseline gap-1.5">
                    {l.startMs != null && (
                      <span
                        className="shrink-0 font-mono text-[10px] text-zinc-500"
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
                      onPick={(uid, name) =>
                        correctSpeaker(l.serverLineId!, uid, name)
                      }
                      onBatchPick={(uid, name, count) =>
                        batchCorrectSpeaker(l.serverLineId!, count, uid, name)
                      }
                    />
                  </div>
                  <div className="mt-0.5">
                    {l.text}
                    {!l.final ? <span className="ml-1 animate-pulse">▌</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
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
          animation: !l.done
            ? "focusGlow 2s ease-in-out infinite, slideInDown 0.4s ease-out"
            : "slideInDown 0.4s ease-out",
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
                {(l.agentNickname?.trim() || l.agentName).slice(0, 1)}
              </span>
            )}
            <span className="flex flex-col">
              {/* v26.12-Home: nickname 主 + name 副 (有 nickname 时); 没 nickname 仅 显 name */}
              {l.agentNickname?.trim() ? (
                <>
                  <span className="text-sm font-semibold" style={{ color }}>
                    {l.agentNickname.trim()}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {l.agentName} · {l.done ? "已发言" : "正在发言…"}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold" style={{ color }}>
                    {l.agentName}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {l.done ? "已发言" : "正在发言…"}
                  </span>
                </>
              )}
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
          {/* v26.12-Home: nickname 主 + name 副 (uppercase 风格 副 用 zinc-500 灰色) */}
          {l.agentNickname?.trim() ? (
            <span>
              {l.agentNickname.trim()}
              <span className="ml-1 text-zinc-500 normal-case tracking-normal">
                ｜ {l.agentName}
              </span>
            </span>
          ) : (
            <span>{l.agentName}</span>
          )}
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
  meetingId,
  moderator,
  recommendation,
  dissent,
  lines,
  agents,
  meetingMeta,
  topicHistory,
  onInvokeAgent,
  onDismissModerator,
  onDismissRecommendation,
}: {
  phase: "idle" | "live" | "ended";
  meetingId: string;
  moderator: {
    kind: "off_topic" | "time_warning" | "stuck" | "advance_suggested";
    severity?: "suspected" | "confirmed" | "severe";  // v26.14-P4.3
    title: string;
    body: string;
    agent_id: string;
    agent_name: string;
    agent_nickname?: string | null;  // v26.12-Home
    agent_color: string;
    invoke_query: string;
    auto_summon_at_ms: number | null;
  } | null;
  recommendation: {
    agent_id: string;
    agent_name: string;
    agent_nickname?: string | null;  // v26.12-Home
    agent_color: string;
    reason: string;
  } | null;
  dissent: {
    topic: string;
    parties: string[];
    agent_id: string;
    agent_name: string;
    agent_nickname?: string | null;  // v26.12-Home
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
  // v26.14-P4.3: 偏题 历史 — 抽屉 用; 老 是 banner 闪一下 就 没, 看不到 历史 → 用户 不知 监测 在 工作.
  topicHistory: Array<{
    ts: number;
    severity: "suspected" | "confirmed" | "severe";
    summary: string;
    current_agenda_item: string | null;
    suggested_agenda_item: string | null;
  }>;
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
  // v26.10-Room P5.2: 接 真实 action_items endpoint
  const [actionItems, setActionItems] = useState<import("@/lib/api").ActionItem[]>([]);
  useEffect(() => {
    let alive = true;
    const fetchItems = () => {
      if (!meetingId) return;
      api.listActionItems(meetingId)
        .then((rows) => { if (alive) setActionItems(rows); })
        .catch(() => { /* 静默 — 会议进行中可能 还没 action items */ });
    };
    fetchItems();
    // 会议进行中 每 30s 轮询一次 (新生成的 action items 出现);结束后 不轮询
    if (phase === "live") {
      const t = setInterval(fetchItems, 30000);
      return () => { alive = false; clearInterval(t); };
    }
    // ended/idle: 仅 fetch 一次
    return () => { alive = false; };
  }, [meetingId, phase]);
  // open + done 都显示, 但 cancelled 隐藏. open 排前
  const visibleItems = actionItems
    .filter((it) => it.status !== "cancelled")
    .sort((a, b) => {
      if (a.status === b.status) return 0;
      if (a.status === "open") return -1;
      return 1;
    })
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* v26.14-P4.3: 偏题 抽屉 — 折叠 历史 列表, 标签 显 count badge.
            放 最顶 — 老 banner 闪一下 就 没, 用户 不知 监测 在 工作; 抽屉 让 它 可追溯. */}
      <TopicHistoryDrawer topicHistory={topicHistory} phase={phase} />

      {/* 主持人提醒 (高优先级, 进行中才显示) — suspected 跳过 这里 (老侧栏 卡片 太重 不 适合 轻提示)
            v26.14-P5.3: advance_suggested 也 跳过 这里 (顶 banner 已有 主 CTA, 侧栏 卡 会 重复) */}
      {phase === "live" && moderator && moderator.severity !== "suspected" && moderator.kind !== "advance_suggested" && (
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

      {/* AI 建议 — v26.12-Home: nickname 优先 */}
      {phase === "live" && recommendation && (() => {
        const recName = recommendation.agent_nickname?.trim() || recommendation.agent_name;
        return (
          <ReminderCard
            icon="💡"
            tone="violet"
            title={`建议召唤 ${recName}`}
            body={recommendation.reason}
            onDismiss={onDismissRecommendation}
            actionLabel={`召唤 ${recName} →`}
            onAction={() => {
              onInvokeAgent(recommendation.agent_id);
              onDismissRecommendation();
            }}
          />
        );
      })()}

      {/* v26.10-Room P5.4: 议程 timeline 进度条 (timeline + 进度条 + 时间预算) */}
      {agenda && agenda.length > 0 && (
        <AgendaTimeline agenda={agenda} phase={phase} />
      )}

      {/* v26.10-Room P5.2: 任务速览 — 接真实 action_items endpoint */}
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            📌 任务与工单
          </div>
          <span className="text-[10px] text-zinc-600">
            {actionItems.length === 0 ? "暂无" : `${actionItems.filter((it) => it.status === "open").length} / ${actionItems.length}`}
          </span>
        </div>
        {visibleItems.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-600">
            {phase === "live"
              ? "会议进行中. AI 会在会议结束 (或纪要重生成) 自动提取行动项."
              : phase === "ended"
              ? "本场会议未抽到行动项. 可以 在 纪要 tab 点 重生成 重试."
              : "会议未开始. 行动项 会议结束后 由 AI 自动提取."}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {visibleItems.map((it) => (
              <li
                key={it.id}
                className={`rounded border p-2 text-[11px] transition ${
                  it.status === "done"
                    ? "border-ink-800 bg-ink-950/60 text-zinc-500 line-through"
                    : "border-ink-700 bg-ink-950 text-zinc-200"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">
                    {it.status === "done" ? "✅" : "☐"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2">{it.content}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-[9px] text-zinc-600">
                      {it.assignee_name && (
                        <span className="rounded bg-ink-800 px-1.5 py-0.5">
                          👤 {it.assignee_name}
                        </span>
                      )}
                      {it.source_type === "summary" && (
                        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">
                          🤖 AI 抽取
                        </span>
                      )}
                      {it.source_type === "manual" && (
                        <span className="rounded bg-zinc-700/40 px-1.5 py-0.5">
                          ✍️ 手动
                        </span>
                      )}
                      {it.due_at && (
                        <span>
                          ⏰{" "}
                          {new Date(it.due_at).toLocaleDateString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
            {actionItems.length > 8 && (
              <li className="text-center text-[10px] text-zinc-600">
                + 还有 {actionItems.length - 8} 条 (会议结束后 在纪要 tab 查看)
              </li>
            )}
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

// v26.10-Room P5.4: 议程 timeline 进度条 (按 Kimi 设计稿)
// 第一项 = 当前议程 (实心圆 + 进度条 + 剩余时间)
// 后续 = 待开始 (空心圆 + 时间预算)
function AgendaTimeline({
  agenda,
  phase,
}: {
  agenda: AgendaItem[];
  phase: "idle" | "live" | "ended";
}) {
  // 简化: 当前议程 = agenda[0], 假设议程开始时间 = 会议开始时间.
  // (真正的 议程切换检测 需要后端 跟踪 当前 active agenda_idx — 暂未实现)
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (phase !== "live") return;
    const start = Date.now() - elapsedMs;
    const t = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const currentBudgetMin = agenda[0]?.time_budget_min ?? null;
  const currentBudgetMs = currentBudgetMin ? currentBudgetMin * 60 * 1000 : null;
  const usedRatio =
    currentBudgetMs && phase === "live"
      ? Math.min(1.2, elapsedMs / currentBudgetMs)
      : 0;
  const overtime = usedRatio > 1;
  const remainingMs = currentBudgetMs ? currentBudgetMs - elapsedMs : 0;
  const fmtMin = (ms: number) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900 p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500">
        📋 议程 · {agenda.length} 项
      </div>
      <ol className="mt-3 space-y-3">
        {agenda.map((item, i) => {
          const isCurrent = i === 0 && phase === "live";
          const isUpcoming = i > 0 || phase === "idle";
          return (
            <li key={i} className="relative pl-5">
              {/* timeline 竖线 (除最后一项) */}
              {i < agenda.length - 1 && (
                <span
                  className={`absolute left-[7px] top-3 h-full w-px ${
                    isCurrent ? "bg-accent-500/30" : "bg-ink-700"
                  }`}
                />
              )}
              {/* 节点圆 */}
              <span
                className={`absolute left-0 top-0.5 inline-block h-3.5 w-3.5 rounded-full ${
                  isCurrent
                    ? "bg-accent-500 shadow-[0_0_8px] shadow-accent-500/50"
                    : isUpcoming
                    ? "border-2 border-ink-600 bg-ink-900"
                    : "bg-emerald-500"
                }`}
              />
              <div
                className={`text-xs ${
                  isCurrent
                    ? "text-accent-200"
                    : isUpcoming
                    ? "text-zinc-400"
                    : "text-emerald-300"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {i + 1}. {item.title}
                  </span>
                  {item.time_budget_min && (
                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {item.time_budget_min} 分
                    </span>
                  )}
                </div>
                {/* 当前议程 — 进度条 + 剩余时间 */}
                {isCurrent && currentBudgetMs && (
                  <div className="mt-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                      <div
                        className={`h-full transition-all duration-1000 ${
                          overtime ? "bg-rose-500 animate-pulse" : "bg-accent-500"
                        }`}
                        style={{ width: `${Math.min(100, usedRatio * 100)}%` }}
                      />
                    </div>
                    <div
                      className={`mt-1 text-[10px] font-mono ${
                        overtime ? "text-rose-400" : "text-zinc-500"
                      }`}
                    >
                      {overtime
                        ? `⏱ 超时 +${fmtMin(-remainingMs)}`
                        : `⏱ 剩 ${fmtMin(remainingMs)}`}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// v26.14-P4.3: 偏题 历史 抽屉 — 折叠 在 右栏 顶部.
//   - 默认 折叠, 显 "🎯 偏题 监测 · N 次" + 三色 mini 点
//   - 展开 后 列 最近 N 条 (severity / 时间 / 摘要 / 议程 提示)
//   - phase=live + history 为 空: 显 "AI 正在 监测... (0 次 偏题)" 提示 (让 用户 知道 在 工作)
//   - phase=ended OR history>0: 正常 显
function TopicHistoryDrawer({
  topicHistory,
  phase,
}: {
  topicHistory: Array<{
    ts: number;
    severity: "suspected" | "confirmed" | "severe";
    summary: string;
    current_agenda_item: string | null;
    suggested_agenda_item: string | null;
  }>;
  phase: "idle" | "live" | "ended";
}) {
  const [open, setOpen] = useState(false);
  const count = topicHistory.length;
  if (phase === "idle") return null;

  // 统计 三档 各 几次
  const counts = topicHistory.reduce(
    (acc, h) => {
      acc[h.severity] = (acc[h.severity] || 0) + 1;
      return acc;
    },
    { suspected: 0, confirmed: 0, severe: 0 } as Record<string, number>,
  );

  return (
    <section
      data-testid="topic-history-drawer"
      className="rounded-lg border border-ink-700 bg-ink-900/40"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-ink-900/60"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base">🎯</span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-zinc-200">
              偏题 监测
              {count > 0 ? (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                  {count} 次
                </span>
              ) : (
                <span className="ml-1.5 text-[9px] text-emerald-400">在线</span>
              )}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {count === 0
                ? phase === "live"
                  ? "AI 实时 看 是否 跑题, 暂未 触发"
                  : "本场 AI 未 检出 偏题"
                : `${counts.severe ? `严重 ${counts.severe} · ` : ""}${
                    counts.confirmed ? `确认 ${counts.confirmed} · ` : ""
                  }${counts.suspected ? `疑似 ${counts.suspected}` : ""}`.replace(/ · $/, "")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {count > 0 ? (
            <div className="flex gap-1">
              {counts.severe > 0 && (
                <span className="h-2 w-2 rounded-full bg-rose-500" title={`严重 ${counts.severe}`} />
              )}
              {counts.confirmed > 0 && (
                <span className="h-2 w-2 rounded-full bg-amber-500" title={`确认 ${counts.confirmed}`} />
              )}
              {counts.suspected > 0 && (
                <span className="h-2 w-2 rounded-full bg-zinc-400" title={`疑似 ${counts.suspected}`} />
              )}
            </div>
          ) : null}
          <span className="text-xs text-zinc-600">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && count > 0 ? (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-ink-700 px-3 py-2 scrollbar-thin">
          {topicHistory.map((h, i) => {
            const tone =
              h.severity === "severe"
                ? "border-rose-500/40 bg-rose-500/5"
                : h.severity === "confirmed"
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-zinc-700 bg-zinc-900/30";
            const sevLabel =
              h.severity === "severe" ? "严重" : h.severity === "confirmed" ? "确认" : "疑似";
            const sevColor =
              h.severity === "severe"
                ? "text-rose-200"
                : h.severity === "confirmed"
                ? "text-amber-200"
                : "text-zinc-400";
            const timeStr = new Date(h.ts).toLocaleTimeString("zh-CN", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <li key={i} className={`rounded-md border px-2.5 py-1.5 text-[11px] ${tone}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${sevColor}`}>{sevLabel}</span>
                  <span className="text-zinc-600">{timeStr}</span>
                </div>
                <p className="mt-0.5 text-zinc-300 leading-4">{h.summary}</p>
                {h.current_agenda_item || h.suggested_agenda_item ? (
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {h.current_agenda_item ? `在「${h.current_agenda_item}」` : ""}
                    {h.suggested_agenda_item ? ` → 建议「${h.suggested_agenda_item}」` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
// ============================================================================
// v26.14-P4.1: 中央 倒计时 — 数字钟 风格 (绿色发光 / 黄色预警 / 红色超时)
// ============================================================================
// 三态 阈值:
//   normal (绿)  — phase=live AND elapsed < 80% planned AND 剩余 > 5min
//   warning (琥珀) — 剩余 ≤ 20% OR 剩余 ≤ 5min
//   overtime (红) — elapsed > planned (强红 + 显示 +MM:SS)
// 没设 plannedTotalMinutes (= null) 时 → 永远 normal 绿, 仅 显 已用时间.
// phase != live → 显 静态 (不动 / 灰色).
function CountdownClock({
  phase,
  plannedTotalMinutes,
}: {
  phase: "idle" | "live" | "ended";
  plannedTotalMinutes: number | null;
}) {
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  useEffect(() => {
    if (phase !== "live") return;
    const startedAt = Date.now() - elapsedSec * 1000;
    const t = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 计算 显示 + 三态
  const plannedSec = plannedTotalMinutes ? plannedTotalMinutes * 60 : null;
  const isOvertime = plannedSec !== null && elapsedSec > plannedSec;

  let tone: "normal" | "warning" | "overtime" = "normal";
  if (phase !== "live") {
    tone = "normal"; // idle / ended → 绿 静态
  } else if (isOvertime) {
    tone = "overtime";
  } else if (plannedSec !== null) {
    const remainSec = plannedSec - elapsedSec;
    const remainRatio = remainSec / plannedSec;
    // 剩余 ≤ 20% OR 剩余 ≤ 5min → 预警
    if (remainRatio <= 0.2 || remainSec <= 300) tone = "warning";
  }

  // 格式化
  const fmtMS = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const overSec = isOvertime ? elapsedSec - (plannedSec ?? 0) : 0;
  const mainText = isOvertime ? `+${fmtMS(overSec)}` : fmtMS(elapsedSec);
  const tail = plannedTotalMinutes !== null
    ? ` / ${plannedTotalMinutes}m`
    : "";

  const toneClass =
    tone === "overtime"
      ? "clock-tone-overtime"
      : tone === "warning"
        ? "clock-tone-warning"
        : "clock-tone-normal";

  // phase=idle 时 显 "—" 占位 (不闪)
  if (phase === "idle") {
    return (
      <div className="flex items-baseline justify-center gap-1.5">
        <span className="clock-digital text-2xl text-zinc-600">--:--</span>
        {plannedTotalMinutes !== null && (
          <span className="text-[11px] font-medium text-zinc-600">
            / {plannedTotalMinutes}m
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-baseline justify-center gap-1.5"
      title={
        plannedTotalMinutes !== null
          ? `已开会 ${fmtMS(elapsedSec)} / 计划 ${plannedTotalMinutes} 分钟${
              isOvertime ? ` (超时 ${fmtMS(overSec)})` : ""
            }`
          : `已开会 ${fmtMS(elapsedSec)} (未设议程时间预算)`
      }
    >
      <span className={`clock-digital text-2xl ${toneClass}`}>
        {mainText}
      </span>
      {tail && (
        <span className="clock-digital text-xs text-zinc-500">{tail}</span>
      )}
    </div>
  );
}


function MeetingRoomTopBar({
  title,
  mode,
  phase,
  statusText,
  meetingId,
  invitedAgentCount,
  // v26.14-fix1: 控件行 props (合并 老 中栏 header)
  onStart,
  onStop,
  onResume,
  showResumeButton,
  invitedAgents,
  busyAgents,
  onInvokeAgent,
  onInviteClick,
  // v26.14-P4.1: 计划总时 (sum agenda.time_budget_min); null = 没设议程时间, 仅显 elapsed
  plannedTotalMinutes,
  // v26.14-P4.1-fix: 离开 会议室 (替代 ← 首页 直跳)
  onLeaveClick,
}: {
  title?: string;
  mode?: string;
  phase: "idle" | "live" | "ended";
  statusText: string;
  meetingId: string;
  invitedAgentCount: number;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  showResumeButton: boolean;
  invitedAgents: Agent[];
  busyAgents: Set<string>;
  onInvokeAgent: (a: Agent) => void;
  onInviteClick: () => void;
  plannedTotalMinutes: number | null;
  onLeaveClick: () => void;
}) {
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
    // v26.14-fix1: 顶部 chrome 2 行 — 上行 标题/中央倒计时/状态, 下行 控件.
    // v26.14-P4.1: 倒计时 移到 上行 正中央 (老 在 右侧 status pill 内 不显眼).
    <header className="flex shrink-0 flex-col border-b border-ink-800 bg-ink-900/60 backdrop-blur">
      {/* Row 1: [左 返回+标题 / 中央 大字 倒计时 / 右 状态pill + AI 数] — 3 段 grid 保 居中
          v26.14-P4.1-fix: 老 ← 首页 link 直跳 → 改 ← 返回 按钮 + 二选一 modal.
          AppLogo 已在 会议室 隐藏 (同套修复). 顶部 不再 双 logo 撞. */}
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
        {/* 左: 返回 按钮 + 标题 */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onLeaveClick}
            data-testid="leave-meeting-btn"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:bg-ink-900 hover:text-white transition"
            title="离开 会议室 (会问 你 是 结束 整场 还是 仅 回到工作台)"
          >
            <span aria-hidden>←</span>
            <span>返回</span>
          </button>
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

        {/* 中央: 倒计时 — 数字钟 风格, 三态 颜色 (绿/琥珀/红), 发光动画 */}
        <CountdownClock
          phase={phase}
          plannedTotalMinutes={plannedTotalMinutes}
        />

        {/* 右: 状态pill (去掉 老 计时) + AI 数 + Orchestrate */}
        <div className="flex items-center justify-end gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusColor}`}
            title={statusText}
          >
            {phase === "live" && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            )}
            {statusLabel}
          </span>
          {invitedAgentCount > 0 && (
            <span className="hidden rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-300 sm:inline-flex">
              🤖 {invitedAgentCount} AI 专家
            </span>
          )}
          {mode === "auto" && (
            <Link
              href={`/meeting/${meetingId}/orchestrate`}
              className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/25"
            >
              ⚖️ Orchestrate
            </Link>
          )}
        </div>
      </div>

      {/* Row 2: 控件 — 开始/结束/恢复 + AI 画廊 + 邀请 (老 中栏 header) */}
      <div className="flex h-12 items-center gap-3 border-t border-ink-800/60 px-4">
        <button
          onClick={onStart}
          disabled={phase !== "idle"}
          className="shrink-0 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-400 transition"
        >
          ▶ 开始会议
        </button>
        {showResumeButton && (
          <button
            onClick={onResume}
            className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-400 transition"
          >
            🎙️ 恢复录音
          </button>
        )}
        <button
          onClick={onStop}
          disabled={phase !== "live"}
          className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-rose-500/10 transition"
        >
          ■ 结束会议
        </button>
        <span className="h-6 w-px shrink-0 bg-ink-700" />
        <div className="min-w-0 flex-1">
          <MeetingAgentGallery
            invitedAgents={invitedAgents}
            phase={phase}
            busyAgents={busyAgents}
            onInvoke={onInvokeAgent}
            onInviteClick={onInviteClick}
          />
        </div>
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


// ============================================================================
// v26.14-P2: 本场会议 收获 panel
// ============================================================================
// 让 用户 开完 会 看到 "这场 会 真的 让 AI 变 聪明了 几条 经验 / 几篇 资料":
//   📌 Action Items: N 个 (M 已 完成)
//   🧠 长期记忆 草稿: N 条 (M 待审 · K 已批)  ← 闭环 入口
//   📚 知识库 草稿: N 条 (M 待审 · K 已批)    ← 通常 0, 等 任务办结 后 产
// 不直接 展开 所有列表 (默认 折叠), 点 才 展. 避免 minutes tab 顶部 太占 空间.

// ============================================================================
// v26.14-P5.4: 会议 全景 时间线 — minutes tab 顶部 (在 HarvestPanel 下方)
// ============================================================================
// 让 用户 一眼 看 整场 怎么 走 的:
//   - 议程 各 项 起/止 (实/预 时间)
//   - AI 事件 (off_topic / stuck / advance_suggested / time_warning)
//   - 用户 推进/跳转 操作
// 默认 展开 (8+ 条 时 折叠). HarvestPanel 给 "这场 留下 啥" (产出),
// Timeline 给 "这场 怎么 进 的" (过程) — 互补.
function MeetingTimelinePanel({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<import("@/lib/api").MeetingTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getMeetingTimeline(meetingId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [meetingId]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-xs text-zinc-500">
        🕒 全景时间线 加载中…
      </div>
    );
  }
  if (!data || data.events.length === 0) {
    // 无 议程 或 无 audit — 不强 显示空panel, 避免 占地
    return null;
  }

  const events = data.events;
  // 默认 折叠 阈值: > 8 条
  const DEFAULT_LIMIT = 8;
  const visible = collapsed ? events.slice(0, DEFAULT_LIMIT) : events;
  const hasMore = events.length > DEFAULT_LIMIT;

  return (
    <section
      data-testid="meeting-timeline"
      className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-100">🕒 全景 时间线</h3>
          <span className="rounded-full border border-ink-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {events.length} 条
          </span>
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            {collapsed ? `展开 全部 (${events.length})` : `折叠 (仅显 前 ${DEFAULT_LIMIT})`}
          </button>
        )}
      </div>
      <ol className="space-y-1.5">
        {visible.map((e, i) => (
          <TimelineRow key={`${e.ts}-${i}`} event={e} />
        ))}
      </ol>
      {collapsed && hasMore && (
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          … 还有 {events.length - DEFAULT_LIMIT} 条
        </p>
      )}
    </section>
  );
}

function TimelineRow({ event }: { event: import("@/lib/api").TimelineEvent }) {
  const time = new Date(event.ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // 颜色 by kind — agenda_start/end 中性, off_topic/stuck rose, advance_* emerald
  const tone = (() => {
    switch (event.kind) {
      case "off_topic":
      case "stuck":
        return "border-l-rose-500/60";
      case "time_warning":
        return "border-l-amber-500/60";
      case "advance_suggested":
      case "advance_action":
      case "agenda_end":
        return "border-l-emerald-500/60";
      case "jump_action":
        return "border-l-violet-500/60";
      default:  // agenda_start, anything else
        return "border-l-zinc-600";
    }
  })();
  return (
    <li
      className={`flex items-start gap-3 rounded-md border-l-2 bg-ink-950/40 px-3 py-1.5 ${tone}`}
    >
      <span className="shrink-0 font-mono text-[10px] text-zinc-500">{time}</span>
      <span className="min-w-0 flex-1 text-xs text-zinc-300">{event.label}</span>
    </li>
  );
}

function HarvestPanel({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.harvestMeeting>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<"action" | "memory" | "kb" | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.harvestMeeting(meetingId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { /* api.ts 已 toast */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [meetingId]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3 text-xs text-zinc-500">
        🎁 本场收获 加载中…
      </div>
    );
  }
  if (!data) return null;
  const isEmpty =
    data.action_items_total === 0 &&
    data.memory_drafts_total === 0 &&
    data.kb_drafts_total === 0;

  return (
    <section className="mt-4 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-ink-900/80 p-4">
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-violet-200">
          <span className="text-base">🎁</span>
          本场 会议 收获
        </h3>
        <span className="text-[10px] text-zinc-500">
          AI 经验 / 资料 / 待办 的 沉淀
        </span>
      </header>

      {isEmpty ? (
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          本场 暂 无 沉淀 — 会议 较短 或 缺少 可抽取 的 决策/事实.
          重生成 纪要 (实录 tab) 可 再次 抽取.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {/* Action Items */}
          <HarvestStat
            icon="📌"
            label="Action Items"
            primary={`${data.action_items_total} 个`}
            sub={
              data.action_items_total > 0
                ? `${data.action_items_done} 完成 · ${data.action_items_open} 进行中`
                : "本场 无 待办"
            }
            active={expanded === "action"}
            disabled={data.action_items_total === 0}
            onClick={() => setExpanded(expanded === "action" ? null : "action")}
            tone="amber"
          />
          {/* Memory Drafts */}
          <HarvestStat
            icon="🧠"
            label="长期记忆 草稿"
            primary={`${data.memory_drafts_total} 条`}
            sub={
              data.memory_drafts_total > 0
                ? `${data.memory_drafts_approved} 已批 · ${data.memory_drafts_pending} 待审`
                : "本场 无 抽取"
            }
            active={expanded === "memory"}
            disabled={data.memory_drafts_total === 0}
            onClick={() => setExpanded(expanded === "memory" ? null : "memory")}
            tone="violet"
          />
          {/* KB Drafts */}
          <HarvestStat
            icon="📚"
            label="知识库 草稿"
            primary={`${data.kb_drafts_total} 条`}
            sub={
              data.kb_drafts_total > 0
                ? `${data.kb_drafts_approved} 已批 · ${data.kb_drafts_pending} 待审`
                : "等 任务办结 后 产"
            }
            active={expanded === "kb"}
            disabled={data.kb_drafts_total === 0}
            onClick={() => setExpanded(expanded === "kb" ? null : "kb")}
            tone="sky"
          />
        </div>
      )}

      {/* 展开 详情 列表 */}
      {expanded === "action" && data.action_items.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          {data.action_items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-zinc-300">
                <StatusDot status={it.status} />
                {it.content}
              </span>
              <span className="shrink-0 text-[10px] text-zinc-500">
                {it.assignee_user_name || it.assignee_name_hint || "未派"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {expanded === "memory" && data.memory_drafts.length > 0 && (
        <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <ul className="space-y-1.5">
            {data.memory_drafts.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-zinc-300">
                  <StatusDot status={d.status} />
                  {d.proposed_content}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {d.status === "pending" ? "待审" : d.status === "approved" ? "✅ 已批" : d.status}
                </span>
              </li>
            ))}
          </ul>
          {data.memory_drafts_pending > 0 && (
            <Link
              href="/me/profile/sedimentation"
              className="mt-2 inline-block text-[11px] text-violet-300 hover:text-violet-200"
            >
              → 去 审批中心 处理 {data.memory_drafts_pending} 条 待审
            </Link>
          )}
        </div>
      )}

      {expanded === "kb" && data.kb_drafts.length > 0 && (
        <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <ul className="space-y-1.5">
            {data.kb_drafts.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-zinc-300">
                  <StatusDot status={d.status} />
                  {d.proposed_summary_preview}…
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {d.status === "pending" ? "待审" : d.status === "approved" ? "✅ 已批" : d.status}
                </span>
              </li>
            ))}
          </ul>
          {data.kb_drafts_pending > 0 && (
            <Link
              href="/me/profile/sedimentation"
              className="mt-2 inline-block text-[11px] text-sky-300 hover:text-sky-200"
            >
              → 去 审批中心 处理 {data.kb_drafts_pending} 条 待审
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function HarvestStat({
  icon,
  label,
  primary,
  sub,
  active,
  disabled,
  onClick,
  tone,
}: {
  icon: string;
  label: string;
  primary: string;
  sub: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  tone: "amber" | "violet" | "sky";
}) {
  const toneClasses = {
    amber: active
      ? "border-amber-500 bg-amber-500/10"
      : "border-ink-800 bg-ink-950 hover:border-amber-500/40",
    violet: active
      ? "border-violet-500 bg-violet-500/10"
      : "border-ink-800 bg-ink-950 hover:border-violet-500/40",
    sky: active
      ? "border-sky-500 bg-sky-500/10"
      : "border-ink-800 bg-ink-950 hover:border-sky-500/40",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-left transition ${toneClasses} ${
        disabled ? "cursor-default opacity-50" : "cursor-pointer"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        <span aria-hidden>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-sm font-medium text-zinc-100">{primary}</div>
      <div className="text-[10px] text-zinc-500">{sub}</div>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "done" || status === "approved"
      ? "bg-emerald-400"
      : status === "rejected" || status === "cancelled"
      ? "bg-rose-400"
      : status === "expired"
      ? "bg-zinc-500"
      : "bg-amber-400"; // pending / open
  return (
    <span
      className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${color}`}
      aria-hidden
    />
  );
}
