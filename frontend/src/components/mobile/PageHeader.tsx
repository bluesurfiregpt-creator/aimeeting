"use client";

/**
 * v27.0-mobile · 每页统一顶部头.
 *
 * 替代之前 layout 里的 TopBar (问候+图标). 移动原生工作台不上来问好.
 *
 * 结构:
 *   ┌──────────────────────────────────┐
 *   │ <大标题>             🔔(N) ⚙   │  ← row 1: 24-28px title + 右上 icons
 *   │                                   │
 *   │ [Segment Tabs ...]               │  ← row 2: optional segment
 *   └──────────────────────────────────┘
 *
 * 用法:
 *   <PageHeader title="今日">
 *     <SegmentControl ... />
 *   </PageHeader>
 *
 * iOS 大标题风 — 不 sticky. 用户滚下去就消失, 给内容更多空间.
 * 右上角 icons 内嵌, 不挤占左侧标题.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function PageHeader({
  title,
  children,
  showActions = true,
}: {
  title: string;
  children?: React.ReactNode; // 通常放 SegmentControl
  showActions?: boolean; // false 时不显右上角 icons (用于详情页)
}) {
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    if (!showActions) return;
    let alive = true;
    api.me().then(
      (m) => {
        if (!alive) return;
        const c = m.task_counts;
        if (c) {
          const n =
            (c.kb_sedimentation_pending ?? 0) + (c.memory_draft_pending ?? 0);
          setUnread(n);
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [showActions]);

  return (
    <header
      className="px-4 pt-5 pb-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0) + 20px)" }}
      data-testid="mobile-page-header"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-semibold leading-none text-zinc-50">
          {title}
        </h1>
        {showActions ? (
          <div className="flex items-center gap-3">
            <Link
              href="/m/notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 active:bg-ink-800 active:text-zinc-200"
              aria-label="通知"
            >
              <span className="text-[18px]">🔔</span>
              {unread > 0 ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
            <Link
              href="/m/me"
              className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 active:bg-ink-800 active:text-zinc-200"
              aria-label="我"
            >
              <span className="text-[18px]">⚙</span>
            </Link>
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}
