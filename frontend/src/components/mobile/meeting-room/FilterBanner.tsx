"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · 筛选激活 sticky banner.
 *
 * 设计源 1:1: meeting-room.jsx:1037-1086 (FilterBanner).
 *
 *  - filter 激活时 sticky 在 transcript 顶部
 *  - 显: filter icon + "仅显示" + chip 列 (头像 + 名字 + ×) + matched/total + 清除
 *  - 点 chip 的 × 移除单个
 *  - 点 "清除" 清空
 */

import type { ReactElement } from "react";

import { MRAIAvatar, MRHostAvatar, MRHumanAvatar } from "./avatars";
import type { FilterSpeaker } from "./FilterSheet";
import MRIcon from "./MRIcon";
import { MR_COLORS } from "./styles";

type Props = {
  selected: Set<string>;
  /** 父级用 key 解析回 speaker (key → FilterSpeaker map) */
  speakerByKey: Map<string, FilterSpeaker>;
  matched: number;
  total: number;
  onChange: (next: Set<string>) => void;
  onOpen: () => void;
};

export default function FilterBanner({
  selected,
  speakerByKey,
  matched,
  total,
  onChange,
  onOpen,
}: Props): ReactElement | null {
  if (selected.size === 0) return null;
  const keys = [...selected];
  const remove = (k: string) => {
    const next = new Set(selected);
    next.delete(k);
    onChange(next);
  };
  const clear = () => onChange(new Set());

  return (
    <div
      data-testid="mobile-filter-banner"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        background: "rgba(0,122,255,0.08)",
        borderBottom: "0.5px solid rgba(0,122,255,0.20)",
        padding: "8px 12px 8px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="打开筛选"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: MR_COLORS.systemBlue,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
        }}
      >
        <MRIcon name="filter" size={14} color={MR_COLORS.systemBlue} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: MR_COLORS.systemBlue,
          }}
        >
          仅显示
        </span>
      </button>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          gap: 5,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {keys.map((k) => {
          const sp = speakerByKey.get(k);
          if (!sp) return null;
          let avatar: ReactElement | null;
          if (sp.kind === "host") avatar = <MRHostAvatar size={18} />;
          else if (sp.kind === "ai")
            avatar = (
              <MRAIAvatar
                agentColor={sp.agentColor}
                grad={sp.grad}
                size={18}
              />
            );
          else
            avatar = (
              <MRHumanAvatar
                name={sp.name}
                color={sp.color || "#5E5CE6"}
                size={18}
              />
            );
          return (
            <button
              type="button"
              key={k}
              onClick={() => remove(k)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: MR_COLORS.bgWhite,
                border: "0.5px solid rgba(0,122,255,0.30)",
                borderRadius: 12,
                padding: "2px 8px 2px 3px",
                fontSize: 12,
                fontWeight: 500,
                color: MR_COLORS.textPrimary,
                fontFamily: "inherit",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {avatar}
              {sp.name}
              <MRIcon name="close" size={10} color={MR_COLORS.textTertiary} />
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 11,
          color: MR_COLORS.textTertiary,
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {matched}/{total}
      </div>
      <button
        type="button"
        onClick={clear}
        style={{
          background: "none",
          border: "none",
          color: MR_COLORS.systemBlue,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          padding: "0 2px",
          flexShrink: 0,
        }}
      >
        清除
      </button>
    </div>
  );
}
