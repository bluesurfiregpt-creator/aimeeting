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

import { useCallback, useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StageChipsRow from "@/components/mobile/StageChipsRow";
import StickyActionBar from "@/components/mobile/StickyActionBar";
import SummonAgentSheet from "@/components/mobile/SummonAgentSheet";
import ConfirmDialog from "@/components/mobile/ConfirmDialog";
import MeetingTranscriptView from "@/components/mobile/MeetingTranscriptView";
import MeetingRecorderControl from "@/components/mobile/MeetingRecorderControl";
import AgendaEventBanner, {
  type BannerData,
} from "@/components/mobile/AgendaEventBanner";
import Toast from "@/components/mobile/Toast";
import { mApi } from "@/lib/mobile/api";
import {
  MeetingWsProvider,
  useMeetingWsEvent,
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
  // P5B: 议程事件 banner (off_topic / time_warning / stuck), 同时一个 slot
  const [banner, setBanner] = useState<BannerData | null>(null);
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
        setToast({ kind: "error", text: `召 AI 失败: ${msg}` });
      } finally {
        setSummoning(false);
      }
    },
    [summoning, id],
  );

  /** 结束会议: 弹 confirm → 确认 → 调 finalize → 回 /m + toast */
  const handleEndConfirm = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await mApi.finalizeMeeting(id);
      setEndOpen(false);
      setToast({
        kind: "success",
        text: "会议已结束, AI 正在生成纪要 + 抽待办",
      });
      // 跳回首页 — 让用户看到 Hero 卡消失, 也避免在已 finished 页停留
      setTimeout(() => router.push("/m"), 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToast({ kind: "error", text: `结束失败: ${msg}` });
      setEnding(false);
    }
  }, [ending, id, router]);

  // P5B: WS 订阅 — agenda 事件 banner + agenda_advanced 静默 reload
  const handleWsEvent = useCallback(
    (e: import("@/lib/sttSocket").SttEvent) => {
      switch (e.type) {
        case "agenda_advanced":
          // 议程被推进 (可能是别人推的) — 静默 reload
          void reload();
          if (e.is_complete) {
            setToast({ kind: "success", text: "议程已全部走完" });
          }
          break;
        case "agenda_off_topic":
          setBanner({
            kind: "off_topic",
            title: "议题似乎跑偏了",
            body:
              e.off_topic_summary ||
              `当前议题: ${e.current_agenda_item || "(未指定)"}`,
            severity: e.off_topic_severity,
          });
          break;
        case "agenda_time_warning":
          setBanner({
            kind: "time_warning",
            title: `时间快用完 (已 ${e.elapsed_min} 分钟)`,
            body: e.time_warning_text,
          });
          break;
        case "agenda_stuck":
          setBanner({
            kind: "stuck",
            title: "议题卡住了",
            body: e.stuck_summary,
          });
          break;
        default:
          // 其他事件 (transcript_persisted / agent_message_*) 由 TranscriptView 处理
          break;
      }
    },
    [reload],
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
    <div className="flex min-h-full flex-col">
      {/* ===== 会议 head — 返 + title + 状态 ===================== */}
      <div
        className="border-b border-ink-800 bg-ink-950/80 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/m"
            className="flex h-10 w-10 items-center justify-center -ml-2 text-zinc-400 active:text-zinc-200"
            aria-label="返回"
          >
            <span className="text-xl leading-none">←</span>
          </Link>
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

      {/* ===== P5B: WS 议程事件 banner ========================== */}
      {banner ? (
        <AgendaEventBanner data={banner} onDismiss={() => setBanner(null)} />
      ) : null}

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

      {/* ===== Sticky 底部 next action (召 AI / 推议程 / 结束会议) === */}
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

      {toast ? (
        <Toast kind={toast.kind} text={toast.text} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
