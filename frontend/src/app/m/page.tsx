"use client";

/**
 * v27.0-mobile · /m · 今日 工作台 v2.
 *
 * 改 自 v1 (用户 第一版 vibe = b 桌面 后台 缩小). 重做 结构:
 *   - Hero 占 ~45% 屏 — 你 现 在 在 推 啥 (主 锚)
 *   - 下方 紧凑 mini list — 一行 一条 摘要 跳 二级, 不 抢 hero
 *   - AI 智囊 按 议题 聚合 — 立 "多视角 辩论" 感, 不 是 RSS feed
 *   - Mobile tokens — body 15px, padding 16px, touch target 48-56px
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import HeroOngoingCard from "@/components/mobile/HeroOngoingCard";
import HeroEmptyCard from "@/components/mobile/HeroEmptyCard";
import {
  PendingMiniRow,
  InsightTopicGroupRow,
  groupInsightsByTopic,
} from "@/components/mobile/MiniListRows";
import { mApi } from "@/lib/mobile/api";
import type { WorkbenchOut } from "@/lib/mobile/types";

function SkeletonHero() {
  return <div className="h-64 animate-pulse rounded-2xl bg-ink-900" />;
}

function SkeletonRow() {
  return <div className="h-14 animate-pulse rounded-xl bg-ink-900" />;
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
        <h2 className="text-[15px] font-medium text-zinc-200">{title}</h2>
        {countLabel ? (
          <span className="text-[13px] text-zinc-500">· {countLabel}</span>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="text-[13px] text-accent-400 active:text-accent-300"
        >
          全部 →
        </Link>
      ) : null}
    </header>
  );
}

export default function MobileHomePage() {
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

  if (loading) {
    return (
      <div className="space-y-6 p-4">
        <SkeletonHero />
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-[15px] text-zinc-300">未 能 加 载</p>
        <p className="text-[13px] text-zinc-600">{error}</p>
        {error?.includes("401") ? (
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-accent-500 px-6 text-[15px] font-medium text-white"
          >
            去 登 录
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] text-zinc-200"
          >
            重 试
          </button>
        )}
      </div>
    );
  }

  const { ongoing_meetings, pending, todays_insights } = data;
  const insightTopics = groupInsightsByTopic(todays_insights);

  return (
    <div className="space-y-6 p-4 pb-8">
      {/* ============ Hero (主 锚, 占 ~45% 屏) =================== */}
      {ongoing_meetings.length > 0 ? (
        <HeroOngoingCard meetings={ongoing_meetings} />
      ) : (
        <HeroEmptyCard />
      )}

      {/* ============ 等 你 处理 (紧凑 mini list) ================ */}
      <section className="space-y-2">
        <SectionHeader
          title="等 你 处理"
          countLabel={pending.length > 0 ? `${pending.length} 件` : undefined}
        />
        {pending.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-4 text-center text-[13px] text-emerald-300">
            ✓ 今日 待办 全 处理 完
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingMiniRow key={`${p.kind}-${p.id}`} item={p} />
            ))}
          </div>
        )}
      </section>

      {/* ============ AI 智囊 (按 议题 聚合) ===================== */}
      <section className="space-y-2">
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
          <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 px-4 py-5 text-center">
            <p className="text-[14px] text-zinc-400">
              今天 AI 还 没 给 新 判断
            </p>
            <p className="mt-1 text-[12px] text-zinc-600">
              进 一场 会议 召 AI 加 视角, 立 刻 有 产 出
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
