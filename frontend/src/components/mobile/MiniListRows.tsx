"use client";

/**
 * v27.0-mobile · 下段 紧凑 mini list 行.
 *
 * 跟 Hero 形成 强 视觉 对比 — Hero 是 主 锚 (大), 这 里 是 跳 转 入 口 (小).
 * 一 行 一 条 摘要, 点 跳 二级 屏. 不 再 卡 平铺.
 *
 * 两 类 行:
 *   PendingMiniRow         — 等 你 处理 一条
 *   InsightTopicGroupRow   — AI 智囊 按 议题 聚合 一条 (核 心 — 立 "多 视角 辩论" 感)
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
    label: "待 确认",
    chipBg: "bg-amber-500/15",
    chipText: "text-amber-200",
    href: (id) => `/m/tasks/${id}`,
  },
  approve_draft: {
    icon: "📝",
    label: "待 审",
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
      ? `◆ ${item.insights.length} 位 AI 已备 立场`
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

// ---------- Insight 按 议题 聚合 行 (★ 核心 — 多视角 辩论 感) -----------

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
        meeting_title: ins.meeting_title || "(未命名 会议)",
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
  // 数 一下 不同 type 的 数 — 立 "多视角 辩论" 感
  const types = Array.from(new Set(topic.insights.map((i) => i.type)));
  const agentNames = Array.from(
    new Set(
      topic.insights.map((i) => i.agent_nickname?.trim() || i.agent_name)
    )
  );

  // 子标 文案 — 根据 内容 决定
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
