"use client";

/**
 * v1.4.0 · Saga O / M5 · /m/insights v2 全面升级 — MemoryRadar 灵魂.
 *
 * 设计源 1:1:
 *   - /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx (MemoryView + MemoryRadar)
 *   - /tmp/aimeeting-design-research/design-shots/memory.png + memory-scroll.png
 *
 * 改动 (vs Saga K):
 *   - PageHeader "记忆" + subtitle ("100 条 · 6 个领域")
 *   - 加 MMemoryRadar 紫深色 hero (6 轴 SVG · 你 vs 团队 · 2.8s 自动收起)
 *   - MASegmented [快照(N) / 待审(N) / 记忆库(N)]
 *   - 快照 tab: AI 头像 + 议题 + chip count (调 /api/v2/memory/snapshots)
 *   - 待审 + 记忆库 tab: MAEmpty 占位 (Phase 2 补真实数据)
 *
 * 数据源 mock — Phase 2 backend 真接 (V2 SCHEMA §4.3 + §4.4).
 *
 * 风格守门: MR_COLORS 浅 iOS + 紫深色 hero (合法的灵魂卡, 不是 dark token).
 */

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";

import PageHeader from "@/components/mobile/PageHeader";
import {
  MASegmented,
  MAEmpty,
  MMemoryRadar,
  MAIBadge,
  MAIcon,
  type V2RadarData,
  type V2MemorySnapshotsResponse,
  type V2MemorySnapshot,
} from "@/components/mobile/v2";

type Tab = "snapshot" | "pending" | "library";

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

export default function MobileInsightsPage(): ReactElement {
  const [active, setActive] = useState<Tab>("snapshot");
  const [radar, setRadar] = useState<V2RadarData | null>(null);
  const [snapshots, setSnapshots] = useState<V2MemorySnapshotsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      jget<V2RadarData>("/api/v2/memory/radar"),
      jget<V2MemorySnapshotsResponse>("/api/v2/memory/snapshots"),
    ])
      .then(([r, s]) => {
        if (cancelled) return;
        setRadar(r);
        setSnapshots(s);
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

  return (
    <div
      style={{
        minHeight: "100%",
        background: "#F2F2F7",
        paddingBottom: 20,
      }}
    >
      <PageHeader
        title="记忆"
        subtitle={
          radar
            ? `${radar.total_memories} 条 · ${radar.total_axes_covered} 个领域`
            : undefined
        }
      />

      {/* MemoryRadar 紫深色 hero — 2.8s 后自动收起 */}
      {radar ? (
        <div style={{ padding: "12px 16px 8px" }}>
          <MMemoryRadar data={radar} />
        </div>
      ) : null}

      {/* Segmented */}
      <div style={{ padding: "6px 16px 8px" }}>
        <MASegmented
          tabs={[
            {
              id: "snapshot",
              label: "快照",
              count: snapshots?.total_count ?? 0,
            },
            { id: "pending", label: "待审", count: 2 },
            { id: "library", label: "记忆库", count: 14 },
          ]}
          active={active}
          onChange={(id) => setActive(id as Tab)}
        />
      </div>

      {/* 内容区 */}
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <div style={{ padding: "20px 16px" }}>
          <MAEmpty icon="flag" title="加载失败" body={error} />
        </div>
      ) : active === "snapshot" ? (
        <SnapshotsList items={snapshots?.items ?? []} />
      ) : active === "pending" ? (
        <div style={{ padding: "32px 16px" }}>
          <MAEmpty
            icon="clock"
            title="待审 — Phase 2 接入"
            body="AI 筛出值得记住的快照,人工拍板要不要进记忆库。功能开发中。"
          />
        </div>
      ) : (
        <div style={{ padding: "32px 16px" }}>
          <MAEmpty
            icon="archive"
            title="记忆库 — Phase 2 接入"
            body="进入长期记忆库的条目,AI 后续会自动调用做上下文。功能开发中。"
          />
        </div>
      )}
    </div>
  );
}

function SnapshotsList({
  items,
}: {
  items: V2MemorySnapshot[];
}): ReactElement {
  if (items.length === 0) {
    return (
      <div style={{ padding: "32px 16px" }}>
        <MAEmpty
          icon="sparkle"
          title="还没有 AI 快照"
          body="会议中 AI 发言会自动浓缩成快照, 出现在这里"
        />
      </div>
    );
  }
  return (
    <div style={{ padding: "0 16px" }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          overflow: "hidden",
          border: "0.5px solid rgba(60,60,67,0.10)",
          boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
        }}
      >
        {items.map((s, i) => (
          <SnapshotRow
            key={s.id}
            snapshot={s}
            last={i === items.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function SnapshotRow({
  snapshot,
  last,
}: {
  snapshot: V2MemorySnapshot;
  last: boolean;
}): ReactElement {
  const s = snapshot;
  const inner = (
    <>
      {/* AI 头像 stack (最多 2 个, 重叠) */}
      <div
        style={{
          display: "inline-flex",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        {s.ai_avatars.slice(0, 2).map((a, i) => (
          <div
            key={i}
            style={{
              marginLeft: i === 0 ? 0 : -8,
              zIndex: 2 - i,
            }}
          >
            <MAIBadge
              name={a.glyph}
              glyph={a.glyph}
              gradient_from={a.gradient_from}
              gradient_to={a.gradient_to}
              size={28}
              ring="#fff"
            />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 600,
            color: "#1C1C1E",
            lineHeight: 1.35,
            letterSpacing: -0.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {s.topic}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "#8E8E93",
            marginTop: 3,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>{s.ai_avatars.length} 位 AI</span>
          {s.types.length > 0 ? (
            <>
              <span style={{ color: "#C7C7CC" }}>·</span>
              <span>{s.types.join(" / ")}</span>
            </>
          ) : null}
        </div>
      </div>
      {/* 紫色 count chip */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 24,
          height: 22,
          padding: "0 7px",
          borderRadius: 6,
          background: "rgba(94,92,230,0.12)",
          color: "#5E5CE6",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {s.count}
      </span>
      <span style={{ color: "#C7C7CC", marginLeft: 2, flexShrink: 0 }}>
        <MAIcon name="chev" size={16} color="#C7C7CC" strokeWidth={2} />
      </span>
    </>
  );
  const style = {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "12px 14px",
    borderBottom: last ? "none" : "0.5px solid rgba(60,60,67,0.10)",
    textDecoration: "none",
    color: "inherit",
  } as const;
  if (s.source_meeting_id) {
    return (
      <Link href={`/m/meetings/${s.source_meeting_id}`} style={style}>
        {inner}
      </Link>
    );
  }
  return <div style={style}>{inner}</div>;
}

function SkeletonList(): ReactElement {
  return (
    <div style={{ padding: "0 16px" }}>
      <div
        style={{
          background: "rgba(60,60,67,0.04)",
          borderRadius: 14,
          height: 250,
        }}
      />
    </div>
  );
}
