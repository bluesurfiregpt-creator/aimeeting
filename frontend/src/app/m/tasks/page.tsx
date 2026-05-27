"use client";

/**
 * v1.4.0 · Saga O / M4 · /m/tasks v2 全面升级.
 *
 * 设计源 1:1:
 *   - /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx (TasksView)
 *   - /tmp/aimeeting-design-research/design-shots/tasks.png + tasks-scroll.png
 *
 * 改动 (vs Saga K):
 *   - PageHeader "任务" + subtitle (priority banner 文本)
 *   - 加 MAGlowBanner tone="priority" — Mira 优先级 hero (调 /api/v2/tasks/priority-banner)
 *   - MASegmented [等你处理(N) / 跟踪中(N) / 已完成(N)]
 *   - 按会议分组 (调 /api/v2/tasks/grouped?status=...)
 *   - 每组 meeting_title header + MTaskRow × N
 *   - 数据源 mock — Phase 2 backend 真接 (V2 SCHEMA §4.1 + §4.2)
 *
 * 风格守门: MR_COLORS 浅 iOS · 跟 Saga M Meetings + Saga N Today 视觉延续.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";

import PageHeader from "@/components/mobile/PageHeader";
import {
  MASegmented,
  MAEmpty,
  MAGlowBanner,
  MTaskRow,
  type V2TasksGroupedResponse,
  type V2PriorityBanner,
} from "@/components/mobile/v2";

type Status = "pending" | "tracking" | "done";

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

export default function MobileTasksPage(): ReactElement {
  const [active, setActive] = useState<Status>("pending");
  const [banner, setBanner] = useState<V2PriorityBanner | null>(null);
  const [grouped, setGrouped] = useState<
    Record<Status, V2TasksGroupedResponse | null>
  >({
    pending: null,
    tracking: null,
    done: null,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 拉所有 status (3 个) + priority banner 一次性, 切 segment 无需重拉
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      jget<V2PriorityBanner>("/api/v2/tasks/priority-banner"),
      jget<V2TasksGroupedResponse>("/api/v2/tasks/grouped?status=pending"),
      jget<V2TasksGroupedResponse>("/api/v2/tasks/grouped?status=tracking"),
      jget<V2TasksGroupedResponse>("/api/v2/tasks/grouped?status=done"),
    ])
      .then(([b, p, t, d]) => {
        if (cancelled) return;
        setBanner(b);
        setGrouped({ pending: p, tracking: t, done: d });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // segmented tab counts — 统计每个 status 下的总任务数
  const counts = useMemo(() => {
    function totalOf(g: V2TasksGroupedResponse | null): number {
      if (!g) return 0;
      return g.groups.reduce((acc, gr) => acc + gr.tasks.length, 0);
    }
    return {
      pending: totalOf(grouped.pending),
      tracking: totalOf(grouped.tracking),
      done: totalOf(grouped.done),
    };
  }, [grouped]);

  const activeGroups = grouped[active]?.groups ?? [];

  return (
    <div
      style={{
        minHeight: "100%",
        background: "#F2F2F7",
        paddingBottom: 20,
      }}
    >
      {/* v1.4.0 Saga R (Phase 1 P1 M4-01): subtitle 文案改 "待处理 X · 跟踪中 Y"
          (设计稿 mobile-screens.jsx · tasks header). 数据走 counts (实时反映
          grouped 各 status tasks 数), 不走 banner — banner 是
          urgent_task_count + ai_suggestion_count, 跟设计稿展示维度不一致.
          首屏 banner 未 ready 时降级显示 banner 旧文案 fallback. */}
      <PageHeader
        title="任务"
        subtitle={
          !loading
            ? `待处理 ${counts.pending} · 跟踪中 ${counts.tracking}`
            : banner
            ? `${banner.urgent_task_count} 项紧急 · ${banner.ai_suggestion_count} 条 AI 建议`
            : undefined
        }
      />

      {/* Mira 优先级 hero — 紫渐变 */}
      {banner ? (
        <div style={{ padding: "12px 16px 8px" }}>
          <MAGlowBanner
            tone="priority"
            icon="sparkle"
            eyebrow="MIRA · 优先级"
            title={banner.summary_text}
            body={banner.ai_suggestion_text}
          />
        </div>
      ) : null}

      {/* Segmented */}
      <div style={{ padding: "6px 16px 8px" }}>
        <MASegmented
          tabs={[
            { id: "pending", label: "等你处理", count: counts.pending },
            { id: "tracking", label: "跟踪中", count: counts.tracking },
            { id: "done", label: "已完成", count: counts.done },
          ]}
          active={active}
          onChange={(id) => setActive(id as Status)}
        />
      </div>

      {/* 内容区 */}
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <div style={{ padding: "20px 16px" }}>
          <MAEmpty
            icon="flag"
            title="加载失败"
            body={error}
          />
        </div>
      ) : activeGroups.length === 0 ? (
        <div style={{ padding: "32px 16px" }}>
          <MAEmpty
            icon="check"
            title={emptyTitle(active)}
            body={emptyBody(active)}
          />
        </div>
      ) : (
        <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 16 }}>
          {activeGroups.map((g) => (
            <section key={g.meeting_id}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#8E8E93",
                  letterSpacing: 0.3,
                  textTransform: "uppercase",
                  padding: "4px 4px 8px",
                  margin: 0,
                }}
              >
                {g.meeting_title}
              </h3>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  overflow: "hidden",
                  border: "0.5px solid rgba(60,60,67,0.10)",
                  boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
                }}
              >
                {g.tasks.map((t, i) => (
                  <MTaskRow
                    key={t.id}
                    task={t}
                    last={i === g.tasks.length - 1}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyTitle(s: Status): string {
  if (s === "pending") return "待办全处理完";
  if (s === "tracking") return "没有跟踪中的任务";
  return "还没有已完成的任务";
}

function emptyBody(s: Status): string | undefined {
  if (s === "pending") return "会议结束后, AI 抽出的待办会出现在这里";
  if (s === "tracking") return "派给 AI 的任务在进展时会出现这里";
  return undefined;
}

function SkeletonList(): ReactElement {
  return (
    <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div
            style={{
              height: 12,
              width: 120,
              background: "rgba(60,60,67,0.06)",
              borderRadius: 4,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              background: "rgba(60,60,67,0.04)",
              borderRadius: 14,
              height: 96,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}
