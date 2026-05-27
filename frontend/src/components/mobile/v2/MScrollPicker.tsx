"use client";

/**
 * v1.4.0 · Saga P-1 · iOS 风滚轮 picker (M7 会议时长选择).
 *
 * 视觉: 中央高亮线 (0.5px hairline 蓝), 顶 / 底 mask gradient (白→透),
 *       每项 height 36px, scroll-snap-type y mandatory.
 *
 * 用法:
 *   <MScrollPicker
 *     items={[5, 10, 15, 20, 30, 45, 60, 90, 120]}
 *     value={30}
 *     onChange={(v) => setMin(v)}
 *     suffix="分钟"
 *   />
 *
 * 实现:
 *   - <div> 列表, 每项 36px, scroll-snap-align center
 *   - useEffect 初始化 scrollTop = (value index) * 36
 *   - onScroll 防抖 80ms 找最近 snap → onChange(items[i])
 *   - 顶/底 80px mask 渐变 + 中央两条 0.5px hairline (上下)
 */

import {
  useEffect,
  useRef,
  type ReactElement,
} from "react";

type Props = {
  items: number[];
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  /** 容器高度. 推荐 5 * 36 = 180 (中心一项 + 上下各 2 项可见). */
  height?: number;
};

const ITEM_H = 36;
// 容器高度默认 180 → 中心在 90px, 上下各空 72px (~2 items)
const DEFAULT_H = 180;

export default function MScrollPicker({
  items,
  value,
  onChange,
  suffix,
  height = DEFAULT_H,
}: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const debounce = useRef<number | null>(null);
  // 防止 onChange 触发后 自己再 scrollTo 导致循环 — 标记 "外部赋值中"
  const settingFromProp = useRef(false);

  const centerOffset = (height - ITEM_H) / 2;

  // value 变化 → 同步 scrollTop (外部受控)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.indexOf(value);
    if (idx < 0) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) < 1) return;
    settingFromProp.current = true;
    el.scrollTop = target;
    // 下一帧解除标记
    window.requestAnimationFrame(() => {
      settingFromProp.current = false;
    });
  }, [value, items]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (settingFromProp.current) return;
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const i = Math.round(el.scrollTop / ITEM_H);
      const safe = Math.max(0, Math.min(items.length - 1, i));
      const next = items[safe];
      if (next !== value) onChange(next);
    }, 80);
  };

  return (
    <div
      style={{
        position: "relative",
        height,
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Scroll container */}
      <div
        ref={ref}
        onScroll={handleScroll}
        style={{
          height: "100%",
          overflowY: "auto",
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
          // 让中心 item 真正贴中央 — 上下加 centerOffset padding
          paddingTop: centerOffset,
          paddingBottom: centerOffset,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
        className="m-scroll-picker-track"
      >
        {items.map((n) => (
          <div
            key={n}
            style={{
              height: ITEM_H,
              scrollSnapAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: n === value ? 600 : 400,
              color: n === value ? "#000" : "rgba(60,60,67,0.5)",
              transition: "color 160ms ease, font-weight 160ms ease",
            }}
          >
            {n}
            {suffix ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 14,
                  fontWeight: 400,
                  color: "rgba(60,60,67,0.6)",
                }}
              >
                {suffix}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Top mask gradient */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: centerOffset,
          background:
            "linear-gradient(to bottom, rgba(242,242,247,0.96) 0%, rgba(242,242,247,0) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Bottom mask gradient */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: centerOffset,
          background:
            "linear-gradient(to top, rgba(242,242,247,0.96) 0%, rgba(242,242,247,0) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Center highlight — 上下两条 0.5px hairline (iOS 蓝) */}
      <div
        style={{
          position: "absolute",
          top: centerOffset,
          left: 12,
          right: 12,
          height: 0,
          borderTop: "0.5px solid rgba(0,122,255,0.36)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: centerOffset + ITEM_H,
          left: 12,
          right: 12,
          height: 0,
          borderTop: "0.5px solid rgba(0,122,255,0.36)",
          pointerEvents: "none",
        }}
      />

      {/* 隐藏 webkit scrollbar */}
      <style>{`
        .m-scroll-picker-track::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
