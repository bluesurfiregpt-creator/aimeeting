// Workstation barrel. **不要** 从这里 export LineagePane —
// 它依赖 echarts (~900KB gzip), 必须通过 `next/dynamic` 客户端加载, 否则会进入
// 所有 workstation 路由的 first-load bundle.
//
// 用法:
//   import dynamic from "next/dynamic";
//   const LineagePane = dynamic(() => import(".../LineagePane"), { ssr: false });
export { WorkstationSidebar } from "./Sidebar";
export { PaneHeader } from "./PaneHeader";
export { PlaceholderPane } from "./PlaceholderPane";
export { MentalModelPane } from "./MentalModelPane";
export { MeetingHistoryPane } from "./MeetingHistoryPane";
export { WS_SECTIONS, WS_VALID_SLUGS } from "./sidebarConfig";
export type { WSSidebarItem, WSSection } from "./sidebarConfig";
