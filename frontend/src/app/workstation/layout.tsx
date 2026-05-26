import Script from "next/script";
import { WPage } from "@/components/web/atoms";
import { W_THEME_BOOTSTRAP } from "@/components/web/tokens";
import { WorkstationSidebar } from "@/components/web/workstation";

/**
 * Workstation 段落公共 layout — sidebar + main pane.
 *
 * 所有 `/workstation/*` 子路由共用这一层壳:
 *  - WPage 提供 WThemeProvider + 顶 nav + 暗紫背景
 *  - Sidebar 自动从 pathname 推导激活态
 *  - children 由具体 pane (e.g. /workstation/page.tsx) 渲染
 *
 * Theme bootstrap (zero-flash):
 *  - 跟首页一样 用 <Script beforeInteractive> 在 hydrate 前 set data-theme
 *
 * PM R2 决策: App Router (不用 hash). 见 docs/design/specs/SAGA-web-redesign-round-5-changelist.md § 12.
 */
export default function WorkstationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script id="w-theme-bootstrap-ws" strategy="beforeInteractive">
        {W_THEME_BOOTSTRAP}
      </Script>
      <WPage>
        <div style={{ display: "flex", gap: 32, paddingTop: 8 }}>
          <WorkstationSidebar />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              paddingTop: 20,
              paddingBottom: 40,
            }}
          >
            {children}
          </div>
        </div>
      </WPage>
    </>
  );
}
