"use client";

/**
 * v27.0-mobile · SegmentControl — iOS pill 风格切换器.
 *
 * 替代之前的折叠分组 (▾). 移动端原生该这样切状态:
 *   ┌──────────────────────────────┐
 *   │ [Tab1(N)] [Tab2(N)] [Tab3]   │
 *   └──────────────────────────────┘
 * 一次屏只看当前 tab 下的内容.
 *
 * 设计要点:
 *   - 整体是 rounded pill 容器 (bg-ink-900/60)
 *   - 当前 tab inner pill: bg-zinc-700 + zinc-50 字 (跟 iOS 一致, 不要太抢)
 *   - 其他 tab: 透明 + zinc-400 字
 *   - count 用括号 (N) 紧贴 label, 不另起 chip
 *   - 高度 36-40px, body 14-15px
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
      className={`inline-flex w-full rounded-xl bg-ink-900/60 p-1 ${className}`}
      data-testid="mobile-segment"
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
            className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-[14px] transition active:scale-[0.97] ${
              active
                ? "bg-zinc-700 font-medium text-zinc-50 shadow-sm"
                : "text-zinc-400 active:text-zinc-200"
            }`}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && item.count > 0 ? (
              <span
                className={`text-[12px] ${
                  active ? "text-zinc-300" : "text-zinc-500"
                }`}
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
