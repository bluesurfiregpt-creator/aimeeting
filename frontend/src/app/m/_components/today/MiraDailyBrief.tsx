"use client";

/**
 * Saga · mobile-app-r4-A · today 页 顶部 Mira 早间简报 hero.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-today.jsx:86-162
 * (MiraDailyBrief)
 *
 * 蓝紫渐变 hero 卡 + 双色径向光晕 + 3 颗散落小星点 + Mira 头像 (host concentric ring) +
 * 个性化 brief + 2 枚行动 chip.
 *
 * 注: 设计稿用 MAIBadge(id="MIRA") 渲染 Mira head, 但 Mira 是 host (concentric ring),
 * 跟 domain AI (rounded square + glyph) 不同 — 这里用 MRHostAvatar (同心圆).
 */

import type { ReactElement } from "react";

import { MRHostAvatar } from "@/components/mobile/shared/avatars";
import Icon, { type MRIconName } from "@/components/mobile/shared/Icon";
import { Sparkle } from "@/components/mobile/shared/MAGlowBanner";

type Props = {
  userName: string;
  greetingTime: string; // "上午" 等
  todayBrief: string;
  meetingCount: number;
};

export default function MiraDailyBrief({
  userName,
  greetingTime,
  todayBrief,
  meetingCount,
}: Props): ReactElement {
  return (
    <div
      style={{
        borderRadius: 18,
        background:
          "linear-gradient(135deg, #5E5CE6 0%, #7A5AF0 45%, #AF52DE 100%)",
        position: "relative",
        overflow: "hidden",
        padding: "16px 16px 18px",
        boxShadow:
          "0 8px 28px rgba(94,92,230,0.32), 0 0 0 0.5px rgba(255,255,255,0.10)",
      }}
    >
      {/* cyan spark top-right */}
      <div
        style={{
          position: "absolute",
          top: -50,
          right: -40,
          width: 200,
          height: 200,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(100,210,255,0.38) 0%, rgba(100,210,255,0) 65%)",
          pointerEvents: "none",
        }}
      />
      {/* pink spark bottom-left */}
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -40,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,100,130,0.30) 0%, rgba(255,100,130,0) 70%)",
          pointerEvents: "none",
        }}
      />
      {/* sparkles */}
      <Sparkle top={18} right={56} size={12} opacity={0.85} />
      <Sparkle top={48} right={30} size={7} opacity={0.55} />
      <Sparkle bottom={60} right={72} size={5} opacity={0.4} />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <MRHostAvatar size={32} ring="rgba(255,255,255,0.30)" />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: 0.1,
            }}
          >
            Mira · 早间简报
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.72)",
              marginTop: 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon
              name="sun"
              size={10}
              color="rgba(255,255,255,0.72)"
              strokeWidth={1.6}
            />
            {greetingTime}好,{userName} · 你今日 {meetingCount} 场会
          </div>
        </div>
        <button
          type="button"
          style={{
            background: "rgba(255,255,255,0.18)",
            border: "none",
            borderRadius: 8,
            padding: "4px 9px",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          查看
        </button>
      </div>

      <div
        style={{
          position: "relative",
          marginTop: 12,
          fontSize: 14,
          color: "rgba(255,255,255,0.92)",
          lineHeight: 1.55,
        }}
      >
        {todayBrief}
      </div>

      {/* Mira's suggested action chips */}
      <div
        style={{
          position: "relative",
          marginTop: 12,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <MiraChip icon="bolt" label="优先拍板 · Q3 协作功能" tone="warn" />
        <MiraChip icon="doc" label="预读 Sage 评审稿" tone="info" />
      </div>
    </div>
  );
}

const TONE_PRESETS: Record<
  "warn" | "info",
  { bg: string; fg: string; border: string }
> = {
  warn: {
    bg: "rgba(255,255,255,0.18)",
    fg: "#FFE89A",
    border: "rgba(255,232,154,0.35)",
  },
  info: {
    bg: "rgba(255,255,255,0.18)",
    fg: "#B6F0FF",
    border: "rgba(182,240,255,0.35)",
  },
};

function MiraChip({
  icon,
  label,
  tone,
}: {
  icon: MRIconName;
  label: string;
  tone: "warn" | "info";
}): ReactElement {
  const c = TONE_PRESETS[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 9px 4px 7px",
        borderRadius: 8,
        background: c.bg,
        color: c.fg,
        fontSize: 11.5,
        fontWeight: 600,
        boxShadow: `inset 0 0 0 0.5px ${c.border}`,
      }}
    >
      <Icon name={icon} size={11} color={c.fg} strokeWidth={2.2} />
      {label}
    </div>
  );
}
