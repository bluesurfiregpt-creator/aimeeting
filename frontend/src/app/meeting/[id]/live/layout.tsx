import Script from "next/script";
import { MR_THEME_BOOTSTRAP } from "@/components/web/meeting-room/tokens";

/**
 * R5.D 会议室 in-meeting 路由专属 layout — 在 hydrate 前 把 `<html data-theme>`
 * 设到 浅色 (符合 NORTH_STAR § 7.1.1 例外 第 2 条 "default 仍浅色").
 *
 * **跟 workstation/layout.tsx 区别**:
 *  - workstation 走 W_THEME_BOOTSTRAP, 默认 dark
 *  - 会议室 走 MR_THEME_BOOTSTRAP, 默认 light
 *  - 但 storage key 共用 ('w-theme'), 用户 切 dark 后 持久化, 两边一致
 *
 * **为什么 用 layout 而不是 page**:
 *  - `<Script beforeInteractive>` 在 layout 比 page 先 fire, 避免 浅 → 深 flash
 *  - Next.js 15 App Router 推荐 layout 注入 全局 side effect (theme / fonts)
 *
 * **不污染 globals.css**:
 *  - MR_THEME_CSS 由 useAnimations 在 mount 时 注入 <head>
 *  - layout 只是 set 一次 data-theme attr, hydrate 后 useWebTheme 接管
 */
export default function MeetingLiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script id="mr-theme-bootstrap" strategy="beforeInteractive">
        {MR_THEME_BOOTSTRAP}
      </Script>
      {children}
    </>
  );
}
