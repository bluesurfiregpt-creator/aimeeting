"use client";

import { useEffect, useState } from "react";
import { WPage } from "../atoms";
import { HomeHero } from "./HomeHero";
import { DiscoveryBox } from "./DiscoveryBox";
import { HomeFeedTabs, type HomeTab } from "./HomeFeedTabs";
import { MeetingsPulse, type MeetingsPulseLiveData } from "./MeetingsPulse";
import { AgentMarketplace } from "./AgentMarketplace";
import { AgentQuickModal } from "./AgentQuickModal";
import {
  api,
  type V2TodayBriefResponse,
  type V2TodaySnapshotResponse,
  type V2TodayLiveMeetingResponse,
} from "@/lib/api";

/**
 * 首页 root.
 * 主结构: Hero + Discovery + HomeFeedTabs ↓ (你的会议 | AI 专家) + QuickModal.
 *
 * AI tab 内的 AgentMarketplace 点卡 → 打开 AgentQuickModal (不跳页).
 *
 * Sprint 3 Web W1 (Saga T1-T2 真接):
 *   - DiscoveryBox: /api/v2/today/brief (Phase 1 mock, Saga T6 NLU 真接)
 *   - MeetingsPulse: /api/v2/today/live-meeting + /api/v2/today/snapshot
 *   - HomeFeedTabs: 用 snapshot.meetings_today 等替换 hardcode
 *
 * 拉数据 在 root, 一次请求, 通过 props 分发给子组件 (避免 3 个组件各拉一次).
 * 失败 fallback to mock (workspace 还没沉淀真实 meeting 时 视觉不空盘).
 */
export function WebHome() {
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [tab, setTab] = useState<HomeTab>("meet");

  const [brief, setBrief] = useState<V2TodayBriefResponse | null>(null);
  const [live, setLive] = useState<V2TodayLiveMeetingResponse | null>(null);
  const [snapshot, setSnapshot] = useState<V2TodaySnapshotResponse | null>(null);
  const [usingRealData, setUsingRealData] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 并行拉 — 一个失败不阻塞其他 2 个 (Promise.allSettled).
        const [b, l, s] = await Promise.allSettled([
          api.getTodayBrief(),
          api.getTodayLiveMeeting(),
          api.getTodaySnapshot(),
        ]);
        if (cancelled) return;
        let realCount = 0;
        if (b.status === "fulfilled") {
          setBrief(b.value);
          realCount++;
        }
        if (l.status === "fulfilled") {
          setLive(l.value);
          realCount++;
        }
        if (s.status === "fulfilled") {
          setSnapshot(s.value);
          realCount++;
        }
        // 至少 1 个 endpoint 通了, 标 真接 (避免登录态丢失时 还显示 "真数据")
        setUsingRealData(realCount > 0);
      } catch (e) {
        console.warn("[WebHome] 拉取 today APIs 失败, 渲染 mock:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build MeetingsPulse 输入 — 真接成功用 backend 数据, 否则 fallback to mock 默认.
  const liveData: MeetingsPulseLiveData | null = (() => {
    if (!live || !live.meeting) return null;
    const m = live.meeting;
    // started_at → 已 elapsed 分钟; backend 直给 elapsed_minutes
    const elapsed = Math.max(0, m.elapsed_minutes ?? 0);
    // duration — 后端 V2MeetingItem 没直接给 estimated_duration; 用 60 默认
    // (Saga T 后续可加 duration_min 字段; 现先 hardcode 60 让 ring timer 视觉合理)
    const duration = 60;
    return {
      id: m.id,
      title: m.title,
      sub: m.attendees.length > 0 ? `${m.human_count} 人参会` : "未命名场合",
      topic: m.topic_summary || m.title,
      elapsed,
      duration,
      participants: m.attendees
        .filter((a) => a.type === "human")
        .slice(0, 5)
        .map((a) => (a.name?.slice(0, 2) || "?").toUpperCase()),
      ais: m.ai_badges.slice(0, 4).map((a) => (a.name || a.id).toUpperCase()),
      miraNote: live.mira_note || undefined,
    };
  })();

  return (
    <WPage>
      <HomeHero />
      <DiscoveryBox brief={brief} />
      <HomeFeedTabs
        tab={tab}
        onChange={setTab}
        meetingsToday={snapshot?.meetings_today ?? null}
      />
      {tab === "meet" && (
        <MeetingsPulse
          liveData={liveData}
          snapshot={snapshot}
          usingRealData={usingRealData}
        />
      )}
      {tab === "ai" && <AgentMarketplace onOpenAgent={setModalAgentId} />}
      <AgentQuickModal id={modalAgentId} onClose={() => setModalAgentId(null)} />
    </WPage>
  );
}
