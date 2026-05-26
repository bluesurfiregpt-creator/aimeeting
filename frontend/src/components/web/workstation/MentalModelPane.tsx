"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { W_TOKENS } from "../tokens";
import { W_USER } from "../data/agents";
import { WIcon, WSparkle } from "../atoms";

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
 * AI 心智一览 pane (workstation 默认 landing). round-6 rewrite:
 *
 * - 副标题加 "· 一页看完 AI 怎么思考、怎么记住、怎么使用"
 * - 标题改 "AI 心智一览" (吃掉独立 graph 入口)
 * - 删 4 张 QuickCard
 * - 新加 <MentalLiveSection /> 嵌入 LineagePane (Sankey, embedded)
 *
 * 紫渐变 hero box 保留 (4 个流程节点 AI 专家 → 书架 → 经验 → 会议).
 */
export function MentalModelPane() {
  const router = useRouter();

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

      <MentalModelHero onJump={(slug) => router.push(`/workstation/${slug}`)} />

      <MentalLiveSection />
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

function MentalModelHero({ onJump }: { onJump: (slug: string) => void }) {
  const NODES = [
    {
      id: "agents",
      label: "AI 专家",
      glyph: "◆",
      tone: ["#5E5CE6", "#AF52DE"] as const,
      desc: "在每场会议里 参与思考",
      slug: "agents",
      count: 32,
    },
    {
      id: "kb",
      label: "书架",
      glyph: "📚",
      tone: ["#0A84FF", "#5E5CE6"] as const,
      desc: "需要时 查得到的资料",
      slug: "kb",
      count: 26,
    },
    {
      id: "memory",
      label: "经验",
      glyph: "◐",
      tone: ["#AF52DE", "#FF6482"] as const,
      desc: "AI 已经 内化的事",
      slug: "memory",
      count: 100,
    },
    {
      id: "meet",
      label: "会议",
      glyph: "◎",
      tone: ["#FF6482", "#FFB340"] as const,
      desc: "产出 上面 两者",
      slug: null,
      count: 21,
    },
  ];

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

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          marginTop: 28,
        }}
      >
        {NODES.map((n, i) => (
          <FlowNode
            key={n.id}
            n={n}
            last={i === NODES.length - 1}
            onClick={() => n.slug && onJump(n.slug)}
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

type FlowNodeProps = {
  n: {
    id: string;
    label: string;
    glyph: string;
    tone: readonly [string, string];
    desc: string;
    slug: string | null;
    count: number;
  };
  last: boolean;
  onClick: () => void;
};

function FlowNode({ n, last, onClick }: FlowNodeProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {!last && (
        <div
          style={{
            position: "absolute",
            top: 24,
            left: "calc(50% + 28px)",
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
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: n.slug ? "pointer" : "default",
          padding: 0,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          transition: "transform 200ms ease",
          transform: hovered && n.slug ? "translateY(-3px)" : "none",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${n.tone[0]} 0%, ${n.tone[1]} 100%)`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 26,
            boxShadow:
              hovered && n.slug
                ? `0 8px 24px ${n.tone[1]}55, inset 0 0 0 0.5px rgba(255,255,255,0.30)`
                : `0 4px 14px ${n.tone[1]}30, inset 0 0 0 0.5px rgba(255,255,255,0.15)`,
            transition: "box-shadow 200ms ease",
            letterSpacing: -1,
          }}
        >
          {n.glyph}
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: -0.1,
            }}
          >
            {n.label}
            <span
              style={{
                fontWeight: 500,
                color: "rgba(255,255,255,0.50)",
                marginLeft: 5,
                fontSize: 12,
              }}
            >
              {n.count}
            </span>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(255,255,255,0.55)",
              marginTop: 2,
            }}
          >
            {n.desc}
          </div>
        </div>
      </button>
    </div>
  );
}
