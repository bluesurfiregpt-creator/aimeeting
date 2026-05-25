"use client";

/**
 * v1.2.0 · Saga · meeting-room-v2 · round-3 · 资料 上传 sheet.
 *
 * 设计源 1:1: docs/design/handoffs/2026-05-25-meeting-room-r3/aimeeting/project/
 *   meeting-room-materials.jsx:381-557 `UploadSheet`.
 *
 * 设计稿 是 mock progress (~1.5s fake), 真实 实现 接 backend mApi.uploadMeetingAttachment.
 * 但 视觉 + 时序 严格 按 设计稿 (idle / uploading / done 三段).
 *
 * 关键 stages:
 *   - idle: 显 蓝色 visibility 提示 + 虚线 dropzone (点击 = 触发 file input) + 4 类 icon
 *   - uploading: 显 file row + 蓝色 进度条 + "正在上传…" + 百分比
 *   - done: 进度条 绿色 满 + ✓ 右上 + "上传完成 · 已对全员开放", 650ms 后 自动 关
 *
 * 真实 上传时机:
 *   - 用户选 file → 立即 start FormData POST
 *   - 同时 mock progress 视觉 (XHR upload event 接 progress 后续 round-4 再做, 现 用 fake)
 *   - 完成 / 失败 都更新 stage
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import { mApi } from "@/lib/mobile/api";

import { MR_COLORS } from "../styles";

import FileGlyph, { FILE_TYPES, mapExtensionToType } from "./FileGlyph";
import type { MaterialType } from "./FileGlyph";

type Stage = "idle" | "uploading" | "done" | "error";

type Props = {
  open: boolean;
  /** 传给 backend — 二选一. */
  meetingId?: string;
  draftId?: string;
  onClose: () => void;
  /** 上传完 (backend 返 ok 后) 触发, 父组件 ref resh attachments. */
  onComplete: () => void;
};

const ACCEPT_ATTR =
  ".pdf,.docx,.xlsx,.xls,.pptx," +
  ".txt,.md,.csv,.log,.json,.yaml,.yml," +
  ".jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp,.gif";

const MAX_BYTES = 50 * 1024 * 1024;

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fileExtension(f: File): string {
  const idx = f.name.lastIndexOf(".");
  return idx >= 0 ? f.name.slice(idx + 1) : "";
}

export default function UploadSheet({
  open,
  meetingId,
  draftId,
  onClose,
  onComplete,
}: Props): ReactElement | null {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // reset 当 close → 再开
  useEffect(() => {
    if (!open) {
      setStage("idle");
      setProgress(0);
      setErrorMsg(null);
      setPicked(null);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }
  }, [open]);

  const startUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setStage("error");
        setErrorMsg(`${file.name}: 文件超 50MB 上限`);
        return;
      }
      setPicked(file);
      setStage("uploading");
      setProgress(0);
      setErrorMsg(null);

      // mock progress — XHR upload event 接入是 round-4. 现 70% 给真实 upload 时间,
      // 剩 30% 等 server 完成. 视觉 1.4s 内涨到 70%, 完成时 一次性 跳 100%.
      const tStart = Date.now();
      progressTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - tStart;
        const p = Math.min(70, (elapsed / 1400) * 70);
        setProgress(p);
      }, 60);

      try {
        await mApi.uploadMeetingAttachment(file, {
          client_draft_id: draftId,
          meeting_id: meetingId,
        });
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        setProgress(100);
        setStage("done");
        // 设计稿 650ms 后 自动 close + 通知 父
        setTimeout(() => {
          onComplete();
          onClose();
        }, 650);
      } catch (e) {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        setStage("error");
        setErrorMsg(
          `上传失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [draftId, meetingId, onClose, onComplete],
  );

  const onPickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void startUpload(f);
      if (inputRef.current) inputRef.current.value = "";
    },
    [startUpload],
  );

  if (!open) return null;

  const pickedType: MaterialType = picked
    ? mapExtensionToType(fileExtension(picked))
    : "other";

  return (
    <>
      <div
        onClick={stage === "uploading" ? undefined : onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 82,
          animation: "mr-fadeIn 180ms ease",
        }}
      />
      <div
        data-testid="mobile-upload-sheet"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: MR_COLORS.bgGroupedPrimary,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          zIndex: 83,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          animation: "mr-slideUp 240ms cubic-bezier(.22,.61,.36,1)",
          display: "flex",
          flexDirection: "column",
        }}
      >
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
            上传资料
          </div>
          <button
            type="button"
            onClick={stage === "uploading" ? undefined : onClose}
            disabled={stage === "uploading"}
            style={{
              background: "none",
              border: "none",
              color:
                stage === "uploading"
                  ? MR_COLORS.textQuaternary
                  : MR_COLORS.systemBlue,
              fontSize: 16,
              fontFamily: "inherit",
              cursor: stage === "uploading" ? "default" : "pointer",
            }}
          >
            {stage === "done" ? "完成" : "取消"}
          </button>
        </div>

        <div style={{ padding: "6px 16px 18px" }}>
          {stage === "idle" || stage === "error" ? (
            <>
              {/* visibility 提示 (蓝色) */}
              <div
                style={{
                  background:
                    "linear-gradient(135deg, rgba(0,122,255,0.07), rgba(0,122,255,0.10))",
                  border: `0.5px solid rgba(0,122,255,0.22)`,
                  borderRadius: 10,
                  padding: "9px 12px",
                  fontSize: 12.5,
                  color: MR_COLORS.textPrimary,
                  lineHeight: 1.45,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 7,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  style={{ flexShrink: 0, marginTop: 2 }}
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke={MR_COLORS.systemBlue}
                    strokeWidth="1.6"
                    fill="none"
                  />
                  <path
                    d="M12 8v5M12 16.5v.5"
                    stroke={MR_COLORS.systemBlue}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                <span>
                  <strong>上传后全员可见</strong> · 可在「全员资料」中查看, 或被主持人引用至议程
                </span>
              </div>

              {/* dropzone */}
              <button
                type="button"
                onClick={onPickFile}
                data-testid="mobile-upload-sheet-pick"
                style={{
                  marginTop: 12,
                  width: "100%",
                  background: MR_COLORS.bgWhite,
                  border: "1.5px dashed rgba(0,122,255,0.40)",
                  borderRadius: 12,
                  padding: "28px 16px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "rgba(0,122,255,0.10)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M7 10l5-5 5 5"
                      stroke={MR_COLORS.systemBlue}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"
                      stroke={MR_COLORS.systemBlue}
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: MR_COLORS.systemBlue,
                  }}
                >
                  选择文件
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: MR_COLORS.textTertiary,
                  }}
                >
                  支持 PDF / Word / Excel / PPT 等
                </div>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                style={{ display: "none" }}
                onChange={onFileChange}
              />

              {/* 支持类型 行 */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "center",
                  gap: 16,
                }}
              >
                {(["pdf", "word", "excel", "ppt"] as MaterialType[]).map((k) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <FileGlyph type={k} size={28} ring="transparent" />
                    <span
                      style={{
                        fontSize: 10,
                        color: MR_COLORS.textTertiary,
                      }}
                    >
                      {FILE_TYPES[k].label}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: MR_COLORS.textQuaternary,
                  marginTop: 10,
                }}
              >
                单文件最大 50MB · 文件总数不限
              </div>

              {/* error */}
              {stage === "error" && errorMsg ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "rgba(255,59,48,0.08)",
                    border: `0.5px solid rgba(255,59,48,0.30)`,
                    fontSize: 12.5,
                    color: MR_COLORS.systemRed,
                    lineHeight: 1.45,
                  }}
                >
                  {errorMsg}
                </div>
              ) : null}
            </>
          ) : null}

          {(stage === "uploading" || stage === "done") && picked ? (
            <div
              style={{
                background: MR_COLORS.bgWhite,
                borderRadius: 12,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                }}
              >
                <FileGlyph type={pickedType} size={36} ring="transparent" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: MR_COLORS.textPrimary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {picked.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: MR_COLORS.textTertiary,
                      marginTop: 2,
                    }}
                  >
                    {formatSize(picked.size)}
                  </div>
                </div>
                {stage === "done" ? (
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: MR_COLORS.systemGreen,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M5 12.5l4.5 4.5L19 7.5"
                        stroke="#fff"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                ) : null}
              </div>
              {/* progress bar */}
              <div
                style={{
                  height: 6,
                  background: MR_COLORS.separatorLight,
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    background:
                      stage === "done"
                        ? MR_COLORS.systemGreen
                        : MR_COLORS.systemBlue,
                    borderRadius: 3,
                    transition: "width 60ms linear",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color:
                    stage === "done"
                      ? MR_COLORS.systemGreen
                      : MR_COLORS.textTertiary,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {stage === "done"
                    ? "上传完成 · 已对全员开放"
                    : "正在上传…"}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {Math.floor(progress)}%
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
