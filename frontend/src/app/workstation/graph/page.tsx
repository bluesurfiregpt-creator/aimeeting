"use client";

import dynamic from "next/dynamic";

/**
 * /workstation/graph — 全景血缘图 · 桑基视图 (R5.B-replace, round-6).
 *
 * PM R6.4 决策: 侧栏移除入口 (已融入 AI 心智一览), 但 URL 保留, 用于:
 *  - 深链 / 分享给同事
 *  - 后续 OnBoarding 教程
 *  - "全屏探索"按钮也跳这里
 *
 * embedded=false: 显示 PaneHeader + FlowExample (跟嵌入版区分).
 *
 * 动态加载: echarts 仅客户端可用, 避免 SSR 报错 + 控制 first-load 体积.
 * 直接 import 文件路径, 不走 workstation/index barrel.
 */
const LineagePane = dynamic(
  () => import("@/components/web/workstation/LineagePane").then((m) => ({ default: m.LineagePane })),
  {
    ssr: false,
    loading: () => (
      <div style={{ padding: 40, textAlign: "center", color: "#a1a1aa" }}>血缘图加载中…</div>
    ),
  },
);

export default function GraphRoute() {
  return <LineagePane />;
}
