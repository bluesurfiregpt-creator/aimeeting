"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 文件 折角 glyph.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:54-99 `FileGlyph`.
 *
 * 4 种 类型 + 真实色 (Adobe 红 / Word 蓝 / Excel 绿 / PPT 橙). 用 SVG 折角文档形状,
 * 中间 写 PDF/W/X/P 字母 + 白色 阴影. 仅 视觉装饰 — 不承载交互.
 *
 * 跟 backend `MeetingAttachmentOut.extension` 映射: 见 `mapExtensionToType`.
 */

import type { ReactElement } from "react";

import { MR_COLORS } from "../styles";

export type MaterialType = "pdf" | "word" | "excel" | "ppt" | "other";

export const FILE_TYPES: Record<
  MaterialType,
  { short: string; label: string; color: string; accent: string }
> = {
  pdf: { short: "PDF", label: "PDF", color: "#E5453A", accent: "#FCE9E7" },
  word: { short: "W", label: "Word", color: "#2B579A", accent: "#E7EDF6" },
  excel: { short: "X", label: "Excel", color: "#1F7244", accent: "#E1F0E8" },
  ppt: { short: "P", label: "PPT", color: "#D24726", accent: "#FBE7E0" },
  // 兜底 — 用 iOS 灰阶 (设计稿无此类型, 但 backend 接受 txt/md/csv/jpg 等)
  other: { short: "•", label: "文件", color: "#8E8E93", accent: "#F2F2F7" },
};

/** backend MeetingAttachmentOut.extension → 设计稿 4 类 (其他 fallback "other"). */
export function mapExtensionToType(
  ext: string | null | undefined,
): MaterialType {
  if (!ext) return "other";
  const lower = ext.toLowerCase().replace(/^\./, "");
  if (lower === "pdf") return "pdf";
  if (lower === "doc" || lower === "docx") return "word";
  if (lower === "xls" || lower === "xlsx" || lower === "csv") return "excel";
  if (lower === "ppt" || lower === "pptx") return "ppt";
  return "other";
}

export type FileGlyphProps = {
  type: MaterialType;
  size?: number;
  /** 右上 红色 "新" 角标 (会中刚上传的文件). */
  isNew?: boolean;
  /** 描边色; 'transparent' = 无描边. */
  ring?: string;
};

export default function FileGlyph({
  type,
  size = 28,
  isNew = false,
  ring = MR_COLORS.bgWhite,
}: FileGlyphProps): ReactElement {
  const meta = FILE_TYPES[type] || FILE_TYPES.other;
  const w = size;
  const h = size;
  // 唯一 id — 多个 glyph 同 type 同 page 时 避免 gradient id 冲突
  const gid = `fg-${type}-${size}`;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        flexShrink: 0,
      }}
    >
      <svg
        width={w}
        height={h}
        viewBox="0 0 32 32"
        style={{ display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.color} stopOpacity="1" />
            <stop offset="100%" stopColor={meta.color} stopOpacity="0.86" />
          </linearGradient>
        </defs>
        {/* doc body */}
        <path
          d="M6 2 H19 L26 9 V28 a2 2 0 0 1 -2 2 H6 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 z"
          fill={`url(#${gid})`}
        />
        {/* folded corner — 浅高光 */}
        <path
          d="M19 2 V8 a1 1 0 0 0 1 1 H26 L19 2 z"
          fill="rgba(255,255,255,0.32)"
        />
        <path
          d="M19 2 V8 a1 1 0 0 0 1 1 H26"
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth="0.5"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: size * 0.13,
          textAlign: "center",
          color: "#fff",
          fontWeight: 800,
          fontSize: size * (meta.short.length > 1 ? 0.26 : 0.34),
          letterSpacing: 0.3,
          textShadow: "0 0.5px 0 rgba(0,0,0,0.15)",
          lineHeight: 1,
        }}
      >
        {meta.short}
      </div>
      {ring && ring !== "transparent" ? (
        <span
          style={{
            position: "absolute",
            inset: -1,
            borderRadius: 4,
            boxShadow: `0 0 0 1.5px ${ring}`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {isNew ? (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: MR_COLORS.systemRed,
            boxShadow: `0 0 0 1.5px ${MR_COLORS.bgWhite}`,
          }}
        />
      ) : null}
    </div>
  );
}
