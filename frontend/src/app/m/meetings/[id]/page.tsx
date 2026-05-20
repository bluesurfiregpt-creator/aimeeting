"use client";

/**
 * v27.0-mobile · /m/meetings/[id] · 会议室内推进视图.
 *
 * 整屏结构 (上 → 下):
 *   1. TopBar — ← 返 / 标题 / ⋮ (复用 mobile 主 layout TopBar 的替换 — 见下)
 *   2. StageChipsRow — sticky 议程 5 阶段 chip (横滑)
 *   3. 当前议题主卡 (CurrentTopicCard) — 含 AI 智囊突出块 + 真人 list
 *   4. 折叠其他议题 / 实时转录 (Phase 2 展开)
 *   5. StickyActionBar — 底部 sticky next action
 *
 * Phase 1 MVP — 决策操作 onClick 仅 alert 占位, Phase 2 接 in-card decision
 * + advance + summon-ai 实操作 API.
 */

import { useCallback, useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AttachmentsSection from "@/components/mobile/AttachmentsSection";
import StageChipsRow from "@/components/mobile/StageChipsRow";
import StickyActionBar from "@/components/mobile/StickyActionBar";
import SummonAgentSheet from "@/components/mobile/SummonAgentSheet";
import ConfirmDialog from "@/components/mobile/ConfirmDialog";
import MeetingTranscriptView from "@/components/mobile/MeetingTranscriptView";
import MeetingRecorderControl from "@/components/mobile/MeetingRecorderControl";
import LeaveMeetingSheet from "@/components/mobile/LeaveMeetingSheet";
import AgendaEventBanner, {
  type BannerData,
} from "@/components/mobile/AgendaEventBanner";
import SevereOffTopicModal, {
  type SevereData,
} from "@/components/mobile/SevereOffTopicModal";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import {
  MeetingWsProvider,
  useMeetingWsEvent,
  useMeetingWsSend,
} from "@/lib/mobile/meetingWsBus";
import type { MobileMeetingDetail } from "@/lib/mobile/types";

function isRiskInsight(insights: { type: string }[]): boolean {
  return insights.some((i) => i.type === "风险");
}

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
  const router = useRouter();
  const [data, setData] = useState<MobileMeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [starting, setStarting] = useState(false);
  // P4.2: 召 AI sheet + 结束会议 dialog
  const [summonOpen, setSummonOpen] = useState(false);
  const [summoning, setSummoning] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  // P14.2 退出会议室 sheet (ongoing 时点 ← 弹)
  const [leaveOpen, setLeaveOpen] = useState(false);
  // P5B → P16: 议程事件 banner (6 类), 单 slot 新覆盖旧
  const [banner, setBanner] = useState<BannerData | null>(null);
  // P16: severe off_topic 全屏 modal 独立 slot
  const [severeOffTopic, setSevereOffTopic] = useState<SevereData | null>(null);
  // P16: 事件去重 — 10s 内同 kind 重复事件 skip
  const lastEventTsRef = useRef<Map<string, number>>(new Map());
  const DEDUP_WINDOW_MS = 10_000;
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

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

  /** P9: scheduled → ongoing — 把还在预约的会议正式开始 */
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

  /** 召 AI: 弹 sheet 选 agent → submit → 调 API → toast.
   *  P5B: 不再 setTimeout reload — WS 自动推 agent_message_chunk 实时 streaming
   *  显示在转录区. 用户展开转录折叠即可看 AI 打字.
   */
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

  /** 结束会议: 弹 confirm → 确认 → 调 finalize → 跳总结页 (不是首页) */
  const handleEndConfirm = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await mApi.finalizeMeeting(id);
      setEndOpen(false);
      // P17: 跳总结页 /m/meetings/<id>/summary 看 AI 纪要 + 抽出的待办,
      // 而不是直接回首页 (用户反馈: 回首页太迷茫, 不知道刚开完会的结果在哪).
      // 总结页内有 "回工作台" 按钮让用户决定下一步.
      router.push(`/m/meetings/${id}/summary`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `结束失败: ${msg}` });
      setEnding(false);
    }
  }, [ending, id, router]);

  // P16 召唤主持人 — banner / modal CTA 共用. 直接走 WS sendJson invoke_agent
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

  // P16 advance_suggested 一键推进 — 复用 handleAdvance
  // (在文件下方定义, 这里 forward declaration via late binding)

  // P5B → P16: WS 订阅. 6 类议程事件 + severe modal + dedup.
  const handleWsEvent = useCallback(
    (e: import("@/lib/sttSocket").SttEvent) => {
      // P18 守卫: 非 ongoing 会议忽略议程类事件 (finished 还会收到延迟事件,
      // 但 user 已经不在 actively 推进, 不该弹 banner / 召唤按钮).
      // transcript_persisted / agent_message_* 仍允许 (查看历史也合理).
      const isAgendaEvt = e.type.startsWith("agenda_") || e.type === "dissent_detected";
      if (isAgendaEvt && data?.status !== "ongoing") {
        return;
      }

      // 去重: 同 type 10s 内重复 skip
      const dedupKey = e.type;
      const lastTs = lastEventTsRef.current.get(dedupKey) ?? 0;
      const now = Date.now();
      const isDedupableType = [
        "agenda_off_topic",
        "agenda_time_warning",
        "agenda_stuck",
        "dissent_detected",
        "agenda_decision_summary",
        "agenda_advance_suggested",
      ].includes(e.type);
      if (isDedupableType && now - lastTs < DEDUP_WINDOW_MS) {
        return;
      }
      if (isDedupableType) lastEventTsRef.current.set(dedupKey, now);

      switch (e.type) {
        case "agenda_advanced":
          void reload();
          if (e.is_complete) {
            setToast({ kind: "success", text: "议程已全部走完" });
          }
          break;
        case "agenda_off_topic":
          // severity=severe 走全屏 modal, 否则普通 banner
          if (e.off_topic_severity === "severe") {
            setSevereOffTopic({
              offTopicSummary: e.off_topic_summary,
              currentAgendaItem: e.current_agenda_item,
              suggestedAgendaItem: e.suggested_agenda_item,
              moderatorAgentId: e.moderator_agent_id,
              moderatorAgentName:
                e.moderator_agent_nickname || e.moderator_agent_name,
              invokeQuery: e.reason,
              autoSummonAfterSec: e.auto_summon_after_s ?? 30,
            });
          } else {
            setBanner({
              kind: "off_topic",
              title: "议题似乎跑偏了",
              body:
                e.off_topic_summary ||
                `当前议题: ${e.current_agenda_item || "(未指定)"}`,
              agentId: e.moderator_agent_id,
              agentName: e.moderator_agent_nickname || e.moderator_agent_name,
              invokeQuery: e.reason,
              autoSummonSec: null,
            });
          }
          break;
        case "agenda_time_warning":
          setBanner({
            kind: "time_warning",
            title: `时间快用完 (已 ${e.elapsed_min} 分钟)`,
            body: e.time_warning_text,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            invokeQuery: e.reason,
            autoSummonSec: null,
          });
          break;
        case "agenda_stuck":
          setBanner({
            kind: "stuck",
            title: "议题卡住了",
            body: e.stuck_summary,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            invokeQuery: e.reason,
            autoSummonSec: e.auto_summon_after_s,
          });
          break;
        case "dissent_detected":
          // 用 suggested_agent (一般是某专家), 不是 moderator
          setBanner({
            kind: "dissent",
            title: `${e.parties.join(" vs ")} 出现分歧`,
            body: `${e.topic} — ${e.reason}`,
            agentId: e.suggested_agent_id,
            agentName:
              e.suggested_agent_nickname || e.suggested_agent_name,
            invokeQuery: e.reason,
            autoSummonSec: null,
          });
          break;
        case "agenda_decision_summary":
          setBanner({
            kind: "decision_summary",
            title: "该收口决策了",
            body: e.decision_brief,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            invokeQuery: e.decision_summary_query,
            autoSummonSec: e.auto_summon_after_s,
          });
          break;
        case "agenda_advance_suggested":
          // 不召唤 agent, 是推进议程提示. canAdvance 由 page 状态判
          setBanner({
            kind: "advance_suggested",
            title: "AI 建议推进议程",
            body: e.advance_reason,
            agentId: e.moderator_agent_id,
            agentName: e.moderator_agent_nickname || e.moderator_agent_name,
            invokeQuery: e.reason,
            autoSummonSec: null,
            advanceTargetIdx: e.next_agenda_idx,
            canAdvance: data?.can_control ?? false,
          });
          break;
        default:
          // 其他事件 (transcript_persisted / agent_message_*) 由 TranscriptView 处理
          break;
      }
    },
    [reload, data?.can_control],
  );
  useMeetingWsEvent(handleWsEvent);

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

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-16 animate-pulse rounded-xl bg-ink-900" />
        <div className="h-64 animate-pulse rounded-2xl bg-ink-900" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-[15px] text-zinc-300">未能加载会议</p>
        <p className="text-[13px] text-zinc-600">{error}</p>
        <Link
          href="/m"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
        >
          回工作台
        </Link>
      </div>
    );
  }

  const hasRisk = isRiskInsight(data.current_topic_insights);

  return (
    /* P13 fix: fixed inset-0 接管整个 viewport, 不嵌 layout 的 main scroll.
       避免 scrollIntoView 滚错层级把底部 sticky 推走.
       覆盖 BottomNav (用户在会议室内不需要切别的 tab, 沉浸式). */
    <div className="fixed inset-0 z-30 flex flex-col bg-ink-950 text-zinc-100">
      {/* ===== 会议 head — 返 + title + 状态 ===================== */}
      <div
        className="border-b border-ink-800 bg-ink-950/80 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          {/* P14.2: ongoing 会议时 点 ← 不直接返, 弹 sheet 让用户选
              "仅离开 / 结束会议 / 取消". finished/scheduled 直接返 */}
          {data.status === "ongoing" ? (
            <button
              type="button"
              onClick={() => setLeaveOpen(true)}
              className="flex h-10 w-10 items-center justify-center -ml-2 text-zinc-400 active:text-zinc-200"
              aria-label="退出会议室"
            >
              <span className="text-xl leading-none">←</span>
            </button>
          ) : (
            <Link
              href="/m"
              className="flex h-10 w-10 items-center justify-center -ml-2 text-zinc-400 active:text-zinc-200"
              aria-label="返回"
            >
              <span className="text-xl leading-none">←</span>
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold text-zinc-50">
              {data.title}
            </h1>
            <p className="mt-0.5 text-[13px] text-zinc-400">
              {data.status === "ongoing" ? (
                <>
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle animate-pulse" />
                  <span className="ml-1.5 text-emerald-300">进行中</span>
                  <span className="ml-2 text-zinc-400">· 已 {data.started_minutes_ago} min</span>
                </>
              ) : (
                <span>{data.status}</span>
              )}
              <span className="ml-2 text-zinc-500">· {data.transcript_total} 句实录</span>
            </p>
          </div>
        </div>
      </div>

      {/* ===== Stage chips (sticky) ============================== */}
      <StageChipsRow
        items={data.agenda_items}
        currentIdx={data.current_agenda_idx}
        isComplete={data.is_agenda_complete}
      />

      {/* ===== P16: WS 议程事件 banner (6 类) ==================== */}
      {banner ? (
        <AgendaEventBanner
          data={banner}
          onDismiss={() => setBanner(null)}
          onSummonAgent={handleSummonAgent}
          onAdvanceAgenda={handleAdvance}
        />
      ) : null}

      {/* ===== P16: severe 跑题全屏 modal ======================= */}
      <SevereOffTopicModal
        data={severeOffTopic}
        onSummon={handleSummonAgent}
        onDismiss={() => setSevereOffTopic(null)}
      />

      {/* ===== scheduled 状态: 仅显 "开始会议" 兜底卡 ============== */}
      {data.status === "scheduled" ? (
        <main className="flex-1 p-4">
          <div className="rounded-2xl border border-accent-500/40 bg-accent-500/[0.08] p-5 text-center">
            <p className="text-[16px] font-medium text-accent-200">
              会议还没开始
            </p>
            <p className="mt-2 text-[14px] text-zinc-400 leading-relaxed">
              点下方按钮把会议状态切到「进行中」, AI 召唤 / 议程推进 等功能就能用了.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-accent-500 px-4 text-[15px] font-medium text-white shadow-lg shadow-accent-500/20 active:scale-[0.98] active:bg-accent-600 disabled:opacity-60"
              data-testid="mobile-start-meeting"
            >
              {starting ? "开始中…" : "开始会议"}
            </button>
          </div>
        </main>
      ) : (
        /* ===== ongoing / finished: IM 风格主区域 =============== */
        <>
          {/* 当前议题 thin sticky bar — 比 CurrentTopicCard 轻很多, 不挡屏 */}
          {data.current_topic_title ? (
            <div
              className="border-b border-ink-800 bg-ink-950/85 px-4 py-2 text-[13px] backdrop-blur"
              data-testid="mobile-current-topic-strip"
            >
              <span className="text-zinc-400">议题 </span>
              <span className="font-medium text-zinc-100">
                {data.current_agenda_idx !== null
                  ? `${data.current_agenda_idx + 1}/${data.agenda_items.length}`
                  : ""}
              </span>
              <span className="text-zinc-500"> · </span>
              <span className="text-zinc-100">{data.current_topic_title}</span>
              {data.current_topic_elapsed_min !== null ? (
                <span className="ml-2 text-zinc-500 tabular-nums">
                  已议 {data.current_topic_elapsed_min}m
                </span>
              ) : null}
            </div>
          ) : data.is_agenda_complete ? (
            <div className="border-b border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-2 text-center text-[13px] text-emerald-200">
              ✓ 议程已全部完成 — 点底部 "结束会议" 进入沉淀
            </div>
          ) : (
            <div className="border-b border-ink-800 bg-ink-950/60 px-4 py-2 text-[13px] text-zinc-500">
              议程还没开始 — 点 "推进议程" 进入第一项
            </div>
          )}

          {/* v27.0-mobile P19.1 / Phase B.3: 会议参考资料 — 在 transcript 之上 显.
              ongoing: 可 加新文件 / 删除; finished/processed: readOnly (0 附件时 整段不显). */}
          <div className="mx-4 mt-3">
            <AttachmentsSection
              meetingId={id}
              readOnly={data.status !== "ongoing"}
            />
          </div>

          {/* P18: finished/processed 加 "看总结" 入口 + 只读提示 */}
          {data.status === "finished" || data.status === "processed" ? (
            <div className="mx-4 mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
              <p className="text-[15px] font-medium text-emerald-200">
                ✓ 会议已结束
              </p>
              <p className="mt-1 text-[13px] text-zinc-400 leading-snug">
                以下是会议过程数据 (转录 / 议程). 想看 AI 纪要 + 抽出的待办, 进总结页.
              </p>
              <Link
                href={`/m/meetings/${id}/summary`}
                className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-[14px] font-medium text-white active:scale-[0.98]"
                data-testid="mobile-view-summary-link"
              >
                看会议总结 →
              </Link>
            </div>
          ) : null}

          {/* IM 主区域: transcript 一直占满, 自动滚 */}
          <main className="flex-1 overflow-y-auto" data-testid="mobile-im-flow">
            <MeetingTranscriptView meetingId={id} />
          </main>

          {/* sticky 录音控制 (ongoing 时显) */}
          {data.status === "ongoing" ? (
            <div className="border-t border-ink-800 bg-ink-950/95 px-4 py-2 backdrop-blur">
              <MeetingRecorderControl
                meetingOngoing={data.status === "ongoing"}
              />
            </div>
          ) : null}
        </>
      )}

      {/* ===== Sticky 底部 next action ===========================
        P18 修: 仅 ongoing 状态显. finished / processed / scheduled 都不显 —
        召唤专家 / 推进议程 / 结束会议 都是过程中才有的操作.
        finished 会议: 主区域有"看总结"入口替代. */}
      {data.status === "ongoing" ? (
        <StickyActionBar
          canControl={data.can_control}
          isAgendaComplete={data.is_agenda_complete}
          currentTopicTitle={data.current_topic_title}
          hasRiskInsight={hasRisk}
          advancing={advancing}
          onAdvance={handleAdvance}
          onSummonAi={() => setSummonOpen(true)}
          onEndMeeting={() => setEndOpen(true)}
        />
      ) : null}

      {/* ===== P4.2 召 AI sheet =================================== */}
      <SummonAgentSheet
        open={summonOpen}
        agents={data.attending_agents}
        busy={summoning}
        onClose={() => setSummonOpen(false)}
        onSubmit={handleSummonSubmit}
      />

      {/* ===== P4.2 结束会议 confirm ============================= */}
      <ConfirmDialog
        open={endOpen}
        title="结束这场会议?"
        body="结束后 AI 会自动生成会议纪要 + 抽待办 + 提候选记忆. 这一步不可撤销."
        confirmLabel="结束"
        cancelLabel="再开一会"
        danger
        busy={ending}
        onConfirm={handleEndConfirm}
        onCancel={() => setEndOpen(false)}
      />

      {/* ===== P14.2 退出会议室 sheet =========================== */}
      <LeaveMeetingSheet
        open={leaveOpen}
        meetingTitle={data.title}
        endingMeeting={ending}
        onJustLeave={() => {
          setLeaveOpen(false);
          router.push("/m");
        }}
        onEndMeeting={() => {
          // 复用 handleEndConfirm — 它 调 finalize + toast + router push /m
          void handleEndConfirm();
        }}
        onCancel={() => setLeaveOpen(false)}
      />

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
