"use client";

/**
 * v1.4.0 · Saga O (Phase 1 W3) · Mobile App v2 · MMemoryRadar.
 *
 * 记忆地图 雷达 hero — 紫深色卡 + SVG 雷达 + 6 轴 label + 底部 2 数据 chip.
 *
 * 设计源 1:1:
 *   - /tmp/aimeeting-design-research/aimeeting/project/mobile-screens.jsx:354-599 (MemoryRadar)
 *   - /tmp/aimeeting-design-research/design-shots/memory.png (本 Saga 灵魂)
 *
 * 视觉锚:
 *   - 紫深色卡 #1C1C1E + 顶部 radial-gradient overlay rgba(94,92,230,0.20)
 *   - 圆角 18, padding 14×16
 *   - 顶部小 label "AI · 记忆地图 · {total_memories} 条 · 覆盖 {total_axes_covered} 个领域"
 *   - 中间 SVG 雷达 (size 280×260):
 *     - 6 顶点, angle = -90° + i*60° (上为顶)
 *     - 三层 grid hexagon (33% / 66% / 100%) — stroke rgba(255,255,255,0.12) dashed "2 3"
 *     - 你的形状 (my_values): polygon fill rgba(122,90,240,0.50) + stroke #7A5AF0 width 1.5
 *     - 团队形状 (team_values): polygon fill none + stroke rgba(255,255,255,0.40) dashed "4 2"
 *   - 6 个轴 label (text-anchor 自适应, font-size 11.5, fill white 0.80 opacity)
 *   - 底部 2 个数据 chip (axis_metrics 前 2 个): 圆角 8, bg rgba(255,255,255,0.08)
 *
 * autoCollapse: useEffect setTimeout(2800ms) setExpanded(false) (默认).
 *   用户手动展开 / 收起 后, 不再 autoCollapse.
 *   收起态: 单行 "AI · 记忆地图 · 100 条 · 覆盖 6 个领域" + 右侧 "展开 ⌃" 按钮.
 *   maxHeight 转场 300ms ease.
 *
 * Note: bg-[#1C1C1E] / 类似紫深色 是 合法的紫 hero 视觉, 不是 dark mode token —
 * Memory radar 是设计稿要求的 唯一深紫色 hero, 跟 design system "浅色 iOS"
 * 单 theme 守门兼容 (深紫色 hero 在 浅色背景上, 视觉强调用).
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import MAIcon from "./MAIcon";
import type { V2RadarData } from "./types";

// ─────── 几何 helpers ───────

const SVG_W = 280;
const SVG_H = 240;
const CENTER_X = SVG_W / 2;
const CENTER_Y = SVG_H / 2 + 4; // 略下移给上方 label 留空
const RADIUS = 80;
const N_AXES = 6;

/** axisIndex (0..5) → angle in radians, -90° + i*60° (上为顶). */
function axisAngle(i: number): number {
  return (-90 + i * 60) * (Math.PI / 180);
}

/** value (0..max) → 在轴上对应 vertex 坐标. */
function vertex(value: number, axisIndex: number, max: number): {
  x: number;
  y: number;
} {
  const norm = max > 0 ? Math.min(value, max) / max : 0;
  const a = axisAngle(axisIndex);
  return {
    x: CENTER_X + Math.cos(a) * RADIUS * norm,
    y: CENTER_Y + Math.sin(a) * RADIUS * norm,
  };
}

/** values[6] → polygon points string. */
function polygonPoints(values: number[], max: number): string {
  return values
    .map((v, i) => {
      const p = vertex(v, i, max);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");
}

/** label 位置 — 半径 RADIUS + 18, text-anchor 按 cos 自适应. */
function labelPosition(i: number): {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
} {
  const a = axisAngle(i);
  const labelR = RADIUS + 18;
  const x = CENTER_X + Math.cos(a) * labelR;
  const y = CENTER_Y + Math.sin(a) * labelR;
  const cos = Math.cos(a);
  const anchor: "start" | "middle" | "end" =
    cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
  return { x, y, anchor };
}

// ─────── Component ───────

type Props = {
  data: V2RadarData;
  /** 默认 2800ms 后 autoCollapse, 0 不 autoCollapse. */
  autoCollapseAfter?: number;
};

export default function MMemoryRadar({
  data,
  autoCollapseAfter = 2800,
}: Props): ReactElement {
  const [expanded, setExpanded] = useState<boolean>(true);
  // 用户手动 toggle 过 一次 后 不再 auto.
  const userToggled = useRef<boolean>(false);

  useEffect(() => {
    if (autoCollapseAfter <= 0) return;
    const t = setTimeout(() => {
      if (!userToggled.current) {
        setExpanded(false);
      }
    }, autoCollapseAfter);
    return () => clearTimeout(t);
  }, [autoCollapseAfter]);

  const toggle = (): void => {
    userToggled.current = true;
    setExpanded((v) => !v);
  };

  // 计算 max — 用 my + team 的最大值, 至少 8 (避免几何坍缩).
  const max = Math.max(
    8,
    ...data.my_values,
    ...data.team_values,
  );

  const myPoints = polygonPoints(data.my_values, max);
  const teamPoints = polygonPoints(data.team_values, max);

  // 3 层 grid hexagon (33% / 66% / 100%)
  const gridLevels = [0.33, 0.66, 1.0];
  const gridPolygons = gridLevels.map((level) =>
    Array.from({ length: N_AXES }, (_, i) => {
      const a = axisAngle(i);
      const x = CENTER_X + Math.cos(a) * RADIUS * level;
      const y = CENTER_Y + Math.sin(a) * RADIUS * level;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" "),
  );

  // 底部 chip — 前 2 个 axis_metric
  const chips = data.axis_metrics.slice(0, 2);

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 18,
        background: "#1C1C1E",
        padding: "16px 16px 18px",
        boxShadow:
          "0 8px 28px rgba(94,92,230,0.32), 0 0 0 0.5px rgba(255,255,255,0.06)",
      }}
      data-testid="m-memory-radar"
    >
      {/* 顶部 紫光晕 radial-gradient overlay */}
      <div
        style={{
          position: "absolute",
          top: -60,
          right: -40,
          width: 220,
          height: 220,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(94,92,230,0.20) 0%, rgba(0,0,0,0) 65%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -70,
          left: -40,
          width: 200,
          height: 200,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(175,82,222,0.18) 0%, rgba(0,0,0,0) 70%)",
          pointerEvents: "none",
        }}
      />

      {/* header — eyebrow + 总计 + toggle 按钮 */}
      <div
        onClick={toggle}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 9,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "rgba(255,255,255,0.14)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
            flexShrink: 0,
          }}
        >
          <MAIcon name="sparkle" size={15} color="#fff" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.70)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            AI · 记忆地图
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              marginTop: 1,
              letterSpacing: 0.1,
            }}
          >
            {data.total_memories} 条 · 覆盖 {data.total_axes_covered} 个领域
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-label={expanded ? "收起" : "展开"}
          style={{
            background: "rgba(255,255,255,0.10)",
            border: "none",
            borderRadius: 8,
            padding: "5px 10px",
            color: "#fff",
            fontSize: 11.5,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)",
          }}
        >
          {expanded ? "收起" : "展开"}
          <span
            style={{
              display: "inline-flex",
              transform: expanded ? "rotate(180deg)" : "rotate(0)",
              transition: "transform 220ms ease",
            }}
          >
            <MAIcon name="chev-down" size={11} color="#fff" strokeWidth={2.4} />
          </span>
        </button>
      </div>

      {/* collapsible body — maxHeight 转场 */}
      <div
        style={{
          position: "relative",
          maxHeight: expanded ? 480 : 0,
          opacity: expanded ? 1 : 0,
          overflow: "hidden",
          transition:
            "max-height 300ms ease, opacity 220ms ease 40ms",
        }}
      >
        {/* SVG 雷达 */}
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ width: "100%", display: "block", marginTop: 10 }}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="m-radar-fill" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#A5A3F0" stopOpacity="0.75" />
              <stop offset="60%" stopColor="#7A5AF0" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#5E5CE6" stopOpacity="0.30" />
            </radialGradient>
          </defs>

          {/* 3 层 grid hexagon (33% / 66% / 100%), dashed */}
          {gridPolygons.map((pts, i) => (
            <polygon
              key={i}
              points={pts}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ))}

          {/* spokes 6 条 */}
          {Array.from({ length: N_AXES }, (_, i) => {
            const a = axisAngle(i);
            const x2 = CENTER_X + Math.cos(a) * RADIUS;
            const y2 = CENTER_Y + Math.sin(a) * RADIUS;
            return (
              <line
                key={i}
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x2}
                y2={y2}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={0.8}
              />
            );
          })}

          {/* team 形状 (虚线, 在底) */}
          <polygon
            points={teamPoints}
            fill="none"
            stroke="rgba(255,255,255,0.40)"
            strokeWidth={1.2}
            strokeDasharray="4 2"
          />

          {/* my 形状 (实) — 紫渐变填 + 紫实描边 */}
          <polygon
            points={myPoints}
            fill="rgba(122,90,240,0.50)"
            stroke="#7A5AF0"
            strokeWidth={1.5}
          />

          {/* my 顶点 dot */}
          {data.my_values.map((v, i) => {
            const p = vertex(v, i, max);
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" opacity={0.95} />
                <circle cx={p.x} cy={p.y} r={2} fill="#7A5AF0" />
              </g>
            );
          })}

          {/* axis labels — 6 个 */}
          {data.axes.map((label, i) => {
            const pos = labelPosition(i);
            return (
              <text
                key={i}
                x={pos.x}
                y={pos.y}
                textAnchor={pos.anchor}
                dominantBaseline="middle"
                fontSize="11.5"
                fontWeight="600"
                fill="rgba(255,255,255,0.80)"
              >
                {label}
              </text>
            );
          })}
        </svg>

        {/* 底部 2 chip — axis_metrics 前 2 个 */}
        {chips.length > 0 ? (
          <div
            style={{
              position: "relative",
              marginTop: 12,
              display: "flex",
              gap: 8,
            }}
          >
            {chips.map((c, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.08)",
                  boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.10)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.60)",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  {i === 0 ? "你最强" : "可补充"}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#fff",
                    marginTop: 2,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
