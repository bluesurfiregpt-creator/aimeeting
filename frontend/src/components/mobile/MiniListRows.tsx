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
 *
 * v1.4.0 Saga K · 浅色化 (跟 /m today + /m/me 一致, iOS 浅色).
 */

import Link from "next/link";
import type {
  AIInsightFull,
  WorkbenchPendingTask,
} from "@/lib/mobile/types";
import { MR_COLORS } from "@/components/mobile/meeting-room/styles";

// ---------- Pending mini row ---------------------------------------------

const PENDING_STYLES: Record<
  WorkbenchPendingTask["kind"],
  {
    icon: string;
    label: string;
    chipBg: string;
    chipFg: string;
    href: (id: string) => string;
  }
> = {
  confirm: {
    icon: "⏳",
    label: "待确认",
    chipBg: "rgba(255,159,10,0.12)",
    chipFg: MR_COLORS.systemOrange,
    href: (id) => `/m/tasks/${id}`,
  },
  approve_draft: {
    icon: "📝",
    label: "待审",
    chipBg: "rgba(0,122,255,0.10)",
    chipFg: MR_COLORS.systemBlue,
    href: () => `/m/insights`,
  },
  blocked: {
    icon: "🚨",
    label: "阻塞",
    chipBg: "rgba(255,59,48,0.10)",
    chipFg: MR_COLORS.systemRed,
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
      className="flex min-h-[56px] items-center gap-3 rounded-xl px-4 py-3 active:scale-[0.99] transition"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid={`mobile-pending-row-${item.kind}`}
    >
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium"
        style={{ background: s.chipBg, color: s.chipFg }}
      >
        <span>{s.icon}</span>
        <span>{s.label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[16px]"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {item.title}
        </p>
        {aiHint ? (
          <p
            className="mt-1 truncate text-[13px]"
            style={{ color: MR_COLORS.textTertiary }}
          >
            {aiHint}
          </p>
        ) : null}
      </div>
      <span
        className="shrink-0 text-[18px]"
        style={{ color: MR_COLORS.textQuaternary }}
      >
        ›
      </span>
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
      className="flex min-h-[56px] items-center gap-3 rounded-xl px-4 py-3 active:scale-[0.99] transition"
      style={{
        background: MR_COLORS.bgWhite,
        border: `0.5px solid ${MR_COLORS.hairline}`,
      }}
      data-testid="mobile-insight-topic-row"
    >
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "rgba(94,92,230,0.10)",
          color: MR_COLORS.systemPurple,
        }}
      >
        💡
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[16px]"
          style={{ color: MR_COLORS.textPrimary }}
        >
          {titleLine}
        </p>
        <p
          className="mt-1 truncate text-[13px]"
          style={{ color: MR_COLORS.textTertiary }}
        >
          {subtitle}
        </p>
      </div>
      <span
        className="shrink-0 rounded-md px-2 py-1 text-[13px] font-medium tabular-nums"
        style={{
          background: "rgba(94,92,230,0.10)",
          color: MR_COLORS.systemPurple,
        }}
      >
        {n}
      </span>
      <span
        className="shrink-0 text-[18px]"
        style={{ color: MR_COLORS.textQuaternary }}
      >
        ›
      </span>
    </Link>
  );
}
