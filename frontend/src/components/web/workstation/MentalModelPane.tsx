"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { W_TOKENS } from "../tokens";
import { W_USER } from "../data/agents";
import {
  WIcon,
  WSparkle,
  W_MENTAL_ICON_BY_ID,
  type WMentalIconId,
} from "../atoms";
import {
  MENTAL_NODES,
  MENTAL_NODE_ORDER,
  type MentalNode,
} from "../data/mentalModels";

// LineagePane 用 echarts (~900KB gzip), 动态加载减少 mental pane first-load,
// 同时避免 SSR 时 echarts 调用 window 报错.
const LineagePane = dynamic(() => import("./LineagePane").then((m) => ({ default: m.LineagePane })), {
  ssr: false,
  loading: () => (
    <div
      style={{
        padding: 40,
        textAlign: "center",
        color: W_TOKENS.textMuted,
        fontSize: 13,
      }}
    >
      血缘图加载中…
    </div>
  ),
});

/**
 * AI 心智一览 pane (workstation 默认 landing).
 *
 * Saga O 改造 (设计稿: `Mental Model Icons.html`):
 *  - 旧 emoji glyph FlowNode → 4 件拟物 SVG (紫水晶/书架/琥珀球/圆桌)
 *  - 数字被抽到名字旁边 → 变大变粗 + 发光胶囊 → **可点击的入口**
 *  - 点击数字胶囊 → 右侧 420px 抽屉滑出 (DrillPanel: 分类柱状 + 最近条目)
 *  - 抽屉里 "查看全部 →" 跳到对应 workstation slug
 *
 * 不动:
 *  - hero 紫渐变背景 / sparkle / footer "AI 引用 → 提炼 → 调用" 一句话
 *  - 下方 MentalLiveSection (LineagePane embedded)
 *  - props 契约 (export function MentalModelPane()))
 */
export function MentalModelPane() {
  const router = useRouter();
  const [drillId, setDrillId] = useState<WMentalIconId | null>(null);

  return (
    <>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: W_TOKENS.textFaint,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        总览
      </div>
      <h1
        style={{
          margin: "0 0 6px",
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: -0.8,
          color: W_TOKENS.textPrimary,
        }}
      >
        AI 心智一览
      </h1>
      <div
        style={{
          fontSize: 13.5,
          color: W_TOKENS.textMuted,
          marginBottom: 24,
        }}
      >
        {W_USER.name} · {W_USER.workspace} · 一页看完 AI 怎么思考、怎么记住、怎么使用
      </div>

      <MentalModelHero onOpen={(id) => setDrillId(id)} />

      <MentalLiveSection />

      <DrillPanel
        id={drillId}
        onClose={() => setDrillId(null)}
        onJump={(slug) => {
          setDrillId(null);
          router.push(`/workstation/${slug}`);
        }}
      />
    </>
  );
}

// ════════════════════════════════════════════
// MENTAL LIVE SECTION — embeds LineagePane (桑基图)
// ════════════════════════════════════════════
function MentalLiveSection() {
  return (
    <div style={{ marginTop: 28 }}>
      {/* 紫色脉冲分隔标 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            padding: "6px 14px 6px 10px",
            borderRadius: 22,
            background:
              "linear-gradient(135deg, rgba(124,92,250,0.16) 0%, rgba(196,181,253,0.08) 100%)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#C4B5FD",
              boxShadow: "0 0 10px rgba(196,181,253,0.80)",
              animation: "wPulse 1.4s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: W_TOKENS.textPrimary,
              letterSpacing: 0.3,
            }}
          >
            下方 · 你工作空间里的真实血缘
          </span>
        </div>
        <div style={{ flex: 1, height: 1, background: W_TOKENS.border }} />
        <span style={{ fontSize: 12, color: W_TOKENS.textMuted }}>点击节点 / 拖拽缩放</span>
      </div>

      {/* 嵌入 LineagePane (Sankey + 全屏入口) */}
      <LineagePane embedded />
    </div>
  );
}

// ════════════════════════════════════════════
// HERO — 紫渐变 + 4 件拟物 icon strip
// ════════════════════════════════════════════
function MentalModelHero({ onOpen }: { onOpen: (id: WMentalIconId) => void }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 18,
        background: "linear-gradient(135deg, #15102f 0%, #1a1530 40%, #271a3f 100%)",
        boxShadow: "0 16px 40px rgba(94,92,230,0.16), inset 0 0 0 0.5px rgba(255,255,255,0.06)",
        padding: "24px 28px 30px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(100,210,255,0.18) 0%, rgba(0,0,0,0) 65%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -100,
          left: -80,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,100,130,0.16) 0%, rgba(0,0,0,0) 65%)",
          pointerEvents: "none",
        }}
      />
      <WSparkle x={70} y={32} size={11} opacity={0.85} />
      <WSparkle x={140} y={64} size={6} opacity={0.5} />
      <WSparkle x="78%" y={26} size={9} opacity={0.7} />
      <WSparkle x="86%" y={62} size={5} opacity={0.5} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 11 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
          }}
        >
          <WIcon name="compass" size={17} color="#fff" stroke={1.8} />
        </div>
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            心智模型
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#fff",
              marginTop: 2,
              letterSpacing: -0.3,
            }}
          >
            AI 怎么参与你的每一场会议
          </div>
        </div>
      </div>

      {/* STRIP — 4 件拟物 icon, 数字胶囊可点击 */}
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          marginTop: 28,
        }}
      >
        {MENTAL_NODE_ORDER.map((id, i) => (
          <MentalFlowNode
            key={id}
            node={MENTAL_NODES[id]}
            last={i === MENTAL_NODE_ORDER.length - 1}
            onOpen={() => onOpen(id)}
          />
        ))}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: 22,
          padding: "12px 14px",
          borderRadius: 11,
          background: "rgba(0,0,0,0.20)",
          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.05)",
          fontSize: 13,
          color: "rgba(255,255,255,0.82)",
          lineHeight: 1.6,
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <WIcon name="sparkle" size={14} color="#C4B5FD" stroke={2} />
        AI 专家在会议中 <strong style={{ color: "#fff" }}>引用书架资料</strong>,
        提炼为 <strong style={{ color: "#fff" }}>长期经验</strong>,
        在下一场会议里 <strong style={{ color: "#fff" }}>自动调用</strong> — 会议越开,AI 越懂你。
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// FLOW NODE — icon + clickable count badge
// ════════════════════════════════════════════
function MentalFlowNode({
  node,
  last,
  onOpen,
}: {
  node: MentalNode;
  last: boolean;
  onOpen: () => void;
}) {
  const Icon = W_MENTAL_ICON_BY_ID[node.id];
  const [hover, setHover] = useState(false);
  const [hoverNum, setHoverNum] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* connector → 流动小球箭头 */}
      {!last && (
        <div
          style={{
            position: "absolute",
            top: 56,
            left: "calc(50% + 56px)",
            right: "-50%",
            height: 1,
            background:
              "linear-gradient(90deg, rgba(196,181,253,0.50), rgba(196,181,253,0.10))",
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -3,
              left: 0,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#C4B5FD",
              boxShadow: "0 0 10px rgba(196,181,253,0.80)",
              animation: "wMoveRight 2.4s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -2,
              top: -3,
              width: 0,
              height: 0,
              borderLeft: "5px solid rgba(196,181,253,0.5)",
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
            }}
          />
        </div>
      )}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          transition: "transform 200ms ease",
          transform: hover ? "translateY(-4px)" : "none",
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* SKEUOMORPHIC ICON — no outer frame */}
        <div
          style={{
            width: 112,
            height: 112,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 200ms ease, filter 200ms ease",
            transform: hover ? "scale(1.04)" : "scale(1)",
            filter: hover
              ? `drop-shadow(0 12px 24px ${node.accent}44)`
              : `drop-shadow(0 6px 18px ${node.accent}26)`,
          }}
        >
          <Icon size={112} />
        </div>

        {/* label + clickable count badge */}
        <div style={{ textAlign: "center", marginTop: 2 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: -0.1,
              display: "inline-flex",
              alignItems: "baseline",
              gap: 9,
            }}
          >
            <span>{node.label}</span>

            <button
              type="button"
              onClick={onOpen}
              onMouseEnter={() => setHoverNum(true)}
              onMouseLeave={() => setHoverNum(false)}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "baseline",
                gap: 4,
                background: hoverNum
                  ? `linear-gradient(180deg, ${node.accent}26, ${node.accent}10)`
                  : "rgba(255,255,255,0.04)",
                border: "none",
                boxShadow: hoverNum
                  ? `inset 0 0 0 0.5px ${node.accent}88, 0 4px 14px ${node.accent}33`
                  : `inset 0 0 0 0.5px rgba(255,255,255,0.12)`,
                borderRadius: 9,
                padding: "3px 9px 4px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 180ms ease",
                transform: hoverNum ? "translateY(-1px)" : "none",
                color: "#fff",
              }}
            >
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: hoverNum ? "#fff" : node.accent,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: -0.6,
                  lineHeight: 1,
                  textShadow: hoverNum
                    ? `0 0 12px ${node.accent}99`
                    : `0 0 8px ${node.accent}44`,
                  transition: "all 180ms ease",
                }}
              >
                {node.count}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: hoverNum ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.55)",
                  lineHeight: 1,
                }}
              >
                {node.unit}
              </span>
              <svg
                width="9"
                height="9"
                viewBox="0 0 9 9"
                style={{
                  marginLeft: 1,
                  opacity: hoverNum ? 0.85 : 0.4,
                  transform: hoverNum ? "translate(1px, -1px)" : "none",
                  transition: "all 180ms ease",
                }}
              >
                <path
                  d="M 1 8 L 8 1 M 3 1 L 8 1 L 8 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", marginTop: 5 }}>
            {node.sub}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// DRILL PANEL — 右侧 420px 抽屉
// ════════════════════════════════════════════
function DrillPanel({
  id,
  onClose,
  onJump,
}: {
  id: WMentalIconId | null;
  onClose: () => void;
  onJump: (slug: string) => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (id) {
      setShown(false);
      const t = setTimeout(() => setShown(true), 20);
      return () => clearTimeout(t);
    }
    setShown(false);
    return undefined;
  }, [id]);

  // ESC 关
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;
  const d = MENTAL_NODES[id];
  const Icon = W_MENTAL_ICON_BY_ID[id];
  const total = d.breakdown.reduce((s, b) => s + b.v, 0);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        pointerEvents: "auto",
      }}
    >
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(8,6,18,0.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: shown ? 1 : 0,
          transition: "opacity 220ms ease",
        }}
      />

      {/* panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          background: "linear-gradient(180deg, #1a1530 0%, #15102a 100%)",
          boxShadow:
            "-20px 0 60px rgba(0,0,0,0.55), inset 0 0 0 0.5px rgba(255,255,255,0.06)",
          transform: shown ? "translateX(0)" : "translateX(100%)",
          opacity: shown ? 1 : 0.5,
          transition:
            "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "20px 22px 16px",
            borderBottom: "0.5px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${d.accent}33 0%, ${d.accent}00 65%)`,
              pointerEvents: "none",
            }}
          />
          <div style={{ flexShrink: 0, marginTop: -4 }}>
            <Icon size={72} />
          </div>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "rgba(255,255,255,0.55)",
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              数据储备 · 可穿透查看
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 4 }}>
              {d.label}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 5,
                marginTop: 8,
              }}
            >
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  color: d.accent,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: -1.2,
                  lineHeight: 1,
                  textShadow: `0 0 18px ${d.accent}66`,
                }}
              >
                {d.count}
              </span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{d.unit}</span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
              {d.sub}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "rgba(255,255,255,0.06)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path
                d="M 1 1 L 10 10 M 10 1 L 1 10"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* breakdown */}
        <div style={{ padding: "18px 22px 8px" }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.50)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            按分类
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {d.breakdown.map((b, i) => {
              const pct = (b.v / total) * 100;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      flex: "0 0 80px",
                      fontSize: 12.5,
                      color: "rgba(255,255,255,0.80)",
                    }}
                  >
                    {b.tag}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${d.accent}, ${d.accent}88)`,
                        boxShadow: `0 0 6px ${d.accent}66`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      flex: "0 0 32px",
                      textAlign: "right",
                      fontSize: 12,
                      color: "#fff",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {b.v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* recent */}
        <div
          style={{ padding: "14px 22px 18px", flex: 1, overflow: "auto", minHeight: 0 }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.50)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginTop: 6,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>最近 · 点击穿透</span>
            {d.slug && (
              <button
                type="button"
                onClick={() => d.slug && onJump(d.slug)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: 10.5,
                  color: d.accent,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                查看全部 →
              </button>
            )}
          </div>
          {d.recent.map((r, i) => (
            <RecentRow key={i} item={r} accent={d.accent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RecentRow({
  item,
  accent,
}: {
  item: { name: string; meta: string; updated: string };
  accent: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "10px 12px",
        borderRadius: 9,
        background: hover ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
        marginBottom: 7,
        display: "flex",
        alignItems: "center",
        gap: 11,
        cursor: "pointer",
        transition: "background 140ms ease",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: accent,
          boxShadow: `0 0 6px ${accent}`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
          {item.meta}
        </div>
      </div>
      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.40)", flexShrink: 0 }}>
        {item.updated}
      </span>
      <svg width="9" height="9" viewBox="0 0 9 9" style={{ opacity: 0.45 }}>
        <path
          d="M 2 1 L 7 4.5 L 2 8"
          fill="none"
          stroke="#fff"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
