"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料 列表 bottom sheet.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:187-322 `MaterialsSheet`.
 *
 * 结构:
 *   - 标题 "全员资料" + 完成 (蓝)
 *   - 副 meta "所有参会人可见 · 支持 PDF/Word/Excel/PPT"
 *   - iOS segmented control: 全部 / 会前 / 会中 (count 后缀)
 *   - 上传 tile (虚框 蓝边)
 *   - 文件行: FileGlyph + 名 + (主提案 pill) + (新 pill) + 上传人 + 时间 + size
 *   - 文件行点击 → onPreview
 *
 * 会前 / 会中 分类 当前 暂没接 backend (when 全设 'pre'). 用户看到的就是 全部 / 会前.
 */

import { useState } from "react";
import type { ReactElement } from "react";

import MRIcon from "../../shared/Icon";
import { MR_COLORS } from "../styles";

import FileGlyph, { FILE_TYPES } from "./FileGlyph";
import type { Material } from "./types";

type Props = {
  open: boolean;
  materials: Material[];
  onClose: () => void;
  onPreview: (m: Material) => void;
  onUpload: () => void;
  /** 删除回调 (上传人 / leader+ 才能删, page 层判). */
  onDelete?: (m: Material) => void;
  /** readOnly = true 时 隐 上传 tile + 删按钮 (会议结束后). */
  readOnly?: boolean;
};

export default function MaterialsSheet({
  open,
  materials,
  onClose,
  onPreview,
  onUpload,
  onDelete,
  readOnly = false,
}: Props): ReactElement | null {
  const [tab, setTab] = useState<"all" | "pre" | "live">("all");

  if (!open) return null;

  const filtered = materials.filter((f) =>
    tab === "all" ? true : f.when === tab,
  );
  const preCount = materials.filter((f) => f.when === "pre").length;
  const liveCount = materials.filter((f) => f.when === "live").length;

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 80,
          animation: "mr-fadeIn 180ms ease",
        }}
      />
      {/* 主体 */}
      <div
        data-testid="mobile-materials-sheet"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: MR_COLORS.bgGroupedPrimary,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          zIndex: 81,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          animation: "mr-slideUp 240ms cubic-bezier(.22,.61,.36,1)",
          maxHeight: "82%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* handle */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 6,
          }}
        >
          <div
            style={{
              width: 36,
              height: 5,
              borderRadius: 3,
              background: MR_COLORS.separator,
            }}
          />
        </div>

        {/* title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px 4px",
          }}
        >
          <div style={{ width: 60 }} />
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: MR_COLORS.textPrimary,
            }}
          >
            全员资料
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: MR_COLORS.systemBlue,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            完成
          </button>
        </div>

        {/* sub-meta */}
        <div
          style={{
            textAlign: "center",
            fontSize: 11.5,
            color: MR_COLORS.textTertiary,
            padding: "0 16px 10px",
            display: "inline-flex",
            justifyContent: "center",
            gap: 5,
            width: "100%",
          }}
        >
          <span>所有参会人可见</span>
          <span>·</span>
          <span>支持 PDF / Word / Excel / PPT</span>
        </div>

        {/* tabs */}
        <div
          style={{
            margin: "0 16px",
            background: MR_COLORS.separatorLight,
            borderRadius: 9,
            padding: 3,
            display: "flex",
            gap: 2,
          }}
        >
          <SegTab
            id="all"
            label="全部"
            count={materials.length}
            on={tab === "all"}
            onSelect={() => setTab("all")}
          />
          <SegTab
            id="pre"
            label="会前"
            count={preCount}
            on={tab === "pre"}
            onSelect={() => setTab("pre")}
          />
          <SegTab
            id="live"
            label="会中"
            count={liveCount}
            on={tab === "live"}
            onSelect={() => setTab("live")}
          />
        </div>

        {/* list */}
        <div
          style={{
            padding: "12px 16px 0",
            overflow: "auto",
            flex: 1,
          }}
        >
          {/* upload tile */}
          {!readOnly ? (
            <button
              type="button"
              onClick={onUpload}
              data-testid="mobile-materials-sheet-upload"
              style={{
                width: "100%",
                padding: "12px 14px",
                background: MR_COLORS.bgWhite,
                border: "1px dashed rgba(0,122,255,0.35)",
                borderRadius: 12,
                fontFamily: "inherit",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(0,122,255,0.10)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke={MR_COLORS.systemBlue}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: MR_COLORS.systemBlue,
                  }}
                >
                  上传新资料
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: MR_COLORS.textTertiary,
                    marginTop: 1,
                  }}
                >
                  单文件最大 50MB · 上传后全员可见
                </div>
              </div>
            </button>
          ) : null}

          {/* file rows */}
          <div
            style={{
              background: MR_COLORS.bgWhite,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "36px 16px",
                  textAlign: "center",
                  color: MR_COLORS.textTertiary,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {tab === "live" ? "会中暂未上传新资料" : "暂无资料"}
              </div>
            ) : (
              filtered.map((f, i) => (
                <MaterialRow
                  key={f.id}
                  f={f}
                  last={i === filtered.length - 1}
                  onClick={() => onPreview(f)}
                  onDelete={onDelete ? () => onDelete(f) : undefined}
                  readOnly={readOnly}
                />
              ))
            )}
          </div>

          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  );
}

function SegTab({
  label,
  count,
  on,
  onSelect,
}: {
  id: string;
  label: string;
  count: number;
  on: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        flex: 1,
        height: 30,
        borderRadius: 7,
        border: "none",
        background: on ? MR_COLORS.bgWhite : "transparent",
        color: on ? MR_COLORS.textPrimary : MR_COLORS.textTertiary,
        fontSize: 13,
        fontWeight: on ? 600 : 500,
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
      }}
    >
      {label}
      <span
        style={{
          fontSize: 11,
          color: on ? MR_COLORS.textTertiary : MR_COLORS.textQuaternary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function MaterialRow({
  f,
  last,
  onClick,
  onDelete,
  readOnly,
}: {
  f: Material;
  last: boolean;
  onClick: () => void;
  onDelete?: () => void;
  readOnly: boolean;
}): ReactElement {
  const meta = FILE_TYPES[f.type] || FILE_TYPES.other;
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 14px",
        borderBottom: last
          ? "none"
          : `0.5px solid ${MR_COLORS.hairline}`,
        cursor: "pointer",
        WebkitTapHighlightColor: "rgba(0,0,0,0.04)",
      }}
    >
      <FileGlyph type={f.type} size={34} ring="transparent" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: MR_COLORS.textPrimary,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {f.name}
          </span>
          {f.pinned ? (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: meta.color,
                background: meta.accent,
                padding: "1px 5px",
                borderRadius: 3,
                letterSpacing: 0.3,
                flexShrink: 0,
              }}
            >
              主提案
            </span>
          ) : null}
          {f.when === "live" ? (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: "#fff",
                background: MR_COLORS.systemRed,
                padding: "1px 5px",
                borderRadius: 3,
                letterSpacing: 0.4,
                flexShrink: 0,
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
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          <span>{f.uploaderName}</span>
          <span>·</span>
          <span>{f.time}</span>
          <span>·</span>
          <span>{f.size}</span>
          {f.extractStatus && f.extractStatus !== "ready" ? (
            <>
              <span>·</span>
              <ExtractStatusTag status={f.extractStatus} />
            </>
          ) : null}
        </div>
      </div>
      {!readOnly && onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`删除 ${f.name}`}
          style={{
            background: "none",
            border: "none",
            padding: "0 4px",
            color: MR_COLORS.textTertiary,
            fontSize: 18,
            cursor: "pointer",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : (
        <MRIcon name="chev" size={16} color={MR_COLORS.textQuaternary} />
      )}
    </div>
  );
}

function ExtractStatusTag({ status }: { status: string }): ReactElement {
  // 用 浅色 + iOS 色 — 跟 design system 走
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: "上传中", color: "#3C3C43", bg: "#E5E5EA" },
    extracting: { label: "抽取中", color: "#5E5CE6", bg: "rgba(94,92,230,0.10)" },
    failed: { label: "抽取失败", color: "#FF3B30", bg: "rgba(255,59,48,0.10)" },
    skipped: { label: "未识别", color: "#8E8E93", bg: "#F2F2F7" },
  };
  const meta = map[status];
  if (!meta) return <span>{status}</span>;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        padding: "1px 5px",
        borderRadius: 3,
      }}
    >
      {meta.label}
    </span>
  );
}
