/**
 * v27.0-mobile · 移动端 fetch helper.
 *
 * 极简 — 仅 wrap fetch 加 credentials. 不 复用 桌面 lib/api.ts 的 jget,
 * 因为 那边 含 全 局 toast 路径, 移动端 想 自己 控 错误 显示.
 */

import type {
  AIInsightFull,
  MobileMeetingDetail,
  WorkbenchOut,
} from "./types";

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`${path} → ${r.status}`);
  }
  return (await r.json()) as T;
}

export const mApi = {
  getWorkbench: () => jget<WorkbenchOut>("/api/m/workbench"),
  getMeetingDetail: (id: string) =>
    jget<MobileMeetingDetail>(`/api/m/meetings/${id}`),
  getInsights: (params?: { by_agent?: string; by_meeting?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.by_agent) q.set("by_agent", params.by_agent);
    if (params?.by_meeting) q.set("by_meeting", params.by_meeting);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jget<AIInsightFull[]>(`/api/m/insights${qs ? `?${qs}` : ""}`);
  },
};
