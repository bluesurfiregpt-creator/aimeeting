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

import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import MRIcon from "../../shared/Icon";

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

type Chapter = {
  section_number: number;
  title: string;
  summary: string;
};

type ViewTab = "summary" | "chapters" | "fulltext";

export default function FilePreview({
  file,
  attachmentId,
  extractSummary,
  extractStatus,
  onClose,
}: Props): ReactElement {
  const [page, setPage] = useState(1);
  const totalPages = 1; // 全文 tab 用 5KB 一页 算

  // v1.4.0 Phase C · 12: 三 tab — 概要 / 章节 / 全文 (替 "预览开发中" 占位)
  const [tab, setTab] = useState<ViewTab>("summary");
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);
  const [fullText, setFullText] = useState<string | null>(null);
  const [fullTextLoading, setFullTextLoading] = useState(false);
  const [fullTextError, setFullTextError] = useState<string | null>(null);

  const canPreview = extractStatus === "ready";

  // 切到 "章节" tab 时 拉/抽 章节
  useEffect(() => {
    if (tab !== "chapters" || !canPreview || chapters !== null || chaptersLoading) return;
    setChaptersLoading(true);
    setChaptersError(null);
    fetch(`/api/meetings/attachments/${attachmentId}/extract-chapters`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status} ${t.slice(0, 100)}`);
        }
        return r.json();
      })
      .then((d: { chapter_summaries: Chapter[]; cached: boolean }) =>
        setChapters(d.chapter_summaries),
      )
      .catch((e) =>
        setChaptersError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setChaptersLoading(false));
  }, [tab, attachmentId, canPreview, chapters, chaptersLoading]);

  // 切到 "全文" tab 时 拉 detail (含 extract_text)
  useEffect(() => {
    if (tab !== "fulltext" || !canPreview || fullText !== null || fullTextLoading) return;
    setFullTextLoading(true);
    setFullTextError(null);
    fetch(`/api/meetings/attachments/${attachmentId}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { extract_text: string | null }) => setFullText(d.extract_text || ""))
      .catch((e) =>
        setFullTextError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setFullTextLoading(false));
  }, [tab, attachmentId, canPreview, fullText, fullTextLoading]);

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

            {/* v1.4.0 Phase C · 12: 三 tab segmented control (替 "预览开发中" 占位) */}
            {canPreview && (
              <div
                data-testid="file-preview-tabs"
                style={{
                  display: "flex",
                  gap: 4,
                  marginTop: 16,
                  padding: 3,
                  borderRadius: 8,
                  background: "#F2F2F7",
                }}
              >
                {([
                  ["summary", "概要"],
                  ["chapters", "章节"],
                  ["fulltext", "全文"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 6,
                      background: tab === k ? "#fff" : "transparent",
                      color: tab === k ? "#1C1C1E" : "#8E8E93",
                      border: "none",
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      transition: "all 140ms ease",
                      boxShadow:
                        tab === k ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* extract status / 内容 — 按 tab 分流 */}
            {extractStatus === "extracting" || extractStatus === "pending" ? (
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
                <div style={{ marginTop: 4, fontSize: 11.5, color: "#8E8E93" }}>
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
            ) : tab === "summary" ? (
              extractSummary ? (
                <div
                  data-testid="file-preview-summary"
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
                  <div style={{ marginTop: 8, fontWeight: 600 }}>暂无 概要</div>
                </div>
              )
            ) : tab === "chapters" ? (
              chaptersLoading ? (
                <div
                  style={{
                    marginTop: 32,
                    textAlign: "center",
                    color: "#8E8E93",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontSize: 24 }}>✦</div>
                  <div style={{ marginTop: 8, fontWeight: 600 }}>AI 正在 抽 章节…</div>
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    需要 2-5 秒, 抽完 后 缓存
                  </div>
                </div>
              ) : chaptersError ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(255,59,48,0.10)",
                    color: "#FF3B30",
                    fontSize: 12,
                  }}
                >
                  抽章节 失败: {chaptersError}
                </div>
              ) : chapters && chapters.length > 0 ? (
                <div
                  data-testid="file-preview-chapters"
                  style={{
                    marginTop: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {chapters.map((c) => (
                    <div
                      key={c.section_number}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        background: "#F7F7F9",
                        border: "0.5px solid rgba(60,60,67,0.10)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#5E5CE6",
                            letterSpacing: 0.4,
                          }}
                        >
                          §{c.section_number}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#1C1C1E",
                          }}
                        >
                          {c.title}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          lineHeight: 1.6,
                          color: "#3C3C43",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {c.summary}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null
            ) : tab === "fulltext" ? (
              fullTextLoading ? (
                <div
                  style={{
                    marginTop: 32,
                    textAlign: "center",
                    color: "#8E8E93",
                    fontSize: 13,
                  }}
                >
                  加载 全文…
                </div>
              ) : fullTextError ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(255,59,48,0.10)",
                    color: "#FF3B30",
                    fontSize: 12,
                  }}
                >
                  加载 全文 失败: {fullTextError}
                </div>
              ) : fullText ? (
                <div
                  data-testid="file-preview-fulltext"
                  style={{
                    marginTop: 16,
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: "#3C3C43",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: "60vh",
                    overflowY: "auto",
                    padding: "12px 14px",
                    borderRadius: 8,
                    background: "#FAFAFA",
                    border: "0.5px solid rgba(60,60,67,0.10)",
                  }}
                >
                  {fullText}
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
                  全文 为空
                </div>
              )
            ) : null}

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
