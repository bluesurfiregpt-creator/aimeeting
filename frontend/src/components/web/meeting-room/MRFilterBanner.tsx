"use client";

/**
 * R5.D Web 会议室 — 筛选 banner.
 *
 * 当 selected size > 0 时显在 transcript 区 top, 列出已选 chip + 命中/总条数 + 编辑/清除.
 *
 * 设计源: `meeting-room-web.jsx:1086-1124`.
 */

import { mrSpeakerLabel } from "./data";
import { MRSpeakerAvatar, MRIcon } from "./atoms";

export type MRFilterBannerProps = {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  matched: number;
  total: number;
  onOpen: () => void;
};

export function MRFilterBanner({
  selected,
  onChange,
  matched,
  total,
  onOpen,
}: MRFilterBannerProps) {
  if (selected.size === 0) return null;
  const keys = [...selected];
  const remove = (k: string) => {
    const n = new Set(selected);
    n.delete(k);
    onChange(n);
  };
  return (
    <div
      style={{
        background: "rgba(0,122,255,0.06)",
        borderBottom: "0.5px solid rgba(0,122,255,0.20)",
        padding: "9px 28px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <MRIcon name="filter" size={14} color="#007AFF" />
      <div style={{ fontSize: 12, fontWeight: 600, color: "#007AFF" }}>仅显示</div>
      <div style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => remove(k)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "#fff",
              border: "0.5px solid rgba(0,122,255,0.30)",
              borderRadius: 14,
              padding: "2px 10px 2px 3px",
              fontSize: 12,
              color: "#1C1C1E",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <MRSpeakerAvatar k={k} size={20} />
            {mrSpeakerLabel(k)}
            <MRIcon name="close" size={11} color="#8E8E93" />
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#8E8E93" }}>
        {matched}/{total} 条
      </div>
      <button
        type="button"
        onClick={() => onChange(new Set())}
        style={{
          background: "none",
          border: "none",
          color: "#007AFF",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        清除
      </button>
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: "none",
          border: "none",
          color: "#007AFF",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        编辑
      </button>
    </div>
  );
}
