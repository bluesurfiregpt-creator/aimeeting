"use client";

/**
 * R5.D Web 会议室 — transcript 消息渲染器.
 *
 * 4 种 kind:
 *  - human  → MRHumanMessage  (含 @ 唤醒 / 向主持人提问 / off-topic 标)
 *  - ai     → MRAIMessage     (左侧渐变描边 + data grid + note + actions)
 *  - host   → MRHostMessage   (5 tone: agenda / drift-soft / drift / drift-strong / route)
 *  - round  → MRRoundMessage  (AI 圆桌 — Mira 综合 + N 个 expert accordion)
 *
 * 设计源: `meeting-room-web-parts.jsx:72-615`.
 */

import { useState } from "react";
import {
  type MRHumanMessage,
  type MRAIMessage,
  type MRHostMessage,
  type MRRoundMessage,
  type MRRoundExpert,
  MR_HUMANS_IN_MEETING,
  MR_AGENTS_IN_MEETING,
  MR_HOST,
  MR_AGENDA,
} from "./data";
import {
  MRHumanAvatar,
  MRAIAvatar,
  MRHostAvatar,
  MRIcon,
  MRWaveform,
  MRDots,
  renderMRMentions,
} from "./atoms";
import { MR_TOKENS } from "./tokens";

// ════════════════════════════════════════════
// HUMAN MESSAGE
// ════════════════════════════════════════════
export function MRHumanMessageView({ m }: { m: MRHumanMessage }) {
  const p = MR_HUMANS_IN_MEETING[m.who];
  if (!p) return null;
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 28px" }}>
      <MRHumanAvatar id={m.who} size={36} />
      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{p.name}</span>
          <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>{p.role}</span>
          <span style={{ fontSize: 12, color: MR_TOKENS.fgQuaternary }}>· {m.t}</span>
          {p.speaking && <MRWaveform active />}
          {m.summon && MR_AGENTS_IN_MEETING[m.summon] && (
            <span
              style={{
                marginLeft: 4,
                fontSize: 11,
                color: "#5E5CE6",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <MRIcon name="sparkle" size={11} color="#5E5CE6" />
              唤醒 {MR_AGENTS_IN_MEETING[m.summon].name}
            </span>
          )}
          {m.askHost && (
            <span
              style={{
                marginLeft: 4,
                fontSize: 11,
                color: "#FF9F0A",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <MRIcon name="compass" size={11} color="#FF9F0A" />
              向主持人提问
            </span>
          )}
          {m.offTopic && (
            <span
              style={{
                marginLeft: 4,
                fontSize: 11,
                color: "#FF453A",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <MRIcon name="compass" size={11} color="#FF453A" />
              偏离当前议程
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: MR_TOKENS.fgPrimary }}>
          {renderMRMentions(m.text)}
          {m.partial && <MRDots />}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// AI MESSAGE
// ════════════════════════════════════════════
export function MRAIMessageView({ m }: { m: MRAIMessage }) {
  const a = MR_AGENTS_IN_MEETING[m.who];
  if (!a) return null;
  return (
    <div style={{ padding: "8px 28px" }}>
      <div
        style={{
          background: MR_TOKENS.bgSurface,
          borderRadius: 12,
          border: MR_TOKENS.borderHair2Strong,
          boxShadow: MR_TOKENS.shadowSubtle,
          maxWidth: 720,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: `linear-gradient(180deg, ${a.grad[0]}, ${a.grad[1]})`,
          }}
        />
        <div style={{ padding: "14px 18px 14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MRAIAvatar id={m.who} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{a.name}</span>
                <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>{a.roleShort}</span>
                <span style={{ fontSize: 12, color: MR_TOKENS.fgQuaternary }}>· {m.t}</span>
              </div>
              {m.via && (
                <div
                  style={{
                    fontSize: 11,
                    color: MR_TOKENS.fgTertiary,
                    marginTop: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {m.via.kind === "summon" && (
                    <>
                      <MRIcon name="sparkle" size={10} color="#5E5CE6" />
                      由 {MR_HUMANS_IN_MEETING[m.via.by]?.name ?? m.via.by} 唤醒
                    </>
                  )}
                  {m.via.kind === "host" && (
                    <>
                      <MRIcon name="route" size={11} color="#FF9F0A" />
                      由主持人转交
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 14,
              lineHeight: 1.55,
              color: MR_TOKENS.fgPrimary,
            }}
          >
            {m.body}
          </div>

          {m.data && (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gridTemplateColumns: `repeat(${m.data.length}, 1fr)`,
                gap: 8,
              }}
            >
              {m.data.map((row, i) => (
                <div
                  key={i}
                  style={{
                    background: MR_TOKENS.bgSubtle,
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: MR_TOKENS.fgTertiary,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      marginTop: 2,
                      fontVariantNumeric: "tabular-nums",
                      color: MR_TOKENS.fgPrimary,
                    }}
                  >
                    {row.v}
                  </div>
                </div>
              ))}
            </div>
          )}

          {m.note && (
            <div
              style={{
                marginTop: 10,
                fontSize: 13.5,
                lineHeight: 1.5,
                color: MR_TOKENS.fgSecondary,
                padding: "8px 12px",
                borderRadius: 8,
                background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
                border: `0.5px solid ${a.grad[0]}33`,
              }}
            >
              {m.note}
            </div>
          )}

          {m.actions && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {m.actions.map((label, i) => (
                <button
                  key={i}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    height: 32,
                    border: i === 0 ? "none" : "0.5px solid rgba(60,60,67,0.16)",
                    background: i === 0 ? "#007AFF" : MR_TOKENS.bgSurface,
                    color: i === 0 ? "#fff" : "#007AFF",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// HOST MESSAGE — 5 tones
// ════════════════════════════════════════════
export function MRHostMessageView({ m }: { m: MRHostMessage }) {
  // (1) chapter divider for agenda transitions
  if (m.tone === "agenda") {
    const match = (m.body || "").match(/议程\s*(\d+)\s*[:：](.+?)$/);
    const newNum = match ? parseInt(match[1]) : null;
    const newTitle = match ? match[2].trim() : (m.title ?? "");
    const agenda = newNum ? MR_AGENDA.find((a) => a.id === newNum) : undefined;
    return (
      <div style={{ padding: "28px 28px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 720 }}>
          <div style={{ flex: 1, height: 0.5, background: MR_TOKENS.fgQuaternary }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: MR_TOKENS.fgTertiary,
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            议程 {newNum || "—"} / {MR_AGENDA.length}
          </span>
          <div style={{ flex: 1, height: 0.5, background: MR_TOKENS.fgQuaternary }} />
        </div>
        <div
          style={{
            textAlign: "center",
            fontSize: 19,
            fontWeight: 700,
            color: MR_TOKENS.fgPrimary,
            marginTop: 9,
            letterSpacing: -0.2,
            maxWidth: 720,
          }}
        >
          {newTitle}
        </div>
        <div
          style={{
            textAlign: "center",
            fontSize: 12.5,
            color: MR_TOKENS.fgTertiary,
            marginTop: 5,
            maxWidth: 720,
            display: "flex",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {agenda && (
            <>
              <span>{agenda.minutes} 分钟</span>
              <span>·</span>
            </>
          )}
          {newNum && newNum > 1 && (
            <>
              <span style={{ color: "#34C759", fontWeight: 600 }}>
                议程 {newNum - 1} 完成 ✓
              </span>
              <span>·</span>
            </>
          )}
          <span>{m.t}</span>
        </div>
      </div>
    );
  }

  // (2) soft drift
  if (m.tone === "drift-soft") {
    return (
      <div style={{ padding: "6px 28px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 12px",
            maxWidth: 720,
            background: "rgba(255,159,10,0.07)",
            borderLeft: "2px solid #FFB340",
            borderRadius: "0 8px 8px 0",
          }}
        >
          <MRHostAvatar size={18} />
          <MRIcon name="compass" size={13} color="#B8860B" />
          <span style={{ fontSize: 13, color: "#8B6914", flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Mira</span> · {m.body}
          </span>
          <span style={{ fontSize: 11, color: "#B8860B" }}>{m.t}</span>
        </div>
      </div>
    );
  }

  // (3) strong drift — urgent pulse + countdown
  if (m.tone === "drift-strong") {
    return (
      <div style={{ padding: "10px 28px" }}>
        <div
          style={{
            background:
              "linear-gradient(135deg, rgba(255,59,48,0.08), rgba(255,69,58,0.13))",
            borderRadius: 12,
            border: "1px solid rgba(255,59,48,0.40)",
            padding: "14px 18px",
            maxWidth: 720,
            animation: "mrUrgentPulse 2.2s ease-in-out infinite",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <MRHostAvatar size={32} />
              <span
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "#FF3B30",
                  border: `1.5px solid ${MR_TOKENS.bgSurface}`,
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{MR_HOST.name}</span>
                <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>主持人</span>
                <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary, marginLeft: "auto" }}>
                  {m.t}
                </span>
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
                    background: "#FF3B30",
                    animation: "mrLivePulse 1.2s ease-in-out infinite",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#FF3B30",
                    letterSpacing: 0.4,
                  }}
                >
                  强提醒 · 需立即处理
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            {m.countdown && (
              <div
                style={{
                  flexShrink: 0,
                  width: 90,
                  background: MR_TOKENS.bgSurface,
                  border: "1px solid rgba(255,59,48,0.30)",
                  borderRadius: 10,
                  padding: "8px 0",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: MR_TOKENS.fgTertiary,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                  }}
                >
                  议程剩余
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#FF3B30",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: -0.5,
                    lineHeight: 1.1,
                    marginTop: 2,
                  }}
                >
                  {m.countdown}
                </div>
              </div>
            )}
            <div style={{ flex: 1 }}>
              {m.title && (
                <div style={{ fontSize: 15, fontWeight: 700, color: MR_TOKENS.fgPrimary }}>
                  {m.title}
                </div>
              )}
              {m.body && (
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: MR_TOKENS.fgSecondary,
                    marginTop: 3,
                  }}
                >
                  {m.body}
                </div>
              )}
            </div>
          </div>
          {m.actions && (
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              {m.actions.map((a, i) => (
                <button
                  key={i}
                  style={{
                    height: a.urgent ? 38 : 32,
                    padding: "0 16px",
                    borderRadius: 10,
                    border: a.primary ? "none" : "0.5px solid rgba(60,60,67,0.16)",
                    background: a.primary ? (a.urgent ? "#FF3B30" : "#FF9F0A") : MR_TOKENS.bgSurface,
                    color: a.primary ? "#fff" : MR_TOKENS.fgPrimary,
                    fontSize: a.urgent ? 14 : 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    boxShadow: a.urgent ? "0 2px 6px rgba(255,59,48,0.30)" : "none",
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // (4) drift (mid) / route / timer — amber soft card
  const toneMeta: Record<
    string,
    { icon: "check" | "compass" | "route" | "clock"; color: string; label: string }
  > = {
    drift: { icon: "compass", color: "#FF9F0A", label: "话题偏移 · 中度提醒" },
    route: { icon: "route", color: "#FF9F0A", label: "问题拆解" },
    timer: { icon: "clock", color: "#FF9F0A", label: "时间提醒" },
  };
  const meta = toneMeta[m.tone] ?? toneMeta.route;

  return (
    <div style={{ padding: "10px 28px" }}>
      <div
        style={{
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.09))",
          borderRadius: 12,
          border: "0.5px solid rgba(255,159,10,0.28)",
          padding: "14px 18px",
          maxWidth: 720,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MRHostAvatar size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{MR_HOST.name}</span>
              <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>主持人</span>
              <span
                style={{ fontSize: 12, color: MR_TOKENS.fgTertiary, marginLeft: "auto" }}
              >
                {m.t}
              </span>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 2,
              }}
            >
              <MRIcon name={meta.icon} size={12} color={meta.color} />
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
        </div>
        <div style={{ marginTop: 10 }}>
          {m.title && (
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: MR_TOKENS.fgPrimary,
                marginBottom: 4,
              }}
            >
              {m.title}
            </div>
          )}
          {m.body && (
            <div style={{ fontSize: 14, lineHeight: 1.55, color: MR_TOKENS.fgSecondary }}>
              {m.body}
            </div>
          )}
          {m.items && (
            <div style={{ marginTop: 6 }}>
              {m.items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "8px 0",
                    borderTop: i === 0 ? "none" : `0.5px solid ${MR_TOKENS.divider}`,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: it.done ? "#34C759" : MR_TOKENS.bgSurface,
                      border: it.done ? "none" : "1.5px solid #FF9F0A",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {it.done && <MRIcon name="check" size={12} color="#fff" />}
                    {it.loading && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "#FF9F0A",
                          animation: "mrLivePulse 1.2s ease-in-out infinite",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: MR_TOKENS.fgPrimary,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {it.label}
                      {it.loading && <MRDots />}
                    </div>
                    {it.detail && (
                      <div
                        style={{ fontSize: 12.5, color: MR_TOKENS.fgTertiary, marginTop: 1 }}
                      >
                        {it.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {m.actions && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {m.actions.map((a, i) => (
              <button
                key={i}
                style={{
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 8,
                  border: a.primary ? "none" : "0.5px solid rgba(255,159,10,0.4)",
                  background: a.primary ? "#FF9F0A" : MR_TOKENS.bgSurface,
                  color: a.primary ? "#fff" : "#B8860B",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// ROUND MESSAGE — AI 圆桌
// ════════════════════════════════════════════
type StanceMeta = { color: string; label: string; symbol: string };
const STANCE: Record<MRRoundExpert["stance"], StanceMeta> = {
  support: { color: "#34C759", label: "支持", symbol: "✓" },
  caution: { color: "#FF9F0A", label: "注意", symbol: "!" },
  block:   { color: "#FF3B30", label: "反对", symbol: "×" },
};

function StancePill({ stance }: { stance: MRRoundExpert["stance"] }) {
  const s = STANCE[stance];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#fff",
        letterSpacing: 0.3,
        background: s.color,
        padding: "2px 7px",
        borderRadius: 4,
        lineHeight: 1.2,
      }}
    >
      {s.label}
    </span>
  );
}

function StanceDot({
  stance,
  size = 16,
}: {
  stance: MRRoundExpert["stance"];
  size?: number;
}) {
  const s = STANCE[stance];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: s.color,
        color: "#fff",
        fontSize: stance === "block" ? 13 : 11,
        fontWeight: 800,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {s.symbol}
    </span>
  );
}

function MiraSynthesis({
  summary,
  doneCount,
  total,
}: {
  summary: MRRoundMessage["miraSummary"] | undefined;
  doneCount: number;
  total: number;
}) {
  if (!summary) {
    return (
      <div
        style={{
          padding: "14px 18px",
          background:
            "linear-gradient(135deg, rgba(255,179,64,0.06), rgba(255,159,10,0.08))",
          borderBottom: "0.5px solid rgba(255,159,10,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <MRHostAvatar size={22} />
        <span style={{ fontSize: 13.5, color: "#8B6914" }}>
          Mira 等待 {total - doneCount} 位专家完成…
        </span>
        <MRDots />
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "14px 18px",
        background:
          "linear-gradient(135deg, rgba(255,179,64,0.08), rgba(255,159,10,0.10))",
        borderBottom: "0.5px solid rgba(255,159,10,0.20)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <MRHostAvatar size={24} />
        <span style={{ fontSize: 14, fontWeight: 700, color: MR_TOKENS.fgPrimary }}>Mira 综合</span>
        <span
          style={{
            fontSize: 11,
            color: "#8B6914",
            fontWeight: 700,
            background: "rgba(255,159,10,0.15)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          {summary.verdict}
        </span>
        {summary.conflict && (
          <span
            style={{
              fontSize: 11,
              color: "#fff",
              fontWeight: 700,
              background: "#FF3B30",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            存在分歧
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {summary.points.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
            <span style={{ marginTop: 2 }}>
              <StanceDot stance={p.stance} size={16} />
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: MR_TOKENS.fgPrimary }}>
              <span style={{ fontWeight: 600 }}>{p.tag}:</span>
              <span style={{ color: MR_TOKENS.fgSecondary }}> {p.text}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          padding: "9px 12px",
          background: MR_TOKENS.bgSurface,
          borderRadius: 8,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: MR_TOKENS.fgPrimary,
          border: "0.5px solid rgba(255,159,10,0.20)",
        }}
      >
        <span style={{ fontWeight: 700, color: "#FF9F0A" }}>→ 建议</span>
        <span style={{ marginLeft: 6 }}>{summary.recommendation}</span>
      </div>
    </div>
  );
}

function ExpertAccordion({
  expert,
  open,
  onToggle,
}: {
  expert: MRRoundExpert;
  open: boolean;
  onToggle: () => void;
}) {
  const a = MR_AGENTS_IN_MEETING[expert.who];
  if (!a) return null;
  return (
    <div style={{ borderTop: `0.5px solid ${MR_TOKENS.divider}` }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 18px",
          cursor: "pointer",
          background: open ? MR_TOKENS.bgRaised : MR_TOKENS.bgSurface,
        }}
      >
        <MRAIAvatar id={expert.who} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: MR_TOKENS.fgPrimary }}>{a.name}</span>
            <StancePill stance={expert.stance} />
            <span style={{ fontSize: 12, color: MR_TOKENS.fgTertiary }}>{a.roleShort}</span>
            {!expert.done && (
              <span style={{ fontSize: 11, color: "#5E5CE6", fontWeight: 600 }}>
                分析中
                <MRDots />
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 13,
              color: MR_TOKENS.fgSecondary,
              marginTop: 2,
              lineHeight: 1.45,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: open ? "normal" : "nowrap",
            }}
          >
            {expert.headline}
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            color: MR_TOKENS.fgQuaternary,
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 180ms ease",
          }}
        >
          <MRIcon name="chev" size={16} color={MR_TOKENS.fgQuaternary} />
        </div>
      </div>

      {open && expert.done && (
        <div style={{ padding: "4px 18px 16px 60px" }}>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: MR_TOKENS.fgPrimary,
              marginBottom: 10,
            }}
          >
            {expert.summary}
          </div>
          {expert.data && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${expert.data.length}, 1fr)`,
                gap: 8,
                marginBottom: 10,
              }}
            >
              {expert.data.map((row, i) => (
                <div
                  key={i}
                  style={{
                    background: MR_TOKENS.bgSubtle,
                    borderRadius: 8,
                    padding: "8px 11px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: MR_TOKENS.fgTertiary,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      marginTop: 2,
                      fontVariantNumeric: "tabular-nums",
                      color: MR_TOKENS.fgPrimary,
                    }}
                  >
                    {row.v}
                  </div>
                </div>
              ))}
            </div>
          )}
          {expert.note && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: MR_TOKENS.fgSecondary,
                padding: "9px 12px",
                borderRadius: 8,
                background: `linear-gradient(135deg, ${a.grad[0]}10, ${a.grad[1]}10)`,
                border: `0.5px solid ${a.grad[0]}33`,
              }}
            >
              {expert.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MRRoundMessageView({
  m,
  initialOpen,
}: {
  m: MRRoundMessage;
  initialOpen: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const doneCount = m.experts.filter((e) => e.done).length;
  const triggerName = MR_HUMANS_IN_MEETING[m.trigger.by]?.name ?? m.trigger.by;
  return (
    <div style={{ padding: "10px 28px" }}>
      <div
        style={{
          background: MR_TOKENS.bgSurface,
          borderRadius: 12,
          border: MR_TOKENS.borderHair2Strong,
          boxShadow: MR_TOKENS.shadowCard,
          overflow: "hidden",
          maxWidth: 720,
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "13px 18px 11px",
            background:
              "linear-gradient(135deg, rgba(94,92,230,0.05), rgba(175,82,222,0.07))",
            borderBottom: `0.5px solid ${MR_TOKENS.divider}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <MRIcon name="sparkle" size={15} color="#5E5CE6" />
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#5E5CE6",
                letterSpacing: 0.4,
              }}
            >
              AI 圆桌 · {doneCount}/{m.experts.length} 已答
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: MR_TOKENS.fgTertiary,
              }}
            >
              {triggerName} 发起 · {m.t}
            </span>
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 5,
              lineHeight: 1.35,
              color: MR_TOKENS.fgPrimary,
            }}
          >
            “{m.topic}”
          </div>
        </div>

        <MiraSynthesis
          summary={m.done ? m.miraSummary : undefined}
          doneCount={doneCount}
          total={m.experts.length}
        />

        <div
          style={{
            padding: "9px 18px 7px",
            fontSize: 11,
            fontWeight: 700,
            color: MR_TOKENS.fgTertiary,
            letterSpacing: 0.4,
            background: MR_TOKENS.bgSurface,
          }}
        >
          点击展开专家详情 · 一次只展开一位,timeline 不跳动
        </div>
        {m.experts.map((e) => (
          <ExpertAccordion
            key={e.who}
            expert={e}
            open={open === e.who}
            onToggle={() => setOpen(open === e.who ? null : e.who)}
          />
        ))}
      </div>
    </div>
  );
}
