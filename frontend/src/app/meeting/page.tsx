import { redirect } from "next/navigation";

/**
 * `/meeting` 顶 (没 id) 直接 跳 首页.
 *
 * 历史: `/meeting` 路径 之前 只有 `[id]/` 子目录, 没 顶层 page.tsx → 撞 Next.js 404.
 * MeetingsPulse 多处 link 跳 `/meeting` (StatTile "进行中") → 用户 必撞 404.
 *
 * v1.4.0 PM 反馈 修 (2026-05-28): 不创新 列表 page (首页 已 有 LIVE + upcoming + history
 * 三段 + AI 32 位), 直接 跳 home, 避免 重 复 信息架构.
 */
export default function MeetingIndexPage() {
  redirect("/");
}
