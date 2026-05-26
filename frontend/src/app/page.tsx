import Script from "next/script";
import { WebHome } from "@/components/web/home/WebHome";
import { W_THEME_BOOTSTRAP } from "@/components/web/tokens";

/**
 * 首页 — round-5 Web 端整体重做 (R5.A Saga).
 *
 * 内容:
 *  - HomeHero (紫渐变 "让会议拥有 超脑与灵魂")
 *  - DiscoveryBox (对话式发现 + 3 chip + 1.4s 拆解动画)
 *  - HomeFeedTabs (横向 "你的会议" / "AI 专家" 切换)
 *  - MeetingsPulse (LIVE + 即将开始 + 最近纪要)
 *  - AgentMarketplace (16 张 AI 卡 + 类目 + 搜索)
 *  - AgentQuickModal (点卡弹窗预览)
 *
 * Theme bootstrap (zero-flash):
 *  - <Script beforeInteractive> 在 React hydrate 前 读 localStorage.w-theme
 *    并 set <html data-theme=...>, 这样 暗紫 → 浅色 切换不闪.
 *
 * 不动:
 *  - app/layout.tsx (全局, mobile/web 共享, 不能改)
 *  - app/globals.css (mobile MR_COLORS 共享)
 *  - app/m/* (mobile)
 */
export default function Home() {
  return (
    <>
      <Script id="w-theme-bootstrap" strategy="beforeInteractive">
        {W_THEME_BOOTSTRAP}
      </Script>
      <WebHome />
    </>
  );
}
