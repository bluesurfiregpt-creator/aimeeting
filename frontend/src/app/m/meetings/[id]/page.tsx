"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 会议室 (浅色 iOS 风全重写).
 *
 * 设计源: docs/design/handoffs/2026-05-25-meeting-room/project/meeting-room.jsx
 * round-2 设计源 (PM 优化): Claude Design handoff
 *   https://api.anthropic.com/v1/design/h/iJXetu7lfxK03t94tx9MOw
 *   主要 delta: CompactContextBar + 单行 dock + 结束按钮独立大红
 * round-3 设计源 (PM round-3 — 最满意版本):
 *   https://api.anthropic.com/v1/design/h/6raIVEiSUPIJuj67uhaw9g (Meeting Room.html)
 *   主要 delta:
 *     - 参考资料 用 MaterialsStrip 在 CompactContextExpandable 内 (跟议程/参与人 一起折叠)
 *     - 旧 AttachmentsSection (放 main body 独立 折叠) → 移除
 *     - 新增 MaterialsSheet / UploadSheet / FilePreview / MaterialUploadedEvent
 *     - 资料图标 用 4 色 折角 FileGlyph (PDF 红 / Word 蓝 / Excel 绿 / PPT 橙)
 *
 * Saga 边界: 只动这一页 + 它的专用 mobile 组件 (含新 materials/ 子目录). 不动跨页
 * 共享 (Toast / MobileShell / globals.css / tailwind config / lib / backend).
 *
 * 顶层结构 (上 → 下):
 *   1. MRHeader      — ← 历史 / 标题+实时红点+timer / 章节 / 筛选 (R10)
 *   2. CompactContextBar (40px) — round-2 — 绿点 · 议程 X/N · 资料数 · 头像叠 · ⌄
 *   3. ContextExpandable (peek-then-tuck) — 包 AgendaStrip + **MaterialsStrip** +
 *      ParticipantsStrip (默认展开 2.5s 自收, 滚动 transcript >24px 也自收)
 *   4. FilterBanner — sticky (筛选激活时)
 *   5. transcript view — user/agent line + inline host card + mock round (R9)
 *   6. JumpToLatestFab — 滚离底时显
 *   7. Dock (round-2 — 单行: AI pill · Mira pill · mic · video · more  +  独立大红 结束)
 *   8. sheets (Summon/AskHost/More/Filter/Highlights/**Materials/Upload**) + EndConfirm +
 *      Leave + SevereModal + Toast + **FilePreview** (full screen overlay)
 */

import { useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KBCitationSheet, type KBCitation } from "@/components/mobile/v2";
import NativeMeetingEntry from "@/components/mobile/NativeMeetingEntry";
import StageChipsRow from "@/components/mobile/StageChipsRow";
import StickyActionBar from "@/components/mobile/StickyActionBar";
import SummonAgentSheet from "@/components/mobile/SummonAgentSheet";
import MeetingTranscriptView, {
  type TimelineHostItem,
} from "@/components/mobile/MeetingTranscriptView";
import LeaveMeetingSheet from "@/components/mobile/LeaveMeetingSheet";
import AgendaEventBanner, {
  type BannerData,
} from "@/components/mobile/AgendaEventBanner";
import SevereOffTopicModal, {
  type SevereData,
} from "@/components/mobile/SevereOffTopicModal";
import Toast from "@/components/mobile/Toast";
import MRHeader from "@/components/mobile/meeting-room/MRHeader";
import ParticipantsStrip from "@/components/mobile/meeting-room/ParticipantsStrip";
import CompactContextBar, {
  CompactContextExpandable,
} from "@/components/mobile/meeting-room/CompactContextBar";
import {
  MOCK_HUMANS,
  type MockHumanId,
} from "@/components/mobile/shared/avatars";
import JumpToLatestFab from "@/components/mobile/meeting-room/JumpToLatestFab";
import EndConfirm from "@/components/mobile/meeting-room/EndConfirm";
import AskHostSheet from "@/components/mobile/meeting-room/AskHostSheet";
import MoreSheet from "@/components/mobile/meeting-room/MoreSheet";
import HighlightsSheet, {
  type HighlightItem,
} from "@/components/mobile/meeting-room/HighlightsSheet";
import FilterSheet, {
  type FilterSpeaker,
  mockAisAsSpeakers,
  mockHostAsSpeaker,
} from "@/components/mobile/meeting-room/FilterSheet";
import FilterBanner from "@/components/mobile/meeting-room/FilterBanner";
import OrchestrateStatusBanner from "@/components/mobile/meeting-room/OrchestrateStatusBanner";
import {
  MR_COLORS,
  MR_FONT_FAMILY,
  useInjectAnimations,
} from "@/components/mobile/meeting-room/styles";
import {
  MaterialsStrip,
  MaterialsSheet,
  UploadSheet,
  FilePreview,
  adaptAttachmentsToMaterials,
  hasNewMaterial,
  type Material,
} from "@/components/mobile/meeting-room/materials";
// v1.4.0 Phase A · 1 (NORTH_STAR § 6.1): MOCK_ROUND_MESSAGES 已撤 — hybrid/human
// 不再混 demo 圆桌卡, 真 agent_message_* WS event 接管.
import { mApi } from "@/lib/mobile/api";
import type { MeetingAttachmentOut } from "@/lib/mobile/types";
import {
  MeetingWsProvider,
  useMeetingWsConn,
  useMeetingWsEvent,
  useMeetingWsSend,
} from "@/lib/mobile/meetingWsBus";
import type { MobileMeetingDetail } from "@/lib/mobile/types";

export default function MobileMeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <MeetingWsProvider meetingId={id}>
      <MeetingDetailInner id={id} />
    </MeetingWsProvider>
  );
}

function MeetingDetailInner({ id }: { id: string }) {
  // 注入本 Saga 动画 keyframes
  useInjectAnimations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conn = useMeetingWsConn();

  // v1.4.0 Sprint 3 Mobile Part 2 (NORTH_STAR § 3.1 v1.1): URL ?focus=<key>&highlight=1
  // 由 /m/insights snapshot 跳转过来 — MeetingTranscriptView 内 滚 + 闪 3 秒.
  // focus key 格式: "agent-<id>" (AI 发言) | "user-<id>" (真人发言) | "host-banner-..." (host card)
  // 跟 LocalLine.key 严格 一致 (MeetingTranscriptView 用 data-mr-key="<key>" 标锚点).
  const focusKey = searchParams?.get("focus") ?? null;

  // v1.4.0 Sprint 3 Mobile Part 1 (NORTH_STAR § 3.2): KB 引用侧栏 state.
  // 用户点 AI 发言 "引用 N 条 KB" → setCitationTarget → 拉 API → 弹 sheet.
  const [citationTarget, setCitationTarget] = useState<{
    messageId: number;
    speakerLabel: string;
  } | null>(null);
  const [citations, setCitations] = useState<KBCitation[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [citationSheetOpen, setCitationSheetOpen] = useState(false);

  const handleCitationClick = useCallback(
    async (messageId: number, speakerLabel: string) => {
      // 1. 立即打开 sheet (loading 态显占位)
      setCitationTarget({ messageId, speakerLabel });
      setCitations([]);
      setCitationsLoading(true);
      setCitationSheetOpen(true);
      // 2. 拉 citations — v2 endpoint 单条 lookup, payload 小
      try {
        const r = await fetch(
          `/api/v2/meetings/${id}/agent-messages/${messageId}/citations`,
          { credentials: "include", headers: { accept: "application/json" } },
        );
        if (!r.ok) {
          // 静默兜底 — sheet 显示 MAEmpty "本条 AI 发言无引用"
          setCitations([]);
          return;
        }
        const data = (await r.json()) as { citations: KBCitation[] };
        setCitations(data.citations || []);
      } catch {
        setCitations([]);
      } finally {
        setCitationsLoading(false);
      }
    },
    [id],
  );

  const handleCloseCitationSheet = useCallback(() => {
    setCitationSheetOpen(false);
    // 不立即 reset target — 留给 sheet 动画 完成 后 自然 unmount, 避免 闪
  }, []);

  const [data, setData] = useState<MobileMeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [starting, setStarting] = useState(false);

  // sheets / modals
  const [summonOpen, setSummonOpen] = useState(false);
  const [summoning, setSummoning] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [askHostOpen, setAskHostOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  // dock controls (TD5 — 录音状态合进 mic CtrlBtn; mic toggle 仅 UI, recording 也仅 UI)
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(false);
  const [hand, setHand] = useState(false);
  const [cc, setCC] = useState(true);

  // FAB / 筛选
  const [showJump, setShowJump] = useState(false);
  const [filterSelected, setFilterSelected] = useState<Set<string>>(new Set());
  const [matchedCount, setMatchedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const jumpToRef = useRef<((key: string) => void) | null>(null);

  // round-2: 紧凑上下文条 (40px) 折叠 state.
  //   - 默认 expanded = true (mount peek)
  //   - 2.5s 后自动 collapse (除非用户手动 toggle 过)
  //   - 滚动 transcript > 24px 时也自动 collapse
  //   - 用户手动 toggle 后, 不再自动 collapse (尊重用户意图)
  const [ctxExpanded, setCtxExpanded] = useState(true);
  const ctxUserToggledRef = useRef(false);

  // round-3: 资料 — 页面层 own attachments state + 4 个 sheet 控制位.
  // 设计稿 把 资料 折叠 进 CompactContextExpandable, 跟 议程 / 参与人 一起 收起.
  const [attachments, setAttachments] = useState<MeetingAttachmentOut[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsSheetOpen, setMaterialsSheetOpen] = useState(false);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [previewingMaterial, setPreviewingMaterial] =
    useState<Material | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!ctxUserToggledRef.current) setCtxExpanded(false);
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  const toggleCtxBar = useCallback(() => {
    ctxUserToggledRef.current = true;
    setCtxExpanded((p) => !p);
  }, []);

  // host cards (inline) — 由 WS event 推进 + agenda_advanced 出 chapter
  const [hostCards, setHostCards] = useState<TimelineHostItem[]>([]);
  const [severeOffTopic, setSevereOffTopic] = useState<SevereData | null>(null);

  // 事件去重 — 10s 内同 kind skip
  const lastEventTsRef = useRef<Map<string, number>>(new Map());
  const DEDUP_WINDOW_MS = 10_000;

  // timer (mm:ss)
  const [timerText, setTimerText] = useState("00:00");
  useEffect(() => {
    if (!data || data.status !== "ongoing") return;
    const baseSec = data.started_minutes_ago * 60;
    const startAt = Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const total = baseSec + elapsed;
      const mm = String(Math.floor(total / 60)).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      setTimerText(`${mm}:${ss}`);
    };
    tick();
    const it = setInterval(tick, 1000);
    return () => clearInterval(it);
  }, [data]);

  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // round-3: 资料 — 拉取 / 删除 (依赖 setToast, 故放在 toast state 之后)
  const refreshAttachments = useCallback(async () => {
    try {
      const r = await mApi.listMeetingAttachments(id);
      setAttachments(r.items);
      setMaterials(adaptAttachmentsToMaterials(r.items));
    } catch (e) {
      // 静默 — 拉 list 失败 不影响 别的功能
      console.warn("materials list failed", e);
    }
  }, [id]);

  useEffect(() => {
    void refreshAttachments();
  }, [refreshAttachments]);

  // 5s 轮询 — 有 extracting / pending 时 重拉
  useEffect(() => {
    const has = attachments.some(
      (a) =>
        a.extract_status === "extracting" || a.extract_status === "pending",
    );
    if (!has) return;
    const t = setInterval(() => void refreshAttachments(), 5000);
    return () => clearInterval(t);
  }, [attachments, refreshAttachments]);

  // visibility-change → 从 小程序 picker 跳回 H5 时 重拉 (兼容旧 P19-B)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshAttachments();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshAttachments]);

  const handleDeleteMaterial = useCallback(
    async (m: Material) => {
      if (!confirm(`删除 「${m.name}」?`)) return;
      try {
        await mApi.deleteMeetingAttachment(m.id);
        await refreshAttachments();
        setToast({ kind: "success", text: "已删除" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast({ kind: "error", text: `删除失败: ${msg}` });
      }
    },
    [refreshAttachments],
  );

  const materialsCount = materials.length;
  const materialsHasNewFlag = hasNewMaterial(materials);

  const reload = useCallback(async () => {
    try {
      const d = await mApi.getMeetingDetail(id);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const handleAdvance = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      await mApi.advanceAgenda(id);
      await reload();
      setToast({ kind: "success", text: "议程已推进" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `推进失败: ${msg}` });
    } finally {
      setAdvancing(false);
    }
  }, [advancing, id, reload]);

  const handleStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      await mApi.startMeeting(id);
      await reload();
      setToast({ kind: "success", text: "会议已开始" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `开始失败: ${msg}` });
    } finally {
      setStarting(false);
    }
  }, [starting, id, reload]);

  const handleSummonSubmit = useCallback(
    async (agentId: string, query: string) => {
      if (summoning) return;
      setSummoning(true);
      try {
        const res = await mApi.summonAgent(id, agentId, query || undefined);
        setSummonOpen(false);
        setToast({
          kind: "success",
          text: `已请 ${res.agent_name} 发言, 转录区可看实时打字`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast({ kind: "error", text: `召唤专家失败: ${msg}` });
      } finally {
        setSummoning(false);
      }
    },
    [summoning, id],
  );

  const handleEndConfirm = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await mApi.finalizeMeeting(id);
      setEndOpen(false);
      router.push(`/m/meetings/${id}/summary`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `结束失败: ${msg}` });
      setEnding(false);
    }
  }, [ending, id, router]);

  const { sendJson } = useMeetingWsSend();
  const handleSummonAgent = useCallback(
    (agentId: string, query?: string) => {
      sendJson({
        action: "invoke_agent",
        agent_id: agentId,
        query: query || undefined,
      });
      setToast({ kind: "success", text: "已召唤主持人, 转录区可看回复" });
    },
    [sendJson],
  );

  // ─── WS event mapping (R1: 6 类 → 3 级 + chapter) ───
  const handleWsEvent = useCallback(
    (e: import("@/lib/sttSocket").SttEvent) => {
      // P18 守卫: 非 ongoing 会议忽略议程类事件
      const isAgendaEvt =
        e.type.startsWith("agenda_") || e.type === "dissent_detected";
      if (isAgendaEvt && data?.status !== "ongoing") {
        return;
      }

      const dedupKey = e.type;
      const lastTs = lastEventTsRef.current.get(dedupKey) ?? 0;
      const now = Date.now();
      const isDedupable = [
        "agenda_off_topic",
        "agenda_time_warning",
        "agenda_stuck",
        "dissent_detected",
        "agenda_decision_summary",
        "agenda_advance_suggested",
      ].includes(e.type);
      if (isDedupable && now - lastTs < DEDUP_WINDOW_MS) return;
      if (isDedupable) lastEventTsRef.current.set(dedupKey, now);

      const tNow = nowAtMinute();
      const tLabel = formatT(timerText);

      switch (e.type) {
        case "agenda_advanced": {
          // 加 chapter divider 到 host cards
          if (e.is_complete) {
            setToast({ kind: "success", text: "议程已全部走完" });
          }
          void reload();
          // 把 chapter 也加进 timeline 中 (R4 — 用 event 字段, 不解析文本)
          const items = data?.agenda_items || [];
          const newItem = items[e.to_idx];
          if (newItem) {
            const chapter: TimelineHostItem = {
              kind: "chapter",
              key: `chapter-${e.to_idx}-${now}`,
              at_minute: tNow,
              newAgendaNumber: e.to_idx + 1,
              totalAgenda: items.length,
              newAgendaTitle: newItem.title,
              agendaMinutes: newItem.time_budget_min,
              t: tLabel,
            };
            setHostCards((prev) => [...prev, chapter]);
          }
          break;
        }
        case "agenda_off_topic": {
          if (e.off_topic_severity === "severe") {
            // severe → 全屏 modal (TD4 — 仍保留 modal)
            setSevereOffTopic({
              offTopicSummary: e.off_topic_summary,
              currentAgendaItem: e.current_agenda_item,
              suggestedAgendaItem: e.suggested_agenda_item,
              moderatorAgentId: e.moderator_agent_id,
              moderatorAgentName:
                e.moderator_agent_nickname || e.moderator_agent_name,
              moderatorAgentColor: e.moderator_agent_color,
              invokeQuery: e.reason,
              autoSummonAfterSec: e.auto_summon_after_s ?? 30,
            });
            // 同时 inline 一张 drift-strong 红卡到 transcript
            const banner: BannerData = {
              kind: "off_topic",
              tone: "drift-strong",
              title: "议题严重偏离 · 需立即处理",
              body: e.off_topic_summary,
              t: tLabel,
              agentId: e.moderator_agent_id,
              agentName:
                e.moderator_agent_nickname || e.moderator_agent_name,
              agentColor: e.moderator_agent_color,
              invokeQuery: e.reason,
              countdown: null,
              autoSummonSec: null,
            };
            pushBanner(banner, tNow);
          } else {
            // suspected/confirmed → drift-soft / drift
            const tone: BannerData["tone"] =
              e.off_topic_severity === "suspected" ? "drift-soft" : "drift";
            const banner: BannerData = {
              kind: "off_topic",
              tone,
              title:
                tone === "drift-soft"
                  ? "话题似乎偏移 · 持续观察中"
                  : "话题偏移 · 中度提醒",
              body:
                e.off_topic_summary ||
                `当前议题: ${e.current_agenda_item || "(未指定)"}`,
              t: tLabel,
              agentId: e.moderator_agent_id,
              agentName:
                e.moderator_agent_nickname || e.moderator_agent_name,
              agentColor: e.moderator_agent_color,
              invokeQuery: e.reason,
              autoSummonSec: null,
            };
            pushBanner(banner, tNow);
          }
          break;
        }
        case "agenda_time_warning": {
          const banner: BannerData = {
            kind: "time_warning",
            tone: "timer",
            title: `时间快用完 (已 ${e.elapsed_min} 分钟)`,
            body: e.time_warning_text,
            t: tLabel,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            agentColor: e.moderator_agent_color,
            invokeQuery: e.reason,
            autoSummonSec: null,
          };
          pushBanner(banner, tNow);
          break;
        }
        case "agenda_stuck": {
          const banner: BannerData = {
            kind: "stuck",
            tone: "drift",
            title: "议题卡住了",
            body: e.stuck_summary,
            t: tLabel,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            agentColor: e.moderator_agent_color,
            invokeQuery: e.reason,
            autoSummonSec: e.auto_summon_after_s,
          };
          pushBanner(banner, tNow);
          break;
        }
        case "dissent_detected": {
          const banner: BannerData = {
            kind: "dissent",
            tone: "drift",
            title: `${e.parties.join(" vs ")} 出现分歧`,
            body: `${e.topic} — ${e.reason}`,
            t: tLabel,
            agentId: e.suggested_agent_id,
            agentName: e.suggested_agent_nickname || e.suggested_agent_name,
            agentColor: e.suggested_agent_color,
            invokeQuery: e.reason,
            autoSummonSec: null,
          };
          pushBanner(banner, tNow);
          break;
        }
        case "agenda_decision_summary": {
          const banner: BannerData = {
            kind: "decision_summary",
            tone: "route",
            title: "该收口决策了",
            body: e.decision_brief,
            t: tLabel,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            agentColor: e.moderator_agent_color,
            invokeQuery: e.decision_summary_query,
            autoSummonSec: e.auto_summon_after_s,
          };
          pushBanner(banner, tNow);
          break;
        }
        case "agenda_advance_suggested": {
          const banner: BannerData = {
            kind: "advance_suggested",
            tone: "route",
            title: "AI 建议推进议程",
            body: e.advance_reason,
            t: tLabel,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            agentColor: e.moderator_agent_color,
            invokeQuery: e.reason,
            advanceTargetIdx: e.next_agenda_idx,
            canAdvance: data?.can_control ?? false,
            autoSummonSec: null,
          };
          pushBanner(banner, tNow);
          break;
        }
        case "orchestrate_phase_change": {
          // v1.4.0 Saga E.E2 (Sprint 3): auto 会议 orchestrator state 增量 推到
          // detail (省 2.5s 轮询). 只 patch 受影响 的 4 个字段; 其余 detail
          // 字段 仍 走 fallback 轮询 / 用户主动 reload (议程标题 / can_control 等
          // 不会因 orchestrator turn 改变).
          //
          // current_agenda_idx 来自 orchestrator state — 跟 meeting.current_agenda_idx
          // (手动 advanceAgenda 走 endpoint) 在 auto 模式 下 由 orchestrator
          // 自己 推进, 这里 直接 跟 orchestrator 同步.
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              orchestrate_phase: e.phase,
              current_speaker_agent_id: e.current_speaker_agent_id,
              current_agenda_idx:
                e.current_agenda_idx !== null
                  ? e.current_agenda_idx
                  : prev.current_agenda_idx,
              orchestrate_turn_count: e.turn_count,
            };
          });
          break;
        }
        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, data?.can_control, data?.status, timerText],
  );
  useMeetingWsEvent(handleWsEvent);

  // 把 banner 转成 TimelineHostItem 并 push 进 hostCards
  const pushBanner = useCallback((banner: BannerData, atMinute: number) => {
    const key = `host-banner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const item: TimelineHostItem = {
      kind: "host",
      key,
      at_minute: atMinute,
      tone: banner.tone,
      title: banner.title,
      body: banner.body,
      t: banner.t,
      countdown: banner.countdown,
      agentName: banner.agentName,
      agentColor: banner.agentColor,
      render: () => (
        <AgendaEventBanner
          data={banner}
          onDismiss={() =>
            setHostCards((prev) => prev.filter((h) => h.key !== key))
          }
          onSummonAgent={handleSummonAgent}
          onAdvanceAgenda={handleAdvance}
        />
      ),
    };
    setHostCards((prev) => [...prev, item]);
  }, [handleAdvance, handleSummonAgent]);

  useEffect(() => {
    let alive = true;
    mApi
      .getMeetingDetail(id)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message || "load failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // v1.4.0 Saga E.E (Sprint 2-3): auto 会议 2.5s 轮询 meeting detail —
  // backend 把 orchestrate_phase + current_speaker_agent_id 揉进 detail 返回,
  // 不再 单独 调 /orchestrate/state (省 round-trip).
  //
  // v1.4.0 Saga E.E2 (Sprint 3) 升级: WS bus 接 orchestrate_phase_change 事件 →
  // 轮询 退到 fallback (conn !== 'connected' 才跑). WS 正常 时 完全 不轮询, P95
  // 延迟 5-17s → <500ms. WS 掉线 时 自动 切回 2.5s 拉, 保 Sprint 2-3 体验下限.
  //
  // 终态切换通过 WS phase_change 或下一次 fallback poll 写回 setData 触发 effect
  // re-run, 自动 stop.
  const isAutoMode = data?.mode === "auto";
  const isOrchestrateFinal =
    data?.orchestrate_phase === "done" ||
    data?.orchestrate_phase === "failed" ||
    data?.orchestrate_phase === "cancelled";
  const wsConnected = conn === "connected";
  useEffect(() => {
    if (!isAutoMode || isOrchestrateFinal) return;
    if (wsConnected) return; // WS 接管 — 不开 fallback 轮询
    const h = setInterval(() => {
      mApi
        .getMeetingDetail(id)
        .then((d) => setData(d))
        .catch(() => {
          // 静默 — 单次拉失败 不影响 UI
        });
    }, 2500);
    return () => clearInterval(h);
  }, [id, isAutoMode, isOrchestrateFinal, wsConnected]);

  // ─── speaker 集合 (filter sheet 用) ───
  const filterSpeakers = useMemo<{
    hosts: FilterSpeaker[];
    humans: FilterSpeaker[];
    ais: FilterSpeaker[];
  }>(() => {
    const hosts: FilterSpeaker[] = [mockHostAsSpeaker()];
    // 真实 attending_agents (后端) — 用 agent_id 作 key
    const ais: FilterSpeaker[] = (data?.attending_agents || []).map((a) => ({
      key: a.agent_id,
      name: a.nickname?.trim() || a.name,
      sub: a.domain || a.role,
      kind: "ai" as const,
      agentColor: a.color,
    }));
    // 加 mock 6 AI 作 demo
    mockAisAsSpeakers().forEach((sp) => {
      if (!ais.some((x) => x.key === sp.key)) ais.push(sp);
    });
    // humans — 暂没真实 attendee_user_ids API; 用 mock 5 人作 demo
    // TD9: mock 真人仅显示在筛选 sheet (好让用户看到 UI), 不影响真实 transcript
    const humans: FilterSpeaker[] = [];
    return { hosts, humans, ais };
  }, [data?.attending_agents]);

  const speakerByKey = useMemo(() => {
    const m = new Map<string, FilterSpeaker>();
    [
      ...filterSpeakers.hosts,
      ...filterSpeakers.humans,
      ...filterSpeakers.ais,
    ].forEach((sp) => m.set(sp.key, sp));
    return m;
  }, [filterSpeakers]);

  // ─── speaker 发言计数 ───
  // v1.4.0 Phase A · 1: 旧 mock round 计数已撤; filterCounts 仅 host card 来源.
  // 真 user/agent line 计数 由 MeetingTranscriptView 内部 lines state 自行 derive
  // (filter 不预先 显数, 命中后 banner 显 X/Y 即可).
  const filterCounts: Record<string, number> = useMemo(() => {
    const c: Record<string, number> = {};
    c["host"] = hostCards.length;
    return c;
  }, [hostCards.length]);

  // ─── highlights (mock + host cards + round) ───
  const highlights = useMemo<HighlightItem[]>(() => {
    const hl: HighlightItem[] = [];
    hostCards.forEach((h) => {
      if (h.kind === "chapter") {
        hl.push({
          jumpKey: h.key,
          type: "agenda",
          icon: "check",
          color: MR_COLORS.systemGreen,
          label: "议程切换",
          title: h.newAgendaTitle,
          t: h.t,
        });
      } else if (h.tone === "drift-strong") {
        hl.push({
          jumpKey: h.key,
          type: "strong",
          icon: "compass",
          color: MR_COLORS.systemRed,
          label: "强提醒",
          title: h.title || "议题严重偏离",
          t: h.t || "",
        });
      } else if (h.tone === "drift" || h.tone === "drift-soft") {
        hl.push({
          jumpKey: h.key,
          type: "drift",
          icon: "compass",
          color: MR_COLORS.systemOrange,
          label: "偏离提醒",
          title: h.title || "话题偏移",
          t: h.t || "",
        });
      } else if (h.tone === "route") {
        hl.push({
          jumpKey: h.key,
          type: "route",
          icon: "route",
          color: MR_COLORS.systemOrange,
          label: "问题路由",
          title: h.title || "问题拆解",
          t: h.t || "",
        });
      } else if (h.tone === "timer") {
        hl.push({
          jumpKey: h.key,
          type: "decision",
          icon: "clock",
          color: MR_COLORS.systemOrange,
          label: "时间提醒",
          title: h.title || "时间提醒",
          t: h.t || "",
        });
      }
    });
    // v1.4.0 Phase A · 1: 旧 mock round highlight chip 已撤. 真 agent_message_*
    // WS event 直接进 transcript lines, 不再 在 highlights 派生 "AI 圆桌"
    // (NEW-A roundtable assembly 是 Phase B/C 任务, 这里 honest 留白).
    return hl;
  }, [hostCards]);

  // ─── 主持人 (用 attending_agents 里第一个 role='moderator' 的, 否则 fallback 第一个 AI) ───
  const moderatorId = useMemo<string | null>(() => {
    const agents = data?.attending_agents || [];
    const mod = agents.find((a) => (a.role || "").toLowerCase() === "moderator");
    return mod ? mod.agent_id : (agents[0]?.agent_id ?? null);
  }, [data?.attending_agents]);

  // ─── live 状态 ───
  const liveState: "live" | "reconnecting" | "lost" | "idle" =
    conn === "connected"
      ? "live"
      : conn === "reconnecting"
        ? "reconnecting"
        : conn === "giving_up"
          ? "lost"
          : "idle";

  // ─── loading / error ───
  if (loading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: MR_COLORS.bgGroupedPrimary,
          padding: 16,
          fontFamily: MR_FONT_FAMILY,
        }}
      >
        <div
          style={{
            height: 50,
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            marginBottom: 8,
            opacity: 0.6,
          }}
        />
        <div
          style={{
            height: 80,
            background: MR_COLORS.bgWhite,
            borderRadius: 12,
            opacity: 0.6,
          }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          padding: 24,
          textAlign: "center",
          background: MR_COLORS.bgGroupedPrimary,
          color: MR_COLORS.textPrimary,
          fontFamily: MR_FONT_FAMILY,
        }}
      >
        <p style={{ fontSize: 15, marginTop: 40 }}>未能加载会议</p>
        <p
          style={{
            fontSize: 13,
            marginTop: 8,
            color: MR_COLORS.textTertiary,
          }}
        >
          {error}
        </p>
        <a
          href="/m"
          style={{
            display: "inline-flex",
            marginTop: 24,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            padding: "0 24px",
            background: MR_COLORS.bgWhite,
            border: `0.5px solid ${MR_COLORS.hairline}`,
            color: MR_COLORS.systemBlue,
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          回工作台
        </a>
      </div>
    );
  }

  const handleBack = () => {
    if (data.status === "ongoing") setLeaveOpen(true);
    else router.push("/m");
  };
  const handleAskHostSend = (query: string) => {
    if (!moderatorId) {
      setToast({ kind: "error", text: "找不到主持人 AI, 请先邀请" });
      return;
    }
    handleSummonAgent(moderatorId, query);
  };

  // 参会人头像列 — 真实 attending_agents
  const stripAgents = (data.attending_agents || []).map((a) => ({
    agent_id: a.agent_id,
    display: a.nickname?.trim() || a.name,
    role: a.domain || a.role,
    color: a.color,
  }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        background: MR_COLORS.bgGroupedPrimary,
        color: MR_COLORS.textPrimary,
        fontFamily: MR_FONT_FAMILY,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ===== Header ===================================== */}
      <MRHeader
        title={data.title}
        timerText={timerText}
        liveState={liveState}
        filterActive={filterSelected.size > 0}
        onBack={handleBack}
        onChapters={() => setChaptersOpen(true)}
        onFilter={() => setFilterOpen(true)}
      />

      {/* ===== round-2: 紧凑上下文条 (40px 触发) =========== */}
      <CompactContextBar
        agendaItems={data.agenda_items}
        currentAgendaIdx={data.current_agenda_idx}
        isAgendaComplete={data.is_agenda_complete}
        materialsCount={materialsCount}
        materialsHasNew={materialsHasNewFlag}
        participantHumans={(Object.keys(MOCK_HUMANS) as MockHumanId[]).map(
          (id) => ({
            id,
            color: MOCK_HUMANS[id].color,
            name: MOCK_HUMANS[id].name,
          }),
        )}
        aiCount={stripAgents.length}
        isLive={liveState === "live"}
        expanded={ctxExpanded}
        onToggle={toggleCtxBar}
      />

      {/* ===== round-2/3: 折叠区 (peek-then-tuck) ============
        round-3: 把 MaterialsStrip 加入 折叠区, 跟 议程 / 参与人 一起折叠.
        PM 原话: "参考资料的显示应该是被一起折叠". */}
      <CompactContextExpandable expanded={ctxExpanded}>
        {/* ===== Agenda strip =============================== */}
        <StageChipsRow
          items={data.agenda_items}
          currentIdx={data.current_agenda_idx}
          isComplete={data.is_agenda_complete}
        />

        {/* ===== Materials strip (round-3 新增) ============== */}
        <MaterialsStrip
          materials={materials}
          onOpen={() => setMaterialsSheetOpen(true)}
          onUpload={() => setUploadSheetOpen(true)}
          readOnly={data.status !== "ongoing"}
        />

        {/* ===== Participants strip ========================= */}
        <ParticipantsStrip agents={stripAgents} />
      </CompactContextExpandable>

      {/* ===== scheduled 状态 (开始会议兜底卡) ============ */}
      {data.status === "scheduled" ? (
        <main style={{ flex: 1, padding: 16, overflow: "auto" }}>
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${MR_COLORS.hostBorder}`,
              background: MR_COLORS.hostBg,
              padding: 20,
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: "#8B6914",
              }}
            >
              会议还没开始
            </p>
            <p
              style={{
                marginTop: 8,
                fontSize: 14,
                color: MR_COLORS.textSecondary,
                lineHeight: 1.5,
              }}
            >
              点下方按钮把会议状态切到「进行中」, AI 召唤 / 议程推进 等功能就能用了.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              data-testid="mobile-start-meeting"
              style={{
                marginTop: 16,
                height: 48,
                width: "100%",
                borderRadius: 12,
                border: "none",
                background: MR_COLORS.systemOrange,
                color: "#fff",
                fontSize: 15,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: starting ? "default" : "pointer",
                opacity: starting ? 0.6 : 1,
              }}
            >
              {starting ? "开始中…" : "开始会议"}
            </button>
          </div>
        </main>
      ) : (
        <>
          {/* finished / processed 提示 + 看总结链接 */}
          {data.status === "finished" || data.status === "processed" ? (
            <div
              style={{
                margin: "12px 16px 0",
                padding: 14,
                borderRadius: 14,
                background: "rgba(52,199,89,0.10)",
                border: "0.5px solid rgba(52,199,89,0.30)",
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "#1A6B2A",
                }}
              >
                ✓ 会议已结束
              </p>
              <p
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: MR_COLORS.textSecondary,
                  lineHeight: 1.5,
                }}
              >
                以下是过程数据 (转录 + 议程). 想看 AI 纪要 + 抽出的待办, 进总结页.
              </p>
              <a
                href={`/m/meetings/${id}/summary`}
                data-testid="mobile-view-summary-link"
                style={{
                  display: "flex",
                  marginTop: 10,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  background: MR_COLORS.systemGreen,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                看会议总结 →
              </a>
            </div>
          ) : null}

          {/* native entry (小程序 webview 才显) */}
          {data.status === "ongoing" ? (
            <NativeMeetingEntry meetingId={id} />
          ) : null}

          {/* round-3: 资料 区 不再 独立 渲染 在 main body —
              已 移入 上方 CompactContextExpandable 内的 MaterialsStrip,
              跟 议程 / 参与人 一起折叠 (PM round-3 设定). */}

          {/* ===== 主滚动区 (transcript + host cards + round) ===== */}
          <main
            data-testid="mobile-im-flow"
            onScroll={(e) => {
              // round-2: 滚动 > 24px 时 自动收起紧凑上下文条
              // (沿用 round-2 设计 — 始终自动收, 用户想看再点条手动展)
              const el = e.currentTarget;
              if (ctxExpanded && el.scrollTop > 24) {
                setCtxExpanded(false);
              }
            }}
            style={{
              flex: 1,
              overflow: "auto",
              paddingBottom: 200,
              position: "relative",
            }}
          >
            <FilterBanner
              selected={filterSelected}
              speakerByKey={speakerByKey}
              matched={matchedCount}
              total={totalCount}
              onChange={setFilterSelected}
              onOpen={() => setFilterOpen(true)}
            />
            {/* v1.4.0 Saga E.E (Sprint 2-3): mode='auto' 会议 顶部显 orchestrator
              *  状态横幅 (phase / 议程进度 / 当前发言 agent). hybrid/human 不显. */}
            {data.mode === "auto" ? (
              <OrchestrateStatusBanner
                phase={data.orchestrate_phase}
                completedAgenda={data.orchestrate_completed_agenda_count}
                totalAgenda={data.agenda_items.length}
                currentAgendaIdx={data.current_agenda_idx}
                currentAgendaTitle={data.current_topic_title}
                activeSpeakerAgentId={data.current_speaker_agent_id}
                attendingAgents={data.attending_agents}
              />
            ) : null}
            <MeetingTranscriptView
              meetingId={id}
              hostCards={hostCards}
              /* v1.4.0 Phase A · 1 (NORTH_STAR § 6.1): MOCK_ROUND_MESSAGES UI 已撤.
               *  所有 模式 (auto / hybrid / human) 一律 走 真 agent_message_* WS event
               *  或 /transcript 拉 final lines. 不再 注入 demo 圆桌卡. */
              /* v1.4.0 Saga E.E: 仅 auto && 非终态 时 拉 transcript (orchestrator 不走 WS,
               *  必须 主动 poll). hybrid 走 WS, pollIntervalMs=0 即 disabled. */
              pollIntervalMs={
                data.mode === "auto" &&
                data.orchestrate_phase !== "done" &&
                data.orchestrate_phase !== "failed" &&
                data.orchestrate_phase !== "cancelled"
                  ? 2500
                  : 0
              }
              activeSpeakerAgentId={
                data.mode === "auto" &&
                data.orchestrate_phase === "running"
                  ? data.current_speaker_agent_id
                  : null
              }
              onCitationClick={handleCitationClick}
              focusKey={focusKey}
              filter={{ selected: filterSelected }}
              onMatchedCountChange={(matched, total) => {
                setMatchedCount(matched);
                setTotalCount(total);
              }}
              onRegisterJump={(jump) => {
                jumpToRef.current = jump;
              }}
              onScrollPosChange={(atBottom) => setShowJump(!atBottom)}
            />
          </main>

          <JumpToLatestFab
            visible={showJump}
            alert={false}
            onClick={() => {
              // 滚到 main 底部
              const mainEl = document.querySelector<HTMLElement>(
                '[data-testid="mobile-im-flow"]',
              );
              mainEl?.scrollTo({
                top: mainEl.scrollHeight,
                behavior: "smooth",
              });
            }}
          />

          {/* ===== Dock (sticky 底部 controls) ===== */}
          {data.status === "ongoing" ? (
            <StickyActionBar
              canControl={data.can_control}
              isAgendaComplete={data.is_agenda_complete}
              currentTopicTitle={data.current_topic_title}
              hasRiskInsight={false}
              advancing={advancing}
              onAdvance={handleAdvance}
              onSummonAi={() => setSummonOpen(true)}
              onAskHost={() => setAskHostOpen(true)}
              onMore={() => setMoreOpen(true)}
              onEndMeeting={() => setEndOpen(true)}
              muted={muted}
              setMuted={setMuted}
              video={video}
              setVideo={setVideo}
              hand={hand}
              setHand={setHand}
              cc={cc}
              setCC={setCC}
              recording={false}
            />
          ) : null}
        </>
      )}

      {/* ===== Sheets / Modals / Toast ============== */}
      <SummonAgentSheet
        open={summonOpen}
        agents={data.attending_agents}
        busy={summoning}
        onClose={() => setSummonOpen(false)}
        onSubmit={handleSummonSubmit}
      />
      <AskHostSheet
        open={askHostOpen}
        onClose={() => setAskHostOpen(false)}
        onSendToHost={handleAskHostSend}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onAction={(k) => {
          setToast({ kind: "success", text: `${k}: 该功能后续上线` });
        }}
        hand={hand}
        setHand={setHand}
        cc={cc}
        setCC={setCC}
      />
      <FilterSheet
        open={filterOpen}
        selected={filterSelected}
        counts={filterCounts}
        speakers={filterSpeakers}
        onChange={setFilterSelected}
        onClose={() => setFilterOpen(false)}
      />
      <HighlightsSheet
        open={chaptersOpen}
        highlights={highlights}
        onClose={() => setChaptersOpen(false)}
        onJump={(k) => {
          jumpToRef.current?.(k);
        }}
      />
      <EndConfirm
        open={endOpen}
        busy={ending}
        onConfirm={handleEndConfirm}
        onCancel={() => setEndOpen(false)}
      />
      <SevereOffTopicModal
        data={severeOffTopic}
        onSummon={handleSummonAgent}
        onDismiss={() => setSevereOffTopic(null)}
      />
      {/* round-3: 资料 sheets + 全屏 预览 (PM 强调 严格 按设计稿) */}
      <MaterialsSheet
        open={materialsSheetOpen}
        materials={materials}
        readOnly={data.status !== "ongoing"}
        onClose={() => setMaterialsSheetOpen(false)}
        onPreview={(m) => {
          setMaterialsSheetOpen(false);
          setPreviewingMaterial(m);
        }}
        onUpload={() => {
          setMaterialsSheetOpen(false);
          setUploadSheetOpen(true);
        }}
        onDelete={(m) => void handleDeleteMaterial(m)}
      />
      <UploadSheet
        open={uploadSheetOpen}
        meetingId={id}
        onClose={() => setUploadSheetOpen(false)}
        onComplete={() => void refreshAttachments()}
      />
      {previewingMaterial ? (
        <FilePreview
          file={previewingMaterial}
          attachmentId={previewingMaterial.id}
          extractSummary={
            attachments.find((a) => a.id === previewingMaterial.id)
              ?.extract_summary ?? null
          }
          extractStatus={
            attachments.find((a) => a.id === previewingMaterial.id)
              ?.extract_status
          }
          onClose={() => setPreviewingMaterial(null)}
        />
      ) : null}

      {/* v1.4.0 Sprint 3 Mobile Part 1 (NORTH_STAR § 3.2): KB 引用侧栏 — AI 发言
          点 "引用 N 条 KB" → 弹此 sheet. 半屏, 不全屏. */}
      <KBCitationSheet
        open={citationSheetOpen}
        onClose={handleCloseCitationSheet}
        citations={citations}
        speakerLabel={citationTarget?.speakerLabel}
        loading={citationsLoading}
      />

      <LeaveMeetingSheet
        open={leaveOpen}
        meetingTitle={data.title}
        endingMeeting={ending}
        onJustLeave={() => {
          setLeaveOpen(false);
          router.push("/m");
        }}
        onEndMeeting={() => {
          void handleEndConfirm();
        }}
        onCancel={() => setLeaveOpen(false)}
      />
      {toast ? (
        <Toast
          kind={toast.kind}
          text={toast.text}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

// ─── small utils ───

function nowAtMinute(): number {
  // 当前时间转分钟 (用 Date.now() 不精确, 但用于排序足够)
  return Math.floor(Date.now() / 60000);
}

function formatT(mmss: string): string {
  // mmss "23:14" → return as-is. 后续接 backend timestamp 时再扩展.
  return mmss;
}
