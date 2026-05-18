"use client";

/**
 * v27.0-mobile · /m · 今日 工作台.
 *
 * 三 大段, 按 brief 严序:
 *   1. 现在 推进 — 进行中 会议 横向 carousel (含 阶段 进度 + 最新 AI 判断)
 *   2. 等 我 处理 — 待确认 / 待审 / 阻塞 list
 *   3. AI 智囊 · 今日 产出 — 完整 卡 list
 *
 * 数据 一次 拉全 — /api/m/workbench 聚合 endpoint, 减 round-trip.
 *
 * 加载 状态: skeleton — 不 显 spinner (spinner 阻断 感, brief 反 后台 感).
 * 空 状态: 各 段 内部 处理 (carousel 自带, pending 显 "全部 处理完" 庆贺态).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import MeetingCarousel from "@/components/mobile/MeetingCarousel";
import PendingItemCard from "@/components/mobile/PendingItemCard";
import { AIInsightCard } from "@/components/mobile/AIInsightCard";
import { mApi } from "@/lib/mobile/api";
import type { WorkbenchOut } from "@/lib/mobile/types";

// 简单 skeleton — 占位 box, 不 spinner
function SkeletonRow({ h = "h-20" }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-lg bg-ink-900`} />;
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
    <header className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
        {countLabel ? (
          <span className="text-[11px] text-zinc-500">· {countLabel}</span>
        ) : null}
      </div>
      {href ? (
        <Link href={href} className="text-[11px] text-zinc-500 hover:text-zinc-300">
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
      <div className="space-y-5 p-4">
        <section>
          <SectionHeader title="现在 推进" />
          <SkeletonRow h="h-36" />
        </section>
        <section>
          <SectionHeader title="等 我 处理" />
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </section>
        <section>
          <SectionHeader title="AI 智囊 · 今日 产出" />
          <div className="space-y-2">
            <SkeletonRow h="h-24" />
            <SkeletonRow h="h-24" />
          </div>
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-4 text-center">
        <p className="text-sm text-zinc-400">未 能 加载</p>
        <p className="text-xs text-zinc-600">{error}</p>
        {error?.includes("401") ? (
          <Link
            href="/login"
            className="inline-block rounded-lg bg-accent-500 px-4 py-2 text-xs font-medium text-white"
          >
            去 登录
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-ink-700 px-4 py-2 text-xs text-zinc-300"
          >
            重试
          </button>
        )}
      </div>
    );
  }

  const { ongoing_meetings, pending, todays_insights } = data;

  return (
    <div className="space-y-5 p-4">
      {/* === 1. 现在 推进 ====================================== */}
      <section>
        <SectionHeader
          title="现在 推进"
          countLabel={ongoing_meetings.length > 0 ? `${ongoing_meetings.length} 场` : undefined}
          href={ongoing_meetings.length > 0 ? "/m/meetings" : undefined}
        />
        <MeetingCarousel meetings={ongoing_meetings} />
      </section>

      {/* === 2. 等 我 处理 ===================================== */}
      <section>
        <SectionHeader
          title="等 我 处理"
          countLabel={pending.length > 0 ? `${pending.length} 件` : undefined}
        />
        {pending.length === 0 ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-center text-xs text-emerald-300">
            ✓ 今日 待办 全 处理 完
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingItemCard key={`${p.kind}-${p.id}`} item={p} />
            ))}
          </div>
        )}
      </section>

      {/* === 3. AI 智囊 · 今日 产出 ============================ */}
      <section>
        <SectionHeader
          title="AI 智囊 · 今日 产出"
          countLabel={todays_insights.length > 0 ? `${todays_insights.length} 条` : undefined}
          href={todays_insights.length > 0 ? "/m/insights" : undefined}
        />
        {todays_insights.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 p-4 text-center text-xs text-zinc-500">
            今天 AI 还 没 给 新 判断
            <p className="mt-1 text-[10px] text-zinc-600">
              进 一场 会议 召 AI 加 视角, 立 刻 有 产出
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {todays_insights.map((ins) => (
              <AIInsightCard key={ins.id} insight={ins} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
