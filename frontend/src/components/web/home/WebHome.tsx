"use client";

import { useState } from "react";
import { WPage } from "../atoms";
import { HomeHero } from "./HomeHero";
import { DiscoveryBox } from "./DiscoveryBox";
import { HomeFeedTabs, type HomeTab } from "./HomeFeedTabs";
import { MeetingsPulse } from "./MeetingsPulse";
import { AgentMarketplace } from "./AgentMarketplace";
import { AgentQuickModal } from "./AgentQuickModal";

/**
 * 首页 root.
 * 主结构: Hero + Discovery + HomeFeedTabs ↓ (你的会议 | AI 专家) + QuickModal.
 *
 * AI tab 内的 AgentMarketplace 点卡 → 打开 AgentQuickModal (不跳页).
 */
export function WebHome() {
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [tab, setTab] = useState<HomeTab>("meet");

  return (
    <WPage>
      <HomeHero />
      <DiscoveryBox />
      <HomeFeedTabs tab={tab} onChange={setTab} />
      {tab === "meet" && <MeetingsPulse />}
      {tab === "ai" && <AgentMarketplace onOpenAgent={setModalAgentId} />}
      <AgentQuickModal id={modalAgentId} onClose={() => setModalAgentId(null)} />
    </WPage>
  );
}
