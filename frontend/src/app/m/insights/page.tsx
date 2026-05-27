"use client";

/**
 * v1.4.0 · Saga O / M5 + Sprint 3 Mobile Part 3 · /m/insights v2 全面升级 — MemoryRadar 灵魂.
 *
 * 设计源 1:1:
 *   - /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx (MemoryView + MemoryRadar)
 *   - /tmp/aimeeting-design-research/design-shots/memory.png + memory-scroll.png
 *
 * 改动 (vs Sprint 2):
 *   - 顶部 MemoryRadar 不变 (Saga O ship)
 *   - segmented 3 tab count 现走真实 backend (pending 用 /memory/drafts pending_count,
 *     library 用 /memory/library total_count + axes_with_count)
 *   - **待审 tab 实接** (NORTH_STAR § 4.2.1) — 调 /api/v2/memory/drafts?status=pending
 *     行 = AI 头像 + 草稿内容 + 来源会议 + 双按钮 审入/驳回
 *     审入 → POST /api/v2/memory/drafts/{id}/approve
 *     驳回 → POST /api/v2/memory/drafts/{id}/reject (无 reason)
 *   - **记忆库 tab 实接** (NORTH_STAR § 4.2.1) — 调 /api/v2/memory/library
 *     行 = AI 头像 + memory 内容 + axis_tag chip + 来源会议
 *     顶部加 axis chip filter (6 个领域 + 全部)
 *
 * 风格守门: MR_COLORS 浅 iOS + 紫深色 hero (合法的灵魂卡, 不是 dark token).
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
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
  type V2MemoryDraftsResponse,
  type V2MemoryDraftItem,
  type V2MemoryLibraryResponse,
  type V2MemoryLibraryItem,
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

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
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
  const [drafts, setDrafts] = useState<V2MemoryDraftsResponse | null>(null);
  const [library, setLibrary] = useState<V2MemoryLibraryResponse | null>(null);
  // axis filter for library tab — null = "全部"
  const [libraryAxis, setLibraryAxis] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 初次加载 — 拉 radar / snapshots / drafts / library 并行
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      jget<V2RadarData>("/api/v2/memory/radar"),
      jget<V2MemorySnapshotsResponse>("/api/v2/memory/snapshots"),
      jget<V2MemoryDraftsResponse>("/api/v2/memory/drafts?status=pending"),
      jget<V2MemoryLibraryResponse>("/api/v2/memory/library?limit=50"),
    ])
      .then(([r, s, d, l]) => {
        if (cancelled) return;
        setRadar(r);
        setSnapshots(s);
        setDrafts(d);
        setLibrary(l);
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

  // 库 axis 过滤 — 切 chip 后 单独 拉
  useEffect(() => {
    if (libraryAxis === null) return; // 不重拉 — 初次已拉全集
    let cancelled = false;
    jget<V2MemoryLibraryResponse>(
      `/api/v2/memory/library?limit=50&axis_tag=${encodeURIComponent(libraryAxis)}`,
    )
      .then((l) => {
        if (cancelled) return;
        setLibrary(l);
      })
      .catch(() => {
        // 静默 — 维持 上次 数据
      });
    return () => {
      cancelled = true;
    };
  }, [libraryAxis]);

  // 待审 — approve / reject 后 局部 刷新
  const refreshDrafts = useCallback(async () => {
    try {
      const d = await jget<V2MemoryDraftsResponse>(
        "/api/v2/memory/drafts?status=pending",
      );
      setDrafts(d);
    } catch {
      // 静默 — 维持 上次 数据
    }
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
            {
              id: "pending",
              label: "待审",
              count: drafts?.pending_count ?? 0,
            },
            {
              id: "library",
              label: "记忆库",
              count: library?.total_count ?? 0,
            },
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
        <DraftsList items={drafts?.items ?? []} onChanged={refreshDrafts} />
      ) : (
        <LibraryView
          items={library?.items ?? []}
          axesWithCount={library?.axes_with_count ?? {}}
          activeAxis={libraryAxis}
          onAxisChange={setLibraryAxis}
        />
      )}
    </div>
  );
}

/**
 * v1.4.0 Saga R (Phase 1 P1 M5-05) · 快照 list 限 12, 超过加 "查看更多 ›".
 * 设计稿前屏 7 项, prod 17 条全显; 限 12 + see-more pattern 既保留快速概览
 * 又允许 power user 展开全量.
 */
const INITIAL_VISIBLE_SNAPSHOTS = 12;

function SnapshotsList({
  items,
}: {
  items: V2MemorySnapshot[];
}): ReactElement {
  const [showAll, setShowAll] = useState(false);

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
  const visible =
    showAll || items.length <= INITIAL_VISIBLE_SNAPSHOTS
      ? items
      : items.slice(0, INITIAL_VISIBLE_SNAPSHOTS);
  const hasMore = !showAll && items.length > INITIAL_VISIBLE_SNAPSHOTS;

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
        {visible.map((s, i) => (
          <SnapshotRow
            key={s.id}
            snapshot={s}
            last={i === visible.length - 1 && !hasMore}
          />
        ))}
        {hasMore ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            data-testid="mobile-insights-see-more"
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "transparent",
              border: "none",
              borderTop: "0.5px solid rgba(60,60,67,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 14,
              fontWeight: 600,
              color: "#5E5CE6",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            查看更多
            <MAIcon name="chev" size={13} color="#5E5CE6" strokeWidth={2.2} />
            <span
              style={{
                marginLeft: 4,
                fontSize: 12,
                fontWeight: 500,
                color: "#8E8E93",
              }}
            >
              ({items.length - INITIAL_VISIBLE_SNAPSHOTS})
            </span>
          </button>
        ) : null}
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
    // v1.4.0 Sprint 3 Mobile Part 2 (NORTH_STAR § 3.1 v1.1): 出处链回 + 高亮 3 秒.
    // backend MemorySnapshot.focus_anchor (推自 insight.source_message_id) 拼成
    // ?focus=<anchor>&highlight=1, MeetingTranscriptView 接 → 滚到锚点 + 闪 3 次.
    // 没 focus_anchor 的 老 insight (source_message_id NULL): 退到 跳 meeting 不锚定.
    const href = s.focus_anchor
      ? `/m/meetings/${s.source_meeting_id}?focus=${encodeURIComponent(s.focus_anchor)}&highlight=1`
      : `/m/meetings/${s.source_meeting_id}`;
    return (
      <Link href={href} style={style} data-testid="snapshot-row">
        {inner}
      </Link>
    );
  }
  return <div style={style}>{inner}</div>;
}

// ============================================================================
// Sprint 3 Mobile Part 3 · 待审 tab — DraftsList
// ============================================================================

function DraftsList({
  items,
  onChanged,
}: {
  items: V2MemoryDraftItem[];
  onChanged: () => void;
}): ReactElement {
  if (items.length === 0) {
    return (
      <div style={{ padding: "32px 16px" }}>
        <MAEmpty
          icon="clock"
          title="没有待审记忆"
          body="AI 找到值得长期记住的内容时会出现在这里, 拍板要不要入库"
        />
      </div>
    );
  }
  return (
    <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((d) => (
        <DraftCard key={d.id} draft={d} onChanged={onChanged} />
      ))}
    </div>
  );
}

function DraftCard({
  draft,
  onChanged,
}: {
  draft: V2MemoryDraftItem;
  onChanged: () => void;
}): ReactElement {
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [err, setErr] = useState<string | null>(null);

  const handleAction = useCallback(
    async (kind: "approve" | "reject") => {
      if (busy) return;
      setBusy(kind);
      setErr(null);
      try {
        await jpost(`/api/v2/memory/drafts/${draft.id}/${kind}`, {});
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(null);
      }
    },
    [busy, draft.id, onChanged],
  );

  return (
    <article
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: 12,
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      {/* header — AI 头像 stack + 时间 */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center" }}>
          {draft.target_ais.slice(0, 3).map((a, i) => (
            <div
              key={a.id}
              style={{
                marginLeft: i === 0 ? 0 : -8,
                zIndex: 3 - i,
              }}
            >
              <MAIBadge
                name={a.glyph}
                glyph={a.glyph}
                gradient_from={a.gradient_from}
                gradient_to={a.gradient_to}
                size={26}
                ring="#fff"
              />
            </div>
          ))}
        </div>
        <span
          style={{
            fontSize: 12,
            color: "#3C3C43",
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {draft.target_ais.map((a) => a.name).join(" · ") || "未挂 AI"}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: "#8E8E93",
            flexShrink: 0,
          }}
        >
          {humanizeTime(draft.created_at)}
        </span>
      </header>

      {/* content — clamp 3 行, 满足 list 概览 */}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "#1C1C1E",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {draft.proposed_content}
      </p>

      {/* meta — source meeting + importance */}
      {draft.source_meeting_title || draft.importance > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 8,
            fontSize: 11.5,
            color: "#8E8E93",
            flexWrap: "wrap",
          }}
        >
          {draft.source_meeting_title ? (
            <>
              <MAIcon name="cal" size={11} color="#8E8E93" />
              <span>{draft.source_meeting_title}</span>
            </>
          ) : null}
          {draft.source_meeting_title && draft.importance > 0 ? (
            <span style={{ color: "#C7C7CC" }}>·</span>
          ) : null}
          {draft.importance > 0 ? (
            <span>
              重要度 {Math.round(draft.importance * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}

      {/* actions — 审入 / 驳回 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={() => handleAction("reject")}
          disabled={busy !== null}
          data-testid="draft-reject"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            border: "0.5px solid rgba(60,60,67,0.18)",
            background: "#fff",
            color: "#3C3C43",
            fontSize: 14,
            fontWeight: 500,
            cursor: busy ? "default" : "pointer",
            opacity: busy === "reject" ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {busy === "reject" ? "驳回中…" : "驳回"}
        </button>
        <button
          type="button"
          onClick={() => handleAction("approve")}
          disabled={busy !== null}
          data-testid="draft-approve"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            border: "none",
            background: "#5E5CE6",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy === "approve" ? 0.6 : 1,
            fontFamily: "inherit",
            boxShadow: "0 2px 6px rgba(94,92,230,0.30)",
          }}
        >
          {busy === "approve" ? "审入中…" : "审入"}
        </button>
      </div>

      {err ? (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11.5,
            color: "#FF3B30",
            lineHeight: 1.45,
          }}
        >
          {err}
        </p>
      ) : null}
    </article>
  );
}

// ============================================================================
// Sprint 3 Mobile Part 3 · 记忆库 tab — LibraryView
// ============================================================================

// 6 个固定 axis — 跟 backend memory_axis.AXES + SCHEMA §4.3 严格一致.
const FIXED_AXES = [
  "数据洞察",
  "产品策略",
  "UX 体验",
  "法规合规",
  "财务建模",
  "客户体验",
];

function LibraryView({
  items,
  axesWithCount,
  activeAxis,
  onAxisChange,
}: {
  items: V2MemoryLibraryItem[];
  axesWithCount: Record<string, number>;
  activeAxis: string | null;
  onAxisChange: (axis: string | null) => void;
}): ReactElement {
  return (
    <>
      {/* axis chip filter */}
      <div
        style={{
          padding: "4px 16px 8px",
          display: "flex",
          gap: 8,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
        data-testid="library-axis-chips"
      >
        <AxisChip
          label="全部"
          count={Object.values(axesWithCount).reduce((s, c) => s + c, 0)}
          active={activeAxis === null}
          onClick={() => onAxisChange(null)}
        />
        {FIXED_AXES.map((a) => (
          <AxisChip
            key={a}
            label={a}
            count={axesWithCount[a] ?? 0}
            active={activeAxis === a}
            onClick={() => onAxisChange(a)}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "32px 16px" }}>
          <MAEmpty
            icon="archive"
            title={activeAxis ? `${activeAxis} 还没有记忆` : "记忆库还空着"}
            body={
              activeAxis
                ? "试试切换到其他领域, 或先去待审 tab 把候选审入"
                : "AI 沉淀后会出现在这里, 后续会议会自动调用做上下文"
            }
          />
        </div>
      ) : (
        <div
          style={{
            padding: "0 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {items.map((m) => (
            <LibraryCard key={m.id} memory={m} />
          ))}
        </div>
      )}
    </>
  );
}

function AxisChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`axis-chip-${label}`}
      style={{
        flexShrink: 0,
        padding: "6px 12px",
        borderRadius: 999,
        border: active
          ? "0.5px solid #5E5CE6"
          : "0.5px solid rgba(60,60,67,0.18)",
        background: active ? "rgba(94,92,230,0.10)" : "#fff",
        color: active ? "#5E5CE6" : "#3C3C43",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: active ? "#5E5CE6" : "#8E8E93",
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function LibraryCard({
  memory,
}: {
  memory: V2MemoryLibraryItem;
}): ReactElement {
  return (
    <article
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "0.5px solid rgba(60,60,67,0.10)",
        padding: 12,
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {memory.primary_ai ? (
          <MAIBadge
            name={memory.primary_ai.glyph}
            glyph={memory.primary_ai.glyph}
            gradient_from={memory.primary_ai.gradient_from}
            gradient_to={memory.primary_ai.gradient_to}
            size={26}
            ring="#fff"
          />
        ) : (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "rgba(60,60,67,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8E8E93",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ?
          </div>
        )}
        <span
          style={{
            fontSize: 12.5,
            color: "#3C3C43",
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {memory.primary_ai?.name || "(未挂 AI)"}
        </span>
        {memory.axis_tag ? (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "#5E5CE6",
              padding: "2px 6px",
              borderRadius: 6,
              background: "rgba(94,92,230,0.10)",
              flexShrink: 0,
            }}
          >
            {memory.axis_tag}
          </span>
        ) : null}
      </header>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "#1C1C1E",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {memory.content}
      </p>

      {memory.source_meeting_title || memory.importance > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 8,
            fontSize: 11.5,
            color: "#8E8E93",
            flexWrap: "wrap",
          }}
        >
          {memory.source_meeting_title ? (
            <>
              <MAIcon name="cal" size={11} color="#8E8E93" />
              {memory.source_meeting_id ? (
                <Link
                  href={`/m/meetings/${memory.source_meeting_id}`}
                  style={{
                    color: "#007AFF",
                    textDecoration: "none",
                    fontSize: 11.5,
                  }}
                >
                  {memory.source_meeting_title}
                </Link>
              ) : (
                <span>{memory.source_meeting_title}</span>
              )}
            </>
          ) : null}
          {memory.source_meeting_title && memory.importance > 0 ? (
            <span style={{ color: "#C7C7CC" }}>·</span>
          ) : null}
          {memory.importance > 0 ? (
            <span>
              重要度 {Math.round(memory.importance * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ============================================================================
// utils
// ============================================================================

function humanizeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
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
