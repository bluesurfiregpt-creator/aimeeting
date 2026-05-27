"use client";

/**
 * 全景血缘图 · 桑基视图 (R5.B-replace, round-6).
 *
 * Tech stack: ECharts 5 (Sankey series). PM 在 chat 直接命名 ECharts, 不用 react-flow / @nivo/sankey.
 *
 * 4 列流向: 书架 (KB) → AI 专家 → 长期记忆 → 会议.
 *
 * 两种模式 (复用同一组件):
 *  - embedded = true: 嵌入 MentalModelPane 内, 较紧凑, 隐藏 PaneHeader + FlowExample
 *  - embedded = false: 独立 /workstation/graph 页, 完整 chrome (PaneHeader + FlowExample)
 *
 * 全屏入口 ("全屏探索 · 无限画布") 两种模式都有, 触发 FullscreenSankey overlay.
 *
 * Backend contract (PM R6.5):
 *   POST /api/lineage/sankey → { nodes: [{ id, label, type, meta? }],
 *                                links: [{ source, target, value: number, kind? }] }
 *   value = 流量宽度 (引用次数 / 共享强度).
 *
 * 详情侧栏分 4 种节点 (kb / agent / memory / meeting), 内容深化:
 *  - kb: 4 mini-stat + 挂载 AI + 3 段向量分块预览 + 快速操作
 *  - agent: 大头像 + intro + 标签 + 书架 N 份 + 长期记忆 N 条 + "查看脑内地图" CTA
 *  - memory: 完整记忆引用块 + 3 mini-stat + 归属 AI + 沉淀来源 + 被引用于 N 场会议
 *  - meeting: 引用了 N 条记忆 + 跳转
 *
 * R5.A scope: 视觉 + 交互 1:1 移植设计稿. 后端接好后切真实数据.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts/core";
import { SankeyChart as SankeyChartSeries } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import { W_TOKENS } from "../tokens";
import { WIcon, WButton, WAIBadge, WSparkle } from "../atoms";
import { W_AGENTS } from "../data/agents";
import {
  adaptApiSankey,
  buildSankey,
  C_KB,
  C_AGENT,
  C_MEM,
  C_MEET,
  type SankeyData,
  type SankeyNode,
} from "../data/sankey";
import { api } from "@/lib/api";
import { PaneHeader } from "./PaneHeader";

// ECharts 注册一次, 模块级.
echarts.use([SankeyChartSeries, TooltipComponent, CanvasRenderer]);

// ════════════════════════════════════════════
// SANKEY CHART (Inline)
// ════════════════════════════════════════════
type SankeyChartProps = {
  data: SankeyData;
  onSelect?: (node: SankeyNode) => void;
  height?: number;
  large?: boolean; // fullscreen 用更大的 label / node
};

function SankeyChart({ data, onSelect, height = 620, large = false }: SankeyChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        backgroundColor: "rgba(15,15,25,0.95)",
        borderColor: "rgba(124,92,250,0.35)",
        borderWidth: 1,
        textStyle: { color: "#fafafc", fontSize: large ? 13 : 12 },
        extraCssText: "backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0,0,0,0.40);",
        formatter: (params: { dataType: string; name: string; value: number; data: { source: string; target: string } }) => {
          if (params.dataType === "node") {
            const n = data.nodes.find((x) => x.name === params.name);
            const typeLabel =
              ({ kb: "书架文档", agent: "AI 专家", memory: "长期记忆", meeting: "会议" } as Record<string, string>)[n?.type ?? ""] || "";
            return `<div style="font-weight:700;margin-bottom:4px;color:#C4B5FD;font-size:11px;letter-spacing:0.3px">${typeLabel} · 点击查看详情</div>
                    <div style="font-size:13px">${params.name}</div>`;
          }
          if (params.dataType === "edge") {
            return `<div style="font-size:11px;color:#a1a1aa;margin-bottom:4px">流量 ${params.value}</div>
                    <div style="font-size:12px;color:#fafafc">${params.data.source}</div>
                    <div style="color:#52525b;font-size:14px;line-height:1">↓</div>
                    <div style="font-size:12px;color:#fafafc">${params.data.target}</div>`;
          }
          return "";
        },
      },
      series: [
        {
          type: "sankey",
          left: large ? 60 : "4%",
          right: large ? 60 : "14%",
          top: large ? 60 : 16,
          bottom: large ? 60 : 16,
          nodeWidth: large ? 18 : 14,
          nodeGap: large ? 12 : 9,
          nodeAlign: "justify",
          layoutIterations: large ? 48 : 32,
          emphasis: {
            focus: "adjacency",
            itemStyle: {
              borderColor: "#fff",
              borderWidth: 1.5,
              shadowColor: "rgba(124,92,250,0.50)",
              shadowBlur: large ? 14 : 12,
            },
            lineStyle: { opacity: large ? 0.9 : 0.85 },
          },
          blur: {
            itemStyle: { opacity: large ? 0.12 : 0.15 },
            lineStyle: { opacity: large ? 0.05 : 0.06 },
          },
          select: {
            itemStyle: {
              borderColor: "#C4B5FD",
              borderWidth: 2,
              shadowColor: "rgba(124,92,250,0.70)",
              shadowBlur: 16,
            },
          },
          selectedMode: "single",
          lineStyle: {
            color: "gradient",
            curveness: 0.55,
            opacity: large ? 0.5 : 0.45,
          },
          label: {
            color: "#fafafc",
            fontSize: large ? 13 : 11,
            fontWeight: 500,
          },
          labelLayout: { hideOverlap: true },
          animationDuration: large ? 900 : 1100,
          animationEasing: "cubicOut",
          data: data.nodes,
          links: data.links,
        },
      ],
    });

    chart.on("click", (params) => {
      const p = params as { dataType?: string; name: string };
      if (p.dataType === "node" && onSelect) {
        const n = data.nodes.find((x) => x.name === p.name);
        if (n) onSelect(n);
      }
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => chart.resize(), 0);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
      chart.dispose();
    };
  }, [data, onSelect, large]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}

// ════════════════════════════════════════════
// MAIN PANE
// ════════════════════════════════════════════
export function LineagePane({ embedded = false }: { embedded?: boolean }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<SankeyNode | null>(null);
  // Sprint 3 Web W1 (P0-3): 切真接 /api/lineage/sankey. 缺数据 / 后端 5xx 时
  // fallback mock (workspace 还没沉淀真实 KB/AI/Memory 时 视觉不空盘).
  // 后端无 KB/Agent/Memory → 也返 {nodes:[], links:[]}, 触发同一份 fallback.
  const mockData = useMemo(() => buildSankey(), []);
  const [data, setData] = useState<SankeyData>(mockData);
  const [usingFallback, setUsingFallback] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiOut = await api.getSankeyLineage();
        if (cancelled) return;
        // 后端 sankey 4 类节点都为 0 → 空数据, fallback to mock 而不是渲染空白桑基
        if (!apiOut.nodes.length || !apiOut.links.length) {
          console.warn("[LineagePane] /api/lineage/sankey 返回空 (workspace 无 KB/Memory 沉淀), 渲染 mock");
          setUsingFallback(true);
          return;
        }
        setData(adaptApiSankey(apiOut));
        setUsingFallback(false);
      } catch (e) {
        console.warn("[LineagePane] /api/lineage/sankey 拉取失败, 渲染 mock:", e);
        // 维持 fallback mock — 不动 data
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(
    () => ({
      kb: data.nodes.filter((n) => n.type === "kb").length,
      agent: data.nodes.filter((n) => n.type === "agent").length,
      memory: data.nodes.filter((n) => n.type === "memory").length,
      meeting: data.nodes.filter((n) => n.type === "meeting").length,
      links: data.links.length,
    }),
    [data],
  );

  const fullscreenBtn = (
    <WButton variant="primary" size="sm" icon="target" iconRight="arr-r" onClick={() => setFullscreen(true)}>
      全屏探索 · 无限画布
    </WButton>
  );

  // Sprint 3 Web W1: workspace 没真实沉淀时显示 "演示数据" pill (PM 反幻觉, 别让客户误以为是真接)
  const demoBadge = usingFallback ? (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: "#C4B5FD",
        background: "rgba(124,92,250,0.10)",
        padding: "2px 8px",
        borderRadius: 5,
        letterSpacing: 0.3,
        boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
      }}
    >
      演示数据
    </span>
  ) : null;

  return (
    <>
      {!embedded && (
        <PaneHeader
          title="全景血缘图 · 桑基视图"
          sub="知识从书架 → AI 专家 → 长期记忆 → 会议 的完整流向。线条粗细 = 流量强度。"
          extra={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {demoBadge}
              {fullscreenBtn}
            </div>
          }
        />
      )}
      {embedded && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 14 }}>
          {demoBadge}
          {fullscreenBtn}
        </div>
      )}

      {/* 5 stats 卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { label: "书架文档", value: counts.kb, color: C_KB, flow: "源头" },
          { label: "AI 专家", value: counts.agent, color: C_AGENT, flow: "中介" },
          { label: "长期记忆", value: counts.memory, color: C_MEM, flow: "提炼" },
          { label: "会议", value: counts.meeting, color: C_MEET, flow: "产出" },
          { label: "关联流", value: counts.links, color: "#86EFAC", flow: "总流量" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: W_TOKENS.surface,
              borderRadius: 10,
              padding: "11px 14px",
              boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: 3,
                background: s.color,
                opacity: 0.65,
              }}
            />
            <div style={{ fontSize: 10.5, color: W_TOKENS.textMuted, letterSpacing: 0.3 }}>
              {s.label}
              <span style={{ marginLeft: 5, opacity: 0.6 }}>· {s.flow}</span>
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: s.color,
                marginTop: 3,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: -0.5,
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* 4 列流向 header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          padding: "0 0 12px",
          borderBottom: `0.5px solid ${W_TOKENS.border}`,
        }}
      >
        {[
          { label: "书架", sub: "KB / 书架文档", color: C_KB },
          { label: "AI", sub: "8 位专家 · 中介", color: C_AGENT },
          { label: "记忆", sub: "AI 内化的经验", color: C_MEM },
          { label: "会议", sub: "使用 / 产出", color: C_MEET },
        ].map((c, i) => (
          <div
            key={c.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              paddingLeft: i === 0 ? 0 : 20,
              paddingRight: 20,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: c.color,
                boxShadow: `0 0 8px ${c.color}50`,
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: W_TOKENS.textPrimary }}>{c.label}</div>
              <div style={{ fontSize: 11, color: W_TOKENS.textMuted, marginTop: 1 }}>{c.sub}</div>
            </div>
            {i < 3 && (
              <span style={{ marginLeft: "auto", fontSize: 18, color: W_TOKENS.textFaint, opacity: 0.5 }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* Sankey chart 容器 (深紫宇宙底) */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 12,
          background: "linear-gradient(135deg, #0a0816 0%, #11102a 50%, #1a1633 100%)",
          boxShadow: `inset 0 0 0 0.5px ${W_TOKENS.border}, 0 12px 30px rgba(0,0,0,0.30)`,
          padding: "8px 0 16px",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(124,92,250,0.08) 0%, rgba(0,0,0,0) 70%)",
            pointerEvents: "none",
          }}
        />
        <WSparkle x={28} y={20} size={9} opacity={0.55} />
        <WSparkle x="90%" y={34} size={6} opacity={0.45} />

        <SankeyChart data={data} onSelect={setSelected} />

        {/* 全屏角标提示 */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 11px",
            borderRadius: 9,
            border: "none",
            background: "rgba(124,92,250,0.18)",
            boxShadow: "inset 0 0 0 0.5px rgba(196,181,253,0.40)",
            backdropFilter: "blur(10px)",
            color: "#C4B5FD",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(124,92,250,0.30)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(124,92,250,0.18)";
            e.currentTarget.style.color = "#C4B5FD";
          }}
        >
          <WIcon name="target" size={13} stroke={2.2} />
          全屏探索
          <WIcon name="arr-r" size={11} stroke={2.4} />
        </button>

        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 16,
            right: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.45)",
            pointerEvents: "none",
          }}
        >
          <span>悬停任一节点 — 自动追溯整条引用链路</span>
          <span>线条粗细 ∝ 引用次数 / 共享强度</span>
        </div>
      </div>

      {/* embedded 不显示 FlowExample */}
      {!embedded && <FlowExample />}

      {/* fullscreen overlay */}
      {fullscreen && (
        <FullscreenSankey
          data={data}
          onClose={() => {
            setFullscreen(false);
            setSelected(null);
          }}
          selected={selected}
          setSelected={setSelected}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════
// FLOW EXAMPLE
// ════════════════════════════════════════════
function FlowExample() {
  return (
    <div
      style={{
        marginTop: 18,
        padding: "14px 18px",
        borderRadius: 12,
        background: "rgba(124,92,250,0.05)",
        boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.18)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: "#C4B5FD",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        💡 一条典型流向
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 13,
        }}
      >
        <FlowChip color={C_KB} icon="📚" label="深圳物业管理条例" />
        <Arrow />
        <FlowChip color={C_AGENT} icon="🧑" label="法老张" sub="法规专家" />
        <Arrow />
        <FlowChip color={C_MEM} icon="🧠" label="业主大会 2/3 同意才可动用专项资金" />
        <Arrow />
        <FlowChip color={C_MEET} icon="📅" label="维修资金审议会" />
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          color: W_TOKENS.textMuted,
          lineHeight: 1.5,
        }}
      >
        每条流向都可在桑基图上可视化跟踪 — 谁(KB) → 谁(AI) → 提炼了什么(记忆) → 用在哪场会议 — 一目了然。
      </div>
    </div>
  );
}

function FlowChip({ color, icon, label, sub }: { color: string; icon: string; label: string; sub?: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 11px 6px 7px",
        borderRadius: 9,
        background: `${color}15`,
        boxShadow: `inset 0 0 0 0.5px ${color}40`,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: W_TOKENS.textPrimary }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: W_TOKENS.textMuted, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Arrow() {
  return <span style={{ fontSize: 18, color: W_TOKENS.textFaint }}>→</span>;
}

// ════════════════════════════════════════════
// FULLSCREEN INFINITE-CANVAS SANKEY
// ════════════════════════════════════════════
type FullscreenSankeyProps = {
  data: SankeyData;
  onClose: () => void;
  selected: SankeyNode | null;
  setSelected: (n: SankeyNode | null) => void;
};

function FullscreenSankey({ data, onClose, selected, setSelected }: FullscreenSankeyProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 3600x2200 大画布 (zoom 30%-300%)
  const W = 3600;
  const H = 2200;

  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, [data-no-drag]")) return;
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    setPan({
      x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
    });
  };
  const onMouseUp = () => {
    isDraggingRef.current = false;
  };
  const onWheel = (e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-zoom]")) return;
    const delta = -e.deltaY * 0.002;
    setZoom((z) => Math.max(0.3, Math.min(3, z + delta)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      if (e.key === "=" || e.key === "+") setZoom((z) => Math.min(3, z + 0.15));
      if (e.key === "-") setZoom((z) => Math.max(0.3, z - 0.15));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "#06050d",
        animation: "wFadeIn 240ms ease",
        animationFillMode: "forwards",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {/* 无限画布 */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: "absolute",
          inset: 0,
          cursor: isDraggingRef.current ? "grabbing" : "grab",
          background:
            "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(124,92,250,0.08) 0%, rgba(0,0,0,0) 70%)",
          userSelect: "none",
        }}
      >
        {/* 点状网格 */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity: 0.4,
          }}
        >
          <defs>
            <pattern id="fs-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="rgba(124,92,250,0.20)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#fs-grid)" />
        </svg>

        {/* 大 sankey 画布 (pan + zoom) */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: W,
            height: H,
            marginLeft: -W / 2,
            marginTop: -H / 2,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDraggingRef.current ? "none" : "transform 200ms ease",
            pointerEvents: "auto",
          }}
        >
          <SankeyChart data={data} onSelect={setSelected} height={H} large />
        </div>
      </div>

      {/* 顶 chrome */}
      <div
        data-no-drag
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderRadius: 11,
            background: "rgba(20,18,40,0.85)",
            backdropFilter: "blur(12px) saturate(180%)",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10)",
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: "linear-gradient(135deg, #5E5CE6 0%, #AF52DE 100%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 10px rgba(124,92,250,0.30)",
            }}
          >
            <WIcon name="link" size={13} color="#fff" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>全景血缘图 · 全屏</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {data.nodes.length} 节点 · {data.links.length} 连接
          </span>
        </div>

        <span style={{ flex: 1 }} />

        <div
          style={{
            pointerEvents: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 9,
            background: "rgba(20,18,40,0.65)",
            backdropFilter: "blur(12px)",
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08)",
          }}
        >
          <KbdHint k="+" />
          <span>放大</span>
          <KbdHint k="−" />
          <span>缩小</span>
          <KbdHint k="0" />
          <span>重置</span>
          <KbdHint k="Esc" />
          <span>退出</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            pointerEvents: "auto",
            width: 38,
            height: 38,
            borderRadius: 11,
            border: "none",
            background: "rgba(20,18,40,0.85)",
            color: "#fff",
            fontSize: 18,
            cursor: "pointer",
            fontFamily: "inherit",
            backdropFilter: "blur(12px)",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="退出全屏 (Esc)"
        >
          ×
        </button>
      </div>

      {/* zoom panel (左下) */}
      <div
        data-no-drag
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <ZoomCtl onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>+</ZoomCtl>
        <div
          style={{
            width: 40,
            padding: "4px 0",
            textAlign: "center",
            background: "rgba(20,18,40,0.85)",
            backdropFilter: "blur(12px)",
            borderRadius: 0,
            fontSize: 11,
            color: "rgba(255,255,255,0.65)",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(zoom * 100)}%
        </div>
        <ZoomCtl onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}>−</ZoomCtl>
        <ZoomCtl
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title="重置 (0)"
        >
          ⌖
        </ZoomCtl>
      </div>

      {/* mini-map (右下) */}
      <div
        data-no-drag
        style={{
          position: "absolute",
          bottom: 20,
          right: selected ? 504 : 20,
          zIndex: 10,
          width: 200,
          height: 130,
          background: "rgba(20,18,40,0.85)",
          backdropFilter: "blur(12px)",
          borderRadius: 11,
          padding: 6,
          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10)",
          transition: "right 240ms ease",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.50)",
            borderRadius: 7,
            overflow: "hidden",
          }}
        >
          {data.nodes.map((n, i) => {
            const colWidths: Record<string, number> = { kb: 0.1, agent: 0.35, memory: 0.65, meeting: 0.92 };
            const x = (colWidths[n.type] || 0.5) * 100;
            const y = ((i * 17) % 95) + 2.5;
            const c =
              ({ kb: "#7DDEFF", agent: "#C4B5FD", memory: "#A78BFA", meeting: "#FF99B6" } as Record<string, string>)[n.type] ||
              "#fff";
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: `${y}%`,
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: c,
                  transform: "translate(-50%, -50%)",
                }}
              />
            );
          })}
          <div
            style={{
              position: "absolute",
              left: `${50 - 30 / zoom}%`,
              top: `${50 - 30 / zoom}%`,
              width: `${60 / zoom}%`,
              height: `${60 / zoom}%`,
              transform: `translate(${pan.x * 0.05}px, ${pan.y * 0.05}px)`,
              boxShadow: "inset 0 0 0 1px rgba(196,181,253,0.80)",
              borderRadius: 3,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 2,
              right: 4,
              fontSize: 9,
              color: "rgba(255,255,255,0.40)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {data.nodes.length} 节点
          </div>
        </div>
      </div>

      {/* 460px 详情侧栏 */}
      {selected && (
        <FullscreenDetailSidebar
          node={selected}
          data={data}
          onClose={() => setSelected(null)}
          onSelectOther={setSelected}
        />
      )}

      {/* 提示 hint (无选中) */}
      {!selected && (
        <div
          data-no-drag
          style={{
            position: "absolute",
            top: 80,
            right: 20,
            zIndex: 5,
            padding: "12px 16px",
            borderRadius: 11,
            background: "rgba(20,18,40,0.65)",
            backdropFilter: "blur(12px)",
            boxShadow: "inset 0 0 0 0.5px rgba(124,92,250,0.30)",
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.6,
            maxWidth: 240,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#C4B5FD",
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            💡 探索提示
          </div>
          ⋅ <strong style={{ color: "#fff" }}>点击</strong>任一节点查看详情
          <br />⋅ <strong style={{ color: "#fff" }}>拖拽</strong>画布平移
          <br />⋅ <strong style={{ color: "#fff" }}>滚轮</strong>缩放 · 点击左下按钮重置
        </div>
      )}
    </div>
  );
}

function KbdHint({ k }: { k: string }) {
  return (
    <kbd
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.10)",
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.30)",
        fontFamily: 'ui-monospace, "SF Mono", monospace',
        fontSize: 10,
        color: "#fff",
        fontWeight: 600,
      }}
    >
      {k}
    </kbd>
  );
}

function ZoomCtl({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 40,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: "rgba(20,18,40,0.85)",
        backdropFilter: "blur(12px)",
        color: "#fff",
        fontSize: 15,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

// ════════════════════════════════════════════
// 460px DETAIL SIDEBAR (right edge of fullscreen)
// ════════════════════════════════════════════
function FullscreenDetailSidebar({
  node,
  data,
  onClose,
  onSelectOther,
}: {
  node: SankeyNode;
  data: SankeyData;
  onClose: () => void;
  onSelectOther: (n: SankeyNode) => void;
}) {
  const router = useRouter();
  const typeMeta = (
    {
      kb: { label: "书架文档", color: "#7DDEFF", icon: "📚" },
      agent: { label: "AI 专家", color: "#C4B5FD", icon: "🧑" },
      memory: { label: "长期记忆", color: "#A78BFA", icon: "🧠" },
      meeting: { label: "会议", color: "#FF99B6", icon: "📅" },
    } as Record<string, { label: string; color: string; icon: string }>
  )[node.type] || { label: "", color: "#fff", icon: "" };

  const onDeepLink = useCallback(() => {
    if (node.type === "agent" && node.meta?.agentId) {
      router.push(`/workstation/agent/${node.meta.agentId}`);
    } else if (node.type === "meeting") {
      router.push(`/workstation/meeting/q3-roadmap`);
    } else if (node.type === "kb") {
      router.push(`/workstation/kb`);
    } else if (node.type === "memory") {
      router.push(`/workstation/memory`);
    }
  }, [node, router]);

  return (
    <div
      data-no-drag
      style={{
        position: "absolute",
        top: 80,
        right: 20,
        bottom: 20,
        width: 460,
        zIndex: 10,
        background: "rgba(20,18,40,0.94)",
        backdropFilter: "blur(20px) saturate(180%)",
        borderRadius: 16,
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "wFadeIn 240ms ease",
        animationFillMode: "forwards",
      }}
    >
      {/* HEAD */}
      <div
        style={{
          padding: "20px 22px 18px",
          position: "relative",
          background: `linear-gradient(135deg, ${typeMeta.color}22 0%, rgba(0,0,0,0) 70%)`,
          borderBottom: "0.5px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -50,
            right: -30,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${typeMeta.color}35 0%, rgba(0,0,0,0) 65%)`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{typeMeta.icon}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: typeMeta.color,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: 5,
                background: `${typeMeta.color}25`,
              }}
            >
              {typeMeta.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: "none",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              fontSize: 18,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 21,
            fontWeight: 800,
            color: "#fff",
            lineHeight: 1.3,
            letterSpacing: -0.3,
            position: "relative",
          }}
        >
          {node.name}
        </div>
      </div>

      {/* BODY */}
      <div className="w-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 22px 22px" }}>
        {node.type === "memory" && <MemoryDetail node={node} data={data} onJump={onSelectOther} />}
        {node.type === "kb" && <KBDetail node={node} data={data} onJump={onSelectOther} />}
        {node.type === "agent" && <AgentDetail node={node} data={data} onJump={onSelectOther} />}
        {node.type === "meeting" && <MeetingDetail node={node} data={data} onJump={onSelectOther} />}
      </div>

      {/* FOOTER CTA */}
      <div style={{ padding: "14px 20px", borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
        <WButton variant="primary" size="md" iconRight="arr-r" full onClick={onDeepLink}>
          {node.type === "agent" && "查看脑内地图"}
          {node.type === "meeting" && "查看完整会议纪要"}
          {node.type === "kb" && "打开知识库"}
          {node.type === "memory" && "打开长期记忆库"}
        </WButton>
      </div>
    </div>
  );
}

// ─────────── helper components ───────────
function SectionLabel({ children, color, mt }: { children: React.ReactNode; color?: string; mt?: number }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: color || "rgba(255,255,255,0.55)",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: mt || 0,
        marginBottom: 9,
      }}
    >
      {children}
    </div>
  );
}

function MetaCard({ label, value, color, suffix, small }: { label: string; value: React.ReactNode; color?: string; suffix?: string; small?: boolean }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 9,
        background: "rgba(255,255,255,0.04)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: small ? 14 : 18,
            fontWeight: 700,
            color: color || "#fff",
            letterSpacing: -0.3,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {suffix && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)" }}>{suffix}</span>}
      </div>
    </div>
  );
}

function JumpCard({ node, sub, onClick }: { node: SankeyNode; sub?: string; onClick: () => void }) {
  const isAgent = node.type === "agent";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 11,
        border: "none",
        background: "rgba(255,255,255,0.04)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "all 160ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(196,181,253,0.10)";
        e.currentTarget.style.boxShadow = "inset 0 0 0 0.5px rgba(196,181,253,0.30)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        e.currentTarget.style.boxShadow = "inset 0 0 0 0.5px rgba(255,255,255,0.08)";
      }}
    >
      {isAgent && node.meta?.agentId ? (
        <WAIBadge id={node.meta.agentId} size={36} radius={9} />
      ) : (
        <span style={{ fontSize: 20 }}>
          {({ kb: "📚", memory: "🧠", meeting: "📅" } as Record<string, string>)[node.type] || ""}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 700,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name.replace(/^[📚🧠📅🧑]\s*/u, "")}
        </div>
        {sub && (
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{sub}</div>
        )}
      </div>
      <span style={{ fontSize: 12, color: "#C4B5FD", fontWeight: 600, flexShrink: 0 }}>跳转 →</span>
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        fontSize: 12.5,
        color: "rgba(255,255,255,0.40)",
        background: "rgba(255,255,255,0.02)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.05)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const meetCardBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(255,153,182,0.06)",
  border: "none",
  boxShadow: "inset 0 0 0 0.5px rgba(255,153,182,0.22)",
  cursor: "pointer",
  fontFamily: "inherit",
  display: "block",
  marginBottom: 8,
  transition: "all 160ms ease",
};

const agentSubItemBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "8px 11px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  border: "none",
  boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 140ms ease",
};

function QuickLink({ icon, label }: { icon: "search" | "link" | "book" | "users"; label: string }) {
  return (
    <a
      href="#"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 10px",
        borderRadius: 7,
        background: "transparent",
        textDecoration: "none",
        color: "rgba(255,255,255,0.80)",
        fontSize: 13,
        transition: "background 140ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <WIcon name={icon} size={14} color="rgba(255,255,255,0.65)" stroke={1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      <WIcon name="arr-r" size={12} color="rgba(255,255,255,0.40)" stroke={2} />
    </a>
  );
}

// ─────────── MEMORY ───────────
function MemoryDetail({ node, data, onJump }: { node: SankeyNode; data: SankeyData; onJump: (n: SankeyNode) => void }) {
  const m = node.meta || {};
  const ownerLink = data.links.find((l) => l.target === node.name);
  const ownerNode = ownerLink ? data.nodes.find((n) => n.name === ownerLink.source) : null;
  const meetings = data.links
    .filter((l) => l.source === node.name)
    .map((l) => data.nodes.find((n) => n.name === l.target))
    .filter((n): n is SankeyNode => !!n && n.type === "meeting");

  const meetingContexts: Record<string, string> = {
    "📅 Q3 路线图对齐": '会议中讨论"协作功能延后到 Q4"时,Stratos 引用了此条记忆,作为「每多一条主线 ETA 滑 18%」结论的历史依据。',
    "📅 A/B 复盘 #4": "会议中讨论灰度策略时被引用,作为统计显著性判定基线。",
    "📅 Q1 投诉复盘": '会议开头快速建立分析框架时引用,直接指向"单栋 × 单分类"分析路径。',
    "📅 数据合规风评": "Lex 在评估业主信息处理合规性时引用,作为跨部门协作的程序前提。",
    "📅 维修资金审议": "法老张确认动用合规性时引用,作为 2/3 同意法定要件的判定依据。",
    "📅 客户体验例会": "服务赵姐讨论增值服务到期纠纷处理时直接套用此结论。",
    "📅 财务建模会": "Tally 评估服务定价模型时引用,作为客户体验影响因子。",
    "📅 法规更新会": "讨论跨部门法规对齐机制时,被作为标准流程依据反复引用。",
  };

  return (
    <>
      <SectionLabel color="#A78BFA">完整记忆</SectionLabel>
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 10,
          marginBottom: 14,
          background: "rgba(167,139,250,0.10)",
          boxShadow: "inset 0 0 0 0.5px rgba(167,139,250,0.30), inset 3px 0 0 #A78BFA",
          fontSize: 15,
          color: "#fff",
          lineHeight: 1.65,
        }}
      >
        "{m.text || node.name.replace(/^🧠\s*/u, "")}"
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
        <MetaCard label="被引用" value={m.cited ?? "—"} color="#C4B5FD" suffix="次" />
        <MetaCard label="入库" value={m.when || "初始化"} small />
        <MetaCard
          label="重要度"
          value={(m.cited ?? 0) >= 10 ? "高" : (m.cited ?? 0) >= 5 ? "中" : "一般"}
          color={(m.cited ?? 0) >= 10 ? "#FCD34D" : "#86EFAC"}
        />
      </div>

      {ownerNode && (
        <>
          <SectionLabel color="#C4B5FD">归属 AI 专家</SectionLabel>
          <JumpCard node={ownerNode} sub="由这位专家沉淀" onClick={() => onJump(ownerNode)} />
        </>
      )}

      {m.source && m.source !== "种子" && (
        <>
          <SectionLabel color="#FF99B6" mt={18}>
            沉淀来源
          </SectionLabel>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(255,153,182,0.08)",
              boxShadow: "inset 0 0 0 0.5px rgba(255,153,182,0.25)",
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 14 }}>📅</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: "#fff" }}>{m.source}</span>
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "rgba(255,255,255,0.65)",
                marginTop: 5,
                lineHeight: 1.5,
              }}
            >
              这条记忆在 <strong style={{ color: "#fff" }}>{m.when}</strong> 的会议结束时被 AI 自动提取并审入长期记忆库。
            </div>
          </div>
        </>
      )}

      {meetings.length > 0 && (
        <>
          <SectionLabel color="#FF99B6" mt={18}>
            被引用于 · {meetings.length} 场会议
          </SectionLabel>
          {meetings.map((meet) => (
            <button key={meet.name} type="button" onClick={() => onJump(meet)} style={meetCardBtn}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>📅</span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#fff",
                    flex: 1,
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {meet.name.replace(/^📅\s*/u, "")}
                </span>
                <span style={{ fontSize: 11, color: "#FF99B6", fontWeight: 600, flexShrink: 0 }}>跳转 →</span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "rgba(255,255,255,0.70)",
                  lineHeight: 1.55,
                  textAlign: "left",
                  paddingLeft: 21,
                }}
              >
                {meetingContexts[meet.name] || "该记忆在此会议中被 AI 引用,用于辅助决策"}
              </div>
            </button>
          ))}
        </>
      )}
    </>
  );
}

// ─────────── KB ───────────
function KBDetail({ node, data, onJump }: { node: SankeyNode; data: SankeyData; onJump: (n: SankeyNode) => void }) {
  const k = node.meta || {};
  const ownerLink = data.links.find((l) => l.source === node.name);
  const ownerNode = ownerLink ? data.nodes.find((n) => n.name === ownerLink.target) : null;
  const cited = k.cited || 0;

  // mock 3 段向量分块 (后续 /api/kb/:id/chunks)
  const chunks = [
    { id: 1, page: 3, preview: "…在延迟不超过 1.5 秒的服务承诺下,B 组模型增加的 320 毫秒仍在可接受范围内,因此…", sim: 0.91 },
    { id: 2, page: 7, preview: "…样本量不足 1000 人时,建议采用 t 检验而非 z 检验;显著性 P 值需小于 0.05 才能作为判定依据…", sim: 0.86 },
    { id: 3, page: 12, preview: "…增长实验平均有 70% 会失败,因此在投入前明确「何时停止」与「如何回滚」是必要纪律…", sim: 0.79 },
  ];

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 18 }}>
        <MetaCard label="页数" value={k.pages ?? "—"} suffix="页" />
        <MetaCard label="分块数" value={k.chunks ?? "—"} color="#7DDEFF" />
        <MetaCard label="被引用" value={cited} color="#FCD34D" suffix="次" />
        <MetaCard label="更新" value={k.updated || "—"} small />
      </div>

      {ownerNode && (
        <>
          <SectionLabel color="#C4B5FD">挂载 AI 专家</SectionLabel>
          <JumpCard node={ownerNode} sub="此文档在该专家的书架上" onClick={() => onJump(ownerNode)} />
        </>
      )}

      <SectionLabel color="#7DDEFF" mt={18}>
        向量分块 · 预览前 3 段
      </SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {chunks.map((c) => (
          <div
            key={c.id}
            style={{
              padding: "10px 12px",
              borderRadius: 9,
              background: "rgba(125,222,255,0.06)",
              boxShadow: "inset 0 0 0 0.5px rgba(125,222,255,0.22)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 5,
                fontSize: 11,
              }}
            >
              <span
                style={{
                  color: "#7DDEFF",
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(125,222,255,0.14)",
                }}
              >
                分块 {c.id}
              </span>
              <span style={{ color: "rgba(255,255,255,0.50)" }}>第 {c.page} 页</span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "#86EFAC",
                  fontFamily: "ui-monospace, monospace",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                相似度 {c.sim}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.55 }}>{c.preview}</div>
          </div>
        ))}
      </div>

      <SectionLabel mt={18}>快速操作</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <QuickLink icon="book" label="打开原始文档" />
        <QuickLink icon="search" label="在本书架中检索" />
        <QuickLink icon="link" label="查看引用过本书的记忆" />
      </div>
    </>
  );
}

// ─────────── AGENT ───────────
function AgentDetail({ node, data, onJump }: { node: SankeyNode; data: SankeyData; onJump: (n: SankeyNode) => void }) {
  const agentId = node.meta?.agentId;
  const agent = agentId ? W_AGENTS.find((a) => a.id === agentId) : null;
  const kbs = data.links
    .filter((l) => l.target === node.name)
    .map((l) => data.nodes.find((n) => n.name === l.source))
    .filter((n): n is SankeyNode => !!n && n.type === "kb");
  const mems = data.links
    .filter((l) => l.source === node.name)
    .map((l) => data.nodes.find((n) => n.name === l.target))
    .filter((n): n is SankeyNode => !!n && n.type === "memory");

  return (
    <>
      {agent && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
            <WAIBadge id={agentId!} size={52} radius={13} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.60)" }}>
                {agent.nick && agent.nick !== agent.name ? agent.nick + " · " : ""}
                {agent.domain}
              </div>
              <div
                style={{
                  marginTop: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#86EFAC",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#86EFAC",
                    boxShadow: "0 0 6px rgba(134,239,172,0.70)",
                  }}
                />
                启用 · {agent.sum} 次召唤
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              marginBottom: 16,
              background: "rgba(196,181,253,0.06)",
              boxShadow: "inset 0 0 0 0.5px rgba(196,181,253,0.20)",
              fontSize: 13.5,
              color: "rgba(255,255,255,0.90)",
              lineHeight: 1.6,
            }}
          >
            "{agent.intro}"
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 18 }}>
            {agent.tags.map((t) => (
              <span
                key={t}
                style={{
                  padding: "3px 9px",
                  borderRadius: 5,
                  fontSize: 12,
                  color: "#fff",
                  background: "rgba(255,255,255,0.08)",
                  boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.12)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </>
      )}

      <SectionLabel color="#7DDEFF">书架 · {kbs.length} 份文档</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {kbs.map((kb) => (
          <button key={kb.name} type="button" onClick={() => onJump(kb)} style={agentSubItemBtn}>
            <span style={{ fontSize: 13 }}>📚</span>
            <span
              style={{
                flex: 1,
                fontSize: 13.5,
                color: "#fff",
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {kb.name.replace(/^📚\s*/u, "")}
            </span>
            <span style={{ fontSize: 11, color: "#7DDEFF", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {kb.meta?.pages || "—"} 页 · {kb.meta?.chunks || "—"} 分块
            </span>
          </button>
        ))}
        {kbs.length === 0 && <EmptyHint>暂无挂载知识</EmptyHint>}
      </div>

      <SectionLabel color="#A78BFA">长期记忆 · {mems.length} 条经验</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {mems.map((mem) => (
          <button key={mem.name} type="button" onClick={() => onJump(mem)} style={agentSubItemBtn}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>🧠</span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: "rgba(255,255,255,0.90)",
                textAlign: "left",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {mem.meta?.text || mem.name.replace(/^🧠\s*/u, "")}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "#A78BFA",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {mem.meta?.cited || 0}↗
            </span>
          </button>
        ))}
        {mems.length === 0 && <EmptyHint>暂无沉淀记忆</EmptyHint>}
      </div>
    </>
  );
}

// ─────────── MEETING ───────────
function MeetingDetail({ node, data, onJump }: { node: SankeyNode; data: SankeyData; onJump: (n: SankeyNode) => void }) {
  const cited = data.links
    .filter((l) => l.target === node.name)
    .map((l) => data.nodes.find((n) => n.name === l.source))
    .filter((n): n is SankeyNode => !!n && n.type === "memory");

  return (
    <>
      <SectionLabel color="#FF99B6">会议引用了 · {cited.length} 条记忆</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {cited.map((mem) => (
          <button key={mem.name} type="button" onClick={() => onJump(mem)} style={agentSubItemBtn}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>🧠</span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: "rgba(255,255,255,0.88)",
                textAlign: "left",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {mem.meta?.text || mem.name.replace(/^🧠\s*/u, "")}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
