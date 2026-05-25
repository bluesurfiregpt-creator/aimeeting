"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 文件 全屏 预览.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:559-895 `FilePreview` (含 MockPage / DocPage /
 *   PPTSlide / ExcelGrid).
 *
 * 落地差: 设计稿 是 mock 渲染 (用 hardcoded 内容渲染 类似 PDF/PPT/Excel/Word 页面),
 * 真实 实现 暂时 也只 显 mock 占位 — 真实 抽取内容 在 backend (extract_summary) 上,
 * round-4 才能 接. 当前 显 文件元信息 + "预览开发中" 提示, 至少 用户能看到 是哪个文件.
 *
 * [STYLE-DEVIATION: round-3 设计稿 完整 mock paper-style 预览; 真实 实现 暂用 占位
 *  视觉 (深色 + 文件元 + extract_summary 文本); 视觉 调性 (深色 + 顶 nav + 底 pager)
 *  跟设计稿 1:1, 内容区 待 接 真实 PDF 渲染器]
 *
 * 顶 nav: 返 + FileGlyph + 文件名 + 上传人/time/size + 下载 + 更多
 * 内容区: 居中卡片 + extract_summary (markdown 文本)
 * 底 pager: 上一页 / X / 下一页 (mock — extract 没分页)
 */

import { useState } from "react";
import type { ReactElement } from "react";

import MRIcon from "../MRIcon";

import FileGlyph from "./FileGlyph";
import type { Material } from "./types";

type Props = {
  file: Material;
  /** 上传文件后端 ID — 用于 download / 后续 真实 preview. */
  attachmentId: string;
  /** 真实 extract_summary 文本 (markdown). null 表示 抽取中 / 失败. */
  extractSummary?: string | null;
  /** extract_status. */
  extractStatus?: string;
  onClose: () => void;
};

export default function FilePreview({
  file,
  attachmentId,
  extractSummary,
  extractStatus,
  onClose,
}: Props): ReactElement {
  const [page, setPage] = useState(1);
  const totalPages = 1; // 真实 抽取 暂无分页, mock = 1

  void attachmentId; // 后续接 download endpoint 时用

  return (
    <div
      data-testid="mobile-file-preview"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        background: "#1C1C1E",
        display: "flex",
        flexDirection: "column",
        animation: "mr-fadeIn 240ms ease",
      }}
    >
      {/* top bar */}
      <div
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: 10,
          paddingLeft: 6,
          paddingRight: 10,
          background: "rgba(28,28,30,0.96)",
          backdropFilter: "blur(20px)",
          borderBottom: "0.5px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="返回"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#fff",
            padding: "0 6px",
            height: 36,
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            fontFamily: "inherit",
            fontSize: 16,
          }}
        >
          <MRIcon name="back" size={22} color="#fff" />
        </button>
        <FileGlyph type={file.type} size={26} ring="transparent" />
        <div style={{ flex: 1, minWidth: 0, color: "#fff" }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              marginTop: 1,
            }}
          >
            {file.uploaderName} · {file.time} · {file.size}
          </div>
        </div>
        <button
          type="button"
          title="下载"
          aria-label="下载文件"
          style={darkIconBtn}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4v12M7 11l5 5 5-5M5 19h14"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          title="更多"
          aria-label="更多操作"
          style={darkIconBtn}
        >
          <MRIcon name="more" size={18} color="#fff" />
        </button>
      </div>

      {/* page content — 占位 (round-4 接真实 PDF 渲染) */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 16px 100px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 360 }}>
          {/* "all visible" 提示 */}
          <div
            style={{
              margin: "0 auto 14px",
              display: "inline-flex",
              width: "100%",
              justifyContent: "center",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <circle
                cx="9"
                cy="8"
                r="3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle
                cx="17"
                cy="9"
                r="2.4"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M3 19c.7-2.5 3-4 6-4s5.3 1.5 6 4M14 18c.5-1.6 2-2.7 4-2.7s3.5 1.1 4 2.7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span>所有参会人均可查看</span>
          </div>

          {/* 白色卡纸 — 显文件元 + extract_summary */}
          <div
            style={{
              background: "#fff",
              borderRadius: 6,
              boxShadow:
                "0 10px 30px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.10)",
              overflow: "hidden",
              minHeight: 460,
              padding: "32px 28px",
              position: "relative",
              color: "#1C1C1E",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#8E8E93",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              文件预览 · 第 {page} 页
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 10,
                paddingBottom: 8,
                borderBottom: `2px solid #007AFF`,
              }}
            >
              {file.name}
            </div>

            {/* extract status / summary */}
            {extractStatus === "ready" && extractSummary ? (
              <div
                style={{
                  marginTop: 16,
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  color: "#3C3C43",
                  whiteSpace: "pre-wrap",
                }}
              >
                {extractSummary}
              </div>
            ) : extractStatus === "extracting" ||
              extractStatus === "pending" ? (
              <div
                style={{
                  marginTop: 32,
                  textAlign: "center",
                  color: "#8E8E93",
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 30 }}>⏳</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>抽取中…</div>
                <div style={{ marginTop: 4, fontSize: 11.5 }}>
                  AI 正在 解析 这份文件, 完成后 这里 会显内容
                </div>
              </div>
            ) : extractStatus === "failed" ? (
              <div
                style={{
                  marginTop: 32,
                  textAlign: "center",
                  color: "#FF3B30",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontSize: 30 }}>⚠</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>抽取失败</div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11.5,
                    color: "#8E8E93",
                  }}
                >
                  {file.lastError?.slice(0, 120) || "未知错误"}
                </div>
              </div>
            ) : extractStatus === "skipped" ? (
              <div
                style={{
                  marginTop: 32,
                  textAlign: "center",
                  color: "#8E8E93",
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 30 }}>⊘</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>未识别此类文件</div>
                <div style={{ marginTop: 4, fontSize: 11.5 }}>
                  下载到本机 查看
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 32,
                  textAlign: "center",
                  color: "#8E8E93",
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 30 }}>📄</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>预览开发中</div>
                <div style={{ marginTop: 4, fontSize: 11.5 }}>
                  下方 可下载 原文件
                </div>
              </div>
            )}

            {/* footer */}
            <div
              style={{
                position: "absolute",
                left: 28,
                right: 28,
                bottom: 18,
                fontSize: 9.5,
                color: "#C7C7CC",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "70%",
                }}
              >
                {file.name}
              </span>
              <span>
                {page} / {totalPages}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* bottom — pager */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
          paddingTop: 12,
          background:
            "linear-gradient(180deg, rgba(28,28,30,0) 0%, rgba(28,28,30,0.85) 40%, rgba(28,28,30,1) 100%)",
        }}
      >
        <div
          style={{
            margin: "0 auto",
            maxWidth: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(58,58,60,0.92)",
            borderRadius: 18,
            padding: "6px 8px",
          }}
        >
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            style={pagerBtn(page === 1)}
            aria-label="上一页"
          >
            <svg width="14" height="14" viewBox="0 0 24 24">
              <path
                d="M15 6l-6 6 6 6"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
          <div
            style={{
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {page} / {totalPages}
          </div>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            style={pagerBtn(page === totalPages)}
            aria-label="下一页"
          >
            <svg width="14" height="14" viewBox="0 0 24 24">
              <path
                d="M9 6l6 6-6 6"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const darkIconBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "rgba(255,255,255,0.08)",
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const pagerBtn = (disabled: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: "none",
  background: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.15)",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});
