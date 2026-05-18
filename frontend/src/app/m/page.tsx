"use client";

/**
 * v27.0-mobile · /m · 今日 v3.
 *
 * 改动 (跟 v2 比):
 *   - 删问候 TopBar, 改 PageHeader (大标题 "今日" + segment)
 *   - 顶部 segment 切换两视角:
 *       [会议视角]  ← 默认, 沿用 v2 三段 (现在推进 + 等你处理 + AI智囊议题)
 *       [专家视角]  ← 工卡墙 (Phase 2 next 真做, 暂占位)
 *   - 字号台账: body 16, caption 14, h2 17, hero title 22+
 *   - 卡片间距 20px (space-y-5)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HeroOngoingCard from "@/components/mobile/HeroOngoingCard";
import HeroEmptyCard from "@/components/mobile/HeroEmptyCard";
import {
  PendingMiniRow,
  InsightTopicGroupRow,
  groupInsightsByTopic,
} from "@/components/mobile/MiniListRows";
import PageHeader from "@/components/mobile/PageHeader";
import SegmentControl from "@/components/mobile/SegmentControl";
import { mApi } from "@/lib/mobile/api";
import type { WorkbenchOut } from "@/lib/mobile/types";

type View = "meeting" | "expert";

function SkeletonHero() {
  return <div className="h-64 animate-pulse rounded-2xl bg-ink-900" />;
}
function SkeletonRow() {
  return <div className="h-16 animate-pulse rounded-xl bg-ink-900" />;
}

function SectionHeader({
  title,
  countLabel,
  href,
}: {
  title: string;
  countLabel?: string;
  href?: string;
}) {
  return (
    <header className="flex items-baseline justify-between px-1">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[17px] font-medium text-zinc-100">{title}</h2>
        {countLabel ? (
          <span className="text-[14px] text-zinc-500">· {countLabel}</span>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="text-[14px] text-accent-400 active:text-accent-300"
        >
          全部 →
        </Link>
      ) : null}
    </header>
  );
}

export default function MobileHomePage() {
  const [view, setView] = useState<View>("meeting");
  const [data, setData] = useState<WorkbenchOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    mApi
      .getWorkbench()
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
  }, []);

  const insightTopics = useMemo(() => {
    if (!data) return [];
    return groupInsightsByTopic(data.todays_insights);
  }, [data]);

  return (
    <div>
      <PageHeader title="今日">
        <SegmentControl<View>
          value={view}
          onChange={setView}
          items={[
            { value: "meeting", label: "会议视角" },
            { value: "expert", label: "专家视角" },
          ]}
        />
      </PageHeader>

      {loading ? (
        <div className="space-y-5 px-4 pb-6">
          <SkeletonHero />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error || !data ? (
        <div className="space-y-3 px-6 py-10 text-center">
          <p className="text-[16px] text-zinc-200">未能加载</p>
          <p className="text-[14px] text-zinc-600">{error}</p>
          {error?.includes("401") ? (
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-accent-500 px-6 text-[15px] font-medium text-white"
            >
              去登录
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
            >
              重试
            </button>
          )}
        </div>
      ) : view === "meeting" ? (
        <MeetingView data={data} insightTopics={insightTopics} />
      ) : (
        <ExpertViewPlaceholder />
      )}
    </div>
  );
}

// ===== 会议视角 ==========================================================

function MeetingView({
  data,
  insightTopics,
}: {
  data: WorkbenchOut;
  insightTopics: ReturnType<typeof groupInsightsByTopic>;
}) {
  const { ongoing_meetings, pending, todays_insights } = data;
  return (
    <div className="space-y-6 px-4 pb-6">
      {/* === Hero (主锚) === */}
      <section>
        {ongoing_meetings.length > 0 ? (
          <HeroOngoingCard meetings={ongoing_meetings} />
        ) : (
          <HeroEmptyCard />
        )}
      </section>

      {/* === 等你处理 === */}
      <section className="space-y-3">
        <SectionHeader
          title="等你处理"
          countLabel={pending.length > 0 ? `${pending.length} 件` : undefined}
        />
        {pending.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-5 text-center text-[14px] text-emerald-300">
            ✓ 今日待办全处理完
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingMiniRow key={`${p.kind}-${p.id}`} item={p} />
            ))}
          </div>
        )}
      </section>

      {/* === AI 智囊 (按议题聚合) === */}
      <section className="space-y-3">
        <SectionHeader
          title="AI 智囊"
          countLabel={
            todays_insights.length > 0
              ? `${insightTopics.length} 议题 · ${todays_insights.length} 条`
              : undefined
          }
          href={todays_insights.length > 0 ? "/m/insights" : undefined}
        />
        {insightTopics.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center">
            <p className="text-[15px] text-zinc-300">今天 AI 还没给新判断</p>
            <p className="mt-1.5 text-[13px] text-zinc-600">
              进一场会议召 AI 加视角, 立刻有产出
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {insightTopics.map((t) => (
              <InsightTopicGroupRow key={t.key} topic={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ===== 专家视角 (Phase 2 next 真做, 暂占位) =============================

function ExpertViewPlaceholder() {
  return (
    <div className="px-4 pb-6">
      <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">
        <div className="text-3xl">🧠</div>
        <p className="mt-4 text-[16px] text-zinc-200">专家视角 · 工卡墙</p>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          下一步真做: 列出所有 AI 专家工卡,<br />
          每张含 nickname · 专业 / 最近 2-3 条产出 / 累计指标.<br />
          点工卡进单专家详情页.
        </p>
      </div>
    </div>
  );
}
