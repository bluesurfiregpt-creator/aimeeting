"use client";

/**
 * v27.0-mobile · 下段紧凑 mini list 行.
 *
 * 跟 Hero 形成强视觉对比 — Hero 是主锚 (大), 这里是跳转入口 (小).
 * 一行一条摘要, 点跳二级屏. 不再卡平铺.
 *
 * 两类行:
 *   PendingMiniRow         — 等你处理一条
 *   InsightTopicGroupRow   — AI 智囊按议题聚合一条 (核心 — 立 "多视角辩论" 感)
 */

import Link from "next/link";
import type {
  AIInsightFull,
  WorkbenchPendingTask,
} from "@/lib/mobile/types";

// ---------- Pending mini row ---------------------------------------------

const PENDING_STYLES: Record<
  WorkbenchPendingTask["kind"],
  { icon: string; label: string; chipBg: string; chipText: string; href: (id: string) => string }
> = {
  confirm: {
    icon: "⏳",
    label: "待确认",
    chipBg: "bg-amber-500/15",
    chipText: "text-amber-200",
    href: (id) => `/m/tasks/${id}`,
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "bg-accent-500/15",
    chipText: "text-accent-200",
    href: () => `/m/insights`,
  },
  blocked: {
    icon: "🚨",
    label: "阻塞",
    chipBg: "bg-rose-500/15",
    chipText: "text-rose-200",
    href: (id) => `/m/tasks/${id}`,
  },
};

export function PendingMiniRow({ item }: { item: WorkbenchPendingTask }) {
  const s = PENDING_STYLES[item.kind];
  const aiHint =
    item.insights.length > 0
      ? `◆ ${item.insights.length} 位 AI 已备立场`
      : item.source_meeting_title
      ? `来自 ${item.source_meeting_title}`
      : null;
  return (
    <Link
      href={s.href(item.id)}
      className="flex min-h-[56px] items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 active:scale-[0.99] transition"
      data-testid={`mobile-pending-row-${item.kind}`}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium ${s.chipBg} ${s.chipText}`}
      >
        <span>{s.icon}</span>
        <span>{s.label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-zinc-100">{item.title}</p>
        {aiHint ? (
          <p className="mt-0.5 truncate text-[12px] text-zinc-500">{aiHint}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-zinc-600">›</span>
    </Link>
  );
}

// ---------- Insight 按议题聚合行 (★ 核心 — 多视角辩论感) -----------

type Topic = {
  key: string;
  meeting_id: string;
  meeting_title: string;
  topic_idx: number | null;
  insights: AIInsightFull[];
};

/** 把 flat insights 按 (meeting_id, topic_idx) 聚合 */
export function groupInsightsByTopic(insights: AIInsightFull[]): Topic[] {
  const map = new Map<string, Topic>();
  for (const ins of insights) {
    const key = `${ins.meeting_id}|${ins.topic_idx ?? "_"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        meeting_id: ins.meeting_id,
        meeting_title: ins.meeting_title || "(未命名会议)",
        topic_idx: ins.topic_idx,
        insights: [],
      };
      map.set(key, g);
    }
    g.insights.push(ins);
  }
  return Array.from(map.values());
}

export function InsightTopicGroupRow({ topic }: { topic: Topic }) {
  const n = topic.insights.length;
  // 数一下不同 type 的数 — 立 "多视角辩论" 感
  const types = Array.from(new Set(topic.insights.map((i) => i.type)));
  const agentNames = Array.from(
    new Set(
      topic.insights.map((i) => i.agent_nickname?.trim() || i.agent_name)
    )
  );

  // 子标文案 — 根据内容决定
  let subtitle = "";
  if (agentNames.length >= 2) {
    subtitle = `${agentNames.length} 位 AI · ${types.join(" / ")}`;
  } else if (agentNames.length === 1) {
    subtitle = `${agentNames[0]} · ${types.join(" / ")} ${n} 条`;
  }

  const titleLine = topic.topic_idx !== null
    ? `${topic.meeting_title} · 议题 ${topic.topic_idx + 1}`
    : topic.meeting_title;

  return (
    <Link
      href={`/m/insights?by_meeting=${topic.meeting_id}`}
      className="flex min-h-[56px] items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 active:scale-[0.99] transition"
      data-testid="mobile-insight-topic-row"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
        💡
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-zinc-100">{titleLine}</p>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500">{subtitle}</p>
      </div>
      <span className="shrink-0 rounded-md bg-violet-500/15 px-2 py-0.5 text-[12px] font-medium text-violet-300">
        {n}
      </span>
      <span className="shrink-0 text-zinc-600">›</span>
    </Link>
  );
}
