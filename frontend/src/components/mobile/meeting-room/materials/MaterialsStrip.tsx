"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料 紧凑 strip.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:101-184 `MaterialsStrip`.
 *
 * 视觉:
 *   - 白底 + bottom hairline
 *   - 左 4 个 FileGlyph 叠加 (overlap, marginLeft -10)
 *   - 中 "全员资料 · N 份" + "新" pill (会中 上传时) + 副文 "X 刚上传 · file name"
 *   - 右 30×30 蓝 + 圆 上传按钮 + chevron 展开
 *
 * 行为:
 *   - 整个 行点击 → onOpen (展开 sheet)
 *   - 圆 + 按钮 → onUpload (开 UploadSheet)
 *
 * PM round-3: 该 strip 在 CompactContextExpandable 内, 跟议程 / 参与人 一起折叠 —
 * 不在 main body 单独显示.
 */

import type { ReactElement } from "react";

import MRIcon from "../../shared/Icon";
import { MR_COLORS } from "../styles";

import FileGlyph from "./FileGlyph";
import { hasNewMaterial, recentMaterials, type Material } from "./types";

type Props = {
  materials: Material[];
  onOpen: () => void;
  onUpload: () => void;
  /** 兜底: 没数据时仍要显空态 (议程会前未上传场景). */
  readOnly?: boolean;
};

export default function MaterialsStrip({
  materials,
  onOpen,
  onUpload,
  readOnly = false,
}: Props): ReactElement {
  const total = materials.length;
  const newOne = materials.find((f) => f.when === "live");
  const stackList = recentMaterials(materials, 4);
  const isNew = hasNewMaterial(materials);

  // 副文 — 描述谁刚上传, fallback 谁在会前共享
  const subText = (() => {
    if (newOne) {
      return `${newOne.uploaderName || "有人"} 刚上传 · ${newOne.name}`;
    }
    if (materials[0]) {
      return `${materials[0].uploaderName || "有人"} 等 · 会前已共享`;
    }
    return readOnly ? "暂无资料" : "暂无资料 · 点 + 上传第一份";
  })();

  return (
    <div
      data-testid="mobile-materials-strip"
      style={{
        background: MR_COLORS.bgWhite,
        padding: "8px 12px 10px 14px",
        borderBottom: `0.5px solid ${MR_COLORS.hairline}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      {/* 叠加 glyphs — 当无资料时显 empty placeholder (灰色虚框) */}
      <div
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {stackList.length > 0 ? (
          stackList.map((f, i) => (
            <div
              key={f.id}
              style={{
                marginLeft: i === 0 ? 0 : -10,
                zIndex: 10 - i,
              }}
            >
              <FileGlyph
                type={f.type}
                size={26}
                isNew={i === 0 && f.when === "live"}
              />
            </div>
          ))
        ) : (
          // empty placeholder (设计稿 没显式定义, 我们 加一个 灰色 虚边 26px 方块, 提示 "+")
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 4,
              border: `1px dashed ${MR_COLORS.textQuaternary}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: MR_COLORS.textQuaternary,
              fontSize: 18,
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            +
          </div>
        )}
      </div>

      {/* text */}
      <div
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            lineHeight: 1.2,
          }}
        >
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            全员资料
          </span>
          <span style={{ fontSize: 12, color: MR_COLORS.textTertiary }}>
            · {total} 份
          </span>
          {isNew ? (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: "#fff",
                background: MR_COLORS.systemRed,
                padding: "1px 5px",
                borderRadius: 3,
                letterSpacing: 0.4,
                marginLeft: 2,
              }}
            >
              新
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: MR_COLORS.textTertiary,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subText}
        </div>
      </div>

      {/* upload "+" 按钮 (readOnly 时 隐) */}
      {!readOnly ? (
        <button
          type="button"
          onClick={onUpload}
          title="上传资料"
          aria-label="上传新资料"
          data-testid="mobile-materials-upload-button"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: MR_COLORS.bgGroupedPrimary,
            border: "none",
            color: MR_COLORS.textPrimary,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontFamily: "inherit",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke={MR_COLORS.systemBlue}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}

      {/* chevron "展开" 按钮 */}
      <button
        type="button"
        onClick={onOpen}
        title="展开全部"
        aria-label="查看全部资料"
        style={{
          width: 24,
          height: 30,
          padding: 0,
          border: "none",
          background: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <MRIcon name="chev" size={15} color={MR_COLORS.textQuaternary} />
      </button>
    </div>
  );
}

