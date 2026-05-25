"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · /m today 大重写.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx
 * (705 行 — PM 这一轮 视觉骨架页, 最重要)
 *
 * 改动 (vs v27.0):
 *   - bg ink-950 dark → #F2F2F7 light
 *   - PageHeader 26px → 34px + subtitle (今天日期)
 *   - 新增 5 段:
 *       MiraDailyBrief (蓝紫渐变 hero)
 *       LiveMeetingCard (浅色, 替代 HeroOngoingCard)
 *       TodaySnapshot (4 stat 小卡)
 *       MeetView (会议视角 segment):
 *         - 等你处理 (浅色 TaskRow)
 *         - 今天会议 (横滑 MeetingCardSmall)
 *         - AI 智囊 (浅色 InsightCard)
 *         - 今天的决策 (DecisionRow)
 *       ExpertView (专家视角 segment, 手风琴, 默认展开 SHU)
 *
 * 数据接入策略:
 *   - WorkbenchOut backend (ongoing/pending/todays_insights) — 真接
 *   - MA_TODAY mock (greeting + brief) — Saga 后续接 Mira 引擎
 *   - MA_MEETINGS mock (今天的会议横滑) — Saga 后续接 backend today_meetings
 *   - MA_DECISIONS mock (今天的决策) — Saga 后续接 backend today_decisions
 *   - MA_EXPERTS mock (专家视角) — Saga 后续接 backend AgentsWorkboardOut
 *
 * [TD-NEW: today_decisions / today_meetings backend 字段缺失] 见 mock.ts
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { mutateCache, peekCache, useCachedFetch } from "@/lib/mobile/swrCache";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import MASection from "@/components/mobile/shared/MASection";
import { mApi } from "@/lib/mobile/api";
import type { WorkbenchOut } from "@/lib/mobile/types";

import MiraDailyBrief from "./_components/today/MiraDailyBrief";
import LiveMeetingCard from "./_components/today/LiveMeetingCard";
import TodaySnapshot from "./_components/today/TodaySnapshot";
import TaskRow from "./_components/today/TaskRow";
import MeetingCardSmall from "./_components/today/MeetingCardSmall";
import InsightCard from "./_components/today/InsightCard";
import DecisionRow from "./_components/today/DecisionRow";
import ExpertView from "./_components/today/ExpertView";
import {
  MA_TODAY,
  MA_MEETINGS,
  MA_DECISIONS,
  formatTodayDate,
  formatGreetingTime,
} from "./_components/today/mock";

type View = "meet" | "expert";

function SkeletonHero() {
  return (
    <div
      className="animate-pulse"
      style={{
        height: 180,
        borderRadius: 18,
        background: "rgba(60,60,67,0.06)",
        margin: "0 16px",
      }}
    />
  );
}

function SkeletonRow() {
  return (
    <div
      className="animate-pulse"
      style={{
        height: 60,
        borderRadius: 12,
        background: "rgba(60,60,67,0.06)",
        margin: "0 16px",
      }}
    />
  );
}

export default function MobileHomePage() {
  const [view, setView] = useState<View>("meet");

  const { data, error, isRefreshing } = useCachedFetch<WorkbenchOut>(
    "m:workbench",
    () => mApi.getWorkbench(),
  );
  const loading = !data && isRefreshing;

  // prefetch 其他 tab — 保留旧行为
  useEffect(() => {
    const tasks: Array<[string, () => Promise<unknown>]> = [
      ["m:meetings", () => mApi.getMeetingsList()],
      ["m:tasks", () => mApi.getTasks()],
      ["m:agents/workboard", () => mApi.getAgentsWorkboard()],
    ];
    const run = () => {
      for (const [key, fn] of tasks) {
        if (peekCache(key) !== undefined) continue;
        void fn()
          .then((d) => mutateCache(key, d))
          .catch(() => {});
      }
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle = ric
      ? ric(run, { timeout: 2000 })
      : (window.setTimeout(run, 500) as unknown as number);
    return () => {
      const cic = (
        window as unknown as { cancelIdleCallback?: (h: number) => void }
      ).cancelIdleCallback;
      if (cic) cic(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  // computed (用 hook 必须在 early return 前)
  const today = useMemo(() => new Date(), []);
  const subtitle = useMemo(
    () => MA_TODAY.date || formatTodayDate(today),
    [today],
  );
  const greetingTime = useMemo(
    () => MA_TODAY.greetingTime || formatGreetingTime(today),
    [today],
  );

  // ── loading / error 早返回 ──
  if (loading) {
    return (
      <div>
        <PageHeader title="今日" subtitle={subtitle}>
          <SegmentControl<View>
            value={view}
            onChange={setView}
            items={[
              { value: "meet", label: "会议视角" },
              { value: "expert", label: "专家视角" },
            ]}
          />
        </PageHeader>
        <div style={{ paddingBottom: 100 }}>
          <div style={{ padding: "0 16px" }}>
            <SkeletonHero />
          </div>
          <div style={{ marginTop: 14 }}>
            <SkeletonRow />
          </div>
          <div style={{ marginTop: 14 }}>
            <SkeletonRow />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="今日" subtitle={subtitle} />
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 16, color: "#1C1C1E" }}>未能加载</p>
          <p style={{ fontSize: 14, color: "#8E8E93", marginTop: 6 }}>
            {error}
          </p>
          {error?.includes("401") ? (
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                marginTop: 18,
                height: 48,
                paddingLeft: 24,
                paddingRight: 24,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                background: "#007AFF",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              去登录
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 18,
                height: 48,
                paddingLeft: 24,
                paddingRight: 24,
                borderRadius: 12,
                background: "#fff",
                border: "0.5px solid rgba(60,60,67,0.16)",
                color: "#1C1C1E",
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  const { ongoing_meetings, pending, todays_insights } = data;
  const liveBackend = ongoing_meetings[0]; // 取首个 ongoing

  // 今天 meetings (混合: live = backend, 其他 = mock) — Saga A 简化方案
  const todayMeetings = MA_MEETINGS;
  const topInsights = todays_insights.slice(0, 3);
  const todayDecisions = MA_DECISIONS;

  return (
    <div style={{ paddingBottom: 100 }}>
      <PageHeader title="今日" subtitle={subtitle}>
        <SegmentControl<View>
          value={view}
          onChange={setView}
          items={[
            { value: "meet", label: "会议视角" },
            { value: "expert", label: "专家视角" },
          ]}
        />
      </PageHeader>

      {/* ── Mira 早间简报 ── */}
      <div style={{ padding: "8px 16px 0" }}>
        <MiraDailyBrief
          userName="周凯"
          greetingTime={greetingTime}
          todayBrief={MA_TODAY.todayBrief}
          meetingCount={todayMeetings.length}
        />
      </div>

      {/* ── Live meeting (only if active) ── */}
      {liveBackend ? (
        <div style={{ padding: "12px 16px 0" }}>
          <LiveMeetingCard
            meetingId={liveBackend.meeting_id}
            title={liveBackend.title}
            sub="进行中"
            topic={liveBackend.latest_insight?.content || ""}
            elapsedMin={liveBackend.started_minutes_ago}
            miraNote={
              liveBackend.latest_insight
                ? `Mira 提示: ${liveBackend.latest_insight.content.slice(0, 40)}...`
                : undefined
            }
          />
        </div>
      ) : (
        <div style={{ padding: "12px 16px 0" }}>
          <div
            style={{
              background: "#fff",
              borderRadius: 18,
              border: "0.5px dashed rgba(60,60,67,0.20)",
              padding: "20px 16px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 14,
                color: "#3C3C43",
                margin: 0,
                fontWeight: 600,
              }}
            >
              当前没有进行中的会议
            </p>
            <p
              style={{
                fontSize: 12,
                color: "#8E8E93",
                marginTop: 4,
              }}
            >
              到 /m/meetings 查看 全部会议
            </p>
          </div>
        </div>
      )}

      {/* ── Today snapshot (4 stat) ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <TodaySnapshot
          stats={[
            {
              label: "场会议",
              value: todayMeetings.length,
              sub: liveBackend ? "1 进行中" : "今日",
              tone: "blue",
            },
            {
              label: "待处理",
              value: pending.length,
              sub: "需你拍板",
              tone: "red",
            },
            {
              label: "AI 洞察",
              value: todays_insights.length,
              sub: "今日新增",
              tone: "purple",
            },
            {
              label: "已决策",
              value: todayDecisions.length,
              sub: "今天敲定",
              tone: "green",
            },
          ]}
        />
      </div>

      {/* ── view segment 已在 PageHeader 里 ── */}

      {view === "meet" ? (
        <MeetView
          todayMeetings={todayMeetings}
          todoTasks={pending}
          insights={topInsights}
          decisions={todayDecisions}
        />
      ) : (
        <div style={{ marginTop: 22 }}>
          <ExpertView />
        </div>
      )}
    </div>
  );
}

function MeetView({
  todayMeetings,
  todoTasks,
  insights,
  decisions,
}: {
  todayMeetings: typeof MA_MEETINGS;
  todoTasks: WorkbenchOut["pending"];
  insights: WorkbenchOut["todays_insights"];
  decisions: typeof MA_DECISIONS;
}) {
  return (
    <>
      {/* 等你处理 */}
      <MASection
        title="等你处理"
        count={todoTasks.length}
        action={todoTasks.length > 0 ? "全部任务" : undefined}
        onAction={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/m/tasks";
          }
        }}
        marginTop={22}
      >
        <div style={{ padding: "0 16px" }}>
          {todoTasks.length === 0 ? (
            <div
              style={{
                background: "rgba(52,199,89,0.08)",
                borderRadius: 14,
                border: "0.5px solid rgba(52,199,89,0.20)",
                padding: "14px 16px",
                fontSize: 14,
                color: "#1F8A5B",
                textAlign: "center",
              }}
            >
              ✓ 今日待办全处理完
            </div>
          ) : (
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                overflow: "hidden",
                border: "0.5px solid rgba(60,60,67,0.10)",
              }}
            >
              {todoTasks.map((t, i) => (
                <TaskRow
                  key={`${t.kind}-${t.id}`}
                  t={t}
                  last={i === todoTasks.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </MASection>

      {/* 今天的会议 */}
      <MASection
        title="今天的会议"
        count={todayMeetings.length}
        action="所有会议"
        onAction={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/m/meetings";
          }
        }}
      >
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            gap: 10,
            padding: "0 16px 4px",
            scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {todayMeetings.map((m) => (
            <MeetingCardSmall key={m.id} m={m} />
          ))}
        </div>
      </MASection>

      {/* AI 智囊 · 今日 */}
      <MASection
        title="AI 智囊 · 今日"
        count={insights.length}
        action={insights.length > 0 ? "全部洞察" : undefined}
        onAction={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/m/insights";
          }
        }}
        sub="今天最值得你看的 AI 判断"
      >
        {insights.length === 0 ? (
          <div style={{ padding: "0 16px" }}>
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "0.5px dashed rgba(60,60,67,0.20)",
                padding: "20px 16px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  color: "#3C3C43",
                  margin: 0,
                  fontWeight: 600,
                }}
              >
                今天 AI 还没给新判断
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "#8E8E93",
                  marginTop: 4,
                }}
              >
                进一场会议召唤专家加视角, 立刻有产出
              </p>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "0 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {insights.map((it) => (
              <InsightCard key={it.id} it={it} />
            ))}
          </div>
        )}
      </MASection>

      {/* 今天的决策 */}
      <MASection title="今天的决策" count={decisions.length}>
        <div style={{ padding: "0 16px" }}>
          {decisions.length === 0 ? (
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "0.5px dashed rgba(60,60,67,0.20)",
                padding: "16px",
                fontSize: 13,
                color: "#8E8E93",
                textAlign: "center",
              }}
            >
              今天还没有敲定的决策
            </div>
          ) : (
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                overflow: "hidden",
                border: "0.5px solid rgba(60,60,67,0.10)",
              }}
            >
              {decisions.map((d, i) => (
                <DecisionRow
                  key={d.id}
                  d={d}
                  last={i === decisions.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </MASection>
    </>
  );
}
