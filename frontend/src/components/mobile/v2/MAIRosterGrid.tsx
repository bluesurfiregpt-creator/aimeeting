"use client";

/**
 * v1.4.0 · Saga P-1 · AI 阵容网格 (M7 新建会议 — 选 / 反选 AI 参会者).
 *
 * 视觉: 3-列 grid (>= 360px 容器), 每格 ~90×104:
 *   - 顶部 MAIBadge size=40
 *   - 名字 13px weight 500
 *   - role_short (用 reasons[id] 替代) 10.5px 灰
 *   - 选中态: 紫色描边 #5E5CE6 + 右上角对勾 + 半透紫底
 *   - 未选: 灰描边 #E5E5EA
 *
 * 用法:
 *   const [picked, setPicked] = useState(new Set(['ai1','ai2']))
 *   <MAIRosterGrid
 *     candidates={badges}
 *     selected={picked}
 *     onToggle={(id) => {
 *       const next = new Set(picked)
 *       next.has(id) ? next.delete(id) : next.add(id)
 *       setPicked(next)
 *     }}
 *     reasons={{ ai1: '合规审查', ai2: '搜索体验' }}
 *   />
 */

import type { CSSProperties, ReactElement } from "react";
import MAIBadge from "./MAIBadge";
import type { V2AIBadge } from "./types";

type Props = {
  candidates: V2AIBadge[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** id → 副标 (e.g. "合规审查") — 已选的 才显示, 未选 fallback 到候选自带 role_short. */
  reasons?: Record<string, string>;
  /** 列数. 默认 3. */
  columns?: number;
};

export default function MAIRosterGrid({
  candidates,
  selected,
  onToggle,
  reasons = {},
  columns = 3,
}: Props): ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 10,
      }}
    >
      {candidates.map((ai) => {
        const picked = selected.has(ai.id);
        const reason = reasons[ai.id];
        return (
          <button
            key={ai.id}
            type="button"
            onClick={() => onToggle(ai.id)}
            style={
              {
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "12px 6px 10px",
                borderRadius: 14,
                background: picked ? "rgba(94,92,230,0.08)" : "#FFFFFF",
                border: picked
                  ? "1.5px solid #5E5CE6"
                  : "0.5px solid rgba(60,60,67,0.18)",
                cursor: "pointer",
                transition: "border 160ms ease, background 160ms ease",
                minHeight: 104,
                textAlign: "center",
                font: "inherit",
              } as CSSProperties
            }
            aria-pressed={picked}
            aria-label={`${ai.name}${picked ? " 已选" : ""}`}
          >
            <MAIBadge
              name={ai.name}
              glyph={ai.glyph}
              gradient_from={ai.gradient_from}
              gradient_to={ai.gradient_to}
              size={40}
              ring="transparent"
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#000",
                lineHeight: 1.2,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {ai.name}
            </span>
            {reason ? (
              <span
                style={{
                  fontSize: 10.5,
                  color: picked ? "#5E5CE6" : "rgba(60,60,67,0.55)",
                  lineHeight: 1.2,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: picked ? 500 : 400,
                }}
              >
                {reason}
              </span>
            ) : null}

            {/* 选中角标 — 右上角对勾 */}
            {picked ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: "#5E5CE6",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
