"use client";

/**
 * v1.4.0 · Sprint 3 Mobile (Part 1) · 会议室 AI 发言 → 引用 KB 侧滑 sheet.
 *
 * NORTH_STAR § 3.2 旗舰能力: 用户问 "AI 说这个根据啥?" 时, 点 AI 发言下方
 * "引用 N 条 KB" 把这张 sheet 拉起 → 看 chunk 原文 + 跳 KB 详情 (Web).
 *
 * 设计:
 *   - 半屏 sheet (50vh, 不是全屏) — 复用 MASheet 的 Portal + backdrop +
 *     ESC + body-scroll 锁, 但 panel top=50vh 不再 0
 *   - header: 灰色 eyebrow "AI 引用的知识库" + 关闭 × (跟 MASheet 一致)
 *   - body: list (每行 = doc_name + chunk snippet truncate 3 行 + 距离 chip +
 *     "查看原文 →" 蓝 link → 跳 /kb/documents/{document_id}#chunk-{chunk_id})
 *   - empty fallback: MAEmpty "本条 AI 发言无引用"
 *
 * 数据契约: SCHEMA-mobile-v2.md §3.X 复用 backend AgentCitationOut (meetings.py:3385)
 *   { chunk_id, document_id, document_filename, chunk_index, snippet, distance }
 *
 * 风格守门: 浅 iOS · #F2F2F7 / #FFFFFF / 0.5px hairline / iOS 蓝 #007AFF link.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import MAEmpty from "./MAEmpty";

/**
 * 一条 KB 引用 — 跟 backend AgentCitationOut (meetings.py:3385) 字段一致.
 * 复用 v2 atom 之外的全局 import 不引入新依赖, 这里独立声明.
 */
export type KBCitation = {
  chunk_id: string;
  document_id: string;
  document_filename: string;
  chunk_index: number;
  snippet: string;
  distance: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  citations: KBCitation[];
  /** 顶部 eyebrow 上方副标 — 哪条 AI 发言的引用 (eg "Lex · 11:42") */
  speakerLabel?: string;
  /** loading state — 正在拉 citations */
  loading?: boolean;
};

const ANIM_MS = 260;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export default function KBCitationSheet({
  open,
  onClose,
  citations,
  speakerLabel,
  loading = false,
}: Props): ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closingTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (closingTimer.current) {
        window.clearTimeout(closingTimer.current);
        closingTimer.current = null;
      }
      setMounted(true);
      const id = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(id);
    } else {
      setVisible(false);
      closingTimer.current = window.setTimeout(() => {
        setMounted(false);
        closingTimer.current = null;
      }, ANIM_MS);
      return () => {
        if (closingTimer.current) {
          window.clearTimeout(closingTimer.current);
          closingTimer.current = null;
        }
      };
    }
  }, [open]);

  // ESC 关
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // body scroll 锁
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100, // 高于 MASheet (1000) — 可叠在 meeting room 上
        pointerEvents: open ? "auto" : "none",
      }}
      aria-modal="true"
      role="dialog"
      data-testid="kb-citation-sheet"
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          opacity: visible ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ${EASE}`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          top: "50vh", // 半屏 — 不是全屏
          background: "#F2F2F7",
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${ANIM_MS}ms ${EASE}`,
          willChange: "transform",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
        }}
      >
        {/* Header — drag handle + title + 关闭 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            padding: "6px 0 0",
            background: "rgba(242,242,247,0.96)",
            backdropFilter: "saturate(180%) blur(16px)",
            WebkitBackdropFilter: "saturate(180%) blur(16px)",
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            flexShrink: 0,
          }}
        >
          {/* drag handle */}
          <div
            style={{
              width: 36,
              height: 5,
              borderRadius: 2.5,
              background: "rgba(60,60,67,0.30)",
              margin: "0 auto",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px 10px",
              borderBottom: "0.5px solid rgba(60,60,67,0.14)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#1C1C1E",
                  margin: 0,
                  letterSpacing: -0.1,
                }}
              >
                AI 引用的知识库
              </h2>
              {speakerLabel ? (
                <p
                  style={{
                    fontSize: 11.5,
                    color: "#8E8E93",
                    margin: 0,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {speakerLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="kb-citation-sheet-close"
              style={{
                background: "transparent",
                border: "none",
                color: "#007AFF",
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
                padding: "6px 4px",
                fontFamily: "inherit",
              }}
            >
              完成
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "12px 16px",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          {loading ? (
            <div
              style={{
                background: "rgba(60,60,67,0.04)",
                borderRadius: 12,
                height: 90,
                marginBottom: 10,
              }}
            />
          ) : citations.length === 0 ? (
            <MAEmpty
              icon="doc"
              title="本条 AI 发言无引用"
              body="模型未基于 KB 内容生成回答 · 仅依赖会议上下文 + 长期记忆"
            />
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {citations.map((c, i) => (
                <CitationRow key={c.chunk_id || i} cit={c} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CitationRow({ cit }: { cit: KBCitation }): ReactElement {
  // distance → 相似度 chip 文案 (距离越小越像; 但避免吓人, 不显数字, 显"高/中/弱")
  // backend pgvector cosine distance ≈ [0, 2), 0.0=完全相同 / 0.4=高度相关 / 0.8+=弱.
  const distLabel =
    cit.distance < 0.35
      ? "高度相关"
      : cit.distance < 0.6
        ? "相关"
        : "参考";
  const distColor =
    cit.distance < 0.35
      ? "#34C759"
      : cit.distance < 0.6
        ? "#5E5CE6"
        : "#8E8E93";

  return (
    <li
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        border: "0.5px solid rgba(60,60,67,0.10)",
        boxShadow: "0 1px 0 rgba(60,60,67,0.04)",
      }}
    >
      {/* header — doc filename + 相似度 chip */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: distColor,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#1C1C1E",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={cit.document_filename}
          >
            {cit.document_filename || "(未命名文档)"}
          </span>
        </div>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: distColor,
            padding: "2px 6px",
            borderRadius: 6,
            background: `${distColor}1A`,
            flexShrink: 0,
            letterSpacing: 0.2,
          }}
        >
          {distLabel}
        </span>
      </div>

      {/* chunk index + snippet */}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: "#8E8E93",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        段落 #{cit.chunk_index + 1}
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 13.5,
          color: "#3C3C43",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {cit.snippet}
      </p>

      {/* 跳 KB 详情 — Web 端编辑入口 (NORTH_STAR § 4.2.2 移动不做配置编辑,
          所以 这里 link 跳 web KB 详情 用 target="_blank" 让 webview 兼容). */}
      <a
        href={`/workspace/kb/documents/${cit.document_id}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="kb-citation-view-source"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          marginTop: 10,
          fontSize: 13,
          fontWeight: 600,
          color: "#007AFF",
          textDecoration: "none",
        }}
      >
        查看原文
        <span aria-hidden="true">→</span>
      </a>
    </li>
  );
}
