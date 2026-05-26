"use client";

/**
 * v1.4.0 · Saga M1 · iOS 胶囊 segmented control atom (v2).
 *
 * 设计源 1:1: /tmp/aimeeting-design-research/aimeeting/project/mobile-shared.jsx:446-478 (MASegmented).
 *
 * 灰底 (#E5E5EA) + 内白 thumb (active 段) + tabular 数字 count.
 * 跟 v1 SegmentControl.tsx 区别:
 *   - v2 在 padding/radius/字号 上 1:1 跟设计稿: bg #E5E5EA, radius 9, padding 3,
 *     active 段 radius 7, thumb shadow "0 1px 2px + 0 3px 8px"
 *   - v2 tabs 接 string[] 而非泛型 — 简化 (设计场景固定字符串 id)
 *
 * 与 v1 不冲突 (路径不同), Saga M3 meetings page 用 v2.
 */

import type { ReactElement } from "react";

export type V2SegmentedTab = {
  /** 唯一 id */
  id: string;
  label: string;
  /** 可选 count (tabular-nums 显示) */
  count?: number;
};

type Props = {
  tabs: V2SegmentedTab[];
  /** 当前 active 的 tab.id */
  active: string;
  onChange: (id: string) => void;
};

export default function MASegmented({
  tabs,
  active,
  onChange,
}: Props): ReactElement {
  return (
    <div
      style={{
        background: "#E5E5EA",
        borderRadius: 9,
        padding: 3,
        display: "flex",
        gap: 2,
      }}
    >
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 7,
              border: "none",
              background: on ? "#fff" : "transparent",
              color: on ? "#1C1C1E" : "#3C3C43",
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: on
                ? "0 1px 2px rgba(0,0,0,0.08), 0 3px 8px rgba(0,0,0,0.04)"
                : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              transition: "background 140ms ease",
            }}
          >
            <span>{t.label}</span>
            {t.count !== undefined ? (
              <span
                style={{
                  fontSize: 11,
                  color: "#8E8E93",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
