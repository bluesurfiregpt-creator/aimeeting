"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料 上传 transcript inline 事件.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:897-931 `MaterialUploadedEvent`.
 *
 * 用于 会中 上传 完成后 在 transcript 流里 塞 一行 (7px 高的 细条) 提示:
 *   📄 王俊 上传了《xxx.xlsx》· 已对全员开放  [查看]
 *
 * 不打断 transcript, 不弹通知. 该组件 暂未 接入 transcript view (round-4 — 接
 * MeetingTranscriptView 把它 dispatch 到对应 转录条 下方).
 *
 * R4: 当前 在 transcript 下方 整体 单独 渲染一段 "刚上传 的事件" — 临时方案.
 */

import type { ReactElement } from "react";

import { MR_COLORS } from "../styles";

import FileGlyph, { FILE_TYPES } from "./FileGlyph";
import type { Material } from "./types";

type Props = {
  file: Material;
  onView: () => void;
};

export default function MaterialUploadedEvent({
  file,
  onView,
}: Props): ReactElement {
  const meta = FILE_TYPES[file.type] || FILE_TYPES.other;
  return (
    <div style={{ padding: "4px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 10px",
          background: MR_COLORS.bgWhite,
          borderLeft: `2px solid ${meta.color}`,
          borderRadius: "0 10px 10px 0",
          boxShadow: `0 0 0 0.5px ${MR_COLORS.hairline}`,
        }}
      >
        <FileGlyph type={file.type} size={22} ring="transparent" />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: MR_COLORS.textSecondary,
            lineHeight: 1.4,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            {file.uploaderName}
          </span>
          <span> 上传了 </span>
          <span
            style={{
              fontWeight: 500,
              color: MR_COLORS.textPrimary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "inline-block",
              maxWidth: 160,
              verticalAlign: "bottom",
            }}
          >
            《{file.name}》
          </span>
          <span style={{ color: MR_COLORS.textTertiary }}>
            {" "}
            · 已对全员开放
          </span>
        </div>
        <button
          type="button"
          onClick={onView}
          style={{
            background: "none",
            border: "none",
            color: MR_COLORS.systemBlue,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            padding: "0 4px",
            flexShrink: 0,
          }}
        >
          查看
        </button>
      </div>
    </div>
  );
}
