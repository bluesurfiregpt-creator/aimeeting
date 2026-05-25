"use client";

/**
 * v1.3.0 · Saga · mobile-app-r4-A · SegmentControl · iOS 系统 segmented 浅色.
 *
 * 设计源 1:1: /tmp/claude-design-round4/aimeeting/project/mobile-shared.jsx:446-478
 * (MASegmented)
 *
 * 改动 (vs v27.0):
 *   - 容器 bg-ink-900/60 dark pill → #E5E5EA (iOS systemGray4)
 *   - active inner pill: bg-zinc-700 → #fff + boxShadow (iOS 系统 segmented 阴影)
 *   - text: 15px → 13px, active 600 / inactive 500
 *   - height: h-10 (40px) → h-32px, radius: rounded-xl (12) → 9 + inner 7
 *   - count: 显式 number, 紧贴 label
 *   - 圆角更精细 (radius 7 inner / 9 outer)
 *
 * 保留:
 *   - 范型 T extends string + items API
 *   - role / aria-selected / data-testid
 */

export type SegmentItem<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

export default function SegmentControl<T extends string>({
  items,
  value,
  onChange,
  className = "",
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      data-testid="mobile-segment"
      className={`inline-flex w-full ${className}`}
      style={{
        background: "#E5E5EA",
        borderRadius: 9,
        padding: 3,
        gap: 2,
      }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.value)}
            className="flex-1 transition active:scale-[0.97]"
            style={{
              height: 32,
              borderRadius: 7,
              border: "none",
              background: active ? "#fff" : "transparent",
              color: active ? "#1C1C1E" : "#3C3C43",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: active
                ? "0 1px 2px rgba(0,0,0,0.08), 0 3px 8px rgba(0,0,0,0.04)"
                : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && item.count > 0 ? (
              <span
                style={{
                  fontSize: 11,
                  color: "#8E8E93",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
