"use client";

/**
 * v1.4.0 · Saga M3 · /m/meetings v2 全面升级.
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx:13-95
 * (MeetingsView) + /tmp/aimeeting-design-research/design-shots/meetings.png.
 *
 * 改动 (vs Saga K):
 *   - top bar 加 subtitle "本周 N 场 · 进行中 M"
 *   - 加 MiraPulseNotice (本周脉络 inline notice, 调 /api/v2/meetings/week-pulse)
 *   - 旧蓝虚线 + 按钮 → 紫渐变 56px 大 CTA (sparkle + "新建会议 · 描述需求 · Mira 配 AI 阵容")
 *   - segmented [进行中 / 即将开始 / 已结束] (1:1 设计)
 *   - 旧 MeetingRow → MeetingFullCard (avatar stack + AI badges + 状态变体 + 决策计数)
 *   - 数据源 旧 /api/m/meetings → 新 /api/v2/meetings (mock 写死)
 *
 * 保留 (Saga D-K 老路径不动):
 *   - 旧 /api/m/* 跟其他 page 共用, 不破坏
 *   - PageHeader (已有 subtitle 支持) 复用
 *   - 链接 href=/m/meetings/[id] 不变
 *
 * 风格守门: 严格按 docs/design/system/DESIGN_SYSTEM.md § 0.3.2 (Mobile MR_COLORS
 * 浅 iOS 单 theme), 无 dark token / 无 violet-2/3 数字 token.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import Link from "next/link";
import PageHeader from "@/components/mobile/PageHeader";
import {
  MASegmented,
  MAIcon,
  MAEmpty,
  MiraPulseNotice,
  MeetingFullCard,
  Sparkle,
  type V2MeetingItem,
  type V2MeetingsListResponse,
  type V2WeekPulseResponse,
} from "@/components/mobile/v2";

type Tab = "live" | "upcoming" | "finished";

// 简单 fetch — v2 mock endpoint 不带 auth, 不用 mApi.
async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

// inject pulse 动画 keyframe (跟 MAPill 配套).
const PULSE_KEYFRAME = `
@keyframes v2Pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}
`;

function injectKeyframes(): void {
  if (typeof window === "undefined") return;
  const STYLE_ID = "v2-pulse-keyframes";
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = PULSE_KEYFRAME;
  document.head.appendChild(s);
}

export default function MobileMeetingsPage() {
  const [tab, setTab] = useState<Tab>("live");
  const [pulse, setPulse] = useState<V2WeekPulseResponse | null>(null);
  const [meetings, setMeetings] = useState<V2MeetingItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    injectKeyframes();
  }, []);

  // 拉 week-pulse + meetings 并发
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      jget<V2WeekPulseResponse>("/api/v2/meetings/week-pulse"),
      jget<V2MeetingsListResponse>("/api/v2/meetings"),
    ])
      .then(([p, m]) => {
        if (!alive) return;
        setPulse(p);
        setMeetings(m.items);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    if (!meetings) return { live: [], upcoming: [], finished: [] };
    return {
      live: meetings.filter((m) => m.status === "live"),
      upcoming: meetings.filter((m) => m.status === "upcoming"),
      finished: meetings.filter(
        (m) => m.status === "finished" || m.status === "processed",
      ),
    };
  }, [meetings]);

  const current = groups[tab] || [];
  // 本周计数走 week-pulse (语义: 本周相关会议), 而非全部 mock list (含上周历史).
  const weekCount = pulse?.meeting_count ?? meetings?.length ?? 0;
  const liveCount = groups.live.length;

  return (
    <div style={{ paddingBottom: 100 }}>
      <PageHeader
        title="会议"
        subtitle={
          weekCount > 0
            ? `本周 ${weekCount} 场 · 进行中 ${liveCount}`
            : "本周 0 场"
        }
      />

      {/* segmented (16px 左右 padding, 跟设计稿) */}
      <div style={{ padding: "0 16px" }}>
        <MASegmented
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          tabs={[
            { id: "live", label: "进行中", count: groups.live.length },
            { id: "upcoming", label: "即将开始", count: groups.upcoming.length },
            { id: "finished", label: "已结束", count: groups.finished.length },
          ]}
        />
      </div>

      {/* Mira 本周脉络 inline notice */}
      {pulse ? (
        <div style={{ padding: "14px 16px 0" }}>
          <MiraPulseNotice data={pulse} />
        </div>
      ) : null}

      {/* 紫渐变 新建会议 大 CTA (56px) */}
      <div style={{ padding: "14px 16px 0" }}>
        <Link
          href="/m/meetings/new"
          style={{
            width: "100%",
            height: 56,
            borderRadius: 14,
            background:
              "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 50%, #AF52DE 100%)",
            color: "#fff",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            boxShadow:
              "0 8px 28px rgba(94,92,230,0.32), inset 0 0 0 0.5px rgba(255,255,255,0.10)",
            position: "relative",
            overflow: "hidden",
            fontFamily: "inherit",
          }}
          data-testid="mobile-new-meeting-link"
        >
          {/* sparkles */}
          <Sparkle top={8} right={42} size={10} opacity={0.85} />
          <Sparkle top={28} right={20} size={6} opacity={0.55} />
          <Sparkle top={14} left={48} size={6} opacity={0.5} />
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: "rgba(255,255,255,0.20)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.22)",
              flexShrink: 0,
            }}
          >
            <MAIcon name="plus" size={18} color="#fff" strokeWidth={2.4} />
          </span>
          <div style={{ textAlign: "left", lineHeight: 1.2 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>新建会议</div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(255,255,255,0.78)",
                marginTop: 1,
                letterSpacing: 0.2,
              }}
            >
              描述需求 · Mira 配 AI 阵容
            </div>
          </div>
        </Link>
      </div>

      {/* 列表 */}
      <div
        style={{
          padding: "14px 16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {loading ? (
          <SkeletonList />
        ) : error ? (
          <ErrorPanel error={error} />
        ) : current.length === 0 ? (
          <MAEmpty
            icon="cal"
            title={emptyTitle(tab)}
            body={emptyBody(tab)}
          />
        ) : (
          current.map((m) => (
            <MeetingFullCard
              key={m.id}
              meeting={m}
              href={`/m/meetings/${m.id}`}
            />
          ))
        )}
      </div>
    </div>
  );
}

function emptyTitle(t: Tab): string {
  return t === "live"
    ? "当前没有进行中的会议"
    : t === "upcoming"
    ? "今天没有更多会议"
    : "暂无已结束的会议";
}

function emptyBody(t: Tab): string | undefined {
  if (t === "live") return "从「即将开始」加入下一场, 或新建一场";
  if (t === "upcoming") return "可以休息一下 ☕";
  return undefined;
}

function SkeletonList(): ReactElement {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 112,
            borderRadius: 14,
            background: "rgba(60,60,67,0.04)",
            animation: "v2Pulse 1.6s ease-in-out infinite",
          }}
        />
      ))}
    </>
  );
}

function ErrorPanel({ error }: { error: string }): ReactElement {
  return (
    <div
      style={{
        background: "#fff",
        border: "0.5px solid rgba(60,60,67,0.10)",
        borderRadius: 14,
        padding: "32px 24px",
        textAlign: "center",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      <p style={{ fontSize: 16, color: "#1C1C1E", margin: 0 }}>未能加载</p>
      <p
        style={{
          fontSize: 12.5,
          color: "#8E8E93",
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        {error}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 16,
          height: 36,
          padding: "0 18px",
          borderRadius: 9,
          background: "#fff",
          border: "0.5px solid rgba(60,60,67,0.18)",
          color: "#1C1C1E",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        重试
      </button>
    </div>
  );
}

