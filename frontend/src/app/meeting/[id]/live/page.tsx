/**
 * R5.D — Web in-meeting 体验 (沉浸全屏, 浅色 iOS 风).
 *
 * 路由方案 B (PM 推荐): 独立路由 `/meeting/[id]/live`, **不在 workstation 内**,
 * 没有 sidebar / WTopNav / 暗紫 W_THEME, 全屏沉浸.
 *
 * 跟 R5.B 区分:
 *   - `/workstation/meeting/[id]`  → R5.B MeetingDetailPane (post-meeting 回看, 6 tabs)
 *   - `/meeting/[id]/live`         → R5.D MRLiveView (in-meeting 实时, 三栏布局) — **本文件**
 *   - `/meeting/[id]`              → 老的 orchestrate UI (round-3 之前的会议室, ~4700 行 client component)
 *
 * 后续 Saga E.E 接通 backend 后, 数据从 mock 切真实 WS push, 路由不变.
 */

import { MRLiveView } from "@/components/web/meeting-room";

export default async function MeetingLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "fixed",
        inset: 0,
        background: "#fff",
        // 高于 VersionBadge (z-10) — VersionBadge 已 fixed bottom-2 left-2 不能 hide
        // (会议室 chrome 隐藏 list 没把 VersionBadge 加进, 但 PM 没要求 hide build 标识)
        zIndex: 20,
      }}
    >
      <MRLiveView meetingId={id} />
    </div>
  );
}
