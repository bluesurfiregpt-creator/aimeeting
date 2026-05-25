"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · inline HostMessage 卡 (3 级 drift-soft / drift / drift-strong).
 *
 * 设计源 1:1: meeting-room.jsx:701-902 (HostMessage).
 *
 * R1 mitigation — 6 类 WS event 1:1 映射到 inline 卡:
 *   - off_topic (suspected/confirmed)   → drift-soft
 *   - off_topic (severe → 实际走 modal, banner 兜底)  → drift-strong
 *   - off_topic (其他)                  → drift
 *   - time_warning                      → timer (橙)
 *   - stuck                             → drift (橙) + body 含 stuck 提示
 *   - dissent_detected                  → drift (改 title 含 parties)
 *   - decision_summary                  → route (橙)
 *   - advance_suggested                 → route (绿色变体) + 一键推进按钮
 *
 * 行为保留: autoSummonSec 倒计时 → 自动召唤 (跟旧版一致).
 * 移除: sticky 定位. 改 inline (TD1 — 父级 page 把它放进 transcript feed 中).
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import {
  MOCK_HOST,
  MRHostAvatar,
  gradientForAgentColor,
} from "./meeting-room/avatars";
import MRIcon, { type MRIconName } from "./meeting-room/MRIcon";
import { MR_COLORS } from "./meeting-room/styles";

export type BannerKind =
  | "off_topic"
  | "time_warning"
  | "stuck"
  | "dissent"
  | "decision_summary"
  | "advance_suggested";

export type BannerData = {
  kind: BannerKind;
  /** drift-soft / drift / drift-strong / timer / route — 父级从 kind+severity 决定 */
  tone: "drift-soft" | "drift" | "drift-strong" | "timer" | "route";
  title: string;
  body?: string;
  /** ts 显示 (e.g. "23:14"), 父级用 mm:ss 实时算或 null */
  t?: string;
  /** drift-strong 强提醒倒计时 (议程剩余 mm:ss) */
  countdown?: string | null;
  /** 召唤目标 agent. moderator 类事件 = moderator id. dissent = suggested expert. */
  agentId: string;
  agentName: string;
  /** moderator agent_color (语义色名, 用于头像) */
  agentColor?: string | null;
  /** 召唤 LLM 时传的 prompt — backend agenda_monitor 已生成 */
  invokeQuery?: string;
  /** 倒计时秒数 (stuck / decision_summary 有). null = 无倒计时 */
  autoSummonSec?: number | null;
  /** advance_suggested 专用: 推进议程的目标 idx, controller 一键确认 */
  advanceTargetIdx?: number | null;
  /** advance_suggested 专用: 当前 user 是否 controller */
  canAdvance?: boolean;
};

type Props = {
  data: BannerData;
  onDismiss: () => void;
  onSummonAgent: (agentId: string, query?: string) => void;
  /** advance_suggested 专用 */
  onAdvanceAgenda?: () => void;
};

const TONE_META: Record<
  Exclude<BannerData["tone"], "drift-soft" | "drift-strong">,
  { icon: MRIconName; color: string; label: string }
> = {
  drift: { icon: "compass", color: MR_COLORS.systemOrange, label: "话题偏移 · 中度提醒" },
  route: { icon: "route", color: MR_COLORS.systemOrange, label: "问题拆解" },
  timer: { icon: "clock", color: MR_COLORS.systemOrange, label: "时间提醒" },
};

export default function AgendaEventBanner({
  data,
  onDismiss,
  onSummonAgent,
  onAdvanceAgenda,
}: Props): ReactElement {
  const [remaining, setRemaining] = useState<number | null>(
    data.autoSummonSec ?? null,
  );
  const summonRef = useRef(onSummonAgent);
  summonRef.current = onSummonAgent;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // 倒计时 — 含 autoSummonSec 时 250ms tick, 否则 60s 自动消失
  useEffect(() => {
    if (data.autoSummonSec === null || data.autoSummonSec === undefined) {
      const t = setTimeout(() => dismissRef.current(), 60000);
      return () => clearTimeout(t);
    }
    setRemaining(data.autoSummonSec);
    const startedAt = Date.now();
    const totalMs = data.autoSummonSec * 1000;
    const it = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, (totalMs - elapsed) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(it);
        summonRef.current(data.agentId, data.invokeQuery);
        dismissRef.current();
      }
    }, 250);
    return () => clearInterval(it);
  }, [data.autoSummonSec, data.agentId, data.invokeQuery]);

  if (data.tone === "drift-soft") {
    return (
      <DriftSoft
        body={data.body || data.title}
        t={data.t}
        onDismiss={onDismiss}
      />
    );
  }
  if (data.tone === "drift-strong") {
    return (
      <DriftStrong
        data={data}
        remaining={remaining}
        onSummonAgent={onSummonAgent}
        onDismiss={onDismiss}
      />
    );
  }
  return (
    <DefaultLevel
      data={data}
      remaining={remaining}
      onSummonAgent={onSummonAgent}
      onAdvanceAgenda={onAdvanceAgenda}
      onDismiss={onDismiss}
    />
  );
}

// ─────── Level 1: drift-soft ───────

function DriftSoft({
  body,
  t,
  onDismiss,
}: {
  body: string;
  t?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{ padding: "4px 16px" }}
      data-testid="mobile-agenda-banner"
      data-banner-kind="drift-soft"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: MR_COLORS.hostBg,
          borderLeft: "2px solid #FFB340",
          borderRadius: "0 8px 8px 0",
        }}
      >
        <MRHostAvatar size={16} />
        <MRIcon name="compass" size={12} color="#B8860B" />
        <span
          style={{
            fontSize: 12,
            color: "#8B6914",
            flex: 1,
            lineHeight: 1.4,
          }}
        >
          <span style={{ fontWeight: 600 }}>{MOCK_HOST.name}</span> · {body}
        </span>
        {t ? (
          <span style={{ fontSize: 10, color: "#B8860B" }}>{t}</span>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "#B8860B",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─────── Level 3: drift-strong (红色 + 倒计时 + urgent pulse) ───────

function DriftStrong({
  data,
  remaining,
  onSummonAgent,
  onDismiss,
}: {
  data: BannerData;
  remaining: number | null;
  onSummonAgent: (agentId: string, query?: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{ padding: "10px 16px" }}
      data-testid="mobile-agenda-banner"
      data-banner-kind="drift-strong"
    >
      <div
        style={{
          background: `linear-gradient(135deg, rgba(255,59,48,0.08), rgba(255,69,58,0.14))`,
          borderRadius: 14,
          border: `1px solid ${MR_COLORS.urgentBorder}`,
          padding: "12px 14px 14px",
          animation: "mr-urgentPulse 2.2s ease-in-out infinite",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ position: "relative" }}>
            <MRHostAvatar size={28} />
            <span
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: MR_COLORS.systemRed,
                border: "1.5px solid #fff",
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: MR_COLORS.textPrimary,
                }}
              >
                {MOCK_HOST.name}
              </span>
              <span
                style={{ fontSize: 11, color: MR_COLORS.textTertiary }}
              >
                主持人
              </span>
              {data.t ? (
                <span
                  style={{
                    fontSize: 11,
                    color: MR_COLORS.textTertiary,
                    marginLeft: "auto",
                  }}
                >
                  {data.t}
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 2,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: MR_COLORS.systemRed,
                  animation: "mr-livePulse 1.2s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: MR_COLORS.systemRed,
                  letterSpacing: 0.4,
                }}
              >
                强提醒 · 需立即处理
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭"
            style={{
              background: "none",
              border: "none",
              color: MR_COLORS.textTertiary,
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {data.countdown ? (
            <div
              style={{
                flexShrink: 0,
                width: 64,
                background: MR_COLORS.bgWhite,
                border: `1px solid ${MR_COLORS.urgentBorder}`,
                borderRadius: 10,
                padding: "6px 0",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: MR_COLORS.textTertiary,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                }}
              >
                议程剩余
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: MR_COLORS.systemRed,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: -0.5,
                  lineHeight: 1.1,
                  marginTop: 1,
                }}
              >
                {data.countdown}
              </div>
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: MR_COLORS.textPrimary,
              }}
            >
              {data.title}
            </div>
            {data.body ? (
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  color: MR_COLORS.textSecondary,
                  marginTop: 2,
                }}
              >
                {data.body}
              </div>
            ) : null}
          </div>
        </div>

        {remaining !== null && remaining > 0 ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: MR_COLORS.textTertiary,
              fontVariantNumeric: "tabular-nums",
              textAlign: "center",
            }}
          >
            {Math.ceil(remaining)} 秒后自动召唤 {data.agentName}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <button
            type="button"
            onClick={() => {
              onSummonAgent(data.agentId, data.invokeQuery);
              onDismiss();
            }}
            data-testid="mobile-banner-cta"
            style={{
              height: 38,
              padding: "0 14px",
              borderRadius: 10,
              border: "none",
              background: MR_COLORS.systemRed,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(255,59,48,0.30)",
            }}
          >
            立即召唤 {data.agentName}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────── Level 2: drift / route / timer ───────

function DefaultLevel({
  data,
  remaining,
  onSummonAgent,
  onAdvanceAgenda,
  onDismiss,
}: {
  data: BannerData;
  remaining: number | null;
  onSummonAgent: (agentId: string, query?: string) => void;
  onAdvanceAgenda?: () => void;
  onDismiss: () => void;
}) {
  const tone = data.tone as keyof typeof TONE_META;
  const meta = TONE_META[tone];

  const isAdvance = data.kind === "advance_suggested";
  const ctaLabel = isAdvance
    ? "立刻推进 →"
    : `召唤 ${data.agentName}`;
  const ctaHidden = isAdvance && data.canAdvance === false;
  const handleCta = () => {
    if (isAdvance && onAdvanceAgenda) {
      onAdvanceAgenda();
      onDismiss();
    } else {
      onSummonAgent(data.agentId, data.invokeQuery);
      onDismiss();
    }
  };

  return (
    <div
      style={{ padding: "10px 16px" }}
      data-testid="mobile-agenda-banner"
      data-banner-kind={data.kind}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.10))",
          borderRadius: 14,
          border: `0.5px solid ${MR_COLORS.hostBorder}`,
          padding: "11px 14px 13px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <MRHostAvatar size={26} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: MR_COLORS.textPrimary,
                }}
              >
                {MOCK_HOST.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: MR_COLORS.textTertiary,
                }}
              >
                主持人
              </span>
              {data.t ? (
                <span
                  style={{
                    fontSize: 11,
                    color: MR_COLORS.textTertiary,
                    marginLeft: "auto",
                  }}
                >
                  {data.t}
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 2,
              }}
            >
              <MRIcon name={meta.icon} size={11} color={meta.color} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: meta.color,
                  letterSpacing: 0.3,
                }}
              >
                {meta.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭"
            style={{
              background: "none",
              border: "none",
              color: MR_COLORS.textTertiary,
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 8 }}>
          {data.title ? (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: MR_COLORS.textPrimary,
                marginBottom: 3,
              }}
            >
              {data.title}
            </div>
          ) : null}
          {data.body ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: MR_COLORS.textSecondary,
              }}
            >
              {data.body}
            </div>
          ) : null}
        </div>

        {remaining !== null && remaining > 0 ? (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: MR_COLORS.textTertiary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.ceil(remaining)} 秒后自动召唤 {data.agentName}
          </div>
        ) : null}

        {!ctaHidden ? (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={handleCta}
              data-testid="mobile-banner-cta"
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                border: "none",
                background: MR_COLORS.systemOrange,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {ctaLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Re-export for backwards compat — agent color helper for parent to use
export { gradientForAgentColor };
