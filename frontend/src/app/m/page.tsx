"use client";

/**
 * v1.4.0 · Saga N (Phase 1 W2) · Mobile App v2 · /m today 完整重写 (M2).
 *
 * 设计源 1:1:
 *   - /tmp/aimeeting-design-research/aimeeting/project/mobile-today.jsx (705 行)
 *   - /tmp/aimeeting-design-research/design-shots/today-meet.png + today-meet-scroll.png
 *   - /tmp/aimeeting-design-research/design-shots/today-expert.png + today-expert-scroll.png
 *
 * 改动 (vs r4-A):
 *   - 数据源 老 /api/m/workbench → 新 7 个 /api/v2/today/* mock endpoint
 *     (brief / live-meeting / snapshot / pending-tasks / insights / decisions / experts)
 *   - 不再用 _components/today/* 老组件 (留 v1 老路径但本页不引)
 *   - 全部用 v2 atoms (复用 Saga M 的 + Saga N 新增 MStatTile / MExpertCard)
 *   - hero 用 MAGlowBanner tone="mira" + chips (4 chip)
 *   - live meeting 用 MeetingFullCard + 下贴 mira_note pill
 *   - 4 格 snapshot 用 MStatTile (4 个 grid)
 *   - 等你处理 list 自渲染 (单独 row: radio + title + urgency pill + AI badge + due 文字)
 *   - 今天会议 横滚 走 /api/v2/meetings (复用 Saga M endpoint, frontend filter
 *     今天日期) — SCHEMA 没列 today/meetings endpoint, fallback frontend filter
 *   - AI 智囊 list 自渲染 (insight 卡: AI badge + type chip + title + body 1 行)
 *   - 今天决策 list 自渲染 (蓝 icon + title + 时间 + 来源会议)
 *   - 专家视角 走 MExpertCard 10 个 list
 *   - 顶部 PageHeader (Saga A 已浅色化 34px weight 800)
 *
 * 风格守门: docs/design/system/DESIGN_SYSTEM.md § 0.3.2 (Mobile 浅 iOS 单 theme).
 * 无 dark token / 无 violet-2/3/4 数字 token.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import Link from "next/link";

import PageHeader from "@/components/mobile/PageHeader";
import {
  MAGlowBanner,
  MAIBadge,
  MAIcon,
  MAEmpty,
  MAPill,
  MASection,
  MASegmented,
  MAvatarStack,
  MStatTile,
  MeetingFullCard,
  MExpertCard,
  type V2BriefResponse,
  type V2LiveMeetingResponse,
  type V2SnapshotResponse,
  type V2PendingTasksResponse,
  type V2PendingTaskItem,
  type V2InsightsResponse,
  type V2InsightItem,
  type V2DecisionsResponse,
  type V2DecisionItem,
  type V2ExpertsResponse,
  type V2MeetingItem,
  type V2MeetingsListResponse,
  type V2Urgency,
  type V2InsightType,
  type V2PillTone,
} from "@/components/mobile/v2";

type View = "meet" | "expert";

// inject pulse 动画 keyframe (跟 MAPill 配套 — Saga M3 同款).
const PULSE_KEYFRAME = `
@keyframes v2Pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}
`;

function injectKeyframes(): void {
  if (typeof window === "undefined") return;
  const STYLE_ID = "v2-pulse-keyframes";
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = PULSE_KEYFRAME;
  document.head.appendChild(s);
}

// 简单 fetch — v2 mock endpoint 不带 auth, 不用 mApi.
async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

// ============================================================================
// 顶 — date subtitle 格式化
// ============================================================================

function formatTodayDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${y}年${m}月${day}日 · ${w}`;
}

// ============================================================================
// Page
// ============================================================================

type AllData = {
  brief: V2BriefResponse;
  live: V2LiveMeetingResponse;
  snapshot: V2SnapshotResponse;
  pending: V2PendingTasksResponse;
  insights: V2InsightsResponse;
  decisions: V2DecisionsResponse;
  experts: V2ExpertsResponse;
  todayMeetings: V2MeetingItem[];
};

export default function MobileTodayPage(): ReactElement {
  const [view, setView] = useState<View>("meet");
  const [data, setData] = useState<AllData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    injectKeyframes();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      jget<V2BriefResponse>("/api/v2/today/brief"),
      jget<V2LiveMeetingResponse>("/api/v2/today/live-meeting"),
      jget<V2SnapshotResponse>("/api/v2/today/snapshot"),
      jget<V2PendingTasksResponse>("/api/v2/today/pending-tasks"),
      jget<V2InsightsResponse>("/api/v2/today/insights"),
      jget<V2DecisionsResponse>("/api/v2/today/decisions"),
      jget<V2ExpertsResponse>("/api/v2/today/experts"),
      // SCHEMA 没列 today/meetings endpoint —— fallback 复用 §2.2 拿全
      // 然后 frontend filter 今天 (live + upcoming + finished 今天).
      jget<V2MeetingsListResponse>("/api/v2/meetings"),
    ])
      .then(([brief, live, snap, pending, ins, dec, exp, meetings]) => {
        if (!alive) return;
        // frontend filter: 取今天 (started_at / scheduled_for / ended_at 任一在今天)
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();
        const isToday = (iso: string | null | undefined): boolean => {
          if (!iso) return false;
          const t = new Date(iso);
          return (
            t.getFullYear() === y &&
            t.getMonth() === m &&
            t.getDate() === d
          );
        };
        const todayMeetings = meetings.items.filter(
          (mt) =>
            isToday(mt.started_at) ||
            isToday(mt.scheduled_for) ||
            isToday(mt.ended_at),
        );
        setData({
          brief,
          live,
          snapshot: snap,
          pending,
          insights: ins,
          decisions: dec,
          experts: exp,
          todayMeetings,
        });
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const today = useMemo(() => new Date(), []);
  const subtitle = useMemo(() => formatTodayDate(today), [today]);

  if (loading) {
    return (
      <div>
        <PageHeader title="今日" subtitle={subtitle} />
        <div style={{ paddingBottom: 100 }}>
          <SkeletonHero />
          <div style={{ marginTop: 14, padding: "0 16px" }}>
            <SkeletonRow />
          </div>
          <div style={{ marginTop: 14, padding: "0 16px" }}>
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
        <div style={{ padding: "40px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "#1C1C1E" }}>未能加载</p>
          <p style={{ fontSize: 14, color: "#8E8E93", marginTop: 6 }}>
            {error}
          </p>
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
        </div>
      </div>
    );
  }

  const {
    brief,
    live,
    snapshot,
    pending,
    insights,
    decisions,
    experts,
    todayMeetings,
  } = data;

  return (
    <div style={{ paddingBottom: 100 }}>
      <PageHeader title="今日" subtitle={subtitle} />

      {/* ── §3.1 Mira 早间简报 (紫渐变 hero) ── */}
      <div style={{ padding: "0 16px" }}>
        <Link
          href={`/m/meetings/${brief.target_meeting_id}`}
          style={{
            display: "block",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <MAGlowBanner
            tone="mira"
            icon="sparkle"
            eyebrow="MIRA · 早间简报"
            title={brief.title}
            body={brief.summary_text}
            chips={brief.chips.map((c) => ({ label: c.label }))}
          />
        </Link>
      </div>

      {/* ── §3.2 Live meeting + mira_note (或空态) ── */}
      <div style={{ padding: "12px 16px 0" }}>
        {live.meeting ? (
          <>
            <MeetingFullCard
              meeting={live.meeting}
              href={`/m/meetings/${live.meeting.id}`}
            />
            {live.mira_note ? <MiraNotePill text={live.mira_note} /> : null}
          </>
        ) : (
          <MAEmpty
            icon="today"
            title="今天还没有进行中的会议"
            body="到「会议」tab 看上周脉络, 或新建一场"
          />
        )}
      </div>

      {/* ── §3.3 4 格 snapshot grid ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          <MStatTile
            label="场会议"
            value={snapshot.meetings_today}
            sublabel={live.meeting ? "1 进行中" : "今日"}
            tone="blue"
          />
          <MStatTile
            label="待处理"
            value={snapshot.pending_tasks}
            sublabel="需你拍板"
            tone="red"
          />
          <MStatTile
            label="AI 洞察"
            value={snapshot.ai_insights_today}
            sublabel="今日新增"
            tone="purple"
          />
          <MStatTile
            label="已决策"
            value={snapshot.decisions_today}
            sublabel="今天敲定"
            tone="green"
          />
        </div>
      </div>

      {/* ── view segmented (会议视角 / 专家视角) ── */}
      <div style={{ padding: "22px 16px 0" }}>
        <MASegmented
          active={view}
          onChange={(id) => setView(id as View)}
          tabs={[
            { id: "meet", label: "会议视角" },
            { id: "expert", label: "专家视角" },
          ]}
        />
      </div>

      {view === "meet" ? (
        <MeetView
          pending={pending}
          insights={insights}
          decisions={decisions}
          todayMeetings={todayMeetings}
        />
      ) : (
        <ExpertViewBlock experts={experts} />
      )}
    </div>
  );
}

// ============================================================================
// MeetView — 会议视角
// ============================================================================

function MeetView({
  pending,
  insights,
  decisions,
  todayMeetings,
}: {
  pending: V2PendingTasksResponse;
  insights: V2InsightsResponse;
  decisions: V2DecisionsResponse;
  todayMeetings: V2MeetingItem[];
}): ReactElement {
  return (
    <>
      {/* 等你处理 */}
      <MASection
        title="等你处理"
        count={pending.total_count}
        action={pending.total_count > 0 ? "全部任务" : undefined}
        onAction={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/m/tasks";
          }
        }}
      >
        <div style={{ padding: "0 16px" }}>
          {pending.items.length === 0 ? (
            <EmptyHint text="✓ 今日待办全处理完" tone="green" />
          ) : (
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                overflow: "hidden",
                border: "0.5px solid rgba(60,60,67,0.10)",
              }}
            >
              {pending.items.map((t, i) => (
                <PendingTaskRow
                  key={t.id}
                  task={t}
                  last={i === pending.items.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </MASection>

      {/* 今天的会议 — 横滚 */}
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
        {todayMeetings.length === 0 ? (
          <div style={{ padding: "0 16px" }}>
            <EmptyHint text="今天没有更多会议" tone="neutral" />
          </div>
        ) : (
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
              <TodayMeetingTile key={m.id} meeting={m} />
            ))}
          </div>
        )}
      </MASection>

      {/* AI 智囊·今日 */}
      <MASection
        title="AI 智囊·今日"
        count={insights.items.length}
        action={insights.items.length > 0 ? "看全部" : undefined}
        onAction={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/m/insights";
          }
        }}
        subtitle="今天最值得你看的 AI 判断"
      >
        {insights.items.length === 0 ? (
          <div style={{ padding: "0 16px" }}>
            <EmptyHint text="今天 AI 还没给新判断" tone="neutral" />
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
            {insights.items.map((it) => (
              <InsightCard key={it.id} insight={it} />
            ))}
          </div>
        )}
      </MASection>

      {/* 今天的决策 */}
      <MASection title="今天的决策" count={decisions.total_count}>
        <div style={{ padding: "0 16px" }}>
          {decisions.items.length === 0 ? (
            <EmptyHint text="今天还没有敲定的决策" tone="neutral" />
          ) : (
            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                overflow: "hidden",
                border: "0.5px solid rgba(60,60,67,0.10)",
              }}
            >
              {decisions.items.map((d, i) => (
                <DecisionRow
                  key={d.id}
                  decision={d}
                  last={i === decisions.items.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </MASection>
    </>
  );
}

// ============================================================================
// ExpertViewBlock — 专家视角
// ============================================================================

function ExpertViewBlock({
  experts,
}: {
  experts: V2ExpertsResponse;
}): ReactElement {
  return (
    <>
      <div
        style={{
          padding: "14px 16px 0",
          fontSize: 12,
          color: "#8E8E93",
        }}
      >
        共 {experts.experts.length} 位 AI 专家 · 按最近活跃排序
      </div>
      <div
        style={{
          padding: "8px 16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {experts.experts.map((e, i) => (
          <MExpertCard key={e.id} expert={e} defaultExpanded={i === 1} />
        ))}
      </div>
    </>
  );
}

// ============================================================================
// MiraNotePill — live meeting 下贴的紫边 note (复用 MiraPulseNotice 视觉骨架)
// ============================================================================

function MiraNotePill({ text }: { text: string }): ReactElement {
  return (
    <div
      style={{
        marginTop: 8,
        background: "#fff",
        borderRadius: 12,
        border: "0.5px solid rgba(94,92,230,0.30)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
      data-testid="mira-note-pill"
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          background: "linear-gradient(135deg, #5E5CE6, #AF52DE)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <MAIcon name="sparkle" size={10} color="#fff" strokeWidth={2.4} />
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "#5E5CE6",
          lineHeight: 1.5,
          fontWeight: 500,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ============================================================================
// PendingTaskRow — 等你处理 单行
// ============================================================================

const URGENCY_TONE: Record<V2Urgency, V2PillTone> = {
  urgent: "urgent",
  today: "today",
  week: "week",
  none: "neutral",
};
const URGENCY_LABEL: Record<V2Urgency, string> = {
  urgent: "紧急",
  today: "今日",
  week: "本周",
  none: "—",
};

function PendingTaskRow({
  task,
  last,
}: {
  task: V2PendingTaskItem;
  last: boolean;
}): ReactElement {
  const dueColor =
    task.urgency === "urgent"
      ? "#FF3B30"
      : task.urgency === "today"
      ? "#FF9F0A"
      : "#8E8E93";
  return (
    <Link
      href={`/m/meetings/${task.source_meeting_id}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "11px 14px",
        borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1.6px solid #C7C7CC",
          marginTop: 1,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "#1C1C1E",
            lineHeight: 1.35,
          }}
        >
          {task.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 5,
            flexWrap: "wrap",
          }}
        >
          <MAPill
            tone={URGENCY_TONE[task.urgency]}
            label={URGENCY_LABEL[task.urgency]}
          />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "#8E8E93",
            }}
          >
            <MAIBadge
              name={task.ai_source.name}
              glyph={task.ai_source.glyph}
              gradient_from={task.ai_source.color}
              gradient_to={task.ai_source.color}
              size={13}
              ring="transparent"
            />
            {task.ai_source.name}
          </span>
          <span style={{ fontSize: 11, color: "#C7C7CC" }}>·</span>
          <span style={{ fontSize: 11, color: "#8E8E93" }}>
            {task.source_meeting}
          </span>
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: dueColor,
          fontWeight: 600,
          marginTop: 2,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {task.due_display}
      </span>
    </Link>
  );
}

// ============================================================================
// TodayMeetingTile — 今天的会议 横滚 小卡 (240px)
// ============================================================================

function TodayMeetingTile({
  meeting,
}: {
  meeting: V2MeetingItem;
}): ReactElement {
  const m = meeting;
  const pillTone: V2PillTone =
    m.status === "live"
      ? "live"
      : m.status === "upcoming"
      ? "upcoming"
      : "done";
  const pillLabel =
    m.status === "live"
      ? "进行中"
      : m.status === "upcoming"
      ? "即将开始"
      : "已结束";

  let timeLabel = "";
  if (m.status === "live" && m.elapsed_minutes != null) {
    timeLabel = `已 ${m.elapsed_minutes} 分`;
  } else if (m.status === "upcoming") {
    const d = new Date(m.scheduled_for);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    timeLabel = `${hh}:${mm}`;
  } else if (m.ended_at) {
    const d = new Date(m.ended_at);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    timeLabel = `${hh}:${mm}`;
  }

  return (
    <Link
      href={`/m/meetings/${m.id}`}
      style={{
        flexShrink: 0,
        width: 240,
        scrollSnapAlign: "start",
        background: "#fff",
        borderRadius: 14,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: "11px 12px",
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
        display: "block",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <MAPill tone={pillTone} label={pillLabel} pulse={m.status === "live"} />
        {timeLabel ? (
          <span
            style={{
              fontSize: 11,
              color: "#8E8E93",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {timeLabel}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 7,
          fontSize: 14,
          fontWeight: 700,
          color: "#1C1C1E",
          lineHeight: 1.3,
          letterSpacing: -0.1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {m.title}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "#8E8E93",
          marginTop: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {m.topic_summary}
      </div>
      <div
        style={{
          marginTop: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MAvatarStack attendees={m.attendees} size={20} max={5} ring="#fff" />
        {m.status === "finished" && m.decision_count > 0 ? (
          <span
            style={{
              fontSize: 11,
              color: "#1F8A5B",
              fontWeight: 600,
            }}
          >
            {m.decision_count} 决策
          </span>
        ) : null}
        {m.status === "upcoming" && m.countdown_seconds ? (
          <span
            style={{
              fontSize: 11,
              color: "#FF9F0A",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <MAIcon name="clock" size={10} color="#FF9F0A" />
            {formatCountdownShort(m.countdown_seconds)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function formatCountdownShort(s: number): string {
  if (s <= 0) return "稍后";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} 分`;
}

// ============================================================================
// InsightCard — AI 智囊 单卡
// ============================================================================

const INSIGHT_TYPE_COLOR: Record<V2InsightType, { fg: string; bg: string }> = {
  突破: { fg: "#34C759", bg: "rgba(52,199,89,0.12)" },
  决策: { fg: "#5E5CE6", bg: "rgba(94,92,230,0.12)" },
  风险: { fg: "#FF3B30", bg: "rgba(255,59,48,0.12)" },
  洞察: { fg: "#0A84FF", bg: "rgba(10,132,255,0.12)" },
  思路: { fg: "#AF52DE", bg: "rgba(175,82,222,0.12)" },
};

function InsightCard({
  insight,
}: {
  insight: V2InsightItem;
}): ReactElement {
  const it = insight;
  const tc = INSIGHT_TYPE_COLOR[it.type];
  return (
    <Link
      href={`/m/meetings/${it.source_meeting_id}`}
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        border: "0.5px solid rgba(60,60,67,0.10)",
        display: "block",
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      <div style={{ padding: "12px 14px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <MAIBadge
            name={it.ai_source.name}
            glyph={it.ai_source.glyph}
            gradient_from={it.ai_source.color}
            gradient_to={it.ai_source.color}
            size={26}
            ring="transparent"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1C1C1E",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {it.ai_source.name}
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  color: tc.fg,
                  background: tc.bg,
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {it.type}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 1 }}>
              {it.source_meeting}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 14.5,
            fontWeight: 600,
            color: "#1C1C1E",
            lineHeight: 1.35,
            letterSpacing: -0.1,
          }}
        >
          {it.title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "#3C3C43",
            lineHeight: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {it.body}
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// DecisionRow — 今天的决策 单行
// ============================================================================

function DecisionRow({
  decision,
  last,
}: {
  decision: V2DecisionItem;
  last: boolean;
}): ReactElement {
  const d = decision;
  const decidedAt = new Date(d.decided_at);
  const hh = String(decidedAt.getHours()).padStart(2, "0");
  const mm = String(decidedAt.getMinutes()).padStart(2, "0");
  return (
    <Link
      href={`/m/meetings/${d.meeting_id}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "12px 14px",
        borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(52,199,89,0.14)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <MAIcon name="check" size={14} color="#1F8A5B" strokeWidth={2.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1C1C1E",
            lineHeight: 1.4,
          }}
        >
          {d.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "#8E8E93",
            marginTop: 3,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {hh}:{mm}
          </span>
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "#C7C7CC",
          flexShrink: 0,
          marginTop: 4,
        }}
      >
        <MAIcon
          name="arrow-right"
          size={12}
          color="#C7C7CC"
          strokeWidth={2.2}
        />
      </span>
    </Link>
  );
}

// ============================================================================
// helpers — empty hint + skeleton
// ============================================================================

function EmptyHint({
  text,
  tone,
}: {
  text: string;
  tone: "green" | "neutral";
}): ReactElement {
  if (tone === "green") {
    return (
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
        {text}
      </div>
    );
  }
  return (
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
      {text}
    </div>
  );
}

function SkeletonHero(): ReactElement {
  return (
    <div
      style={{
        height: 140,
        borderRadius: 16,
        background: "rgba(60,60,67,0.06)",
        margin: "0 16px",
        animation: "v2Pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}

function SkeletonRow(): ReactElement {
  return (
    <div
      style={{
        height: 60,
        borderRadius: 12,
        background: "rgba(60,60,67,0.06)",
        animation: "v2Pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}
